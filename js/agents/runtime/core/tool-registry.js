/**
 * ToolRegistry - 工具注册和调用管理
 *
 * 从 BaseAgentLoop 提取的职责：
 * - 工具注册
 * - 工具调用（含 Hook 集成）
 */

import { createPreToolUseHook } from "../hooks/hook-runner.js";
import { makeSecureTimestampedId, normalizeToolResult, toNonEmptyString } from "../../shared/index.js";
import { validateArgs } from "../tools/schema-validator.js";

// Re-export for backward compatibility
export { normalizeToolResult };

/**
 * @typedef {Record<string, any>} AnyRecord
 *
 * @typedef {{ warn?: (...args: any[]) => void, info?: (...args: any[]) => void, error?: (...args: any[]) => void, debug?: (...args: any[]) => void }} LoggerLike
 *
 * @typedef {(eventName: string, record: { actor?: string, status?: string, payload?: any, [key: string]: any }) => void} EmitFn
 *
 * @typedef {{ ok: boolean, data?: any, error?: any, quota?: any, policy?: any, [key: string]: any }} ToolResult
 *
 * @typedef {(
 *   ((params: any, context?: any) => any) &
 *   { schema?: any, paramsSchema?: any, parameters?: any, definition?: any }
 * )} ToolHandler
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
 * @typedef {{ name: string, fn: Function, schema?: any, paramsSchema?: any, parameters?: any, definition?: any }} ToolDefinitionEntry
 * @typedef {Record<string, Function | { fn: Function, schema?: any, paramsSchema?: any, parameters?: any, definition?: any }> | Array<[string, Function, any?] | ToolDefinitionEntry> | Map<string, Function | { fn: Function, schema?: any, paramsSchema?: any, parameters?: any, definition?: any }>} ToolDefinitions
 *
 * @typedef {{ allowed: boolean, reason?: string }} QuotaDecision
 * @typedef {{ tryCall: (name: string) => QuotaDecision, getToolStats?: (name: string) => any, recordCall?: (name: string) => void }} ToolQuotaManagerLike
 *
 * @typedef {{ startSpan: Function, endSpan: Function, withSpan: (name: string, fn: Function, options?: any) => any }} TraceContextLike
 *
 * @typedef {"warn" | "skip" | "fail"} HookFailurePolicy
 * @typedef {"sync" | "background"} ToolPersistMode
 * @typedef {"warn" | "fail"} ToolPersistFailurePolicy
 *
 * @typedef {object} ToolRegistryOptions
 * @property {ToolDefinitions | null} [tools]
 * @property {{ before?: BeforeHook[], after?: AfterHook[] } | null} [hooks]
 * @property {LoggerLike | null} [logger]
 * @property {import('../../core/archive/archive-core.js').Archive | null} [archive]
 * @property {string} [runId]
 * @property {(meta: { prefix: string, timestamp: number }) => string | null | undefined} [runIdFactory]
 * @property {EmitFn | null} [emit] - Injected emit function (falls back to resolveEmit at call time)
 * @property {ToolQuotaManagerLike | null} [quotaManager] - Injected quota manager (falls back to resolveToolQuotaManager at call time)
 * @property {"off" | "warn" | "block"} [quotaMode] - Injected quota mode (falls back to resolveToolQuotaMode at call time)
 * @property {TraceContextLike | null} [traceContext] - Injected trace context (falls back to resolveTraceContext at call time)
 * @property {HookFailurePolicy} [hookFailurePolicy] - Legacy shared hook policy for before/after hooks
 * @property {HookFailurePolicy} [beforeHookFailurePolicy] - Before-hook failure policy (default: "fail")
 * @property {HookFailurePolicy} [afterHookFailurePolicy] - After-hook failure policy (default: "warn")
 * @property {ToolPersistMode} [persistMode] - Tool call history persistence mode (default: "sync")
 * @property {ToolPersistFailurePolicy} [persistFailurePolicy] - Persistence failure policy (default: "warn")
 * @property {number} [persistRetries] - Retry count when persistence fails (default: 1)
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

const BLOCKED_TOOL_NAMES = new Set(["__proto__", "prototype", "constructor"]);

/**
 * @param {string} name
 * @returns {boolean}
 */
function isBlockedToolName(name) {
  return BLOCKED_TOOL_NAMES.has(name);
}

/**
 * @param {string} name
 * @param {any} context
 * @param {ToolRegistry} registry
 * @param {any} tool
 * @returns {any}
 */
