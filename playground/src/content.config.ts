import { defineCollection } from 'astro:content';
import { directusLoader } from 'astro-loader-directus';

const posts = defineCollection({
	loader: directusLoader({
		url: import.meta.env.DIRECTUS_URL ?? 'http://localhost:8055',
		collection: 'posts',
		token: import.meta.env.DIRECTUS_TOKEN,
	}),
});

export const collections = { posts };
