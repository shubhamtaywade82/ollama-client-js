import type { ModelResponse } from 'ollama';
import type { OllamaAdapter } from '../adapter/ollama-adapter.js';

export type RuntimeMode = 'local' | 'cloud' | 'unknown';

const PRIVATE_IPV4 = /^(10\.|127\.|0\.0\.0\.0$|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/;

/**
 * Infers whether a base URL points at a local Ollama install or a remote
 * (cloud) endpoint, purely from the hostname. This is a heuristic, not a
 * server-reported fact - unusual setups (SSH tunnels, port-forwarded
 * clusters) can defeat it. It exists to support routing decisions and
 * logging, not to gate functionality.
 */
export function inferRuntimeMode(baseUrl: string): RuntimeMode {
  try {
    const { hostname } = new URL(baseUrl);
    if (hostname === 'localhost' || hostname === '::1' || PRIVATE_IPV4.test(hostname)) {
      return 'local';
    }
    return 'cloud';
  } catch {
    return 'unknown';
  }
}

/**
 * Capabilities for a specific model, derived from `/api/show`.
 *
 * `supportsTools`, `supportsVision`, `supportsEmbedding`, and
 * `supportsCompletion` are read directly from the server's reported
 * `capabilities` array - we never guess these. `supportsStreaming` and
 * `supportsStructuredOutputRequest` are protocol-level facts about the
 * `/api/chat` and `/api/generate` endpoints themselves (any Ollama server
 * accepts `stream` and `format`, independent of the model), not a
 * model-specific guess; they say nothing about whether a given model will
 * *follow* those instructions well.
 */
export interface ModelCapabilities {
  readonly model: string;
  /** The raw `capabilities` array reported by the server, unmodified. */
  readonly reported: readonly string[];
  readonly supportsTools: boolean;
  readonly supportsVision: boolean;
  readonly supportsEmbedding: boolean;
  readonly supportsCompletion: boolean;
  readonly supportsStreaming: true;
  readonly supportsStructuredOutputRequest: true;
}

export async function detectModelCapabilities(
  adapter: OllamaAdapter,
  model: string,
): Promise<ModelCapabilities> {
  const show = await adapter.show({ model });
  const reported = show.capabilities ?? [];
  return {
    model,
    reported,
    supportsTools: reported.includes('tools'),
    supportsVision: reported.includes('vision'),
    supportsEmbedding: reported.includes('embedding'),
    supportsCompletion: reported.includes('completion'),
    supportsStreaming: true,
    supportsStructuredOutputRequest: true,
  };
}

/** Lists the models currently available on the server (thin wrapper over `/api/tags`). */
export async function listAvailableModels(adapter: OllamaAdapter): Promise<ModelResponse[]> {
  const { models } = await adapter.list();
  return models;
}
