# Changelog

All notable changes to this project are documented in this file. Releases are managed with
[Changesets](https://github.com/changesets/changesets); this file is generated/updated automatically as
changesets are published (`npm run release`). Until the first release, changes are tracked here manually.

## Unreleased

### Added

- Initial release: `OllamaClient` wrapping `ollama-js` with retries, timeouts, middleware, structured
  errors, normalized streaming (async-iterator and event-based), Zod structured-output helpers,
  capability discovery, multi-endpoint failover, and a raw HTTP fallback escape hatch.
