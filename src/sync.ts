// Syncs a collection into the content store: a full load the first time, then only what changed since the last sync.
import type { LoaderContext } from 'astro/loaders';
import { FILES_COLLECTION, resolveFile, resolveFileFields } from './directus/assets.js';
import type { Directus } from './directus/client.js';
import type { CollectionInfo } from './directus/collection.js';
import {
	type Item,
	getPageSize,
	mergeFilters,
	readAllItems,
	readItemsIn,
	readSingletonItem,
} from './directus/items.js';
import type {
	DirectusCollectionLoaderOptions,
	DirectusLoaderOptions,
	DirectusQuery,
	DirectusSingletonLoaderOptions,
} from './options.js';

export const DEFAULT_PRIMARY_KEY = 'id';

const DEFAULT_PAGE_SIZE = 100;

// Meta store keys.
const SYNC_KEY = 'directus-sync-key';
const LAST_UPDATED = 'directus-last-updated';

interface SyncOptions<Options extends DirectusLoaderOptions> {
	directus: Directus;
	context: LoaderContext;
	options: Options;
	info: CollectionInfo;
	writeEntry: WriteEntry;
}

/** Returns whether the entry changed. */
export type WriteEntry = (id: string, item: Item) => Promise<boolean>;

export async function syncCollection({
	directus,
	context,
	options,
	info,
	writeEntry,
}: SyncOptions<DirectusCollectionLoaderOptions>): Promise<void> {
	const { store, meta, logger, generateDigest } = context;
	const primaryKey = info.primaryKey ?? DEFAULT_PRIMARY_KEY;
	const idField = options.idField ?? primaryKey;
	const updatedField = getUpdatedField(options, info);

	const query: DirectusQuery = {
		...options.query,
		fields: withFields(options.query?.fields, getRequiredFields(options, info)),
	};

	// A stable order keeps offset pagination from skipping or repeating items. Without a known primary key, Directus
	// falls back to sorting by it anyway.
	if (!query.sort && info.primaryKey) query.sort = [info.primaryKey];

	const pageSize = await getPageSize(directus, options.pageSize ?? DEFAULT_PAGE_SIZE);
	const read = { directus, collection: options.collection, query, pageSize };

	// Option changes that don't touch the content config file (such as env variables) also need a full reload.
	const syncKey = `${__VERSION__}:${generateDigest(getSyncOptions(options))}`;
	const lastUpdated = meta.get(LAST_UPDATED);
	const incremental =
		updatedField !== undefined &&
		meta.get(SYNC_KEY) === syncKey &&
		lastUpdated !== undefined &&
		store.keys().length > 0;

	let items: Item[];
	let removed: number;

	if (incremental) {
		// Every matching id, to drop entries that were deleted or no longer match the filter.
		const current = await readAllItems({ ...read, query: { ...query, fields: [idField] } });
		const ids = toIds(current, idField);

		removed = removeMissing(context, ids);

		// Items don't always get an updated timestamp when created, so unseen ids are read explicitly.
		const unseen = [...ids].filter((id) => !store.has(id));
		const changedFilter = mergeFilters(query.filter, { [updatedField]: { _gte: lastUpdated } });

		const [changed, created] = await Promise.all([
			readAllItems({ ...read, query: { ...query, filter: changedFilter } }),
			readItemsIn({ ...read, field: idField, values: unseen }),
		]);

		items = [...changed, ...created];
	} else {
		items = await readAllItems(read);
		removed = removeMissing(context, toIds(items, idField));
	}

	let updated = 0;

	for (const item of items) {
		const id = toId(item, idField);

		if (id === undefined) {
			logger.warn(`${context.collection}: skipped an item of "${options.collection}" without a "${idField}"`);
			continue;
		}

		if (await writeEntry(id, item)) updated++;
	}

	meta.set(SYNC_KEY, syncKey);

	const newest = updatedField ? getLatest([lastUpdated, ...items.map((item) => item[updatedField])]) : undefined;

	if (newest) meta.set(LAST_UPDATED, newest);
	else meta.delete(LAST_UPDATED);

	logger.info(
		incremental
			? `${context.collection}: synced "${options.collection}", ${updated} updated, ${removed} removed, ${store.keys().length} total`
			: `${context.collection}: loaded ${store.keys().length} entries from "${options.collection}"`,
	);
}

