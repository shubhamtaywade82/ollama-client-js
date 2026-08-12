export interface ParsedFrontmatter {
  readonly frontmatter: Record<string, unknown>;
  readonly body: string;
}

const DELIMITER = '---';

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Hand-rolled parser for the narrow frontmatter subset `SKILL.md` needs: a `---`-delimited block
 * of flat `key: value` scalar pairs, where a value can also be a string array written as a
 * YAML-style list (`key:\n  - a\n  - b`). This is deliberately not a general YAML parser -
 * `SKILL.md` frontmatter doesn't need one, and a real YAML library isn't a declared dependency of
 * this package (only a transitive dev-dependency of tooling), so depending on it here would be
 * relying on an accidental install.
 *
 * Scalar values are never comma-split into arrays here - a `description` is free text that may
 * legitimately contain commas. A single-line, comma-separated list convention (e.g.
 * `allowed-tools: a, b, c`) is instead a concern of the specific field that wants it; see
 * `toStringArray` in `skill-registry.ts`, which accepts both this parser's YAML-list arrays and a
 * plain comma-separated string for `allowed-tools`.
 *
 * If `source` doesn't start with a `---` delimiter line, the whole input is returned as `body`
 * with an empty `frontmatter`.
 */
export function parseFrontmatter(source: string): ParsedFrontmatter {
  const normalized = source.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');

  if (lines[0]?.trim() !== DELIMITER) {
    return { frontmatter: {}, body: normalized };
  }

  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === DELIMITER);
  if (closingIndex === -1) {
    return { frontmatter: {}, body: normalized };
  }

  const frontmatterLines = lines.slice(1, closingIndex);
  const body = lines
    .slice(closingIndex + 1)
    .join('\n')
    .replace(/^\n+/, '');
  const frontmatter: Record<string, unknown> = {};

  let currentKey: string | undefined;
  let currentList: string[] | undefined;

  const flushList = (): void => {
    if (currentKey && currentList) {
      frontmatter[currentKey] = currentList;
    }
    currentKey = undefined;
    currentList = undefined;
  };

  for (const rawLine of frontmatterLines) {
    if (!rawLine.trim()) continue;

    const listItemMatch = /^\s+-\s*(.+)$/.exec(rawLine);
    const listItemValue = listItemMatch?.[1];
    if (listItemValue !== undefined && currentKey) {
      (currentList ??= []).push(unquote(listItemValue.trim()));
      continue;
    }

    flushList();

    const keyValueMatch = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(rawLine);
    const key = keyValueMatch?.[1];
    const rawValue = keyValueMatch?.[2];
    if (!keyValueMatch || key === undefined || rawValue === undefined) continue;
    const value = rawValue.trim();

    if (!value) {
      // The value is expected on following lines as a YAML list.
      currentKey = key;
      currentList = [];
      continue;
    }

    frontmatter[key] = unquote(value);
  }
  flushList();

  return { frontmatter, body };
}
