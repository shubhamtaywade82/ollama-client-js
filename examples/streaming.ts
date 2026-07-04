/**
 * Streaming chat: both the async-iterator style and the event-based style.
 *
 * Run against a local Ollama server:
 *   npx tsx examples/streaming.ts
 */
import { OllamaClient } from '../src/index.js';

const client = new OllamaClient({
  baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
});

async function withAsyncIterator(): Promise<void> {
  console.log('\n--- async iterator ---');
  const stream = await client.chatStream({
    model: 'llama3.2',
    messages: [{ role: 'user', content: 'Count from 1 to 5.' }],
  });

  for await (const event of stream) {
    if (event.type === 'token') {
      process.stdout.write(event.data.delta);
    } else if (event.type === 'done') {
      console.log(`\n[done in ${event.data.result.totalDurationMs?.toFixed(0)}ms]`);
    }
  }
}

async function withEventListeners(): Promise<void> {
  console.log('\n--- event listeners ---');
  const stream = await client.chatStream({
    model: 'llama3.2',
    messages: [{ role: 'user', content: 'Name three colors.' }],
  });

  stream.on('token', (event) => process.stdout.write(event.data.delta));
  stream.on('error', (event) => console.error('\nstream error:', event.data.error));

  const result = await stream.finalResult;
  console.log(`\n[final message: "${result.message.content}"]`);
}

async function main(): Promise<void> {
  await withAsyncIterator();
  await withEventListeners();
}

main().catch((error: unknown) => {
  console.error('Streaming example failed:', error);
  process.exitCode = 1;
});
