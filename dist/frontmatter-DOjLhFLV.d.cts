import { ToolCall, Message, Tool } from 'ollama';
import { z } from 'zod';

/**
 * Structured error hierarchy for ollama-client-js.
 *
 * Every error thrown by this library (as opposed to errors thrown by user
 * callbacks) is an instance of {@link OllamaClientError}. Callers can rely on
 * `error.code` for programmatic branching and on the specific subclass for
 * `instanceof` checks.
 */
/** Machine-readable error codes. Stable across minor versions. */
type OllamaErrorCode = 'network_error' | 'timeout' | 'validation_error' | 'auth_error' | 'not_found' | 'rate_limited' | 'server_error' | 'unsupported_feature' | 'client_error' | 'aborted' | 'unknown_tool' | 'tool_execution_error' | 'tool_validation_error' | 'agent_max_iterations_exceeded' | 'mcp_error' | 'skill_not_found' | 'skill_invalid';
/** Minimal, non-sensitive information about the request that failed. */
interface OllamaErrorRequestContext {
    readonly method?: string;
    readonly url?: string;
    readonly endpoint?: string;
    readonly model?: string;
    readonly stream?: boolean;
}
/** Minimal, non-sensitive information about the response that caused the error. */
interface OllamaErrorResponseContext {
    readonly status?: number;
    readonly statusText?: string;
    readonly body?: unknown;
    readonly headers?: Record<string, string>;
}
interface OllamaClientErrorOptions {
    readonly code: OllamaErrorCode;
    readonly status?: number;
    readonly request?: OllamaErrorRequestContext;
    readonly response?: OllamaErrorResponseContext;
    readonly cause?: unknown;
    readonly retryable?: boolean;
}
/**
 * Base class for every error raised by ollama-client-js.
 */
declare class OllamaClientError extends Error {
    /** Machine-readable error code, stable across minor versions. */
    readonly code: OllamaErrorCode;
    /** HTTP status code, when the error originated from an HTTP response. */
    readonly status?: number;
    /** Context describing the request that failed, with secrets stripped. */
    readonly request?: OllamaErrorRequestContext;
    /** Context describing the response that caused the error, when available. */
    readonly response?: OllamaErrorResponseContext;
    /** Whether the operation that produced this error is safe to retry. */
    readonly retryable: boolean;
    constructor(message: string, options: OllamaClientErrorOptions);
}
declare class OllamaNetworkError extends OllamaClientError {
    constructor(message: string, options?: Omit<OllamaClientErrorOptions, 'code'>);
}
declare class OllamaTimeoutError extends OllamaClientError {
    readonly timeoutMs?: number;
    constructor(message: string, options?: Omit<OllamaClientErrorOptions, 'code'> & {
        timeoutMs?: number;
    });
}
declare class OllamaValidationError extends OllamaClientError {
    /** The underlying validation issues (e.g. a ZodError), when available. */
    readonly issues?: unknown;
    constructor(message: string, options?: Omit<OllamaClientErrorOptions, 'code'> & {
        issues?: unknown;
    });
}
declare class OllamaAuthError extends OllamaClientError {
    constructor(message: string, options?: Omit<OllamaClientErrorOptions, 'code'>);
}
declare class OllamaNotFoundError extends OllamaClientError {
    constructor(message: string, options?: Omit<OllamaClientErrorOptions, 'code'>);
}
declare class OllamaRateLimitError extends OllamaClientError {
    /** Milliseconds to wait before retrying, when the server provided a `Retry-After` header. */
    readonly retryAfterMs?: number;
    constructor(message: string, options?: Omit<OllamaClientErrorOptions, 'code'> & {
        retryAfterMs?: number;
    });
}
declare class OllamaServerError extends OllamaClientError {
    constructor(message: string, options?: Omit<OllamaClientErrorOptions, 'code'>);
}
declare class OllamaUnsupportedFeatureError extends OllamaClientError {
    constructor(message: string, options?: Omit<OllamaClientErrorOptions, 'code'>);
}
/** Raised when a request is aborted via `AbortSignal`, distinct from a timeout. */
declare class OllamaAbortError extends OllamaClientError {
    constructor(message?: string, options?: Omit<OllamaClientErrorOptions, 'code'>);
}
/** Catch-all for client-side errors that don't fit a more specific category. */
declare class OllamaGenericClientError extends OllamaClientError {
    constructor(message: string, options?: Omit<OllamaClientErrorOptions, 'code'>);
}
/** Raised when a model requests a tool name that isn't registered in the active `ToolRegistry`. */
declare class OllamaUnknownToolError extends OllamaClientError {
    readonly toolName: string;
    constructor(message: string, options: Omit<OllamaClientErrorOptions, 'code'> & {
        toolName: string;
    });
}
/** Raised when a registered tool's handler throws while executing a model's tool call. */
declare class OllamaToolExecutionError extends OllamaClientError {
    readonly toolName: string;
    constructor(message: string, options: Omit<OllamaClientErrorOptions, 'code'> & {
        toolName: string;
    });
}
/** Raised when a tool call's arguments don't match the tool's declared (Zod) parameter schema. */
declare class OllamaToolValidationError extends OllamaClientError {
    readonly toolName: string;
    /** The underlying validation issues (e.g. a ZodError's `.issues`), when available. */
    readonly issues?: unknown;
    constructor(message: string, options: Omit<OllamaClientErrorOptions, 'code'> & {
        toolName: string;
        issues?: unknown;
    });
}
/** Raised by {@link Agent} when a run doesn't converge to a tool-call-free message within `maxIterations`. */
declare class OllamaAgentMaxIterationsError extends OllamaClientError {
    readonly maxIterations: number;
    constructor(message: string, options: Omit<OllamaClientErrorOptions, 'code'> & {
        maxIterations: number;
    });
}
/** Raised when an MCP-shaped client's `listTools`/`callTool` call fails or reports `isError: true`. */
declare class OllamaMcpError extends OllamaClientError {
    readonly mcpMethod: 'listTools' | 'callTool';
    readonly toolName?: string;
    constructor(message: string, options: Omit<OllamaClientErrorOptions, 'code'> & {
        mcpMethod: 'listTools' | 'callTool';
        toolName?: string;
    });
}
/** Raised when {@link SkillRegistry.load} is asked for a skill name that doesn't exist. */
declare class OllamaSkillNotFoundError extends OllamaClientError {
    readonly skillName: string;
    constructor(message: string, options: Omit<OllamaClientErrorOptions, 'code'> & {
        skillName: string;
    });
}
/** Raised when a `SKILL.md` file is missing required frontmatter (`name`/`description`) or is otherwise malformed. */
declare class OllamaSkillInvalidError extends OllamaClientError {
    readonly skillName: string;
    readonly path?: string;
    constructor(message: string, options: Omit<OllamaClientErrorOptions, 'code'> & {
        skillName: string;
        path?: string;
    });
}
/**
 * Normalizes any error thrown by the transport layer, the upstream `ollama`
 * package, or user middleware into an {@link OllamaClientError} subclass.
 * Already-normalized errors are returned unchanged.
 */
