'use strict';

var ollama = require('ollama');
var zod = require('zod');

// src/adapter/ollama-adapter.ts

// src/errors.ts
var OllamaClientError = class extends Error {
  /** Machine-readable error code, stable across minor versions. */
  code;
  /** HTTP status code, when the error originated from an HTTP response. */
  status;
  /** Context describing the request that failed, with secrets stripped. */
  request;
  /** Context describing the response that caused the error, when available. */
  response;
  /** Whether the operation that produced this error is safe to retry. */
  retryable;
  constructor(message, options) {
    super(message, { cause: options.cause });
    this.name = this.constructor.name;
    this.code = options.code;
    this.status = options.status;
    this.request = options.request;
    this.response = options.response;
    this.retryable = options.retryable ?? false;
    Error.captureStackTrace?.(this, this.constructor);
  }
};
var OllamaNetworkError = class extends OllamaClientError {
  constructor(message, options = {}) {
    super(message, { ...options, code: "network_error", retryable: options.retryable ?? true });
  }
};
var OllamaTimeoutError = class extends OllamaClientError {
  timeoutMs;
  constructor(message, options = {}) {
    super(message, { ...options, code: "timeout", retryable: options.retryable ?? true });
    this.timeoutMs = options.timeoutMs;
  }
};
var OllamaValidationError = class extends OllamaClientError {
  /** The underlying validation issues (e.g. a ZodError), when available. */
  issues;
  constructor(message, options = {}) {
    super(message, { ...options, code: "validation_error", retryable: false });
    this.issues = options.issues;
  }
};
var OllamaAuthError = class extends OllamaClientError {
  constructor(message, options = {}) {
    super(message, { ...options, code: "auth_error", retryable: false });
  }
};
var OllamaNotFoundError = class extends OllamaClientError {
  constructor(message, options = {}) {
    super(message, { ...options, code: "not_found", retryable: false });
  }
};
var OllamaRateLimitError = class extends OllamaClientError {
  /** Milliseconds to wait before retrying, when the server provided a `Retry-After` header. */
  retryAfterMs;
  constructor(message, options = {}) {
    super(message, { ...options, code: "rate_limited", retryable: options.retryable ?? true });
    this.retryAfterMs = options.retryAfterMs;
  }
};
var OllamaServerError = class extends OllamaClientError {
  constructor(message, options = {}) {
    super(message, { ...options, code: "server_error", retryable: options.retryable ?? true });
  }
};
var OllamaUnsupportedFeatureError = class extends OllamaClientError {
  constructor(message, options = {}) {
    super(message, { ...options, code: "unsupported_feature", retryable: false });
  }
};
var OllamaAbortError = class extends OllamaClientError {
  constructor(message = "Request was aborted", options = {}) {
    super(message, { ...options, code: "aborted", retryable: false });
  }
};
var OllamaGenericClientError = class extends OllamaClientError {
  constructor(message, options = {}) {
    super(message, { ...options, code: "client_error", retryable: options.retryable ?? false });
  }
};
function isDomAbortError(error) {
  return typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError";
}
function isUpstreamResponseError(error) {
  return error instanceof Error && error.name === "ResponseError" && typeof error.status_code === "number";
}
function statusToError(status, message, options) {
  if (status === 401 || status === 403) {
    return new OllamaAuthError(message, { ...options, status });
  }
  if (status === 404) {
    return new OllamaNotFoundError(message, { ...options, status });
  }
  if (status === 429) {
    return new OllamaRateLimitError(message, { ...options, status });
  }
  if (status >= 500) {
    return new OllamaServerError(message, { ...options, status });
  }
  return new OllamaGenericClientError(message, { ...options, status });
}
function mapError(error, context = {}) {
  if (error instanceof OllamaClientError) {
    return error;
  }
  if (isDomAbortError(error)) {
    return new OllamaAbortError(error.message || "Request was aborted", {
      cause: error,
      request: context.request
    });
  }
  if (isUpstreamResponseError(error)) {
    return statusToError(error.status_code, error.message, {
      cause: error,
      request: context.request,
      response: context.response ?? { status: error.status_code }
    });
  }
  if (error instanceof TypeError) {
    return new OllamaNetworkError(error.message || "Network request failed", {
      cause: error,
      request: context.request
    });
  }
  if (context.response?.status !== void 0) {
    const message2 = error instanceof Error ? error.message : String(error);
    return statusToError(context.response.status, message2, {
      cause: error,
      request: context.request,
      response: context.response
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  return new OllamaGenericClientError(message, {
    cause: error,
    request: context.request,
    response: context.response
  });
}

// src/adapter/ollama-adapter.ts
var OllamaAdapter = class {
  upstream;
  constructor(config) {
    this.upstream = new ollama.Ollama({
      host: config.host,
      fetch: config.fetch,
      headers: config.headers
    });
  }
  context(endpoint, extra = {}) {
    return { endpoint, method: "POST", ...extra };
  }
  async chat(request) {
    try {
      if (request.stream) {
        return await this.upstream.chat({ ...request, stream: true });
      }
      return await this.upstream.chat({ ...request, stream: false });
    } catch (error) {
      throw mapError(error, {
        request: this.context("/api/chat", { model: request.model, stream: request.stream })
      });
    }
  }
  async generate(request) {
    try {
      if (request.stream) {
        return await this.upstream.generate({ ...request, stream: true });
      }
      return await this.upstream.generate({ ...request, stream: false });
    } catch (error) {
      throw mapError(error, {
        request: this.context("/api/generate", { model: request.model, stream: request.stream })
      });
    }
  }
  async embed(request) {
    try {
      return await this.upstream.embed(request);
    } catch (error) {
      throw mapError(error, { request: this.context("/api/embed", { model: request.model }) });
    }
  }
  async embeddings(request) {
    try {
      return await this.upstream.embeddings(request);
    } catch (error) {
      throw mapError(error, {
        request: this.context("/api/embeddings", { model: request.model })
      });
    }
  }
  async list() {
    try {
      return await this.upstream.list();
    } catch (error) {
      throw mapError(error, { request: this.context("/api/tags", { method: "GET" }) });
    }
  }
  async show(request) {
    try {
      return await this.upstream.show(request);
    } catch (error) {
      throw mapError(error, { request: this.context("/api/show", { model: request.model }) });
    }
  }
  async pull(request) {
    try {
      if (request.stream) {
        return await this.upstream.pull({ ...request, stream: true });
      }
      return await this.upstream.pull({ ...request, stream: false });
    } catch (error) {
      throw mapError(error, {
        request: this.context("/api/pull", { model: request.model, stream: request.stream })
      });
    }
  }
  async push(request) {
    try {
      if (request.stream) {
        return await this.upstream.push({ ...request, stream: true });
      }
      return await this.upstream.push({ ...request, stream: false });
    } catch (error) {
      throw mapError(error, {
        request: this.context("/api/push", { model: request.model, stream: request.stream })
      });
    }
  }
  async create(request) {
    try {
      if (request.stream) {
        return await this.upstream.create({ ...request, stream: true });
      }
      return await this.upstream.create({ ...request, stream: false });
    } catch (error) {
      throw mapError(error, {
        request: this.context("/api/create", { model: request.model, stream: request.stream })
      });
    }
  }
  async delete(request) {
    try {
      return await this.upstream.delete(request);
    } catch (error) {
      throw mapError(error, {
        request: this.context("/api/delete", { method: "DELETE", model: request.model })
      });
    }
  }
  async copy(request) {
    try {
      return await this.upstream.copy(request);
    } catch (error) {
      throw mapError(error, { request: this.context("/api/copy") });
    }
  }
  async ps() {
    try {
      return await this.upstream.ps();
    } catch (error) {
      throw mapError(error, { request: this.context("/api/ps", { method: "GET" }) });
    }
  }
  async version() {
    try {
      return await this.upstream.version();
    } catch (error) {
      throw mapError(error, { request: this.context("/api/version", { method: "GET" }) });
    }
  }
  async webSearch(request) {
    try {
      return await this.upstream.webSearch(request);
    } catch (error) {
      throw mapError(error, { request: this.context("/api/web-search", { method: "POST" }) });
    }
  }
  async webFetch(request) {
    try {
      return await this.upstream.webFetch(request);
    } catch (error) {
      throw mapError(error, { request: this.context("/api/web-fetch", { method: "POST" }) });
    }
  }
  /** Aborts every in-flight streamed request created through this adapter's upstream client. */
  abortAll() {
    this.upstream.abort();
  }
};

// src/config.ts
var DEFAULT_BASE_URL = "http://localhost:11434";
var DEFAULT_TIMEOUT_MS = 3e4;
var DEFAULT_FAILOVER_CODES = [
  "network_error",
  "timeout",
  "server_error",
  "rate_limited",
  "auth_error"
];

// src/logger.ts
var noopLogger = {
  debug: () => void 0,
  info: () => void 0,
  warn: () => void 0,
  error: () => void 0
};
var ConsoleLogger = class {
  constructor(minLevel = "debug", prefix = "[ollama-client-js]") {
    this.minLevel = minLevel;
    this.prefix = prefix;
  }
  minLevel;
  prefix;
  shouldLog(level) {
    const order = ["debug", "info", "warn", "error"];
    return order.indexOf(level) >= order.indexOf(this.minLevel);
  }
  debug(message, meta) {
    if (this.shouldLog("debug")) console.debug(this.prefix, message, meta ?? "");
  }
  info(message, meta) {
    if (this.shouldLog("info")) console.info(this.prefix, message, meta ?? "");
  }
  warn(message, meta) {
    if (this.shouldLog("warn")) console.warn(this.prefix, message, meta ?? "");
  }
  error(message, meta) {
    if (this.shouldLog("error")) console.error(this.prefix, message, meta ?? "");
  }
};
function createLifecycleDispatcher(hooks, logger) {
  return (event) => {
    for (const hook of hooks) {
      try {
        hook(event);
      } catch (hookError) {
        logger.warn("Lifecycle hook threw an error", { hookError });
      }
    }
    switch (event.type) {
      case "request:start":
        logger.debug("Request started", event);
        break;
      case "request:success":
        logger.debug("Request succeeded", event);
        break;
      case "request:retry":
        logger.warn("Retrying request", event);
        break;
      case "request:error":
        logger.error("Request failed", event);
        break;
    }
  };
}

// src/middleware.ts
var MiddlewarePipeline = class {
  constructor(middleware = []) {
    this.middleware = middleware;
  }
  middleware;
  get size() {
    return this.middleware.length;
  }
  async runRequest(ctx) {
    for (const middleware of this.middleware) {
      await middleware.onRequest?.(ctx);
    }
  }
  async runResponse(ctx) {
    for (const middleware of this.middleware) {
      await middleware.onResponse?.(ctx);
    }
  }
  async runError(ctx) {
    for (const middleware of this.middleware) {
      await middleware.onError?.(ctx);
    }
  }
  async decideRetry(ctx) {
    let decision = ctx.defaultDecision;
    for (const middleware of this.middleware) {
      const result = await middleware.shouldRetry?.(ctx);
      if (result !== void 0) {
        decision = result;
      }
    }
    return decision;
  }
};

// src/providers/endpoint-registry.ts
var EndpointRegistry = class {
  endpoints;
  health = /* @__PURE__ */ new Map();
  failureThreshold;
  cooldownMs;
  now;
  constructor(endpoints, options = {}) {
    if (endpoints.length === 0) {
      throw new Error("EndpointRegistry requires at least one endpoint");
    }
    const names = /* @__PURE__ */ new Set();
    for (const endpoint of endpoints) {
      if (names.has(endpoint.name)) {
        throw new Error(`Duplicate endpoint name: "${endpoint.name}"`);
      }
      names.add(endpoint.name);
    }
    this.endpoints = [...endpoints].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
    for (const endpoint of this.endpoints) {
      this.health.set(endpoint.name, { consecutiveFailures: 0 });
    }
    this.failureThreshold = options.failureThreshold ?? 3;
    this.cooldownMs = options.cooldownMs ?? 3e4;
    this.now = options.now ?? Date.now;
  }
  list() {
    return this.endpoints;
  }
  /**
   * Returns endpoints in the order they should be attempted for the next
   * request: healthy endpoints first (by priority), falling back to
   * endpoints still in cooldown - soonest to recover first - only if every
   * endpoint is currently unhealthy (fail open rather than refusing to try).
   */
  candidates() {
    const now = this.now();
    const available = this.endpoints.filter((endpoint) => {
      const state = this.health.get(endpoint.name);
      return !state?.cooldownUntil || state.cooldownUntil <= now;
    });
    if (available.length > 0) return available;
    return [...this.endpoints].sort(
      (a, b) => (this.health.get(a.name)?.cooldownUntil ?? 0) - (this.health.get(b.name)?.cooldownUntil ?? 0)
    );
  }
  reportSuccess(name) {
    const state = this.health.get(name);
    if (!state) return;
    state.consecutiveFailures = 0;
    state.cooldownUntil = void 0;
  }
  reportFailure(name) {
    const state = this.health.get(name);
    if (!state) return;
    state.consecutiveFailures += 1;
    if (state.consecutiveFailures >= this.failureThreshold) {
      state.cooldownUntil = this.now() + this.cooldownMs;
    }
  }
  status() {
    const now = this.now();
    return this.endpoints.map((endpoint) => {
      const state = this.health.get(endpoint.name) ?? { consecutiveFailures: 0 };
      return {
        name: endpoint.name,
        healthy: !state.cooldownUntil || state.cooldownUntil <= now,
        consecutiveFailures: state.consecutiveFailures,
        cooldownUntil: state.cooldownUntil
      };
    });
  }
};

// src/providers/health-check.ts
async function checkEndpointHealth(endpoint, fetchImpl, timeoutMs = 5e3) {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = new URL("/api/version", endpoint.baseUrl).toString();
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        ...endpoint.headers,
        ...endpoint.apiKey ? { authorization: `Bearer ${endpoint.apiKey}` } : {}
      },
      signal: controller.signal
    });
    return {
      name: endpoint.name,
      reachable: response.ok,
      latencyMs: Date.now() - start,
      error: response.ok ? void 0 : `HTTP ${response.status}`
    };
  } catch (error) {
    return {
      name: endpoint.name,
      reachable: false,
      latencyMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timer);
  }
}

