/**
 * Manual tool calling: define a tool with `defineTool`, register it in a `ToolRegistry`, and do one
 * request/response/tool-execution round trip by hand (no `Agent` loop).
 *
 * Run against a local Ollama server, with a tool-calling-capable model pulled:
 *   npx tsx examples/tool-calling.ts
 */
import { z } from 'zod';
import { defineTool, OllamaClient, ToolRegistry } from '../src/index.js';

const client = new OllamaClient({
  baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
});

const getWeather = defineTool({
  name: 'get_weather',
  description: 'Gets the current weather for a city.',
  parameters: z.object({ city: z.string().describe('The city to look up, e.g. "Paris"') }),
  handler: ({ city }) => ({ city, tempC: 21, condition: 'sunny' }),
});

const tools = new ToolRegistry([getWeather]);

async function main(): Promise<void> {
  const messages = [{ role: 'user', content: 'What is the weather in Paris? Use the tool.' }];

  const response = await client.chat({
    model: 'llama3.2',
    messages,
    tools: tools.toOllamaTools(),
  });

  if (!response.message.tool_calls?.length) {
    console.log('Model answered directly:', response.message.content);
    return;
  }

  console.log('Model requested tool calls:', response.message.tool_calls);
  const results = await tools.executeToolCalls(response.message.tool_calls);

  const followUp = await client.chat({
    model: 'llama3.2',
    messages: [...messages, response.message, ...results.map((r) => r.message)],
  });
  console.log('Final answer:', followUp.message.content);
}

main().catch((error: unknown) => {
  console.error('Tool-calling example failed:', error);
  process.exitCode = 1;
});
