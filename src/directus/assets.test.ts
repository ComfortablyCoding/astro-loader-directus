import { expect, test } from 'vitest';
import { getAssetUrl, resolveFile, resolveFileFields } from './assets.js';
import type { FieldInfo } from './collection.js';

const URL = 'https://cms.example.com';
const ID = '0e3c3f0e-0b6c-4d5e-9b1a-1a2b3c4d5e6f';

test.each([
	['a plain asset', URL, undefined, `${URL}/assets/${ID}`],
	['a trailing slash', `${URL}/`, undefined, `${URL}/assets/${ID}`],
	['a path prefix', `${URL}/cms`, undefined, `${URL}/cms/assets/${ID}`],
	['a preset key', URL, { key: 'thumb' }, `${URL}/assets/${ID}?key=thumb`],
	['transforms', URL, { width: 100, format: 'webp' as const }, `${URL}/assets/${ID}?width=100&format=webp`],
	[
		'advanced transforms as JSON',
		URL,
		{ transforms: [['blur', 2]] as [string, ...unknown[]][] },
		`${URL}/assets/${ID}?transforms=%5B%5B%22blur%22%2C2%5D%5D`,
	],
])('builds the url of %s', (_label, baseUrl, query, expected) => {
	expect(getAssetUrl(baseUrl, ID, query)).toBe(expected);
});

test('resolves a file id to its url', () => {
	expect(resolveFile(ID, URL)).toBe(`${URL}/assets/${ID}`);
});

test('adds a src url to an expanded file', () => {
	expect(resolveFile({ id: ID, title: 'Cover' }, URL)).toEqual({ id: ID, title: 'Cover', src: `${URL}/assets/${ID}` });
});

test.each([[null], [undefined], [42], [{ title: 'no id' }]])('leaves %j untouched', (value) => {
	expect(resolveFile(value, URL)).toEqual(value);
});

test('resolves file fields and files junctions, and leaves other fields alone', () => {
	const fields: FieldInfo[] = [
		{ name: 'title', type: 'string', kind: 'value', nullable: true },
		{ name: 'cover', type: 'uuid', kind: 'file', nullable: true },
		{ name: 'gallery', type: 'alias', kind: 'files', nullable: false, junctionField: 'file_id' },
		{ name: 'author', type: 'integer', kind: 'relation', nullable: true },
	];

	const item = {
		title: ID,
		cover: ID,
		gallery: [{ id: 1, file_id: ID }, { id: 2, file_id: { id: ID } }, 3],
		author: ID,
	};

	expect(resolveFileFields(item, fields, URL)).toEqual({
		title: ID,
		cover: `${URL}/assets/${ID}`,
		gallery: [{ id: 1, file_id: `${URL}/assets/${ID}` }, { id: 2, file_id: { id: ID, src: `${URL}/assets/${ID}` } }, 3],
		author: ID,
	});
});

test('skips file fields that were not selected', () => {
	const fields: FieldInfo[] = [{ name: 'cover', type: 'uuid', kind: 'file', nullable: true }];

	expect(resolveFileFields({ title: 'Hello' }, fields, URL)).toEqual({ title: 'Hello' });
});
