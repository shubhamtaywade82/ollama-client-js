import type { FetchLike } from '../transport/enhanced-fetch.js';
import type { OllamaEndpoint } from './endpoint-registry.js';

export interface EndpointHealthCheckResult {
  readonly name: string;
  readonly reachable: boolean;
  readonly latencyMs?: number;
  readonly error?: string;
}

/**
 * Performs a lightweight active health check against an endpoint's
 * `/api/version` route. This is separate from the registry's passive,
 * failure-count-based health tracking: use this when you want to probe
 * endpoints proactively (e.g. on startup, or from a `/healthz` route) rather
 * than relying solely on production traffic.
 */
export async function checkEndpointHealth(
  endpoint: OllamaEndpoint,
  fetchImpl: FetchLike,
  timeoutMs = 5_000,
): Promise<EndpointHealthCheckResult> {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = new URL('/api/version', endpoint.baseUrl).toString();
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        ...endpoint.headers,
        ...(endpoint.apiKey ? { authorization: `Bearer ${endpoint.apiKey}` } : {}),
      },
      signal: controller.signal,
    });
    return {
      name: endpoint.name,
      reachable: response.ok,
      latencyMs: Date.now() - start,
      error: response.ok ? undefined : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      name: endpoint.name,
      reachable: false,
      latencyMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}
