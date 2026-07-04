import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { OllamaClient } from '../src/client.js';
import { OllamaStream } from '../src/streaming/stream.js';
import { OllamaNetworkError, OllamaNotFoundError } from '../src/errors.js';
import {
  createScriptedFetch,
  jsonResponse,
  ndjsonResponse,
  resolveUrl,
} from './test-utils/mock-fetch.js';

function chatResponseBody(content: string) {
  return {
    model: 'llama3.2',
    created_at: new Date().toISOString(),
    message: { role: 'assistant', content },
    done: true,
    done_reason: 'stop',
    total_duration: 1,
    load_duration: 1,
    prompt_eval_count: 1,
    prompt_eval_duration: 1,
    eval_count: 1,
    eval_duration: 1,
  };
}

describe('OllamaClient construction', () => {
  it('defaults to http://localhost:11434 with no endpoints configured', async () => {
    const { fetch, calls } = createScriptedFetch([() => jsonResponse(chatResponseBody('hi'))]);
    const client = new OllamaClient({ fetch, retries: 0 });
    await client.chat({ model: 'llama3.2', messages: [] });
    expect(calls[0]?.url).toBe('http://localhost:11434/api/chat');
  });

  it('respects a custom baseUrl and apiKey', async () => {
    const { fetch, calls } = createScriptedFetch([() => jsonResponse(chatResponseBody('hi'))]);
    const client = new OllamaClient({
      baseUrl: 'https://cloud.example.com',
      apiKey: 'secret',
      fetch,
      retries: 0,
    });
    await client.chat({ model: 'llama3.2', messages: [] });
    // ollama-js's formatHost normalizes bare hostnames by appending the default port.
    expect(calls[0]?.url).toBe('https://cloud.example.com:443/api/chat');
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer secret');
  });
});

describe('OllamaClient request mapping', () => {
  it('sends the exact chat payload, stripping client-only fields (signal/timeoutMs)', async () => {
    const { fetch, calls } = createScriptedFetch([() => jsonResponse(chatResponseBody('hi'))]);
    const client = new OllamaClient({ fetch, retries: 0 });
    const controller = new AbortController();

    await client.chat({
      model: 'llama3.2',
      messages: [{ role: 'user', content: 'hello' }],
      signal: controller.signal,
      timeoutMs: 5000,
    });

    const body = JSON.parse(calls[0]?.init?.body as string) as Record<string, unknown>;
    expect(body).toEqual({
      model: 'llama3.2',
      messages: [{ role: 'user', content: 'hello' }],
      stream: false,
    });
  });

  it('returns the parsed non-streaming ChatResponse', async () => {
    const { fetch } = createScriptedFetch([() => jsonResponse(chatResponseBody('Hello there'))]);
    const client = new OllamaClient({ fetch, retries: 0 });
    const response = await client.chat({ model: 'llama3.2', messages: [] });
    expect(response.message.content).toBe('Hello there');
  });
});

describe('OllamaClient streaming', () => {
  it('chatStream returns a normalized OllamaStream and propagates abort to it', async () => {
    const { fetch } = createScriptedFetch([
      () =>
        ndjsonResponse([
          {
            model: 'llama3.2',
            created_at: new Date().toISOString(),
            message: { role: 'assistant', content: 'Hi' },
            done: false,
          },
          { ...chatResponseBody(''), done: true },
        ]),
    ]);
    const client = new OllamaClient({ fetch, retries: 0 });
    const stream = await client.chatStream({ model: 'llama3.2', messages: [] });
    expect(stream).toBeInstanceOf(OllamaStream);

    const events = [];
    for await (const event of stream) {
      events.push(event.type);
    }
    expect(events).toContain('token');
    expect(events).toContain('done');
  });
});

