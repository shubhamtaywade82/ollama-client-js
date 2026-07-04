import { z } from 'zod';
import { OllamaValidationError } from '../errors.js';

/**
 * Structured-output helpers built on Zod.
 *
 * Ollama's `chat`/`generate` endpoints accept a `format` field that can be
 * either the literal string `"json"` or a JSON Schema object; when set, the
 * server constrains generation to match it. These helpers convert a Zod
 * schema into that JSON Schema, and validate the model's response against
 * the same schema so callers get a typed, parsed value or a clear
 * {@link OllamaValidationError} instead of hand-rolled `JSON.parse` and
 * manual checks.
 */

/** Converts a Zod schema into the JSON Schema shape Ollama's `format` field expects. */
export function zodToOllamaFormat(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { target: 'draft-7' });
}

/**
 * Parses and validates a raw model response string against a Zod schema.
 * Throws {@link OllamaValidationError} (never a raw `SyntaxError` or
 * `ZodError`) if the response is not valid JSON or does not match the
 * schema.
 */
export function parseStructuredOutput<TSchema extends z.ZodType>(
  raw: string,
  schema: TSchema,
): z.infer<TSchema> {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    throw new OllamaValidationError(
      'Model response was not valid JSON and could not be parsed as structured output.',
      { cause: error, response: { body: raw } },
    );
  }

  const result = schema.safeParse(parsedJson);
  if (!result.success) {
    throw new OllamaValidationError('Model response did not match the expected schema.', {
      issues: result.error.issues,
      response: { body: parsedJson },
    });
  }
  return result.data;
}
