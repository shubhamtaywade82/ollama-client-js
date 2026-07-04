import { describe, expect, it } from 'vitest';
import { EndpointRegistry } from '../src/providers/endpoint-registry.js';

describe('EndpointRegistry', () => {
  it('orders candidates by priority', () => {
    const registry = new EndpointRegistry([
      { name: 'b', baseUrl: 'http://b', priority: 2 },
      { name: 'a', baseUrl: 'http://a', priority: 1 },
    ]);
    expect(registry.candidates().map((e) => e.name)).toEqual(['a', 'b']);
  });

  it('rejects duplicate endpoint names', () => {
    expect(
      () =>
        new EndpointRegistry([
          { name: 'a', baseUrl: 'http://a' },
          { name: 'a', baseUrl: 'http://a2' },
        ]),
    ).toThrow(/Duplicate endpoint name/);
  });

  it('rejects an empty endpoint list', () => {
    expect(() => new EndpointRegistry([])).toThrow(/requires at least one endpoint/);
  });

  it('moves an endpoint into cooldown after the failure threshold and excludes it from candidates', () => {
    const now = 0;
    const registry = new EndpointRegistry(
      [
        { name: 'a', baseUrl: 'http://a', priority: 1 },
        { name: 'b', baseUrl: 'http://b', priority: 2 },
      ],
      { failureThreshold: 2, cooldownMs: 1000, now: () => now },
    );

    registry.reportFailure('a');
    expect(registry.candidates().map((e) => e.name)).toEqual(['a', 'b']);

    registry.reportFailure('a');
    expect(registry.candidates().map((e) => e.name)).toEqual(['b']);

    const status = registry.status();
    expect(status.find((s) => s.name === 'a')?.healthy).toBe(false);
  });

  it('recovers an endpoint after the cooldown period elapses', () => {
    let now = 0;
    const registry = new EndpointRegistry([{ name: 'a', baseUrl: 'http://a' }], {
      failureThreshold: 1,
      cooldownMs: 1000,
      now: () => now,
    });

    registry.reportFailure('a');
    now = 500;
    expect(registry.status()[0]?.healthy).toBe(false);
    now = 1500;
    expect(registry.status()[0]?.healthy).toBe(true);
  });

  it('resets failure count on success', () => {
    const now = 0;
    const registry = new EndpointRegistry([{ name: 'a', baseUrl: 'http://a' }], {
      failureThreshold: 2,
      now: () => now,
    });
    registry.reportFailure('a');
    registry.reportSuccess('a');
    registry.reportFailure('a');
    expect(registry.status()[0]?.healthy).toBe(true);
    expect(registry.status()[0]?.consecutiveFailures).toBe(1);
  });

  it('fails open (returns all endpoints, soonest-to-recover first) when every endpoint is unhealthy', () => {
    let now = 0;
    const registry = new EndpointRegistry(
      [
        { name: 'a', baseUrl: 'http://a' },
        { name: 'b', baseUrl: 'http://b' },
      ],
      { failureThreshold: 1, cooldownMs: 1000, now: () => now },
    );
    registry.reportFailure('b'); // cooldownUntil = 1000
    now = 100;
    registry.reportFailure('a'); // cooldownUntil = 1100
    expect(registry.candidates().map((e) => e.name)).toEqual(['b', 'a']);
  });
});
