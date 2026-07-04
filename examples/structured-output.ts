/**
 * Structured output with Zod: the model's response is constrained to a JSON
 * Schema derived from your Zod schema, then parsed and validated for you.
 *
 * Run against a local Ollama server:
 *   npx tsx examples/structured-output.ts
 */
import { z } from 'zod';
import { OllamaClient } from '../src/index.js';

const client = new OllamaClient({
  baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
});

const MovieReview = z.object({
  title: z.string(),
  rating: z.number().min(0).max(10),
  summary: z.string(),
});

async function main(): Promise<void> {
  const review = await client.chatWithSchema(
    {
      model: 'llama3.2',
      messages: [
        {
          role: 'user',
          content: 'Give me a short review of the movie "The Matrix" as structured data.',
        },
      ],
    },
    MovieReview,
  );

  // `review` is `{ title: string; rating: number; summary: string }`,
  // already validated - no manual JSON.parse or shape-checking needed.
  console.log(review);
}

main().catch((error: unknown) => {
  console.error('Structured output request failed:', error);
  process.exitCode = 1;
});
