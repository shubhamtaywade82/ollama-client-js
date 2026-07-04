# Changelog

All notable changes to this project are documented in this file. Releases are managed with
[Changesets](https://github.com/changesets/changesets); the version sections below are
generated/updated automatically as changesets are published (`npm run release`).

## 0.2.0

### Minor Changes

- Add `extractUsage()`, a typed helper that reshapes the token counts and nanosecond durations already
  returned by Ollama's `chat`/`generate`/`embed` responses into a uniform, millisecond-scale
  `OllamaUsage` shape (`promptTokens`, `completionTokens`, `totalTokens`, `totalDurationMs`,
  `loadDurationMs`, `promptEvalDurationMs`, `evalDurationMs`, `tokensPerSecond`). Streaming results
  (`ChatStreamResult`, `GenerateStreamResult`) now also carry a populated `usage` field once the stream
  reports `done`. This is intended to make it easier for higher-level applications (agent runtimes, cost
  tracking, logging) built on top of this client to account for token usage without re-deriving it from
  raw nanosecond fields themselves.

## 0.1.0

### Added

- Initial release: `OllamaClient` wrapping `ollama-js` with retries, timeouts, middleware, structured
  errors, normalized streaming (async-iterator and event-based), Zod structured-output helpers,
  capability discovery, multi-endpoint failover, and a raw HTTP fallback escape hatch.
