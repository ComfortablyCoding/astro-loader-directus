// Converts a Zod schema to a TypeScript type expression, through its JSON Schema.
import { z } from 'astro/zod';

interface JsonSchema {
	type?: string | string[];
	properties?: Record<string, JsonSchema>;
	required?: string[];
	additionalProperties?: boolean | JsonSchema;
	items?: JsonSchema;
	prefixItems?: JsonSchema[];
	enum?: unknown[];
	const?: unknown;
	anyOf?: JsonSchema[];
	oneOf?: JsonSchema[];
	allOf?: JsonSchema[];
	/** A TypeScript type JSON Schema can't express, set while converting. */
	'x-typescript'?: string;
}

export function toTypeScript(schema: z.ZodType): string {
	const json = z.toJSONSchema(schema, {
		io: 'output',
		unrepresentable: 'any',
		override({ zodSchema, jsonSchema }) {
			if (zodSchema._zod.def.type === 'date') jsonSchema['x-typescript'] = 'Date';
		},
	});

	return fromJsonSchema(json as JsonSchema);
}

function fromJsonSchema(schema: JsonSchema): string {
	if (schema['x-typescript']) return schema['x-typescript'];
	if (schema.const !== undefined) return JSON.stringify(schema.const);
	if (schema.enum) return toUnion(schema.enum.map((value) => JSON.stringify(value)));

	const variants = schema.anyOf ?? schema.oneOf;

	if (variants) return toUnion(variants.map(fromJsonSchema));
	if (schema.allOf) return schema.allOf.map((part) => `(${fromJsonSchema(part)})`).join(' & ');
	if (Array.isArray(schema.type)) return toUnion(schema.type.map((type) => fromJsonSchema({ ...schema, type })));

	switch (schema.type) {
		case 'string': {
			return 'string';
		}

		case 'number':
		case 'integer': {
			return 'number';
		}

		case 'boolean': {
			return 'boolean';
		}

		case 'null': {
			return 'null';
		}

		case 'array': {
			if (schema.prefixItems) return `[${schema.prefixItems.map(fromJsonSchema).join(', ')}]`;

			return schema.items ? `Array<${fromJsonSchema(schema.items)}>` : 'unknown[]';
		}

		case 'object': {
			return fromObjectSchema(schema);
		}

		default: {
			return 'unknown';
		}
	}
}

function fromObjectSchema({ properties = {}, required = [], additionalProperties }: JsonSchema): string {
	const members = Object.entries(properties).map(
		([key, value]) => `${JSON.stringify(key)}${required.includes(key) ? '' : '?'}: ${fromJsonSchema(value)};`,
	);

	// Open objects, and objects without properties, accept any other key.
	if (additionalProperties !== false && (additionalProperties !== undefined || members.length === 0)) {
		const value = typeof additionalProperties === 'object' ? fromJsonSchema(additionalProperties) : 'unknown';

		members.push(`[key: string]: ${value};`);
	}

	return members.length > 0 ? `{ ${members.join(' ')} }` : '{}';
}

function toUnion(types: string[]): string {
	const unique = [...new Set(types)];

	return unique.length > 0 ? unique.join(' | ') : 'never';
}
