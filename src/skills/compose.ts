import type { Message } from 'ollama';
import type { ToolRegistry } from '../tools/registry.js';
import type { Skill } from './types.js';

export interface ApplySkillInput {
  readonly messages: Message[];
  readonly tools?: ToolRegistry;
}

export interface ApplySkillResult {
  readonly messages: Message[];
  readonly tools?: ToolRegistry;
}

/**
 * Composes a loaded {@link Skill} into a chat/agent call: the skill's body is merged into a leading
 * system message (prepended to an existing one when `messages[0]` is already `role: 'system'`,
 * inserted as a new leading message otherwise), and, when the skill declares `allowed-tools`,
 * `tools` is narrowed via `ToolRegistry.filter(...)` to just those names.
 */
export function applySkill(skill: Skill, input: ApplySkillInput): ApplySkillResult {
  const [first, ...rest] = input.messages;
  const messages: Message[] =
    first?.role === 'system'
      ? [{ ...first, content: `${skill.body}\n\n${first.content}` }, ...rest]
      : [{ role: 'system', content: skill.body }, ...input.messages];

  const tools =
    skill.allowedTools && input.tools ? input.tools.filter(skill.allowedTools) : input.tools;

  return { messages, tools };
}
