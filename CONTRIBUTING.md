# Contributing to ollama-client-js

## Setup

```bash
git clone https://github.com/shubhamtaywade82/ollama-client-js.git
cd ollama-client-js
npm install
```

## Workflow

```bash
npm run typecheck   # tsc --noEmit
npm run lint         # eslint
npm run format:check   # prettier --check
npm test                # vitest run
npm run build             # tsup -> dist/
npm run verify              # typecheck + lint + test + build, in that order
```

Run `npm run verify` before opening a pull request - it's the same set of checks CI runs.

## Project layout

```
src/
  client.ts            Public OllamaClient
  config.ts              OllamaClientConfig
  errors.ts                Structured error hierarchy
  logger.ts                  Logging / lifecycle hooks
  middleware.ts                 Middleware pipeline
  adapter/                        All interaction with the upstream `ollama` package
  transport/                        Enhanced fetch (retries/timeouts/auth), raw HTTP fallback
  streaming/                          Normalized stream events
  capabilities/                         Capability discovery
  providers/                              Multi-endpoint registry + health checks
  schema/                                   Zod <-> JSON Schema helpers
test/                                        Vitest suite, mirrors `src/`
examples/                                       Runnable usage examples (`npx tsx examples/*.ts`)
docs/                                             API reference, migration guide
```

## Ground rules

- **Keep the upstream boundary intact.** Only `src/adapter/ollama-adapter.ts` imports from the `ollama`
  package. If you need a new upstream field or method, add it there, not scattered across the client.
- **Don't invent Ollama APIs.** If the server doesn't document an endpoint or field, don't add it - use
  the raw HTTP fallback (`client.raw`) instead, and note the limitation.
- **Every public export needs TSDoc and a test.** No placeholders, no `TODO` stubs in code that ships.
- **Strict TypeScript.** No new `any` in public APIs; prefer a real type or a narrow, justified assertion
  with a comment explaining why it's safe.
- **Errors are structured.** Anything the client throws should be an `OllamaClientError` subclass -
  extend the hierarchy in `src/errors.ts` rather than throwing bare `Error`s from new code paths.
- **Tests must be deterministic.** Use the mocked-fetch test utilities in `test/test-utils/` - the main
  suite must not depend on a live Ollama server.

## Commit messages

Keep them focused on _why_, not a restatement of the diff. Conventional prefixes (`fix:`, `feat:`,
`docs:`, `refactor:`, `test:`) are welcome but not required.

## Releasing

This repo uses [Changesets](https://github.com/changesets/changesets):

```bash
npm run changeset       # describe your change and bump type (patch/minor/major)
```

Commit the generated `.changeset/*.md` file alongside your change. Maintainers run `npm run release`
(build + `changeset publish`) to cut releases; `CHANGELOG.md` is generated from changesets.
