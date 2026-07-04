import { mapError } from '../errors.js';
import type { AbortableSource, OllamaStreamEvent, OllamaStreamEventType } from './types.js';

type Listener<TChunk, TFinal> = (event: OllamaStreamEvent<TChunk, TFinal>) => void;

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
export class OllamaStream<TChunk, TFinal> implements AsyncIterable<
  OllamaStreamEvent<TChunk, TFinal>
> {
  private readonly listeners = new Map<OllamaStreamEventType, Set<Listener<TChunk, TFinal>>>();
  private mode: 'iterator' | 'events' | undefined;
  private readonly finalResultPromise: Promise<TFinal>;
  private resolveFinal!: (value: TFinal) => void;
  private rejectFinal!: (error: unknown) => void;

  constructor(
    private readonly source: AbortableSource<TChunk>,
    private readonly mapChunk: (
      chunk: TChunk,
      aggregated: TFinal,
    ) => Array<OllamaStreamEvent<TChunk, TFinal>>,
    private readonly aggregate: (accumulated: TFinal, chunk: TChunk) => TFinal,
    private readonly initial: TFinal,
  ) {
    this.finalResultPromise = new Promise<TFinal>((resolve, reject) => {
      this.resolveFinal = resolve;
      this.rejectFinal = reject;
    });
    // Prevent "unhandled rejection" warnings for callers who never read `.finalResult`.
    this.finalResultPromise.catch(() => undefined);
  }

  /** Resolves with the fully aggregated result once the stream completes, or rejects on stream error. */
  get finalResult(): Promise<TFinal> {
    return this.finalResultPromise;
  }

  /** Cancels the underlying request, if the source supports it. */
  abort(): void {
    this.source.abort?.();
  }

  /** Subscribes to a single normalized event type. Returns an unsubscribe function. */
  on<TType extends OllamaStreamEventType>(
    type: TType,
    listener: (event: Extract<OllamaStreamEvent<TChunk, TFinal>, { type: TType }>) => void,
  ): () => void {
    if (this.mode === 'iterator') {
      throw new Error(
        'Cannot register event listeners: this stream is already being consumed via async iteration.',
      );
    }
    // Safe by construction: `emit` only ever invokes listeners registered
    // under a key matching the event's own `type`.
    const genericListener = listener as Listener<TChunk, TFinal>;
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(genericListener);

    if (this.mode !== 'events') {
      this.mode = 'events';
      void this.pump();
    }

    return () => {
      set?.delete(genericListener);
    };
  }

  private emit(event: OllamaStreamEvent<TChunk, TFinal>): void {
    for (const listener of this.listeners.get(event.type) ?? []) {
      listener(event);
    }
  }

  private async pump(): Promise<void> {
    let accumulated = this.initial;
    try {
      for await (const chunk of this.source) {
        accumulated = this.aggregate(accumulated, chunk);
        for (const event of this.mapChunk(chunk, accumulated)) {
          this.emit(event);
          if (event.type === 'done') {
            this.resolveFinal(event.data.result);
          }
        }
      }
    } catch (error) {
      const mapped = mapError(error);
      this.emit({ type: 'error', data: { error: mapped } });
      this.rejectFinal(mapped);
    }
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<
    OllamaStreamEvent<TChunk, TFinal>,
    void,
    undefined
  > {
    if (this.mode === 'events') {
      throw new Error(
        'Cannot use async iteration: this stream already has event listeners registered via .on().',
      );
    }
    this.mode = 'iterator';
    let accumulated = this.initial;
    try {
      for await (const chunk of this.source) {
        accumulated = this.aggregate(accumulated, chunk);
        const events = this.mapChunk(chunk, accumulated);
        for (const event of events) {
          if (event.type === 'done') {
            this.resolveFinal(event.data.result);
          }
          yield event;
        }
      }
    } catch (error) {
      const mapped = mapError(error);
      this.rejectFinal(mapped);
      yield { type: 'error', data: { error: mapped } };
    }
  }
}
