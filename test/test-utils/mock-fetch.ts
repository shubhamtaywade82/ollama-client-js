import type { FetchLike } from '../../src/transport/enhanced-fetch.js';

export interface RecordedCall {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

export function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

export function textResponse(text: string, init: { status?: number } = {}): Response {
  return new Response(text, {
    status: init.status ?? 200,
    headers: { 'content-type': 'text/plain' },
  });
}

/** Builds a newline-delimited-JSON streaming response, matching Ollama's streaming wire format. */
export function ndjsonResponse(
  chunks: readonly unknown[],
  init: { status?: number } = {},
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(`${JSON.stringify(chunk)}\n`));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/x-ndjson' },
  });
}

type Handler = (url: string, init: RequestInit | undefined) => Response | Promise<Response>;

export function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

/**
 * A `fetch` test double driven by an ordered list of handlers: each call
 * consumes the next handler (the last handler repeats once exhausted), so
 * tests can script exact sequences like "fail twice, then succeed".
 */
export function createScriptedFetch(handlers: readonly Handler[]): {
  fetch: FetchLike;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  let index = 0;

  const fetch: FetchLike = (input, init) => {
    const url = resolveUrl(input);
    calls.push({ url, init });
    const handlerIndex = Math.min(index, handlers.length - 1);
    const handler = handlers[handlerIndex];
    index += 1;
    if (!handler) {
      throw new Error('createScriptedFetch requires at least one handler');
    }
    return Promise.resolve(handler(url, init));
  };

  return { fetch, calls };
}

/** A `fetch` test double that always returns the same response (or invokes the same handler). */
export function createStaticFetch(handler: Handler): { fetch: FetchLike; calls: RecordedCall[] } {
  return createScriptedFetch([handler]);
}
