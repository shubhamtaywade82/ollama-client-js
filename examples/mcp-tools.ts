/**
 * Wiring an MCP-shaped tool server into an `Agent`. `McpClientLike` only needs `listTools()`/
 * `callTool()`, so this example uses a tiny in-process stub instead of a real MCP server or the
 * `@modelcontextprotocol/sdk` package - `registerMcpTools` works the same either way, since it's
 * duck-typed and never imports that SDK.
 *
 * Run against a local Ollama server, with a tool-calling-capable model pulled:
 *   npx tsx examples/mcp-tools.ts
 */
import { Agent, OllamaClient, registerMcpTools, ToolRegistry } from '../src/index.js';
import type { McpClientLike } from '../src/index.js';

const client = new OllamaClient({
  baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
});

const stubMcpClient: McpClientLike = {
  listTools: () =>
    Promise.resolve({
      tools: [
        {
          name: 'lookup_stock_price',
          description: 'Looks up the current price of a stock ticker.',
          inputSchema: {
            type: 'object',
            properties: { ticker: { type: 'string' } },
            required: ['ticker'],
          },
        },
      ],
    }),
  callTool: ({ arguments: args }) =>
    Promise.resolve({ content: [{ type: 'text', text: `${String(args.ticker)}: $123.45` }] }),
};

async function main(): Promise<void> {
  const tools = new ToolRegistry();
  await registerMcpTools(tools, stubMcpClient, { namePrefix: 'mcp_' });

  const agent = new Agent(client, { tools });
  const result = await agent.run({
    model: 'llama3.2',
    messages: [{ role: 'user', content: "What is AAPL's stock price?" }],
  });

  console.log('Final answer:', result.finalMessage.content);
}

main().catch((error: unknown) => {
  console.error('MCP-tools example failed:', error);
  process.exitCode = 1;
});
