import type { LoaderContext } from 'astro/loaders';
import { afterEach, expect, test, vi } from 'vitest';
import type { DirectusLoaderOptions } from './options.js';
import { directusLoader } from './loader.js';

type Item = Record<string, unknown>;

interface FakeCollection {
	fields: Record<string, unknown>[];
	items: Item[];
	singleton?: boolean;
}

const URL = 'https://cms.example.com';

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

function field(
	name: string,
	type: string,
	{ special = null as string[] | null, primary = false, iface = null as string | null } = {},
) {
	return {
		field: name,
		type,
		meta: { special, interface: iface },
		schema: type === 'alias' ? null : { is_primary_key: primary, is_nullable: !primary },
	};
}

const POST_FIELDS = [
	field('id', 'integer', { primary: true }),
	field('status', 'string'),
	field('slug', 'string'),
	field('body', 'text', { iface: 'input-rich-text-md' }),
	field('cover', 'uuid', { special: ['file'] }),
	field('date_updated', 'timestamp', { special: ['date-updated'] }),
];

function post(id: number, extra: Item = {}): Item {
	return {
		id,
		status: 'published',
		slug: `post-${id}`,
		body: `# Post ${id}`,
		cover: null,
		date_updated: null,
		...extra,
	};
}

// Evaluates the filters the loader builds.
function matches(item: Item, filter: Record<string, any> | undefined): boolean {
	if (!filter) return true;
	if (filter['_and']) return filter['_and'].every((part: Record<string, any>) => matches(item, part));

	return Object.entries(filter).every(([name, condition]) =>
		Object.entries(condition as Record<string, unknown>).every(([operator, expected]) => {
			const actual = item[name];

			if (operator === '_eq') return actual === expected;
			if (operator === '_in') return (expected as unknown[]).map(String).includes(String(actual));
			if (operator === '_gte') return typeof actual === 'string' && Date.parse(actual) >= Date.parse(String(expected));

			throw new Error(`Unsupported operator ${operator}`);
		}),
	);
}

function respond(status: number, body: unknown): Response {
	return Response.json(body, { status });
}

function forbidden(): Response {
	return respond(403, { errors: [{ message: 'Forbidden.', extensions: { code: 'FORBIDDEN' } }] });
}

// An in-memory Directus behind `fetch`, serving fields, relations, server info and items.
function setup(collections: Record<string, FakeCollection>, { queryLimitMax = -1, forbidFields = false } = {}) {
	const requests: { path: string; params: URLSearchParams; token: string | undefined }[] = [];

	const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
		const url = new globalThis.URL(String(input));
		const headers = (init?.headers ?? {}) as Record<string, string>;
		const path = url.pathname;

		requests.push({ path, params: url.searchParams, token: headers['Authorization']?.replace('Bearer ', '') });

		if (path === '/server/info') return respond(200, { data: { queryLimit: { default: 100, max: queryLimitMax } } });
		if (path === '/relations') return respond(200, { data: [] });

		if (path.startsWith('/fields/')) {
			const collection = collections[path.slice('/fields/'.length)];

			if (forbidFields || !collection) return forbidden();

			return respond(200, { data: collection.fields });
		}

		const name = path.startsWith('/items/') ? path.slice('/items/'.length) : `directus_${path.slice(1)}`;
		const collection = collections[name];

		if (!collection) return forbidden();
		if (collection.singleton) return respond(200, { data: collection.items[0] });

		const limit = Number(url.searchParams.get('limit'));
		const offset = Number(url.searchParams.get('offset'));

		if (queryLimitMax > 0 && limit > queryLimitMax) {
			return respond(400, { errors: [{ message: 'Invalid query.', extensions: { code: 'INVALID_QUERY' } }] });
		}

		const filter = url.searchParams.get('filter');
		const fields = url.searchParams.get('fields')?.split(',');
		const sort = url.searchParams.get('sort');

		let items = collection.items.filter((item) => matches(item, filter ? JSON.parse(filter) : undefined));

		if (sort) {
			items = items.toSorted((a, b) => String(a[sort]).localeCompare(String(b[sort]), undefined, { numeric: true }));
		}

		if (fields && !fields.includes('*')) {
			items = items.map((item) =>
				Object.fromEntries(fields.filter((key) => key in item).map((key) => [key, item[key]])),
			);
		}

		return respond(200, { data: items.slice(offset, offset + limit) });
	});

	vi.stubGlobal('fetch', fetch);

	return { requests };
}

