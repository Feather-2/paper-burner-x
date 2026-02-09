/**
 * ToolExecutor - 统一工具执行器
 *
 * 提供统一的工具执行抽象层:
 * - 统一的日志记录
 * - 超时保护
 * - 重试机制
 * - 标准化结果格式
 * - Pre-execution Schema 验证
 *
 * 所有 Agent 应通过此类执行工具，而非直接调用 handler。
 */

import { validateArgs } from "./schema-validator.js";

import { isPlainObject, toPositiveInt } from "../../shared/index.js";
import { isNodeLike } from "../../shared/index.js";
import { createPreToolUseHook } from "../hooks/hook-runner.js";
import {
  normalizeIsolationMode,
  resolveAndValidateWorkerModuleUrl,
} from "./tool-executor-helpers.js";

/**
 * @typedef {Record<string, unknown>} AnyRecord
 *
 * @typedef {{ ok: boolean, success: boolean, data: unknown, error?: unknown, raw?: unknown, [key: string]: unknown }} ToolResult
 *
 * @typedef {{ createWorker?: () => unknown | Promise<unknown>, maxWorkers?: number }} WorkerPoolOptions
 *
 * @typedef {number & { unref?: () => void }} TimeoutHandle
 */

class WorkerPool {
  constructor(/** @type {WorkerPoolOptions} */ { createWorker, maxWorkers = 2 } = {}) {
    if (typeof createWorker !== "function") throw new TypeError("WorkerPool: createWorker must be a function");
    this._createWorker = createWorker;
    this._maxWorkers = toPositiveInt(maxWorkers, 2);
    this._all = new Set(); // Set<PooledWorker>
    this._idle = []; // Array<PooledWorker>
    this._waiters = []; // Array<{resolve,reject}>
    this._pendingCreates = 0;
  }

  setMaxWorkers(value) {
    const n = toPositiveInt(value, null);
    if (n === null) return this._maxWorkers;
    this._maxWorkers = Math.max(this._maxWorkers, n);
    return this._maxWorkers;
  }

  /**
   * Acquire a worker from the pool.
   *
   * @param {number} [timeoutMs=30000] - Queue wait timeout when pool is saturated.
   * @returns {Promise<PooledWorker>}
   */
  async acquire(timeoutMs = 30_000) {
    const waitTimeoutMs = toPositiveInt(timeoutMs, 30_000);

    if (this._idle.length) {
      const w = this._idle.pop();
      if (!w || w.destroyed) return this.acquire(waitTimeoutMs);
      w.busy = true;
      w._ref();
      return w;
    }

    if (this._all.size + this._pendingCreates < this._maxWorkers) {
      this._pendingCreates += 1;
      try {
        const w = await this._createWorker();
        const pooled = new PooledWorker(w);
        pooled.busy = true;
        pooled._ref();
        this._all.add(pooled);
        return pooled;
      } catch (err) {
        // Ensure queued acquirers don't hang forever if worker creation fails.
        while (this._waiters.length) {
          const waiter = this._waiters.shift();
          waiter?.reject?.(err);
        }
        throw err;
      } finally {
        this._pendingCreates = Math.max(0, this._pendingCreates - 1);
      }
    }

    return await new Promise((resolve, reject) => {
      /** @type {{ resolve: (value: PooledWorker) => void, reject: (reason?: unknown) => void } | null} */
      let waiter = null;
      const timer = setTimeout(() => {
        if (waiter) {
          const idx = this._waiters.indexOf(waiter);
          if (idx !== -1) this._waiters.splice(idx, 1);
        }
        reject(new Error(`WorkerPool.acquire() timed out after ${waitTimeoutMs}ms`));
      }, waitTimeoutMs);
      waiter = {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      };
      this._waiters.push(waiter);
    });
  }

  release(pooled) {
    const w = pooled instanceof PooledWorker ? pooled : null;
    if (!w || w.destroyed) return;
    w._unref();

    if (this._waiters.length) {
      const waiter = this._waiters.shift();
      w.busy = true;
      w._ref();
      waiter?.resolve?.(w);
      return;
    }

    w.busy = false;
    this._idle.push(w);
  }

  async destroy(pooled) {
    const w = pooled instanceof PooledWorker ? pooled : null;
    if (!w || w.destroyed) return;
    w.destroyed = true;
    w.busy = false;
    this._all.delete(w);
    this._idle = this._idle.filter((x) => x !== w);

    try {
      await w.terminate();
    } catch {
      // ignore terminate errors
    }

    // If there are waiters, try to fulfill one immediately (best-effort).
    if (this._waiters.length) {
      try {
        const next = await this._createWorker();
        const pooledNext = new PooledWorker(next);
        pooledNext.busy = true;
        pooledNext._ref();
        this._all.add(pooledNext);
        const waiter = this._waiters.shift();
        waiter?.resolve?.(pooledNext);
      } catch (err) {
        const waiter = this._waiters.shift();
        waiter?.reject?.(err);
      }
    }
  }
}

