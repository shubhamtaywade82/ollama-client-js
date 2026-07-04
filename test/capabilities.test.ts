import { describe, expect, it } from 'vitest';
import { detectModelCapabilities, inferRuntimeMode } from '../src/capabilities/capabilities.js';
import { OllamaAdapter } from '../src/adapter/ollama-adapter.js';
import { createScriptedFetch, jsonResponse } from './test-utils/mock-fetch.js';

describe('inferRuntimeMode', () => {
  it('classifies localhost as local', () => {
    expect(inferRuntimeMode('http://localhost:11434')).toBe('local');
  });

  it('classifies loopback and private IP ranges as local', () => {
    expect(inferRuntimeMode('http://127.0.0.1:11434')).toBe('local');
    expect(inferRuntimeMode('http://192.168.1.50:11434')).toBe('local');
    expect(inferRuntimeMode('http://10.0.0.5:11434')).toBe('local');
  });

  it('classifies public hostnames as cloud', () => {
    expect(inferRuntimeMode('https://ollama.example.com')).toBe('cloud');
  });

  it('returns unknown for unparseable URLs', () => {
    expect(inferRuntimeMode('not-a-url')).toBe('unknown');
  });
});

describe('detectModelCapabilities', () => {
  it('derives boolean capability flags from the reported capabilities array', async () => {
    const { fetch } = createScriptedFetch([
      () =>
        jsonResponse({
          license: '',
          modelfile: '',
          parameters: '',
          template: '',
          system: '',
          details: {},
          messages: [],
          modified_at: new Date().toISOString(),
          model_info: {},
          capabilities: ['completion', 'tools', 'vision'],
        }),
    ]);
    const adapter = new OllamaAdapter({ host: 'http://localhost:11434', fetch });

    const capabilities = await detectModelCapabilities(adapter, 'llama3.2');
    expect(capabilities.model).toBe('llama3.2');
    expect(capabilities.supportsCompletion).toBe(true);
    expect(capabilities.supportsTools).toBe(true);
    expect(capabilities.supportsVision).toBe(true);
    expect(capabilities.supportsEmbedding).toBe(false);
    expect(capabilities.supportsStreaming).toBe(true);
    expect(capabilities.supportsStructuredOutputRequest).toBe(true);
    expect(capabilities.reported).toEqual(['completion', 'tools', 'vision']);
  });

  it('treats an absent capabilities field as no reported capabilities', async () => {
    const { fetch } = createScriptedFetch([
      () =>
        jsonResponse({
          license: '',
          modelfile: '',
          parameters: '',
          template: '',
          system: '',
          details: {},
          messages: [],
          modified_at: new Date().toISOString(),
          model_info: {},
        }),
    ]);
    const adapter = new OllamaAdapter({ host: 'http://localhost:11434', fetch });
    const capabilities = await detectModelCapabilities(adapter, 'tiny');
    expect(capabilities.reported).toEqual([]);
    expect(capabilities.supportsTools).toBe(false);
  });
});
