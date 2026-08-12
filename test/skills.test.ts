import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseFrontmatter } from '../src/skills/frontmatter.js';
import { applySkill } from '../src/skills/compose.js';
import { SkillRegistry } from '../src/skills/skill-registry.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { defineTool } from '../src/tools/define-tool.js';
import { OllamaSkillInvalidError, OllamaSkillNotFoundError } from '../src/errors.js';

describe('parseFrontmatter', () => {
  it('keeps a single-line value as a plain string, even when it contains commas', () => {
    // A `description` is free text and may legitimately contain commas - parseFrontmatter must
    // not misread it as a list. Only the explicit YAML-list form (see below) produces an array.
    const source = [
      '---',
      'name: my-skill',
      'description: Does a thing, carefully, and well.',
      'allowed-tools: a',
      '---',
      'Body text.',
    ].join('\n');
    const { frontmatter, body } = parseFrontmatter(source);
    expect(frontmatter).toEqual({
      name: 'my-skill',
      description: 'Does a thing, carefully, and well.',
      'allowed-tools': 'a',
    });
    expect(body).toBe('Body text.');
  });

  it('parses a YAML-style list value across multiple lines', () => {
    const source = [
      '---',
      'name: my-skill',
      'description: Does a thing',
      'allowed-tools:',
      '  - a',
      '  - b',
      '---',
      'Body text.',
    ].join('\n');
    const { frontmatter } = parseFrontmatter(source);
    expect(frontmatter['allowed-tools']).toEqual(['a', 'b']);
  });

  it('returns the whole input as body when there is no frontmatter delimiter', () => {
    const { frontmatter, body } = parseFrontmatter('Just a plain markdown file.');
    expect(frontmatter).toEqual({});
    expect(body).toBe('Just a plain markdown file.');
  });
});

describe('SkillRegistry', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'ollama-client-js-skills-'));

    await mkdir(path.join(dir, 'greeter'), { recursive: true });
    await writeFile(
      path.join(dir, 'greeter', 'SKILL.md'),
      [
        '---',
        'name: greeter',
        'description: Greets people warmly.',
        'allowed-tools: say_hello, wave_hello',
        '---',
        'Always greet the user by name.',
      ].join('\n'),
    );

    await mkdir(path.join(dir, 'broken'), { recursive: true });
    await writeFile(
      path.join(dir, 'broken', 'SKILL.md'),
      ['---', 'description: Missing a name.', '---', 'Body.'].join('\n'),
    );
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('list() propagates OllamaSkillInvalidError when any discovered SKILL.md is malformed', async () => {
    const registry = new SkillRegistry({ directory: dir });
    await expect(registry.list()).rejects.toBeInstanceOf(OllamaSkillInvalidError);
  });

  it('list() returns summaries when only valid skills are present', async () => {
    const validOnlyDir = await mkdtemp(path.join(tmpdir(), 'ollama-client-js-skills-valid-'));
    await mkdir(path.join(validOnlyDir, 'greeter'), { recursive: true });
    await writeFile(
      path.join(validOnlyDir, 'greeter', 'SKILL.md'),
      ['---', 'name: greeter', 'description: Greets people warmly.', '---', 'Body.'].join('\n'),
    );
    const registry = new SkillRegistry({ directory: validOnlyDir });
    const summaries = await registry.list();
    expect(summaries).toEqual([
      {
        name: 'greeter',
        description: 'Greets people warmly.',
        path: path.join(validOnlyDir, 'greeter', 'SKILL.md'),
      },
    ]);
    await rm(validOnlyDir, { recursive: true, force: true });
  });

  it('load() returns the full skill, parsing a comma-separated allowed-tools string into an array', async () => {
    const registry = new SkillRegistry({ directory: dir });
    const skill = await registry.load('greeter');
    expect(skill.name).toBe('greeter');
    expect(skill.body).toBe('Always greet the user by name.');
    expect(skill.allowedTools).toEqual(['say_hello', 'wave_hello']);
  });

  it('load() throws OllamaSkillNotFoundError for a missing skill', async () => {
    const registry = new SkillRegistry({ directory: dir });
    await expect(registry.load('does-not-exist')).rejects.toBeInstanceOf(OllamaSkillNotFoundError);
  });

  it('load() throws OllamaSkillInvalidError for malformed frontmatter', async () => {
    const registry = new SkillRegistry({ directory: dir });
    await expect(registry.load('broken')).rejects.toBeInstanceOf(OllamaSkillInvalidError);
  });
});

describe('applySkill', () => {
  it('prepends the skill body as a new leading system message', () => {
    const skill = {
      name: 'greeter',
      description: 'Greets people warmly.',
      path: '/tmp/greeter/SKILL.md',
      frontmatter: { name: 'greeter', description: 'Greets people warmly.' },
      body: 'Always greet the user by name.',
    };
    const { messages } = applySkill(skill, {
      messages: [{ role: 'user', content: 'Hi' }],
    });
    expect(messages[0]).toEqual({ role: 'system', content: 'Always greet the user by name.' });
    expect(messages[1]).toEqual({ role: 'user', content: 'Hi' });
  });

  it('merges into an existing leading system message', () => {
    const skill = {
      name: 'greeter',
      description: 'Greets people warmly.',
      path: '/tmp/greeter/SKILL.md',
      frontmatter: { name: 'greeter', description: 'Greets people warmly.' },
      body: 'Always greet the user by name.',
    };
    const { messages } = applySkill(skill, {
      messages: [
        { role: 'system', content: 'Be concise.' },
        { role: 'user', content: 'Hi' },
      ],
    });
    expect(messages[0]?.content).toBe('Always greet the user by name.\n\nBe concise.');
  });

  it('filters tools to allowedTools when set', () => {
    const sayHello = defineTool({
      name: 'say_hello',
      description: 'Says hello.',
      parameters: z.object({}),
      handler: () => 'hi',
    });
    const otherTool = defineTool({
      name: 'other',
      description: 'Does something else.',
      parameters: z.object({}),
      handler: () => 'other',
    });
    const skill = {
      name: 'greeter',
      description: 'Greets people warmly.',
      path: '/tmp/greeter/SKILL.md',
      frontmatter: { name: 'greeter', description: 'Greets people warmly.' },
      body: 'Always greet the user by name.',
      allowedTools: ['say_hello'],
    };
    const { tools } = applySkill(skill, {
      messages: [{ role: 'user', content: 'Hi' }],
      tools: new ToolRegistry([sayHello, otherTool]),
    });
    expect(tools?.has('say_hello')).toBe(true);
    expect(tools?.has('other')).toBe(false);
  });
});