function createContext(collection = 'posts') {
	const entries = new Map<string, any>();
	const meta = new Map<string, string>();
	const logs: string[] = [];

	const context = {
		collection,
		store: {
			get: (id: string) => entries.get(id),
			set: (entry: { id: string }) => (entries.set(entry.id, entry), true),
			delete: (id: string) => entries.delete(id),
			has: (id: string) => entries.has(id),
			keys: () => [...entries.keys()],
		},
		meta: {
			get: (key: string) => meta.get(key),
			set: (key: string, value: string) => meta.set(key, value),
			has: (key: string) => meta.has(key),
			delete: (key: string) => meta.delete(key),
		},
		logger: { info: (message: string) => logs.push(message), warn: (message: string) => logs.push(`warn: ${message}`) },
		parseData: async ({ data }: { data: unknown }) => data,
		renderMarkdown: async (markdown: string) => ({ html: `<md>${markdown}</md>` }),
		generateDigest: (data: unknown) => JSON.stringify(data),
	} as unknown as LoaderContext;

	return { context, entries, logs };
}

async function load(options: Partial<DirectusLoaderOptions> & { collection: string }, context: LoaderContext) {
	await directusLoader({ url: URL, token: 'secret', ...options } as DirectusLoaderOptions).load(context);
}

test('loads every item keyed by the primary key', async () => {
	setup({ posts: { fields: POST_FIELDS, items: [post(1), post(2), post(3)] } });
	const { context, entries, logs } = createContext();

	await load({ collection: 'posts' }, context);

	expect([...entries.keys()]).toEqual(['1', '2', '3']);
	expect(entries.get('1').data).toEqual(post(1));
	expect(logs).toEqual(['posts: loaded 3 entries from "posts"']);
});

test('uses idField and the query filter', async () => {
	const { requests } = setup({ posts: { fields: POST_FIELDS, items: [post(1), post(2, { status: 'draft' })] } });
	const { context, entries } = createContext();

	await load({ collection: 'posts', idField: 'slug', query: { filter: { status: { _eq: 'published' } } } }, context);

	expect([...entries.keys()]).toEqual(['post-1']);
	expect(requests.find(({ path }) => path === '/items/posts')?.params.get('sort')).toBe('id');
});

test('adds the fields it needs to a fields query', async () => {
	const { requests } = setup({ posts: { fields: POST_FIELDS, items: [post(1)] } });
	const { context, entries } = createContext();

	await load({ collection: 'posts', idField: 'slug', contentField: 'body', query: { fields: ['status'] } }, context);

	expect(requests.find(({ path }) => path === '/items/posts')?.params.get('fields')).toBe(
		'status,slug,date_updated,body',
	);
	expect(entries.get('post-1').data).toEqual({
		status: 'published',
		slug: 'post-1',
		date_updated: null,
		body: '# Post 1',
	});
});

test('resolves file fields to asset urls', async () => {
	setup({ posts: { fields: POST_FIELDS, items: [post(1, { cover: 'abc' })] } });
	const { context, entries } = createContext();

	await load({ collection: 'posts', assets: { query: { width: 100 } } }, context);

	expect(entries.get('1').data.cover).toBe(`${URL}/assets/abc?width=100`);
});

test('leaves file fields alone when assets are off', async () => {
	setup({ posts: { fields: POST_FIELDS, items: [post(1, { cover: 'abc' })] } });
	const { context, entries } = createContext();

	await load({ collection: 'posts', assets: false }, context);

	expect(entries.get('1').data.cover).toBe('abc');
});

test.each([
	['markdown detected from the interface', undefined, { html: '<md># Post 1</md>' }],
	['html when set', 'html' as const, { html: '# Post 1' }],
])('renders the content field as %s', async (_label, contentFormat, rendered) => {
	setup({ posts: { fields: POST_FIELDS, items: [post(1)] } });
	const { context, entries } = createContext();

	await load({ collection: 'posts', contentField: 'body', contentFormat }, context);

	expect(entries.get('1')).toMatchObject({ body: '# Post 1', rendered });
});

test('skips items without an id', async () => {
	setup({ posts: { fields: POST_FIELDS, items: [post(1), post(2, { slug: null })] } });
	const { context, entries, logs } = createContext();

	await load({ collection: 'posts', idField: 'slug' }, context);

	expect([...entries.keys()]).toEqual(['post-1']);
	expect(logs).toContain('warn: posts: skipped an item of "posts" without a "slug"');
});

test('syncs only what changed since the last sync', async () => {
	const items = [
		post(1, { date_updated: '2026-10-01T00:00:00.000Z' }),
		post(2, { date_updated: '2026-10-02T00:00:00.000Z' }),
		post(3),
		post(4),
	];
	const { requests } = setup({ posts: { fields: POST_FIELDS, items } });
	const { context, entries, logs } = createContext();
	const options = { collection: 'posts', query: { filter: { status: { _eq: 'published' } } } };

	await load(options, context);
	await load(options, context);

	expect(logs).toEqual([
		'posts: loaded 4 entries from "posts"',
		'posts: synced "posts", 0 updated, 0 removed, 4 total',
	]);

	// Updated, created without a timestamp, deleted, and dropped by the filter.
	items[0] = post(1, { body: 'Edited', date_updated: '2026-10-05T00:00:00.000Z' });
	items.push(post(5));
	items.splice(2, 1);
	items[2] = post(4, { status: 'draft' });
	requests.length = 0;

	await load(options, context);

	expect(logs.at(-1)).toBe('posts: synced "posts", 2 updated, 2 removed, 3 total');
	expect([...entries.keys()].toSorted()).toEqual(['1', '2', '5']);
	expect(entries.get('1').data.body).toBe('Edited');
	expect(requests.some(({ params }) => params.get('filter')?.includes('"_gte":"2026-10-02T00:00:00.000Z"'))).toBe(true);
	expect(requests.some(({ params }) => params.get('filter')?.includes('"_in":["5"]'))).toBe(true);
});

