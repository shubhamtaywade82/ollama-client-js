import type { ChatResponse, GenerateResponse, ProgressResponse } from 'ollama';
import { OllamaStream } from './stream.js';
import type {
  AbortableSource,
  ChatStreamResult,
  GenerateStreamResult,
  OllamaStreamEvent,
  ProgressStreamResult,
} from './types.js';

const NANOS_PER_MS = 1_000_000;

function aggregateChat(accumulated: ChatStreamResult, chunk: ChatResponse): ChatStreamResult {
  const message = chunk.message ?? { role: 'assistant', content: '' };
  return {
    message: {
      role: message.role || accumulated.message.role,
      content: accumulated.message.content + (message.content ?? ''),
      thinking:
        message.thinking !== undefined
          ? (accumulated.message.thinking ?? '') + message.thinking
          : accumulated.message.thinking,
      tool_calls: message.tool_calls?.length
        ? [...(accumulated.message.tool_calls ?? []), ...message.tool_calls]
        : accumulated.message.tool_calls,
    },
    model: chunk.model,
    done: chunk.done,
    totalDurationMs: chunk.done ? chunk.total_duration / NANOS_PER_MS : accumulated.totalDurationMs,
    raw: chunk,
  };
}

function mapChatChunk(
  chunk: ChatResponse,
  aggregated: ChatStreamResult,
): Array<OllamaStreamEvent<ChatResponse, ChatStreamResult>> {
  const events: Array<OllamaStreamEvent<ChatResponse, ChatStreamResult>> = [];
  const message = chunk.message;

  if (message?.thinking) {
    events.push({ type: 'thinking', data: { delta: message.thinking } });
  }
  for (const toolCall of message?.tool_calls ?? []) {
    events.push({ type: 'tool_call', data: { toolCall } });
  }
  if (message?.content) {
    events.push({ type: 'token', data: { delta: message.content, role: message.role } });
  }
  events.push({ type: 'message', data: { chunk } });
  if (chunk.done) {
    events.push({ type: 'done', data: { result: aggregated } });
  }
  return events;
}

/** Wraps a raw upstream chat stream (from `ollama-js`) into a normalized {@link OllamaStream}. */
export function normalizeChatStream(
  source: AbortableSource<ChatResponse>,
): OllamaStream<ChatResponse, ChatStreamResult> {
  const initial: ChatStreamResult = {
    message: { role: 'assistant', content: '' },
    model: '',
    done: false,
  };
  return new OllamaStream(source, mapChatChunk, aggregateChat, initial);
}

function aggregateGenerate(
  accumulated: GenerateStreamResult,
  chunk: GenerateResponse,
): GenerateStreamResult {
  return {
    response: accumulated.response + (chunk.response ?? ''),
    model: chunk.model,
    done: chunk.done,
    totalDurationMs: chunk.done ? chunk.total_duration / NANOS_PER_MS : accumulated.totalDurationMs,
    raw: chunk,
  };
}

function mapGenerateChunk(
  chunk: GenerateResponse,
  aggregated: GenerateStreamResult,
): Array<OllamaStreamEvent<GenerateResponse, GenerateStreamResult>> {
  const events: Array<OllamaStreamEvent<GenerateResponse, GenerateStreamResult>> = [];

  if (chunk.thinking) {
    events.push({ type: 'thinking', data: { delta: chunk.thinking } });
  }
  if (chunk.response) {
    events.push({ type: 'token', data: { delta: chunk.response, role: 'assistant' } });
  }
  events.push({ type: 'message', data: { chunk } });
  if (chunk.done) {
    events.push({ type: 'done', data: { result: aggregated } });
  }
  return events;
}

/** Wraps a raw upstream generate stream (from `ollama-js`) into a normalized {@link OllamaStream}. */
export function normalizeGenerateStream(
  source: AbortableSource<GenerateResponse>,
): OllamaStream<GenerateResponse, GenerateStreamResult> {
  const initial: GenerateStreamResult = { response: '', model: '', done: false };
  return new OllamaStream(source, mapGenerateChunk, aggregateGenerate, initial);
}

function isProgressDone(chunk: ProgressResponse): boolean {
  return chunk.status === 'success';
}

function aggregateProgress(
  _accumulated: ProgressStreamResult,
  chunk: ProgressResponse,
): ProgressStreamResult {
  return {
    status: chunk.status,
    completed: chunk.completed,
    total: chunk.total,
    done: isProgressDone(chunk),
    raw: chunk,
  };
}

function mapProgressChunk(
  chunk: ProgressResponse,
  aggregated: ProgressStreamResult,
): Array<OllamaStreamEvent<ProgressResponse, ProgressStreamResult>> {
  const events: Array<OllamaStreamEvent<ProgressResponse, ProgressStreamResult>> = [
    { type: 'message', data: { chunk } },
  ];
  if (isProgressDone(chunk)) {
    events.push({ type: 'done', data: { result: aggregated } });
  }
  return events;
}

/** Wraps a raw upstream progress stream (pull/push/create) into a normalized {@link OllamaStream}. */
export function normalizeProgressStream(
  source: AbortableSource<ProgressResponse>,
): OllamaStream<ProgressResponse, ProgressStreamResult> {
  const initial: ProgressStreamResult = { status: '', done: false };
  return new OllamaStream(source, mapProgressChunk, aggregateProgress, initial);
}
