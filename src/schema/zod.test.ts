import { z } from 'astro/zod';
import { expect, test } from 'vitest';
import type { FieldInfo } from '../directus/collection.js';
import { generateSchema } from './zod.js';

function value(name: string, type: string, nullable = false): FieldInfo {
	return { name, type, kind: 'value', nullable };
}

function parse(fields: FieldInfo[], data: unknown, options: Partial<Parameters<typeof generateSchema>[1]> = {}) {
	return generateSchema(fields, { assets: true, ...options }).schema.parse(data);
}

test.each([
	['string', 'hello', 'hello'],
	['text', 'long', 'long'],
	['uuid', '0e3c3f0e-0b6c-4d5e-9b1a-1a2b3c4d5e6f', '0e3c3f0e-0b6c-4d5e-9b1a-1a2b3c4d5e6f'],
	['hash', '$argon2id$x', '$argon2id$x'],
	['date', '2026-10-09', '2026-10-09'],
	['time', '13:45:00', '13:45:00'],
	['dateTime', '2026-10-09T13:45:00', '2026-10-09T13:45:00'],
	['integer', 42, 42],
	['float', 1.5, 1.5],
	['bigInteger', '9007199254740993', '9007199254740993'],
	['decimal', 12.345, 12.345],
	['boolean', true, true],
	['boolean', 0, false],
	['boolean', 1, true],
	['timestamp', '2026-10-09T13:45:00.000Z', new Date('2026-10-09T13:45:00.000Z')],
	['csv', ['a', 'b'], ['a', 'b']],
	['csv', 'a,b', ['a', 'b']],
	['csv', '', []],
	['json', { nested: [1] }, { nested: [1] }],
	['geometry.Point', { type: 'Point', coordinates: [1, 2] }, { type: 'Point', coordinates: [1, 2] }],
])('parses a %s value of %j', (type, input, output) => {
	expect(parse([value('field', type)], { field: input })).toEqual({ field: output });
});

test.each([
	['integer', 'nope'],
	['boolean', 'yes'],
	['string', 42],
])('rejects a %s value of %j', (type, input) => {
	expect(() => parse([value('field', type)], { field: input })).toThrow(z.ZodError);
});

test('accepts null only for nullable fields', () => {
	expect(parse([value('title', 'string', true)], { title: null })).toEqual({ title: null });
	expect(() => parse([value('title', 'string')], { title: null })).toThrow(z.ZodError);
});

test('accepts ids or objects for relations', () => {
	const fields: FieldInfo[] = [
		{ name: 'author', type: 'integer', kind: 'relation', nullable: true },
		{ name: 'tags', type: 'alias', kind: 'relations', nullable: false },
	];

	expect(parse(fields, { author: 1, tags: [1, 'two', { id: 3 }] })).toEqual({ author: 1, tags: [1, 'two', { id: 3 }] });
	expect(parse(fields, { author: { id: 1, name: 'Ada' }, tags: [] })).toEqual({
		author: { id: 1, name: 'Ada' },
		tags: [],
	});
});

test('expects asset urls or files with a src for file fields', () => {
	const fields: FieldInfo[] = [{ name: 'cover', type: 'uuid', kind: 'file', nullable: true }];

	expect(parse(fields, { cover: 'https://cms.example.com/assets/1' })).toEqual({
		cover: 'https://cms.example.com/assets/1',
	});
	expect(parse(fields, { cover: { id: '1', src: 'url', title: 'Cover' } })).toEqual({
		cover: { id: '1', src: 'url', title: 'Cover' },
	});
	expect(() => parse(fields, { cover: { id: '1' } })).toThrow(z.ZodError);
	expect(parse(fields, { cover: { id: '1' } }, { assets: false })).toEqual({ cover: { id: '1' } });
});

test('keeps only the selected fields, plus the required ones', () => {
	const { schema } = generateSchema([value('id', 'integer'), value('title', 'string'), value('body', 'text')], {
		assets: true,
		query: { fields: ['title', 'author.name'] },
		requiredFields: ['id'],
	});

	expect(Object.keys((schema as z.ZodObject).shape)).toEqual(['id', 'title']);
});

test('keeps every field for a wildcard', () => {
	const { schema } = generateSchema([value('id', 'integer'), value('title', 'string')], {
		assets: true,
		query: { fields: ['*', 'author.*'] },
	});

	expect(Object.keys((schema as z.ZodObject).shape)).toEqual(['id', 'title']);
});

test('adds aliases as unknown values', () => {
	expect(
		parse([value('id', 'integer')], { id: 1, headline: 'Hello' }, { query: { alias: { headline: 'title' } } }),
	).toEqual({
		id: 1,
		headline: 'Hello',
	});
});

test('uses field schemas over the generated ones', () => {
	const fieldSchemas = { tags: z.array(z.string()), rating: z.coerce.number() };

	expect(
		parse([value('tags', 'json'), value('rating', 'decimal')], { tags: ['a'], rating: '4.50' }, { fieldSchemas }),
	).toEqual({
		tags: ['a'],
		rating: 4.5,
	});
	expect(() => parse([value('tags', 'json')], { tags: [1] }, { fieldSchemas })).toThrow(z.ZodError);
});

test('accepts any field when loose, still applying field schemas', () => {
	const data = parse(
		[],
		{ id: 1, title: 'Hello', rating: '4.50' },
		{ loose: true, fieldSchemas: { rating: z.coerce.number() } },
	);

	expect(data).toEqual({ id: 1, title: 'Hello', rating: 4.5 });
});

test('strips unknown fields when not loose', () => {
	expect(parse([value('id', 'integer')], { id: 1, extra: true })).toEqual({ id: 1 });
});

test('adds a src for directus_files entries', () => {
	expect(parse([value('id', 'uuid')], { id: '1', src: 'url' }, { fileSource: true })).toEqual({ id: '1', src: 'url' });
});

test('generates the matching Entry type', () => {
	const fields: FieldInfo[] = [
		value('id', 'integer'),
		value('title', 'string', true),
		value('date_updated', 'timestamp', true),
		value('tags', 'csv'),
		{ name: 'cover', type: 'uuid', kind: 'file', nullable: true },
		{ name: 'author', type: 'integer', kind: 'relation', nullable: true },
		{ name: 'gallery', type: 'alias', kind: 'files', nullable: false },
	];

	expect(generateSchema(fields, { assets: true }).types).toBe(
		'export type Entry = { "id": number; "title": string | null; "date_updated": Date | null; "tags": Array<string>; ' +
			'"cover": string | { "src": string; [key: string]: unknown; } | null; ' +
			'"author": string | number | { [key: string]: unknown; } | null; ' +
			'"gallery": Array<string | number | { [key: string]: unknown; }>; };\n',
	);
});

test('generates an open Entry type when loose', () => {
	expect(generateSchema([], { assets: true, loose: true }).types).toBe(
		'export type Entry = { [key: string]: unknown; };\n',
	);
});
