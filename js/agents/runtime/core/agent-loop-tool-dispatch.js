import { ToolRegistry } from "./tool-registry.js";

/**
 * @typedef {{ ok: boolean, data?: any, error?: any, [key: string]: any }} ToolResult
 */

/**
 * @param {any} loop
 * @param {object} options
 * @param {any} [options.tools]
 * @param {any} [options.hooks]
 * @param {any} [options.logger]
 */
export function initToolDispatch(loop, { tools, hooks, logger } = {}) {
  loop._toolRegistry = new ToolRegistry({
    tools,
    hooks,
    logger,
  });

  loop._tools = loop._toolRegistry._tools;
  loop._hooks = loop._toolRegistry._hooks;
}

class AgentLoopToolDispatch {
  /** @type {ToolRegistry} */
  _toolRegistry;

  /** @param {any} tools */
  registerTools(tools) {
    return this._toolRegistry.registerTools(tools);
  }

  /** @param {string} name @param {Function} fn */
  registerTool(name, fn) {
    return this._toolRegistry.registerTool(name, fn);
  }

  /** @param {"before"|"after"} phase @param {(ctx: any) => any} fn @returns {this} */
  useHook(phase, fn) {
    this._toolRegistry.useHook(phase, fn);
    return this;
  }

  /** @param {string} name @param {any} params @param {any} context @returns {Promise<ToolResult>} */
  async _callTool(name, params, context) {
    return this._toolRegistry.callTool(name, params, context);
  }
}

/** @param {new (...args: any[]) => any} BaseAgentLoop */
export function attachToolDispatch(BaseAgentLoop) {
  const descriptors = Object.getOwnPropertyDescriptors(AgentLoopToolDispatch.prototype);
  delete descriptors.constructor;
  Object.defineProperties(BaseAgentLoop.prototype, descriptors);
}

export { normalizeToolResult, resolveToolExecutor } from "./tool-registry.js";