// src/capabilities/capabilities.ts
var PRIVATE_IPV4 = /^(10\.|127\.|0\.0\.0\.0$|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/;
function inferRuntimeMode(baseUrl) {
  try {
    const { hostname } = new URL(baseUrl);
    if (hostname === "localhost" || hostname === "::1" || PRIVATE_IPV4.test(hostname)) {
      return "local";
    }
    return "cloud";
  } catch {
    return "unknown";
  }
}
async function detectModelCapabilities(adapter, model) {
  const show = await adapter.show({ model });
  const reported = show.capabilities ?? [];
  return {
    model,
    reported,
    supportsTools: reported.includes("tools"),
    supportsVision: reported.includes("vision"),
    supportsEmbedding: reported.includes("embedding"),
    supportsCompletion: reported.includes("completion"),
    supportsStreaming: true,
    supportsStructuredOutputRequest: true
  };
}
async function listAvailableModels(adapter) {
  const { models } = await adapter.list();
  return models;
}
function zodToOllamaFormat(schema) {
  return zod.z.toJSONSchema(schema, { target: "draft-7" });
}
function parseStructuredOutput(raw, schema) {
  let parsedJson;
  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    throw new OllamaValidationError(
      "Model response was not valid JSON and could not be parsed as structured output.",
      { cause: error, response: { body: raw } }
    );
  }
  const result = schema.safeParse(parsedJson);
  if (!result.success) {
    throw new OllamaValidationError("Model response did not match the expected schema.", {
      issues: result.error.issues,
      response: { body: parsedJson }
    });
  }
  return result.data;
}

