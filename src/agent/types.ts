import type { Message, Options, ToolCall } from 'ollama';
import type { ToolExecutionResult } from '../tools/types.js';
import type { ToolRegistry } from '../tools/registry.js';

/**
 * Observability hooks for {@link Agent}, fired in this order per turn: `onTurnStart` ->
 * `onAssistantMessage` -> (`onToolCall` then `onToolResult`, once per tool call, in call order) ->
 * `onTurnEnd`. `onThinking`/`onToken` only fire from `runStream()`, interleaved with the model's
 * response as it streams, before that turn's `onAssistantMessage`.
 */
export interface AgentHooks {
  onTurnStart?(ctx: { turn: number; messages: readonly Message[] }): void | Promise<void>;
  onThinking?(ctx: { turn: number; delta: string }): void | Promise<void>;
  onToken?(ctx: { turn: number; delta: string }): void | Promise<void>;
  onAssistantMessage?(ctx: { turn: number; message: Message }): void | Promise<void>;
  onToolCall?(ctx: { turn: number; toolCall: ToolCall }): void | Promise<void>;
  onToolResult?(ctx: { turn: number; result: ToolExecutionResult }): void | Promise<void>;
  onTurnEnd?(ctx: { turn: number; messages: readonly Message[] }): void | Promise<void>;
}

export interface AgentConfig {
  readonly tools: ToolRegistry;
  /** Maximum number of model turns before giving up with {@link OllamaAgentMaxIterationsError}. Default 10. */
  readonly maxIterations?: number;
  readonly hooks?: AgentHooks;
}

export interface AgentRunInput {
  readonly model: string;
  readonly messages: Message[];
  readonly think?: boolean | 'high' | 'medium' | 'low';
  readonly options?: Partial<Options>;
  readonly signal?: AbortSignal;
}

export interface AgentTurn {
  readonly turn: number;
  readonly assistantMessage: Message;
  /** Empty when this turn's assistant message had no `tool_calls` (i.e. it was the final turn). */
  readonly toolResults: readonly ToolExecutionResult[];
}

export interface AgentResult {
  /** Full transcript, including tool-result messages - ready to continue the conversation from. */
  readonly messages: Message[];
  readonly finalMessage: Message;
  readonly turns: readonly AgentTurn[];
  readonly iterations: number;
}
