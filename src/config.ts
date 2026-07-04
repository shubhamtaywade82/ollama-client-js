import type { Logger } from './logger.js';
import type { RequestLifecycleHook } from './logger.js';
import type { Middleware } from './middleware.js';
import type { RetryConfig } from './transport/retry.js';
import type { FetchLike } from './transport/enhanced-fetch.js';
import type { EndpointRegistryOptions, OllamaEndpoint } from './providers/endpoint-registry.js';

export const DEFAULT_BASE_URL = 'http://localhost:11434';
export const DEFAULT_TIMEOUT_MS = 30_000;

export interface OllamaClientConfig {
  /** Base URL of a single Ollama server. Ignored if `endpoints` is provided. Defaults to `http://localhost:11434`. */
  readonly baseUrl?: string;
  /** Bearer token sent as `Authorization: Bearer <apiKey>` for a single-endpoint setup. Ignored if `endpoints` is provided. */
  readonly apiKey?: string;
  /** Static headers merged into every request for a single-endpoint setup. Ignored if `endpoints` is provided. */
  readonly headers?: Record<string, string>;
  /**
   * Multiple named endpoints (local and/or cloud, each with its own base URL
   * and key) for multi-key rotation and automatic failover. When provided,
   * `baseUrl`/`apiKey`/`headers` are ignored.
   */
  readonly endpoints?: readonly OllamaEndpoint[];
  /** Tuning for the endpoint health/failover circuit breaker. */
  readonly endpointHealth?: EndpointRegistryOptions;
  /** Error codes that trigger failover to the next endpoint. */
  readonly failoverOn?: readonly string[];
  /** Default per-request timeout in milliseconds. Defaults to `30_000`. Individual calls may override this. */
  readonly timeoutMs?: number;
  /** Retry count, or a partial override of the full retry policy. */
  readonly retries?: number | Partial<RetryConfig>;
  /** Custom `fetch` implementation (e.g. `node-fetch`, a proxy-aware fetch, or a test double). Defaults to the global `fetch`. */
  readonly fetch?: FetchLike;
  /** Middleware run around every request, in registration order. */
  readonly middleware?: readonly Middleware[];
  /** Structured logger. Defaults to a no-op logger unless `debug` is set. */
  readonly logger?: Logger;
  /** Enables a default console logger when no explicit `logger` is supplied. */
  readonly debug?: boolean;
  /** Called for every request lifecycle event (start/success/retry/error); wire this into metrics or tracing. */
  readonly onLifecycleEvent?: RequestLifecycleHook;
}

export const DEFAULT_FAILOVER_CODES: readonly string[] = [
  'network_error',
  'timeout',
  'server_error',
  'rate_limited',
  'auth_error',
];
