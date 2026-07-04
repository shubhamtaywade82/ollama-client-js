import type { z } from 'zod';
import type {
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
  ModelResponse,
  ProgressResponse,
  PullRequest,
  PushRequest,
  ShowRequest,
  ShowResponse,
  StatusResponse,
  VersionResponse,
} from 'ollama';

import { OllamaAdapter } from './adapter/ollama-adapter.js';
import {
  DEFAULT_BASE_URL,
  DEFAULT_FAILOVER_CODES,
  DEFAULT_TIMEOUT_MS,
  type OllamaClientConfig,
} from './config.js';
import { mapError } from './errors.js';
import { ConsoleLogger, createLifecycleDispatcher, noopLogger, type Logger } from './logger.js';
import { MiddlewarePipeline } from './middleware.js';
import {
  EndpointRegistry,
  type EndpointHealth,
  type OllamaEndpoint,
} from './providers/endpoint-registry.js';
import { checkEndpointHealth, type EndpointHealthCheckResult } from './providers/health-check.js';
import {
  detectModelCapabilities,
  inferRuntimeMode,
  listAvailableModels,
  type ModelCapabilities,
  type RuntimeMode,
} from './capabilities/capabilities.js';
import { parseStructuredOutput, zodToOllamaFormat } from './schema/zod.js';
import {
  normalizeChatStream,
  normalizeGenerateStream,
  normalizeProgressStream,
  OllamaStream,
  type ChatStreamResult,
  type GenerateStreamResult,
  type ProgressStreamResult,
} from './streaming/index.js';
import { createEnhancedFetch, type FetchLike } from './transport/enhanced-fetch.js';
import { RawHttpClient } from './transport/raw.js';
import { normalizeRetryConfig, type RetryConfig } from './transport/retry.js';
import { createTimeoutSignal, raceWithSignal } from './transport/timeout.js';

/** Adds client-side-only cancellation options to an upstream request shape. */
export type WithCancellation<T> = T & {
  /** Aborts this specific call. Independent of the client's default timeout. */
  readonly signal?: AbortSignal;
  /** Overrides the client's default timeout for this specific call, in milliseconds. */
  readonly timeoutMs?: number;
};

export type ChatRequestInput = WithCancellation<ChatRequest>;
export type GenerateRequestInput = WithCancellation<GenerateRequest>;
export type EmbedRequestInput = WithCancellation<EmbedRequest>;
export type EmbeddingsRequestInput = WithCancellation<EmbeddingsRequest>;
export type ShowRequestInput = WithCancellation<ShowRequest>;
export type PullRequestInput = WithCancellation<PullRequest>;
export type PushRequestInput = WithCancellation<PushRequest>;
export type CreateRequestInput = WithCancellation<CreateRequest>;
export type DeleteRequestInput = WithCancellation<DeleteRequest>;
export type CopyRequestInput = WithCancellation<CopyRequest>;

interface EndpointResources {
  readonly adapter: OllamaAdapter;
  readonly raw: RawHttpClient;
}

function stripCancellation<T extends { signal?: AbortSignal; timeoutMs?: number }>(
  request: T,
): Omit<T, 'signal' | 'timeoutMs'> {
  const { signal: _signal, timeoutMs: _timeoutMs, ...rest } = request;
  return rest;
}

/**
 * The public entry point of ollama-client-js.
 *
 * Wraps the upstream `ollama` package with retries, timeouts, middleware,
 * structured errors, normalized streaming, multi-endpoint failover, and
 * schema-based structured output helpers, while keeping the surface thin
 * and predictable.
 */
export class OllamaClient {
  private readonly registry: EndpointRegistry;
  private readonly endpointResources = new Map<string, EndpointResources>();
  private readonly middlewarePipeline: MiddlewarePipeline;
  private readonly logger: Logger;
  private readonly retryConfig: RetryConfig;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly lifecycleHook: ReturnType<typeof createLifecycleDispatcher>;
  private readonly failoverOn: readonly string[];

  constructor(config: OllamaClientConfig = {}) {
    const endpoints: readonly OllamaEndpoint[] =
      config.endpoints && config.endpoints.length > 0
        ? config.endpoints
        : [
            {
              name: 'default',
              baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
              apiKey: config.apiKey,
              headers: config.headers,
            },
          ];

    this.registry = new EndpointRegistry(endpoints, config.endpointHealth);
    this.logger = config.logger ?? (config.debug ? new ConsoleLogger() : noopLogger);
    this.middlewarePipeline = new MiddlewarePipeline(config.middleware ?? []);
    this.retryConfig = normalizeRetryConfig(config.retries);
    this.fetchImpl = config.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.lifecycleHook = createLifecycleDispatcher(
      config.onLifecycleEvent ? [config.onLifecycleEvent] : [],
      this.logger,
    );
    this.failoverOn = config.failoverOn ?? DEFAULT_FAILOVER_CODES;
  }