// src/streaming/stream.ts
var OllamaStream = class {
  constructor(source, mapChunk, aggregate, initial) {
    this.source = source;
    this.mapChunk = mapChunk;
    this.aggregate = aggregate;
    this.initial = initial;
    this.finalResultPromise = new Promise((resolve, reject) => {
      this.resolveFinal = resolve;
      this.rejectFinal = reject;
    });
    this.finalResultPromise.catch(() => void 0);
  }
  source;
  mapChunk;
  aggregate;
  initial;
  listeners = /* @__PURE__ */ new Map();
  mode;
  finalResultPromise;
  resolveFinal;
  rejectFinal;
  /** Resolves with the fully aggregated result once the stream completes, or rejects on stream error. */
  get finalResult() {
    return this.finalResultPromise;
  }
  /** Cancels the underlying request, if the source supports it. */
  abort() {
    this.source.abort?.();
  }
  /** Subscribes to a single normalized event type. Returns an unsubscribe function. */
  on(type, listener) {
    if (this.mode === "iterator") {
      throw new Error(
        "Cannot register event listeners: this stream is already being consumed via async iteration."
      );
    }
    const genericListener = listener;
    let set = this.listeners.get(type);
    if (!set) {
      set = /* @__PURE__ */ new Set();
      this.listeners.set(type, set);
    }
    set.add(genericListener);
    if (this.mode !== "events") {
      this.mode = "events";
      void this.pump();
    }
    return () => {
      set?.delete(genericListener);
    };
  }
  emit(event) {
    for (const listener of this.listeners.get(event.type) ?? []) {
      listener(event);
    }
  }
  async pump() {
    let accumulated = this.initial;
    try {
      for await (const chunk of this.source) {
        accumulated = this.aggregate(accumulated, chunk);
        for (const event of this.mapChunk(chunk, accumulated)) {
          this.emit(event);
          if (event.type === "done") {
            this.resolveFinal(event.data.result);
          }
        }
      }
    } catch (error) {
      const mapped = mapError(error);
      this.emit({ type: "error", data: { error: mapped } });
      this.rejectFinal(mapped);
    }
  }
  async *[Symbol.asyncIterator]() {
    if (this.mode === "events") {
      throw new Error(
        "Cannot use async iteration: this stream already has event listeners registered via .on()."
      );
    }
    this.mode = "iterator";
    let accumulated = this.initial;
    try {
      for await (const chunk of this.source) {
        accumulated = this.aggregate(accumulated, chunk);
        const events = this.mapChunk(chunk, accumulated);
        for (const event of events) {
          if (event.type === "done") {
            this.resolveFinal(event.data.result);
          }
          yield event;
        }
      }
    } catch (error) {
      const mapped = mapError(error);
      this.rejectFinal(mapped);
      yield { type: "error", data: { error: mapped } };
    }
  }
};

