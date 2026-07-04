/** Exponential backoff with optional full jitter, as described in AWS's "Exponential Backoff and Jitter". */

export interface BackoffConfig {
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  readonly backoffMultiplier: number;
  readonly jitter: boolean;
}

/**
 * Computes the delay before retry attempt `attemptIndex` (0-based: the delay
 * before the *first* retry, i.e. after the initial attempt has failed).
 */
export function computeBackoffDelayMs(attemptIndex: number, config: BackoffConfig): number {
  const exponential = config.initialDelayMs * Math.pow(config.backoffMultiplier, attemptIndex);
  const capped = Math.min(exponential, config.maxDelayMs);
  if (!config.jitter) return capped;
  return Math.random() * capped;
}
