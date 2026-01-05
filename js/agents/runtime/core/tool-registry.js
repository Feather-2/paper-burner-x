/**
 * ToolRegistry - 工具注册和调用管理
 *
 * 从 BaseAgentLoop 提取的职责：
 * - 工具注册
 * - 工具调用（含 Hook 集成）
 */

export function normalizeToolResult(result) {
  if (result && typeof result === "object" && Object.prototype.hasOwnProperty.call(result, "ok")) {
    return result;
  }
  if (result && typeof result === "object" && ("error" in result || "data" in result)) {
    return { ok: !result.error, data: result.data, error: result.error };
  }
  return { ok: true, data: result };
}

export function resolveToolExecutor(context) {
  const executor = context?.toolExecutor || context?.tools;
  if (typeof executor === "function") return executor;
  if (executor && typeof executor.execute === "function") return (name, params) => executor.execute(name, params);
  return null;
}

function resolveTraceContext(context) {
  const direct = context?.traceContext;
  if (
    direct &&
    typeof direct === "object" &&
    typeof direct.startSpan === "function" &&
    typeof direct.endSpan === "function" &&
    typeof direct.withSpan === "function"
  ) {
    return direct;
  }
  const fromStageApi = context?.stageApi?.traceContext;
  if (
    fromStageApi &&
    typeof fromStageApi === "object" &&
    typeof fromStageApi.startSpan === "function" &&
    typeof fromStageApi.endSpan === "function" &&
    typeof fromStageApi.withSpan === "function"
  ) {
    return fromStageApi;
  }
  return null;
}

export class ToolRegistry {
  constructor(options = {}) {
    this._tools = {};
    this._hooks = { before: [], after: [] };
    this._logger = options.logger || null;

    if (options.tools) {
      this.registerTools(options.tools);
    }
    if (options.hooks) {
      if (Array.isArray(options.hooks.before)) {
        this._hooks.before = [...options.hooks.before];
      }
      if (Array.isArray(options.hooks.after)) {
        this._hooks.after = [...options.hooks.after];
      }
    }
  }

  registerTools(tools) {
    if (!tools) return;
    if (tools instanceof Map) {
      for (const [name, fn] of tools.entries()) {
        this.registerTool(name, fn);
      }
      return;
    }
    if (Array.isArray(tools)) {
      for (const [name, fn] of tools) {
        this.registerTool(name, fn);
      }
      return;
    }
    if (typeof tools === "object") {
      for (const [name, fn] of Object.entries(tools)) {
        this.registerTool(name, fn);
      }
      return;
    }
    throw new TypeError("ToolRegistry.registerTools: tools must be an object, array, or map");
  }

  registerTool(name, fn) {
    if (!name || typeof name !== "string") {
      throw new TypeError("ToolRegistry.registerTool: name must be a non-empty string");
    }
    if (typeof fn !== "function") {
      throw new TypeError("ToolRegistry.registerTool: fn must be a function");
    }
    this._tools[name] = fn;
  }

  hasTool(name) {
    return typeof this._tools[name] === "function";
  }

  getToolNames() {
    return Object.keys(this._tools);
  }

  /**
   * 注册 Hook
   * @param {"before"|"after"} phase
   * @param {Function} fn
   * @returns {ToolRegistry}
   */
  useHook(phase, fn) {
    if (phase !== "before" && phase !== "after") {
      throw new Error(`Invalid hook phase: ${phase}`);
    }
    if (typeof fn !== "function") {
      throw new Error("Hook must be a function");
    }
    this._hooks[phase].push(fn);
    return this;
  }

  /**
   * 调用工具（含 Hook）
   */
  async callTool(name, params, context) {
    let finalParams = params;

    const doCall = async () => {
      // Before hooks
      for (const hook of this._hooks.before) {
        try {
          const hookResult = await hook({ tool: name, params: finalParams, context });
          if (hookResult?.skip) {
            return normalizeToolResult(hookResult.value);
          }
          if (hookResult?.params) {
            finalParams = hookResult.params;
          }
        } catch (e) {
          this._logger?.warn?.(`[tool-registry] BeforeHook failed for ${name}: ${e.message}`);
        }
      }

      // Execute tool
      const executor = resolveToolExecutor(context);
      let result;
      if (executor) {
        result = normalizeToolResult(await executor(name, finalParams, context));
      } else {
        const tool = this._tools[name];
        if (!tool) {
          result = { ok: false, error: `Unknown tool: ${name}` };
        } else {
          try {
            const data = await tool(finalParams, context);
            result = { ok: true, data };
          } catch (err) {
            result = { ok: false, error: err instanceof Error ? err.message : String(err) };
          }
        }
      }

      // After hooks
      for (const hook of this._hooks.after) {
        try {
          const hookResult = await hook({ tool: name, params: finalParams, result, context });
          if (hookResult !== undefined) {
            result = normalizeToolResult(hookResult);
          }
        } catch (e) {
          this._logger?.warn?.(`[tool-registry] AfterHook failed for ${name}: ${e.message}`);
        }
      }

      return result;
    };

    const traceContext = resolveTraceContext(context);
    if (!traceContext) {
      return await doCall();
    }

    return await traceContext.withSpan(
      `tool.${name}`,
      async (span) => {
        span.setAttribute("tool.name", name);
        const result = await doCall();
        if (result && typeof result === "object" && result.ok === false) {
          span.setStatus("error", typeof result.error === "string" ? result.error : "tool returned ok:false");
        }
        return result;
      },
      { attributes: { tool: name } }
    );
  }
}

export default ToolRegistry;
