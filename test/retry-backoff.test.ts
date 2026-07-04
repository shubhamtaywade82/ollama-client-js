import { describe, expect, it } from 'vitest';
import { computeBackoffDelayMs } from '../src/transport/backoff.js';
import {
  DEFAULT_RETRY_CONFIG,
  isRetryableStatus,
  normalizeRetryConfig,
} from '../src/transport/retry.js';

describe('computeBackoffDelayMs', () => {
  it('grows exponentially without jitter', () => {
    const config = {
      initialDelayMs: 100,
      maxDelayMs: 10_000,
      backoffMultiplier: 2,
      jitter: false,
    };
    expect(computeBackoffDelayMs(0, config)).toBe(100);
    expect(computeBackoffDelayMs(1, config)).toBe(200);
    expect(computeBackoffDelayMs(2, config)).toBe(400);
  });

  it('caps the delay at maxDelayMs', () => {
    const config = { initialDelayMs: 1000, maxDelayMs: 1500, backoffMultiplier: 10, jitter: false };
    expect(computeBackoffDelayMs(5, config)).toBe(1500);
  });

  it('applies full jitter within [0, cappedDelay]', () => {
    const config = { initialDelayMs: 100, maxDelayMs: 10_000, backoffMultiplier: 2, jitter: true };
    for (let i = 0; i < 20; i += 1) {
      const delay = computeBackoffDelayMs(2, config);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(400);
    }
  });
});

describe('normalizeRetryConfig', () => {
  it('returns the default config when nothing is given', () => {
    expect(normalizeRetryConfig(undefined)).toEqual(DEFAULT_RETRY_CONFIG);
  });

  it('treats a plain number as maxRetries', () => {
    const config = normalizeRetryConfig(5);
    expect(config.maxRetries).toBe(5);
    expect(config.initialDelayMs).toBe(DEFAULT_RETRY_CONFIG.initialDelayMs);
  });

  it('merges a partial override on top of the defaults', () => {
    const config = normalizeRetryConfig({ maxRetries: 1, retryOnNetworkError: false });
    expect(config.maxRetries).toBe(1);
    expect(config.retryOnNetworkError).toBe(false);
    expect(config.jitter).toBe(DEFAULT_RETRY_CONFIG.jitter);
  });
});

describe('isRetryableStatus', () => {
  it('treats configured status codes as retryable', () => {
    expect(isRetryableStatus(503, DEFAULT_RETRY_CONFIG)).toBe(true);
    expect(isRetryableStatus(429, DEFAULT_RETRY_CONFIG)).toBe(true);
  });

  it('treats other status codes as non-retryable', () => {
    expect(isRetryableStatus(400, DEFAULT_RETRY_CONFIG)).toBe(false);
    expect(isRetryableStatus(404, DEFAULT_RETRY_CONFIG)).toBe(false);
  });
});
