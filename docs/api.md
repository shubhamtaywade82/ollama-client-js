# API Reference

This is a reference for `OllamaClient`'s public surface. All request types accept the same fields as the
corresponding `ollama-js` request, plus optional `signal?: AbortSignal` and `timeoutMs?: number` (both
client-side-only; stripped before the request is sent). Full TSDoc is also available in your editor via
the published `.d.ts` files.

## Constructor

```ts
new OllamaClient(config?: OllamaClientConfig)
```

See the [README's Configuration section](../README.md#configuration) for the full `OllamaClientConfig`
shape and defaults.

## Chat

### `client.chat(request)`

```ts
chat(request: ChatRequestInput & { stream: true }): Promise<OllamaStream<ChatResponse, ChatStreamResult>>;
chat(request: ChatRequestInput & { stream?: false }): Promise<ChatResponse>;
```

Sends a chat request. `request` is `ollama-js`'s `ChatRequest` (`model`, `messages`, `tools`, `format`,
`options`, `keep_alive`, `think`, ...) plus `signal`/`timeoutMs`.

### `client.chatStream(request)`

```ts
chatStream(request: Omit<ChatRequestInput, 'stream'>): Promise<OllamaStream<ChatResponse, ChatStreamResult>>
```

Convenience wrapper equivalent to `chat({ ...request, stream: true })`.

### `client.chatWithSchema(request, schema)`

```ts
chatWithSchema<TSchema extends z.ZodType>(
  request: Omit<ChatRequestInput, 'stream' | 'format'>,
  schema: TSchema,
): Promise<z.infer<TSchema>>
```

Sets `format` to the JSON Schema derived from `schema`, sends a non-streaming chat request, and parses +
validates `response.message.content` against `schema`. Throws `OllamaValidationError` on invalid JSON or
a schema mismatch.

## Generate

`client.generate(request)`, `client.generateStream(request)`, and `client.generateWithSchema(request,
schema)` mirror the chat methods above, operating on `ollama-js`'s `GenerateRequest`/`GenerateResponse`
(`prompt` instead of `messages`).

## Embeddings

- `client.embed(request: EmbedRequestInput): Promise<EmbedResponse>` - current multi-input embeddings API.
- `client.embeddings(request: EmbeddingsRequestInput): Promise<EmbeddingsResponse>` - deprecated
  single-prompt endpoint, kept for parity with `ollama-js`.

## Model management

| Method                                    | Upstream endpoint    | Notes                                                                             |
| ----------------------------------------- | -------------------- | --------------------------------------------------------------------------------- |
| `client.listModels()` / `client.models()` | `GET /api/tags`      | Returns `ModelResponse[]`                                                         |
| `client.showModel(request)`               | `POST /api/show`     |                                                                                   |
| `client.pullModel(request)`               | `POST /api/pull`     | Supports `stream: true` -> `OllamaStream<ProgressResponse, ProgressStreamResult>` |
| `client.pushModel(request)`               | `POST /api/push`     | Same streaming shape as pull                                                      |
| `client.createModel(request)`             | `POST /api/create`   | Same streaming shape as pull                                                      |
| `client.deleteModel(request)`             | `DELETE /api/delete` |                                                                                   |
| `client.copyModel(request)`               | `POST /api/copy`     |                                                                                   |
| `client.ps()`                             | `GET /api/ps`        | Running models                                                                    |
| `client.version()`                        | `GET /api/version`   |                                                                                   |

## Streaming (`OllamaStream<TChunk, TFinal>`)

Returned by every streaming call. Supports exactly one of two consumption styles - whichever is used
first - and throws if you try to switch styles mid-stream:

- **Async iteration**: `for await (const event of stream) { ... }`.
- **Events**: `stream.on(type, listener)`, returning an unsubscribe function. Registering any listener
  starts draining the stream in the background.

Normalized event types: `'token' | 'thinking' | 'tool_call' | 'message' | 'done' | 'error'`. `'message'`
carries the raw underlying chunk for anything the normalized shape doesn't cover. `'done'` carries the
fully aggregated result (`ChatStreamResult` / `GenerateStreamResult` / `ProgressStreamResult`), also
available as `await stream.finalResult`.

