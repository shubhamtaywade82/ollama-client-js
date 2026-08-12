import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { OllamaClient } from '../src/client.js';
import { Agent } from '../src/agent/agent.js';
import { defineTool } from '../src/tools/define-tool.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { OllamaAgentMaxIterationsError, OllamaToolExecutionError } from '../src/errors.js';
import { createScriptedFetch, jsonResponse, ndjsonResponse } from './test-utils/mock-fetch.js';

function chatResponseBody(message: Record<string, unknown>) {
  return {
    model: 'llama3.2',
    created_at: new Date().toISOString(),
    message: { role: 'assistant', content: '', ...message },
    done: true,
    done_reason: 'stop',
    total_duration: 1,
    load_duration: 1,
    prompt_eval_count: 1,
    prompt_eval_duration: 1,
    eval_count: 1,
    eval_duration: 1,
  };
}

const weatherTool = defineTool({
  name: 'get_weather',
  description: 'Gets the weather for a city.',
  parameters: z.object({ city: z.string() }),
  handler: (args) => `${args.city}: sunny, 21C`,
});

describe('Agent.run', () => {
  it('executes a tool call then returns the following tool-call-free message as the final result', async () => {
    const { fetch } = createScriptedFetch([
      () =>
        jsonResponse(
          chatResponseBody({
            tool_calls: [{ function: { name: 'get_weather', arguments: { city: 'Paris' } } }],
          }),
        ),
      () => jsonResponse(chatResponseBody({ content: 'It is sunny in Paris.' })),
    ]);
    const client = new OllamaClient({ fetch, retries: 0 });
    const agent = new Agent(client, { tools: new ToolRegistry([weatherTool]) });

    const result = await agent.run({
      model: 'llama3.2',
      messages: [{ role: 'user', content: 'What is the weather in Paris?' }],
    });

    expect(result.finalMessage.content).toBe('It is sunny in Paris.');
    expect(result.turns).toHaveLength(1);
    expect(result.turns[0]?.toolResults[0]?.result).toBe('Paris: sunny, 21C');
    expect(result.iterations).toBe(2);
    const toolMessage = result.messages.find((m) => m.role === 'tool');
    expect(toolMessage?.tool_name).toBe('get_weather');
  });

  it('rejects with OllamaAgentMaxIterationsError when every turn keeps requesting tool calls', async () => {
    const alwaysToolCall = () =>
      jsonResponse(
        chatResponseBody({
          tool_calls: [{ function: { name: 'get_weather', arguments: { city: 'Paris' } } }],
        }),
      );
    const { fetch } = createScriptedFetch([alwaysToolCall]);
    const client = new OllamaClient({ fetch, retries: 0 });
    const agent = new Agent(client, { tools: new ToolRegistry([weatherTool]), maxIterations: 2 });

    await expect(
      agent.run({ model: 'llama3.2', messages: [{ role: 'user', content: 'weather?' }] }),
    ).rejects.toBeInstanceOf(OllamaAgentMaxIterationsError);
  });

  it('fires hooks in order: onTurnStart, onAssistantMessage, onToolCall/onToolResult per call, onTurnEnd', async () => {
    const { fetch } = createScriptedFetch([
      () =>
        jsonResponse(
          chatResponseBody({
            tool_calls: [{ function: { name: 'get_weather', arguments: { city: 'Paris' } } }],
          }),
        ),
      () => jsonResponse(chatResponseBody({ content: 'Done.' })),
    ]);
    const client = new OllamaClient({ fetch, retries: 0 });
    const order: string[] = [];
    const agent = new Agent(client, {
      tools: new ToolRegistry([weatherTool]),
      hooks: {
        onTurnStart: () => void order.push('onTurnStart'),
        onAssistantMessage: () => void order.push('onAssistantMessage'),
        onToolCall: () => void order.push('onToolCall'),
        onToolResult: () => void order.push('onToolResult'),
        onTurnEnd: () => void order.push('onTurnEnd'),
      },
    });

    await agent.run({ model: 'llama3.2', messages: [{ role: 'user', content: 'weather?' }] });

    expect(order).toEqual([
      'onTurnStart',
      'onAssistantMessage',
      'onToolCall',
      'onToolResult',
      'onTurnEnd',
      'onTurnStart',
      'onAssistantMessage',
      'onTurnEnd',
    ]);
  });

  it('feeds a tool handler failure back to the model by default instead of crashing the loop', async () => {
    const throwingTool = defineTool({
      name: 'boom',
      description: 'Always throws.',
      parameters: z.object({}),
      handler: () => {
        throw new Error('kaboom');
      },
    });
    const { fetch } = createScriptedFetch([
      () =>
        jsonResponse(
          chatResponseBody({ tool_calls: [{ function: { name: 'boom', arguments: {} } }] }),
        ),
      () => jsonResponse(chatResponseBody({ content: 'Recovered.' })),
    ]);
    const client = new OllamaClient({ fetch, retries: 0 });
    const agent = new Agent(client, { tools: new ToolRegistry([throwingTool]) });

    const result = await agent.run({
      model: 'llama3.2',
      messages: [{ role: 'user', content: 'go' }],
    });
    expect(result.finalMessage.content).toBe('Recovered.');

    const { fetch: throwFetch } = createScriptedFetch([
      () =>
        jsonResponse(
          chatResponseBody({ tool_calls: [{ function: { name: 'boom', arguments: {} } }] }),
        ),
    ]);
    const throwClient = new OllamaClient({ fetch: throwFetch, retries: 0 });
    const throwAgent = new Agent(throwClient, {
      tools: new ToolRegistry([throwingTool], { onError: 'throw' }),
    });
    await expect(
      throwAgent.run({ model: 'llama3.2', messages: [{ role: 'user', content: 'go' }] }),
    ).rejects.toBeInstanceOf(OllamaToolExecutionError);
  });
});

describe('Agent.runStream', () => {
  it('surfaces thinking/token deltas via hooks and still resolves tool_calls from the aggregated stream result', async () => {
    const { fetch } = createScriptedFetch([
      () =>
        ndjsonResponse([
          {
            model: 'llama3.2',
            created_at: new Date().toISOString(),
            message: { role: 'assistant', content: '', thinking: 'Let me check the weather.' },
            done: false,
          },
          {
            model: 'llama3.2',
            created_at: new Date().toISOString(),
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [{ function: { name: 'get_weather', arguments: { city: 'Paris' } } }],
            },
            done: false,
          },
          { ...chatResponseBody({}), done: true },
        ]),
      () =>
        ndjsonResponse([
          {
            model: 'llama3.2',
            created_at: new Date().toISOString(),
            message: { role: 'assistant', content: 'Sunny in Paris.' },
            done: false,
          },
          { ...chatResponseBody({}), done: true },
        ]),
    ]);
    const client = new OllamaClient({ fetch, retries: 0 });
    const onThinking = vi.fn();
    const onToken = vi.fn();
    const agent = new Agent(client, {
      tools: new ToolRegistry([weatherTool]),
      hooks: { onThinking, onToken },
    });

    const result = await agent.runStream({
      model: 'llama3.2',
      messages: [{ role: 'user', content: 'weather?' }],
    });

    expect(onThinking).toHaveBeenCalledWith({ turn: 1, delta: 'Let me check the weather.' });
    expect(onToken).toHaveBeenCalledWith({ turn: 2, delta: 'Sunny in Paris.' });
    expect(result.finalMessage.content).toBe('Sunny in Paris.');
    expect(result.turns[0]?.toolResults[0]?.result).toBe('Paris: sunny, 21C');
  });
});