class PooledWorker {
  constructor(worker) {
    this.worker = worker;
    this.busy = false;
    this.destroyed = false;
  }

  _ref() {
    try {
      if (this.worker && typeof this.worker.ref === "function") this.worker.ref();
    } catch {
      // ignore
    }
  }

  _unref() {
    try {
      if (this.worker && typeof this.worker.unref === "function") this.worker.unref();
    } catch {
      // ignore
    }
  }

  async terminate() {
    const w = this.worker;
    if (!w) return;
    if (typeof w.terminate === "function") return await w.terminate();
    // Browser worker termination is sync.
    if (typeof w.terminate === "function") return w.terminate();
  }
}

function globalPools() {
  try {
    const g = globalThis;
    const key = "__PB_TOOL_EXECUTOR_WORKER_POOLS_V1__";
    if (!g[key]) g[key] = new Map();
    return g[key];
  } catch {
    return new Map();
  }
}

export class ToolExecutor {
  constructor(options = {}) {
    this.tools = options.tools || {};
    this.logger = options.logger || null;
    this.defaultTimeoutMs = options.timeoutMs || 30000;
    this.maxRetries = options.maxRetries || 1;
    this.emitFn = options.emit || null;
    const hooks = options.hooks && typeof options.hooks === "object" ? options.hooks : null;
    this.hooks = {
      before: Array.isArray(hooks?.before) ? [...hooks.before] : [],
      after: Array.isArray(hooks?.after) ? [...hooks.after] : [],
    };

    // Claude/Codex-style PreToolUse hooks (registered on EventBus) as a built-in before-hook.
    // No-op unless the provided context includes an enhanced EventBus with registered hooks.
    this.hooks.before.unshift(createPreToolUseHook());
    this.validateSchema = options.validateSchema ?? true; // 默认开启验证
    this.strictValidation = options.strictValidation ?? false; // 严格模式：验证失败直接返回错误
    this.defaultIsolation = normalizeIsolationMode(options.isolation);

    // Optional policy gate (browser-safe). When provided, ToolExecutor will ask policyManager to authorize requests
    // produced by policyMapper(toolName, args, context, {tool}).
    this.policy = options.policy || null;
    this.policyMapper = typeof options.policyMapper === "function" ? options.policyMapper : null;

    const poolCfg = isPlainObject(options.workerPool) ? options.workerPool : {};
    this._workerPoolMax = toPositiveInt(poolCfg.maxWorkers ?? options.workerPoolMax, 2);
  }

  /**
   * 注册工具
   */
  register(name, tool) {
    this.tools[name] = tool;
  }

  /**
   * 批量注册工具
   */
  registerAll(tools) {
    Object.assign(this.tools, tools);
  }

  hasTool(name) {
    return Object.prototype.hasOwnProperty.call(this.tools, name);
  }

  getTool(name) {
    return this.tools[name];
  }

  /**
   * 获取工具定义（用于 prompt 注入）
   */
  getToolDefinitions() {
    return Object.entries(this.tools).map(([name, tool]) => ({
      name,
      description: tool.description || "",
      parameters: tool.parameters || tool.definition?.parameters || {},
    }));
  }

