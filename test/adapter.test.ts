import { describe, expect, it } from 'vitest';
import { OllamaAdapter } from '../src/adapter/ollama-adapter.js';
import { OllamaNotFoundError, OllamaValidationError } from '../src/errors.js';
import { createScriptedFetch, jsonResponse, ndjsonResponse } from './test-utils/mock-fetch.js';

describe('OllamaAdapter', () => {
  it('sends non-streaming chat requests and returns the parsed response', async () => {
    const { fetch, calls } = createScriptedFetch([
      () =>
        jsonResponse({
          model: 'llama3.2',
          created_at: new Date().toISOString(),
          message: { role: 'assistant', content: 'Hi there' },
          done: true,
          done_reason: 'stop',
          total_duration: 1,
          load_duration: 1,
          prompt_eval_count: 1,
          prompt_eval_duration: 1,
          eval_count: 1,
          eval_duration: 1,
        }),
    ]);
    const adapter = new OllamaAdapter({ host: 'http://localhost:11434', fetch });

    const response = await adapter.chat({
      model: 'llama3.2',
      messages: [{ role: 'user', content: 'hello' }],
      stream: false,
    });

    expect(response.message.content).toBe('Hi there');
    expect(calls[0]?.url).toBe('http://localhost:11434/api/chat');
    const body = JSON.parse(calls[0]?.init?.body as string) as { stream: boolean };
    expect(body.stream).toBe(false);
  });

  it('streams chat responses via an async iterator', async () => {
    const { fetch } = createScriptedFetch([
      () =>
        ndjsonResponse([
          {
            model: 'llama3.2',
            created_at: new Date().toISOString(),
            message: { role: 'assistant', content: 'Hi' },
            done: false,
          },
          {
            model: 'llama3.2',
            created_at: new Date().toISOString(),
            message: { role: 'assistant', content: '' },
            done: true,
            done_reason: 'stop',
            total_duration: 1,
            load_duration: 1,
            prompt_eval_count: 1,
            prompt_eval_duration: 1,
            eval_count: 1,
            eval_duration: 1,
          },
        ]),
    ]);
    const adapter = new OllamaAdapter({ host: 'http://localhost:11434', fetch });

    const stream = await adapter.chat({
      model: 'llama3.2',
      messages: [{ role: 'user', content: 'hello' }],
      stream: true,
    });

    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.message.content).toBe('Hi');
  });

  it('maps a 404 response to OllamaNotFoundError', async () => {
    const { fetch } = createScriptedFetch([
      () => jsonResponse({ error: 'model "missing" not found' }, { status: 404 }),
    ]);
    const adapter = new OllamaAdapter({ host: 'http://localhost:11434', fetch });

    await expect(adapter.show({ model: 'missing' })).rejects.toBeInstanceOf(OllamaNotFoundError);
  });

  it('never maps request-shape errors to validation errors it did not raise itself', async () => {
    // Sanity check: adapter-level mapping is purely status/network driven;
    // OllamaValidationError is only raised by the schema helpers, not the adapter.
    const { fetch } = createScriptedFetch([
      () => jsonResponse({ error: 'bad request' }, { status: 400 }),
    ]);
    const adapter = new OllamaAdapter({ host: 'http://localhost:11434', fetch });
    await expect(adapter.list()).rejects.not.toBeInstanceOf(OllamaValidationError);
  });

  it('lists models', async () => {
    const { fetch, calls } = createScriptedFetch([
      () =>
        jsonResponse({
          models: [
            {
              name: 'llama3.2',
              modified_at: new Date().toISOString(),
              model: 'llama3.2',
              size: 1,
              digest: 'abc',
              details: {},
              expires_at: new Date().toISOString(),
              size_vram: 0,
            },
          ],
        }),
    ]);
    const adapter = new OllamaAdapter({ host: 'http://localhost:11434', fetch });
    const result = await adapter.list();
    expect(result.models).toHaveLength(1);
    expect(calls[0]?.init?.method ?? 'GET').toBe('GET');
  });
});