// src/usage.ts
var NANOS_PER_MS = 1e6;
var NANOS_PER_SECOND = 1e9;
function nanosToMs(value) {
  return value === void 0 ? void 0 : value / NANOS_PER_MS;
}
function extractUsage(source) {
  const { prompt_eval_count: promptTokens, eval_count: completionTokens } = source;
  const totalTokens = promptTokens === void 0 && completionTokens === void 0 ? void 0 : (promptTokens ?? 0) + (completionTokens ?? 0);
  const tokensPerSecond = completionTokens !== void 0 && source.eval_duration ? completionTokens / (source.eval_duration / NANOS_PER_SECOND) : void 0;
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    totalDurationMs: nanosToMs(source.total_duration),
    loadDurationMs: nanosToMs(source.load_duration),
    promptEvalDurationMs: nanosToMs(source.prompt_eval_duration),
    evalDurationMs: nanosToMs(source.eval_duration),
    tokensPerSecond
  };
}

// src/streaming/normalize.ts
var NANOS_PER_MS2 = 1e6;
function aggregateChat(accumulated, chunk) {
  const message = chunk.message ?? { role: "assistant", content: "" };
  return {
    message: {
      role: message.role || accumulated.message.role,
      content: accumulated.message.content + (message.content ?? ""),
      thinking: message.thinking !== void 0 ? (accumulated.message.thinking ?? "") + message.thinking : accumulated.message.thinking,
      tool_calls: message.tool_calls?.length ? [...accumulated.message.tool_calls ?? [], ...message.tool_calls] : accumulated.message.tool_calls
    },
    model: chunk.model,
    done: chunk.done,
    totalDurationMs: chunk.done ? chunk.total_duration / NANOS_PER_MS2 : accumulated.totalDurationMs,
    usage: chunk.done ? extractUsage(chunk) : accumulated.usage,
    raw: chunk
  };
}
function mapChatChunk(chunk, aggregated) {
  const events = [];
  const message = chunk.message;
  if (message?.thinking) {
    events.push({ type: "thinking", data: { delta: message.thinking } });
  }
  for (const toolCall of message?.tool_calls ?? []) {
    events.push({ type: "tool_call", data: { toolCall } });
  }
  if (message?.content) {
    events.push({ type: "token", data: { delta: message.content, role: message.role } });
  }
  events.push({ type: "message", data: { chunk } });
  if (chunk.done) {
    events.push({ type: "done", data: { result: aggregated } });
  }
  return events;
}
function normalizeChatStream(source) {
  const initial = {
    message: { role: "assistant", content: "" },
    model: "",
    done: false
  };
  return new OllamaStream(source, mapChatChunk, aggregateChat, initial);
}
function aggregateGenerate(accumulated, chunk) {
  return {
    response: accumulated.response + (chunk.response ?? ""),
    model: chunk.model,
    done: chunk.done,
    totalDurationMs: chunk.done ? chunk.total_duration / NANOS_PER_MS2 : accumulated.totalDurationMs,
    usage: chunk.done ? extractUsage(chunk) : accumulated.usage,
    raw: chunk
  };
}
function mapGenerateChunk(chunk, aggregated) {
  const events = [];
  if (chunk.thinking) {
    events.push({ type: "thinking", data: { delta: chunk.thinking } });
  }
  if (chunk.response) {
    events.push({ type: "token", data: { delta: chunk.response, role: "assistant" } });
  }
  events.push({ type: "message", data: { chunk } });
  if (chunk.done) {
    events.push({ type: "done", data: { result: aggregated } });
  }
  return events;
}
function normalizeGenerateStream(source) {
  const initial = { response: "", model: "", done: false };
  return new OllamaStream(source, mapGenerateChunk, aggregateGenerate, initial);
}
function isProgressDone(chunk) {
  return chunk.status === "success";
}
function aggregateProgress(_accumulated, chunk) {
  return {
    status: chunk.status,
    completed: chunk.completed,
    total: chunk.total,
    done: isProgressDone(chunk),
    raw: chunk
  };
}
function mapProgressChunk(chunk, aggregated) {
  const events = [
    { type: "message", data: { chunk } }
  ];
  if (isProgressDone(chunk)) {
    events.push({ type: "done", data: { result: aggregated } });
  }
  return events;
}
function normalizeProgressStream(source) {
  const initial = { status: "", done: false };
  return new OllamaStream(source, mapProgressChunk, aggregateProgress, initial);
}

