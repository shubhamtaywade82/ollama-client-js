import { z } from 'zod';
import type { Message, Tool, ToolCall } from 'ollama';
import {
  OllamaClientError,
  OllamaToolExecutionError,
  OllamaToolValidationError,
  OllamaUnknownToolError,
} from '../errors.js';
import { toolToOllamaFormat } from './define-tool.js';
import type { ToolDefinition, ToolExecutionResult } from './types.js';

export interface ToolRegistryOptions {
  /**
   * How to handle an unregistered tool name, an argument-validation failure, or a handler
   * throwing. `'result'` (default) wraps the failure as a structured error and still returns a
   * `role: 'tool'` result message so an agent loop can feed it back to the model and keep going -
   * a single bad or hallucinated tool call shouldn't crash a multi-turn loop. `'throw'` rejects
   * immediately instead, for callers that want fail-fast behavior.
   */
  readonly onError?: 'result' | 'throw';
}

function stringifyResult(result: unknown): string {
  if (typeof result === 'string') return result;
  try {
    return JSON.stringify(result) ?? String(result);
  } catch {
    return String(result);
  }
}

function errorMessage(toolName: string, error: OllamaClientError): Message {
  return {
    role: 'tool',
    tool_name: toolName,
    content: JSON.stringify({ error: error.message, code: error.code }),
  };
}

/**
 * Registers tool definitions and executes a model's `tool_calls` against them, producing the
 * `role: 'tool'` result messages Ollama expects appended back onto the conversation.
 *
 * Ollama's `ToolCall` carries no call ID (unlike OpenAI/Anthropic tool-call blocks) - there is no
 * protocol-level way to correlate a result to a specific request beyond call order. Calls are
 * therefore executed sequentially, in the order the model requested them, and results are
 * returned in that same order; if a model requests the same tool name more than once in a single
 * turn, correlating which result answers which call is positional only.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();
  private readonly onError: 'result' | 'throw';

  constructor(tools: readonly ToolDefinition[] = [], options: ToolRegistryOptions = {}) {
    this.onError = options.onError ?? 'result';
    for (const tool of tools) this.register(tool);
  }

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): readonly ToolDefinition[] {
    return [...this.tools.values()];
  }

  /** The `tools` array to send on a `chat` request. */
  toOllamaTools(): Tool[] {
    return this.list().map((tool) => toolToOllamaFormat(tool));
  }

  /** Returns a new registry containing only the named tools (used by Skills' `allowed-tools`). */
  filter(names: readonly string[]): ToolRegistry {
    const wanted = new Set(names);
    const subset = this.list().filter((tool) => wanted.has(tool.name));
    return new ToolRegistry(subset, { onError: this.onError });
  }

  private async executeOne(
    toolCall: ToolCall,
    ctx: { signal?: AbortSignal },
  ): Promise<ToolExecutionResult> {
    const name = toolCall.function.name;
    const tool = this.tools.get(name);

    if (!tool) {
      const error = new OllamaUnknownToolError(`No tool registered with name "${name}".`, {
        toolName: name,
      });
      return { name, ok: false, error, message: errorMessage(name, error) };
    }

    let args: unknown = toolCall.function.arguments;
    if (tool.parameters instanceof z.ZodType) {
      const parsed = tool.parameters.safeParse(args);
      if (!parsed.success) {
        const error = new OllamaToolValidationError(
          `Arguments for tool "${name}" did not match its parameter schema.`,
          { toolName: name, issues: parsed.error.issues },
        );
        return { name, ok: false, error, message: errorMessage(name, error) };
      }
      args = parsed.data;
    }

    try {
      const result = await tool.handler(args, { toolCall, signal: ctx.signal });
      return {
        name,
        ok: true,
        result,
        message: { role: 'tool', tool_name: name, content: stringifyResult(result) },
      };
    } catch (cause) {
      // A handler that already throws a structured OllamaClientError (e.g. an MCP-sourced
      // handler throwing OllamaMcpError) keeps its specific type; anything else is wrapped.
      // Mirrors mapError()'s "already-classified errors pass through unchanged" convention.
      const error =
        cause instanceof OllamaClientError
          ? cause
          : new OllamaToolExecutionError(`Tool "${name}" handler threw while executing.`, {
              toolName: name,
              cause,
            });
      return { name, ok: false, error, message: errorMessage(name, error) };
    }
  }

  /**
   * Executes tool calls sequentially, in request order (see class doc for why - there is no call
   * ID to parallelize safely against). With the default `onError: 'result'`, a failing call
   * produces an `ok: false` result whose `message` is still returned so the loop can continue;
   * with `onError: 'throw'`, the first failure rejects immediately and no further calls run.
   */
  async executeToolCalls(
    toolCalls: readonly ToolCall[],
    ctx: { signal?: AbortSignal } = {},
  ): Promise<ToolExecutionResult[]> {
    const results: ToolExecutionResult[] = [];
    for (const toolCall of toolCalls) {
      const outcome = await this.executeOne(toolCall, ctx);
      if (!outcome.ok && this.onError === 'throw' && outcome.error) {
        throw outcome.error;
      }
      results.push(outcome);
    }
    return results;
  }

  /** Executes a single tool call. Honors `onError` the same way {@link executeToolCalls} does. */
  async executeToolCall(
    toolCall: ToolCall,
    ctx: { signal?: AbortSignal } = {},
  ): Promise<ToolExecutionResult> {
    const [result] = await this.executeToolCalls([toolCall], ctx);
    return result as ToolExecutionResult;
  }
}
