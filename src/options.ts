// Public options for `directusLoader()`.
import type { AssetsQuery, Query } from '@directus/sdk';
import type { z } from 'astro/zod';

/** An untyped Directus query, as sent to `/items/:collection`. */
export type DirectusQuery = Query<any, any>;

/** Format of the field rendered as the entry's content. */
export type DirectusContentFormat = 'markdown' | 'html';

export interface DirectusAssetsOptions {
	/** Appended to every asset URL: a preset `key`, or transforms such as `width`, `format` and `quality`. */
	query?: AssetsQuery | undefined;
}

interface DirectusLoaderBaseOptions {
	/** Base URL of the Directus instance, e.g. `https://cms.example.com`. */
	url: string;
	/** Static access token. Falls back to `DIRECTUS_TOKEN`. Entries are limited to what its policies can read. */
	token?: string | undefined;
	/** Directus collection to load. System collections such as `directus_files` are read from their own endpoints. */
	collection: string;
	/** Field rendered as the entry's content, so `render(entry)` works. */
	contentField?: string | undefined;
	/** Format of `contentField`. Detected from the field's interface, then defaults to `markdown`. */
	contentFormat?: DirectusContentFormat | undefined;
	/** File ids become asset URLs, and expanded files get a `src` URL. `false` leaves file fields untouched. */
	assets?: DirectusAssetsOptions | false | undefined;
	/** Zod schemas for specific fields of the generated schema, e.g. to type JSON fields. */
	fieldSchemas?: Record<string, z.ZodType> | undefined;
}

export interface DirectusCollectionLoaderOptions extends DirectusLoaderBaseOptions {
	singleton?: false | undefined;
	/** Fields, filter, search, sort, deep and alias. Pagination is handled by the loader. */
	query?: Omit<DirectusQuery, 'limit' | 'offset' | 'page'> | undefined;
	/** Field used as the entry id, e.g. `slug`. Defaults to the primary key. */
	idField?: string | undefined;
	/** Items requested per page. Defaults to `100`. */
	pageSize?: number | undefined;
	/** Timestamp field for incremental sync. Detected from the "Date Updated" special; `false` always reloads. */
	updatedField?: string | false | undefined;
}

export interface DirectusSingletonLoaderOptions extends DirectusLoaderBaseOptions {
	singleton: true;
	/** Fields, deep and alias. */
	query?: Pick<DirectusQuery, 'fields' | 'deep' | 'alias'> | undefined;
	/** Id of the single entry. Defaults to the collection name. */
	id?: string | undefined;
}

export type DirectusLoaderOptions = DirectusCollectionLoaderOptions | DirectusSingletonLoaderOptions;
