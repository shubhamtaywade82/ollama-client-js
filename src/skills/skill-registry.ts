import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { OllamaSkillInvalidError, OllamaSkillNotFoundError } from '../errors.js';
import { parseFrontmatter } from './frontmatter.js';
import type { Skill, SkillFrontmatter, SkillSummary } from './types.js';

export interface SkillRegistryOptions {
  /** Directory containing one subdirectory per skill, each holding a `SKILL.md`. */
  readonly directory: string;
}

const SKILL_FILE = 'SKILL.md';

function toStringArray(value: unknown): readonly string[] | undefined {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return undefined;
}

function validateFrontmatter(
  frontmatter: Record<string, unknown>,
  skillName: string,
  filePath: string,
): SkillFrontmatter {
  const { name, description } = frontmatter;
  if (typeof name !== 'string' || !name.trim()) {
    throw new OllamaSkillInvalidError(
      `SKILL.md for "${skillName}" is missing a valid "name" field in its frontmatter.`,
      { skillName, path: filePath },
    );
  }
  if (typeof description !== 'string' || !description.trim()) {
    throw new OllamaSkillInvalidError(
      `SKILL.md for "${skillName}" is missing a valid "description" field in its frontmatter.`,
      { skillName, path: filePath },
    );
  }
  return frontmatter as SkillFrontmatter;
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
export class SkillRegistry {
  private readonly directory: string;

  constructor(options: SkillRegistryOptions) {
    this.directory = options.directory;
  }

  private async skillDirs(): Promise<string[]> {
    const entries = await readdir(this.directory, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  }

  private skillPath(name: string): string {
    return path.join(this.directory, name, SKILL_FILE);
  }

  /** Lists every skill's `name`/`description` without reading each skill's full body. */
  async list(): Promise<SkillSummary[]> {
    const dirs = await this.skillDirs();
    const summaries: SkillSummary[] = [];
    for (const dir of dirs) {
      const filePath = this.skillPath(dir);
      let source: string;
      try {
        source = await readFile(filePath, 'utf8');
      } catch {
        continue; // Not every directory entry need be a skill.
      }
      const { frontmatter } = parseFrontmatter(source);
      const validated = validateFrontmatter(frontmatter, dir, filePath);
      summaries.push({ name: validated.name, description: validated.description, path: filePath });
    }
    return summaries;
  }

  /** Loads one skill's full frontmatter + body by name. */
  async load(name: string): Promise<Skill> {
    const filePath = this.skillPath(name);
    let source: string;
    try {
      source = await readFile(filePath, 'utf8');
    } catch (cause) {
      throw new OllamaSkillNotFoundError(`No SKILL.md found for skill "${name}".`, {
        skillName: name,
        cause,
      });
    }
    const { frontmatter, body } = parseFrontmatter(source);
    const validated = validateFrontmatter(frontmatter, name, filePath);
    return {
      name: validated.name,
      description: validated.description,
      path: filePath,
      frontmatter: validated,
      body: body.trim(),
      allowedTools: toStringArray(validated['allowed-tools']),
    };
  }
}
