/**
 * Custom middleware: request logging, response timing, and overriding the
 * default retry decision for a specific status code.
 *
 * Run against a local Ollama server:
 *   npx tsx examples/custom-middleware.ts
 */
import type { Middleware } from '../src/index.js';
import { OllamaClient } from '../src/index.js';

const loggingMiddleware: Middleware = {
  name: 'logging',
  onRequest(ctx) {
    console.log(
      `[${ctx.requestId}] -> ${ctx.request.method} ${ctx.request.url} (attempt ${ctx.attempt})`,
    );
  },
  onResponse(ctx) {
    console.log(`[${ctx.requestId}] <- ${ctx.response.status} in ${ctx.durationMs}ms`);
  },
  onError(ctx) {
    console.log(`[${ctx.requestId}] x ${String(ctx.error)} after ${ctx.durationMs}ms`);
  },
};

const neverRetryOnConflictMiddleware: Middleware = {
  name: 'no-retry-on-409',
  shouldRetry(ctx) {
    if (ctx.response?.status === 409) return false;
    return undefined; // defer to the default policy for everything else
  },
};

const client = new OllamaClient({
  baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
  middleware: [loggingMiddleware, neverRetryOnConflictMiddleware],
});

async function main(): Promise<void> {
  const models = await client.listModels();
  console.log(
    'Available models:',
    models.map((m) => m.name),
  );
}

main().catch((error: unknown) => {
  console.error('Request failed:', error);
  process.exitCode = 1;
});
