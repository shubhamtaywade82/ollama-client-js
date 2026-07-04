import type { Logger, RequestLifecycleHook } from '../logger.js';
import { OllamaAbortError, OllamaNetworkError, OllamaTimeoutError, mapError } from '../errors.js';
import type { OllamaClientError } from '../errors.js';
import type { MiddlewarePipeline } from '../middleware.js';
import { computeBackoffDelayMs } from './backoff.js';
import type { RetryConfig } from './retry.js';
import { isRetryableStatus } from './retry.js';
import { createTimeoutSignal, errorFromAbortSignal, isAbortError, sleep } from './timeout.js';

export type FetchLike = typeof fetch;

export interface EnhancedFetchConfig {
  readonly fetchImpl: FetchLike;
  readonly timeoutMs?: number;
  readonly retry: RetryConfig;
  readonly middleware: MiddlewarePipeline;
  readonly logger: Logger;
  readonly onLifecycleEvent: RequestLifecycleHook;
  /** Returns headers (e.g. `Authorization`) to attach to every request. Called fresh on every attempt to support key rotation. */
  readonly getAuthHeaders?: () => Record<string, string> | undefined;
  /** Static headers merged in before auth headers and per-request headers. */
  readonly baseHeaders?: Record<string, string>;
  /** Reports the final outcome of a (possibly retried) request, for health tracking. */
  readonly reportOutcome?: (success: boolean, error?: unknown) => void;
}

function normalizeHeaders(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    const out: Record<string, string> = {};
    headers.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  return { ...headers };
}

function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function tryParseJsonBody(body: BodyInit | null | undefined): unknown {
  if (typeof body !== 'string') return undefined;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function classifyThrownError(
  error: unknown,
  signal: AbortSignal,
): OllamaTimeoutError | OllamaAbortError | OllamaNetworkError | OllamaClientError {
  if (isAbortError(error)) {
    const classified = errorFromAbortSignal(signal);
    return classified instanceof OllamaTimeoutError
      ? new OllamaTimeoutError(classified.message, {
          timeoutMs: classified.timeoutMs,
          cause: error,
        })
      : new OllamaAbortError(classified.message, { cause: error });
  }
  return mapError(error);
}

/**
 * Builds a `fetch`-compatible function that layers retries, timeouts,
 * middleware, and auth-header injection on top of a base `fetch`
 * implementation. The result can be passed directly as `Config.fetch` to the
 * upstream `ollama` client, or used standalone for raw HTTP fallback calls.
 */
export function createEnhancedFetch(config: EnhancedFetchConfig): FetchLike {
  return async function enhancedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const url = resolveUrl(input);
    const method = init?.method ?? 'GET';
    const requestId = generateRequestId();
    let attempt = 0;

    for (;;) {
      attempt += 1;

      const headers: Record<string, string> = {
        ...config.baseHeaders,
        ...normalizeHeaders(init?.headers),
        ...config.getAuthHeaders?.(),
      };
      const requestCtx = {
        request: { url, method, headers, body: tryParseJsonBody(init?.body) },
        attempt,
        requestId,
        meta: {},
      };
      await config.middleware.runRequest(requestCtx);

      const { signal, cancel } = createTimeoutSignal(config.timeoutMs, init?.signal ?? undefined);
      const start = Date.now();
      config.onLifecycleEvent({ type: 'request:start', requestId, method, url, attempt });

      let response: Response | undefined;
      let thrown: unknown;
      try {
        response = await config.fetchImpl(input, {
          ...init,
          headers: requestCtx.request.headers,
          signal,
        });
      } catch (error) {
        thrown = error;
      } finally {
        cancel();
      }
      const durationMs = Date.now() - start;

      if (response) {
        const responseCtx = { ...requestCtx, response, durationMs };
        await config.middleware.runResponse(responseCtx);

        if (response.ok) {
          config.onLifecycleEvent({
            type: 'request:success',
            requestId,
            method,
            url,
            attempt,
            status: response.status,
            durationMs,
          });
          config.reportOutcome?.(true);
          return response;
        }

        const retryableStatus = isRetryableStatus(response.status, config.retry);
        const defaultDecision = retryableStatus && attempt <= config.retry.maxRetries;
        const shouldRetry = await config.middleware.decideRetry({
          ...requestCtx,
          response,
          defaultDecision,
        });

        if (!shouldRetry) {
          config.reportOutcome?.(false);
          return response;
        }

        await response.body?.cancel().catch(() => undefined);
        const delayMs = computeBackoffDelayMs(attempt - 1, config.retry);
        config.onLifecycleEvent({
          type: 'request:retry',
          requestId,
          method,
          url,
          attempt,
          delayMs,
          reason: `HTTP ${response.status}`,
        });
        await sleep(delayMs);
        continue;
      }

      const mapped = classifyThrownError(thrown, signal);
      const errorCtx = { ...requestCtx, error: mapped, durationMs };
      await config.middleware.runError(errorCtx);
      config.onLifecycleEvent({
        type: 'request:error',
        requestId,
        method,
        url,
        attempt,
        durationMs,
        error: mapped,
      });

      const isUserAbort = mapped instanceof OllamaAbortError;
      const isTimeout = mapped instanceof OllamaTimeoutError;
      const isNetwork = mapped instanceof OllamaNetworkError;
      const retryableError =
        !isUserAbort &&
        ((isTimeout && config.retry.retryOnTimeout) ||
          (isNetwork && config.retry.retryOnNetworkError));
      const defaultDecision = retryableError && attempt <= config.retry.maxRetries;
      const shouldRetry = await config.middleware.decideRetry({
        ...requestCtx,
        error: mapped,
        defaultDecision,
      });

      if (!shouldRetry) {
        config.reportOutcome?.(false, mapped);
        throw mapped;
      }

      const delayMs = computeBackoffDelayMs(attempt - 1, config.retry);
      config.onLifecycleEvent({
        type: 'request:retry',
        requestId,
        method,
        url,
        attempt,
        delayMs,
        reason: mapped.message,
      });
      await sleep(delayMs);
    }
  };
}
