import { z } from 'astro/zod';
import { expect, test } from 'vitest';
import { toTypeScript } from './typescript.js';

test.each([
	['a string', z.string(), 'string'],
	['a number', z.number(), 'number'],
	['an integer', z.int(), 'number'],
	['a boolean', z.boolean(), 'boolean'],
	['a date', z.date(), 'Date'],
	['a coerced date', z.coerce.date(), 'Date'],
	['null', z.null(), 'null'],
	['unknown', z.unknown(), 'unknown'],
	['a literal', z.literal('draft'), '"draft"'],
	['an enum', z.enum(['draft', 'published']), '"draft" | "published"'],
	['a nullable string', z.string().nullable(), 'string | null'],
	['a union', z.union([z.string(), z.number()]), 'string | number'],
	['an array', z.array(z.string()), 'Array<string>'],
	['a tuple', z.tuple([z.string(), z.number()]), '[string, number]'],
	['a record', z.record(z.string(), z.number()), '{ [key: string]: number; }'],
	['an object', z.object({ a: z.string(), b: z.number().optional() }), '{ "a": string; "b"?: number; }'],
	['a loose object', z.looseObject({ src: z.string() }), '{ "src": string; [key: string]: unknown; }'],
	['an empty object', z.object({}), '{}'],
	[
		'an intersection of objects',
		z.intersection(z.object({ a: z.string() }), z.object({ b: z.number() })),
		'{ "a": string; "b": number; }',
	],
	['a preprocessed boolean', z.preprocess((value) => value, z.boolean()), 'boolean'],
	['a quoted key', z.object({ 'my-field': z.string() }), '{ "my-field": string; }'],
])('converts %s', (_label, schema, expected) => {
	expect(toTypeScript(schema)).toBe(expected);
});
