import { z } from 'zod';
import { ChatRequest, AbortableAsyncIterator, ChatResponse, GenerateRequest, GenerateResponse, EmbedRequest, EmbedResponse, EmbeddingsRequest, EmbeddingsResponse, ListResponse, ShowRequest, ShowResponse, PullRequest, ProgressResponse, PushRequest, CreateRequest, DeleteRequest, StatusResponse, CopyRequest, VersionResponse, WebSearchRequest, WebSearchResponse, WebFetchRequest, WebFetchResponse, ModelResponse, ToolCall } from 'ollama';
export { ChatRequest, ChatResponse, CopyRequest, CreateRequest, DeleteRequest, EmbedRequest, EmbedResponse, EmbeddingsRequest, EmbeddingsResponse, GenerateRequest, GenerateResponse, ListResponse, Message, ModelDetails, ModelResponse, Options, ProgressResponse, PullRequest, PushRequest, ShowRequest, ShowResponse, StatusResponse, Tool, ToolCall, VersionResponse, WebFetchRequest, WebFetchResponse, WebSearchRequest, WebSearchResponse } from 'ollama';

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
 * Structured error hierarchy for ollama-client-js.
 *
 * Every error thrown by this library (as opposed to errors thrown by user
 * callbacks) is an instance of {@link OllamaClientError}. Callers can rely on
 * `error.code` for programmatic branching and on the specific subclass for
 * `instanceof` checks.
 */
/** Machine-readable error codes. Stable across minor versions. */
type OllamaErrorCode = 'network_error' | 'timeout' | 'validation_error' | 'auth_error' | 'not_found' | 'rate_limited' | 'server_error' | 'unsupported_feature' | 'client_error' | 'aborted';
/** Minimal, non-sensitive information about the request that failed. */
interface OllamaErrorRequestContext {
    readonly method?: string;
    readonly url?: string;
    readonly endpoint?: string;
    readonly model?: string;
    readonly stream?: boolean;
}
/** Minimal, non-sensitive information about the response that caused the error. */
interface OllamaErrorResponseContext {
    readonly status?: number;
    readonly statusText?: string;
    readonly body?: unknown;
    readonly headers?: Record<string, string>;
}
interface OllamaClientErrorOptions {
    readonly code: OllamaErrorCode;
    readonly status?: number;
    readonly request?: OllamaErrorRequestContext;
    readonly response?: OllamaErrorResponseContext;
    readonly cause?: unknown;
    readonly retryable?: boolean;
}
/**
 * Base class for every error raised by ollama-client-js.
 */
declare class OllamaClientError extends Error {
    /** Machine-readable error code, stable across minor versions. */
    readonly code: OllamaErrorCode;
    /** HTTP status code, when the error originated from an HTTP response. */
    readonly status?: number;
    /** Context describing the request that failed, with secrets stripped. */
    readonly request?: OllamaErrorRequestContext;
    /** Context describing the response that caused the error, when available. */
    readonly response?: OllamaErrorResponseContext;
    /** Whether the operation that produced this error is safe to retry. */
    readonly retryable: boolean;
    constructor(message: string, options: OllamaClientErrorOptions);
}
declare class OllamaNetworkError extends OllamaClientError {
    constructor(message: string, options?: Omit<OllamaClientErrorOptions, 'code'>);
}
declare class OllamaTimeoutError extends OllamaClientError {
    readonly timeoutMs?: number;
    constructor(message: string, options?: Omit<OllamaClientErrorOptions, 'code'> & {
        timeoutMs?: number;
    });
}
declare class OllamaValidationError extends OllamaClientError {
    /** The underlying validation issues (e.g. a ZodError), when available. */
    readonly issues?: unknown;
    constructor(message: string, options?: Omit<OllamaClientErrorOptions, 'code'> & {
        issues?: unknown;
    });
}
declare class OllamaAuthError extends OllamaClientError {
    constructor(message: string, options?: Omit<OllamaClientErrorOptions, 'code'>);
}
declare class OllamaNotFoundError extends OllamaClientError {
    constructor(message: string, options?: Omit<OllamaClientErrorOptions, 'code'>);
}
declare class OllamaRateLimitError extends OllamaClientError {
    /** Milliseconds to wait before retrying, when the server provided a `Retry-After` header. */
    readonly retryAfterMs?: number;
    constructor(message: string, options?: Omit<OllamaClientErrorOptions, 'code'> & {
        retryAfterMs?: number;
    });
}
declare class OllamaServerError extends OllamaClientError {
    constructor(message: string, options?: Omit<OllamaClientErrorOptions, 'code'>);
}
declare class OllamaUnsupportedFeatureError extends OllamaClientError {
    constructor(message: string, options?: Omit<OllamaClientErrorOptions, 'code'>);
}
/** Raised when a request is aborted via `AbortSignal`, distinct from a timeout. */
declare class OllamaAbortError extends OllamaClientError {
    constructor(message?: string, options?: Omit<OllamaClientErrorOptions, 'code'>);
}
/** Catch-all for client-side errors that don't fit a more specific category. */
declare class OllamaGenericClientError extends OllamaClientError {
    constructor(message: string, options?: Omit<OllamaClientErrorOptions, 'code'>);
}
/**
 * Normalizes any error thrown by the transport layer, the upstream `ollama`
 * package, or user middleware into an {@link OllamaClientError} subclass.
 * Already-normalized errors are returned unchanged.
 */
