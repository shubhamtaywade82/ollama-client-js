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
└─ OllamaGenericClientError               (code: 'client_error',        catch-all for other 4xx)
```

`mapError(error, context?)` is exported for advanced use (e.g. custom transports that want the same error
normalization).
