// Reads a collection's fields and relations, and classifies each field by the shape of its value.
import { type DirectusField, type DirectusRelation, readFieldsByCollection, readRelations } from '@directus/sdk';
import type { DirectusContentFormat } from '../options.js';
import { FILES_COLLECTION } from './assets.js';
import { type Directus, DirectusLoaderError } from './client.js';

export type FieldKind =
	/** A regular column. */
	| 'value'
	/** Many-to-one: an id, or an object when expanded. */
	| 'relation'
	/** One-to-many, many-to-many, many-to-any or translations: an array of ids or objects. */
	| 'relations'
	/** Many-to-one to `directus_files`. */
	| 'file'
	/** Many-to-many to `directus_files`, through a junction collection. */
	| 'files';

export interface FieldInfo {
	name: string;
	/** Directus field type, e.g. `string`, `integer`, `timestamp`, `json` or `alias`. */
	type: string;
	kind: FieldKind;
	nullable: boolean;
	/** For `files` fields, the junction field that points at `directus_files`. */
	junctionField?: string | undefined;
	/** Content format implied by the field's interface. */
	contentFormat?: DirectusContentFormat | undefined;
}

export interface CollectionInfo {
	/** Whether the fields could be read. Without them the loader falls back to defaults and a loose schema. */
	introspected: boolean;
	fields: FieldInfo[];
	primaryKey: string | undefined;
	/** The field with the "Date Updated" special. */
	updatedField: string | undefined;
}

const RELATIONAL_SPECIALS = ['o2m', 'm2m', 'm2a', 'translations', 'files'];
const DEFAULT_JUNCTION_FIELD = 'directus_files_id';

export const UNKNOWN_COLLECTION: CollectionInfo = {
	introspected: false,
	fields: [],
	primaryKey: undefined,
	updatedField: undefined,
};

/**
 * Tokens without read access to `directus_fields` (without app access, for example) get `UNKNOWN_COLLECTION` rather
 * than an error, since they may still read the items themselves.
 */
export async function readCollectionInfo(directus: Directus, collection: string): Promise<CollectionInfo> {
	const [fields, relations] = await Promise.all([
		directus
			.request(readFieldsByCollection(collection), `read the fields of "${collection}"`)
			.catch((error: unknown) => {
				if (error instanceof DirectusLoaderError && error.code === 'FORBIDDEN') return undefined;
				throw error;
			}),
		// Relations only refine file detection, so tokens that can't read them still work.
		directus.request(readRelations(), 'read relations').catch(() => []),
	]);

	if (!fields) return UNKNOWN_COLLECTION;

	return describeCollection(collection, fields as DirectusField[], relations as DirectusRelation[]);
}

export function describeCollection(
	collection: string,
	fields: DirectusField[],
	relations: DirectusRelation[],
): CollectionInfo {
	const info: CollectionInfo = { introspected: true, fields: [], primaryKey: undefined, updatedField: undefined };

	for (const field of fields) {
		const special = field.meta?.special ?? [];

		if (field.schema?.is_primary_key) info.primaryKey = field.field;
		if (special.includes('date-updated')) info.updatedField ??= field.field;

		const kind = getFieldKind(collection, field, special, relations);

		if (!kind) continue;

		info.fields.push({
			name: field.field,
			type: field.type,
			kind,
			// Alias fields have no column; Directus always returns an array for them.
			nullable: kind === 'relations' || kind === 'files' ? false : (field.schema?.is_nullable ?? true),
			junctionField: kind === 'files' ? getJunctionField(collection, field.field, relations) : undefined,
			contentFormat: getContentFormat(field.meta?.interface ?? null),
		});
	}

	return info;
}

// Presentation fields (dividers, notices, groups) hold no data and are skipped.
function getFieldKind(
	collection: string,
	field: DirectusField,
	special: string[],
	relations: DirectusRelation[],
): FieldKind | undefined {
	if (special.includes('no-data') || special.includes('group')) return undefined;

	if (field.type === 'alias') {
		if (!special.some((value) => RELATIONAL_SPECIALS.includes(value))) return undefined;

		return special.includes('files') || isFilesJunction(collection, field.field, relations) ? 'files' : 'relations';
	}

	const relation = relations.find((r) => r.collection === collection && r.field === field.field);

	if (special.includes('file') || relation?.related_collection === FILES_COLLECTION) return 'file';
	if (special.includes('m2o') || relation?.related_collection) return 'relation';

	return 'value';
}

// A many-to-many field created without the "files" special still points at `directus_files` through its junction.
function isFilesJunction(collection: string, field: string, relations: DirectusRelation[]): boolean {
	const junction = findJunction(collection, field, relations);

	if (!junction?.meta?.junction_field) return false;

	const other = relations.find(
		(r) => r.collection === junction.collection && r.field === junction.meta?.junction_field,
	);

	return other?.related_collection === FILES_COLLECTION;
}

function getJunctionField(collection: string, field: string, relations: DirectusRelation[]): string {
	return findJunction(collection, field, relations)?.meta?.junction_field ?? DEFAULT_JUNCTION_FIELD;
}

function findJunction(collection: string, field: string, relations: DirectusRelation[]): DirectusRelation | undefined {
	return relations.find((r) => r.meta?.one_collection === collection && r.meta?.one_field === field);
}

function getContentFormat(fieldInterface: string | null): DirectusContentFormat | undefined {
	if (fieldInterface === 'input-rich-text-md') return 'markdown';
	if (fieldInterface === 'input-rich-text-html') return 'html';

	return undefined;
}