// src/transport/backoff.ts
function computeBackoffDelayMs(attemptIndex, config) {
  const exponential = config.initialDelayMs * Math.pow(config.backoffMultiplier, attemptIndex);
  const capped = Math.min(exponential, config.maxDelayMs);
  if (!config.jitter) return capped;
  return Math.random() * capped;
}

// src/transport/retry.ts
var DEFAULT_RETRY_CONFIG = {
  maxRetries: 2,
  initialDelayMs: 250,
  maxDelayMs: 8e3,
  backoffMultiplier: 2,
  jitter: true,
  retryableStatusCodes: [408, 409, 425, 429, 500, 502, 503, 504],
  retryOnNetworkError: true,
  retryOnTimeout: true
};
function normalizeRetryConfig(retries) {
  if (retries === void 0) {
    return DEFAULT_RETRY_CONFIG;
  }
  if (typeof retries === "number") {
    return { ...DEFAULT_RETRY_CONFIG, maxRetries: retries };
  }
  return { ...DEFAULT_RETRY_CONFIG, ...retries };
}
function isRetryableStatus(status, config) {
  return config.retryableStatusCodes.includes(status);
}

// src/transport/timeout.ts
var TimeoutReason = class {
  constructor(timeoutMs) {
    this.timeoutMs = timeoutMs;
  }
  timeoutMs;
};
function createTimeoutSignal(timeoutMs, userSignal) {
  if (!timeoutMs && !userSignal) {
    return { signal: new AbortController().signal, cancel: () => void 0 };
  }
  const controller = new AbortController();
  let timer;
  if (userSignal) {
    if (userSignal.aborted) {
      controller.abort(userSignal.reason);
    } else {
      userSignal.addEventListener("abort", () => controller.abort(userSignal.reason), {
        once: true
      });
    }
  }
  if (timeoutMs && timeoutMs > 0 && !controller.signal.aborted) {
    timer = setTimeout(() => {
      controller.abort(new TimeoutReason(timeoutMs));
    }, timeoutMs);
    timer.unref?.();
  }
  return {
    signal: controller.signal,
    cancel: () => {
      if (timer) clearTimeout(timer);
    }
  };
}
function isAbortError(error) {
  return typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError" || error instanceof Error && error.name === "AbortError";
}
function errorFromAbortSignal(signal) {
  if (signal.reason instanceof TimeoutReason) {
    return new OllamaTimeoutError(`Request timed out after ${signal.reason.timeoutMs}ms`, {
      timeoutMs: signal.reason.timeoutMs
    });
  }
  return new OllamaAbortError("Request was aborted");
}
function raceWithSignal(promise, signal) {
  if (signal.aborted) {
    return Promise.reject(errorFromAbortSignal(signal));
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(errorFromAbortSignal(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}
function sleep(ms, signal) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      resolve();
    }, ms);
    timer.unref?.();
  });
}