function resolveToolSchema(name, context, registry, tool) {
  if (registry?._toolSchemas && registry._toolSchemas[name]) return registry._toolSchemas[name];
  const ctx = context && typeof context === "object" ? context : null;
  const fromContext =
    ctx?.toolSchemas?.[name] ||
    ctx?.toolSchema?.[name] ||
    ctx?.stageApi?.toolSchemas?.[name] ||
    ctx?.stageApi?.toolSchema?.[name] ||
    null;
  if (fromContext) return fromContext;
  const fromTool =
    tool?.schema ||
    tool?.paramsSchema ||
    tool?.parameters ||
    tool?.definition?.parameters ||
    null;
  return fromTool;
}

/**
 * @deprecated Use ToolRegistryOptions.emit instead. Kept as internal fallback.
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
 * @deprecated Use ToolRegistryOptions.quotaManager instead. Kept as internal fallback.
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
 * @deprecated Use ToolRegistryOptions.quotaMode instead. Kept as internal fallback.
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
 * @param {any} traceContext
 * @returns {traceContext is TraceContextLike}
 */
function isTraceContextLike(traceContext) {
  return (
    !!traceContext &&
    typeof traceContext === "object" &&
    typeof traceContext.startSpan === "function" &&
    typeof traceContext.endSpan === "function" &&
    typeof traceContext.withSpan === "function"
  );
}

/**
 * @param {any} value
 * @returns {value is ToolResult}
 */
function isToolResult(value) {
  return !!value && typeof value === "object" && typeof value.ok === "boolean";
}

/**
 * @param {unknown} value
 * @param {HookFailurePolicy} fallback
 * @returns {HookFailurePolicy}
 */
function normalizeHookFailurePolicy(value, fallback) {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "warn" || raw === "skip" || raw === "fail") return raw;
  return fallback;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function normalizePositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const normalized = Math.floor(n);
  return normalized >= 0 ? normalized : fallback;
}

/**
 * @param {ToolRegistryOptions} options
 * @returns {string}
 */
function resolveRunId(options) {
  const provided = toNonEmptyString(options?.runId);
  if (provided) return provided;

  if (typeof options?.runIdFactory === "function") {
    try {
      const custom = toNonEmptyString(
        options.runIdFactory({ prefix: "run", timestamp: Date.now() })
      );
      if (custom) return custom;
    } catch {
      // ignore and fall back
    }
  }

  return makeSecureTimestampedId("run", { allowInsecureFallback: true });
}

/**
 * @deprecated Use ToolRegistryOptions.traceContext instead. Kept as internal fallback.
 */
function resolveTraceContext(context) {
  const direct = context?.traceContext;
  if (isTraceContextLike(direct)) {
    return direct;
  }
  const fromStageApi = context?.stageApi?.traceContext;
  if (isTraceContextLike(fromStageApi)) {
    return fromStageApi;
  }

  const container = context?.container || context?.stageApi?.container;
  if (container && typeof container === "object") {
    const tryGet = typeof container.tryGet === "function" ? container.tryGet.bind(container) : null;
    if (tryGet) {
      const candidate = tryGet("traceContext");
      if (isTraceContextLike(candidate)) return candidate;
    }
    const get = typeof container.get === "function" ? container.get.bind(container) : null;
    if (get) {
      try {
        const candidate = get("traceContext");
        if (isTraceContextLike(candidate)) return candidate;
      } catch {
        // ignore
      }
    }
  }

  return null;
}