`stream.abort()` cancels the underlying HTTP request.

## Capability discovery

- `client.capabilities(model: string): Promise<ModelCapabilities>` - probes `/api/show`.
- `client.runtimeMode(): 'local' | 'cloud' | 'unknown'` - hostname-based heuristic for the active endpoint.

## Usage / token accounting

- `extractUsage(source: UsageSource): OllamaUsage` - top-level exported function (not a method on
  `client`). Reshapes the token counts and nanosecond durations already present on `ChatResponse`,
  `GenerateResponse`, and `EmbedResponse` into `{ promptTokens, completionTokens, totalTokens,
totalDurationMs, loadDurationMs, promptEvalDurationMs, evalDurationMs, tokensPerSecond }`. Fields the
  source response doesn't report are `undefined`, never estimated. `ChatStreamResult` and
  `GenerateStreamResult` both carry a populated `usage` field once `done` is `true`.

## Tool calling

- `defineTool({ name, description, parameters, handler }): ToolDefinition` - `parameters` is a Zod
  schema; `handler(args, ctx)` receives parsed, validated arguments. `ctx: { toolCall, signal? }`.
- `toolToOllamaFormat(tool: ToolDefinition): Tool` - converts one definition to the wire `Tool`
  shape (Zod schemas go through `zodToOllamaFormat`; raw JSON Schema objects, as used by MCP-sourced
  tools, pass through unchanged).
