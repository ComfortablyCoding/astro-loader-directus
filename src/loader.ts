// The Astro Content Layer loader: generates the collection's schema, then syncs its items into the content store.
import type { Loader } from 'astro/loaders';
import { FILES_COLLECTION } from './directus/assets.js';
import { createClient, resolveToken } from './directus/client.js';
import { type CollectionInfo, readCollectionInfo } from './directus/collection.js';
import type { DirectusLoaderOptions } from './options.js';
import { type GeneratedSchema, generateSchema } from './schema/zod.js';
import { DEFAULT_PRIMARY_KEY, createEntryWriter, getRequiredFields, syncCollection, syncSingleton } from './sync.js';

export function directusLoader(options: DirectusLoaderOptions): Loader {
	const directus = createClient(options.url, resolveToken(options.token));

	// Shared by `createSchema()` and `load()`, which run in the same sync. A failed read is retried next time.
	let info: Promise<CollectionInfo> | undefined;
	const getInfo = (): Promise<CollectionInfo> => {
		info ??= readCollectionInfo(directus, options.collection);
		info.catch(() => (info = undefined));

		return info;
	};

	let warned = false;
	const warnUnknownFields = (warn: (message: string) => void): void => {
		if (warned) return;

		warned = true;
		warn(
			`Can't read the fields of "${options.collection}": the token needs read access to directus_fields and directus_relations, which app access grants. Falling back to a loose schema, "${DEFAULT_PRIMARY_KEY}" as the primary key, no asset URLs, and incremental sync only with \`updatedField\`.`,
		);
	};

	return {
		name: 'astro-loader-directus',
		createSchema: async (): Promise<GeneratedSchema> => {
			const collection = await getInfo();

			// `createSchema()` runs before `load()` and has no logger.
			if (!collection.introspected) warnUnknownFields((message) => console.warn(`[astro-loader-directus] ${message}`));

			return generateSchema(collection.fields, {
				query: options.query,
				requiredFields: getRequiredFields(options, collection),
				assets: options.assets !== false,
				fieldSchemas: options.fieldSchemas,
				loose: !collection.introspected,
				fileSource: options.collection === FILES_COLLECTION && options.assets !== false,
			});
		},
		load: async (context) => {
			const collection = await getInfo();

			if (!collection.introspected) warnUnknownFields((message) => context.logger.warn(message));

			const writeEntry = createEntryWriter(context, options, collection);

			if (options.singleton) {
				await syncSingleton({ directus, context, options, info: collection, writeEntry });
			} else {
				await syncCollection({ directus, context, options, info: collection, writeEntry });
			}
		},
	};
}
