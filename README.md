# astro-loader-directus

An [Astro Content Layer](https://docs.astro.build/en/guides/content-collections/) loader for
[Directus](https://directus.io/).

## Features

- [Load collections and singletons](#usage), including system collections such as `directus_files`
- [Generated schemas and types](#schema-and-types) from your Directus fields, with overrides for JSON fields
- [Incremental sync](#incremental-sync): after the first load, only changed, created and removed items are fetched
- [Rendered content](#content): Markdown and WYSIWYG fields work with `render(entry)`
- [Asset URLs](#images) for file fields, ready for `<Image />`, with optional transforms
- Automatic pagination that respects `QUERY_LIMIT_MAX`
- Errors that say what failed and how to fix it

## Installation

Requires Astro 6 or 7, Directus 11 or 12 and Node.js 22.12 or later.

```shell
pnpm add astro-loader-directus
```

## Usage

```ts
// src/content.config.ts
import { defineCollection } from 'astro:content';
import { directusLoader } from 'astro-loader-directus';

const posts = defineCollection({
	loader: directusLoader({
		url: 'https://cms.example.com',
		collection: 'posts',
		idField: 'slug',
		contentField: 'body',
		query: {
			fields: ['*', 'author.*', 'cover.*'],
			filter: { status: { _eq: 'published' } },
			sort: ['-date_published'],
		},
	}),
});

const settings = defineCollection({
	loader: directusLoader({ url: 'https://cms.example.com', collection: 'settings', singleton: true }),
});

export const collections = { posts, settings };
```

```astro
---
import { getCollection, getEntry, render } from 'astro:content';

const posts = await getCollection('posts');
const settings = await getEntry('settings', 'settings');
const { Content } = await render(posts[0]);
---
```

Astro doesn't guarantee the order of `getCollection()`, so sort entries in the page; `query.sort` only orders the
requests.

The token is read from `DIRECTUS_TOKEN` (in `.env` or the environment) unless `token` is set. Entries are limited to
what its policies can read, so a public collection needs no token at all.

### Schema and types

The loader reads the collection's fields from Directus and generates a Zod schema, so entries are typed and validated
without writing one. Only the fields selected by `query.fields` are included.

| Directus type                                 | Entry type                                                   |
| --------------------------------------------- | ------------------------------------------------------------ |
| `string`, `text`, `uuid`, `hash`              | `string`                                                     |
| `date`, `time`, `dateTime`                    | `string`, as they have no timezone                           |
| `timestamp`                                   | `Date`                                                       |
| `integer`, `float`                            | `number`                                                     |
| `bigInteger`, `decimal`                       | `number \| string`, as some databases return strings         |
| `boolean`                                     | `boolean`                                                    |
| `csv`                                         | `string[]`                                                   |
| `json`, geometry                              | `unknown`, or your own schema with `fieldSchemas`            |
| Many-to-one                                   | The id, or an object when expanded                           |
| One-to-many, many-to-many, many-to-any, files | An array of ids, or objects when expanded                    |
| File                                          | The asset URL, or the file object with a `src` when expanded |

Type JSON fields, or replace any generated field, with `fieldSchemas`:

```ts
import { z } from 'astro/zod';

directusLoader({
	url: 'https://cms.example.com',
	collection: 'posts',
	fieldSchemas: { tags: z.array(z.string()) },
});
```

A `schema` set on the collection replaces the generated one entirely.

Reading fields needs read access to `directus_fields` and `directus_relations`, which app access grants. Without it the
loader warns and falls back to a loose schema, `id` as the primary key, no asset URLs, and incremental sync only when
`updatedField` is set.

### Incremental sync

The first load reads every item. After that, the loader only reads items changed since the last sync, using the field
with the "Date Updated" special (or `updatedField`). It also reads the ids of every matching item, to add new items and
remove ones that were deleted or no longer match the filter. Changing an option triggers a full reload.

### Content

Set `contentField` to render a field as the entry's content, so `render(entry)` and `<Content />` work. Markdown and
WYSIWYG fields are detected from their interface; set `contentFormat` to `markdown` or `html` for other fields.

### Images

File fields become absolute asset URLs, and expanded file objects (`cover.*`) get a `src` URL next to their metadata,
such as `width` and `height`. Add your Directus host to `image.domains` to optimise them with `<Image />`:

```ts
// astro.config.mjs
export default defineConfig({ image: { domains: ['cms.example.com'] } });
```

```astro
<Image src={cover.src} alt={cover.title} width={cover.width} height={cover.height} />
```

Directus only serves an asset to requests that can read the file, so `<Image />` needs a public read permission on
`directus_files`. Set `assets.query` to add a preset `key` or transforms such as `width` and `format`, or
`assets: false` to keep file ids.

## Options

| Option          | Collections | Singletons | Description                                                                                            |
| --------------- | ----------- | ---------- | ------------------------------------------------------------------------------------------------------ |
| `url`           | ✓           | ✓          | Base URL of the Directus instance. Required.                                                           |
| `collection`    | ✓           | ✓          | The collection to load. Required.                                                                      |
| `token`         | ✓           | ✓          | Static access token. Defaults to `DIRECTUS_TOKEN`.                                                     |
| `query`         | ✓           | ✓          | `fields`, `filter`, `search`, `sort`, `deep` and `alias`. Singletons accept `fields`, `deep`, `alias`. |
| `contentField`  | ✓           | ✓          | Field rendered as the entry's content.                                                                 |
| `contentFormat` | ✓           | ✓          | `markdown` or `html`. Defaults to the format of the field's interface, then `markdown`.                |
| `assets`        | ✓           | ✓          | `{ query }` to add a preset key or transforms to asset URLs, or `false` to keep file ids.              |
| `fieldSchemas`  | ✓           | ✓          | Zod schemas for specific fields of the generated schema.                                               |
| `idField`       | ✓           |            | Field used as the entry id, such as `slug`. Defaults to the primary key.                               |
| `pageSize`      | ✓           |            | Items per request. Defaults to `100`, capped at `QUERY_LIMIT_MAX`.                                     |
| `updatedField`  | ✓           |            | Timestamp field for incremental sync. Defaults to the "Date Updated" field; `false` always reloads.    |
| `singleton`     |             | ✓          | Set to `true` to load a singleton as a single entry.                                                   |
| `id`            |             | ✓          | The entry's id. Defaults to the collection name.                                                       |

Failed requests throw a `DirectusLoaderError` with a `code` (`UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `NETWORK` or
`REQUEST_FAILED`) and the HTTP `status`.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE)
