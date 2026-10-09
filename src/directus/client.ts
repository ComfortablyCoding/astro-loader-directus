// A REST client whose errors say what was being loaded and how to fix it.
import {
	type DirectusClient,
	type RestClient,
	type RestCommand,
	createDirectus,
	isDirectusError,
	rest,
	staticToken,
} from '@directus/sdk';

export interface Directus {
	url: string;
	/** Sends a command, converting failures into a `DirectusLoaderError` that names the `action`. */
	request<Output>(command: RestCommand<Output, any>, action: string): Promise<Output>;
}

/** Returns `token`, falling back to the `DIRECTUS_TOKEN` environment variable. */
export function resolveToken(token: string | undefined): string | undefined {
	if (token) return token;

	// Astro injects variables from `.env` files into code that references `import.meta.env` directly.
	const env = import.meta.env;

	return env?.['DIRECTUS_TOKEN'] || process.env['DIRECTUS_TOKEN'] || undefined;
}

export function createClient(url: string, token: string | undefined): Directus {
	// The SDK captures `fetch` when it is imported; looking it up per request respects a later patched `fetch`.
	const base = createDirectus(url, { globals: { fetch: (input, init) => globalThis.fetch(input, init) } }).with(rest());
	const client: DirectusClient<any> & RestClient<any> = token ? base.with(staticToken(token)) : base;

	return {
		url,
		async request(command, action) {
			try {
				return await client.request(command);
			} catch (error) {
				throw toLoaderError(error, url, action);
			}
		},
	};
}

export type DirectusLoaderErrorCode = 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | 'NETWORK' | 'REQUEST_FAILED';

export class DirectusLoaderError extends Error {
	override readonly name = 'DirectusLoaderError';
	readonly code: DirectusLoaderErrorCode;
	/** HTTP status returned by Directus, if a response was received. */
	readonly status: number | undefined;

	constructor(
		message: string,
		{ code, status, cause }: { code: DirectusLoaderErrorCode; status?: number; cause?: unknown },
	) {
		super(message, { cause });
		this.code = code;
		this.status = status;
	}
}

/** Converts an error thrown while trying to `action` into a `DirectusLoaderError`. */
export function toLoaderError(error: unknown, url: string, action: string): DirectusLoaderError {
	if (error instanceof DirectusLoaderError) return error;

	if (isDirectusError(error)) {
		const status = error.response?.status;
		const reason = error.errors?.[0]?.message ?? error.message;

		switch (status) {
			case 401: {
				return new DirectusLoaderError(
					`Directus rejected the token while trying to ${action} (401): ${reason} Check that the token is valid.`,
					{ code: 'UNAUTHORIZED', status, cause: error },
				);
			}

			case 403: {
				return new DirectusLoaderError(
					`Directus denied access while trying to ${action} (403): ${reason} Check that the collection exists and that the token's policies allow reading it.`,
					{ code: 'FORBIDDEN', status, cause: error },
				);
			}

			case 404: {
				return new DirectusLoaderError(`Directus found nothing while trying to ${action} (404): ${reason}`, {
					code: 'NOT_FOUND',
					status,
					cause: error,
				});
			}

			default: {
				return new DirectusLoaderError(
					`Directus failed while trying to ${action} (${status ?? 'no status'}): ${reason}`,
					{
						code: 'REQUEST_FAILED',
						status,
						cause: error,
					},
				);
			}
		}
	}

	// `fetch` rejects with a TypeError when the server can't be reached.
	if (error instanceof TypeError) {
		return new DirectusLoaderError(`Could not reach Directus at ${url} while trying to ${action}: ${error.message}`, {
			code: 'NETWORK',
			cause: error,
		});
	}

	const reason = error instanceof Error ? error.message : String(error);

	return new DirectusLoaderError(`Unexpected error while trying to ${action}: ${reason}`, {
		code: 'REQUEST_FAILED',
		cause: error,
	});
}
