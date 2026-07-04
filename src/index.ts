export { OllamaClient } from './client.js';
export type {
  ChatRequestInput,
  GenerateRequestInput,
  EmbedRequestInput,
  EmbeddingsRequestInput,
  ShowRequestInput,
  PullRequestInput,
  PushRequestInput,
  CreateRequestInput,
  DeleteRequestInput,
  CopyRequestInput,
  WithCancellation,
} from './client.js';

export type { OllamaClientConfig } from './config.js';
export { DEFAULT_BASE_URL, DEFAULT_TIMEOUT_MS, DEFAULT_FAILOVER_CODES } from './config.js';

export {
  OllamaClientError,
  OllamaNetworkError,
  OllamaTimeoutError,
  OllamaValidationError,
  OllamaAuthError,
  OllamaNotFoundError,
  OllamaRateLimitError,
  OllamaServerError,
  OllamaUnsupportedFeatureError,
  OllamaAbortError,
  OllamaGenericClientError,
  mapError,
} from './errors.js';
export type {
  OllamaErrorCode,
  OllamaErrorRequestContext,
  OllamaErrorResponseContext,
  OllamaClientErrorOptions,
} from './errors.js';

export type { Logger, LogLevel, RequestLifecycleEvent, RequestLifecycleHook } from './logger.js';
export { ConsoleLogger, noopLogger } from './logger.js';

export type {
  Middleware,
  MiddlewareRequest,
  MiddlewareRequestContext,
  MiddlewareResponseContext,
  MiddlewareErrorContext,
  RetryDecisionContext,
} from './middleware.js';
export { MiddlewarePipeline } from './middleware.js';

export type { RetryConfig } from './transport/retry.js';
export { DEFAULT_RETRY_CONFIG, normalizeRetryConfig } from './transport/retry.js';
export type { BackoffConfig } from './transport/backoff.js';
export { computeBackoffDelayMs } from './transport/backoff.js';
export type { FetchLike, EnhancedFetchConfig } from './transport/enhanced-fetch.js';
export { createEnhancedFetch } from './transport/enhanced-fetch.js';
export type { RawRequestOptions } from './transport/raw.js';
export { RawHttpClient } from './transport/raw.js';

export { OllamaAdapter } from './adapter/ollama-adapter.js';
export type { OllamaAdapterConfig } from './adapter/ollama-adapter.js';

export {
  OllamaStream,
  normalizeChatStream,
  normalizeGenerateStream,
  normalizeProgressStream,
} from './streaming/index.js';
export type {
  AbortableSource,
  ChatStreamResult,
  GenerateStreamResult,
  ProgressStreamResult,
  OllamaStreamEvent,
  OllamaStreamEventType,
  TokenEventData,
  ThinkingEventData,
  ToolCallEventData,
  MessageEventData,
  DoneEventData,
  ErrorEventData,
} from './streaming/index.js';

export {
  detectModelCapabilities,
  listAvailableModels,
  inferRuntimeMode,
} from './capabilities/capabilities.js';
export type { ModelCapabilities, RuntimeMode } from './capabilities/capabilities.js';

export { EndpointRegistry } from './providers/endpoint-registry.js';
export type {
  OllamaEndpoint,
  EndpointHealth,
  EndpointRegistryOptions,
} from './providers/endpoint-registry.js';
export { checkEndpointHealth } from './providers/health-check.js';
export type { EndpointHealthCheckResult } from './providers/health-check.js';

export { zodToOllamaFormat, parseStructuredOutput } from './schema/zod.js';

export { extractUsage } from './usage.js';
export type { OllamaUsage, UsageSource } from './usage.js';

// Re-exported upstream request/response types, so consumers rarely need a
// direct dependency on `ollama` for everyday usage.
export type {
  ChatRequest,
  ChatResponse,
  CopyRequest,
  CreateRequest,
  DeleteRequest,
  EmbedRequest,
  EmbedResponse,
  EmbeddingsRequest,
  EmbeddingsResponse,
  GenerateRequest,
  GenerateResponse,
  ListResponse,
  Message,
  ModelDetails,
  ModelResponse,
  Options,
  ProgressResponse,
  PullRequest,
  PushRequest,
  ShowRequest,
  ShowResponse,
  StatusResponse,
  Tool,
  ToolCall,
  VersionResponse,
} from 'ollama';
