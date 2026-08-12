/**
 * `ollama-client-js/skills` - a separate subpath export from the package's main entry.
 *
 * `SkillRegistry` reads `SKILL.md` files off disk via `node:fs/promises`, so this subpath is
 * Node-only. The package's main entry (`ollama-client-js`) stays `platform: 'neutral'` and never
 * imports `node:fs`; it re-exports the pure pieces below (`parseFrontmatter`, `applySkill`, and the
 * plain types) on their own, since those work anywhere.
 */
export type { Skill, SkillFrontmatter, SkillSummary } from './types.js';
export { parseFrontmatter } from './frontmatter.js';
export type { ParsedFrontmatter } from './frontmatter.js';
export { applySkill } from './compose.js';
export type { ApplySkillInput, ApplySkillResult } from './compose.js';
export { SkillRegistry } from './skill-registry.js';
export type { SkillRegistryOptions } from './skill-registry.js';