declare function mapError(error: unknown, context?: {
    request?: OllamaErrorRequestContext;
    response?: OllamaErrorResponseContext;
}): OllamaClientError;

/**
 * A tool's parameter schema: either a Zod schema (validated client-side before the handler runs,
 * and converted to JSON Schema for the wire) or a raw JSON Schema object passed through unchanged
 * (used for tools sourced from MCP, which only ever hand back plain JSON Schema).
 */
type ToolParameters = z.ZodType | Record<string, unknown>;
/** Resolves the argument type a handler receives for a given {@link ToolParameters}. */
type InferToolArgs<TParameters extends ToolParameters> = TParameters extends z.ZodType ? z.infer<TParameters> : Record<string, unknown>;
interface ToolExecutionContext {
    /** The raw tool call this handler is responding to. */
    readonly toolCall: ToolCall;
    readonly signal?: AbortSignal;
}
type ToolHandler<TArgs = any> = (args: TArgs, ctx: ToolExecutionContext) => unknown;
/**
 * `TArgs` defaults to `any` rather than `unknown` on purpose: `ToolDefinition`s with different
 * concrete argument types (e.g. from separate {@link defineTool} calls) need to live together in a
 * single `ToolDefinition[]`/`ToolRegistry`, and `unknown` would make that invariant-generic
 * assignment fail (a handler typed for `{ city: string }` args is not a handler for `unknown`
 * args). `any` is the standard escape hatch for this "heterogeneous collection of a generic type"
 * shape; it doesn't weaken `defineTool`'s own inference, which still resolves to a precise
 * `ToolDefinition<z.infer<TSchema>>` at the call site.
 */
interface ToolDefinition<TArgs = any> {
    readonly name: string;
    readonly description: string;
    readonly parameters: ToolParameters;
    readonly handler: ToolHandler<TArgs>;
}
interface ToolExecutionResult {
    readonly name: string;
    readonly ok: boolean;
    /** The handler's return value, when `ok` is `true`. */
    readonly result?: unknown;
    /** The structured error, when `ok` is `false`. */
    readonly error?: OllamaClientError;
    /** The `role: 'tool'` message to append to the conversation, either way. */
    readonly message: Message;
}

