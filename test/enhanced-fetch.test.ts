import { describe, expect, it, vi } from 'vitest';
import { createEnhancedFetch } from '../src/transport/enhanced-fetch.js';
import { MiddlewarePipeline } from '../src/middleware.js';
import { noopLogger } from '../src/logger.js';
import { normalizeRetryConfig } from '../src/transport/retry.js';
import type { RetryConfig } from '../src/transport/retry.js';
import { OllamaAbortError, OllamaNetworkError, OllamaTimeoutError } from '../src/errors.js';
import { jsonResponse, createScriptedFetch } from './test-utils/mock-fetch.js';

function noRetryDelayConfig(overrides: Partial<RetryConfig> = {}): RetryConfig {
  return normalizeRetryConfig({ initialDelayMs: 1, maxDelayMs: 1, jitter: false, ...overrides });
}

describe('createEnhancedFetch', () => {
  it('returns a successful response on the first attempt without retrying', async () => {
    const { fetch: baseFetch, calls } = createScriptedFetch([() => jsonResponse({ ok: true })]);
    const enhanced = createEnhancedFetch({
      fetchImpl: baseFetch,
      retry: noRetryDelayConfig(),
      middleware: new MiddlewarePipeline(),
      logger: noopLogger,
      onLifecycleEvent: () => undefined,
    });

    const response = await enhanced('http://localhost:11434/api/tags');
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
  });

  it('retries a retryable status code and eventually succeeds', async () => {
    const { fetch: baseFetch, calls } = createScriptedFetch([
      () => jsonResponse({ error: 'unavailable' }, { status: 503 }),
      () => jsonResponse({ error: 'unavailable' }, { status: 503 }),
      () => jsonResponse({ ok: true }),
    ]);
    const enhanced = createEnhancedFetch({
      fetchImpl: baseFetch,
      retry: noRetryDelayConfig({ maxRetries: 2 }),
      middleware: new MiddlewarePipeline(),
      logger: noopLogger,
      onLifecycleEvent: () => undefined,
    });

    const response = await enhanced('http://localhost:11434/api/tags');
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(3);
  });

  it('gives up after maxRetries and returns the last non-ok response', async () => {
    const { fetch: baseFetch, calls } = createScriptedFetch([
      () => jsonResponse({ error: 'unavailable' }, { status: 503 }),
    ]);
    const enhanced = createEnhancedFetch({
      fetchImpl: baseFetch,
      retry: noRetryDelayConfig({ maxRetries: 2 }),
      middleware: new MiddlewarePipeline(),
      logger: noopLogger,
      onLifecycleEvent: () => undefined,
    });

    const response = await enhanced('http://localhost:11434/api/tags');
    expect(response.status).toBe(503);
    expect(calls).toHaveLength(3); // initial + 2 retries
  });

  it('does not retry non-retryable status codes', async () => {
    const { fetch: baseFetch, calls } = createScriptedFetch([
      () => jsonResponse({ error: 'bad request' }, { status: 400 }),
    ]);
    const enhanced = createEnhancedFetch({
      fetchImpl: baseFetch,
      retry: noRetryDelayConfig({ maxRetries: 3 }),
      middleware: new MiddlewarePipeline(),
      logger: noopLogger,
      onLifecycleEvent: () => undefined,
    });

    const response = await enhanced('http://localhost:11434/api/tags');
    expect(response.status).toBe(400);
    expect(calls).toHaveLength(1);
  });

  it('retries bare network errors (TypeError) and eventually succeeds', async () => {
    let attempt = 0;
    const baseFetch = vi.fn(() => {
      attempt += 1;
      if (attempt < 3) return Promise.reject(new TypeError('fetch failed'));
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    const enhanced = createEnhancedFetch({
      fetchImpl: baseFetch,
      retry: noRetryDelayConfig({ maxRetries: 2 }),
      middleware: new MiddlewarePipeline(),
      logger: noopLogger,
      onLifecycleEvent: () => undefined,
    });

    const response = await enhanced('http://localhost:11434/api/tags');
    expect(response.status).toBe(200);
    expect(baseFetch).toHaveBeenCalledTimes(3);
  });

  it('throws OllamaNetworkError after exhausting retries on a persistent network failure', async () => {
    const baseFetch = vi.fn(() => Promise.reject(new TypeError('fetch failed')));
    const enhanced = createEnhancedFetch({
      fetchImpl: baseFetch,
      retry: noRetryDelayConfig({ maxRetries: 1 }),
      middleware: new MiddlewarePipeline(),
      logger: noopLogger,
      onLifecycleEvent: () => undefined,
    });

    await expect(enhanced('http://localhost:11434/api/tags')).rejects.toBeInstanceOf(
      OllamaNetworkError,
    );
    expect(baseFetch).toHaveBeenCalledTimes(2);
  });

  it('throws OllamaTimeoutError when the request exceeds timeoutMs', async () => {
    const baseFetch: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    const enhanced = createEnhancedFetch({
      fetchImpl: baseFetch,
      timeoutMs: 10,
      retry: noRetryDelayConfig({ maxRetries: 0 }),
      middleware: new MiddlewarePipeline(),
      logger: noopLogger,
      onLifecycleEvent: () => undefined,
    });

    await expect(enhanced('http://localhost:11434/api/tags')).rejects.toBeInstanceOf(
      OllamaTimeoutError,
    );
  });

  it('throws OllamaAbortError when the caller aborts, and never retries', async () => {
    const controller = new AbortController();
    const baseFetch = vi.fn(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
          }
          signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    const enhanced = createEnhancedFetch({
      fetchImpl: baseFetch,
      retry: noRetryDelayConfig({ maxRetries: 3 }),
      middleware: new MiddlewarePipeline(),
      logger: noopLogger,
      onLifecycleEvent: () => undefined,
    });

    const promise = enhanced('http://localhost:11434/api/tags', { signal: controller.signal });
    controller.abort();

    await expect(promise).rejects.toBeInstanceOf(OllamaAbortError);
    expect(baseFetch).toHaveBeenCalledTimes(1);
  });

  it('injects auth headers on every attempt via getAuthHeaders', async () => {
    const { fetch: baseFetch, calls } = createScriptedFetch([() => jsonResponse({ ok: true })]);
    const enhanced = createEnhancedFetch({
      fetchImpl: baseFetch,
      retry: noRetryDelayConfig(),
      middleware: new MiddlewarePipeline(),
      logger: noopLogger,
      onLifecycleEvent: () => undefined,
      getAuthHeaders: () => ({ authorization: 'Bearer secret-key' }),
    });

    await enhanced('http://localhost:11434/api/chat', { method: 'POST', body: '{}' });
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer secret-key');
  });

  it('runs request/response middleware and lets it override the retry decision', async () => {
    const { fetch: baseFetch, calls } = createScriptedFetch([
      () => jsonResponse({ error: 'unavailable' }, { status: 503 }),
    ]);
    const requestSeen: string[] = [];
    const responseSeen: number[] = [];
    const enhanced = createEnhancedFetch({
      fetchImpl: baseFetch,
      retry: noRetryDelayConfig({ maxRetries: 5 }),
      middleware: new MiddlewarePipeline([
        {
          onRequest: (ctx) => void requestSeen.push(ctx.request.url),
          onResponse: (ctx) => void responseSeen.push(ctx.response.status),
          shouldRetry: () => false, // force no retry even though 503 is normally retryable
        },
      ]),
      logger: noopLogger,
      onLifecycleEvent: () => undefined,
    });

    const response = await enhanced('http://localhost:11434/api/tags');
    expect(response.status).toBe(503);
    expect(calls).toHaveLength(1);
    expect(requestSeen).toEqual(['http://localhost:11434/api/tags']);
    expect(responseSeen).toEqual([503]);
  });

  it('emits request lifecycle events for start, retry, and success', async () => {
    const { fetch: baseFetch } = createScriptedFetch([
      () => jsonResponse({ error: 'unavailable' }, { status: 503 }),
      () => jsonResponse({ ok: true }),
    ]);
    const events: string[] = [];
    const enhanced = createEnhancedFetch({
      fetchImpl: baseFetch,
      retry: noRetryDelayConfig({ maxRetries: 1 }),
      middleware: new MiddlewarePipeline(),
      logger: noopLogger,
      onLifecycleEvent: (event) => events.push(event.type),
    });

    await enhanced('http://localhost:11434/api/tags');
    expect(events).toEqual(['request:start', 'request:retry', 'request:start', 'request:success']);
  });
});
