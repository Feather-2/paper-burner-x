import { ToolRegistry } from "./tool-registry.js";

/**
 * @typedef {{ ok: boolean, data?: any, error?: any, [key: string]: any }} ToolResult
 */

/**
 * @param {any} loop
 * @param {{ tools?: any, hooks?: any, logger?: any }} [options]
 * @returns {ToolDispatch}
 */
function ensureToolDispatch(loop, options = {}) {
  if (!loop || typeof loop !== "object") {
    throw new Error("ToolDispatch requires a loop instance");
  }
  if (loop._toolDispatch instanceof ToolDispatch) return loop._toolDispatch;
  const component = new ToolDispatch(loop, { ...options, reuseExistingRegistry: true });
  loop._toolDispatch = component;
  return component;
}

/**
 * @param {(loop: any) => ToolDispatch} ensureComponent
 * @param {PropertyDescriptorMap} descriptors
 * @returns {PropertyDescriptorMap}
 */
function createDelegatedDescriptors(ensureComponent, descriptors) {
  /** @type {PropertyDescriptorMap} */
  const delegated = {};
  for (const [name, descriptor] of Object.entries(descriptors)) {
    if (name === "constructor") continue;
    /** @type {PropertyDescriptor} */
    const next = {
      configurable: true,
      enumerable: descriptor.enumerable ?? false,
    };
    if (typeof descriptor.get === "function") {
      next.get = function delegatedGetter() {
        const component = ensureComponent(this);
        return descriptor.get.call(component);
      };
    }
    if (typeof descriptor.set === "function") {
      next.set = function delegatedSetter(value) {
        const component = ensureComponent(this);
        descriptor.set.call(component, value);
      };
    }
    if (typeof descriptor.value === "function") {
      next.writable = true;
      next.value = function delegatedMethod(...args) {
        const component = ensureComponent(this);
        return descriptor.value.apply(component, args);
      };
    }
    delegated[name] = next;
  }
  return delegated;
}

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

/**
 * @deprecated Use `new ToolDispatch(loop, options)` instead.
 * @param {any} loop
 * @param {{ tools?: any, hooks?: any, logger?: any }} [options]
 * @returns {ToolDispatch}
 */
export function initToolDispatch(loop, options = {}) {
  const component = new ToolDispatch(loop, options);
  loop._toolDispatch = component;
  return component;
}

/**
 * @deprecated BaseAgentLoop now delegates explicitly; this exists for legacy callers.
 * @param {new (...args: any[]) => any} BaseAgentLoop
 */
export function attachToolDispatch(BaseAgentLoop) {
  const descriptors = createDelegatedDescriptors(
    (loop) => ensureToolDispatch(loop),
    Object.getOwnPropertyDescriptors(ToolDispatch.prototype)
  );
  Object.defineProperties(BaseAgentLoop.prototype, descriptors);
}

export { normalizeToolResult, resolveToolExecutor } from "./tool-registry.js";
