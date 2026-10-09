// Generates a Zod schema and matching `Entry` type from a collection's fields, for Astro's `createSchema()`.
import { z } from 'astro/zod';
import type { FieldInfo } from '../directus/collection.js';
import type { DirectusQuery } from '../options.js';
import { toTypeScript } from './typescript.js';

export interface SchemaOptions {
	/** Limits the fields to the ones selected, and adds aliases. */
	query?: Pick<DirectusQuery, 'fields' | 'alias'> | undefined;
	/** Fields the loader always requests, even when `query.fields` leaves them out. */
	requiredFields?: string[] | undefined;
	/** Whether file fields are resolved to asset URLs. */
	assets: boolean;
	fieldSchemas?: Record<string, z.ZodType> | undefined;
	/** Allows fields that aren't described, for when the collection's fields can't be read. */
	loose?: boolean | undefined;
	/** Adds a `src` asset URL, for entries of `directus_files` itself. */
	fileSource?: boolean | undefined;
}

export interface GeneratedSchema {
	schema: z.ZodType;
	/** TypeScript source exporting the `Entry` type. */
	types: string;
}

const relatedItem = z.union([z.string(), z.number(), z.record(z.string(), z.unknown())]);

export function generateSchema(
	fields: FieldInfo[],
	{ query, requiredFields, assets, fieldSchemas, loose, fileSource }: SchemaOptions,
): GeneratedSchema {
	const selected = getSelectedFields(query?.fields, requiredFields);
	const shape: Record<string, z.ZodType> = {};

	for (const field of fields) {
		if (selected && !selected.has(field.name)) continue;

		shape[field.name] = fieldSchemas?.[field.name] ?? getFieldSchema(field, assets);
	}

	for (const alias of Object.keys(query?.alias ?? {})) {
		shape[alias] = fieldSchemas?.[alias] ?? z.unknown();
	}

	if (fileSource) shape['src'] = z.string();

	// Without field metadata, overrides still apply to the fields they name.
	if (loose) {
		for (const [name, schema] of Object.entries(fieldSchemas ?? {})) shape[name] ??= schema;
	}

	const schema = loose ? z.looseObject(shape) : z.object(shape);

	return { schema, types: `export type Entry = ${toTypeScript(schema)};\n` };
}

function getFieldSchema(field: FieldInfo, assets: boolean): z.ZodType {
	const schema = getBaseSchema(field, assets);

	return field.nullable ? schema.nullable() : schema;
}

function getBaseSchema({ kind, type }: FieldInfo, assets: boolean): z.ZodType {
	switch (kind) {
		case 'file': {
			return assets ? z.union([z.string(), z.looseObject({ src: z.string() })]) : relatedItem;
		}

		case 'relation': {
			return relatedItem;
		}

		case 'files':
		case 'relations': {
			return z.array(relatedItem);
		}

		case 'value': {
			return getValueSchema(type);
		}
	}
}

function getValueSchema(type: string): z.ZodType {
	switch (type) {
		case 'string':
		case 'text':
		case 'uuid':
		case 'hash':
		// Dates and times without a timezone stay strings, so they don't shift with the build machine's timezone.
		case 'date':
		case 'time':
		case 'dateTime': {
			return z.string();
		}

		case 'integer':
		case 'float': {
			return z.number();
		}

		// Some databases return these as strings to keep their precision.
		case 'bigInteger':
		case 'decimal': {
			return z.union([z.number(), z.string()]);
		}

		// SQLite returns 0 or 1 unless the field has the "cast-boolean" special.
		case 'boolean': {
			return z.preprocess((value) => (typeof value === 'number' ? value !== 0 : value), z.boolean());
		}

		case 'timestamp': {
			return z.coerce.date();
		}

		// A comma-separated string unless the field has the "cast-csv" special.
		case 'csv': {
			return z.preprocess(
				(value) => (typeof value === 'string' ? (value === '' ? [] : value.split(',')) : value),
				z.array(z.string()),
			);
		}

		default: {
			return z.unknown();
		}
	}
}

// Top-level names selected by a `fields` query, or `undefined` when a wildcard selects them all.
function getSelectedFields(fields: DirectusQuery['fields'], requiredFields: string[] = []): Set<string> | undefined {
	if (!fields) return undefined;

	const names = new Set(requiredFields);

	for (const field of fields) {
		for (const key of typeof field === 'string' ? [field] : Object.keys(field)) {
			const name = key.split('.')[0]!;

			if (name === '*') return undefined;

			names.add(name);
		}
	}

	return names;
}
