import type { BackoffConfig } from './backoff.js';

export interface RetryConfig extends BackoffConfig {
  /** Maximum number of retry attempts after the initial request. `0` disables retries. */
  readonly maxRetries: number;
  /** HTTP status codes that are considered safe to retry. */
  readonly retryableStatusCodes: readonly number[];
  /** Whether bare network failures (DNS, connection refused, TLS) are retried. */
  readonly retryOnNetworkError: boolean;
  /** Whether request timeouts are retried. */
  readonly retryOnTimeout: boolean;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 2,
  initialDelayMs: 250,
  maxDelayMs: 8_000,
  backoffMultiplier: 2,
  jitter: true,
  retryableStatusCodes: [408, 409, 425, 429, 500, 502, 503, 504],
  retryOnNetworkError: true,
  retryOnTimeout: true,
};

/**
 * Normalizes the user-facing `retries` config option (a plain number of
 * retries, a partial override object, or `undefined`) into a full
 * {@link RetryConfig}.
 */
export function normalizeRetryConfig(
  retries: number | Partial<RetryConfig> | undefined,
): RetryConfig {
  if (retries === undefined) {
    return DEFAULT_RETRY_CONFIG;
  }
  if (typeof retries === 'number') {
    return { ...DEFAULT_RETRY_CONFIG, maxRetries: retries };
  }
  return { ...DEFAULT_RETRY_CONFIG, ...retries };
}

export function isRetryableStatus(status: number, config: RetryConfig): boolean {
  return config.retryableStatusCodes.includes(status);
}
