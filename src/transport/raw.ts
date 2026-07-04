import { mapError } from '../errors.js';
import type { OllamaClientError } from '../errors.js';
import type { FetchLike } from './enhanced-fetch.js';

/**
 * Raw HTTP escape hatch.
 *
 * `ollama-js` only wraps a subset of the Ollama HTTP API. When a caller
 * needs an endpoint the upstream client doesn't expose yet - such as the
 * blob upload endpoints used when creating models from local layers, or a
 * brand new API surface added to a newer Ollama server than the installed
 * `ollama` version knows about - this client falls back to a raw HTTP
 * request through the same enhanced `fetch` (retries, timeouts, middleware,
 * auth headers all still apply).
 */

export interface RawRequestOptions {
  readonly method?: string;
  /** Path relative to the client's base URL, e.g. `/api/blobs/sha256:...`. */
  readonly path: string;
  /** JSON-serializable value, or a raw `BodyInit` (string/Blob/ArrayBuffer/etc). */
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
  readonly signal?: AbortSignal;
}

function isBodyInitLike(value: unknown): value is BodyInit {
  return (
    typeof value === 'string' ||
    value instanceof Uint8Array ||
    value instanceof ArrayBuffer ||
    value instanceof Blob ||
    value instanceof FormData ||
    value instanceof URLSearchParams ||
    value instanceof ReadableStream
  );
}

async function toClientError(
  response: Response,
  request: { method?: string; path: string },
): Promise<OllamaClientError> {
  let message = `Request failed with status ${response.status}`;
  let body: unknown;
  const contentType = response.headers.get('content-type') ?? '';
  try {
    if (contentType.includes('application/json')) {
      body = await response.json();
      if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
        message = body.error;
      }
    } else {
      const text = await response.text();
      body = text;
      if (text) message = text;
    }
  } catch {
    // Leave `message` as the generic fallback if the body can't be parsed.
  }

  return mapError(new Error(message), {
    request: { method: request.method ?? 'GET', url: request.path, endpoint: request.path },
    response: { status: response.status, statusText: response.statusText, body },
  });
}

export class RawHttpClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: FetchLike,
  ) {}

  /** Sends a raw HTTP request relative to the client's base URL. Does not throw on non-2xx responses. */
  async request(options: RawRequestOptions): Promise<Response> {
    const url = new URL(options.path, this.baseUrl).toString();
    const { body: optionsBody } = options;
    const jsonBody = optionsBody !== undefined && !isBodyInitLike(optionsBody);
    const init: RequestInit = {
      method: options.method ?? (optionsBody !== undefined ? 'POST' : 'GET'),
      headers: {
        ...(jsonBody ? { 'content-type': 'application/json' } : {}),
        ...options.headers,
      },
      body:
        optionsBody === undefined
          ? undefined
          : isBodyInitLike(optionsBody)
            ? optionsBody
            : JSON.stringify(optionsBody),
      signal: options.signal,
    };
    return this.fetchImpl(url, init);
  }

  /** Like {@link request}, but parses and returns a JSON body, throwing a structured error on failure. */
  async requestJson<T>(options: RawRequestOptions): Promise<T> {
    const response = await this.request(options);
    if (!response.ok) {
      throw await toClientError(response, options);
    }
    return (await response.json()) as T;
  }

  /** Checks whether a file blob already exists on the server (`HEAD /api/blobs/:digest`). */
  async blobExists(digest: string, signal?: AbortSignal): Promise<boolean> {
    const response = await this.request({ method: 'HEAD', path: `/api/blobs/${digest}`, signal });
    if (response.status === 200) return true;
    if (response.status === 404) return false;
    throw await toClientError(response, { method: 'HEAD', path: `/api/blobs/${digest}` });
  }

  /** Uploads a file blob (`POST /api/blobs/:digest`) so it can be referenced when creating a model. */
  async pushBlob(digest: string, data: BodyInit, signal?: AbortSignal): Promise<void> {
    const response = await this.request({
      method: 'POST',
      path: `/api/blobs/${digest}`,
      body: data,
      signal,
    });
    if (!response.ok) {
      throw await toClientError(response, { method: 'POST', path: `/api/blobs/${digest}` });
    }
  }
}
