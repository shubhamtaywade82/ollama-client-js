import { z } from 'zod';
import { ChatRequest, AbortableAsyncIterator, ChatResponse, GenerateRequest, GenerateResponse, EmbedRequest, EmbedResponse, EmbeddingsRequest, EmbeddingsResponse, ListResponse, ShowRequest, ShowResponse, PullRequest, ProgressResponse, PushRequest, CreateRequest, DeleteRequest, StatusResponse, CopyRequest, VersionResponse, WebSearchRequest, WebSearchResponse, WebFetchRequest, WebFetchResponse, ModelResponse, ToolCall, Tool, Message, Options } from 'ollama';
export { ChatRequest, ChatResponse, CopyRequest, CreateRequest, DeleteRequest, EmbedRequest, EmbedResponse, EmbeddingsRequest, EmbeddingsResponse, GenerateRequest, GenerateResponse, ListResponse, Message, ModelDetails, ModelResponse, Options, ProgressResponse, PullRequest, PushRequest, ShowRequest, ShowResponse, StatusResponse, Tool, ToolCall, VersionResponse, WebFetchRequest, WebFetchResponse, WebSearchRequest, WebSearchResponse } from 'ollama';
import { O as OllamaClientError, T as ToolHandler, a as ToolDefinition, b as ToolRegistry, c as ToolExecutionResult } from './frontmatter-DOjLhFLV.cjs';
export { A as ApplySkillInput, d as ApplySkillResult, I as InferToolArgs, e as OllamaAbortError, f as OllamaAgentMaxIterationsError, g as OllamaAuthError, h as OllamaClientErrorOptions, i as OllamaErrorCode, j as OllamaErrorRequestContext, k as OllamaErrorResponseContext, l as OllamaGenericClientError, m as OllamaMcpError, n as OllamaNetworkError, o as OllamaNotFoundError, p as OllamaRateLimitError, q as OllamaServerError, r as OllamaSkillInvalidError, s as OllamaSkillNotFoundError, t as OllamaTimeoutError, u as OllamaToolExecutionError, v as OllamaToolValidationError, w as OllamaUnknownToolError, x as OllamaUnsupportedFeatureError, y as OllamaValidationError, P as ParsedFrontmatter, S as Skill, z as SkillFrontmatter, B as SkillSummary, C as ToolExecutionContext, D as ToolParameters, E as ToolRegistryOptions, F as applySkill, G as mapError, H as parseFrontmatter } from './frontmatter-DOjLhFLV.cjs';

/**
 * Logging and observability hooks.
 *
 * The client never assumes a particular logging framework. Instead it calls
 * a small {@link Logger} interface and, separately, emits structured
 * lifecycle events through {@link RequestLifecycleHooks} that can be wired
 * into metrics or tracing systems (OpenTelemetry, StatsD, etc.) without
 * pulling those dependencies into the core package.
 */
type LogLevel = 'debug' | 'info' | 'warn' | 'error';
interface Logger {
    debug(message: string, meta?: Record<string, unknown>): void;
    info(message: string, meta?: Record<string, unknown>): void;
    warn(message: string, meta?: Record<string, unknown>): void;
    error(message: string, meta?: Record<string, unknown>): void;
}
/** A logger that discards everything. Used when logging is disabled. */
declare const noopLogger: Logger;
/** A simple `console`-backed logger, useful for local development and debugging. */
declare class ConsoleLogger implements Logger {
    private readonly minLevel;
    private readonly prefix;
    constructor(minLevel?: LogLevel, prefix?: string);
    private shouldLog;
    debug(message: string, meta?: Record<string, unknown>): void;
    info(message: string, meta?: Record<string, unknown>): void;
    warn(message: string, meta?: Record<string, unknown>): void;
    error(message: string, meta?: Record<string, unknown>): void;
}
/** Structured events emitted at key points of a request's lifecycle. */
type RequestLifecycleEvent = {
    type: 'request:start';
    requestId: string;
    method: string;
    url: string;
    attempt: number;
} | {
    type: 'request:success';
    requestId: string;
    method: string;
    url: string;
    attempt: number;
    status: number;
    durationMs: number;
} | {
    type: 'request:retry';
    requestId: string;
    method: string;
    url: string;
    attempt: number;
    delayMs: number;
    reason: string;
} | {
    type: 'request:error';
    requestId: string;
    method: string;
    url: string;
    attempt: number;
    durationMs: number;
    error: unknown;
};
/** Callback invoked for every {@link RequestLifecycleEvent}. Intended for metrics/tracing hooks. */
type RequestLifecycleHook = (event: RequestLifecycleEvent) => void;

/**
 * Composable middleware / interceptor pipeline.
 *
 * Middleware runs around every HTTP request made by the client (including
 * requests issued internally by the wrapped `ollama-js` client, since the
 * enhanced `fetch` passed to it flows through this same pipeline). Hooks are
 * run in registration order for `onRequest`/`onResponse`/`onError`, and the
 * *last* non-`undefined` result wins for `shouldRetry`, so more specific
 * middleware can be registered later to override earlier defaults.
 */