test('reloads everything when the options change', async () => {
	setup({ posts: { fields: POST_FIELDS, items: [post(1, { date_updated: '2026-10-01T00:00:00.000Z' })] } });
	const { context, logs } = createContext();

	await load({ collection: 'posts' }, context);
	await load({ collection: 'posts', pageSize: 10 }, context);

	expect(logs.at(-1)).toBe('posts: loaded 1 entries from "posts"');
});

test('reloads everything without an updated field', async () => {
	setup({ posts: { fields: POST_FIELDS, items: [post(1, { date_updated: '2026-10-01T00:00:00.000Z' })] } });
	const { context, logs } = createContext();

	await load({ collection: 'posts', updatedField: false }, context);
	await load({ collection: 'posts', updatedField: false }, context);

	expect(logs).toEqual(['posts: loaded 1 entries from "posts"', 'posts: loaded 1 entries from "posts"']);
});

test('keeps the page size within QUERY_LIMIT_MAX', async () => {
	const { requests } = setup(
		{ posts: { fields: POST_FIELDS, items: [1, 2, 3, 4, 5].map((id) => post(id)) } },
		{ queryLimitMax: 2 },
	);
	const { context, entries } = createContext();

	await load({ collection: 'posts' }, context);

	expect(entries.size).toBe(5);
	expect(requests.filter(({ path }) => path === '/items/posts').map(({ params }) => params.get('limit'))).toEqual([
		'2',
		'2',
		'2',
		'2',
	]);
});

test('loads a singleton under its id', async () => {
	setup({ settings: { fields: [field('title', 'string')], items: [{ title: 'Site' }], singleton: true } });
	const { context, entries, logs } = createContext('settings');

	await load({ collection: 'settings', singleton: true, id: 'site' }, context);

	expect([...entries.keys()]).toEqual(['site']);
	expect(entries.get('site').data).toEqual({ title: 'Site' });
	expect(logs).toEqual(['settings: loaded singleton "settings"']);
});

test('reads system collections from their own endpoint', async () => {
	const { requests } = setup({
		directus_files: { fields: [field('id', 'uuid', { primary: true })], items: [{ id: 'abc', title: 'Cover' }] },
	});
	const { context, entries } = createContext('files');

	await load({ collection: 'directus_files' }, context);

	expect(requests.some(({ path }) => path === '/files')).toBe(true);
	expect(entries.get('abc').data).toEqual({ id: 'abc', title: 'Cover', src: `${URL}/assets/abc` });
});

test('falls back to defaults when the fields cannot be read', async () => {
	setup({ posts: { fields: POST_FIELDS, items: [post(1, { cover: 'abc' })] } }, { forbidFields: true });
	const { context, entries, logs } = createContext();
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
	const loader = directusLoader({ url: URL, token: 'secret', collection: 'posts' });

	const { types } = await (loader as { createSchema: () => Promise<{ types: string }> }).createSchema();
	await loader.load(context);

	expect(types).toBe('export type Entry = { [key: string]: unknown; };\n');
	expect(entries.get('1').data.cover).toBe('abc');
	// Warned once, from createSchema(), which runs first.
	expect(warn).toHaveBeenCalledTimes(1);
	expect(logs).toEqual(['posts: loaded 1 entries from "posts"']);
});

test('generates the schema from the selected fields', async () => {
	setup({ posts: { fields: POST_FIELDS, items: [] } });
	const loader = directusLoader({ url: URL, collection: 'posts', query: { fields: ['slug'] } });

	const { types } = await (loader as { createSchema: () => Promise<{ types: string }> }).createSchema();

	expect(types).toBe('export type Entry = { "id": number; "slug": string | null; "date_updated": Date | null; };\n');
});

test('sends DIRECTUS_TOKEN when no token is set', async () => {
	vi.stubEnv('DIRECTUS_TOKEN', 'from-env');
	const { requests } = setup({ posts: { fields: POST_FIELDS, items: [] } });

	await directusLoader({ url: URL, collection: 'posts' }).load(createContext().context);

	expect(requests.every(({ token }) => token === 'from-env')).toBe(true);
});

test('fails with a clear message when the items are forbidden', async () => {
	setup({});

	await expect(load({ collection: 'missing' }, createContext().context)).rejects.toThrow(
		'Directus denied access while trying to read items from "missing" (403): Forbidden.',
	);
});
