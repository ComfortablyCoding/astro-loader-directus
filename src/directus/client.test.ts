import { readItems } from '@directus/sdk';
import { afterEach, expect, test, vi } from 'vitest';
import { DirectusLoaderError, createClient, resolveToken, toLoaderError } from './client.js';

const URL = 'https://cms.example.com';

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

// The shape the SDK throws for an error response.
function apiError(status: number, message: string) {
	return { errors: [{ message, extensions: { code: 'X' } }], response: new Response(null, { status }) };
}

test.each([
	[
		401,
		'UNAUTHORIZED',
		'Directus rejected the token while trying to read items (401): Invalid token. Check that the token is valid.',
	],
	[
		403,
		'FORBIDDEN',
		"Directus denied access while trying to read items (403): Invalid token. Check that the collection exists and that the token's policies allow reading it.",
	],
	[404, 'NOT_FOUND', 'Directus found nothing while trying to read items (404): Invalid token.'],
	[500, 'REQUEST_FAILED', 'Directus failed while trying to read items (500): Invalid token.'],
])('explains a %i response', (status, code, message) => {
	const error = toLoaderError(apiError(status, 'Invalid token.'), URL, 'read items');

	expect(error).toBeInstanceOf(DirectusLoaderError);
	expect(error).toMatchObject({ code, status, message });
});

test('explains an unreachable server', () => {
	const error = toLoaderError(new TypeError('fetch failed'), URL, 'read items');

	expect(error).toMatchObject({
		code: 'NETWORK',
		status: undefined,
		message: `Could not reach Directus at ${URL} while trying to read items: fetch failed`,
	});
});

test('wraps unexpected errors', () => {
	expect(toLoaderError('boom', URL, 'read items')).toMatchObject({
		code: 'REQUEST_FAILED',
		message: 'Unexpected error while trying to read items: boom',
	});
});

test('passes loader errors through', () => {
	const error = new DirectusLoaderError('already explained', { code: 'FORBIDDEN' });

	expect(toLoaderError(error, URL, 'read items')).toBe(error);
});

test('prefers the token option', () => {
	vi.stubEnv('DIRECTUS_TOKEN', 'from-env');

	expect(resolveToken('from-options')).toBe('from-options');
});

test('falls back to DIRECTUS_TOKEN', () => {
	vi.stubEnv('DIRECTUS_TOKEN', 'from-env');

	expect(resolveToken(undefined)).toBe('from-env');
});

test('treats an empty DIRECTUS_TOKEN as no token', () => {
	vi.stubEnv('DIRECTUS_TOKEN', '');

	expect(resolveToken(undefined)).toBeUndefined();
});

test('sends the token and converts failures', async () => {
	const fetch = vi.fn(async () => Response.json(apiError(403, 'Forbidden.'), { status: 403 }));
	vi.stubGlobal('fetch', fetch);

	const client = createClient(URL, 'secret');

	await expect(client.request(readItems('posts'), 'read items from "posts"')).rejects.toMatchObject({
		code: 'FORBIDDEN',
		status: 403,
	});
	expect(fetch).toHaveBeenCalledWith(
		`${URL}/items/posts`,
		expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer secret' }) }),
	);
});
