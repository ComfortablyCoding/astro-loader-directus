// Reads items page by page from `/items/:collection`, or a system endpoint for core collections.
import { customEndpoint } from '@directus/sdk';
import type { DirectusQuery } from '../options.js';
import { type Directus, DirectusLoaderError } from './client.js';

export type Item = Record<string, unknown>;

const SYSTEM_PREFIX = 'directus_';

// Keeps request URLs well under common length limits.
const IDS_PER_REQUEST = 100;

// Directus rejects a page above QUERY_LIMIT_MAX with this reason.
const LIMIT_EXCEEDED = /"limit" must be less than or equal to (\d+)/;

export interface ReadOptions {
	directus: Directus;
	collection: string;
	query: DirectusQuery;
	pageSize: number;
}

/** `/items/:collection`, or the system endpoint of a core collection: `directus_files` is served from `/files`. */
export function getItemsEndpoint(collection: string): string {
	return collection.startsWith(SYSTEM_PREFIX)
		? `/${collection.slice(SYSTEM_PREFIX.length)}`
		: `/items/${encodeURIComponent(collection)}`;
}

export async function readAllItems({ directus, collection, query, pageSize }: ReadOptions): Promise<Item[]> {
	const items: Item[] = [];
	let limit = pageSize;

	// Stops only on an empty page and advances by what was returned: a short page may be capped by QUERY_LIMIT_MAX,
	// and stopping there would drop every entry after it.
	for (;;) {
		let page: Item[];

		try {
			page = await directus.request(
				customEndpoint<Item[]>({
					path: getItemsEndpoint(collection),
					params: { ...query, limit, offset: items.length },
				}),
				`read items from "${collection}"`,
			);
		} catch (error) {
			// Tokens that can't read the server info can't look up QUERY_LIMIT_MAX, so take it from the rejection.
			const max = getLimitExceeded(error);

			if (max === undefined || max >= limit) throw error;

			limit = max;
			continue;
		}

		if (page.length === 0) return items;

		items.push(...page);
	}
}

/** Reads the items whose `field` is one of `values`. */
export async function readItemsIn({
	field,
	values,
	...options
}: ReadOptions & { field: string; values: string[] }): Promise<Item[]> {
	const items: Item[] = [];

	for (let i = 0; i < values.length; i += IDS_PER_REQUEST) {
		const filter = mergeFilters(options.query.filter, { [field]: { _in: values.slice(i, i + IDS_PER_REQUEST) } });

		items.push(...(await readAllItems({ ...options, query: { ...options.query, filter } })));
	}

	return items;
}

export async function readSingletonItem({ directus, collection, query }: Omit<ReadOptions, 'pageSize'>): Promise<Item> {
	return directus.request(
		customEndpoint<Item>({ path: getItemsEndpoint(collection), params: query }),
		`read the singleton "${collection}"`,
	);
}

/**
 * The page size Directus accepts: requests above QUERY_LIMIT_MAX are rejected, not capped. The limit is only visible
 * to authenticated requests.
 */
export async function getPageSize(directus: Directus, pageSize: number): Promise<number> {
	const info = await directus
		.request(customEndpoint<{ queryLimit?: { max?: number } }>({ path: '/server/info' }), 'read the server info')
		.catch(() => undefined);

	const max = info?.queryLimit?.max;

	return max !== undefined && max > 0 ? Math.min(pageSize, max) : pageSize;
}

/** Combines filters with `_and`, skipping empty ones. */
export function mergeFilters(...filters: (Record<string, unknown> | undefined)[]): Record<string, unknown> | undefined {
	const defined = filters.filter((filter) => filter && Object.keys(filter).length > 0);

	if (defined.length <= 1) return defined[0];

	return { _and: defined };
}

function getLimitExceeded(error: unknown): number | undefined {
	if (!(error instanceof DirectusLoaderError) || error.status !== 400) return undefined;

	const max = Number(LIMIT_EXCEEDED.exec(error.message)?.[1]);

	return max > 0 ? max : undefined;
}