  /**
   * 执行单个工具
   * @param {string} name - 工具名称
   * @param {Object} args - 工具参数
   * @param {Object} context - 执行上下文
   * @param {Object} options - 执行选项
   * @returns {Promise<ToolResult>}
   */
  async execute(name, args, context, options = {}) {
    const tool = this.tools[name];
    if (!tool) {
      return this._buildResult(false, null, `Unknown tool: ${name}`);
    }

    // --- Pre-execution Schema Validation ---
    const shouldValidate = options.validateSchema ?? this.validateSchema;
    const strictMode = options.strictValidation ?? this.strictValidation;

    if (shouldValidate) {
      const schema = tool.parameters || tool.definition?.parameters;
      if (schema) {
        const { valid, errors } = validateArgs(args, schema);
        if (!valid) {
          this._log("warn", `Schema validation failed for ${name}`, { errors });
          this._emit("tool:validationFailed", { tool: name, args, errors });

          if (strictMode) {
            return this._buildResult(false, null, `Validation failed: ${errors.join("; ")}`);
          }
        }
      }
    }

    // --- Before Hooks ---
    let finalArgs = args;
    const hooks = options.hooks || this.hooks || { before: [], after: [] };

    for (const hook of (hooks.before || [])) {
      try {
        const hookResult = await hook({ tool: name, params: finalArgs, context });
        if (hookResult?.skip) {
          return this._normalizeResult(hookResult.value);
        }
        if (hookResult?.params) {
          finalArgs = hookResult.params;
        }
      } catch (hookErr) {
        this._log("warn", `Before hook failed for ${name}`, { error: hookErr.message });
      }
    }

    // --- Policy / Approval gate ---
    try {
      const decision = await this._authorizeToolCall(name, finalArgs, context, {
        tool,
        options,
      });
      if (decision && decision.allowed === false) {
        const reason = typeof decision.reason === "string" ? decision.reason : "denied";
        this._emit("tool:denied", { tool: name, args: finalArgs, reason, policy: decision });
        return this._buildResult(false, null, `Policy denied: ${reason}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._emit("tool:denied", { tool: name, args: finalArgs, reason: "policy_error", error: msg });
      return this._buildResult(false, null, `Policy error: ${msg}`);
    }

    const handler = typeof tool === "function" ? tool : tool.handler;
    if (typeof handler !== "function") {
      return this._buildResult(false, null, `Tool ${name} has no handler`);
    }

    const timeoutMs = options.timeoutMs || this.defaultTimeoutMs;
    const retries = options.retries ?? this.maxRetries;
    const isolationMode = normalizeIsolationMode(options.isolation ?? tool.isolation ?? this.defaultIsolation);
    const startTime = Date.now();

    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const result = await this._executeWithTimeout(handler, finalArgs, context, timeoutMs, {
          isolationMode,
          tool,
          toolName: name,
        });
        const duration = Date.now() - startTime;

        this._log("debug", `Tool ${name} completed`, { duration, attempt });
        this._emit("tool:completed", { tool: name, args: finalArgs, result, duration });

        let normalized = this._normalizeResult(result);

        // --- After Hooks ---
        for (const hook of (hooks.after || [])) {
          try {
            const hookOverride = await hook({ tool: name, params: finalArgs, result: normalized.data, context });
            if (hookOverride !== undefined && hookOverride !== null) {
              normalized.data = hookOverride;
            }
          } catch (hookErr) {
            this._log("warn", `After hook failed for ${name}`, { error: hookErr.message });
          }
        }

        return normalized;
      } catch (err) {
        lastError = err;
        this._log("warn", `Tool ${name} failed (attempt ${attempt + 1})`, { error: err.message });

        if (attempt < retries) {
          await this._delay(100 * (attempt + 1)); // Exponential backoff
        }
      }
    }

    const duration = Date.now() - startTime;
    this._emit("tool:failed", { tool: name, args, error: lastError?.message, duration });
    return this._buildResult(false, null, lastError?.message || "Unknown error");
  }

  /**
   * 批量执行工具 (并发)
   */
  async executeBatch(actions, context, options = {}) {
    const promises = actions.map(item =>
      this.execute(item.action || item.name, item.args || {}, context, options)
        .then(result => ({ tool: item.action || item.name, ...result }))
        .catch(err => ({ tool: item.action || item.name, success: false, error: err.message }))
    );
    return Promise.all(promises);
  }

  async _authorizeToolCall(name, args, context, /** @type {{ tool?: unknown, options?: AnyRecord }} */ { tool, options } = {}) {
    const policy = options?.policy || this.policy;
    if (!policy || typeof policy.authorize !== "function") return { allowed: true };

    const mapper = typeof options?.policyMapper === "function" ? options.policyMapper : this.policyMapper;
    if (typeof mapper !== "function") return { allowed: true };

    const request = mapper(name, args, context, { tool });
    if (!request) return { allowed: true };

    const signal = context?.signal || context?.stageApi?.signal || null;
    const enriched = {
      ...request,
      ...(request.tool ? {} : { tool: name }),
      ...(request.args ? {} : { args }),
    };

    return await policy.authorize(enriched, { signal });
  }

  async _executeWithTimeout(handler, args, context, timeoutMs, options = {}) {
    const isolationMode = normalizeIsolationMode(options?.isolationMode);
    if (isolationMode === "worker") {
      const workerConfig = isPlainObject(options?.tool?.worker) ? options.tool.worker : null;
      const moduleUrl = typeof workerConfig?.moduleUrl === "string" ? workerConfig.moduleUrl : null;
      const exportName = typeof workerConfig?.exportName === "string" ? workerConfig.exportName : null;

      if (moduleUrl) {
        const resolvedModuleUrl = resolveAndValidateWorkerModuleUrl(moduleUrl, {
          isNode: isNodeLike(),
          policy: workerConfig?.moduleUrlPolicy,
          allowedOrigins: workerConfig?.allowedOrigins,
          baseUrl: import.meta.url,
        });
        return this._executeInWorker(resolvedModuleUrl, exportName, args, context, timeoutMs);
      }
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Tool execution timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      Promise.resolve(handler(args, context))
        .then(result => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch(err => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  _createWorkerContextSnapshot(context) {
    if (!context || typeof context !== "object") return {};

    const snapshot = {};

    // Commonly used by tool handlers; keep this intentionally small.
    if ("state" in context) snapshot.state = context.state;
    if ("runId" in context) snapshot.runId = context.runId;

    try {
      // Ensure cloneability for worker_threads postMessage.
      // Must use structuredClone (not deepClone) — deepClone silently
      // preserves function refs which would fail in postMessage.
      return typeof structuredClone === "function"
        ? structuredClone(snapshot)
        : JSON.parse(JSON.stringify(snapshot));
    } catch {
      return {};
    }
  }

  async _executeInWorker(moduleUrl, exportName, args, context, timeoutMs) {
    if (isNodeLike()) {
      return this._executeInNodeWorker(moduleUrl, exportName, args, context, timeoutMs);
    }
    return this._executeInWebWorker(moduleUrl, exportName, args, context, timeoutMs);
  }

  async _executeInNodeWorker(moduleUrl, exportName, args, context, timeoutMs) {
    const { Worker } = await import(/* @vite-ignore */ /** @type {string} */ ("node:worker_threads"));
    const { fileURLToPath } = await import(/* @vite-ignore */ /** @type {string} */ ("node:url"));

    // NOTE: Avoid `new Worker(new URL("./x.js", import.meta.url))` here to prevent browser bundlers
    // (e.g. Vite) from treating this Node worker entry as a web worker and trying to bundle node:* imports.
    const metaPath = fileURLToPath(import.meta.url);
    const workerPath = metaPath.replace(/tool-executor\.js$/i, "tool-executor-worker.js");
    const pools = globalPools();
    const poolKey = `node:${workerPath}`;
    let pool = pools.get(poolKey);
    if (!pool) {
      pool = new WorkerPool({
        maxWorkers: this._workerPoolMax,
        createWorker: async () => new Worker(workerPath, { type: "module" }),
      });
      pools.set(poolKey, pool);
    } else if (typeof pool?.setMaxWorkers === "function") {
      pool.setMaxWorkers(this._workerPoolMax);
    }

    const pooled = await pool.acquire();
    const worker = pooled.worker;
    const workerContext = this._createWorkerContextSnapshot(context);

    return new Promise((resolve, reject) => {
      let settled = false;

      const cleanup = async ({ destroy = false } = {}) => {
        if (settled) return;
        settled = true;

        worker.off?.("message", onMessage);
        worker.off?.("error", onError);
        worker.off?.("exit", onExit);

        if (destroy) {
          await pool.destroy(pooled);
        } else {
          pool.release(pooled);
        }
      };

      const timer = /** @type {TimeoutHandle} */ (setTimeout(() => {
        cleanup({ destroy: true }).finally(() => {
          const err = /** @type {Error & { code?: string }} */ (new Error(`Tool execution timed out after ${timeoutMs}ms`));
          err.name = "TimeoutError";
          err.code = "ETIMEDOUT";
          reject(err);
        });
      }, timeoutMs));
      if (timer && typeof timer.unref === "function") {
        try {
          timer.unref();
        } catch {
          // ignore
        }
      }

      const onMessage = (msg) => {
        if (settled) return;
        const type = msg?.type;

        if (type === "result") {
          clearTimeout(timer);
          cleanup({ destroy: false }).finally(() => resolve(msg.result));
          return;
        }

        if (type === "error") {
          clearTimeout(timer);
          const err = new Error(msg?.error?.message || "Tool worker error");
          if (msg?.error?.name) err.name = msg.error.name;
          if (msg?.error?.stack) err.stack = msg.error.stack;
          cleanup({ destroy: true }).finally(() => reject(err));
        }
      };

      const onError = (err) => {
        if (settled) return;
        clearTimeout(timer);
        cleanup({ destroy: true }).finally(() => reject(err));
      };

      const onExit = (code) => {
        if (settled) return;
        if (code === 0) return;
        clearTimeout(timer);
        cleanup({ destroy: true }).finally(() => reject(new Error(`Tool worker exited with code ${code}`)));
      };

      worker.on?.("message", onMessage);
      worker.on?.("error", onError);
      worker.on?.("exit", onExit);

      try {
        worker.postMessage({
          type: "execute",
          moduleUrl,
          exportName,
          args,
          context: workerContext,
        });
      } catch (err) {
        clearTimeout(timer);
        cleanup({ destroy: true }).finally(() => reject(err));
      }
    });
  }

  async _executeInWebWorker(moduleUrl, exportName, args, context, timeoutMs) {
    if (typeof Worker !== "function") {
      throw new Error("Tool execution in worker is not supported (Worker unavailable)");
    }

    let resolvedModuleUrl = moduleUrl;
    try {
      resolvedModuleUrl = new URL(moduleUrl, import.meta.url).toString();
    } catch {
      // keep as-is
    }

    const pools = globalPools();
    const workerEntryUrl = new URL("./tool-executor-webworker.js", import.meta.url).toString();
    const poolKey = `web:${workerEntryUrl}`;
    let pool = pools.get(poolKey);
    if (!pool) {
      pool = new WorkerPool({
        maxWorkers: this._workerPoolMax,
        createWorker: async () => new Worker(new URL("./tool-executor-webworker.js", import.meta.url), { type: "module" }),
      });
      pools.set(poolKey, pool);
    } else if (typeof pool?.setMaxWorkers === "function") {
      pool.setMaxWorkers(this._workerPoolMax);
    }

    const pooled = await pool.acquire();
    const worker = pooled.worker;
    const workerContext = this._createWorkerContextSnapshot(context);

    return new Promise((resolve, reject) => {
      let settled = false;

      const cleanup = ({ destroy = false } = {}) => {
        if (settled) return;
        settled = true;

        worker.removeEventListener?.("message", onMessage);
        worker.removeEventListener?.("error", onError);

        if (destroy) {
          void pool.destroy(pooled);
        } else {
          pool.release(pooled);
        }
      };

      const timer = setTimeout(() => {
        cleanup({ destroy: true });
        const err = /** @type {Error & { code?: string }} */ (new Error(`Tool execution timed out after ${timeoutMs}ms`));
        err.name = "TimeoutError";
        err.code = "ETIMEDOUT";
        reject(err);
      }, timeoutMs);

      const onMessage = (evt) => {
        if (settled) return;
        const msg = evt?.data;
        const type = msg?.type;

        if (type === "result") {
          clearTimeout(timer);
          cleanup({ destroy: false });
          resolve(msg.result);
          return;
        }

        if (type === "error") {
          clearTimeout(timer);
          const err = new Error(msg?.error?.message || "Tool worker error");
          if (msg?.error?.name) err.name = msg.error.name;
          if (msg?.error?.stack) err.stack = msg.error.stack;
          cleanup({ destroy: true });
          reject(err);
        }
      };

      const onError = (err) => {
        if (settled) return;
        clearTimeout(timer);
        cleanup({ destroy: true });
        reject(err);
      };

      worker.addEventListener?.("message", onMessage);
      worker.addEventListener?.("error", onError);

      try {
        worker.postMessage({
          type: "execute",
          moduleUrl: resolvedModuleUrl,
          exportName,
          args,
          context: workerContext,
        });
      } catch (err) {
        clearTimeout(timer);
        cleanup({ destroy: true });
        reject(err);
      }
    });
  }

  _normalizeResult(result) {
    if (result === null || result === undefined) {
      return this._buildResult(true, null);
    }

    if (typeof result === "object") {
      const success = result.success ?? result.ok ?? !result.error;
      const data = result.data ?? result.result ?? result;
      const error = result.error ?? null;
      const ok = Boolean(success);
      return { ok, success: ok, data, error, raw: result };
    }

    return this._buildResult(true, result);
  }

  _buildResult(success, data, error = null) {
    const ok = Boolean(success);
    return { ok, success: ok, data, error };
  }

  _log(level, message, data = {}) {
    if (this.logger && typeof this.logger[level] === "function") {
      this.logger[level](`[ToolExecutor] ${message}`, data);
    }
  }

  _emit(name, payload) {
    if (typeof this.emitFn === "function") {
      this.emitFn(name, payload);
    }
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * 创建工具执行器的工厂函数
 */
export function createToolExecutor(options = {}) {
  return new ToolExecutor(options);
}

/**
 * 简单执行函数（向后兼容）
 */
export async function executeTool(tools, name, args, context) {
  const executor = new ToolExecutor({ tools });
  return executor.execute(name, args, context);
}

export const __test = { WorkerPool };

export default ToolExecutor;