interface MiddlewareRequest {
    url: string;
    method: string;
    headers: Record<string, string>;
    /** Parsed request body, when JSON-serializable. `undefined` for raw/binary bodies. */
    body?: unknown;
}
interface MiddlewareRequestContext {
    readonly request: MiddlewareRequest;
    readonly attempt: number;
    readonly requestId: string;
    /** Free-form bag middleware can use to pass data between hooks of the same request. */
    readonly meta: Record<string, unknown>;
}
interface MiddlewareResponseContext extends MiddlewareRequestContext {
    readonly response: Response;
    readonly durationMs: number;
}
interface MiddlewareErrorContext extends MiddlewareRequestContext {
    readonly error: unknown;
    readonly durationMs: number;
}
interface RetryDecisionContext extends MiddlewareRequestContext {
    readonly error?: unknown;
    readonly response?: Response;
    /** The retry policy's own decision, before middleware has a chance to override it. */
    readonly defaultDecision: boolean;
}
interface Middleware {
    readonly name?: string;
    /** Called before the request is sent. May mutate `ctx.request` (headers, body). */
    onRequest?(ctx: MiddlewareRequestContext): void | Promise<void>;
    /** Called after a response is received, before retry logic runs. */
    onResponse?(ctx: MiddlewareResponseContext): void | Promise<void>;
    /** Called when the transport throws (network error, timeout, abort). */
    onError?(ctx: MiddlewareErrorContext): void | Promise<void>;
    /** Override whether a failed attempt should be retried. Return `undefined` to defer to other middleware / the default policy. */
    shouldRetry?(ctx: RetryDecisionContext): boolean | undefined | Promise<boolean | undefined>;
}
declare class MiddlewarePipeline {
    private readonly middleware;
    constructor(middleware?: readonly Middleware[]);
    get size(): number;
    runRequest(ctx: MiddlewareRequestContext): Promise<void>;
    runResponse(ctx: MiddlewareResponseContext): Promise<void>;
    runError(ctx: MiddlewareErrorContext): Promise<void>;
    decideRetry(ctx: RetryDecisionContext): Promise<boolean>;
}

/** Exponential backoff with optional full jitter, as described in AWS's "Exponential Backoff and Jitter". */
interface BackoffConfig {
    readonly initialDelayMs: number;
    readonly maxDelayMs: number;
    readonly backoffMultiplier: number;
    readonly jitter: boolean;
}
/**
 * Computes the delay before retry attempt `attemptIndex` (0-based: the delay
 * before the *first* retry, i.e. after the initial attempt has failed).
 */
declare function computeBackoffDelayMs(attemptIndex: number, config: BackoffConfig): number;

interface RetryConfig extends BackoffConfig {
    /** Maximum number of retry attempts after the initial request. `0` disables retries. */
    readonly maxRetries: number;
    /** HTTP status codes that are considered safe to retry. */
    readonly retryableStatusCodes: readonly number[];
    /** Whether bare network failures (DNS, connection refused, TLS) are retried. */
    readonly retryOnNetworkError: boolean;
    /** Whether request timeouts are retried. */
    readonly retryOnTimeout: boolean;
}
declare const DEFAULT_RETRY_CONFIG: RetryConfig;
/**
 * Normalizes the user-facing `retries` config option (a plain number of
 * retries, a partial override object, or `undefined`) into a full
 * {@link RetryConfig}.
 */
declare function normalizeRetryConfig(retries: number | Partial<RetryConfig> | undefined): RetryConfig;

