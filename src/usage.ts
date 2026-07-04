/**
 * Token/duration accounting.
 *
 * Ollama already returns token counts and durations (in nanoseconds) on
 * every non-streaming `chat`/`generate`/`embed` response and on the final
 * chunk of a stream. This module just reshapes that existing data into a
 * uniform, millisecond-scale shape - it does not estimate, guess, or invent
 * numbers the server didn't report.
 */

const NANOS_PER_MS = 1_000_000;
const NANOS_PER_SECOND = 1_000_000_000;

/** The subset of response fields usage accounting reads from. All are optional since not every endpoint returns every field (e.g. `embed` has no `eval_count`). */
export interface UsageSource {
  readonly total_duration?: number;
  readonly load_duration?: number;
  readonly prompt_eval_count?: number;
  readonly prompt_eval_duration?: number;
  readonly eval_count?: number;
  readonly eval_duration?: number;
}

export interface OllamaUsage {
  /** Number of tokens in the prompt, when reported. */
  readonly promptTokens?: number;
  /** Number of tokens generated, when reported. */
  readonly completionTokens?: number;
  /** `promptTokens + completionTokens`, when at least one of them is reported. */
  readonly totalTokens?: number;
  readonly totalDurationMs?: number;
  readonly loadDurationMs?: number;
  readonly promptEvalDurationMs?: number;
  readonly evalDurationMs?: number;
  /** Completion tokens per second, derived from `eval_count`/`eval_duration` when both are available and non-zero. */
  readonly tokensPerSecond?: number;
}

function nanosToMs(value: number | undefined): number | undefined {
  return value === undefined ? undefined : value / NANOS_PER_MS;
}

/**
 * Extracts a uniform {@link OllamaUsage} shape from any Ollama response that
 * carries token/duration fields (`ChatResponse`, `GenerateResponse`,
 * `EmbedResponse`, or a streaming aggregate's `raw` chunk).
 */
export function extractUsage(source: UsageSource): OllamaUsage {
  const { prompt_eval_count: promptTokens, eval_count: completionTokens } = source;
  const totalTokens =
    promptTokens === undefined && completionTokens === undefined
      ? undefined
      : (promptTokens ?? 0) + (completionTokens ?? 0);
  const tokensPerSecond =
    completionTokens !== undefined && source.eval_duration
      ? completionTokens / (source.eval_duration / NANOS_PER_SECOND)
      : undefined;

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    totalDurationMs: nanosToMs(source.total_duration),
    loadDurationMs: nanosToMs(source.load_duration),
    promptEvalDurationMs: nanosToMs(source.prompt_eval_duration),
    evalDurationMs: nanosToMs(source.eval_duration),
    tokensPerSecond,
  };
}
