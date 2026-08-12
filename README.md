# ollama-client-js

A production-grade TypeScript SDK for [Ollama](https://ollama.com), built **on top of** the official
[`ollama`](https://www.npmjs.com/package/ollama) package (`ollama-js`). It keeps `ollama-js` as the
transport/protocol layer and adds the things a real application needs around it: retries, timeouts,
middleware, structured errors, normalized streaming, capability discovery, multi-endpoint failover, and
Zod-powered structured outputs.

The core `OllamaClient` stays exactly what it sounds like: a thin, faithful wrapper with no prompt
orchestration, memory, or RAG baked in. Tool calling, an opt-in agentic loop, an MCP tool adapter, and
a Claude-style Skills loader are available as separate, independently-importable modules built _on
top of_ the client - pull in only the layers you need.

## Why not just use `ollama-js` directly?

`ollama-js` is a thin, faithful wrapper over the Ollama HTTP API - and that's exactly what it should be.
`ollama-client-js` wraps _it_ to add the operational layer most real apps end up hand-rolling anyway:

|                                                                  | `ollama-js`                          | `ollama-client-js`            |
| ---------------------------------------------------------------- | ------------------------------------ | ----------------------------- |
| Chat / generate / embeddings / model management                  | ✅                                   | ✅ (delegates to `ollama-js`) |
| Retries with backoff + jitter                                    | ❌                                   | ✅                            |
| Per-request & default timeouts                                   | ❌                                   | ✅                            |
| Cancellation (`AbortSignal`) for non-streaming calls             | ❌                                   | ✅                            |
| Middleware / interceptors                                        | ❌                                   | ✅                            |
| Structured error hierarchy (`instanceof` checks)                 | ❌ (throws a single `ResponseError`) | ✅                            |
| Normalized stream events (token/thinking/tool_call/done/error)   | ❌ (raw chunks)                      | ✅                            |
| Event-based _and_ async-iterator stream consumption              | ❌                                   | ✅                            |
| Multi-endpoint failover / multi-key rotation                     | ❌                                   | ✅                            |
| Capability discovery (`/api/show` capabilities, local vs. cloud) | ❌                                   | ✅                            |
| Zod structured-output helpers                                    | ❌                                   | ✅                            |
| Raw HTTP escape hatch for endpoints `ollama-js` doesn't wrap yet | ❌                                   | ✅                            |
| Logging / lifecycle hooks                                        | ❌                                   | ✅                            |

## Install

```bash
npm install ollama-client-js
```

`ollama-client-js` depends on `ollama` and `zod` directly - no separate peer-dependency setup required.

Requires Node.js `>=18.17` (for the global `fetch`/`AbortController`/`ReadableStream` APIs) or a modern
browser. You can also inject your own `fetch` implementation via the `fetch` config option.

## Quickstart

```ts
import { OllamaClient } from 'ollama-client-js';

const client = new OllamaClient({
  baseUrl: 'http://localhost:11434',
  apiKey: process.env.OLLAMA_API_KEY, // optional; omit for a local server with no auth
  timeoutMs: 30_000,
  retries: 2,
});

const response = await client.chat({
  model: 'llama3.2',
  messages: [{ role: 'user', content: 'Say hello in one short sentence.' }],
});

console.log(response.message.content);
```

### Streaming

```ts
const stream = await client.chatStream({
  model: 'llama3.2',
  messages: [{ role: 'user', content: 'Count from 1 to 5.' }],
});

for await (const event of stream) {
  if (event.type === 'token') process.stdout.write(event.data.delta);
}
```

Or consume it with events instead of `for await`:

```ts
const stream = await client.chatStream({ model: 'llama3.2', messages: [...] });
stream.on('token', (event) => process.stdout.write(event.data.delta));
stream.on('error', (event) => console.error(event.data.error));
const finalMessage = await stream.finalResult;
```

A stream instance supports **either** consumption style, whichever is used first - mixing them on the
same instance throws a clear error, since the underlying source can only be drained once.

### Structured output (Zod)

```ts
import { z } from 'zod';

const Review = z.object({ title: z.string(), rating: z.number(), summary: z.string() });

const review = await client.chatWithSchema(
  { model: 'llama3.2', messages: [{ role: 'user', content: 'Review "The Matrix".' }] },
  Review,
);
// review: { title: string; rating: number; summary: string } - already validated
```

`chatWithSchema` converts the Zod schema to JSON Schema, sends it as the `format` field so Ollama
constrains generation to match it, then validates the model's response against the same schema. On a
mismatch it throws `OllamaValidationError` (never a raw `SyntaxError`/`ZodError`).

### Reasoning / thinking

`think` is a first-class field on `chat`/`generate` requests, passed straight through to Ollama - no
separate API:

```ts
const response = await client.chat({
  model: 'deepseek-r1',
  messages: [{ role: 'user', content: 'Solve: 17 * 24' }],
  think: true, // or 'high' | 'medium' | 'low' on models that support graded effort
});
console.log(response.message.thinking); // the model's reasoning trace, when it emits one
console.log(response.message.content); // the final answer
```

Streaming surfaces reasoning deltas as their own normalized event: `stream.on('thinking', (event) =>
process.stdout.write(event.data.delta))`, alongside `'token'` for the final-answer deltas.

### Tool calling

```ts
import { defineTool, ToolRegistry } from 'ollama-client-js';
import { z } from 'zod';

const getWeather = defineTool({
  name: 'get_weather',
  description: 'Gets the current weather for a city.',
  parameters: z.object({ city: z.string() }),
  handler: async ({ city }) => ({ city, tempC: 21, condition: 'sunny' }),
});

const tools = new ToolRegistry([getWeather]);

const response = await client.chat({
  model: 'llama3.2',
  messages: [{ role: 'user', content: 'What is the weather in Paris?' }],
  tools: tools.toOllamaTools(),
});

if (response.message.tool_calls) {
  const results = await tools.executeToolCalls(response.message.tool_calls);
  // append `results.map(r => r.message)` (role: 'tool') and call `client.chat` again
}
```

`defineTool` ties a Zod parameter schema to a handler: the schema both validates a model's call
arguments before the handler runs and is converted to the JSON Schema Ollama expects in
`tools[].function.parameters`. `ToolRegistry.executeToolCalls` runs a model's `tool_calls`
sequentially against registered handlers and returns `role: 'tool'` result messages ready to append
to the conversation. By default (`onError: 'result'`), an unregistered tool name, a schema mismatch,
or a handler throwing all become a structured error fed back to the model as a tool message rather
than crashing your code; pass `onError: 'throw'` for fail-fast behavior instead.

**Note:** Ollama's `ToolCall` carries no call ID (unlike OpenAI/Anthropic tool-call blocks), so a
result can only be correlated to its request by order - if a model requests the same tool twice in
one turn, matching results to calls is positional, not ID-based.

### Agent loop

For multi-turn tool use (call the model, run its tool calls, feed results back, repeat), `Agent`
composes over `OllamaClient` - it's an opt-in module, not baked into `chat()`:

```ts
import { Agent, ToolRegistry } from 'ollama-client-js';

const agent = new Agent(client, {
  tools: new ToolRegistry([getWeather]),
  maxIterations: 10, // guards against infinite tool-call loops; default 10
  hooks: {
    onToolCall: ({ toolCall }) => console.log('calling', toolCall.function.name),
    onToolResult: ({ result }) => console.log('result', result.ok, result.result),
  },
});

const result = await agent.run({
  model: 'llama3.2',
  messages: [{ role: 'user', content: 'What is the weather in Paris?' }],
});
console.log(result.finalMessage.content);
```

`agent.runStream(...)` is the same loop driven by `chatStream` instead, so `onThinking`/`onToken`
hooks fire with live deltas as each turn streams in; both methods return the same `AgentResult`
shape (`messages`, `finalMessage`, `turns`, `iterations`). A run that never converges to a
tool-call-free message within `maxIterations` throws `OllamaAgentMaxIterationsError`.

### MCP tools

Any object shaped like an MCP SDK `Client` (`listTools()`/`callTool()`) can be turned into tool
definitions - no dependency on `@modelcontextprotocol/sdk` required:

```ts
import { registerMcpTools, ToolRegistry } from 'ollama-client-js';

const tools = new ToolRegistry();
await registerMcpTools(tools, mcpClient, { namePrefix: 'mcp_' }); // namePrefix avoids name collisions

const agent = new Agent(client, { tools });
```

MCP-sourced tools use the server's raw JSON Schema `inputSchema` directly (not a Zod schema), so
unlike `defineTool`-based tools they get no client-side argument validation before the call is made.
A result's text content blocks are joined into the tool message; non-text blocks (images, embedded
resources) become a `[unsupported content type: ...]` placeholder rather than being silently
dropped. A result with `isError: true` is thrown as `OllamaMcpError`.

### Skills

A lightweight, Claude-style convention for packaging reusable instructions: a directory of
`<skill-name>/SKILL.md` files, each with YAML frontmatter (`name`, `description`, optional
`allowed-tools`) and a markdown body.

```
skills/
  code-reviewer/
    SKILL.md
```

```md
---
name: code-reviewer
description: Reviews a diff for correctness and style issues.
allowed-tools: read_file, search_code
---

Review the given diff for correctness bugs first, then style. Be concise.
```

`SkillRegistry` is Node-only (it reads files off disk), so it's exported from the
`ollama-client-js/skills` subpath rather than the package's main entry - importing from
`ollama-client-js` itself never pulls in `node:fs`, keeping the main bundle usable from
browsers/edge runtimes:

```ts
import { SkillRegistry } from 'ollama-client-js/skills';
import { applySkill } from 'ollama-client-js'; // pure helper, available from the main entry

const skills = new SkillRegistry({ directory: './skills' });
await skills.list(); // [{ name, description, path }, ...] - bodies aren't read yet
const skill = await skills.load('code-reviewer'); // full body + allowedTools, read on demand

const { messages, tools } = applySkill(skill, {
  messages: [{ role: 'user', content: 'Review this diff: ...' }],
  tools: myToolRegistry, // narrowed to `allowed-tools` when the skill declares them
});
```

## Configuration

```ts
new OllamaClient({
  baseUrl?: string;              // default: 'http://localhost:11434'
  apiKey?: string;                // sent as `Authorization: Bearer <apiKey>`
  headers?: Record<string, string>;
  endpoints?: OllamaEndpoint[];    // multi-endpoint failover; see below
  endpointHealth?: EndpointRegistryOptions;
  failoverOn?: string[];           // error codes that trigger failover; see defaults below
  timeoutMs?: number;              // default: 30_000
  retries?: number | Partial<RetryConfig>;
  fetch?: typeof fetch;            // custom fetch injection (proxying, testing, non-standard runtimes)
  middleware?: Middleware[];
  logger?: Logger;
  debug?: boolean;                 // enables a default console logger if no `logger` is given
  onLifecycleEvent?: (event: RequestLifecycleEvent) => void;
})
```

### Retries and timeouts

```ts
new OllamaClient({
  timeoutMs: 30_000,
  retries: 2, // shorthand for { maxRetries: 2, ...defaults }
});
```

Or the full policy:

```ts
new OllamaClient({
  retries: {
    maxRetries: 3,
    initialDelayMs: 250,
    maxDelayMs: 5_000,
    backoffMultiplier: 2,
    jitter: true, // full jitter, per AWS's backoff guidance
    retryableStatusCodes: [408, 409, 425, 429, 500, 502, 503, 504],
    retryOnNetworkError: true,
    retryOnTimeout: true,
  },
});
```

Retries only ever happen **before** a streaming response starts (i.e. while waiting for the initial HTTP
response) - once a stream begins yielding chunks, it is never silently retried, since that could
duplicate output.

Every request also accepts a per-call override:

```ts
await client.chat({ model: 'llama3.2', messages: [...], timeoutMs: 5_000, signal: myAbortController.signal });
```

`timeoutMs`/`signal` are client-side-only fields - they are stripped before the request body is built,
so they never leak into the JSON sent to the server. For non-streaming calls, `signal`/per-call
`timeoutMs` are enforced by racing the client-side promise (the request may still be discarded server-
side); the client-wide default `timeoutMs` is enforced at the actual network layer. For streaming calls,
cancelling the `signal` after the stream has started calls `stream.abort()`, which **does** cancel the
underlying HTTP request.

### Middleware

```ts
const loggingMiddleware: Middleware = {
  name: 'logging',
  onRequest: (ctx) => console.log(`-> ${ctx.request.method} ${ctx.request.url}`),
  onResponse: (ctx) => console.log(`<- ${ctx.response.status} in ${ctx.durationMs}ms`),
  onError: (ctx) => console.log(`x ${ctx.error}`),
  shouldRetry: (ctx) => (ctx.response?.status === 409 ? false : undefined), // undefined defers to defaults
};

new OllamaClient({ middleware: [loggingMiddleware] });
```

Hooks run in registration order for `onRequest`/`onResponse`/`onError`. For `shouldRetry`, the _last_
middleware that returns a defined `boolean` wins, so more specific middleware registered later can
override earlier defaults; returning `undefined` defers to whatever decided it before.

### Structured errors

Every error thrown by this library is an `OllamaClientError` subclass with a stable `.code`:

```ts
import {
  OllamaClientError,
  OllamaNetworkError,
  OllamaTimeoutError,
  OllamaValidationError,
  OllamaAuthError,
  OllamaNotFoundError,
  OllamaRateLimitError,
  OllamaServerError,
  OllamaUnsupportedFeatureError,
  OllamaAbortError,
} from 'ollama-client-js';

try {
  await client.chat({ model: 'does-not-exist', messages: [] });
} catch (error) {
  if (error instanceof OllamaNotFoundError) {
    console.log('Model not found:', error.message, error.status);
  } else if (error instanceof OllamaClientError) {
    console.log(error.code, error.retryable, error.request, error.response);
  }
}
```

### Multi-endpoint failover / multi-key rotation

```ts
const client = new OllamaClient({
  endpoints: [
    { name: 'local', baseUrl: 'http://localhost:11434', priority: 1 },
    { name: 'cloud-key-a', baseUrl: 'https://ollama.example.com', apiKey: KEY_A, priority: 2 },
    { name: 'cloud-key-b', baseUrl: 'https://ollama.example.com', apiKey: KEY_B, priority: 2 },
  ],
  endpointHealth: { failureThreshold: 3, cooldownMs: 30_000 },
});
```

Endpoints are tried in priority order. After `failureThreshold` consecutive failures, an endpoint is put
in cooldown and deprioritized (still tried as a last resort if every endpoint is unhealthy - failing
open rather than refusing to serve). By default, failover triggers on `network_error`, `timeout`,
`server_error`, `rate_limited`, and `auth_error`; override with `failoverOn`. Inspect health with
`client.endpointStatus()` (passive, failure-count based) or `client.healthCheck()` (active `/api/version`
probe of every endpoint).

### Capability discovery

```ts
client.runtimeMode(); // 'local' | 'cloud' | 'unknown' - heuristic, based on hostname
await client.capabilities('llama3.2'); // { supportsTools, supportsVision, supportsEmbedding, ... }
```

Model capability flags (`supportsTools`, `supportsVision`, `supportsEmbedding`, `supportsCompletion`) are
read directly from the server's `/api/show` `capabilities` field - never guessed. `supportsStreaming`
and `supportsStructuredOutputRequest` are always `true`: they describe a protocol-level fact about the
`/api/chat`/`/api/generate` endpoints (any Ollama server accepts `stream`/`format`), not a per-model
guarantee that the model will follow those instructions well.

### Usage / token accounting

Ollama already returns token counts and durations (in nanoseconds) on every response; `extractUsage()`
reshapes that into a uniform, millisecond-scale shape - handy for metering, cost tracking, or logging in
a larger application (e.g. an agent runtime) built on top of this client:

```ts
import { extractUsage } from 'ollama-client-js';

const response = await client.chat({ model: 'llama3.2', messages: [...] });
const usage = extractUsage(response);
// { promptTokens, completionTokens, totalTokens, totalDurationMs, loadDurationMs,
//   promptEvalDurationMs, evalDurationMs, tokensPerSecond }
```

It works on `ChatResponse`, `GenerateResponse`, and `EmbedResponse` alike (fields that don't apply, like
`completionTokens` for an embedding call, are simply `undefined` rather than guessed). Streaming results
carry the same data too: `(await stream.finalResult).usage`.

### Raw HTTP fallback

For endpoints `ollama-js` doesn't wrap (e.g. the blob upload API used when creating models from local
layers), or a brand-new server API your installed `ollama` version doesn't know about yet:

