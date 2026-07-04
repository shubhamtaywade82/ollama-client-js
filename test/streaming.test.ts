import { describe, expect, it } from 'vitest';
import type { ChatResponse, ProgressResponse } from 'ollama';
import { normalizeChatStream, normalizeProgressStream } from '../src/streaming/normalize.js';
import { OllamaStream } from '../src/streaming/stream.js';
import type { ChatStreamResult, OllamaStreamEvent } from '../src/streaming/types.js';

function isType<TChunk, TFinal, TType extends OllamaStreamEvent<TChunk, TFinal>['type']>(
  type: TType,
) {
  return (
    event: OllamaStreamEvent<TChunk, TFinal>,
  ): event is Extract<OllamaStreamEvent<TChunk, TFinal>, { type: TType }> => event.type === type;
}

function makeAbortableSource<T>(
  items: T[],
  onAbort?: () => void,
): AsyncIterable<T> & { abort: () => void; aborted: boolean } {
  const source = {
    aborted: false,
    abort() {
      this.aborted = true;
      onAbort?.();
    },
    async *[Symbol.asyncIterator]() {
      for (const item of items) {
        await Promise.resolve();
        yield item;
      }
    },
  };
  return source;
}

function chatChunk(overrides: Partial<ChatResponse> = {}): ChatResponse {
  return {
    model: 'llama3.2',
    created_at: new Date(),
    message: { role: 'assistant', content: '' },
    done: false,
    done_reason: '',
    total_duration: 0,
    load_duration: 0,
    prompt_eval_count: 0,
    prompt_eval_duration: 0,
    eval_count: 0,
    eval_duration: 0,
    ...overrides,
  };
}

describe('normalizeChatStream', () => {
  it('emits token events for content deltas and aggregates the final message', async () => {
    const chunks: ChatResponse[] = [
      chatChunk({ message: { role: 'assistant', content: 'Hel' } }),
      chatChunk({ message: { role: 'assistant', content: 'lo' } }),
      chatChunk({
        message: { role: 'assistant', content: '' },
        done: true,
        total_duration: 2_000_000,
      }),
    ];
    const stream = normalizeChatStream(makeAbortableSource(chunks));

    const events = [];
    for await (const event of stream) {
      events.push(event);
    }

    const tokenEvents = events.filter(isType<ChatResponse, ChatStreamResult, 'token'>('token'));
    expect(tokenEvents.map((e) => e.data.delta)).toEqual(['Hel', 'lo']);

    const doneEvent = events.find(isType<ChatResponse, ChatStreamResult, 'done'>('done'));
    expect(doneEvent?.data.result.message.content).toBe('Hello');
    expect(doneEvent?.data.result.totalDurationMs).toBe(2);

    await expect(stream.finalResult).resolves.toMatchObject({ message: { content: 'Hello' } });
  });

  it('emits thinking and tool_call events distinctly from token events', async () => {
    const chunks: ChatResponse[] = [
      chatChunk({ message: { role: 'assistant', content: '', thinking: 'pondering' } }),
      chatChunk({
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [{ function: { name: 'lookup', arguments: { q: 'weather' } } }],
        },
      }),
      chatChunk({ message: { role: 'assistant', content: '' }, done: true }),
    ];
    const stream = normalizeChatStream(makeAbortableSource(chunks));

    const types: string[] = [];
    for await (const event of stream) {
      types.push(event.type);
    }

    expect(types).toContain('thinking');
    expect(types).toContain('tool_call');
    expect(types).toContain('done');
  });

  it('supports event-based consumption via .on()', async () => {
    const chunks: ChatResponse[] = [
      chatChunk({ message: { role: 'assistant', content: 'hi' } }),
      chatChunk({ message: { role: 'assistant', content: '' }, done: true }),
    ];
    const stream = normalizeChatStream(makeAbortableSource(chunks));

    const tokens: string[] = [];
    let doneCalled = false;
    await new Promise<void>((resolve, reject) => {
      stream.on('token', (event) => tokens.push(event.data.delta));
      stream.on('done', () => {
        doneCalled = true;
      });
      stream.on('error', (event) => reject(event.data.error));
      // finalResult resolves once the 'done' event fires.
      stream.finalResult.then(() => resolve()).catch(reject);
    });

    expect(tokens).toEqual(['hi']);
    expect(doneCalled).toBe(true);
  });

  it('throws if async iteration is attempted after .on() has been used', async () => {
    const stream = normalizeChatStream(makeAbortableSource([chatChunk({ done: true })]));
    stream.on('done', () => undefined);
    await stream.finalResult;

    await expect(async () => {
      for await (const _event of stream) {
        // no-op
      }
    }).rejects.toThrow(/already has event listeners/);
  });

  it('throws if .on() is used after async iteration has started', async () => {
    const stream = normalizeChatStream(makeAbortableSource([chatChunk({ done: true })]));
    const iterator = stream[Symbol.asyncIterator]();
    await iterator.next();

    expect(() => stream.on('done', () => undefined)).toThrow(
      /already being consumed via async iteration/,
    );
  });

  it('propagates abort() to the underlying source', () => {
    let aborted = false;
    const source = makeAbortableSource<ChatResponse>([], () => {
      aborted = true;
    });
    const stream = normalizeChatStream(source);
    stream.abort();
    expect(aborted).toBe(true);
  });

  it('rejects finalResult and emits an error event when the source throws', async () => {
    const source: AsyncIterable<ChatResponse> = {
      async *[Symbol.asyncIterator]() {
        await Promise.resolve();
        yield chatChunk({ message: { role: 'assistant', content: 'partial' } });
        throw new Error('stream broke');
      },
    };
    const stream = normalizeChatStream(source);

    const events = [];
    for await (const event of stream) {
      events.push(event);
    }

    expect(events.at(-1)?.type).toBe('error');
    await expect(stream.finalResult).rejects.toThrow('stream broke');
  });
});

describe('normalizeProgressStream', () => {
  it('emits a done event when status is "success"', async () => {
    const chunks: ProgressResponse[] = [
      { status: 'pulling manifest', digest: '', total: 100, completed: 10 },
      { status: 'success', digest: '', total: 100, completed: 100 },
    ];
    const stream = normalizeProgressStream(makeAbortableSource(chunks));

    const types: string[] = [];
    for await (const event of stream) {
      types.push(event.type);
    }
    expect(types).toEqual(['message', 'message', 'done']);
    await expect(stream.finalResult).resolves.toMatchObject({ status: 'success', done: true });
  });
});

describe('OllamaStream generic behavior', () => {
  it('is constructible directly with custom map/aggregate functions', async () => {
    const stream = new OllamaStream<number, number>(
      makeAbortableSource([1, 2, 3]),
      (chunk, aggregated) =>
        chunk === 3
          ? [{ type: 'done', data: { result: aggregated } }]
          : [{ type: 'message', data: { chunk } }],
      (acc, chunk) => acc + chunk,
      0,
    );
    const events = [];
    for await (const event of stream) events.push(event.type);
    expect(events).toEqual(['message', 'message', 'done']);
    await expect(stream.finalResult).resolves.toBe(6);
  });
});
