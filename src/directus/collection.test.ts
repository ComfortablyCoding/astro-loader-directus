import type { DirectusField, DirectusRelation } from '@directus/sdk';
import { expect, test } from 'vitest';
import { type Directus, DirectusLoaderError } from './client.js';
import { UNKNOWN_COLLECTION, describeCollection, readCollectionInfo } from './collection.js';

function field(name: string, type: string, meta: Partial<DirectusField['meta']> = {}, schema = {}): DirectusField {
	return {
		collection: 'posts',
		field: name,
		type,
		meta: { special: null, interface: null, ...meta },
		schema: type === 'alias' ? null : { is_nullable: true, is_primary_key: false, ...schema },
	} as DirectusField;
}

function relation(collection: string, name: string, related: string | null, meta = {}): DirectusRelation {
	return {
		collection,
		field: name,
		related_collection: related,
		meta: { junction_field: null, ...meta },
	} as DirectusRelation;
}

test('finds the primary key and the date-updated field', () => {
	const info = describeCollection(
		'posts',
		[
			field('slug', 'string', {}, { is_primary_key: true, is_nullable: false }),
			field('date_updated', 'timestamp', { special: ['date-updated'] }),
		],
		[],
	);

	expect(info.primaryKey).toBe('slug');
	expect(info.updatedField).toBe('date_updated');
	expect(info.fields.map(({ name, nullable }) => [name, nullable])).toEqual([
		['slug', false],
		['date_updated', true],
	]);
});

test.each([
	['a column', field('title', 'string'), [], 'value'],
	['an m2o special', field('author', 'integer', { special: ['m2o'] }), [], 'relation'],
	['an m2o without a special', field('author', 'integer'), [relation('posts', 'author', 'authors')], 'relation'],
	['a file special', field('cover', 'uuid', { special: ['file'] }), [], 'file'],
	['an m2o to directus_files', field('cover', 'uuid'), [relation('posts', 'cover', 'directus_files')], 'file'],
	['an o2m', field('comments', 'alias', { special: ['o2m'] }), [], 'relations'],
	['an m2m', field('tags', 'alias', { special: ['m2m'] }), [], 'relations'],
	['an m2a', field('blocks', 'alias', { special: ['m2a'] }), [], 'relations'],
	['translations', field('translations', 'alias', { special: ['translations'] }), [], 'relations'],
	['a files special', field('gallery', 'alias', { special: ['files'] }), [], 'files'],
	[
		'an m2m to directus_files without the special',
		field('gallery', 'alias', { special: ['m2m'] }),
		[
			relation('posts_files', 'posts_id', 'posts', {
				one_collection: 'posts',
				one_field: 'gallery',
				junction_field: 'file',
			}),
			relation('posts_files', 'file', 'directus_files'),
		],
		'files',
	],
])('classifies %s', (_label, input, relations, kind) => {
	expect(describeCollection('posts', [input], relations).fields[0]?.kind).toBe(kind);
});

test.each([
	['a divider', field('divider', 'alias', { special: ['alias', 'no-data'] })],
	['a group', field('group', 'alias', { special: ['alias', 'no-data', 'group'] })],
	['a notice without specials', field('notice', 'alias')],
])('skips %s', (_label, input) => {
	expect(describeCollection('posts', [input], []).fields).toEqual([]);
});

test('reads the junction field of a files alias', () => {
	const info = describeCollection(
		'posts',
		[field('gallery', 'alias', { special: ['files'] })],
		[
			relation('posts_files', 'posts_id', 'posts', {
				one_collection: 'posts',
				one_field: 'gallery',
				junction_field: 'file',
			}),
		],
	);

	expect(info.fields[0]?.junctionField).toBe('file');
});

test('defaults the junction field of a files alias', () => {
	expect(
		describeCollection('posts', [field('gallery', 'alias', { special: ['files'] })], []).fields[0]?.junctionField,
	).toBe('directus_files_id');
});

test.each([
	['input-rich-text-md', 'markdown'],
	['input-rich-text-html', 'html'],
	['input-multiline', undefined],
])('detects the content format of %s', (fieldInterface, format) => {
	expect(
		describeCollection('posts', [field('body', 'text', { interface: fieldInterface })], []).fields[0]?.contentFormat,
	).toBe(format);
});

function fakeDirectus(handle: (path: string) => unknown): Directus {
	return {
		url: 'https://cms.example.com',
		request: async (command) => handle((command() as { path: string }).path) as never,
	};
}

test('falls back to an unknown collection when the fields are forbidden', async () => {
	const directus = fakeDirectus(() => {
		throw new DirectusLoaderError('denied', { code: 'FORBIDDEN', status: 403 });
	});

	expect(await readCollectionInfo(directus, 'posts')).toBe(UNKNOWN_COLLECTION);
});

test('fails on other errors reading the fields', async () => {
	const directus = fakeDirectus(() => {
		throw new DirectusLoaderError('unreachable', { code: 'NETWORK' });
	});

	await expect(readCollectionInfo(directus, 'posts')).rejects.toThrow('unreachable');
});

test('works without access to relations', async () => {
	const directus = fakeDirectus((path) => {
		if (path === '/relations') throw new DirectusLoaderError('denied', { code: 'FORBIDDEN', status: 403 });

		return [field('cover', 'uuid', { special: ['file'] })];
	});

	expect((await readCollectionInfo(directus, 'posts')).fields[0]?.kind).toBe('file');
});