  private resourcesFor(endpoint: OllamaEndpoint): EndpointResources {
    let resources = this.endpointResources.get(endpoint.name);
    if (!resources) {
      const enhancedFetch = createEnhancedFetch({
        fetchImpl: this.fetchImpl,
        timeoutMs: this.timeoutMs,
        retry: this.retryConfig,
        middleware: this.middlewarePipeline,
        logger: this.logger,
        onLifecycleEvent: this.lifecycleHook,
        getAuthHeaders: () =>
          endpoint.apiKey ? { authorization: `Bearer ${endpoint.apiKey}` } : undefined,
        baseHeaders: endpoint.headers,
      });
      resources = {
        adapter: new OllamaAdapter({ host: endpoint.baseUrl, fetch: enhancedFetch }),
        raw: new RawHttpClient(endpoint.baseUrl, enhancedFetch),
      };
      this.endpointResources.set(endpoint.name, resources);
    }
    return resources;
  }

  private activeEndpoint(): OllamaEndpoint {
    const [endpoint] = this.registry.candidates();
    if (!endpoint) {
      throw new Error('No endpoints configured');
    }
    return endpoint;
  }

  private async runWithFailover<T>(
    operation: (adapter: OllamaAdapter, endpoint: OllamaEndpoint) => Promise<T>,
  ): Promise<T> {
    let lastError: unknown;
    for (const endpoint of this.registry.candidates()) {
      const { adapter } = this.resourcesFor(endpoint);
      try {
        const result = await operation(adapter, endpoint);
        this.registry.reportSuccess(endpoint.name);
        return result;
      } catch (error) {
        const mapped = mapError(error);
        lastError = mapped;
        if (!this.failoverOn.includes(mapped.code)) {
          throw mapped;
        }
        this.logger.warn('Request failed against endpoint, considering failover', {
          endpoint: endpoint.name,
          code: mapped.code,
        });
        this.registry.reportFailure(endpoint.name);
      }
    }
    throw mapError(lastError);
  }