describe('OllamaClient cancellation', () => {
  it('rejects with a network-classified timeout when the per-call timeoutMs elapses before a response', async () => {
    const fetch = vi.fn(() => new Promise<Response>(() => undefined));
    const client = new OllamaClient({ fetch, retries: 0 });
    await expect(
      client.chat({ model: 'llama3.2', messages: [], timeoutMs: 10 }),
    ).rejects.toMatchObject({ code: 'timeout' });
  });

  it('rejects immediately when called with an already-aborted signal', async () => {
    const fetch = vi.fn(() => new Promise<Response>(() => undefined));
    const client = new OllamaClient({ fetch, retries: 0 });
    const controller = new AbortController();
    controller.abort();
    await expect(
      client.chat({ model: 'llama3.2', messages: [], signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'aborted' });
  });
});

describe('OllamaClient structured output', () => {
  it('chatWithSchema validates and parses the model response', async () => {
    const schema = z.object({ answer: z.string() });
    const { fetch, calls } = createScriptedFetch([
      () => jsonResponse(chatResponseBody(JSON.stringify({ answer: '42' }))),
    ]);
    const client = new OllamaClient({ fetch, retries: 0 });

    const result = await client.chatWithSchema(
      { model: 'llama3.2', messages: [{ role: 'user', content: 'What is the answer?' }] },
      schema,
    );

    expect(result).toEqual({ answer: '42' });
    const body = JSON.parse(calls[0]?.init?.body as string) as { format: unknown };
    expect(body.format).toMatchObject({ type: 'object' });
  });
});

describe('OllamaClient model management', () => {
  it('listModels/models both call /api/tags', async () => {
    const { fetch, calls } = createScriptedFetch([() => jsonResponse({ models: [] })]);
    const client = new OllamaClient({ fetch, retries: 0 });
    await client.listModels();
    await client.models();
    expect(calls.every((c) => c.url === 'http://localhost:11434/api/tags')).toBe(true);
  });

  it('showModel maps a 404 to OllamaNotFoundError', async () => {
    const { fetch } = createScriptedFetch([
      () => jsonResponse({ error: 'not found' }, { status: 404 }),
    ]);
    const client = new OllamaClient({ fetch, retries: 0 });
    await expect(client.showModel({ model: 'missing' })).rejects.toBeInstanceOf(
      OllamaNotFoundError,
    );
  });
});

describe('OllamaClient raw fallback', () => {
  it('exposes a raw HTTP client scoped to the active endpoint', async () => {
    const { fetch, calls } = createScriptedFetch([() => new Response(null, { status: 200 })]);
    const client = new OllamaClient({ fetch, retries: 0 });
    await expect(client.raw.blobExists('sha256:abc')).resolves.toBe(true);
    expect(calls[0]?.url).toBe('http://localhost:11434/api/blobs/sha256:abc');
  });
});

describe('OllamaClient multi-endpoint failover', () => {
  it('fails over to the next endpoint when the primary is unreachable', async () => {
    let primaryCalls = 0;
    let secondaryCalls = 0;
    const fetch = vi.fn((input: RequestInfo | URL) => {
      const url = resolveUrl(input);
      if (url.startsWith('http://primary')) {
        primaryCalls += 1;
        return Promise.reject(new TypeError('connection refused'));
      }
      secondaryCalls += 1;
      return Promise.resolve(jsonResponse(chatResponseBody('from secondary')));
    });

    const client = new OllamaClient({
      endpoints: [
        { name: 'primary', baseUrl: 'http://primary:11434', priority: 1 },
        { name: 'secondary', baseUrl: 'http://secondary:11434', priority: 2 },
      ],
      retries: 0,
      fetch,
    });

    const response = await client.chat({ model: 'llama3.2', messages: [] });
    expect(response.message.content).toBe('from secondary');
    expect(primaryCalls).toBe(1);
    expect(secondaryCalls).toBe(1);

    const status = client.endpointStatus();
    expect(status.find((s) => s.name === 'primary')?.consecutiveFailures).toBe(1);
  });

  it('does not fail over for non-failover-eligible errors like not_found', async () => {
    let secondaryCalls = 0;
    const fetch = vi.fn((input: RequestInfo | URL) => {
      const url = resolveUrl(input);
      if (url.startsWith('http://primary')) {
        return Promise.resolve(jsonResponse({ error: 'missing' }, { status: 404 }));
      }
      secondaryCalls += 1;
      return Promise.resolve(jsonResponse(chatResponseBody('from secondary')));
    });

    const client = new OllamaClient({
      endpoints: [
        { name: 'primary', baseUrl: 'http://primary:11434', priority: 1 },
        { name: 'secondary', baseUrl: 'http://secondary:11434', priority: 2 },
      ],
      retries: 0,
      fetch,
    });

    await expect(client.chat({ model: 'llama3.2', messages: [] })).rejects.toBeInstanceOf(
      OllamaNotFoundError,
    );
    expect(secondaryCalls).toBe(0);
  });

  it('throws the last mapped error once every endpoint has failed', async () => {
    const fetch = vi.fn(() => Promise.reject(new TypeError('down')));
    const client = new OllamaClient({
      endpoints: [
        { name: 'a', baseUrl: 'http://a:11434' },
        { name: 'b', baseUrl: 'http://b:11434' },
      ],
      retries: 0,
      fetch,
    });
    await expect(client.chat({ model: 'llama3.2', messages: [] })).rejects.toBeInstanceOf(
      OllamaNetworkError,
    );
  });
});

describe('OllamaClient capability discovery', () => {
  it('runtimeMode reflects the active endpoint', () => {
    const client = new OllamaClient({ baseUrl: 'https://cloud.example.com', fetch: vi.fn() });
    expect(client.runtimeMode()).toBe('cloud');
  });

  it('capabilities() probes /api/show', async () => {
    const { fetch, calls } = createScriptedFetch([
      () =>
        jsonResponse({
          license: '',
          modelfile: '',
          parameters: '',
          template: '',
          system: '',
          details: {},
          messages: [],
          modified_at: new Date().toISOString(),
          model_info: {},
          capabilities: ['tools'],
        }),
    ]);
    const client = new OllamaClient({ fetch, retries: 0 });
    const capabilities = await client.capabilities('llama3.2');
    expect(capabilities.supportsTools).toBe(true);
    expect(calls[0]?.url).toBe('http://localhost:11434/api/show');
  });
});