type FetchLike = typeof fetch;
interface EnhancedFetchConfig {
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
/**
 * Builds a `fetch`-compatible function that layers retries, timeouts,
 * middleware, and auth-header injection on top of a base `fetch`
 * implementation. The result can be passed directly as `Config.fetch` to the
 * upstream `ollama` client, or used standalone for raw HTTP fallback calls.
 */
declare function createEnhancedFetch(config: EnhancedFetchConfig): FetchLike;

/**
 * Multi-key / multi-provider routing and failover.
 *
 * An {@link OllamaEndpoint} is anything a request can be sent to: a local
 * Ollama install, a cloud endpoint with an API key, or the same base URL
 * with a different key for rate-limit spreading. The registry tracks
 * per-endpoint health using a simple failure-count circuit breaker: after
 * `failureThreshold` consecutive failures an endpoint is put in cooldown and
 * deprioritized until `cooldownMs` elapses, at which point it's eligible
 * again. This is deliberately not opinionated about *why* an endpoint
 * failed - the caller (the client's request loop) decides which errors
 * count as failures worth failing over on.
 */
interface OllamaEndpoint {
    /** Unique, stable identifier for this endpoint (used in logs and health reports). */
    readonly name: string;
    readonly baseUrl: string;
    readonly apiKey?: string;
    readonly headers?: Record<string, string>;
    /** Lower values are tried first. Defaults to `0`. */
    readonly priority?: number;
}
interface EndpointHealth {
    readonly name: string;
    readonly healthy: boolean;
    readonly consecutiveFailures: number;
    readonly cooldownUntil?: number;
}
interface EndpointRegistryOptions {
    /** Consecutive failures before an endpoint is put in cooldown. Defaults to `3`. */
    readonly failureThreshold?: number;
    /** Cooldown duration in milliseconds. Defaults to `30_000`. */
    readonly cooldownMs?: number;
    /** Injectable clock, for deterministic tests. */
    readonly now?: () => number;
}
declare class EndpointRegistry {
    private readonly endpoints;
    private readonly health;
    private readonly failureThreshold;
    private readonly cooldownMs;
    private readonly now;
    constructor(endpoints: readonly OllamaEndpoint[], options?: EndpointRegistryOptions);
    list(): readonly OllamaEndpoint[];
    /**
     * Returns endpoints in the order they should be attempted for the next
     * request: healthy endpoints first (by priority), falling back to
     * endpoints still in cooldown - soonest to recover first - only if every
     * endpoint is currently unhealthy (fail open rather than refusing to try).
     */
    candidates(): OllamaEndpoint[];
    reportSuccess(name: string): void;
    reportFailure(name: string): void;
    status(): EndpointHealth[];
}

declare const DEFAULT_BASE_URL = "http://localhost:11434";
declare const DEFAULT_TIMEOUT_MS = 30000;
interface OllamaClientConfig {
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
declare const DEFAULT_FAILOVER_CODES: readonly string[];

interface EndpointHealthCheckResult {
    readonly name: string;
    readonly reachable: boolean;
    readonly latencyMs?: number;
    readonly error?: string;
}
/**
 * Performs a lightweight active health check against an endpoint's
 * `/api/version` route. This is separate from the registry's passive,
 * failure-count-based health tracking: use this when you want to probe
 * endpoints proactively (e.g. on startup, or from a `/healthz` route) rather
 * than relying solely on production traffic.
 */
declare function checkEndpointHealth(endpoint: OllamaEndpoint, fetchImpl: FetchLike, timeoutMs?: number): Promise<EndpointHealthCheckResult>;

interface OllamaAdapterConfig {
    readonly host: string;
    readonly fetch: FetchLike;
    readonly headers?: Record<string, string>;
}
/**
 * Isolates every interaction with the upstream `ollama` package behind a
 * single, narrow surface. Nothing outside this file imports from `ollama`
 * directly, so upgrading or replacing the upstream dependency only ever
 * touches this adapter.
 *
 * Every method catches whatever the upstream client throws (its own
 * `ResponseError`, a raw network `TypeError`, an `AbortError`) and re-throws
 * it as one of this package's structured {@link OllamaClientError} subtypes.
 */
declare class OllamaAdapter {
    private readonly upstream;
    constructor(config: OllamaAdapterConfig);
    private context;
    chat(request: ChatRequest & {
        stream: true;
    }): Promise<AbortableAsyncIterator<ChatResponse>>;
    chat(request: ChatRequest & {
        stream?: false;
    }): Promise<ChatResponse>;
    generate(request: GenerateRequest & {
        stream: true;
    }): Promise<AbortableAsyncIterator<GenerateResponse>>;
    generate(request: GenerateRequest & {
        stream?: false;
    }): Promise<GenerateResponse>;
    embed(request: EmbedRequest): Promise<EmbedResponse>;
    embeddings(request: EmbeddingsRequest): Promise<EmbeddingsResponse>;
    list(): Promise<ListResponse>;
    show(request: ShowRequest): Promise<ShowResponse>;
    pull(request: PullRequest & {
        stream: true;
    }): Promise<AbortableAsyncIterator<ProgressResponse>>;
    pull(request: PullRequest & {
        stream?: false;
    }): Promise<ProgressResponse>;
    push(request: PushRequest & {
        stream: true;
    }): Promise<AbortableAsyncIterator<ProgressResponse>>;
    push(request: PushRequest & {
        stream?: false;
    }): Promise<ProgressResponse>;
    create(request: CreateRequest & {
        stream: true;
    }): Promise<AbortableAsyncIterator<ProgressResponse>>;
    create(request: CreateRequest & {
        stream?: false;
    }): Promise<ProgressResponse>;
    delete(request: DeleteRequest): Promise<StatusResponse>;
    copy(request: CopyRequest): Promise<StatusResponse>;
    ps(): Promise<ListResponse>;
    version(): Promise<VersionResponse>;
    webSearch(request: WebSearchRequest): Promise<WebSearchResponse>;
    webFetch(request: WebFetchRequest): Promise<WebFetchResponse>;
    /** Aborts every in-flight streamed request created through this adapter's upstream client. */
    abortAll(): void;
}

type RuntimeMode = 'local' | 'cloud' | 'unknown';
/**
 * Infers whether a base URL points at a local Ollama install or a remote
 * (cloud) endpoint, purely from the hostname. This is a heuristic, not a
 * server-reported fact - unusual setups (SSH tunnels, port-forwarded
 * clusters) can defeat it. It exists to support routing decisions and
 * logging, not to gate functionality.
 */
declare function inferRuntimeMode(baseUrl: string): RuntimeMode;
/**
 * Capabilities for a specific model, derived from `/api/show`.
 *
 * `supportsTools`, `supportsVision`, `supportsEmbedding`, and
 * `supportsCompletion` are read directly from the server's reported
 * `capabilities` array - we never guess these. `supportsStreaming` and
 * `supportsStructuredOutputRequest` are protocol-level facts about the
 * `/api/chat` and `/api/generate` endpoints themselves (any Ollama server
 * accepts `stream` and `format`, independent of the model), not a
 * model-specific guess; they say nothing about whether a given model will
 * *follow* those instructions well.
 */
interface ModelCapabilities {
    readonly model: string;
    /** The raw `capabilities` array reported by the server, unmodified. */
    readonly reported: readonly string[];
    readonly supportsTools: boolean;
    readonly supportsVision: boolean;
    readonly supportsEmbedding: boolean;
    readonly supportsCompletion: boolean;
    readonly supportsStreaming: true;
    readonly supportsStructuredOutputRequest: true;
}
declare function detectModelCapabilities(adapter: OllamaAdapter, model: string): Promise<ModelCapabilities>;
/** Lists the models currently available on the server (thin wrapper over `/api/tags`). */
declare function listAvailableModels(adapter: OllamaAdapter): Promise<ModelResponse[]>;

/**
 * Token/duration accounting.
 *
 * Ollama already returns token counts and durations (in nanoseconds) on
 * every non-streaming `chat`/`generate`/`embed` response and on the final
 * chunk of a stream. This module just reshapes that existing data into a
 * uniform, millisecond-scale shape - it does not estimate, guess, or invent
 * numbers the server didn't report.
 */
/** The subset of response fields usage accounting reads from. All are optional since not every endpoint returns every field (e.g. `embed` has no `eval_count`). */
interface UsageSource {
    readonly total_duration?: number;
    readonly load_duration?: number;
    readonly prompt_eval_count?: number;
    readonly prompt_eval_duration?: number;
    readonly eval_count?: number;
    readonly eval_duration?: number;
}
interface OllamaUsage {
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
/**
 * Extracts a uniform {@link OllamaUsage} shape from any Ollama response that
 * carries token/duration fields (`ChatResponse`, `GenerateResponse`,
 * `EmbedResponse`, or a streaming aggregate's `raw` chunk).
 */
declare function extractUsage(source: UsageSource): OllamaUsage;

/** The normalized event vocabulary emitted by every stream in this library, regardless of the underlying endpoint. */
type OllamaStreamEventType = 'token' | 'message' | 'tool_call' | 'thinking' | 'done' | 'error';
interface TokenEventData {
    readonly delta: string;
    readonly role: string;
}
interface ThinkingEventData {
    readonly delta: string;
}
interface ToolCallEventData {
    readonly toolCall: ToolCall;
}
interface MessageEventData<TChunk> {
    readonly chunk: TChunk;
}
interface DoneEventData<TFinal> {
    readonly result: TFinal;
}
interface ErrorEventData {
    readonly error: OllamaClientError;
}
type OllamaStreamEvent<TChunk, TFinal> = {
    readonly type: 'token';
    readonly data: TokenEventData;
} | {
    readonly type: 'thinking';
    readonly data: ThinkingEventData;
} | {
    readonly type: 'tool_call';
    readonly data: ToolCallEventData;
} | {
    readonly type: 'message';
    readonly data: MessageEventData<TChunk>;
} | {
    readonly type: 'done';
    readonly data: DoneEventData<TFinal>;
} | {
    readonly type: 'error';
    readonly data: ErrorEventData;
};
/** Aggregated result of a fully-consumed chat stream. */
interface ChatStreamResult {
    readonly message: {
        readonly role: string;
        readonly content: string;
        readonly thinking?: string;
        readonly tool_calls?: ToolCall[];
    };
    readonly model: string;
    readonly done: boolean;
    readonly totalDurationMs?: number;
    /** Token/duration accounting, populated once the stream reports `done`. */
    readonly usage?: OllamaUsage;
    readonly raw?: ChatResponse;
}
/** Aggregated result of a fully-consumed generate stream. */
interface GenerateStreamResult {
    readonly response: string;
    readonly model: string;
    readonly done: boolean;
    readonly totalDurationMs?: number;
    /** Token/duration accounting, populated once the stream reports `done`. */
    readonly usage?: OllamaUsage;
    readonly raw?: GenerateResponse;
}
/** Aggregated result of a fully-consumed progress stream (pull/push/create). */
interface ProgressStreamResult {
    readonly status: string;
    readonly completed?: number;
    readonly total?: number;
    readonly done: boolean;
    readonly raw?: ProgressResponse;
}
/** Minimal shape required of a stream source: async-iterable, optionally abortable. */
interface AbortableSource<TChunk> extends AsyncIterable<TChunk> {
    abort?(): void;
}

/**
 * A normalized, cancellable stream.
 *
 * Supports exactly one of two consumption styles, chosen by whichever API is
 * used first:
 *
 * - **Pull-based**: `for await (const event of stream)`.
 * - **Event-based**: `stream.on('token', handler)`, which drives the
 *   underlying source in the background.
 *
 * Mixing the two on the same stream instance throws, since the underlying
 * async generator can only be drained once.
 */
declare class OllamaStream<TChunk, TFinal> implements AsyncIterable<OllamaStreamEvent<TChunk, TFinal>> {
    private readonly source;
    private readonly mapChunk;
    private readonly aggregate;
    private readonly initial;
    private readonly listeners;
    private mode;
    private readonly finalResultPromise;
    private resolveFinal;
    private rejectFinal;
    constructor(source: AbortableSource<TChunk>, mapChunk: (chunk: TChunk, aggregated: TFinal) => Array<OllamaStreamEvent<TChunk, TFinal>>, aggregate: (accumulated: TFinal, chunk: TChunk) => TFinal, initial: TFinal);
    /** Resolves with the fully aggregated result once the stream completes, or rejects on stream error. */
    get finalResult(): Promise<TFinal>;
    /** Cancels the underlying request, if the source supports it. */
    abort(): void;
    /** Subscribes to a single normalized event type. Returns an unsubscribe function. */
    on<TType extends OllamaStreamEventType>(type: TType, listener: (event: Extract<OllamaStreamEvent<TChunk, TFinal>, {
        type: TType;
    }>) => void): () => void;
    private emit;
    private pump;
    [Symbol.asyncIterator](): AsyncGenerator<OllamaStreamEvent<TChunk, TFinal>, void, undefined>;
}

/** Wraps a raw upstream chat stream (from `ollama-js`) into a normalized {@link OllamaStream}. */
declare function normalizeChatStream(source: AbortableSource<ChatResponse>): OllamaStream<ChatResponse, ChatStreamResult>;
/** Wraps a raw upstream generate stream (from `ollama-js`) into a normalized {@link OllamaStream}. */
declare function normalizeGenerateStream(source: AbortableSource<GenerateResponse>): OllamaStream<GenerateResponse, GenerateStreamResult>;
/** Wraps a raw upstream progress stream (pull/push/create) into a normalized {@link OllamaStream}. */
declare function normalizeProgressStream(source: AbortableSource<ProgressResponse>): OllamaStream<ProgressResponse, ProgressStreamResult>;

/**
 * Raw HTTP escape hatch.
 *
 * `ollama-js` only wraps a subset of the Ollama HTTP API. When a caller
 * needs an endpoint the upstream client doesn't expose yet - such as the
 * blob upload endpoints used when creating models from local layers, or a
 * brand new API surface added to a newer Ollama server than the installed
 * `ollama` version knows about - this client falls back to a raw HTTP
 * request through the same enhanced `fetch` (retries, timeouts, middleware,
 * auth headers all still apply).
 */
interface RawRequestOptions {
    readonly method?: string;
    /** Path relative to the client's base URL, e.g. `/api/blobs/sha256:...`. */
    readonly path: string;
    /** JSON-serializable value, or a raw `BodyInit` (string/Blob/ArrayBuffer/etc). */
    readonly body?: unknown;
    readonly headers?: Record<string, string>;
    readonly signal?: AbortSignal;
}
declare class RawHttpClient {
    private readonly baseUrl;
    private readonly fetchImpl;
    constructor(baseUrl: string, fetchImpl: FetchLike);
    /** Sends a raw HTTP request relative to the client's base URL. Does not throw on non-2xx responses. */
    request(options: RawRequestOptions): Promise<Response>;
    /** Like {@link request}, but parses and returns a JSON body, throwing a structured error on failure. */
    requestJson<T>(options: RawRequestOptions): Promise<T>;
    /** Checks whether a file blob already exists on the server (`HEAD /api/blobs/:digest`). */
    blobExists(digest: string, signal?: AbortSignal): Promise<boolean>;
    /** Uploads a file blob (`POST /api/blobs/:digest`) so it can be referenced when creating a model. */
    pushBlob(digest: string, data: BodyInit, signal?: AbortSignal): Promise<void>;
}

/** Adds client-side-only cancellation options to an upstream request shape. */
type WithCancellation<T> = T & {
    /** Aborts this specific call. Independent of the client's default timeout. */
    readonly signal?: AbortSignal;
    /** Overrides the client's default timeout for this specific call, in milliseconds. */
    readonly timeoutMs?: number;
};
type ChatRequestInput = WithCancellation<ChatRequest>;
type GenerateRequestInput = WithCancellation<GenerateRequest>;
type EmbedRequestInput = WithCancellation<EmbedRequest>;
type EmbeddingsRequestInput = WithCancellation<EmbeddingsRequest>;
type ShowRequestInput = WithCancellation<ShowRequest>;
type PullRequestInput = WithCancellation<PullRequest>;
type PushRequestInput = WithCancellation<PushRequest>;
type CreateRequestInput = WithCancellation<CreateRequest>;
type DeleteRequestInput = WithCancellation<DeleteRequest>;
type CopyRequestInput = WithCancellation<CopyRequest>;
type WebSearchRequestInput = WithCancellation<WebSearchRequest>;
type WebFetchRequestInput = WithCancellation<WebFetchRequest>;
/**
 * The public entry point of ollama-client-js.
 *
 * Wraps the upstream `ollama` package with retries, timeouts, middleware,
 * structured errors, normalized streaming, multi-endpoint failover, and
 * schema-based structured output helpers, while keeping the surface thin
 * and predictable.
 */
declare class OllamaClient {
    private readonly registry;
    private readonly endpointResources;
    private readonly middlewarePipeline;
    private readonly logger;
    private readonly retryConfig;
    private readonly fetchImpl;
    private readonly timeoutMs;
    private readonly lifecycleHook;
    private readonly failoverOn;
    constructor(config?: OllamaClientConfig);
    private resourcesFor;
    private activeEndpoint;
    private runWithFailover;
    private withCancellation;
    private propagateAbort;
    chat(request: ChatRequestInput & {
        stream: true;
    }): Promise<OllamaStream<ChatResponse, ChatStreamResult>>;
    chat(request: ChatRequestInput & {
        stream?: false;
    }): Promise<ChatResponse>;
    /** Convenience wrapper equivalent to `chat({ ...request, stream: true })`. */
    chatStream(request: Omit<ChatRequestInput, 'stream'>): Promise<OllamaStream<ChatResponse, ChatStreamResult>>;
    /** Runs a chat request constrained to a Zod schema and returns the parsed, validated result. */
    chatWithSchema<TSchema extends z.ZodType>(request: Omit<ChatRequestInput, 'stream' | 'format'>, schema: TSchema): Promise<z.infer<TSchema>>;
    generate(request: GenerateRequestInput & {
        stream: true;
    }): Promise<OllamaStream<GenerateResponse, GenerateStreamResult>>;
    generate(request: GenerateRequestInput & {
        stream?: false;
    }): Promise<GenerateResponse>;
    /** Convenience wrapper equivalent to `generate({ ...request, stream: true })`. */
    generateStream(request: Omit<GenerateRequestInput, 'stream'>): Promise<OllamaStream<GenerateResponse, GenerateStreamResult>>;
    /** Runs a generate request constrained to a Zod schema and returns the parsed, validated result. */
    generateWithSchema<TSchema extends z.ZodType>(request: Omit<GenerateRequestInput, 'stream' | 'format'>, schema: TSchema): Promise<z.infer<TSchema>>;
    embed(request: EmbedRequestInput): Promise<EmbedResponse>;
    /** @deprecated Prefer {@link OllamaClient.embed}; kept for parity with the upstream single-prompt endpoint. */
    embeddings(request: EmbeddingsRequestInput): Promise<EmbeddingsResponse>;
    listModels(): Promise<ModelResponse[]>;
    /** Alias for {@link OllamaClient.listModels}. */
    models(): Promise<ModelResponse[]>;
    showModel(request: ShowRequestInput): Promise<ShowResponse>;
    pullModel(request: PullRequestInput & {
        stream: true;
    }): Promise<OllamaStream<ProgressResponse, ProgressStreamResult>>;
    pullModel(request: PullRequestInput & {
        stream?: false;
    }): Promise<ProgressResponse>;
    pushModel(request: PushRequestInput & {
        stream: true;
    }): Promise<OllamaStream<ProgressResponse, ProgressStreamResult>>;
    pushModel(request: PushRequestInput & {
        stream?: false;
    }): Promise<ProgressResponse>;
    createModel(request: CreateRequestInput & {
        stream: true;
    }): Promise<OllamaStream<ProgressResponse, ProgressStreamResult>>;
    createModel(request: CreateRequestInput & {
        stream?: false;
    }): Promise<ProgressResponse>;
    deleteModel(request: DeleteRequestInput): Promise<StatusResponse>;
    copyModel(request: CopyRequestInput): Promise<StatusResponse>;
    ps(): Promise<{
        models: ModelResponse[];
    }>;
    version(): Promise<VersionResponse>;
    webSearch(request: WebSearchRequestInput): Promise<WebSearchResponse>;
    webFetch(request: WebFetchRequestInput): Promise<WebFetchResponse>;
    /** Probes `/api/show` for a model's server-reported capabilities. */
    capabilities(model: string): Promise<ModelCapabilities>;
    /** Heuristic classification of the active endpoint as local or cloud, based on its hostname. */
    runtimeMode(): RuntimeMode;
    /** Actively pings every configured endpoint's `/api/version` route. */
    healthCheck(): Promise<EndpointHealthCheckResult[]>;
    /** Passive, failure-count-based health for every configured endpoint. */
    endpointStatus(): EndpointHealth[];
    /** Raw HTTP escape hatch for endpoints not wrapped by `ollama-js`, scoped to the currently active endpoint. */
    get raw(): RawHttpClient;
    /** Aborts every in-flight streamed request across all configured endpoints. */
    abort(): void;
}

/**
 * Structured-output helpers built on Zod.
 *
 * Ollama's `chat`/`generate` endpoints accept a `format` field that can be
 * either the literal string `"json"` or a JSON Schema object; when set, the
 * server constrains generation to match it. These helpers convert a Zod
 * schema into that JSON Schema, and validate the model's response against
 * the same schema so callers get a typed, parsed value or a clear
 * {@link OllamaValidationError} instead of hand-rolled `JSON.parse` and
 * manual checks.
 */
/** Converts a Zod schema into the JSON Schema shape Ollama's `format` field expects. */
declare function zodToOllamaFormat(schema: z.ZodType): Record<string, unknown>;
/**
 * Parses and validates a raw model response string against a Zod schema.
 * Throws {@link OllamaValidationError} (never a raw `SyntaxError` or
 * `ZodError`) if the response is not valid JSON or does not match the
 * schema.
 */
declare function parseStructuredOutput<TSchema extends z.ZodType>(raw: string, schema: TSchema): z.infer<TSchema>;

/**
 * Defines a tool from a Zod parameter schema. The schema is used both to validate a model's tool
 * call arguments before `handler` runs (see {@link ToolRegistry.executeToolCall}) and to derive the
 * JSON Schema sent to Ollama in `tools[].function.parameters` (see {@link toolToOllamaFormat}).
 */
declare function defineTool<TSchema extends z.ZodType>(config: {
    readonly name: string;
    readonly description: string;
    readonly parameters: TSchema;
    readonly handler: ToolHandler<z.infer<TSchema>>;
}): ToolDefinition<z.infer<TSchema>>;
/**
 * Converts a {@link ToolDefinition} into the `Tool` shape Ollama's `chat` `tools` field expects. Zod
 * parameter schemas are converted via {@link zodToOllamaFormat}; a raw JSON Schema object (as used by
 * MCP-sourced tools; see `src/mcp/mcp-tools.ts`) is passed through unchanged.
 */
declare function toolToOllamaFormat(tool: ToolDefinition): Tool;

/**
 * Observability hooks for {@link Agent}, fired in this order per turn: `onTurnStart` ->
 * `onAssistantMessage` -> (`onToolCall` then `onToolResult`, once per tool call, in call order) ->
 * `onTurnEnd`. `onThinking`/`onToken` only fire from `runStream()`, interleaved with the model's
 * response as it streams, before that turn's `onAssistantMessage`.
 */
interface AgentHooks {
    onTurnStart?(ctx: {
        turn: number;
        messages: readonly Message[];
    }): void | Promise<void>;
    onThinking?(ctx: {
        turn: number;
        delta: string;
    }): void | Promise<void>;
    onToken?(ctx: {
        turn: number;
        delta: string;
    }): void | Promise<void>;
    onAssistantMessage?(ctx: {
        turn: number;
        message: Message;
    }): void | Promise<void>;
    onToolCall?(ctx: {
        turn: number;
        toolCall: ToolCall;
    }): void | Promise<void>;
    onToolResult?(ctx: {
        turn: number;
        result: ToolExecutionResult;
    }): void | Promise<void>;
    onTurnEnd?(ctx: {
        turn: number;
        messages: readonly Message[];
    }): void | Promise<void>;
}
interface AgentConfig {
    readonly tools: ToolRegistry;
    /** Maximum number of model turns before giving up with {@link OllamaAgentMaxIterationsError}. Default 10. */
    readonly maxIterations?: number;
    readonly hooks?: AgentHooks;
}
interface AgentRunInput {
    readonly model: string;
    readonly messages: Message[];
    readonly think?: boolean | 'high' | 'medium' | 'low';
    readonly options?: Partial<Options>;
    readonly signal?: AbortSignal;
}
interface AgentTurn {
    readonly turn: number;
    readonly assistantMessage: Message;
    /** Empty when this turn's assistant message had no `tool_calls` (i.e. it was the final turn). */
    readonly toolResults: readonly ToolExecutionResult[];
}
interface AgentResult {
    /** Full transcript, including tool-result messages - ready to continue the conversation from. */
    readonly messages: Message[];
    readonly finalMessage: Message;
    readonly turns: readonly AgentTurn[];
    readonly iterations: number;
}

/**
 * Opt-in, multi-turn tool-calling loop built on top of {@link OllamaClient}. `OllamaClient` itself
 * stays a thin, single-turn wrapper around `/api/chat`; `Agent` composes over it - it only ever
 * calls the client's already-public `chat`/`chatStream` methods - to repeatedly execute a model's
 * `tool_calls` against a `ToolRegistry` and feed the results back, until the model responds
 * without requesting a tool, or `maxIterations` is exhausted.
 */
declare class Agent {
    private readonly client;
    private readonly config;
    private readonly maxIterations;
    private readonly hooks;
    constructor(client: OllamaClient, config: AgentConfig);
    /** Runs the loop using non-streaming `chat` calls for every turn. */
    run(input: AgentRunInput): Promise<AgentResult>;
    /**
     * Runs the loop using `chatStream` for every turn, so `thinking`/`token` deltas flow through
     * `onThinking`/`onToken` in real time. Whether to continue the loop is decided from
     * `stream.finalResult`, which already aggregates a turn's `tool_calls` across chunks
     * (see `src/streaming/normalize.ts`), so this is otherwise equivalent to `run()`.
     */
    runStream(input: AgentRunInput): Promise<AgentResult>;
    private baseRequest;
    private loop;
}

interface McpToolDescriptor {
    readonly name: string;
    readonly description?: string;
    readonly inputSchema: Record<string, unknown>;
}
interface McpListToolsResult {
    readonly tools: readonly McpToolDescriptor[];
}
interface McpContentBlock {
    readonly type: string;
    readonly text?: string;
    readonly [key: string]: unknown;
}
interface McpCallToolResult {
    readonly content: readonly McpContentBlock[];
    readonly isError?: boolean;
}
/**
 * Structural shape of `@modelcontextprotocol/sdk`'s `Client` methods this library needs. Defined
 * here rather than imported so this package has no dependency on the MCP SDK - any object with
 * this shape (including a real `Client` instance) can be passed to {@link loadMcpTools}.
 */
interface McpClientLike {
    listTools(): Promise<McpListToolsResult>;
    callTool(params: {
        name: string;
        arguments: Record<string, unknown>;
    }): Promise<McpCallToolResult>;
}

interface McpToolOptions {
    /** Prefixed onto every tool name to avoid collisions with locally defined tools (e.g. `'fs_'`). */
    readonly namePrefix?: string;
}
/**
 * Lists tools from an MCP-shaped client and converts each into a {@link ToolDefinition} whose
 * `parameters` is the tool's raw JSON-Schema `inputSchema` (not a Zod schema - MCP-sourced tools
 * therefore get no client-side argument validation before `handler` runs, unlike `defineTool`-based
 * tools; arguments are passed straight through to `callTool`) and whose `handler` invokes
 * `mcpClient.callTool`.
 *
 * A successful result's text content blocks are joined into the tool-result message's string
 * content; non-text blocks (e.g. images, embedded resources) are represented with a placeholder
 * rather than silently dropped. A result with `isError: true`, or a client method that rejects, is
 * thrown as an {@link OllamaMcpError} so it flows through `ToolRegistry`'s normal `onError` handling
 * like any other handler failure.
 */
declare function loadMcpTools(mcpClient: McpClientLike, options?: McpToolOptions): Promise<ToolDefinition[]>;
/** Convenience: loads MCP tools and registers them into an existing {@link ToolRegistry} in one call. */
declare function registerMcpTools(registry: ToolRegistry, mcpClient: McpClientLike, options?: McpToolOptions): Promise<void>;

export { type AbortableSource, Agent, type AgentConfig, type AgentHooks, type AgentResult, type AgentRunInput, type AgentTurn, type BackoffConfig, type ChatRequestInput, type ChatStreamResult, ConsoleLogger, type CopyRequestInput, type CreateRequestInput, DEFAULT_BASE_URL, DEFAULT_FAILOVER_CODES, DEFAULT_RETRY_CONFIG, DEFAULT_TIMEOUT_MS, type DeleteRequestInput, type DoneEventData, type EmbedRequestInput, type EmbeddingsRequestInput, type EndpointHealth, type EndpointHealthCheckResult, EndpointRegistry, type EndpointRegistryOptions, type EnhancedFetchConfig, type ErrorEventData, type FetchLike, type GenerateRequestInput, type GenerateStreamResult, type LogLevel, type Logger, type McpCallToolResult, type McpClientLike, type McpContentBlock, type McpListToolsResult, type McpToolDescriptor, type McpToolOptions, type MessageEventData, type Middleware, type MiddlewareErrorContext, MiddlewarePipeline, type MiddlewareRequest, type MiddlewareRequestContext, type MiddlewareResponseContext, type ModelCapabilities, OllamaAdapter, type OllamaAdapterConfig, OllamaClient, type OllamaClientConfig, OllamaClientError, type OllamaEndpoint, OllamaStream, type OllamaStreamEvent, type OllamaStreamEventType, type OllamaUsage, type ProgressStreamResult, type PullRequestInput, type PushRequestInput, RawHttpClient, type RawRequestOptions, type RequestLifecycleEvent, type RequestLifecycleHook, type RetryConfig, type RetryDecisionContext, type RuntimeMode, type ShowRequestInput, type ThinkingEventData, type TokenEventData, type ToolCallEventData, ToolDefinition, ToolExecutionResult, ToolHandler, ToolRegistry, type UsageSource, type WebFetchRequestInput, type WebSearchRequestInput, type WithCancellation, checkEndpointHealth, computeBackoffDelayMs, createEnhancedFetch, defineTool, detectModelCapabilities, extractUsage, inferRuntimeMode, listAvailableModels, loadMcpTools, noopLogger, normalizeChatStream, normalizeGenerateStream, normalizeProgressStream, normalizeRetryConfig, parseStructuredOutput, registerMcpTools, toolToOllamaFormat, zodToOllamaFormat };
