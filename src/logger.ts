/**
 * Logging and observability hooks.
 *
 * The client never assumes a particular logging framework. Instead it calls
 * a small {@link Logger} interface and, separately, emits structured
 * lifecycle events through {@link RequestLifecycleHooks} that can be wired
 * into metrics or tracing systems (OpenTelemetry, StatsD, etc.) without
 * pulling those dependencies into the core package.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/** A logger that discards everything. Used when logging is disabled. */
export const noopLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/** A simple `console`-backed logger, useful for local development and debugging. */
export class ConsoleLogger implements Logger {
  constructor(
    private readonly minLevel: LogLevel = 'debug',
    private readonly prefix = '[ollama-client-js]',
  ) {}

  private shouldLog(level: LogLevel): boolean {
    const order: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    return order.indexOf(level) >= order.indexOf(this.minLevel);
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog('debug')) console.debug(this.prefix, message, meta ?? '');
  }

  info(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog('info')) console.info(this.prefix, message, meta ?? '');
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog('warn')) console.warn(this.prefix, message, meta ?? '');
  }

  error(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog('error')) console.error(this.prefix, message, meta ?? '');
  }
}

/** Structured events emitted at key points of a request's lifecycle. */
export type RequestLifecycleEvent =
  | { type: 'request:start'; requestId: string; method: string; url: string; attempt: number }
  | {
      type: 'request:success';
      requestId: string;
      method: string;
      url: string;
      attempt: number;
      status: number;
      durationMs: number;
    }
  | {
      type: 'request:retry';
      requestId: string;
      method: string;
      url: string;
      attempt: number;
      delayMs: number;
      reason: string;
    }
  | {
      type: 'request:error';
      requestId: string;
      method: string;
      url: string;
      attempt: number;
      durationMs: number;
      error: unknown;
    };

/** Callback invoked for every {@link RequestLifecycleEvent}. Intended for metrics/tracing hooks. */
export type RequestLifecycleHook = (event: RequestLifecycleEvent) => void;

export function createLifecycleDispatcher(
  hooks: readonly RequestLifecycleHook[],
  logger: Logger,
): RequestLifecycleHook {
  return (event) => {
    for (const hook of hooks) {
      try {
        hook(event);
      } catch (hookError) {
        logger.warn('Lifecycle hook threw an error', { hookError });
      }
    }
    switch (event.type) {
      case 'request:start':
        logger.debug('Request started', event);
        break;
      case 'request:success':
        logger.debug('Request succeeded', event);
        break;
      case 'request:retry':
        logger.warn('Retrying request', event);
        break;
      case 'request:error':
        logger.error('Request failed', event);
        break;
    }
  };
}