- `new ToolRegistry(tools?, options?)` - `options.onError`: `'result'` (default) or `'throw'`.
  - `.register(tool)` / `.unregister(name)` / `.has(name)` / `.list()`
  - `.toOllamaTools(): Tool[]` - for a `chat` request's `tools` field.
  - `.filter(names): ToolRegistry` - a new registry scoped to a subset of names (used by Skills'
    `allowed-tools`).
  - `.executeToolCall(toolCall, ctx?): Promise<ToolExecutionResult>` /
    `.executeToolCalls(toolCalls, ctx?): Promise<ToolExecutionResult[]>` - executes sequentially, in
    request order (Ollama's `ToolCall` has no call ID, so order is the only correlation mechanism).
    `ToolExecutionResult`: `{ name, ok, result?, error?, message }`, where `message` is the
    `role: 'tool'` message to append to the conversation either way.

## Agent loop

`new Agent(client: OllamaClient, config: AgentConfig)` - opt-in, composes over `OllamaClient` by
calling its public `chat`/`chatStream` methods; not required for basic tool-calling.

- `config`: `{ tools: ToolRegistry, maxIterations?: number /* default 10 */, hooks?: AgentHooks }`.
- `agent.run(input: AgentRunInput): Promise<AgentResult>` - non-streaming loop.
- `agent.runStream(input: AgentRunInput): Promise<AgentResult>` - same loop over `chatStream`;
  `hooks.onThinking`/`hooks.onToken` fire with live deltas per turn.
- `AgentRunInput`: `{ model, messages, think?, options?, signal? }`.
- `AgentResult`: `{ messages, finalMessage, turns, iterations }`.
- `AgentHooks`: `onTurnStart`, `onThinking`, `onToken`, `onAssistantMessage`, `onToolCall`,
  `onToolResult`, `onTurnEnd` - fired in that order per turn.
- Throws `OllamaAgentMaxIterationsError` if no tool-call-free message is reached within
  `maxIterations`.

## MCP tool adapter

Zero extra dependency - duck-typed against `@modelcontextprotocol/sdk`'s `Client` shape.

- `McpClientLike`: `{ listTools(): Promise<{tools}>; callTool({name, arguments}): Promise<{content, isError?}> }`.
- `loadMcpTools(mcpClient: McpClientLike, options?: { namePrefix? }): Promise<ToolDefinition[]>`.
- `registerMcpTools(registry: ToolRegistry, mcpClient, options?): Promise<void>`.
- MCP tools carry their raw `inputSchema` as `parameters` (no client-side Zod validation). A result's
  text content blocks are joined into the tool message; non-text blocks become a
  `[unsupported content type: ...]` placeholder. `isError: true`, or a rejected `listTools`/`callTool`
  call, throws `OllamaMcpError`.

## Skills

`SKILL.md` convention (frontmatter: `name`, `description`, optional `allowed-tools`, + a markdown
body), modeled on Claude's Agent Skills.

- `parseFrontmatter(source: string): { frontmatter, body }` - pure, hand-rolled parser for the
  narrow subset needed: flat scalars, plus YAML-style multi-line lists (`key:\n  - a\n  - b`). A
  scalar is never comma-split (a `description` is free text that may contain commas); a
  comma-separated `allowed-tools: a, b` string is instead split by `SkillRegistry.load`.
- `applySkill(skill: Skill, { messages, tools? }): { messages, tools? }` - merges the skill body into
  a leading system message; narrows `tools` via `ToolRegistry.filter(...)` when `allowed-tools` is set.
- `SkillRegistry` - **imported from the `ollama-client-js/skills` subpath**, not the main entry,
  since it's Node-only (`node:fs/promises`):
  - `new SkillRegistry({ directory })`
  - `.list(): Promise<SkillSummary[]>` - frontmatter only (name/description), no bodies read.
  - `.load(name): Promise<Skill>` - full frontmatter + body + `allowedTools`, read on demand. Throws
    `OllamaSkillNotFoundError` / `OllamaSkillInvalidError`.

## Health and failover

- `client.endpointStatus(): EndpointHealth[]` - passive, failure-count-based health for every configured
  endpoint.
- `client.healthCheck(): Promise<EndpointHealthCheckResult[]>` - actively pings every endpoint's
  `/api/version`.

## Raw HTTP fallback

- `client.raw.request(options): Promise<Response>`
- `client.raw.requestJson<T>(options): Promise<T>` - throws a structured error on non-2xx.
- `client.raw.blobExists(digest): Promise<boolean>`
- `client.raw.pushBlob(digest, data): Promise<void>`

## Cancellation

- `client.abort(): void` - aborts every in-flight streamed request across all configured endpoints.

## Error hierarchy

```
OllamaClientError (base: .code, .status?, .request?, .response?, .retryable, .cause)
├─ OllamaNetworkError        (code: 'network_error',      retryable: true by default)
├─ OllamaTimeoutError        (code: 'timeout',             retryable: true by default; .timeoutMs)
├─ OllamaValidationError      (code: 'validation_error',    retryable: false; .issues)
├─ OllamaAuthError             (code: 'auth_error',          retryable: false; HTTP 401/403)
├─ OllamaNotFoundError          (code: 'not_found',           retryable: false; HTTP 404)
├─ OllamaRateLimitError           (code: 'rate_limited',        retryable: true; HTTP 429; .retryAfterMs)
├─ OllamaServerError                (code: 'server_error',        retryable: true; HTTP 5xx)
├─ OllamaUnsupportedFeatureError      (code: 'unsupported_feature', retryable: false)
├─ OllamaAbortError                     (code: 'aborted',             retryable: false)
├─ OllamaGenericClientError               (code: 'client_error',        catch-all for other 4xx)
├─ OllamaUnknownToolError                  (code: 'unknown_tool',         retryable: false; .toolName)
├─ OllamaToolExecutionError                 (code: 'tool_execution_error', retryable: false; .toolName)
├─ OllamaToolValidationError                 (code: 'tool_validation_error', retryable: false; .toolName, .issues)
├─ OllamaAgentMaxIterationsError               (code: 'agent_max_iterations_exceeded', retryable: false; .maxIterations)
├─ OllamaMcpError                               (code: 'mcp_error', retryable: false by default; .mcpMethod, .toolName?)
├─ OllamaSkillNotFoundError                      (code: 'skill_not_found', retryable: false; .skillName)
└─ OllamaSkillInvalidError                        (code: 'skill_invalid', retryable: false; .skillName, .path?)
```

`mapError(error, context?)` is exported for advanced use (e.g. custom transports that want the same error
normalization).
