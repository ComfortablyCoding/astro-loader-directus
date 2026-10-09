import { defineConfig, type UserConfig } from 'tsdown';

import pkg from './package.json' with { type: 'json' };

const config: UserConfig = defineConfig({
	entry: ['src/index.ts'],
	format: 'esm',
	platform: 'node',
	dts: true,
	clean: true,
	sourcemap: true,
	define: {
		__VERSION__: JSON.stringify(pkg.version),
	},
});

export default config;