interface ToolRegistryOptions {
    /**
     * How to handle an unregistered tool name, an argument-validation failure, or a handler
     * throwing. `'result'` (default) wraps the failure as a structured error and still returns a
     * `role: 'tool'` result message so an agent loop can feed it back to the model and keep going -
     * a single bad or hallucinated tool call shouldn't crash a multi-turn loop. `'throw'` rejects
     * immediately instead, for callers that want fail-fast behavior.
     */
    readonly onError?: 'result' | 'throw';
}
/**
 * Registers tool definitions and executes a model's `tool_calls` against them, producing the
 * `role: 'tool'` result messages Ollama expects appended back onto the conversation.
 *
 * Ollama's `ToolCall` carries no call ID (unlike OpenAI/Anthropic tool-call blocks) - there is no
 * protocol-level way to correlate a result to a specific request beyond call order. Calls are
 * therefore executed sequentially, in the order the model requested them, and results are
 * returned in that same order; if a model requests the same tool name more than once in a single
 * turn, correlating which result answers which call is positional only.
 */
declare class ToolRegistry {
    private readonly tools;
    private readonly onError;
    constructor(tools?: readonly ToolDefinition[], options?: ToolRegistryOptions);
    register(tool: ToolDefinition): void;
    unregister(name: string): void;
    has(name: string): boolean;
    list(): readonly ToolDefinition[];
    /** The `tools` array to send on a `chat` request. */
    toOllamaTools(): Tool[];
    /** Returns a new registry containing only the named tools (used by Skills' `allowed-tools`). */
    filter(names: readonly string[]): ToolRegistry;
    private executeOne;
    /**
     * Executes tool calls sequentially, in request order (see class doc for why - there is no call
     * ID to parallelize safely against). With the default `onError: 'result'`, a failing call
     * produces an `ok: false` result whose `message` is still returned so the loop can continue;
     * with `onError: 'throw'`, the first failure rejects immediately and no further calls run.
     */
    executeToolCalls(toolCalls: readonly ToolCall[], ctx?: {
        signal?: AbortSignal;
    }): Promise<ToolExecutionResult[]>;
    /** Executes a single tool call. Honors `onError` the same way {@link executeToolCalls} does. */
    executeToolCall(toolCall: ToolCall, ctx?: {
        signal?: AbortSignal;
    }): Promise<ToolExecutionResult>;
}

interface SkillFrontmatter {
    readonly name: string;
    readonly description: string;
    readonly 'allowed-tools'?: readonly string[];
    readonly [key: string]: unknown;
}
interface SkillSummary {
    readonly name: string;
    readonly description: string;
    readonly path: string;
}
interface Skill extends SkillSummary {
    readonly frontmatter: SkillFrontmatter;
    readonly body: string;
    readonly allowedTools?: readonly string[];
}

interface ApplySkillInput {
    readonly messages: Message[];
    readonly tools?: ToolRegistry;
}
interface ApplySkillResult {
    readonly messages: Message[];
    readonly tools?: ToolRegistry;
}
/**
 * Composes a loaded {@link Skill} into a chat/agent call: the skill's body is merged into a leading
 * system message (prepended to an existing one when `messages[0]` is already `role: 'system'`,
 * inserted as a new leading message otherwise), and, when the skill declares `allowed-tools`,
 * `tools` is narrowed via `ToolRegistry.filter(...)` to just those names.
 */
declare function applySkill(skill: Skill, input: ApplySkillInput): ApplySkillResult;

interface ParsedFrontmatter {
    readonly frontmatter: Record<string, unknown>;
    readonly body: string;
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
declare function parseFrontmatter(source: string): ParsedFrontmatter;

export { type ApplySkillInput as A, type SkillSummary as B, type ToolExecutionContext as C, type ToolParameters as D, type ToolRegistryOptions as E, applySkill as F, mapError as G, parseFrontmatter as H, type InferToolArgs as I, OllamaClientError as O, type ParsedFrontmatter as P, type Skill as S, type ToolHandler as T, type ToolDefinition as a, ToolRegistry as b, type ToolExecutionResult as c, type ApplySkillResult as d, OllamaAbortError as e, OllamaAgentMaxIterationsError as f, OllamaAuthError as g, type OllamaClientErrorOptions as h, type OllamaErrorCode as i, type OllamaErrorRequestContext as j, type OllamaErrorResponseContext as k, OllamaGenericClientError as l, OllamaMcpError as m, OllamaNetworkError as n, OllamaNotFoundError as o, OllamaRateLimitError as p, OllamaServerError as q, OllamaSkillInvalidError as r, OllamaSkillNotFoundError as s, OllamaTimeoutError as t, OllamaToolExecutionError as u, OllamaToolValidationError as v, OllamaUnknownToolError as w, OllamaUnsupportedFeatureError as x, OllamaValidationError as y, type SkillFrontmatter as z };
