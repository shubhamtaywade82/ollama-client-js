/**
 * Raw HTTP fallback: talking to an endpoint `ollama-js` doesn't wrap yet,
 * using the blob upload API that backs `createModel()` for local layers.
 *
 * Run against a local Ollama server:
 *   npx tsx examples/fallback-transport.ts
 */
import { createHash } from 'node:crypto';
import { OllamaClient } from '../src/index.js';

const client = new OllamaClient({
  baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
});

async function main(): Promise<void> {
  const layer = Buffer.from('FROM llama3.2\nSYSTEM "You are terse."\n', 'utf8');
  const digest = `sha256:${createHash('sha256').update(layer).digest('hex')}`;

  const alreadyUploaded = await client.raw.blobExists(digest);
  if (!alreadyUploaded) {
    await client.raw.pushBlob(digest, layer);
    console.log(`Uploaded blob ${digest}`);
  } else {
    console.log(`Blob ${digest} already present on the server`);
  }

  // Generic escape hatch for any endpoint not yet wrapped by this client,
  // still going through the same retry/timeout/middleware pipeline.
  const version = await client.raw.requestJson<{ version: string }>({ path: '/api/version' });
  console.log('Server version (via raw fallback):', version.version);
}

main().catch((error: unknown) => {
  console.error('Raw fallback request failed:', error);
  process.exitCode = 1;
});