export class ToolRegistry {
  /**
   * @param {ToolRegistryOptions} [options]
   */
  constructor(options = {}) {
    this._tools = Object.create(null);
    this._toolSchemas = Object.create(null);
    /** @type {{ before: BeforeHook[], after: AfterHook[] }} */
    this._hooks = { before: [], after: [] };
    this._logger = options.logger || null;

    /** @type {import('../../core/archive/archive-core.js').Archive | null} */
    this._archive = options.archive || null;
    /** @type {string} */
    this._runId = resolveRunId(options);
    /** @type {Promise<void> | null} */
    this._initPromise = null;

    // DI: explicit dependency injection (fall back to resolver functions when null)
    /** @type {EmitFn | null} */
    this._emit = options.emit || null;
    /** @type {ToolQuotaManagerLike | null} */
    this._quotaManager = options.quotaManager || null;
    /** @type {"off" | "warn" | "block"} */
    this._quotaMode = options.quotaMode || "off";
    /** @type {TraceContextLike | null} */
    this._traceContext = options.traceContext || null;
    const sharedHookPolicy = normalizeHookFailurePolicy(options.hookFailurePolicy, "warn");
    /** @type {HookFailurePolicy} */
    this._beforeHookFailurePolicy = normalizeHookFailurePolicy(options.beforeHookFailurePolicy, sharedHookPolicy || "fail");
    /** @type {HookFailurePolicy} */
    this._afterHookFailurePolicy = normalizeHookFailurePolicy(options.afterHookFailurePolicy, sharedHookPolicy || "warn");
    if (!options.beforeHookFailurePolicy && !options.hookFailurePolicy) {
      this._beforeHookFailurePolicy = "fail";
    }
    if (!options.afterHookFailurePolicy && !options.hookFailurePolicy) {
      this._afterHookFailurePolicy = "warn";
    }
    /** @type {ToolPersistMode} */
    this._persistMode = options.persistMode === "background" ? "background" : "sync";
    /** @type {ToolPersistFailurePolicy} */
    this._persistFailurePolicy = options.persistFailurePolicy === "fail" ? "fail" : "warn";
    /** @type {number} */
    this._persistRetries = normalizePositiveInt(options.persistRetries, 1);

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
        if (fn && typeof fn === "object" && typeof fn.fn === "function") {
          this.registerTool(name, fn.fn, fn.schema || fn.paramsSchema || fn.parameters || fn.definition?.parameters);
        } else {
          this.registerTool(name, /** @type {Function} */ (fn));
        }
      }
      return;
    }
    if (Array.isArray(tools)) {
      for (const entry of tools) {
        if (Array.isArray(entry)) {
          const [name, fn, schema] = entry;
          this.registerTool(name, fn, schema);
          continue;
        }
        if (entry && typeof entry === "object") {
          this.registerTool(entry.name, entry.fn, entry.schema || entry.paramsSchema || entry.parameters || entry.definition?.parameters);
          continue;
        }
        throw new TypeError("ToolRegistry.registerTools: tools must be an object, array, or map");
      }
      return;
    }
    if (typeof tools === "object") {
      for (const [name, fn] of Object.entries(tools)) {
        if (fn && typeof fn === "object" && typeof fn.fn === "function") {
          this.registerTool(name, fn.fn, fn.schema || fn.paramsSchema || fn.parameters || fn.definition?.parameters);
        } else {
          this.registerTool(name, /** @type {Function} */ (fn));
        }
      }
      return;
    }
    throw new TypeError("ToolRegistry.registerTools: tools must be an object, array, or map");
  }

  /** @param {string} name @param {Function} fn @param {any} [schema] */
  registerTool(name, fn, schema) {
    if (!name || typeof name !== "string") {
      throw new TypeError("ToolRegistry.registerTool: name must be a non-empty string");
    }
    if (isBlockedToolName(name)) {
      throw new Error(`ToolRegistry.registerTool: disallowed tool name "${name}"`);
    }
    if (typeof fn !== "function") {
      throw new TypeError("ToolRegistry.registerTool: fn must be a function");
    }
    this._tools[name] = fn;
    const handler = /** @type {ToolHandler} */ (fn);
    const resolvedSchema =
      schema ||
      handler.schema ||
      handler.paramsSchema ||
      handler.parameters ||
      handler.definition?.parameters ||
      null;
    if (resolvedSchema && typeof resolvedSchema === "object") {
      this._toolSchemas[name] = resolvedSchema;
    } else if (this._toolSchemas[name]) {
      delete this._toolSchemas[name];
    }
  }

  /** @param {string} name @returns {boolean} */
  hasTool(name) {
    return typeof this._tools[name] === "function";
  }

  /** @returns {string[]} */
  getToolNames() {
    return Object.keys(this._tools);
  }

  /** @param {string} name @returns {Function | undefined} */
  getTool(name) {
    return this.hasTool(name) ? this._tools[name] : undefined;
  }

  /**
   * 初始化：从 Archive 恢复工具调用历史索引
   * @returns {Promise<void>}
   */
  async init() {
    if (this._initPromise) return this._initPromise;
    if (!this._archive) return;

    this._initPromise = (async () => {
      try {
        const checkpoints = await this._archive.list(this._runId);
        this._logger?.debug?.(`[tool-registry] Loaded ${checkpoints.length} tool call history entries from Archive`);
      } catch (err) {
        this._logger?.warn?.(`[tool-registry] Failed to load tool call history from Archive: ${err.message}`);
      }
    })();

    return this._initPromise;
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
    const traceContext = this._traceContext || resolveTraceContext(context);
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
    const beforeResult = await this._runBeforeHooks(name, params, context);
    if (beforeResult?.skip) return normalizeToolResult(beforeResult.value);
    const finalParams = beforeResult?.params || params;

    const tool = this._tools[name];
    const validationError = this._validateSchema(name, finalParams, context, tool);
    if (validationError) {
      return await this._runAfterHooks(name, finalParams, validationError, context);
    }

    const quota = this._checkQuota(name, finalParams, context);
    if (quota.blocked) {
      return await this._runAfterHooks(name, finalParams, quota.result, context);
    }

    let result = await this._executeTool(name, finalParams, context, tool);
    result = await this._runAfterHooks(name, finalParams, result, context);

    if (quota.snapshot && isToolResult(result)) {
      try { result.quota = result.quota || quota.snapshot; } catch { /* non-extensible */ }
    }

    const persistPromise = this._persistToolCall(name, finalParams, result, context);
    if (this._persistMode === "background") {
      void persistPromise;
      return result;
    }

    const persisted = await persistPromise;
    if (!persisted.ok) {
      if (this._persistFailurePolicy === "fail") {
        return {
          ok: false,
          error: `Tool history persistence failed: ${persisted.error}`,
          cause: result,
        };
      }
      if (isToolResult(result)) {
        try {
          result.audit = {
            persisted: false,
            error: persisted.error,
          };
        } catch {
          // ignore mutation failure
        }
      }
    }
    return result;
  }

  /**
   * Run all before-hooks, applying hook failure policy on errors.
   * @private
   * @param {string} name - Tool name
   * @param {any} params - Original params
   * @param {any} context - Call context
   * @returns {Promise<BeforeHookResult | null>} Aggregated hook result or null
   */
  async _runBeforeHooks(name, params, context) {
    let finalParams = params;
    for (const hook of this._hooks.before) {
      try {
        const hookResult = await hook({ tool: name, params: finalParams, context });
        if (hookResult?.skip) return hookResult;
        if (hookResult?.params) finalParams = hookResult.params;
      } catch (e) {
        const abort = this._onHookError("BeforeHook", name, e, this._beforeHookFailurePolicy);
        if (abort) return { skip: true, value: abort };
      }
    }
    return finalParams !== params ? { params: finalParams } : null;
  }

  /**
   * Validate tool params against schema. Returns an error ToolResult or null on success.
   * @private
   * @param {string} name - Tool name
   * @param {any} params - Params to validate
   * @param {any} context - Call context
   * @param {Function | undefined} tool - Resolved tool handler
   * @returns {ToolResult | null} Error result if validation fails, null otherwise
   */
  _validateSchema(name, params, context, tool) {
    const schema = resolveToolSchema(name, context, this, tool);
    if (!schema) return null;

    const emit = this._emit || resolveEmit(context);
    if (!params || typeof params !== "object" || Array.isArray(params)) {
      const errors = ["params: expected object"];
      emit?.("tool:call:error", { tool: name, args: params, errors, reason: "validation_failed" });
      return /** @type {ToolResult} */ ({ ok: false, error: `Invalid tool params for ${name}`, validationErrors: errors });
    }

    const validation = validateArgs(params, schema);
    if (!validation.valid) {
      emit?.("tool:call:error", { tool: name, args: params, errors: validation.errors, reason: "validation_failed" });
      return /** @type {ToolResult} */ ({ ok: false, error: `Invalid tool params for ${name}`, validationErrors: validation.errors });
    }
    return null;
  }

  /**
   * Check tool quota and emit events when exceeded.
   * @private
   * @param {string} name - Tool name
   * @param {any} params - Tool params (unused, kept for consistency)
   * @param {any} context - Call context
   * @returns {{ blocked: boolean, result?: ToolResult, snapshot: QuotaDecision | null }}
   */
  _checkQuota(name, params, context) {
    const quotaManager = this._quotaManager || resolveToolQuotaManager(context);
    const quotaMode = quotaManager
      ? (this._quotaManager ? this._quotaMode : resolveToolQuotaMode(context))
      : "off";

    if (!quotaManager || quotaMode === "off") return { blocked: false, snapshot: null };

    const q = quotaManager.tryCall(name);
    if (q.allowed) return { blocked: false, snapshot: q };

    const stats = typeof quotaManager.getToolStats === "function" ? quotaManager.getToolStats(name) : null;
    const emit = this._emit || resolveEmit(context);
    emit?.("tool:quota:exceeded", { tool: name, reason: q.reason, stats });

    if (quotaMode === "block") {
      /** @type {ToolResult} */
      const result = { ok: false, error: q.reason || `Quota exceeded for ${name}` };
      if (stats) result.quota = stats;
      return { blocked: true, result, snapshot: q };
    }

    // warn-only: keep accounting so callers can observe persistent overuse
    if (typeof quotaManager.recordCall === "function") {
      try { quotaManager.recordCall(name); } catch { /* ignore */ }
    }
    return { blocked: false, snapshot: q };
  }

  /**
   * Execute the tool via external executor or direct invocation.
   * @private
   * @param {string} name - Tool name
   * @param {any} params - Validated params
   * @param {any} context - Call context
   * @param {Function | undefined} tool - Resolved tool handler
   * @returns {Promise<ToolResult>}
   */
  async _executeTool(name, params, context, tool) {
    const executor = resolveToolExecutor(context);
    if (executor) return normalizeToolResult(await executor(name, params, context));
    if (!tool) return { ok: false, error: `Unknown tool: ${name}` };
    try {
      const data = await tool(params, context);
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Run all after-hooks, applying hook failure policy on errors.
   * @private
   * @param {string} name - Tool name
   * @param {any} params - Final params
   * @param {ToolResult} result - Current result (may be mutated by hooks)
   * @param {any} context - Call context
   * @returns {Promise<ToolResult>} Possibly modified result
   */
  async _runAfterHooks(name, params, result, context) {
    let current = result;
    for (const hook of this._hooks.after) {
      try {
        const hookResult = await hook({ tool: name, params, result: current, context });
        if (hookResult !== undefined) current = normalizeToolResult(hookResult);
      } catch (e) {
        const abort = this._onHookError("AfterHook", name, e, this._afterHookFailurePolicy);
        if (abort) return abort;
      }
    }
    return current;
  }

  /**
   * Handle a hook error according to the configured failure policy.
   * @private
   * @param {string} phase - Hook phase label ("BeforeHook" | "AfterHook")
   * @param {string} name - Tool name
   * @param {Error} error - The caught error
   * @param {HookFailurePolicy} policy
   * @returns {ToolResult | null} Error result when policy is 'fail', null otherwise
   */
  _onHookError(phase, name, error, policy) {
    const msg = `[tool-registry] ${phase} failed for ${name}: ${error.message}`;
    if (policy === "fail") {
      this._logger?.error?.(msg);
      return { ok: false, error: `${phase} failed: ${error.message}` };
    }
    if (policy === "warn") {
      this._logger?.warn?.(msg);
    }
    return null;
  }

  /**
   * Persist tool call history to Archive.
   * @private
   * @param {string} name - Tool name
   * @param {any} params - Final params
   * @param {ToolResult} result - Execution result
   * @param {any} context - Call context
   * @returns {Promise<{ ok: true, callId?: string } | { ok: false, error: string, callId?: string }>}
   */
  async _persistToolCall(name, params, result, context) {
    if (!this._archive) return { ok: true };
    const timestamp = Date.now();
    const callId = `${this._runId}:tool:${name}:${timestamp}`;
    const historyEntry = {
      schemaVersion: 1,
      tool: name,
      params,
      result: {
        ok: result.ok,
        error: result.error,
        data: result.ok ? (typeof result.data === "string" ? result.data.slice(0, 1000) : "[data]") : undefined,
      },
      timestamp,
      metadata: {
        runId: this._runId,
        actor: context?.actor || context?.agentId || "unknown",
      },
    };

    /** @type {any} */
    let lastError = null;
    const maxAttempts = this._persistRetries + 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await this._archive.save(callId, historyEntry);
        return { ok: true, callId };
      } catch (err) {
        lastError = err;
        if (attempt < maxAttempts) {
          await Promise.resolve();
        }
      }
    }

    const message = lastError instanceof Error ? lastError.message : String(lastError || "unknown error");
    this._logger?.warn?.(`[tool-registry] Failed to persist tool call history: ${message}`);
    const emit = this._emit || resolveEmit(context);
    emit?.("tool:persist:error", {
      tool: name,
      runId: this._runId,
      callId,
      error: message,
      attempts: maxAttempts,
    });
    return { ok: false, error: message, callId };
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
        // Policy 检查失败时默认拒绝（fail-close），确保安全
        this._logger?.error?.(`[tool-registry] PolicyManager.check failed: ${err.message}`);
        return {
          skip: true,
          value: { ok: false, error: `Policy check failed: ${err.message}` },
        };
      }
    });

    return this;
  }
}

export default ToolRegistry;
