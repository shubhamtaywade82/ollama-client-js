/**
 * Basic, non-streaming chat.
 *
 * Run against a local Ollama server:
 *   npx tsx examples/basic-chat.ts
 *
 * In your own project, import from the published package instead:
 *   import { OllamaClient } from 'ollama-client-js';
 */
import { OllamaClient } from '../src/index.js';

const client = new OllamaClient({
  baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
  apiKey: process.env.OLLAMA_API_KEY,
  timeoutMs: 30_000,
  retries: 2,
});

async function main(): Promise<void> {
  const response = await client.chat({
    model: 'llama3.2',
    messages: [{ role: 'user', content: 'Say hello in one short sentence.' }],
  });

  console.log(response.message.content);
  console.log(`(model: ${response.model}, done_reason: ${response.done_reason})`);
}

main().catch((error: unknown) => {
  console.error('Chat request failed:', error);
  process.exitCode = 1;
});
