import type { z } from 'zod';
import type { Message, ToolCall } from 'ollama';
import type { OllamaClientError } from '../errors.js';

/**
 * A tool's parameter schema: either a Zod schema (validated client-side before the handler runs,
 * and converted to JSON Schema for the wire) or a raw JSON Schema object passed through unchanged
 * (used for tools sourced from MCP, which only ever hand back plain JSON Schema).
 */
export type ToolParameters = z.ZodType | Record<string, unknown>;

/** Resolves the argument type a handler receives for a given {@link ToolParameters}. */
export type InferToolArgs<TParameters extends ToolParameters> = TParameters extends z.ZodType
  ? z.infer<TParameters>
  : Record<string, unknown>;

export interface ToolExecutionContext {
  /** The raw tool call this handler is responding to. */
  readonly toolCall: ToolCall;
  readonly signal?: AbortSignal;
}

export type ToolHandler<TArgs = any> = (args: TArgs, ctx: ToolExecutionContext) => unknown;

/**
 * `TArgs` defaults to `any` rather than `unknown` on purpose: `ToolDefinition`s with different
 * concrete argument types (e.g. from separate {@link defineTool} calls) need to live together in a
 * single `ToolDefinition[]`/`ToolRegistry`, and `unknown` would make that invariant-generic
 * assignment fail (a handler typed for `{ city: string }` args is not a handler for `unknown`
 * args). `any` is the standard escape hatch for this "heterogeneous collection of a generic type"
 * shape; it doesn't weaken `defineTool`'s own inference, which still resolves to a precise
 * `ToolDefinition<z.infer<TSchema>>` at the call site.
 */
export interface ToolDefinition<TArgs = any> {
  readonly name: string;
  readonly description: string;
  readonly parameters: ToolParameters;
  readonly handler: ToolHandler<TArgs>;
}

export interface ToolExecutionResult {
  readonly name: string;
  readonly ok: boolean;
  /** The handler's return value, when `ok` is `true`. */
  readonly result?: unknown;
  /** The structured error, when `ok` is `false`. */
  readonly error?: OllamaClientError;
  /** The `role: 'tool'` message to append to the conversation, either way. */
  readonly message: Message;
}