  private async withCancellation<T>(
    operation: () => Promise<T>,
    options: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<T> {
    if (!options.signal && options.timeoutMs === undefined) {
      return operation();
    }
    const { signal, cancel } = createTimeoutSignal(options.timeoutMs, options.signal);
    try {
      return await raceWithSignal(operation(), signal);
    } finally {
      cancel();
    }
  }

  private propagateAbort<TChunk, TFinal>(
    stream: OllamaStream<TChunk, TFinal>,
    signal: AbortSignal | undefined,
  ): void {
    signal?.addEventListener('abort', () => stream.abort(), { once: true });
  }

  // ---------------------------------------------------------------------
  // Chat
  // ---------------------------------------------------------------------

  chat(
    request: ChatRequestInput & { stream: true },
  ): Promise<OllamaStream<ChatResponse, ChatStreamResult>>;
  chat(request: ChatRequestInput & { stream?: false }): Promise<ChatResponse>;
  async chat(
    request: ChatRequestInput,
  ): Promise<ChatResponse | OllamaStream<ChatResponse, ChatStreamResult>> {
    const { signal, timeoutMs } = request;
    const upstreamRequest = stripCancellation(request);
    const result = await this.withCancellation(
      () =>
        this.runWithFailover(async (adapter) => {
          if (upstreamRequest.stream) {
            const upstreamStream = await adapter.chat({ ...upstreamRequest, stream: true });
            return normalizeChatStream(upstreamStream);
          }
          return adapter.chat({ ...upstreamRequest, stream: false });
        }),
      { signal, timeoutMs },
    );
    if (result instanceof OllamaStream) {
      this.propagateAbort(result, signal);
    }
    return result;
  }

  /** Convenience wrapper equivalent to `chat({ ...request, stream: true })`. */
  chatStream(
    request: Omit<ChatRequestInput, 'stream'>,
  ): Promise<OllamaStream<ChatResponse, ChatStreamResult>> {
    return this.chat({ ...request, stream: true });
  }

  /** Runs a chat request constrained to a Zod schema and returns the parsed, validated result. */
  async chatWithSchema<TSchema extends z.ZodType>(
    request: Omit<ChatRequestInput, 'stream' | 'format'>,
    schema: TSchema,
  ): Promise<z.infer<TSchema>> {
    const format = zodToOllamaFormat(schema);
    const response = await this.chat({ ...request, format, stream: false });
    return parseStructuredOutput(response.message.content, schema);
  }

  // ---------------------------------------------------------------------
  // Generate
  // ---------------------------------------------------------------------

  generate(
    request: GenerateRequestInput & { stream: true },
  ): Promise<OllamaStream<GenerateResponse, GenerateStreamResult>>;
  generate(request: GenerateRequestInput & { stream?: false }): Promise<GenerateResponse>;
  async generate(
    request: GenerateRequestInput,
  ): Promise<GenerateResponse | OllamaStream<GenerateResponse, GenerateStreamResult>> {
    const { signal, timeoutMs } = request;
    const upstreamRequest = stripCancellation(request);
    const result = await this.withCancellation(
      () =>
        this.runWithFailover(async (adapter) => {
          if (upstreamRequest.stream) {
            const upstreamStream = await adapter.generate({ ...upstreamRequest, stream: true });
            return normalizeGenerateStream(upstreamStream);
          }
          return adapter.generate({ ...upstreamRequest, stream: false });
        }),
      { signal, timeoutMs },
    );
    if (result instanceof OllamaStream) {
      this.propagateAbort(result, signal);
    }
    return result;
  }

  /** Convenience wrapper equivalent to `generate({ ...request, stream: true })`. */
  generateStream(
    request: Omit<GenerateRequestInput, 'stream'>,
  ): Promise<OllamaStream<GenerateResponse, GenerateStreamResult>> {
    return this.generate({ ...request, stream: true });
  }

  /** Runs a generate request constrained to a Zod schema and returns the parsed, validated result. */
  async generateWithSchema<TSchema extends z.ZodType>(
    request: Omit<GenerateRequestInput, 'stream' | 'format'>,
    schema: TSchema,
  ): Promise<z.infer<TSchema>> {
    const format = zodToOllamaFormat(schema);
    const response = await this.generate({ ...request, format, stream: false });
    return parseStructuredOutput(response.response, schema);
  }

  // ---------------------------------------------------------------------
  // Embeddings
  // ---------------------------------------------------------------------

  async embed(request: EmbedRequestInput): Promise<EmbedResponse> {
    const { signal, timeoutMs } = request;
    const upstreamRequest = stripCancellation(request);
    return this.withCancellation(
      () => this.runWithFailover((adapter) => adapter.embed(upstreamRequest)),
      { signal, timeoutMs },
    );
  }

  /** @deprecated Prefer {@link OllamaClient.embed}; kept for parity with the upstream single-prompt endpoint. */
  async embeddings(request: EmbeddingsRequestInput): Promise<EmbeddingsResponse> {
    const { signal, timeoutMs } = request;
    const upstreamRequest = stripCancellation(request);
    return this.withCancellation(
      () => this.runWithFailover((adapter) => adapter.embeddings(upstreamRequest)),
      { signal, timeoutMs },
    );
  }

  // ---------------------------------------------------------------------
  // Model management
  // ---------------------------------------------------------------------

  async listModels(): Promise<ModelResponse[]> {
    return this.runWithFailover((adapter) => listAvailableModels(adapter));
  }

  /** Alias for {@link OllamaClient.listModels}. */
  models(): Promise<ModelResponse[]> {
    return this.listModels();
  }

  async showModel(request: ShowRequestInput): Promise<ShowResponse> {
    const { signal, timeoutMs } = request;
    const upstreamRequest = stripCancellation(request);
    return this.withCancellation(
      () => this.runWithFailover((adapter) => adapter.show(upstreamRequest)),
      { signal, timeoutMs },
    );
  }

  pullModel(
    request: PullRequestInput & { stream: true },
  ): Promise<OllamaStream<ProgressResponse, ProgressStreamResult>>;
  pullModel(request: PullRequestInput & { stream?: false }): Promise<ProgressResponse>;
  async pullModel(
    request: PullRequestInput,
  ): Promise<ProgressResponse | OllamaStream<ProgressResponse, ProgressStreamResult>> {
    const { signal, timeoutMs } = request;
    const upstreamRequest = stripCancellation(request);
    const result = await this.withCancellation(
      () =>
        this.runWithFailover(async (adapter) => {
          if (upstreamRequest.stream) {
            const upstreamStream = await adapter.pull({ ...upstreamRequest, stream: true });
            return normalizeProgressStream(upstreamStream);
          }
          return adapter.pull({ ...upstreamRequest, stream: false });
        }),
      { signal, timeoutMs },
    );
    if (result instanceof OllamaStream) {
      this.propagateAbort(result, signal);
    }
    return result;
  }

  pushModel(
    request: PushRequestInput & { stream: true },
  ): Promise<OllamaStream<ProgressResponse, ProgressStreamResult>>;
  pushModel(request: PushRequestInput & { stream?: false }): Promise<ProgressResponse>;
  async pushModel(
    request: PushRequestInput,
  ): Promise<ProgressResponse | OllamaStream<ProgressResponse, ProgressStreamResult>> {
    const { signal, timeoutMs } = request;
    const upstreamRequest = stripCancellation(request);
    const result = await this.withCancellation(
      () =>
        this.runWithFailover(async (adapter) => {
          if (upstreamRequest.stream) {
            const upstreamStream = await adapter.push({ ...upstreamRequest, stream: true });
            return normalizeProgressStream(upstreamStream);
          }
          return adapter.push({ ...upstreamRequest, stream: false });
        }),
      { signal, timeoutMs },
    );
    if (result instanceof OllamaStream) {
      this.propagateAbort(result, signal);
    }
    return result;
  }

  createModel(
    request: CreateRequestInput & { stream: true },
  ): Promise<OllamaStream<ProgressResponse, ProgressStreamResult>>;
  createModel(request: CreateRequestInput & { stream?: false }): Promise<ProgressResponse>;
  async createModel(
    request: CreateRequestInput,
  ): Promise<ProgressResponse | OllamaStream<ProgressResponse, ProgressStreamResult>> {
    const { signal, timeoutMs } = request;
    const upstreamRequest = stripCancellation(request);
    const result = await this.withCancellation(
      () =>
        this.runWithFailover(async (adapter) => {
          if (upstreamRequest.stream) {
            const upstreamStream = await adapter.create({ ...upstreamRequest, stream: true });
            return normalizeProgressStream(upstreamStream);
          }
          return adapter.create({ ...upstreamRequest, stream: false });
        }),
      { signal, timeoutMs },
    );
    if (result instanceof OllamaStream) {
      this.propagateAbort(result, signal);
    }
    return result;
  }

  async deleteModel(request: DeleteRequestInput): Promise<StatusResponse> {
    const { signal, timeoutMs } = request;
    const upstreamRequest = stripCancellation(request);
    return this.withCancellation(
      () => this.runWithFailover((adapter) => adapter.delete(upstreamRequest)),
      { signal, timeoutMs },
    );
  }

  async copyModel(request: CopyRequestInput): Promise<StatusResponse> {
    const { signal, timeoutMs } = request;
    const upstreamRequest = stripCancellation(request);
    return this.withCancellation(
      () => this.runWithFailover((adapter) => adapter.copy(upstreamRequest)),
      { signal, timeoutMs },
    );
  }

  async ps(): Promise<{ models: ModelResponse[] }> {
    return this.runWithFailover((adapter) => adapter.ps());
  }

  async version(): Promise<VersionResponse> {
    return this.runWithFailover((adapter) => adapter.version());
  }

  // ---------------------------------------------------------------------
  // Capability discovery, routing, and health
  // ---------------------------------------------------------------------

  /** Probes `/api/show` for a model's server-reported capabilities. */
  async capabilities(model: string): Promise<ModelCapabilities> {
    return this.runWithFailover((adapter) => detectModelCapabilities(adapter, model));
  }

  /** Heuristic classification of the active endpoint as local or cloud, based on its hostname. */
  runtimeMode(): RuntimeMode {
    return inferRuntimeMode(this.activeEndpoint().baseUrl);
  }

  /** Actively pings every configured endpoint's `/api/version` route. */
  async healthCheck(): Promise<EndpointHealthCheckResult[]> {
    return Promise.all(
      this.registry.list().map((endpoint) => checkEndpointHealth(endpoint, this.fetchImpl)),
    );
  }

  /** Passive, failure-count-based health for every configured endpoint. */
  endpointStatus(): EndpointHealth[] {
    return this.registry.status();
  }

  /** Raw HTTP escape hatch for endpoints not wrapped by `ollama-js`, scoped to the currently active endpoint. */
  get raw(): RawHttpClient {
    return this.resourcesFor(this.activeEndpoint()).raw;
  }

  /** Aborts every in-flight streamed request across all configured endpoints. */
  abort(): void {
    for (const { adapter } of this.endpointResources.values()) {
      adapter.abortAll();
    }
  }
}
