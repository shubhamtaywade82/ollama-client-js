import { OllamaMcpError } from '../errors.js';
import type { ToolDefinition } from '../tools/types.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { McpCallToolResult, McpClientLike, McpListToolsResult } from './types.js';

export interface McpToolOptions {
  /** Prefixed onto every tool name to avoid collisions with locally defined tools (e.g. `'fs_'`). */
  readonly namePrefix?: string;
}

function renderContent(result: McpCallToolResult): string {
  return result.content
    .map((block) =>
      block.type === 'text' && typeof block.text === 'string'
        ? block.text
        : `[unsupported content type: ${block.type}]`,
    )
    .join('\n');
}

/**
 * Lists tools from an MCP-shaped client and converts each into a {@link ToolDefinition} whose
 * `parameters` is the tool's raw JSON-Schema `inputSchema` (not a Zod schema - MCP-sourced tools
 * therefore get no client-side argument validation before `handler` runs, unlike `defineTool`-based
 * tools; arguments are passed straight through to `callTool`) and whose `handler` invokes
 * `mcpClient.callTool`.
 *
 * A successful result's text content blocks are joined into the tool-result message's string
 * content; non-text blocks (e.g. images, embedded resources) are represented with a placeholder
 * rather than silently dropped. A result with `isError: true`, or a client method that rejects, is
 * thrown as an {@link OllamaMcpError} so it flows through `ToolRegistry`'s normal `onError` handling
 * like any other handler failure.
 */
export async function loadMcpTools(
  mcpClient: McpClientLike,
  options: McpToolOptions = {},
): Promise<ToolDefinition[]> {
  let listed: McpListToolsResult;
  try {
    listed = await mcpClient.listTools();
  } catch (cause) {
    throw new OllamaMcpError('Failed to list tools from the MCP client.', {
      mcpMethod: 'listTools',
      cause,
    });
  }

  return listed.tools.map((descriptor): ToolDefinition => {
    const name = options.namePrefix ? `${options.namePrefix}${descriptor.name}` : descriptor.name;
    return {
      name,
      description: descriptor.description ?? '',
      parameters: descriptor.inputSchema,
      handler: async (args) => {
        let result: McpCallToolResult;
        try {
          result = await mcpClient.callTool({
            name: descriptor.name,
            arguments: args as Record<string, unknown>,
          });
        } catch (cause) {
          throw new OllamaMcpError(`MCP tool "${descriptor.name}" call failed.`, {
            mcpMethod: 'callTool',
            toolName: descriptor.name,
            cause,
          });
        }
        if (result.isError) {
          throw new OllamaMcpError(`MCP tool "${descriptor.name}" reported an error result.`, {
            mcpMethod: 'callTool',
            toolName: descriptor.name,
            response: { body: result },
          });
        }
        return renderContent(result);
      },
    };
  });
}

/** Convenience: loads MCP tools and registers them into an existing {@link ToolRegistry} in one call. */
export async function registerMcpTools(
  registry: ToolRegistry,
  mcpClient: McpClientLike,
  options: McpToolOptions = {},
): Promise<void> {
  const tools = await loadMcpTools(mcpClient, options);
  for (const tool of tools) registry.register(tool);
}