export async function syncSingleton({
	directus,
	context,
	options,
	info,
	writeEntry,
}: SyncOptions<DirectusSingletonLoaderOptions>): Promise<void> {
	const id = options.id ?? options.collection;
	const query = { ...options.query, fields: withFields(options.query?.fields, getRequiredFields(options, info)) };
	const item = await readSingletonItem({ directus, collection: options.collection, query });

	removeMissing(context, new Set([id]));
	await writeEntry(id, item);

	context.logger.info(`${context.collection}: loaded singleton "${options.collection}"`);
}

/** Fields the loader needs on every item, on top of the ones the query selects. */
export function getRequiredFields(options: DirectusLoaderOptions, info: CollectionInfo): string[] {
	const fields: string[] = [];

	if (!options.singleton) {
		const updatedField = getUpdatedField(options, info);

		fields.push(options.idField ?? info.primaryKey ?? DEFAULT_PRIMARY_KEY);

		if (updatedField) fields.push(updatedField);
	}

	if (options.contentField) fields.push(options.contentField);

	return fields;
}

function getUpdatedField(options: DirectusCollectionLoaderOptions, info: CollectionInfo): string | undefined {
	if (options.updatedField === false) return undefined;

	return options.updatedField ?? info.updatedField;
}

function withFields(fields: DirectusQuery['fields'], required: string[]): DirectusQuery['fields'] {
	if (!fields) return undefined;

	return [...fields, ...required.filter((field) => !fields.includes(field))];
}

// The options that shape stored entries. Tokens and Zod schemas are left out: neither changes what is fetched.
function getSyncOptions(options: DirectusLoaderOptions): Record<string, unknown> {
	const { token: _token, fieldSchemas: _fieldSchemas, ...rest } = options;

	return JSON.parse(JSON.stringify(rest));
}

function toId(item: Item, idField: string): string | undefined {
	const value = item[idField];

	return value === undefined || value === null || value === '' ? undefined : String(value);
}

function toIds(items: Item[], idField: string): Set<string> {
	return new Set(items.map((item) => toId(item, idField)).filter((id) => id !== undefined));
}

function removeMissing({ store }: LoaderContext, ids: Set<string>): number {
	const missing = store.keys().filter((key) => !ids.has(key));

	for (const key of missing) store.delete(key);

	return missing.length;
}

// Compares as dates, since Directus formats timestamps differently per database.
function getLatest(values: unknown[]): string | undefined {
	let latest: string | undefined;

	for (const value of values) {
		if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) continue;
		if (latest === undefined || Date.parse(value) > Date.parse(latest)) latest = value;
	}

	return latest;
}

export function createEntryWriter(
	{ store, parseData, generateDigest, renderMarkdown }: LoaderContext,
	{ url, collection, assets, contentField, contentFormat }: DirectusLoaderOptions,
	info: CollectionInfo,
): WriteEntry {
	const format = contentFormat ?? info.fields.find((field) => field.name === contentField)?.contentFormat ?? 'markdown';

	const toData = (item: Item): Item => {
		if (assets === false) return item;

		const data = resolveFileFields(item, info.fields, url, assets?.query);

		// Entries of `directus_files` are files themselves.
		return collection === FILES_COLLECTION ? (resolveFile(data, url, assets?.query) as Item) : data;
	};

	return async (id, item) => {
		const data = toData(item);
		const digest = generateDigest(data);

		if (store.get(id)?.digest === digest) return false;

		const content = contentField ? data[contentField] : undefined;
		const body = typeof content === 'string' && content.length > 0 ? content : undefined;
		const rendered = body === undefined ? undefined : format === 'html' ? { html: body } : await renderMarkdown(body);

		return store.set({
			id,
			data: await parseData({ id, data }),
			digest,
			...(body !== undefined && { body }),
			...(rendered && { rendered }),
		});
	};
}
