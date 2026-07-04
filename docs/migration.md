# Migrating from `ollama-js`

`ollama-client-js` wraps `ollama-js`; migrating is mostly a rename plus a few shape changes.

## Client construction

```diff
- import { Ollama } from 'ollama';
- const ollama = new Ollama({ host: 'http://localhost:11434' });
+ import { OllamaClient } from 'ollama-client-js';
+ const client = new OllamaClient({ baseUrl: 'http://localhost:11434' });
```

`host` is renamed `baseUrl` to avoid ambiguity with the `Host` HTTP header.

## Chat / generate

Request and response shapes are unchanged - `client.chat(...)` and `client.generate(...)` accept the same
fields as `ollama.chat(...)`/`ollama.generate(...)`. Two additions:

- Optional `signal`/`timeoutMs` fields for cancellation and per-call timeouts (stripped before the
  request is sent, never forwarded to the server).
- A dedicated `client.chatStream(...)` / `client.generateStream(...)` convenience method, equivalent to
  passing `stream: true`.

```diff
- const response = await ollama.chat({ model: 'llama3.2', messages });
+ const response = await client.chat({ model: 'llama3.2', messages });
```

## Streaming

`ollama-js` returns an `AbortableAsyncIterator` yielding raw `ChatResponse`/`GenerateResponse` chunks.
`ollama-client-js` normalizes this into an `OllamaStream` of typed events (`token`, `thinking`,
`tool_call`, `message`, `done`, `error`), while still supporting `.abort()`:

```diff
- const stream = await ollama.chat({ model: 'llama3.2', messages, stream: true });
- for await (const chunk of stream) {
-   process.stdout.write(chunk.message.content);
- }
+ const stream = await client.chatStream({ model: 'llama3.2', messages });
+ for await (const event of stream) {
+   if (event.type === 'token') process.stdout.write(event.data.delta);
+ }
```

If you need the raw chunk, every event carries it: `'message'` events expose it as `event.data.chunk`.

## Model management

Method names change to reduce ambiguity with generic verbs:

| `ollama-js`          | `ollama-client-js`                        |
| -------------------- | ----------------------------------------- |
| `ollama.list()`      | `client.listModels()` / `client.models()` |
| `ollama.show(req)`   | `client.showModel(req)`                   |
| `ollama.pull(req)`   | `client.pullModel(req)`                   |
| `ollama.push(req)`   | `client.pushModel(req)`                   |
| `ollama.create(req)` | `client.createModel(req)`                 |
| `ollama.delete(req)` | `client.deleteModel(req)`                 |
| `ollama.copy(req)`   | `client.copyModel(req)`                   |
| `ollama.ps()`        | `client.ps()`                             |
| `ollama.version()`   | `client.version()`                        |

## Errors

`ollama-js` throws a single internal `ResponseError` (with `.message`/`.status_code`) for any non-2xx
response, and a bare `TypeError`/`AbortError` for network failures and cancellation. `ollama-client-js`
normalizes all of these into a typed hierarchy rooted at `OllamaClientError`, so you can branch with
`instanceof` instead of inspecting `.status_code`:

```diff
- try {
-   await ollama.show({ model: 'missing' });
- } catch (error) {
-   if (error.status_code === 404) { ... }
- }
+ import { OllamaNotFoundError } from 'ollama-client-js';
+ try {
+   await client.showModel({ model: 'missing' });
+ } catch (error) {
+   if (error instanceof OllamaNotFoundError) { ... }
+ }
```

## What stays the same

- Request/response field names and types for chat/generate/embed - no relearning the wire format.
- `ollama-js` is still the thing actually talking to the Ollama server; `ollama-client-js` does not
  reimplement or fork its request-building logic.
- You can still drop to `ollama-js` types directly if needed - they're re-exported from
  `ollama-client-js` for convenience (`ChatRequest`, `Message`, `Tool`, etc.).
