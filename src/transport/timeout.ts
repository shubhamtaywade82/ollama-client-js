/**
 * Timeout and cancellation helpers.
 *
 * `AbortController.abort(reason)` is used both for user-initiated
 * cancellation (the caller's own `AbortSignal`) and for our own timeout
 * enforcement. `TimeoutReason` lets the transport layer tell the two apart
 * after the fact, since the `DOMException` thrown by `fetch` is always named
 * `AbortError` regardless of why the controller was aborted.
 */

import { OllamaAbortError, OllamaTimeoutError } from '../errors.js';

/** Marker stored as `signal.reason` when an abort was triggered by our own timeout. */
export class TimeoutReason {
  constructor(readonly timeoutMs: number) {}
}

export interface TimeoutSignal {
  readonly signal: AbortSignal;
  /** Clears the internal timer. Must be called once the request settles. */
  readonly cancel: () => void;
}

/**
 * Combines an optional per-request timeout with an optional caller-provided
 * `AbortSignal` into a single signal, without leaking timers.
 */
export function createTimeoutSignal(
  timeoutMs: number | undefined,
  userSignal: AbortSignal | undefined,
): TimeoutSignal {
  if (!timeoutMs && !userSignal) {
    return { signal: new AbortController().signal, cancel: () => undefined };
  }

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  if (userSignal) {
    if (userSignal.aborted) {
      controller.abort(userSignal.reason);
    } else {
      userSignal.addEventListener('abort', () => controller.abort(userSignal.reason), {
        once: true,
      });
    }
  }

  if (timeoutMs && timeoutMs > 0 && !controller.signal.aborted) {
    timer = setTimeout(() => {
      controller.abort(new TimeoutReason(timeoutMs));
    }, timeoutMs);
    // Do not keep the Node.js event loop alive solely for a timeout guard.
    (timer as unknown as { unref?: () => void }).unref?.();
  }

  return {
    signal: controller.signal,
    cancel: () => {
      if (timer) clearTimeout(timer);
    },
  };
}

export function isAbortError(error: unknown): boolean {
  return (
    (typeof DOMException !== 'undefined' &&
      error instanceof DOMException &&
      error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

/** Converts an aborted signal into the appropriate structured error, distinguishing timeout from user cancellation. */
export function errorFromAbortSignal(signal: AbortSignal): OllamaTimeoutError | OllamaAbortError {
  if (signal.reason instanceof TimeoutReason) {
    return new OllamaTimeoutError(`Request timed out after ${signal.reason.timeoutMs}ms`, {
      timeoutMs: signal.reason.timeoutMs,
    });
  }
  return new OllamaAbortError('Request was aborted');
}

/**
 * Races a promise against an `AbortSignal`, rejecting with a structured
 * {@link OllamaTimeoutError} or {@link OllamaAbortError} the moment the
 * signal fires. Used for client-side cancellation of calls whose underlying
 * transport doesn't accept a per-call signal.
 */
export function raceWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(errorFromAbortSignal(signal));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(errorFromAbortSignal(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- forwarding an arbitrary upstream rejection reason unchanged
        reject(error);
      },
    );
  });
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    (timer as unknown as { unref?: () => void }).unref?.();
    const onAbort = (): void => {
      clearTimeout(timer);
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- forwarding an arbitrary AbortSignal reason unchanged
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