declare function mapError(error: unknown, context?: {
    request?: OllamaErrorRequestContext;
    response?: OllamaErrorResponseContext;
}): OllamaClientError;

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

export { type AbortableSource, type BackoffConfig, type ChatRequestInput, type ChatStreamResult, ConsoleLogger, type CopyRequestInput, type CreateRequestInput, DEFAULT_BASE_URL, DEFAULT_FAILOVER_CODES, DEFAULT_RETRY_CONFIG, DEFAULT_TIMEOUT_MS, type DeleteRequestInput, type DoneEventData, type EmbedRequestInput, type EmbeddingsRequestInput, type EndpointHealth, type EndpointHealthCheckResult, EndpointRegistry, type EndpointRegistryOptions, type EnhancedFetchConfig, type ErrorEventData, type FetchLike, type GenerateRequestInput, type GenerateStreamResult, type LogLevel, type Logger, type MessageEventData, type Middleware, type MiddlewareErrorContext, MiddlewarePipeline, type MiddlewareRequest, type MiddlewareRequestContext, type MiddlewareResponseContext, type ModelCapabilities, OllamaAbortError, OllamaAdapter, type OllamaAdapterConfig, OllamaAuthError, OllamaClient, type OllamaClientConfig, OllamaClientError, type OllamaClientErrorOptions, type OllamaEndpoint, type OllamaErrorCode, type OllamaErrorRequestContext, type OllamaErrorResponseContext, OllamaGenericClientError, OllamaNetworkError, OllamaNotFoundError, OllamaRateLimitError, OllamaServerError, OllamaStream, type OllamaStreamEvent, type OllamaStreamEventType, OllamaTimeoutError, OllamaUnsupportedFeatureError, type OllamaUsage, OllamaValidationError, type ProgressStreamResult, type PullRequestInput, type PushRequestInput, RawHttpClient, type RawRequestOptions, type RequestLifecycleEvent, type RequestLifecycleHook, type RetryConfig, type RetryDecisionContext, type RuntimeMode, type ShowRequestInput, type ThinkingEventData, type TokenEventData, type ToolCallEventData, type UsageSource, type WebFetchRequestInput, type WebSearchRequestInput, type WithCancellation, checkEndpointHealth, computeBackoffDelayMs, createEnhancedFetch, detectModelCapabilities, extractUsage, inferRuntimeMode, listAvailableModels, mapError, noopLogger, normalizeChatStream, normalizeGenerateStream, normalizeProgressStream, normalizeRetryConfig, parseStructuredOutput, zodToOllamaFormat };
