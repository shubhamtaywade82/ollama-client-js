import { B as SkillSummary, S as Skill } from './frontmatter-DOjLhFLV.js';
export { A as ApplySkillInput, d as ApplySkillResult, P as ParsedFrontmatter, z as SkillFrontmatter, F as applySkill, H as parseFrontmatter } from './frontmatter-DOjLhFLV.js';
import 'ollama';
import 'zod';

interface SkillRegistryOptions {
    /** Directory containing one subdirectory per skill, each holding a `SKILL.md`. */
    readonly directory: string;
}
/**
 * Loads Claude-style Agent Skills: a directory of `<skill-name>/SKILL.md` files, each with YAML
 * frontmatter (`name`, `description`, optional `allowed-tools`) and a markdown body. Follows
 * progressive disclosure: {@link SkillRegistry.list} parses only frontmatter across every skill
 * (cheap - a skill's body is never read by `list`), and {@link SkillRegistry.load} reads and parses
 * one specific skill's full body on demand.
 *
 * Node-only (uses `node:fs/promises`) - exported from the `ollama-client-js/skills` subpath rather
 * than the package's main entry, so the main bundle stays usable from browsers/edge runtimes that
 * never touch the filesystem.
 */
declare class SkillRegistry {
    private readonly directory;
    constructor(options: SkillRegistryOptions);
    private skillDirs;
    private skillPath;
    /** Lists every skill's `name`/`description` without reading each skill's full body. */
    list(): Promise<SkillSummary[]>;
    /** Loads one skill's full frontmatter + body by name. */
    load(name: string): Promise<Skill>;
}

export { Skill, SkillRegistry, type SkillRegistryOptions, SkillSummary };