```ts
await client.raw.blobExists('sha256:...');
await client.raw.pushBlob('sha256:...', fileBuffer);
const version = await client.raw.requestJson<{ version: string }>({ path: '/api/version' });
```

`client.raw` goes through the same retry/timeout/middleware pipeline as every other call, scoped to the
currently active endpoint.

### Logging and observability

```ts
new OllamaClient({
  debug: true, // enables a default console logger
  // or bring your own:
  logger: myLogger, // { debug, info, warn, error }
  onLifecycleEvent: (event) => {
    // event.type: 'request:start' | 'request:success' | 'request:retry' | 'request:error'
    metrics.record(event);
  },
});
```

## API overview

```ts
client.chat(request); // ChatResponse | OllamaStream<ChatResponse, ChatStreamResult>
client.chatStream(request); // OllamaStream<ChatResponse, ChatStreamResult>
client.chatWithSchema(req, schema);

client.generate(request); // GenerateResponse | OllamaStream<GenerateResponse, GenerateStreamResult>
client.generateStream(request);
client.generateWithSchema(req, schema);

client.embed(request); // EmbedResponse
client.embeddings(request); // EmbeddingsResponse (deprecated upstream single-prompt endpoint)

client.listModels() / client.models();
client.showModel(request);
client.pullModel(request); // ProgressResponse | OllamaStream<...>
client.pushModel(request);
client.createModel(request);
client.deleteModel(request);
client.copyModel(request);
client.ps();
client.version();

client.capabilities(model);
client.runtimeMode();
client.healthCheck();
client.endpointStatus();
client.raw; // RawHttpClient
client.abort(); // aborts every in-flight streamed request

// Opt-in layers, built on top of OllamaClient - see the sections above
defineTool({ name, description, parameters, handler }); // Zod-backed tool definition
new ToolRegistry(tools?, options?); // .toOllamaTools() / .executeToolCalls() / .filter()
new Agent(client, { tools, maxIterations?, hooks? }); // .run() / .runStream()
loadMcpTools(mcpClient, options?); // registerMcpTools(registry, mcpClient, options?)
applySkill(skill, { messages, tools? }); // parseFrontmatter(source)
// SkillRegistry lives in the separate `ollama-client-js/skills` subpath (Node-only)
```

