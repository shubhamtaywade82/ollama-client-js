import { describe, expect, it } from 'vitest';
import { MiddlewarePipeline } from '../src/middleware.js';
import type {
  Middleware,
  MiddlewareErrorContext,
  MiddlewareRequestContext,
  MiddlewareResponseContext,
  RetryDecisionContext,
} from '../src/middleware.js';

function baseRequestContext(): MiddlewareRequestContext {
  return {
    request: { url: 'http://localhost:11434/api/chat', method: 'POST', headers: {} },
    attempt: 1,
    requestId: 'req_1',
    meta: {},
  };
}

describe('MiddlewarePipeline', () => {
  it('runs onRequest hooks in registration order and allows header mutation', async () => {
    const order: string[] = [];
    const first: Middleware = {
      name: 'first',
      onRequest: (ctx) => {
        order.push('first');
        ctx.request.headers['x-first'] = '1';
      },
    };
    const second: Middleware = {
      name: 'second',
      onRequest: (ctx) => {
        order.push('second');
        ctx.request.headers['x-second'] = ctx.request.headers['x-first'] ? 'saw-first' : 'missing';
      },
    };
    const pipeline = new MiddlewarePipeline([first, second]);
    const ctx = baseRequestContext();
    await pipeline.runRequest(ctx);

    expect(order).toEqual(['first', 'second']);
    expect(ctx.request.headers['x-second']).toBe('saw-first');
  });

  it('runs onResponse hooks for every middleware', async () => {
    const seen: string[] = [];
    const pipeline = new MiddlewarePipeline([
      { onResponse: () => void seen.push('a') },
      { onResponse: () => void seen.push('b') },
    ]);
    const ctx: MiddlewareResponseContext = {
      ...baseRequestContext(),
      response: new Response('{}', { status: 200 }),
      durationMs: 5,
    };
    await pipeline.runResponse(ctx);
    expect(seen).toEqual(['a', 'b']);
  });

  it('runs onError hooks for every middleware', async () => {
    const seen: string[] = [];
    const pipeline = new MiddlewarePipeline([
      { onError: () => void seen.push('a') },
      { onError: () => void seen.push('b') },
    ]);
    const ctx: MiddlewareErrorContext = {
      ...baseRequestContext(),
      error: new Error('boom'),
      durationMs: 5,
    };
    await pipeline.runError(ctx);
    expect(seen).toEqual(['a', 'b']);
  });

  it('lets the last middleware with a defined shouldRetry decision win', async () => {
    const pipeline = new MiddlewarePipeline([
      { shouldRetry: () => true },
      { shouldRetry: () => undefined },
      { shouldRetry: () => false },
    ]);
    const ctx: RetryDecisionContext = { ...baseRequestContext(), defaultDecision: true };
    expect(await pipeline.decideRetry(ctx)).toBe(false);
  });

  it('falls back to the default decision when no middleware overrides it', async () => {
    const pipeline = new MiddlewarePipeline([{ shouldRetry: () => undefined }]);
    const ctx: RetryDecisionContext = { ...baseRequestContext(), defaultDecision: true };
    expect(await pipeline.decideRetry(ctx)).toBe(true);
  });

  it('works with an empty middleware list', async () => {
    const pipeline = new MiddlewarePipeline();
    expect(pipeline.size).toBe(0);
    await pipeline.runRequest(baseRequestContext());
    const ctx: RetryDecisionContext = { ...baseRequestContext(), defaultDecision: false };
    expect(await pipeline.decideRetry(ctx)).toBe(false);
  });
});
