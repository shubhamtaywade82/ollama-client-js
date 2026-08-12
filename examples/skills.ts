/**
 * Skills: load a `SKILL.md`-defined skill and compose it into a chat request via `applySkill` -
 * the skill's body becomes a leading system message, and its `allowed-tools` narrows the active
 * `ToolRegistry` to just those names.
 *
 * `SkillRegistry` is Node-only (reads files off disk), so it comes from the separate
 * `ollama-client-js/skills` subpath rather than the package's main entry.
 *
 * Run against a local Ollama server:
 *   npx tsx examples/skills.ts
 */
import { z } from 'zod';
import { applySkill, defineTool, OllamaClient, ToolRegistry } from '../src/index.js';
import { SkillRegistry } from '../src/skills/index.js';

const client = new OllamaClient({
  baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
});

const readFile = defineTool({
  name: 'read_file',
  description: 'Reads a file by path.',
  parameters: z.object({ path: z.string() }),
  handler: ({ path }) => `contents of ${path}`,
});

const searchCode = defineTool({
  name: 'search_code',
  description: 'Searches the codebase for a pattern.',
  parameters: z.object({ pattern: z.string() }),
  handler: ({ pattern }) => [`match for "${pattern}" in src/example.ts:12`],
});

const unrelatedTool = defineTool({
  name: 'send_email',
  description: 'Sends an email (unrelated to code review).',
  parameters: z.object({ to: z.string(), body: z.string() }),
  handler: () => 'sent',
});

async function main(): Promise<void> {
  const skills = new SkillRegistry({
    directory: new URL('./skills-fixtures', import.meta.url).pathname,
  });

  console.log('Available skills:', await skills.list());

  const skill = await skills.load('code-reviewer');
  const allTools = new ToolRegistry([readFile, searchCode, unrelatedTool]);

  const { messages, tools } = applySkill(skill, {
    messages: [{ role: 'user', content: 'Review this diff: `-if (x = 1) {` -> `+if (x === 1) {`' }],
    tools: allTools,
  });

  console.log(
    'Tools available for this call (should exclude send_email):',
    tools?.list().map((t) => t.name),
  );

  const response = await client.chat({
    model: 'llama3.2',
    messages,
    tools: tools?.toOllamaTools(),
  });
  console.log('\nReview:', response.message.content);
}

main().catch((error: unknown) => {
  console.error('Skills example failed:', error);
  process.exitCode = 1;
});