Every method accepts the upstream `ollama-js` request shape plus optional `signal`/`timeoutMs`. See
[`docs/api.md`](./docs/api.md) for the full reference and [`docs/migration.md`](./docs/migration.md) if
you're migrating from `ollama-js` directly.

More runnable examples live in [`examples/`](./examples): basic chat, streaming, structured output,
custom middleware, retries/timeouts, raw fallback transport, tool calling, the agent loop, MCP
tools, and skills.

## Architecture

```
src/
  client.ts            Public OllamaClient - the only file most consumers touch
  config.ts             OllamaClientConfig
  errors.ts              Structured error hierarchy + mapError()
  logger.ts               Logger interface, lifecycle events
  middleware.ts            Composable middleware pipeline
  adapter/                 Isolates all interaction with the upstream `ollama` package
  transport/                Enhanced fetch: retries, timeouts, auth headers, raw HTTP fallback
  streaming/                  Normalized stream events, both async-iterator and event-based
  capabilities/                 Capability discovery
  providers/                     Multi-endpoint registry, health checks, failover
  schema/                          Zod <-> JSON Schema, structured-output parsing/validation
  tools/                            Typed tool definitions (defineTool) + ToolRegistry (execution)
  agent/                             Opt-in multi-turn tool-calling loop (Agent), composes over OllamaClient
  mcp/                                Duck-typed MCP tool adapter (no @modelcontextprotocol/sdk dependency)
  skills/                             SKILL.md convention; SkillRegistry is Node-only, its own subpath entry
```

Everything that talks to the upstream `ollama` package goes through `adapter/ollama-adapter.ts` - nothing
else imports from `ollama` directly (aside from type-only imports of its request/response shapes, used
freely throughout), so upgrading or replacing that dependency only ever touches one file.

`tools/`, `agent/`, and `mcp/` are pure TypeScript with no Node-specific APIs, so they build into the
package's single `platform: 'neutral'` main entry alongside everything else. `skills/` is split: its
pure pieces (`types.ts`, `frontmatter.ts`, `compose.ts`) are re-exported from the main entry too, but
`skill-registry.ts` reads files via `node:fs/promises` and is only exported from the separate
`ollama-client-js/skills` subpath (its own `tsup` build entry), so importing the main package never
pulls in Node filesystem APIs.

## Development

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build
```

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the full contributor workflow and
[`CHANGELOG.md`](./CHANGELOG.md) for release notes.

## License

MIT
