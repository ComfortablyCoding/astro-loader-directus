# Contributing

Thanks for your interest in contributing to `astro-loader-directus`.

## Setup

Requirements: Node.js 26 (see `.node-version`) and [pnpm](https://pnpm.io).

```sh
pnpm install
```

## Scripts

| Script           | Description                                |
| ---------------- | ------------------------------------------ |
| `pnpm build`     | Build the package to `dist/` with tsdown   |
| `pnpm dev`       | Rebuild on change                          |
| `pnpm typecheck` | Type-check with `tsc`                      |
| `pnpm lint`      | Lint with oxlint (`lint:fix` to autofix)   |
| `pnpm format`    | Format with oxfmt (`format:check` for CI)  |
| `pnpm test`      | Run tests with Vitest (`test:watch`)       |
| `pnpm check`     | Run typecheck, lint, format check and test |

## Playground

`playground/` is an Astro site that uses the package from the workspace, for testing against a real Directus instance.

```sh
cp playground/.env.directus.example playground/.env.directus   # optionally add a LICENSE_KEY
pnpm playground:directus   # Directus 12 on http://localhost:8055 (admin@example.com / password)
cp playground/.env.example playground/.env                     # add a static token for your Directus user
pnpm dev                   # rebuild the package on change
pnpm playground            # in another terminal, start the Astro dev server
```

The playground loads a `posts` collection, so create one in Directus first.

## Project structure

```
src/
  index.ts           Public exports
  options.ts         Public option types
  loader.ts          directusLoader(): wires createSchema() and load()
  sync.ts            Full and incremental sync, and writing entries to the store
  directus/
    client.ts        REST client, token fallback and DirectusLoaderError
    items.ts         Paginated reads, endpoints and filters
    collection.ts    Field and relation introspection
    assets.ts        Asset URLs
  schema/
    zod.ts           Zod schema generated from the fields
    typescript.ts    The matching Entry type
playground/          Astro site for manual testing
```

Unit tests sit next to the code they test, as `*.test.ts`.

## Pull requests

1. Create a branch from `main`.
2. Make your change and add tests where it makes sense.
3. Run `pnpm check` and make sure it passes.
4. Add an entry under **Unreleased** in [CHANGELOG.md](./CHANGELOG.md).
5. Open a pull request describing the change and why it's needed.

## Releasing

1. Move the **Unreleased** entries in [CHANGELOG.md](CHANGELOG.md) under the new version and bump `version` in
   `package.json`.
2. Publish a GitHub release whose tag is the version, for example `0.1.0`.

The release workflow publishes to npm using [trusted publishing](https://docs.npmjs.com/trusted-publishers), so no npm
token is stored in the repository. Configure the trusted publisher on npmjs.com once: repository
`ComfortablyCoding/astro-loader-directus`, workflow `release.yml`.
