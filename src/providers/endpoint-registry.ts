/**
 * Multi-key / multi-provider routing and failover.
 *
 * An {@link OllamaEndpoint} is anything a request can be sent to: a local
 * Ollama install, a cloud endpoint with an API key, or the same base URL
 * with a different key for rate-limit spreading. The registry tracks
 * per-endpoint health using a simple failure-count circuit breaker: after
 * `failureThreshold` consecutive failures an endpoint is put in cooldown and
 * deprioritized until `cooldownMs` elapses, at which point it's eligible
 * again. This is deliberately not opinionated about *why* an endpoint
 * failed - the caller (the client's request loop) decides which errors
 * count as failures worth failing over on.
 */

export interface OllamaEndpoint {
  /** Unique, stable identifier for this endpoint (used in logs and health reports). */
  readonly name: string;
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly headers?: Record<string, string>;
  /** Lower values are tried first. Defaults to `0`. */
  readonly priority?: number;
}

export interface EndpointHealth {
  readonly name: string;
  readonly healthy: boolean;
  readonly consecutiveFailures: number;
  readonly cooldownUntil?: number;
}

export interface EndpointRegistryOptions {
  /** Consecutive failures before an endpoint is put in cooldown. Defaults to `3`. */
  readonly failureThreshold?: number;
  /** Cooldown duration in milliseconds. Defaults to `30_000`. */
  readonly cooldownMs?: number;
  /** Injectable clock, for deterministic tests. */
  readonly now?: () => number;
}

interface EndpointState {
  consecutiveFailures: number;
  cooldownUntil?: number;
}

export class EndpointRegistry {
  private readonly endpoints: readonly OllamaEndpoint[];
  private readonly health = new Map<string, EndpointState>();
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  constructor(endpoints: readonly OllamaEndpoint[], options: EndpointRegistryOptions = {}) {
    if (endpoints.length === 0) {
      throw new Error('EndpointRegistry requires at least one endpoint');
    }
    const names = new Set<string>();
    for (const endpoint of endpoints) {
      if (names.has(endpoint.name)) {
        throw new Error(`Duplicate endpoint name: "${endpoint.name}"`);
      }
      names.add(endpoint.name);
    }
    this.endpoints = [...endpoints].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
    for (const endpoint of this.endpoints) {
      this.health.set(endpoint.name, { consecutiveFailures: 0 });
    }
    this.failureThreshold = options.failureThreshold ?? 3;
    this.cooldownMs = options.cooldownMs ?? 30_000;
    this.now = options.now ?? Date.now;
  }

  list(): readonly OllamaEndpoint[] {
    return this.endpoints;
  }

  /**
   * Returns endpoints in the order they should be attempted for the next
   * request: healthy endpoints first (by priority), falling back to
   * endpoints still in cooldown - soonest to recover first - only if every
   * endpoint is currently unhealthy (fail open rather than refusing to try).
   */
  candidates(): OllamaEndpoint[] {
    const now = this.now();
    const available = this.endpoints.filter((endpoint) => {
      const state = this.health.get(endpoint.name);
      return !state?.cooldownUntil || state.cooldownUntil <= now;
    });
    if (available.length > 0) return available;

    return [...this.endpoints].sort(
      (a, b) =>
        (this.health.get(a.name)?.cooldownUntil ?? 0) -
        (this.health.get(b.name)?.cooldownUntil ?? 0),
    );
  }

  reportSuccess(name: string): void {
    const state = this.health.get(name);
    if (!state) return;
    state.consecutiveFailures = 0;
    state.cooldownUntil = undefined;
  }

  reportFailure(name: string): void {
    const state = this.health.get(name);
    if (!state) return;
    state.consecutiveFailures += 1;
    if (state.consecutiveFailures >= this.failureThreshold) {
      state.cooldownUntil = this.now() + this.cooldownMs;
    }
  }

  status(): EndpointHealth[] {
    const now = this.now();
    return this.endpoints.map((endpoint) => {
      const state = this.health.get(endpoint.name) ?? { consecutiveFailures: 0 };
      return {
        name: endpoint.name,
        healthy: !state.cooldownUntil || state.cooldownUntil <= now,
        consecutiveFailures: state.consecutiveFailures,
        cooldownUntil: state.cooldownUntil,
      };
    });
  }
}
