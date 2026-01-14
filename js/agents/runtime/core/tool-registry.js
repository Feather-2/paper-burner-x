/**
 * ToolRegistry - 工具注册和调用管理
 *
 * 从 BaseAgentLoop 提取的职责：
 * - 工具注册
 * - 工具调用（含 Hook 集成）
 */

import { createPreToolUseHook } from "../hooks/hook-runner.js";
import { normalizeToolResult } from "../../shared/contracts/index.js";

// Re-export for backward compatibility
export { normalizeToolResult };

/**
 * @typedef {Record<string, any>} AnyRecord
 *
 * @typedef {{ warn?: (...args: any[]) => void, info?: (...args: any[]) => void, error?: (...args: any[]) => void, debug?: (...args: any[]) => void }} LoggerLike
 *
 * @typedef {(eventName: string, record: { actor?: string, status?: string, payload?: any }) => void} EmitFn
 *
 * @typedef {{ ok: boolean, data?: any, error?: any, quota?: any, policy?: any, [key: string]: any }} ToolResult
 *
 * @typedef {(name: string, params: any, context?: any) => any | Promise<any>} ToolExecutor
 * @typedef {{ execute: (name: string, params: any, context?: any) => any | Promise<any> }} ToolExecutorContainer
 *
 * @typedef {{ tool: string, params: any, context: any }} HookBeforeContext
 * @typedef {{ tool: string, params: any, result: ToolResult, context: any }} HookAfterContext
 *
 * @typedef {{ skip?: boolean, value?: any, params?: any }} BeforeHookResult
 *
 * @typedef {(ctx: HookBeforeContext) => (BeforeHookResult | undefined | null | Promise<BeforeHookResult | undefined | null>)} BeforeHook
 * @typedef {(ctx: HookAfterContext) => (any | undefined | Promise<any | undefined>)} AfterHook
 *
 * @typedef {Record<string, Function> | Array<[string, Function]> | Map<string, Function>} ToolDefinitions
 *
 * @typedef {{ allowed: boolean, reason?: string }} QuotaDecision
 * @typedef {{ tryCall: (name: string) => QuotaDecision, getToolStats?: (name: string) => any, recordCall?: (name: string) => void }} ToolQuotaManagerLike
 *
 * @typedef {{ startSpan: Function, endSpan: Function, withSpan: (name: string, fn: Function, options?: any) => any }} TraceContextLike
 *
 * @typedef {object} ToolRegistryOptions
 * @property {ToolDefinitions | null} [tools]
 * @property {{ before?: BeforeHook[], after?: AfterHook[] } | null} [hooks]
 * @property {LoggerLike | null} [logger]
 */

/**
 * @param {any} context
 * @returns {ToolExecutor | null}
 */
export function resolveToolExecutor(context) {
  const executor = context?.toolExecutor || context?.tools;
  if (typeof executor === "function") return executor;
  if (executor && typeof executor.execute === "function") return (name, params, ctx) => executor.execute(name, params, ctx);
  return null;
}

/**
 * @param {any} context
 * @returns {EmitFn | null}
 */
function resolveEmit(context) {
  const ctx = context && typeof context === "object" ? context : null;
  if (typeof ctx?.emit === "function") return ctx.emit;

  const bus = ctx?.eventBus;
  if (bus && typeof bus.emit === "function") return bus.emit.bind(bus);

  const stageApi = ctx?.stageApi;
  if (stageApi && typeof stageApi.emit === "function") return stageApi.emit.bind(stageApi);
  if (stageApi?.eventBus && typeof stageApi.eventBus.emit === "function") return stageApi.eventBus.emit.bind(stageApi.eventBus);

  return null;
}

/**
 * @param {any} context
 * @returns {ToolQuotaManagerLike | null}
 */
function resolveToolQuotaManager(context) {
  const ctx = context && typeof context === "object" ? context : null;
  const direct = ctx?.toolQuotaManager;
  if (direct && typeof direct.tryCall === "function") return direct;

  const fromStageApi = ctx?.stageApi?.toolQuotaManager;
  if (fromStageApi && typeof fromStageApi.tryCall === "function") return fromStageApi;

  const container = ctx?.container || ctx?.stageApi?.container;
  if (container && typeof container === "object") {
    const tryGet = typeof container.tryGet === "function" ? container.tryGet.bind(container) : null;
    if (tryGet) {
      const candidate = tryGet("toolQuotaManager");
      if (candidate && typeof candidate.tryCall === "function") return candidate;
    }
    const get = typeof container.get === "function" ? container.get.bind(container) : null;
    if (get) {
      try {
        const candidate = get("toolQuotaManager");
        if (candidate && typeof candidate.tryCall === "function") return candidate;
      } catch {
        // ignore
      }
    }
  }

  return null;
}

/**
 * @param {any} context
 * @returns {"off" | "warn" | "block"}
 */
function resolveToolQuotaMode(context) {
  const ctx = context && typeof context === "object" ? context : null;
  const cfg =
    ctx?.toolQuotaConfig ||
    ctx?.toolQuotas ||
    ctx?.stageApi?.toolQuotas ||
    ctx?.stageApi?.toolQuotaConfig ||
    null;

  if (cfg === false || cfg?.enabled === false) return "off";

  const rawMode = typeof cfg?.mode === "string" ? cfg.mode.trim().toLowerCase() : "";
  if (rawMode === "off" || rawMode === "disabled") return "off";
  if (rawMode === "block" || rawMode === "enforce") return "block";
  if (rawMode === "warn" || rawMode === "warning") return "warn";

  if (cfg?.enforce === true || cfg?.block === true) return "block";
  if (cfg?.warnOnly === true) return "warn";

  // Default: warn when a quota manager is present.
  return "warn";
}

