import { ToolRegistry } from "./tool-registry.js";

/**
 * @typedef {{ ok: boolean, data?: any, error?: any, [key: string]: any }} ToolResult
 */

export class ToolDispatch {
  /**
   * @param {any} loop
   * @param {{ tools?: any, hooks?: any, logger?: any, reuseExistingRegistry?: boolean }} [options]
   */
  constructor(loop, { tools, hooks, logger, reuseExistingRegistry = false } = {}) {
    this._loop = loop;
    const hasExplicitConfig = tools !== undefined || hooks !== undefined || logger !== undefined;
    const shouldReuse =
      reuseExistingRegistry &&
      !hasExplicitConfig &&
      this._loop._toolRegistry &&
      typeof this._loop._toolRegistry === "object";

    if (!shouldReuse) {
      this._loop._toolRegistry = new ToolRegistry({
        tools,
        hooks,
        logger,
      });
    }

    this._loop._tools = this._loop._toolRegistry?._tools;
    this._loop._hooks = this._loop._toolRegistry?._hooks;
  }

  /** @param {any} tools */
  registerTools(tools) {
    return this._loop._toolRegistry.registerTools(tools);
  }

  /** @param {string} name @param {Function} fn */
  registerTool(name, fn) {
    return this._loop._toolRegistry.registerTool(name, fn);
  }

  /** @param {"before"|"after"} phase @param {(ctx: any) => any} fn @returns {any} */
  useHook(phase, fn) {
    this._loop._toolRegistry.useHook(phase, fn);
    return this._loop;
  }

  /** @param {string} name @param {any} params @param {any} context @returns {Promise<ToolResult>} */
  async _callTool(name, params, context) {
    return this._loop._toolRegistry.callTool(name, params, context);
  }
}

export { normalizeToolResult, resolveToolExecutor } from "./tool-registry.js";