// src/transport/enhanced-fetch.ts
function normalizeHeaders(headers) {
  if (!headers) return {};
  if (headers instanceof Headers) {
    const out = {};
    headers.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  return { ...headers };
}
function resolveUrl(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}
function tryParseJsonBody(body) {
  if (typeof body !== "string") return void 0;
  try {
    return JSON.parse(body);
  } catch {
    return void 0;
  }
}
function generateRequestId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
function classifyThrownError(error, signal) {
  if (isAbortError(error)) {
    const classified = errorFromAbortSignal(signal);
    return classified instanceof OllamaTimeoutError ? new OllamaTimeoutError(classified.message, {
      timeoutMs: classified.timeoutMs,
      cause: error
    }) : new OllamaAbortError(classified.message, { cause: error });
  }
  return mapError(error);
}
function createEnhancedFetch(config) {
  return async function enhancedFetch(input, init) {
    const url = resolveUrl(input);
    const method = init?.method ?? "GET";
    const requestId = generateRequestId();
    let attempt = 0;
    for (; ; ) {
      attempt += 1;
      const headers = {
        ...config.baseHeaders,
        ...normalizeHeaders(init?.headers),
        ...config.getAuthHeaders?.()
      };
      const requestCtx = {
        request: { url, method, headers, body: tryParseJsonBody(init?.body) },
        attempt,
        requestId,
        meta: {}
      };
      await config.middleware.runRequest(requestCtx);
      const { signal, cancel } = createTimeoutSignal(config.timeoutMs, init?.signal ?? void 0);
      const start = Date.now();
      config.onLifecycleEvent({ type: "request:start", requestId, method, url, attempt });
      let response;
      let thrown;
      try {
        response = await config.fetchImpl(input, {
          ...init,
          headers: requestCtx.request.headers,
          signal
        });
      } catch (error) {
        thrown = error;
      } finally {
        cancel();
      }
      const durationMs = Date.now() - start;
      if (response) {
        const responseCtx = { ...requestCtx, response, durationMs };
        await config.middleware.runResponse(responseCtx);
        if (response.ok) {
          config.onLifecycleEvent({
            type: "request:success",
            requestId,
            method,
            url,
            attempt,
            status: response.status,
            durationMs
          });
          config.reportOutcome?.(true);
          return response;
        }
        const retryableStatus = isRetryableStatus(response.status, config.retry);
        const defaultDecision2 = retryableStatus && attempt <= config.retry.maxRetries;
        const shouldRetry2 = await config.middleware.decideRetry({
          ...requestCtx,
          response,
          defaultDecision: defaultDecision2
        });
        if (!shouldRetry2) {
          config.reportOutcome?.(false);
          return response;
        }
        await response.body?.cancel().catch(() => void 0);
        const delayMs2 = computeBackoffDelayMs(attempt - 1, config.retry);
        config.onLifecycleEvent({
          type: "request:retry",
          requestId,
          method,
          url,
          attempt,
          delayMs: delayMs2,
          reason: `HTTP ${response.status}`
        });
        await sleep(delayMs2);
        continue;
      }
      const mapped = classifyThrownError(thrown, signal);
      const errorCtx = { ...requestCtx, error: mapped, durationMs };
      await config.middleware.runError(errorCtx);
      config.onLifecycleEvent({
        type: "request:error",
        requestId,
        method,
        url,
        attempt,
        durationMs,
        error: mapped
      });
      const isUserAbort = mapped instanceof OllamaAbortError;
      const isTimeout = mapped instanceof OllamaTimeoutError;
      const isNetwork = mapped instanceof OllamaNetworkError;
      const retryableError = !isUserAbort && (isTimeout && config.retry.retryOnTimeout || isNetwork && config.retry.retryOnNetworkError);
      const defaultDecision = retryableError && attempt <= config.retry.maxRetries;
      const shouldRetry = await config.middleware.decideRetry({
        ...requestCtx,
        error: mapped,
        defaultDecision
      });
      if (!shouldRetry) {
        config.reportOutcome?.(false, mapped);
        throw mapped;
      }
      const delayMs = computeBackoffDelayMs(attempt - 1, config.retry);
      config.onLifecycleEvent({
        type: "request:retry",
        requestId,
        method,
        url,
        attempt,
        delayMs,
        reason: mapped.message
      });
      await sleep(delayMs);
    }
  };
}

// src/transport/raw.ts
function isBodyInitLike(value) {
  return typeof value === "string" || value instanceof Uint8Array || value instanceof ArrayBuffer || value instanceof Blob || value instanceof FormData || value instanceof URLSearchParams || value instanceof ReadableStream;
}
async function toClientError(response, request) {
  let message = `Request failed with status ${response.status}`;
  let body;
  const contentType = response.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      body = await response.json();
      if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
        message = body.error;
      }
    } else {
      const text = await response.text();
      body = text;
      if (text) message = text;
    }
  } catch {
  }
  return mapError(new Error(message), {
    request: { method: request.method ?? "GET", url: request.path, endpoint: request.path },
    response: { status: response.status, statusText: response.statusText, body }
  });
}
var RawHttpClient = class {
  constructor(baseUrl, fetchImpl) {
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
  }
  baseUrl;
  fetchImpl;
  /** Sends a raw HTTP request relative to the client's base URL. Does not throw on non-2xx responses. */
  async request(options) {
    const url = new URL(options.path, this.baseUrl).toString();
    const { body: optionsBody } = options;
    const jsonBody = optionsBody !== void 0 && !isBodyInitLike(optionsBody);
    const init = {
      method: options.method ?? (optionsBody !== void 0 ? "POST" : "GET"),
      headers: {
        ...jsonBody ? { "content-type": "application/json" } : {},
        ...options.headers
      },
      body: optionsBody === void 0 ? void 0 : isBodyInitLike(optionsBody) ? optionsBody : JSON.stringify(optionsBody),
      signal: options.signal
    };
    return this.fetchImpl(url, init);
  }
  /** Like {@link request}, but parses and returns a JSON body, throwing a structured error on failure. */
  async requestJson(options) {
    const response = await this.request(options);
    if (!response.ok) {
      throw await toClientError(response, options);
    }
    return await response.json();
  }
  /** Checks whether a file blob already exists on the server (`HEAD /api/blobs/:digest`). */
  async blobExists(digest, signal) {
    const response = await this.request({ method: "HEAD", path: `/api/blobs/${digest}`, signal });
    if (response.status === 200) return true;
    if (response.status === 404) return false;
    throw await toClientError(response, { method: "HEAD", path: `/api/blobs/${digest}` });
  }
  /** Uploads a file blob (`POST /api/blobs/:digest`) so it can be referenced when creating a model. */
  async pushBlob(digest, data, signal) {
    const response = await this.request({
      method: "POST",
      path: `/api/blobs/${digest}`,
      body: data,
      signal
    });
    if (!response.ok) {
      throw await toClientError(response, { method: "POST", path: `/api/blobs/${digest}` });
    }
  }
};

