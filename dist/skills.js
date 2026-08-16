import { readdir, readFile } from 'fs/promises';
import path from 'path';

// src/skills/frontmatter.ts
var DELIMITER = "---";
function unquote(value) {
  if (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return value;
}
function parseFrontmatter(source) {
  const normalized = source.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines[0]?.trim() !== DELIMITER) {
    return { frontmatter: {}, body: normalized };
  }
  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === DELIMITER);
  if (closingIndex === -1) {
    return { frontmatter: {}, body: normalized };
  }
  const frontmatterLines = lines.slice(1, closingIndex);
  const body = lines.slice(closingIndex + 1).join("\n").replace(/^\n+/, "");
  const frontmatter = {};
  let currentKey;
  let currentList;
  const flushList = () => {
    if (currentKey && currentList) {
      frontmatter[currentKey] = currentList;
    }
    currentKey = void 0;
    currentList = void 0;
  };
  for (const rawLine of frontmatterLines) {
    if (!rawLine.trim()) continue;
    const listItemMatch = /^\s+-\s*(.+)$/.exec(rawLine);
    const listItemValue = listItemMatch?.[1];
    if (listItemValue !== void 0 && currentKey) {
      (currentList ??= []).push(unquote(listItemValue.trim()));
      continue;
    }
    flushList();
    const keyValueMatch = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(rawLine);
    const key = keyValueMatch?.[1];
    const rawValue = keyValueMatch?.[2];
    if (!keyValueMatch || key === void 0 || rawValue === void 0) continue;
    const value = rawValue.trim();
    if (!value) {
      currentKey = key;
      currentList = [];
      continue;
    }
    frontmatter[key] = unquote(value);
  }
  flushList();
  return { frontmatter, body };
}

// src/skills/compose.ts
function applySkill(skill, input) {
  const [first, ...rest] = input.messages;
  const messages = first?.role === "system" ? [{ ...first, content: `${skill.body}

${first.content}` }, ...rest] : [{ role: "system", content: skill.body }, ...input.messages];
  const tools = skill.allowedTools && input.tools ? input.tools.filter(skill.allowedTools) : input.tools;
  return { messages, tools };
}

// src/errors.ts
var OllamaClientError = class extends Error {
  /** Machine-readable error code, stable across minor versions. */
  code;
  /** HTTP status code, when the error originated from an HTTP response. */
  status;
  /** Context describing the request that failed, with secrets stripped. */
  request;
  /** Context describing the response that caused the error, when available. */
  response;
  /** Whether the operation that produced this error is safe to retry. */
  retryable;
  constructor(message, options) {
    super(message, { cause: options.cause });
    this.name = this.constructor.name;
    this.code = options.code;
    this.status = options.status;
    this.request = options.request;
    this.response = options.response;
    this.retryable = options.retryable ?? false;
    Error.captureStackTrace?.(this, this.constructor);
  }
};
var OllamaSkillNotFoundError = class extends OllamaClientError {
  skillName;
  constructor(message, options) {
    super(message, { ...options, code: "skill_not_found", retryable: false });
    this.skillName = options.skillName;
  }
};
var OllamaSkillInvalidError = class extends OllamaClientError {
  skillName;
  path;
  constructor(message, options) {
    super(message, { ...options, code: "skill_invalid", retryable: false });
    this.skillName = options.skillName;
    this.path = options.path;
  }
};

// src/skills/skill-registry.ts
var SKILL_FILE = "SKILL.md";
function toStringArray(value) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    return value.split(",").map((part) => part.trim()).filter(Boolean);
  }
  return void 0;
}
function validateFrontmatter(frontmatter, skillName, filePath) {
  const { name, description } = frontmatter;
  if (typeof name !== "string" || !name.trim()) {
    throw new OllamaSkillInvalidError(
      `SKILL.md for "${skillName}" is missing a valid "name" field in its frontmatter.`,
      { skillName, path: filePath }
    );
  }
  if (typeof description !== "string" || !description.trim()) {
    throw new OllamaSkillInvalidError(
      `SKILL.md for "${skillName}" is missing a valid "description" field in its frontmatter.`,
      { skillName, path: filePath }
    );
  }
  return frontmatter;
}
var SkillRegistry = class {
  directory;
  constructor(options) {
    this.directory = options.directory;
  }
  async skillDirs() {
    const entries = await readdir(this.directory, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  }
  skillPath(name) {
    return path.join(this.directory, name, SKILL_FILE);
  }
  /** Lists every skill's `name`/`description` without reading each skill's full body. */
  async list() {
    const dirs = await this.skillDirs();
    const summaries = [];
    for (const dir of dirs) {
      const filePath = this.skillPath(dir);
      let source;
      try {
        source = await readFile(filePath, "utf8");
      } catch {
        continue;
      }
      const { frontmatter } = parseFrontmatter(source);
      const validated = validateFrontmatter(frontmatter, dir, filePath);
      summaries.push({ name: validated.name, description: validated.description, path: filePath });
    }
    return summaries;
  }
  /** Loads one skill's full frontmatter + body by name. */
  async load(name) {
    const filePath = this.skillPath(name);
    let source;
    try {
      source = await readFile(filePath, "utf8");
    } catch (cause) {
      throw new OllamaSkillNotFoundError(`No SKILL.md found for skill "${name}".`, {
        skillName: name,
        cause
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
      allowedTools: toStringArray(validated["allowed-tools"])
    };
  }
};

export { SkillRegistry, applySkill, parseFrontmatter };
//# sourceMappingURL=skills.js.map
//# sourceMappingURL=skills.js.map