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

export interface MiddlewareRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  /** Parsed request body, when JSON-serializable. `undefined` for raw/binary bodies. */
  body?: unknown;
}

export interface MiddlewareRequestContext {
  readonly request: MiddlewareRequest;
  readonly attempt: number;
  readonly requestId: string;
  /** Free-form bag middleware can use to pass data between hooks of the same request. */
  readonly meta: Record<string, unknown>;
}

export interface MiddlewareResponseContext extends MiddlewareRequestContext {
  readonly response: Response;
  readonly durationMs: number;
}

export interface MiddlewareErrorContext extends MiddlewareRequestContext {
  readonly error: unknown;
  readonly durationMs: number;
}

export interface RetryDecisionContext extends MiddlewareRequestContext {
  readonly error?: unknown;
  readonly response?: Response;
  /** The retry policy's own decision, before middleware has a chance to override it. */
  readonly defaultDecision: boolean;
}

export interface Middleware {
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

export class MiddlewarePipeline {
  constructor(private readonly middleware: readonly Middleware[] = []) {}

  get size(): number {
    return this.middleware.length;
  }

  async runRequest(ctx: MiddlewareRequestContext): Promise<void> {
    for (const middleware of this.middleware) {
      await middleware.onRequest?.(ctx);
    }
  }

  async runResponse(ctx: MiddlewareResponseContext): Promise<void> {
    for (const middleware of this.middleware) {
      await middleware.onResponse?.(ctx);
    }
  }

  async runError(ctx: MiddlewareErrorContext): Promise<void> {
    for (const middleware of this.middleware) {
      await middleware.onError?.(ctx);
    }
  }

  async decideRetry(ctx: RetryDecisionContext): Promise<boolean> {
    let decision = ctx.defaultDecision;
    for (const middleware of this.middleware) {
      const result = await middleware.shouldRetry?.(ctx);
      if (result !== undefined) {
        decision = result;
      }
    }
    return decision;
  }
}
