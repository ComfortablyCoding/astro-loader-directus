import { expect, test } from 'vitest';
import { type Directus, DirectusLoaderError } from './client.js';
import { type Item, getItemsEndpoint, getPageSize, mergeFilters, readAllItems, readItemsIn } from './items.js';

interface Request {
	path: string;
	params: Record<string, any>;
}

// Serves `count` numbered items, returning at most `cap` per page. With `max`, rejects larger pages like
// QUERY_LIMIT_MAX does.
function setup(count: number, cap = Infinity, max = Infinity) {
	const requests: Request[] = [];
	const items: Item[] = Array.from({ length: count }, (_, index) => ({ id: index + 1 }));

	const directus: Directus = {
		url: 'https://cms.example.com',
		request: async (command) => {
			const request = command() as Request;
			requests.push(request);

			const { limit, offset, filter } = request.params;

			if (limit > max) {
				throw new DirectusLoaderError(
					`Directus failed while trying to read items (400): Invalid query. "limit" must be less than or equal to ${max}.`,
					{ code: 'REQUEST_FAILED', status: 400 },
				);
			}
			const allowed: number[] | undefined = filter?._in ? filter._in : filter?._and?.[1]?.id?._in;
			const matching = allowed ? items.filter((item) => allowed.map(String).includes(String(item['id']))) : items;

			return matching.slice(offset, offset + Math.min(limit, cap)) as never;
		},
	};

	return { directus, requests };
}

test.each([
	['posts', '/items/posts'],
	['my collection', '/items/my%20collection'],
	['directus_files', '/files'],
	['directus_users', '/users'],
])('serves %s from %s', (collection, path) => {
	expect(getItemsEndpoint(collection)).toBe(path);
});

test('reads every page until an empty one', async () => {
	const { directus, requests } = setup(250);

	const items = await readAllItems({ directus, collection: 'posts', query: { fields: ['id'] }, pageSize: 100 });

	expect(items).toHaveLength(250);
	expect(requests.map(({ params }) => [params.limit, params.offset])).toEqual([
		[100, 0],
		[100, 100],
		[100, 200],
		[100, 250],
	]);
	expect(requests[0]).toEqual({ path: '/items/posts', params: { fields: ['id'], limit: 100, offset: 0 } });
});

test('keeps paging when Directus returns fewer items than requested', async () => {
	const { directus } = setup(250, 30);

	const items = await readAllItems({ directus, collection: 'posts', query: {}, pageSize: 100 });

	expect(items.map((item) => item['id'])).toEqual(Array.from({ length: 250 }, (_, index) => index + 1));
});

test('retries with the limit Directus accepts', async () => {
	const { directus, requests } = setup(5, Infinity, 2);

	const items = await readAllItems({ directus, collection: 'posts', query: {}, pageSize: 100 });

	expect(items).toHaveLength(5);
	expect(requests.map(({ params }) => params.limit)).toEqual([100, 2, 2, 2, 2]);
});

test('fails on other rejected queries', async () => {
	const directus: Directus = {
		url: 'https://cms.example.com',
		request: async () => {
			throw new DirectusLoaderError('Directus failed (400): Invalid query. "filter" is invalid.', {
				code: 'REQUEST_FAILED',
				status: 400,
			});
		},
	};

	await expect(readAllItems({ directus, collection: 'posts', query: {}, pageSize: 100 })).rejects.toThrow(
		'"filter" is invalid',
	);
});

test('reads items by id in chunks, keeping the query filter', async () => {
	const { directus, requests } = setup(300);
	const values = Array.from({ length: 150 }, (_, index) => String(index + 1));

	const items = await readItemsIn({
		directus,
		collection: 'posts',
		query: { filter: { status: { _eq: 'published' } } },
		pageSize: 500,
		field: 'id',
		values,
	});

	expect(items).toHaveLength(150);
	expect(requests.filter(({ params }) => params.offset === 0)).toHaveLength(2);
	expect(requests[0]?.params.filter).toEqual({
		_and: [{ status: { _eq: 'published' } }, { id: { _in: values.slice(0, 100) } }],
	});
});

test('reads nothing for no ids', async () => {
	const { directus, requests } = setup(10);

	expect(
		await readItemsIn({ directus, collection: 'posts', query: {}, pageSize: 100, field: 'id', values: [] }),
	).toEqual([]);
	expect(requests).toEqual([]);
});

test.each([
	['nothing', [], undefined],
	['empty filters', [undefined, {}], undefined],
	['one filter', [{ a: { _eq: 1 } }, {}], { a: { _eq: 1 } }],
	['two filters', [{ a: { _eq: 1 } }, { b: { _eq: 2 } }], { _and: [{ a: { _eq: 1 } }, { b: { _eq: 2 } }] }],
])('merges %s', (_label, filters, expected) => {
	expect(mergeFilters(...filters)).toEqual(expected);
});

function serverInfo(info: unknown): Directus {
	return {
		url: 'https://cms.example.com',
		request: async () => {
			if (info instanceof Error) throw info;

			return info as never;
		},
	};
}

test.each([
	['caps the page size at QUERY_LIMIT_MAX', { queryLimit: { default: 100, max: 50 } }, 50],
	['keeps a smaller page size', { queryLimit: { default: 100, max: 500 } }, 100],
	['ignores an unlimited max', { queryLimit: { default: 100, max: -1 } }, 100],
	['keeps the page size when the limit is hidden', {}, 100],
	['keeps the page size when the server info fails', new Error('forbidden'), 100],
])('%s', async (_label, info, expected) => {
	expect(await getPageSize(serverInfo(info), 100)).toBe(expected);
});
