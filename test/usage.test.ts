import { describe, expect, it } from 'vitest';
import { extractUsage } from '../src/usage.js';

describe('extractUsage', () => {
  it('extracts token counts and converts durations from nanoseconds to milliseconds', () => {
    const usage = extractUsage({
      total_duration: 2_000_000,
      load_duration: 500_000,
      prompt_eval_count: 10,
      prompt_eval_duration: 300_000,
      eval_count: 20,
      eval_duration: 1_000_000_000, // 1 second
    });

    expect(usage.promptTokens).toBe(10);
    expect(usage.completionTokens).toBe(20);
    expect(usage.totalTokens).toBe(30);
    expect(usage.totalDurationMs).toBe(2);
    expect(usage.loadDurationMs).toBe(0.5);
    expect(usage.promptEvalDurationMs).toBe(0.3);
    expect(usage.evalDurationMs).toBe(1000);
    expect(usage.tokensPerSecond).toBe(20); // 20 tokens / 1 second
  });

  it('leaves fields undefined when the source does not report them (e.g. an embed response)', () => {
    const usage = extractUsage({
      total_duration: 1_000_000,
      load_duration: 200_000,
      prompt_eval_count: 5,
      // no eval_count/eval_duration - embeddings don't generate tokens
    });

    expect(usage.promptTokens).toBe(5);
    expect(usage.completionTokens).toBeUndefined();
    expect(usage.totalTokens).toBe(5);
    expect(usage.tokensPerSecond).toBeUndefined();
  });

  it('returns totalTokens as undefined when neither prompt nor completion counts are reported', () => {
    const usage = extractUsage({ total_duration: 1_000_000 });
    expect(usage.totalTokens).toBeUndefined();
    expect(usage.promptTokens).toBeUndefined();
    expect(usage.completionTokens).toBeUndefined();
  });

  it('does not divide by zero when eval_duration is 0', () => {
    const usage = extractUsage({ eval_count: 10, eval_duration: 0 });
    expect(usage.tokensPerSecond).toBeUndefined();
  });

  it('returns an all-undefined shape for an empty source', () => {
    const usage = extractUsage({});
    expect(usage).toEqual({
      promptTokens: undefined,
      completionTokens: undefined,
      totalTokens: undefined,
      totalDurationMs: undefined,
      loadDurationMs: undefined,
      promptEvalDurationMs: undefined,
      evalDurationMs: undefined,
      tokensPerSecond: undefined,
    });
  });
});
