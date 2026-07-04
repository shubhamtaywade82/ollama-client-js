/**
 * Retries, timeouts, and cancellation.
 *
 * Run against a local Ollama server:
 *   npx tsx examples/retries-timeouts.ts
 */
import { OllamaClient, OllamaTimeoutError } from '../src/index.js';

async function main(): Promise<void> {
  // Client-wide defaults: up to 3 retries with exponential backoff + jitter,
  // and a 30s timeout for every request unless overridden per call.
  const client = new OllamaClient({
    baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
    timeoutMs: 30_000,
    retries: {
      maxRetries: 3,
      initialDelayMs: 250,
      maxDelayMs: 5_000,
      backoffMultiplier: 2,
      jitter: true,
      retryableStatusCodes: [408, 409, 425, 429, 500, 502, 503, 504],
      retryOnNetworkError: true,
      retryOnTimeout: true,
    },
  });

  // Per-call timeout override: fail fast for a latency-sensitive path.
  try {
    await client.chat({
      model: 'llama3.2',
      messages: [{ role: 'user', content: 'Hi' }],
      timeoutMs: 2_000,
    });
  } catch (error) {
    if (error instanceof OllamaTimeoutError) {
      console.log(`Timed out after ${error.timeoutMs}ms - falling back to a cheaper model.`);
    } else {
      throw error;
    }
  }

  // Per-call cancellation via AbortController.
  const controller = new AbortController();
  const pending = client.chat({
    model: 'llama3.2',
    messages: [{ role: 'user', content: 'Write a long essay.' }],
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 500);

  try {
    await pending;
  } catch (error) {
    console.log('Request was cancelled:', error);
  }
}

main().catch((error: unknown) => {
  console.error('Unexpected failure:', error);
  process.exitCode = 1;
});
