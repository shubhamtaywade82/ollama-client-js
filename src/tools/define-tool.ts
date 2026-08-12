import { z } from 'zod';
import type { Tool } from 'ollama';
import { zodToOllamaFormat } from '../schema/zod.js';
import type { ToolDefinition, ToolHandler } from './types.js';

/**
 * Defines a tool from a Zod parameter schema. The schema is used both to validate a model's tool
 * call arguments before `handler` runs (see {@link ToolRegistry.executeToolCall}) and to derive the
 * JSON Schema sent to Ollama in `tools[].function.parameters` (see {@link toolToOllamaFormat}).
 */
export function defineTool<TSchema extends z.ZodType>(config: {
  readonly name: string;
  readonly description: string;
  readonly parameters: TSchema;
  readonly handler: ToolHandler<z.infer<TSchema>>;
}): ToolDefinition<z.infer<TSchema>> {
  return {
    name: config.name,
    description: config.description,
    parameters: config.parameters,
    handler: config.handler,
  };
}

/**
 * Converts a {@link ToolDefinition} into the `Tool` shape Ollama's `chat` `tools` field expects. Zod
 * parameter schemas are converted via {@link zodToOllamaFormat}; a raw JSON Schema object (as used by
 * MCP-sourced tools; see `src/mcp/mcp-tools.ts`) is passed through unchanged.
 */
export function toolToOllamaFormat(tool: ToolDefinition): Tool {
  const parameters =
    tool.parameters instanceof z.ZodType ? zodToOllamaFormat(tool.parameters) : tool.parameters;
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters,
    },
  };
}
