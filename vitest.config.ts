import { defineConfig, type ViteUserConfig } from 'vitest/config';

const config: ViteUserConfig = defineConfig({
	define: {
		__VERSION__: JSON.stringify('test'),
	},
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node',
		coverage: {
			include: ['src/**/*.ts'],
			exclude: ['src/**/*.test.ts'],
		},
	},
});

export default config;
