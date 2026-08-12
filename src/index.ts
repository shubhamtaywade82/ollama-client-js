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
  WebSearchRequestInput,
  WebFetchRequestInput,
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
  OllamaUnknownToolError,
  OllamaToolExecutionError,
  OllamaToolValidationError,
  OllamaAgentMaxIterationsError,
  OllamaMcpError,
  OllamaSkillNotFoundError,
  OllamaSkillInvalidError,
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

// ---------------------------------------------------------------------
// Tool calling
// ---------------------------------------------------------------------
export { defineTool, toolToOllamaFormat } from './tools/define-tool.js';
export { ToolRegistry } from './tools/registry.js';
export type { ToolRegistryOptions } from './tools/registry.js';
export type {
  InferToolArgs,
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolHandler,
  ToolParameters,
} from './tools/types.js';

// ---------------------------------------------------------------------
// Agent loop (opt-in, composes over OllamaClient - not required for basic usage)
// ---------------------------------------------------------------------
export { Agent } from './agent/agent.js';
export type {
  AgentConfig,
  AgentHooks,
  AgentResult,
  AgentRunInput,
  AgentTurn,
} from './agent/types.js';

// ---------------------------------------------------------------------
// MCP tool adapter (zero extra dependency; duck-typed against
// @modelcontextprotocol/sdk's Client shape - listTools()/callTool())
// ---------------------------------------------------------------------
export { loadMcpTools, registerMcpTools } from './mcp/mcp-tools.js';
export type { McpToolOptions } from './mcp/mcp-tools.js';
export type {
  McpCallToolResult,
  McpClientLike,
  McpContentBlock,
  McpListToolsResult,
  McpToolDescriptor,
} from './mcp/types.js';

// ---------------------------------------------------------------------
// Skills (SKILL.md convention). These are the pure, browser-safe pieces
// only - `SkillRegistry` needs `node:fs` and is exported from the
// './skills' subpath instead (`ollama-client-js/skills`), so importing
// from the package's main entry never pulls in Node filesystem APIs.
// ---------------------------------------------------------------------
export { applySkill } from './skills/compose.js';
export type { ApplySkillInput, ApplySkillResult } from './skills/compose.js';
export { parseFrontmatter } from './skills/frontmatter.js';
export type { ParsedFrontmatter } from './skills/frontmatter.js';
export type { Skill, SkillFrontmatter, SkillSummary } from './skills/types.js';

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
  WebFetchRequest,
  WebFetchResponse,
  WebSearchRequest,
  WebSearchResponse,
} from 'ollama';
