import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool, toolToOllamaFormat } from '../src/tools/define-tool.js';
import { ToolRegistry } from '../src/tools/registry.js';
import {
  OllamaToolExecutionError,
  OllamaToolValidationError,
  OllamaUnknownToolError,
} from '../src/errors.js';
import type { ToolCall } from 'ollama';

function toolCall(name: string, args: Record<string, unknown>): ToolCall {
  return { function: { name, arguments: args } };
}

const weatherTool = defineTool({
  name: 'get_weather',
  description: 'Gets the weather for a city.',
  parameters: z.object({ city: z.string() }),
  handler: (args) => ({ city: args.city, tempC: 21 }),
});

describe('defineTool / toolToOllamaFormat', () => {
  it('produces the Ollama Tool wire shape from a Zod schema', () => {
    const tool = toolToOllamaFormat(weatherTool);
    expect(tool.type).toBe('function');
    expect(tool.function.name).toBe('get_weather');
    expect(tool.function.description).toBe('Gets the weather for a city.');
    expect(tool.function.parameters).toMatchObject({
      type: 'object',
      properties: { city: { type: 'string' } },
      required: ['city'],
    });
  });

  it('passes a raw JSON Schema object through unchanged (the MCP path)', () => {
    const jsonSchemaTool = {
      name: 'raw_tool',
      description: 'A tool with a raw JSON Schema.',
      parameters: { type: 'object', properties: { x: { type: 'number' } } },
      handler: () => 'ok',
    };
    const tool = toolToOllamaFormat(jsonSchemaTool);
    expect(tool.function.parameters).toEqual({
      type: 'object',
      properties: { x: { type: 'number' } },
    });
  });
});

describe('ToolRegistry.executeToolCall', () => {
  it('returns OllamaUnknownToolError + a tool message for an unregistered name (default onError: result)', async () => {
    const registry = new ToolRegistry([weatherTool]);
    const outcome = await registry.executeToolCall(toolCall('does_not_exist', {}));
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBeInstanceOf(OllamaUnknownToolError);
    expect(outcome.message.role).toBe('tool');
    expect(outcome.message.tool_name).toBe('does_not_exist');
  });

  it('returns OllamaToolValidationError with issues when arguments fail Zod validation', async () => {
    const registry = new ToolRegistry([weatherTool]);
    const outcome = await registry.executeToolCall(toolCall('get_weather', { city: 42 }));
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBeInstanceOf(OllamaToolValidationError);
    expect((outcome.error as OllamaToolValidationError).issues).toBeDefined();
  });

  it('runs the handler and stringifies its return value into the tool message content', async () => {
    const registry = new ToolRegistry([weatherTool]);
    const outcome = await registry.executeToolCall(toolCall('get_weather', { city: 'Paris' }));
    expect(outcome.ok).toBe(true);
    expect(outcome.result).toEqual({ city: 'Paris', tempC: 21 });
    expect(JSON.parse(outcome.message.content)).toEqual({ city: 'Paris', tempC: 21 });
  });

  it('feeds a handler failure back as a tool message by default, but rejects with onError: "throw"', async () => {
    const throwingTool = defineTool({
      name: 'boom',
      description: 'Always throws.',
      parameters: z.object({}),
      handler: () => {
        throw new Error('kaboom');
      },
    });

    const resultRegistry = new ToolRegistry([throwingTool]);
    const outcome = await resultRegistry.executeToolCall(toolCall('boom', {}));
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBeInstanceOf(OllamaToolExecutionError);
    expect(outcome.message.role).toBe('tool');

    const throwRegistry = new ToolRegistry([throwingTool], { onError: 'throw' });
    await expect(throwRegistry.executeToolCall(toolCall('boom', {}))).rejects.toBeInstanceOf(
      OllamaToolExecutionError,
    );
  });
});

describe('ToolRegistry.executeToolCalls', () => {
  it('executes sequentially and preserves order, including duplicate calls to the same tool name', async () => {
    const calls: string[] = [];
    const echoTool = defineTool({
      name: 'echo',
      description: 'Echoes its input.',
      parameters: z.object({ value: z.string() }),
      handler: (args) => {
        calls.push(args.value);
        return args.value;
      },
    });
    const registry = new ToolRegistry([echoTool]);

    const results = await registry.executeToolCalls([
      toolCall('echo', { value: 'first' }),
      toolCall('echo', { value: 'second' }),
    ]);

    expect(calls).toEqual(['first', 'second']);
    expect(results.map((r) => r.result)).toEqual(['first', 'second']);
  });

  it('filter() returns a subset registry usable independently', () => {
    const extraTool = defineTool({
      name: 'extra',
      description: 'An extra tool.',
      parameters: z.object({}),
      handler: () => 'extra',
    });
    const registry = new ToolRegistry([weatherTool, extraTool]);
    const subset = registry.filter(['get_weather']);
    expect(subset.has('get_weather')).toBe(true);
    expect(subset.has('extra')).toBe(false);
  });
});