// src/client.ts
function stripCancellation(request) {
  const { signal: _signal, timeoutMs: _timeoutMs, ...rest } = request;
  return rest;
}
var OllamaClient = class {
  registry;
  endpointResources = /* @__PURE__ */ new Map();
  middlewarePipeline;
  logger;
  retryConfig;
  fetchImpl;
  timeoutMs;
  lifecycleHook;
  failoverOn;
  constructor(config = {}) {
    const endpoints = config.endpoints && config.endpoints.length > 0 ? config.endpoints : [
      {
        name: "default",
        baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
        apiKey: config.apiKey,
        headers: config.headers
      }
    ];
    this.registry = new EndpointRegistry(endpoints, config.endpointHealth);
    this.logger = config.logger ?? (config.debug ? new ConsoleLogger() : noopLogger);
    this.middlewarePipeline = new MiddlewarePipeline(config.middleware ?? []);
    this.retryConfig = normalizeRetryConfig(config.retries);
    this.fetchImpl = config.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.lifecycleHook = createLifecycleDispatcher(
      config.onLifecycleEvent ? [config.onLifecycleEvent] : [],
      this.logger
    );
    this.failoverOn = config.failoverOn ?? DEFAULT_FAILOVER_CODES;
  }
  resourcesFor(endpoint) {
    let resources = this.endpointResources.get(endpoint.name);
    if (!resources) {
      const enhancedFetch = createEnhancedFetch({
        fetchImpl: this.fetchImpl,
        timeoutMs: this.timeoutMs,
        retry: this.retryConfig,
        middleware: this.middlewarePipeline,
        logger: this.logger,
        onLifecycleEvent: this.lifecycleHook,
        getAuthHeaders: () => endpoint.apiKey ? { authorization: `Bearer ${endpoint.apiKey}` } : void 0,
        baseHeaders: endpoint.headers
      });
      resources = {
        adapter: new OllamaAdapter({ host: endpoint.baseUrl, fetch: enhancedFetch }),
        raw: new RawHttpClient(endpoint.baseUrl, enhancedFetch)
      };
      this.endpointResources.set(endpoint.name, resources);
    }
    return resources;
  }
  activeEndpoint() {
    const [endpoint] = this.registry.candidates();
    if (!endpoint) {
      throw new Error("No endpoints configured");
    }
    return endpoint;
  }
  async runWithFailover(operation) {
    let lastError;
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
        this.logger.warn("Request failed against endpoint, considering failover", {
          endpoint: endpoint.name,
          code: mapped.code
        });
        this.registry.reportFailure(endpoint.name);
      }
    }
    throw mapError(lastError);
  }
  async withCancellation(operation, options) {
    if (!options.signal && options.timeoutMs === void 0) {
      return operation();
    }
    const { signal, cancel } = createTimeoutSignal(options.timeoutMs, options.signal);
    try {
      return await raceWithSignal(operation(), signal);
    } finally {
      cancel();
    }
  }
  propagateAbort(stream, signal) {
    signal?.addEventListener("abort", () => stream.abort(), { once: true });
  }
  async chat(request) {
    const { signal, timeoutMs } = request;
    const upstreamRequest = stripCancellation(request);
    const result = await this.withCancellation(
      () => this.runWithFailover(async (adapter) => {
        if (upstreamRequest.stream) {
          const upstreamStream = await adapter.chat({ ...upstreamRequest, stream: true });
          return normalizeChatStream(upstreamStream);
        }
        return adapter.chat({ ...upstreamRequest, stream: false });
      }),
      { signal, timeoutMs }
    );
    if (result instanceof OllamaStream) {
      this.propagateAbort(result, signal);
    }
    return result;
  }
  /** Convenience wrapper equivalent to `chat({ ...request, stream: true })`. */
  chatStream(request) {
    return this.chat({ ...request, stream: true });
  }
  /** Runs a chat request constrained to a Zod schema and returns the parsed, validated result. */
  async chatWithSchema(request, schema) {
    const format = zodToOllamaFormat(schema);
    const response = await this.chat({ ...request, format, stream: false });
    return parseStructuredOutput(response.message.content, schema);
  }
  async generate(request) {
    const { signal, timeoutMs } = request;
    const upstreamRequest = stripCancellation(request);
    const result = await this.withCancellation(
      () => this.runWithFailover(async (adapter) => {
        if (upstreamRequest.stream) {
          const upstreamStream = await adapter.generate({ ...upstreamRequest, stream: true });
          return normalizeGenerateStream(upstreamStream);
        }
        return adapter.generate({ ...upstreamRequest, stream: false });
      }),
      { signal, timeoutMs }
    );
    if (result instanceof OllamaStream) {
      this.propagateAbort(result, signal);
    }
    return result;
  }
  /** Convenience wrapper equivalent to `generate({ ...request, stream: true })`. */
  generateStream(request) {
    return this.generate({ ...request, stream: true });
  }
  /** Runs a generate request constrained to a Zod schema and returns the parsed, validated result. */
  async generateWithSchema(request, schema) {
    const format = zodToOllamaFormat(schema);
    const response = await this.generate({ ...request, format, stream: false });
    return parseStructuredOutput(response.response, schema);
  }
  // ---------------------------------------------------------------------
  // Embeddings
  // ---------------------------------------------------------------------
  async embed(request) {
    const { signal, timeoutMs } = request;
    const upstreamRequest = stripCancellation(request);
    return this.withCancellation(
      () => this.runWithFailover((adapter) => adapter.embed(upstreamRequest)),
      { signal, timeoutMs }
    );
  }
  /** @deprecated Prefer {@link OllamaClient.embed}; kept for parity with the upstream single-prompt endpoint. */
  async embeddings(request) {
    const { signal, timeoutMs } = request;
    const upstreamRequest = stripCancellation(request);
    return this.withCancellation(
      () => this.runWithFailover((adapter) => adapter.embeddings(upstreamRequest)),
      { signal, timeoutMs }
    );
  }
  // ---------------------------------------------------------------------
  // Model management
  // ---------------------------------------------------------------------
  async listModels() {
    return this.runWithFailover((adapter) => listAvailableModels(adapter));
  }
  /** Alias for {@link OllamaClient.listModels}. */
  models() {
    return this.listModels();
  }
  async showModel(request) {
    const { signal, timeoutMs } = request;
    const upstreamRequest = stripCancellation(request);
    return this.withCancellation(
      () => this.runWithFailover((adapter) => adapter.show(upstreamRequest)),
      { signal, timeoutMs }
    );
  }
  async pullModel(request) {
    const { signal, timeoutMs } = request;
    const upstreamRequest = stripCancellation(request);
    const result = await this.withCancellation(
      () => this.runWithFailover(async (adapter) => {
        if (upstreamRequest.stream) {
          const upstreamStream = await adapter.pull({ ...upstreamRequest, stream: true });
          return normalizeProgressStream(upstreamStream);
        }
        return adapter.pull({ ...upstreamRequest, stream: false });
      }),
      { signal, timeoutMs }
    );
    if (result instanceof OllamaStream) {
      this.propagateAbort(result, signal);
    }
    return result;
  }
  async pushModel(request) {
    const { signal, timeoutMs } = request;
    const upstreamRequest = stripCancellation(request);
    const result = await this.withCancellation(
      () => this.runWithFailover(async (adapter) => {
        if (upstreamRequest.stream) {
          const upstreamStream = await adapter.push({ ...upstreamRequest, stream: true });
          return normalizeProgressStream(upstreamStream);
        }
        return adapter.push({ ...upstreamRequest, stream: false });
      }),
      { signal, timeoutMs }
    );
    if (result instanceof OllamaStream) {
      this.propagateAbort(result, signal);
    }
    return result;
  }
  async createModel(request) {
    const { signal, timeoutMs } = request;
    const upstreamRequest = stripCancellation(request);
    const result = await this.withCancellation(
      () => this.runWithFailover(async (adapter) => {
        if (upstreamRequest.stream) {
          const upstreamStream = await adapter.create({ ...upstreamRequest, stream: true });
          return normalizeProgressStream(upstreamStream);
        }
        return adapter.create({ ...upstreamRequest, stream: false });
      }),
      { signal, timeoutMs }
    );
    if (result instanceof OllamaStream) {
      this.propagateAbort(result, signal);
    }
    return result;
  }
  async deleteModel(request) {
    const { signal, timeoutMs } = request;
    const upstreamRequest = stripCancellation(request);
    return this.withCancellation(
      () => this.runWithFailover((adapter) => adapter.delete(upstreamRequest)),
      { signal, timeoutMs }
    );
  }
  async copyModel(request) {
    const { signal, timeoutMs } = request;
    const upstreamRequest = stripCancellation(request);
    return this.withCancellation(
      () => this.runWithFailover((adapter) => adapter.copy(upstreamRequest)),
      { signal, timeoutMs }
    );
  }
  async ps() {
    return this.runWithFailover((adapter) => adapter.ps());
  }
  async version() {
    return this.runWithFailover((adapter) => adapter.version());
  }
  // ---------------------------------------------------------------------
  // Web search and fetch
  // ---------------------------------------------------------------------
  async webSearch(request) {
    const { signal, timeoutMs } = request;
    const upstreamRequest = stripCancellation(request);
    return this.withCancellation(
      () => this.runWithFailover((adapter) => adapter.webSearch(upstreamRequest)),
      { signal, timeoutMs }
    );
  }
  async webFetch(request) {
    const { signal, timeoutMs } = request;
    const upstreamRequest = stripCancellation(request);
    return this.withCancellation(
      () => this.runWithFailover((adapter) => adapter.webFetch(upstreamRequest)),
      { signal, timeoutMs }
    );
  }
  // ---------------------------------------------------------------------
  // Capability discovery, routing, and health
  // ---------------------------------------------------------------------
  /** Probes `/api/show` for a model's server-reported capabilities. */
  async capabilities(model) {
    return this.runWithFailover((adapter) => detectModelCapabilities(adapter, model));
  }
  /** Heuristic classification of the active endpoint as local or cloud, based on its hostname. */
  runtimeMode() {
    return inferRuntimeMode(this.activeEndpoint().baseUrl);
  }
  /** Actively pings every configured endpoint's `/api/version` route. */
  async healthCheck() {
    return Promise.all(
      this.registry.list().map((endpoint) => checkEndpointHealth(endpoint, this.fetchImpl))
    );
  }
  /** Passive, failure-count-based health for every configured endpoint. */
  endpointStatus() {
    return this.registry.status();
  }
  /** Raw HTTP escape hatch for endpoints not wrapped by `ollama-js`, scoped to the currently active endpoint. */
  get raw() {
    return this.resourcesFor(this.activeEndpoint()).raw;
  }
  /** Aborts every in-flight streamed request across all configured endpoints. */
  abort() {
    for (const { adapter } of this.endpointResources.values()) {
      adapter.abortAll();
    }
  }
};

