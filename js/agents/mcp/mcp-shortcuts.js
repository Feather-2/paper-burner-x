/**
 * MCP SDK shortcuts
 *
 * These helpers provide common higher-level operations built on top of the core
 * MCP protocol client (`McpClient.callTool`). They intentionally live outside
 * the protocol client to keep it minimal.
 */

/**
 * @typedef {object} McpClientLike
 * @property {(toolName: string, args?: any, options?: any) => Promise<any>} callTool
 */

function assertClient(client) {
  if (!client || typeof client.callTool !== "function") {
    throw new TypeError("mcpShortcuts: client must be an object with callTool(toolName, args, options)");
  }
}

/**
 * Convenience: search
 * Standard schema: search.query({query, domain?, time_range?, limit?, filters?}) -> results[]
 * @param {McpClientLike} client
 * @param {{ query?: string, domain?: string, timeRange?: string, limit?: number, filters?: any }=} args
 * @param {{ providerId?: string }=} options
 * @returns {Promise<import("./mcp-client.js").McpToolResult|null>}
 */
export async function mcpSearch(client, { query, domain, timeRange, limit = 10, filters } = {}, { providerId } = {}) {
  assertClient(client);

  const args = { query, domain, time_range: timeRange, limit, filters };

  // Prefer standard tool names; fall back to legacy aliases for local-mcp.
  const preferred = ["search.query", "search"];
  let last = null;
  for (const name of preferred) {
    const r = await client.callTool(name, args, { providerId });
    last = r;
    if (r && r.success) return r;
  }
  return last;
}

/**
 * Convenience: fetch content from a URL
 * Standard schema: search.fetch({url}) -> {content, extracted_text, metadata, attachments}
 * @param {McpClientLike} client
 * @param {{ url?: string }=} args
 * @param {{ providerId?: string }=} options
 * @returns {Promise<import("./mcp-client.js").McpToolResult|null>}
 */
export async function mcpFetch(client, { url } = {}, { providerId } = {}) {
  assertClient(client);

  const args = { url };
  const preferred = ["search.fetch", "fetch_content", "fetch"];
  let last = null;
  for (const name of preferred) {
    const r = await client.callTool(name, args, { providerId });
    last = r;
    if (r && r.success) return r;
  }
  return last;
}
