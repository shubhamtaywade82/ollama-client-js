import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseStructuredOutput, zodToOllamaFormat } from '../src/schema/zod.js';
import { OllamaValidationError } from '../src/errors.js';

const PersonSchema = z.object({
  name: z.string(),
  age: z.number().int(),
});

describe('zodToOllamaFormat', () => {
  it('converts a Zod object schema into a JSON Schema object', () => {
    const format = zodToOllamaFormat(PersonSchema);
    expect(format.type).toBe('object');
    expect(format.properties).toMatchObject({
      name: { type: 'string' },
      age: { type: 'integer' },
    });
    expect(format.required).toEqual(['name', 'age']);
  });
});

describe('parseStructuredOutput', () => {
  it('parses and validates a matching JSON response', () => {
    const result = parseStructuredOutput('{"name":"Ada","age":36}', PersonSchema);
    expect(result).toEqual({ name: 'Ada', age: 36 });
  });

  it('throws OllamaValidationError for invalid JSON', () => {
    expect(() => parseStructuredOutput('not json', PersonSchema)).toThrow(OllamaValidationError);
  });

  it('throws OllamaValidationError when the JSON does not match the schema', () => {
    try {
      parseStructuredOutput('{"name":"Ada"}', PersonSchema);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(OllamaValidationError);
      expect((error as OllamaValidationError).issues).toBeDefined();
    }
  });

  it('preserves the raw response body on the error for debugging', () => {
    try {
      parseStructuredOutput('{"name":"Ada"}', PersonSchema);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as OllamaValidationError).response?.body).toEqual({ name: 'Ada' });
    }
  });
});
