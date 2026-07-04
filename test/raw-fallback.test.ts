import { describe, expect, it } from 'vitest';
import { RawHttpClient } from '../src/transport/raw.js';
import { OllamaNotFoundError, OllamaServerError } from '../src/errors.js';
import { createScriptedFetch, jsonResponse, textResponse } from './test-utils/mock-fetch.js';

describe('RawHttpClient', () => {
  it('sends GET requests by default and resolves the URL against the base URL', async () => {
    const { fetch, calls } = createScriptedFetch([() => jsonResponse({ hello: 'world' })]);
    const client = new RawHttpClient('http://localhost:11434', fetch);

    const response = await client.request({ path: '/api/custom' });
    expect(response.status).toBe(200);
    expect(calls[0]?.url).toBe('http://localhost:11434/api/custom');
    expect(calls[0]?.init?.method).toBe('GET');
  });

  it('JSON-encodes plain object bodies and sets the content-type header', async () => {
    const { fetch, calls } = createScriptedFetch([() => jsonResponse({ ok: true })]);
    const client = new RawHttpClient('http://localhost:11434', fetch);

    await client.request({ path: '/api/thing', body: { a: 1 } });
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ a: 1 }));
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
  });

  it('passes through raw BodyInit values (e.g. a string) without JSON-encoding', async () => {
    const { fetch, calls } = createScriptedFetch([() => jsonResponse({ ok: true })]);
    const client = new RawHttpClient('http://localhost:11434', fetch);

    await client.request({ path: '/api/blobs/sha256:abc', method: 'POST', body: 'raw-bytes' });
    expect(calls[0]?.init?.body).toBe('raw-bytes');
  });

  it('requestJson returns the parsed body on success', async () => {
    const { fetch } = createScriptedFetch([() => jsonResponse({ version: '0.6.3' })]);
    const client = new RawHttpClient('http://localhost:11434', fetch);
    const result = await client.requestJson<{ version: string }>({ path: '/api/version' });
    expect(result.version).toBe('0.6.3');
  });

  it('requestJson throws a structured error on a non-2xx JSON error response', async () => {
    const { fetch } = createScriptedFetch([
      () => jsonResponse({ error: 'model not found' }, { status: 404 }),
    ]);
    const client = new RawHttpClient('http://localhost:11434', fetch);
    await expect(client.requestJson({ path: '/api/show' })).rejects.toBeInstanceOf(
      OllamaNotFoundError,
    );
  });

  it('requestJson throws a structured error using the text body when not JSON', async () => {
    const { fetch } = createScriptedFetch([() => textResponse('internal error', { status: 500 })]);
    const client = new RawHttpClient('http://localhost:11434', fetch);
    await expect(client.requestJson({ path: '/api/whatever' })).rejects.toBeInstanceOf(
      OllamaServerError,
    );
  });

  describe('blobExists', () => {
    it('returns true for a 200 HEAD response', async () => {
      const { fetch, calls } = createScriptedFetch([() => new Response(null, { status: 200 })]);
      const client = new RawHttpClient('http://localhost:11434', fetch);
      await expect(client.blobExists('sha256:abc')).resolves.toBe(true);
      expect(calls[0]?.init?.method).toBe('HEAD');
    });

    it('returns false for a 404 HEAD response', async () => {
      const { fetch } = createScriptedFetch([() => new Response(null, { status: 404 })]);
      const client = new RawHttpClient('http://localhost:11434', fetch);
      await expect(client.blobExists('sha256:missing')).resolves.toBe(false);
    });

    it('throws for other status codes', async () => {
      const { fetch } = createScriptedFetch([() => new Response(null, { status: 500 })]);
      const client = new RawHttpClient('http://localhost:11434', fetch);
      await expect(client.blobExists('sha256:err')).rejects.toBeInstanceOf(OllamaServerError);
    });
  });

  describe('pushBlob', () => {
    it('resolves when the upload succeeds', async () => {
      const { fetch, calls } = createScriptedFetch([() => new Response(null, { status: 201 })]);
      const client = new RawHttpClient('http://localhost:11434', fetch);
      await expect(client.pushBlob('sha256:abc', 'binary-data')).resolves.toBeUndefined();
      expect(calls[0]?.init?.method).toBe('POST');
      expect(calls[0]?.url).toBe('http://localhost:11434/api/blobs/sha256:abc');
    });

    it('throws a structured error when the upload fails', async () => {
      const { fetch } = createScriptedFetch([
        () => jsonResponse({ error: 'bad digest' }, { status: 400 }),
      ]);
      const client = new RawHttpClient('http://localhost:11434', fetch);
      await expect(client.pushBlob('sha256:bad', 'x')).rejects.toThrow('bad digest');
    });
  });
});
