import { describe, expect, it } from 'vitest';
import {
  OllamaAbortError,
  OllamaAuthError,
  OllamaClientError,
  OllamaGenericClientError,
  OllamaNetworkError,
  OllamaNotFoundError,
  OllamaRateLimitError,
  OllamaServerError,
  mapError,
} from '../src/errors.js';

class FakeUpstreamResponseError extends Error {
  constructor(
    message: string,
    public status_code: number,
  ) {
    super(message);
    this.name = 'ResponseError';
  }
}

describe('mapError', () => {
  it('returns already-structured errors unchanged', () => {
    const original = new OllamaAuthError('nope');
    expect(mapError(original)).toBe(original);
  });

  it('maps a duck-typed upstream ResponseError to OllamaAuthError for 401', () => {
    const mapped = mapError(new FakeUpstreamResponseError('unauthorized', 401));
    expect(mapped).toBeInstanceOf(OllamaAuthError);
    expect(mapped.status).toBe(401);
    expect(mapped.retryable).toBe(false);
  });

  it('maps a duck-typed upstream ResponseError to OllamaNotFoundError for 404', () => {
    const mapped = mapError(new FakeUpstreamResponseError('missing model', 404));
    expect(mapped).toBeInstanceOf(OllamaNotFoundError);
    expect(mapped.status).toBe(404);
  });

  it('maps a duck-typed upstream ResponseError to OllamaRateLimitError for 429', () => {
    const mapped = mapError(new FakeUpstreamResponseError('slow down', 429));
    expect(mapped).toBeInstanceOf(OllamaRateLimitError);
    expect(mapped.retryable).toBe(true);
  });

  it('maps a duck-typed upstream ResponseError to OllamaServerError for 5xx', () => {
    const mapped = mapError(new FakeUpstreamResponseError('boom', 503));
    expect(mapped).toBeInstanceOf(OllamaServerError);
    expect(mapped.retryable).toBe(true);
  });

  it('maps other 4xx codes to a generic retryable=false client error', () => {
    const mapped = mapError(new FakeUpstreamResponseError('bad request', 400));
    expect(mapped).toBeInstanceOf(OllamaGenericClientError);
    expect(mapped.retryable).toBe(false);
  });

  it('maps a DOMException AbortError to OllamaAbortError', () => {
    const mapped = mapError(new DOMException('Aborted', 'AbortError'));
    expect(mapped).toBeInstanceOf(OllamaAbortError);
    expect(mapped.retryable).toBe(false);
  });

  it('maps a bare TypeError (fetch network failure) to OllamaNetworkError', () => {
    const mapped = mapError(new TypeError('fetch failed'));
    expect(mapped).toBeInstanceOf(OllamaNetworkError);
    expect(mapped.retryable).toBe(true);
  });

  it('maps an arbitrary error with a response status to the right subtype', () => {
    const mapped = mapError(new Error('weird'), { response: { status: 500 } });
    expect(mapped).toBeInstanceOf(OllamaServerError);
  });

  it('falls back to a generic client error for unknown-shaped errors', () => {
    const mapped = mapError('just a string');
    expect(mapped).toBeInstanceOf(OllamaGenericClientError);
    expect(mapped.message).toBe('just a string');
  });

  it('preserves request context for debugging', () => {
    const mapped = mapError(new TypeError('down'), {
      request: { endpoint: '/api/chat', method: 'POST', model: 'llama3.2' },
    });
    expect(mapped.request).toEqual({ endpoint: '/api/chat', method: 'POST', model: 'llama3.2' });
  });

  it('every subtype is an instanceof OllamaClientError', () => {
    expect(new OllamaAuthError('x')).toBeInstanceOf(OllamaClientError);
    expect(new OllamaNetworkError('x')).toBeInstanceOf(OllamaClientError);
  });
});