exports.ConsoleLogger = ConsoleLogger;
exports.DEFAULT_BASE_URL = DEFAULT_BASE_URL;
exports.DEFAULT_FAILOVER_CODES = DEFAULT_FAILOVER_CODES;
exports.DEFAULT_RETRY_CONFIG = DEFAULT_RETRY_CONFIG;
exports.DEFAULT_TIMEOUT_MS = DEFAULT_TIMEOUT_MS;
exports.EndpointRegistry = EndpointRegistry;
exports.MiddlewarePipeline = MiddlewarePipeline;
exports.OllamaAbortError = OllamaAbortError;
exports.OllamaAdapter = OllamaAdapter;
exports.OllamaAuthError = OllamaAuthError;
exports.OllamaClient = OllamaClient;
exports.OllamaClientError = OllamaClientError;
exports.OllamaGenericClientError = OllamaGenericClientError;
exports.OllamaNetworkError = OllamaNetworkError;
exports.OllamaNotFoundError = OllamaNotFoundError;
exports.OllamaRateLimitError = OllamaRateLimitError;
exports.OllamaServerError = OllamaServerError;
exports.OllamaStream = OllamaStream;
exports.OllamaTimeoutError = OllamaTimeoutError;
exports.OllamaUnsupportedFeatureError = OllamaUnsupportedFeatureError;
exports.OllamaValidationError = OllamaValidationError;
exports.RawHttpClient = RawHttpClient;
exports.checkEndpointHealth = checkEndpointHealth;
exports.computeBackoffDelayMs = computeBackoffDelayMs;
exports.createEnhancedFetch = createEnhancedFetch;
exports.detectModelCapabilities = detectModelCapabilities;
exports.extractUsage = extractUsage;
exports.inferRuntimeMode = inferRuntimeMode;
exports.listAvailableModels = listAvailableModels;
exports.mapError = mapError;
exports.noopLogger = noopLogger;
exports.normalizeChatStream = normalizeChatStream;
exports.normalizeGenerateStream = normalizeGenerateStream;
exports.normalizeProgressStream = normalizeProgressStream;
exports.normalizeRetryConfig = normalizeRetryConfig;
exports.parseStructuredOutput = parseStructuredOutput;
exports.zodToOllamaFormat = zodToOllamaFormat;
//# sourceMappingURL=index.cjs.map
//# sourceMappingURL=index.cjs.map