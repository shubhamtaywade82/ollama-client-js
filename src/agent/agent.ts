import type { Message } from 'ollama';
import type { ChatRequestInput, OllamaClient } from '../client.js';
import { OllamaAgentMaxIterationsError } from '../errors.js';
import type { AgentConfig, AgentHooks, AgentResult, AgentRunInput, AgentTurn } from './types.js';

const DEFAULT_MAX_ITERATIONS = 10;

type TurnRequest = Omit<ChatRequestInput, 'stream' | 'messages'> & { messages: Message[] };

/**
 * Opt-in, multi-turn tool-calling loop built on top of {@link OllamaClient}. `OllamaClient` itself
 * stays a thin, single-turn wrapper around `/api/chat`; `Agent` composes over it - it only ever
 * calls the client's already-public `chat`/`chatStream` methods - to repeatedly execute a model's
 * `tool_calls` against a `ToolRegistry` and feed the results back, until the model responds
 * without requesting a tool, or `maxIterations` is exhausted.
 */
export class Agent {
  private readonly maxIterations: number;
  private readonly hooks: AgentHooks;

  constructor(
    private readonly client: OllamaClient,
    private readonly config: AgentConfig,
  ) {
    this.maxIterations = config.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    this.hooks = config.hooks ?? {};
  }

  /** Runs the loop using non-streaming `chat` calls for every turn. */
  run(input: AgentRunInput): Promise<AgentResult> {
    return this.loop(input, async (_turn, request) => {
      const response = await this.client.chat({ ...request, stream: false });
      return response.message;
    });
  }

  /**
   * Runs the loop using `chatStream` for every turn, so `thinking`/`token` deltas flow through
   * `onThinking`/`onToken` in real time. Whether to continue the loop is decided from
   * `stream.finalResult`, which already aggregates a turn's `tool_calls` across chunks
   * (see `src/streaming/normalize.ts`), so this is otherwise equivalent to `run()`.
   */
  runStream(input: AgentRunInput): Promise<AgentResult> {
    return this.loop(input, async (turn, request) => {
      const stream = await this.client.chat({ ...request, stream: true });
      stream.on('thinking', (event) => {
        void this.hooks.onThinking?.({ turn, delta: event.data.delta });
      });
      stream.on('token', (event) => {
        void this.hooks.onToken?.({ turn, delta: event.data.delta });
      });
      const final = await stream.finalResult;
      const message: Message = {
        role: final.message.role || 'assistant',
        content: final.message.content,
      };
      if (final.message.thinking !== undefined) message.thinking = final.message.thinking;
      if (final.message.tool_calls !== undefined) message.tool_calls = final.message.tool_calls;
      return message;
    });
  }

  private baseRequest(input: AgentRunInput, messages: Message[]): TurnRequest {
    return {
      model: input.model,
      messages,
      tools: this.config.tools.toOllamaTools(),
      think: input.think,
      options: input.options,
      signal: input.signal,
    };
  }

  private async loop(
    input: AgentRunInput,
    getAssistantMessage: (turn: number, request: TurnRequest) => Promise<Message>,
  ): Promise<AgentResult> {
    const messages: Message[] = [...input.messages];
    const turns: AgentTurn[] = [];

    for (let turn = 1; turn <= this.maxIterations; turn += 1) {
      await this.hooks.onTurnStart?.({ turn, messages });

      const assistantMessage = await getAssistantMessage(turn, this.baseRequest(input, messages));
      messages.push(assistantMessage);
      await this.hooks.onAssistantMessage?.({ turn, message: assistantMessage });

      const toolCalls = assistantMessage.tool_calls ?? [];
      if (toolCalls.length === 0) {
        await this.hooks.onTurnEnd?.({ turn, messages });
        return { messages, finalMessage: assistantMessage, turns, iterations: turn };
      }

      for (const toolCall of toolCalls) {
        await this.hooks.onToolCall?.({ turn, toolCall });
      }
      const toolResults = await this.config.tools.executeToolCalls(toolCalls, {
        signal: input.signal,
      });
      for (const result of toolResults) {
        await this.hooks.onToolResult?.({ turn, result });
        messages.push(result.message);
      }

      turns.push({ turn, assistantMessage, toolResults });
      await this.hooks.onTurnEnd?.({ turn, messages });
    }

    throw new OllamaAgentMaxIterationsError(
      `Agent did not converge to a tool-call-free message within ${this.maxIterations} turn(s).`,
      { maxIterations: this.maxIterations },
    );
  }
}