/**
 * @param {any} context
 * @returns {TraceContextLike | null}
 */
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
  /**
   * @param {ToolRegistryOptions} [options]
   */
  constructor(options = {}) {
    this._tools = {};
    /** @type {{ before: BeforeHook[], after: AfterHook[] }} */
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

    // Claude/Codex-style PreToolUse hooks (registered on EventBus) as a built-in before-hook.
    // No-op unless the provided context includes an enhanced EventBus with registered hooks.
    this._hooks.before.unshift(createPreToolUseHook());
  }

  /** @param {ToolDefinitions | null | undefined} tools */
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

  /** @param {string} name @param {Function} fn */
  registerTool(name, fn) {
    if (!name || typeof name !== "string") {
      throw new TypeError("ToolRegistry.registerTool: name must be a non-empty string");
    }
    if (typeof fn !== "function") {
      throw new TypeError("ToolRegistry.registerTool: fn must be a function");
    }
    this._tools[name] = fn;
  }

  /** @param {string} name @returns {boolean} */
  hasTool(name) {
    return typeof this._tools[name] === "function";
  }

  /** @returns {string[]} */
  getToolNames() {
    return Object.keys(this._tools);
  }

  /**
   * 注册 Hook
   * @param {"before"|"after"} phase
   * @param {BeforeHook | AfterHook} fn
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
   * @param {string} name
   * @param {any} params
   * @param {any} context
   * @returns {Promise<ToolResult>}
   */
  async callTool(name, params, context) {
    const traceContext = resolveTraceContext(context);
    if (!traceContext) {
      return await this._callTool(name, params, context);
    }

    return await traceContext.withSpan(
      `tool.${name}`,
      async (span) => {
        span.setAttribute("tool.name", name);
        const result = await this._callTool(name, params, context);
        if (result && typeof result === "object" && result.ok === false) {
          span.setStatus("error", typeof result.error === "string" ? result.error : "tool returned ok:false");
        }
        return result;
      },
      { attributes: { tool: name } }
    );
  }

  /**
   * Internal tool call implementation (hooks + quotas + execution).
   * @private
   * @param {string} name
   * @param {any} params
   * @param {any} context
   * @returns {Promise<ToolResult>}
   */
  async _callTool(name, params, context) {
    let finalParams = params;

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

    const quotaManager = resolveToolQuotaManager(context);
    const quotaMode = quotaManager ? resolveToolQuotaMode(context) : "off";

    let quotaSnapshot = null;
    if (quotaManager && quotaMode !== "off") {
      const q = quotaManager.tryCall(name);
      quotaSnapshot = q;
      if (!q.allowed) {
        const stats = typeof quotaManager.getToolStats === "function" ? quotaManager.getToolStats(name) : null;
        const emit = resolveEmit(context);
        emit?.("tool.quota.exceeded", {
          actor: "system",
          status: "exceeded",
          payload: { tool: name, reason: q.reason, stats },
        });

        if (quotaMode === "block") {
          // Block execution, but still allow after-hooks to inspect the result.
          let result = /** @type {ToolResult} */ ({ ok: false, error: q.reason || `Quota exceeded for ${name}` });
          if (stats) result.quota = stats;
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
        }

        // warn-only: keep going, but keep accounting so callers can observe persistent overuse.
        if (typeof quotaManager.recordCall === "function") {
          try {
            quotaManager.recordCall(name);
          } catch {
            // ignore
          }
        }
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

    // Attach quota diagnostics (best-effort)
    if (quotaSnapshot && typeof result === "object" && result) {
      try {
        result.quota = result.quota || quotaSnapshot;
      } catch {
        // ignore non-extensible results
      }
    }

    return result;
  }

  /**
   * P7.1: 集成 PolicyManager 作为 before hook
   *
   * PolicyManager.check() 决定是否允许工具调用：
   * - "allow" -> 继续执行
   * - "deny" -> 阻止并返回错误
   * - "prompt" -> 等待用户确认（交互模式）
   *
   * @param {{ check?: (req: AnyRecord) => Promise<AnyRecord> }} policyManager - PolicyManager 实例
   * @returns {ToolRegistry}
   */
  usePolicyManager(policyManager) {
    if (!policyManager || typeof policyManager.check !== "function") {
      return this;
    }

    this.useHook("before", async ({ tool, params, context }) => {
      try {
        const request = {
          type: "tool_call",
          tool,
          resource: params?.url || params?.path || params?.query || null,
          args: params,
        };

        const decision = await policyManager.check(request);

        if (decision?.effect === "deny") {
          return {
            skip: true,
            value: {
              ok: false,
              error: decision.reason || `Policy denied: ${tool}`,
              policy: { effect: "deny", ruleId: decision.ruleId },
            },
          };
        }

        // "allow" or "prompt" (已通过用户确认) -> 继续执行
        return null;
      } catch (err) {
        // Policy 检查失败时默认允许（fail-open），避免阻塞正常流程
        this._logger?.warn?.(`[tool-registry] PolicyManager.check failed: ${err.message}`);
        return null;
      }
    });

    return this;
  }
}

export default ToolRegistry;
