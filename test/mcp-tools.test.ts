import { describe, expect, it } from 'vitest';
import { loadMcpTools, registerMcpTools } from '../src/mcp/mcp-tools.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { defineTool } from '../src/tools/define-tool.js';
import { z } from 'zod';
import { OllamaMcpError } from '../src/errors.js';
import type { McpClientLike } from '../src/mcp/types.js';

function fakeMcpClient(overrides: Partial<McpClientLike> = {}): McpClientLike {
  return {
    listTools: () =>
      Promise.resolve({
        tools: [
          {
            name: 'search_docs',
            description: 'Searches internal docs.',
            inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
          },
          {
            name: 'get_time',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      }),
    callTool: () => Promise.resolve({ content: [{ type: 'text', text: 'ok' }] }),
    ...overrides,
  };
}

describe('loadMcpTools', () => {
  it('converts MCP tool descriptors into ToolDefinitions with the raw JSON Schema as parameters', async () => {
    const tools = await loadMcpTools(fakeMcpClient());
    expect(tools).toHaveLength(2);
    expect(tools[0]?.name).toBe('search_docs');
    expect(tools[0]?.parameters).toEqual({
      type: 'object',
      properties: { query: { type: 'string' } },
    });
    expect(tools[1]?.description).toBe('');
  });

  it('applies namePrefix to every loaded tool', async () => {
    const tools = await loadMcpTools(fakeMcpClient(), { namePrefix: 'mcp_' });
    expect(tools.map((t) => t.name)).toEqual(['mcp_search_docs', 'mcp_get_time']);
  });

  it('wraps a listTools() rejection as OllamaMcpError', async () => {
    const client = fakeMcpClient({
      listTools: () => Promise.reject(new Error('connection lost')),
    });
    await expect(loadMcpTools(client)).rejects.toBeInstanceOf(OllamaMcpError);
  });
});

describe('registerMcpTools', () => {
  it('wires callTool as the handler and joins text content blocks into the result string', async () => {
    const client = fakeMcpClient({
      callTool: ({ name, arguments: args }) => {
        expect(name).toBe('search_docs');
        expect(args).toEqual({ query: 'hello' });
        return Promise.resolve({
          content: [
            { type: 'text', text: 'part one' },
            { type: 'text', text: 'part two' },
          ],
        });
      },
    });
    const registry = new ToolRegistry();
    await registerMcpTools(registry, client);

    const outcome = await registry.executeToolCall({
      function: { name: 'search_docs', arguments: { query: 'hello' } },
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.message.content).toBe('part one\npart two');
  });

  it('represents non-text content blocks with a placeholder instead of dropping them', async () => {
    const client = fakeMcpClient({
      callTool: () => Promise.resolve({ content: [{ type: 'image', data: 'base64...' }] }),
    });
    const registry = new ToolRegistry();
    await registerMcpTools(registry, client);
    const outcome = await registry.executeToolCall({
      function: { name: 'search_docs', arguments: {} },
    });
    expect(outcome.message.content).toBe('[unsupported content type: image]');
  });

  it('throws OllamaMcpError when the MCP result reports isError: true', async () => {
    const client = fakeMcpClient({
      callTool: () =>
        Promise.resolve({ content: [{ type: 'text', text: 'failure' }], isError: true }),
    });
    const registry = new ToolRegistry();
    await registerMcpTools(registry, client);
    const outcome = await registry.executeToolCall({
      function: { name: 'search_docs', arguments: {} },
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBeInstanceOf(OllamaMcpError);
  });

  it('avoids colliding with an already-registered local tool of the same name via namePrefix', async () => {
    const localTool = defineTool({
      name: 'search_docs',
      description: 'Local search.',
      parameters: z.object({}),
      handler: () => 'local result',
    });
    const registry = new ToolRegistry([localTool]);
    await registerMcpTools(registry, fakeMcpClient(), { namePrefix: 'mcp_' });

    expect(registry.has('search_docs')).toBe(true);
    expect(registry.has('mcp_search_docs')).toBe(true);
    const local = await registry.executeToolCall({
      function: { name: 'search_docs', arguments: {} },
    });
    expect(local.result).toBe('local result');
  });
});
