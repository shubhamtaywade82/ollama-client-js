import type { ChatResponse, GenerateResponse, ProgressResponse, ToolCall } from 'ollama';
import type { OllamaClientError } from '../errors.js';
import type { OllamaUsage } from '../usage.js';

/** The normalized event vocabulary emitted by every stream in this library, regardless of the underlying endpoint. */
export type OllamaStreamEventType =
  'token' | 'message' | 'tool_call' | 'thinking' | 'done' | 'error';

export interface TokenEventData {
  readonly delta: string;
  readonly role: string;
}

export interface ThinkingEventData {
  readonly delta: string;
}

export interface ToolCallEventData {
  readonly toolCall: ToolCall;
}

export interface MessageEventData<TChunk> {
  readonly chunk: TChunk;
}

export interface DoneEventData<TFinal> {
  readonly result: TFinal;
}

export interface ErrorEventData {
  readonly error: OllamaClientError;
}

export type OllamaStreamEvent<TChunk, TFinal> =
  | { readonly type: 'token'; readonly data: TokenEventData }
  | { readonly type: 'thinking'; readonly data: ThinkingEventData }
  | { readonly type: 'tool_call'; readonly data: ToolCallEventData }
  | { readonly type: 'message'; readonly data: MessageEventData<TChunk> }
  | { readonly type: 'done'; readonly data: DoneEventData<TFinal> }
  | { readonly type: 'error'; readonly data: ErrorEventData };

/** Aggregated result of a fully-consumed chat stream. */
export interface ChatStreamResult {
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
export interface GenerateStreamResult {
  readonly response: string;
  readonly model: string;
  readonly done: boolean;
  readonly totalDurationMs?: number;
  /** Token/duration accounting, populated once the stream reports `done`. */
  readonly usage?: OllamaUsage;
  readonly raw?: GenerateResponse;
}

/** Aggregated result of a fully-consumed progress stream (pull/push/create). */
export interface ProgressStreamResult {
  readonly status: string;
  readonly completed?: number;
  readonly total?: number;
  readonly done: boolean;
  readonly raw?: ProgressResponse;
}

/** Minimal shape required of a stream source: async-iterable, optionally abortable. */
export interface AbortableSource<TChunk> extends AsyncIterable<TChunk> {
  abort?(): void;
}
