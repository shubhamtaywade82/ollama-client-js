/**
 * Structured error hierarchy for ollama-client-js.
 *
 * Every error thrown by this library (as opposed to errors thrown by user
 * callbacks) is an instance of {@link OllamaClientError}. Callers can rely on
 * `error.code` for programmatic branching and on the specific subclass for
 * `instanceof` checks.
 */

/** Machine-readable error codes. Stable across minor versions. */
export type OllamaErrorCode =
  | 'network_error'
  | 'timeout'
  | 'validation_error'
  | 'auth_error'
  | 'not_found'
  | 'rate_limited'
  | 'server_error'
  | 'unsupported_feature'
  | 'client_error'
  | 'aborted';

/** Minimal, non-sensitive information about the request that failed. */
export interface OllamaErrorRequestContext {
  readonly method?: string;
  readonly url?: string;
  readonly endpoint?: string;
  readonly model?: string;
  readonly stream?: boolean;
}

/** Minimal, non-sensitive information about the response that caused the error. */
export interface OllamaErrorResponseContext {
  readonly status?: number;
  readonly statusText?: string;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
}

export interface OllamaClientErrorOptions {
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
export class OllamaClientError extends Error {
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

  constructor(message: string, options: OllamaClientErrorOptions) {
    super(message, { cause: options.cause });
    this.name = this.constructor.name;
    this.code = options.code;
    this.status = options.status;
    this.request = options.request;
    this.response = options.response;
    this.retryable = options.retryable ?? false;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

export class OllamaNetworkError extends OllamaClientError {
  constructor(message: string, options: Omit<OllamaClientErrorOptions, 'code'> = {}) {
    super(message, { ...options, code: 'network_error', retryable: options.retryable ?? true });
  }
}

export class OllamaTimeoutError extends OllamaClientError {
  readonly timeoutMs?: number;

  constructor(
    message: string,
    options: Omit<OllamaClientErrorOptions, 'code'> & { timeoutMs?: number } = {},
  ) {
    super(message, { ...options, code: 'timeout', retryable: options.retryable ?? true });
    this.timeoutMs = options.timeoutMs;
  }
}

export class OllamaValidationError extends OllamaClientError {
  /** The underlying validation issues (e.g. a ZodError), when available. */
  readonly issues?: unknown;

  constructor(
    message: string,
    options: Omit<OllamaClientErrorOptions, 'code'> & { issues?: unknown } = {},
  ) {
    super(message, { ...options, code: 'validation_error', retryable: false });
    this.issues = options.issues;
  }
}

export class OllamaAuthError extends OllamaClientError {
  constructor(message: string, options: Omit<OllamaClientErrorOptions, 'code'> = {}) {
    super(message, { ...options, code: 'auth_error', retryable: false });
  }
}

export class OllamaNotFoundError extends OllamaClientError {
  constructor(message: string, options: Omit<OllamaClientErrorOptions, 'code'> = {}) {
    super(message, { ...options, code: 'not_found', retryable: false });
  }
}

export class OllamaRateLimitError extends OllamaClientError {
  /** Milliseconds to wait before retrying, when the server provided a `Retry-After` header. */
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    options: Omit<OllamaClientErrorOptions, 'code'> & { retryAfterMs?: number } = {},
  ) {
    super(message, { ...options, code: 'rate_limited', retryable: options.retryable ?? true });
    this.retryAfterMs = options.retryAfterMs;
  }
}

export class OllamaServerError extends OllamaClientError {
  constructor(message: string, options: Omit<OllamaClientErrorOptions, 'code'> = {}) {
    super(message, { ...options, code: 'server_error', retryable: options.retryable ?? true });
  }
}

export class OllamaUnsupportedFeatureError extends OllamaClientError {
  constructor(message: string, options: Omit<OllamaClientErrorOptions, 'code'> = {}) {
    super(message, { ...options, code: 'unsupported_feature', retryable: false });
  }
}

/** Raised when a request is aborted via `AbortSignal`, distinct from a timeout. */
export class OllamaAbortError extends OllamaClientError {
  constructor(
    message = 'Request was aborted',
    options: Omit<OllamaClientErrorOptions, 'code'> = {},
  ) {
    super(message, { ...options, code: 'aborted', retryable: false });
  }
}

/** Catch-all for client-side errors that don't fit a more specific category. */
export class OllamaGenericClientError extends OllamaClientError {
  constructor(message: string, options: Omit<OllamaClientErrorOptions, 'code'> = {}) {
    super(message, { ...options, code: 'client_error', retryable: options.retryable ?? false });
  }
}

function isDomAbortError(error: unknown): error is DOMException {
  return (
    typeof DOMException !== 'undefined' &&
    error instanceof DOMException &&
    error.name === 'AbortError'
  );
}

/** Duck-types ollama-js's internal (unexported) `ResponseError` class. */
function isUpstreamResponseError(error: unknown): error is Error & { status_code: number } {
  return (
    error instanceof Error &&
    error.name === 'ResponseError' &&
    typeof (error as { status_code?: unknown }).status_code === 'number'
  );
}

function statusToError(
  status: number,
  message: string,
  options: Omit<OllamaClientErrorOptions, 'code' | 'status'>,
): OllamaClientError {
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

/**
 * Normalizes any error thrown by the transport layer, the upstream `ollama`
 * package, or user middleware into an {@link OllamaClientError} subclass.
 * Already-normalized errors are returned unchanged.
 */
export function mapError(
  error: unknown,
  context: { request?: OllamaErrorRequestContext; response?: OllamaErrorResponseContext } = {},
): OllamaClientError {
  if (error instanceof OllamaClientError) {
    return error;
  }

  if (isDomAbortError(error)) {
    return new OllamaAbortError(error.message || 'Request was aborted', {
      cause: error,
      request: context.request,
    });
  }

  if (isUpstreamResponseError(error)) {
    return statusToError(error.status_code, error.message, {
      cause: error,
      request: context.request,
      response: context.response ?? { status: error.status_code },
    });
  }

  if (error instanceof TypeError) {
    // The global `fetch` implementation throws a bare TypeError for DNS
    // failures, connection refused, TLS errors, etc.
    return new OllamaNetworkError(error.message || 'Network request failed', {
      cause: error,
      request: context.request,
    });
  }

  if (context.response?.status !== undefined) {
    const message = error instanceof Error ? error.message : String(error);
    return statusToError(context.response.status, message, {
      cause: error,
      request: context.request,
      response: context.response,
    });
  }

  const message = error instanceof Error ? error.message : String(error);
  return new OllamaGenericClientError(message, {
    cause: error,
    request: context.request,
    response: context.response,
  });
}
