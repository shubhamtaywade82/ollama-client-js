export interface McpToolDescriptor {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: Record<string, unknown>;
}

export interface McpListToolsResult {
  readonly tools: readonly McpToolDescriptor[];
}

export interface McpContentBlock {
  readonly type: string;
  readonly text?: string;
  readonly [key: string]: unknown;
}

export interface McpCallToolResult {
  readonly content: readonly McpContentBlock[];
  readonly isError?: boolean;
}

/**
 * Structural shape of `@modelcontextprotocol/sdk`'s `Client` methods this library needs. Defined
 * here rather than imported so this package has no dependency on the MCP SDK - any object with
 * this shape (including a real `Client` instance) can be passed to {@link loadMcpTools}.
 */
export interface McpClientLike {
  listTools(): Promise<McpListToolsResult>;
  callTool(params: {
    name: string;
    arguments: Record<string, unknown>;
  }): Promise<McpCallToolResult>;
}
