/**
 * The opt-in `Agent` loop: send a chat request with tools, execute whatever tool calls the model
 * makes, feed results back, repeat until a tool-call-free final answer (or `maxIterations`).
 *
 * Run against a local Ollama server, with a tool-calling-capable model pulled:
 *   npx tsx examples/agent-loop.ts
 */
import { z } from 'zod';
import { Agent, defineTool, OllamaClient, ToolRegistry } from '../src/index.js';

const client = new OllamaClient({
  baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
});

const getWeather = defineTool({
  name: 'get_weather',
  description: 'Gets the current weather for a city.',
  parameters: z.object({ city: z.string() }),
  handler: ({ city }) => ({ city, tempC: 21, condition: 'sunny' }),
});

const convertTemperature = defineTool({
  name: 'celsius_to_fahrenheit',
  description: 'Converts a Celsius temperature to Fahrenheit.',
  parameters: z.object({ celsius: z.number() }),
  handler: ({ celsius }) => ({ fahrenheit: celsius * (9 / 5) + 32 }),
});

const agent = new Agent(client, {
  tools: new ToolRegistry([getWeather, convertTemperature]),
  maxIterations: 6,
  hooks: {
    onToolCall: ({ turn, toolCall }) =>
      console.log(
        `[turn ${turn}] calling ${toolCall.function.name}(${JSON.stringify(toolCall.function.arguments)})`,
      ),
    onToolResult: ({ turn, result }) =>
      console.log(
        `[turn ${turn}] ${result.name} -> ${result.ok ? JSON.stringify(result.result) : result.error?.message}`,
      ),
  },
});

async function main(): Promise<void> {
  const result = await agent.run({
    model: 'llama3.2',
    messages: [{ role: 'user', content: 'What is the weather in Paris, in Fahrenheit?' }],
  });

  console.log('\nFinal answer:', result.finalMessage.content);
  console.log(`(${result.iterations} turn(s))`);
}

main().catch((error: unknown) => {
  console.error('Agent-loop example failed:', error);
  process.exitCode = 1;
});
