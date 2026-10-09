// Replaces file ids with absolute asset URLs that astro:assets and plain <img> tags can use.
import type { AssetsQuery } from '@directus/sdk';
import type { FieldInfo } from './collection.js';
import type { Item } from './items.js';

export const FILES_COLLECTION = 'directus_files';

const DEFAULT_JUNCTION_FIELD = 'directus_files_id';

/** The URL of a Directus asset, with an optional preset key or transforms. */
export function getAssetUrl(baseUrl: string, id: string, query?: AssetsQuery): string {
	const url = new URL(`assets/${encodeURIComponent(id)}`, `${baseUrl.replace(/\/+$/, '')}/`);

	for (const [key, value] of Object.entries(query ?? {})) {
		if (value === undefined) continue;

		url.searchParams.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
	}

	return url.toString();
}

/** A file id becomes its asset URL; an expanded file object gets a `src` asset URL. */
export function resolveFile(value: unknown, baseUrl: string, query?: AssetsQuery): unknown {
	if (typeof value === 'string') return getAssetUrl(baseUrl, value, query);
	if (isObject(value) && typeof value['id'] === 'string')
		return { ...value, src: getAssetUrl(baseUrl, value['id'], query) };

	return value;
}

/** Resolves the item's file fields, including files linked through a many-to-many junction. */
export function resolveFileFields(item: Item, fields: FieldInfo[], baseUrl: string, query?: AssetsQuery): Item {
	const result = { ...item };

	for (const field of fields) {
		const value = result[field.name];

		if (field.kind === 'file') {
			result[field.name] = resolveFile(value, baseUrl, query);
		} else if (field.kind === 'files' && Array.isArray(value)) {
			const junctionField = field.junctionField ?? DEFAULT_JUNCTION_FIELD;

			// Junction rows are ids unless expanded.
			result[field.name] = value.map((row: unknown) =>
				isObject(row) && junctionField in row
					? { ...row, [junctionField]: resolveFile(row[junctionField], baseUrl, query) }
					: row,
			);
		}
	}

	return result;
}

function isObject(value: unknown): value is Item {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
