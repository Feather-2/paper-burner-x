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

  /**
   * Dispose the pool: terminate all workers, reject pending waiters, clear state.
   * Idempotent — safe to call multiple times.
   */
  dispose() {
    // Reject all pending waiters
    while (this._waiters.length) {
      const waiter = this._waiters.shift();
      waiter?.reject?.(new Error("WorkerPool disposed"));
    }

    // Terminate all workers (idle + busy)
    for (const pooled of this._all) {
      pooled.destroyed = true;
      pooled.busy = false;
      try { pooled.terminate(); } catch { /* ignore */ }
    }
    this._all.clear();
    this._idle.length = 0;
    this._pendingCreates = 0;
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
          // P0: 统一事件命名为 tool:call:error
          this._emit("tool:call:error", { tool: name, args, errors, reason: "validation_failed" });

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
        // P0: 统一事件命名为 tool:call:error
        this._emit("tool:call:error", { tool: name, args: finalArgs, reason: "policy_denied", policy: decision });
        return this._buildResult(false, null, `Policy denied: ${reason}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // P0: 统一事件命名为 tool:call:error
      this._emit("tool:call:error", { tool: name, args: finalArgs, reason: "policy_error", error: msg });
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

    // P0: 发射 tool:call:start 事件
    const runId = context?.runId || context?.stageApi?.runId;
    const stage = context?.stage || context?.stageName;
    this._emit("tool:call:start", {
      tool: name,
      args: finalArgs,
      runId,
      stage,
      isolationMode,
      timeoutMs,
      maxRetries: retries,
    });

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
        // P0: 统一事件命名为 tool:call:end
        this._emit("tool:call:end", {
          tool: name,
          args: finalArgs,
          result,
          duration,
          attempt,
          runId,
          stage,
          success: true,
        });

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
    // P0: 统一事件命名为 tool:call:error
    this._emit("tool:call:error", {
      tool: name,
      args,
      error: lastError?.message,
      duration,
      attempts: retries + 1,
      runId,
      stage,
    });
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

  /**
   * Dispose this executor: tear down all cached WorkerPool instances.
   * Idempotent — safe to call multiple times.
   */
  dispose() {
    const pools = globalPools();
    for (const [key, pool] of pools) {
      if (pool && typeof pool.dispose === "function") {
        try { pool.dispose(); } catch { /* ignore */ }
      }
      pools.delete(key);
    }
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

    const baseContext = context && typeof context === "object" ? context : {};
    const parentSignal = baseContext.signal || baseContext.stageApi?.signal || null;
    const hasAbortController = typeof AbortController === "function";
    const timeoutErrorMessage = `Tool execution timed out after ${timeoutMs}ms (handler may continue if AbortSignal is ignored)`;

    /** @type {Record<string, unknown>} */
    const executionContext = { ...baseContext };
    const timeoutController = hasAbortController ? new AbortController() : null;
    let timeoutId = null;
    let onParentAbort = null;

    if (timeoutController) {
      executionContext.signal = timeoutController.signal;
      onParentAbort = () => {
        try {
          timeoutController.abort(parentSignal?.reason);
        } catch {
          timeoutController.abort();
        }
      };

      if (parentSignal && typeof parentSignal.addEventListener === "function") {
        if (parentSignal.aborted) {
          onParentAbort();
        } else {
          parentSignal.addEventListener("abort", onParentAbort, { once: true });
        }
      }
    }

    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        const timeoutErr = /** @type {Error & { code?: string }} */ (new Error(timeoutErrorMessage));
        timeoutErr.name = "TimeoutError";
        timeoutErr.code = "ETIMEDOUT";
        if (timeoutController) {
          try {
            timeoutController.abort(timeoutErr);
          } catch {
            timeoutController.abort();
          }
        }
        reject(timeoutErr);
      }, timeoutMs);
    });

    try {
      return await Promise.race([
        Promise.resolve(handler(args, executionContext)),
        timeoutPromise,
      ]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      if (parentSignal && onParentAbort && typeof parentSignal.removeEventListener === "function") {
        parentSignal.removeEventListener("abort", onParentAbort);
      }
    }
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
      /* intentional: metadata extraction failure */
      return {};
    }
  }

  async _executeInWorker(moduleUrl, exportName, args, context, timeoutMs) {
    if (isNodeLike()) {
      return this._executeInNodeWorker(moduleUrl, exportName, args, context, timeoutMs);
    }
    return this._executeInWebWorker(moduleUrl, exportName, args, context, timeoutMs);
  }

  /**
   * Acquire or create a WorkerPool from the global cache.
   * @param {string} poolKey - Unique key for global pool lookup.
   * @param {() => Promise<unknown>} createWorker - Factory for new workers.
   * @returns {WorkerPool}
   */
  _getOrCreatePool(poolKey, createWorker) {
    const pools = globalPools();
    let pool = pools.get(poolKey);
    if (!pool) {
      pool = new WorkerPool({ maxWorkers: this._workerPoolMax, createWorker });
      pools.set(poolKey, pool);
    } else if (typeof pool?.setMaxWorkers === "function") {
      pool.setMaxWorkers(this._workerPoolMax);
    }
    return pool;
  }

  /**
   * Run a tool handler inside a pooled worker with timeout protection.
   *
   * Platform-specific behaviour is injected via `platformOps`:
   * - subscribe/unsubscribe: attach/detach event listeners on the raw worker
   * - extractMessage: unwrap the platform message envelope
   * - asyncCleanup: whether cleanup/settle chains through Promises (Node) or is sync (Web)
   * - unrefTimer: optional, call timer.unref() on Node to avoid keeping the process alive
   *
   * @param {object} params
   * @param {WorkerPool} params.pool
   * @param {string} params.resolvedModuleUrl
   * @param {string|null} params.exportName
   * @param {unknown} params.args
   * @param {unknown} params.context
   * @param {number} params.timeoutMs
   * @param {{ subscribe: Function, unsubscribe: Function, extractMessage: Function, asyncCleanup?: boolean, unrefTimer?: boolean }} params.platformOps
   * @returns {Promise<unknown>}
   */
  async _executePooledWorker({ pool, resolvedModuleUrl, exportName, args, context, timeoutMs, platformOps }) {
    const pooled = await pool.acquire();
    const worker = pooled.worker;
    const workerContext = this._createWorkerContextSnapshot(context);
    const { subscribe, unsubscribe, extractMessage, asyncCleanup, unrefTimer } = platformOps;

    return new Promise((resolve, reject) => {
      let settled = false;

      const doCleanup = (destroy) => {
        if (settled) return;
        settled = true;
        unsubscribe(worker, handlers);
        if (destroy) {
          return pool.destroy(pooled);
        }
        pool.release(pooled);
      };

      const settle = (cleanupResult, fn) => {
        if (asyncCleanup && cleanupResult && typeof cleanupResult.finally === "function") {
          cleanupResult.finally(fn);
        } else {
          fn();
        }
      };

      const handlers = {};

      handlers.message = (raw) => {
        if (settled) return;
        const msg = extractMessage(raw);
        const type = msg?.type;

        if (type === "result") {
          clearTimeout(timer);
          settle(doCleanup(false), () => resolve(msg.result));
          return;
        }
        if (type === "error") {
          clearTimeout(timer);
          const err = new Error(msg?.error?.message || "Tool worker error");
          if (msg?.error?.name) err.name = msg.error.name;
          if (msg?.error?.stack) err.stack = msg.error.stack;
          settle(doCleanup(true), () => reject(err));
        }
      };

      handlers.error = (err) => {
        if (settled) return;
        clearTimeout(timer);
        settle(doCleanup(true), () => reject(err));
      };

      handlers.exit = (code) => {
        if (settled) return;
        if (code === 0) return;
        clearTimeout(timer);
        settle(doCleanup(true), () => reject(new Error(`Tool worker exited with code ${code}`)));
      };

      const timer = /** @type {TimeoutHandle} */ (setTimeout(() => {
        settle(doCleanup(true), () => {
          const err = /** @type {Error & { code?: string }} */ (new Error(`Tool execution timed out after ${timeoutMs}ms`));
          err.name = "TimeoutError";
          err.code = "ETIMEDOUT";
          reject(err);
        });
      }, timeoutMs));

      if (unrefTimer && timer && typeof timer.unref === "function") {
        try { timer.unref(); } catch { /* ignore */ }
      }

      subscribe(worker, handlers);

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
        settle(doCleanup(true), () => reject(err));
      }
    });
  }

  async _executeInNodeWorker(moduleUrl, exportName, args, context, timeoutMs) {
    const { Worker } = await import(/* @vite-ignore */ /** @type {string} */ ("node:worker_threads"));
    const { fileURLToPath } = await import(/* @vite-ignore */ /** @type {string} */ ("node:url"));

    // NOTE: Avoid `new Worker(new URL("./x.js", import.meta.url))` here to prevent browser bundlers
    // (e.g. Vite) from treating this Node worker entry as a web worker and trying to bundle node:* imports.
    const metaPath = fileURLToPath(import.meta.url);
    const workerPath = metaPath.replace(/tool-executor\.js$/i, "tool-executor-worker.js");
    const pool = this._getOrCreatePool(`node:${workerPath}`, async () => new Worker(workerPath, { type: "module" }));

    return this._executePooledWorker({
      pool, resolvedModuleUrl: moduleUrl, exportName, args, context, timeoutMs,
      platformOps: {
        subscribe: (w, h) => { w.on?.("message", h.message); w.on?.("error", h.error); w.on?.("exit", h.exit); },
        unsubscribe: (w, h) => { w.off?.("message", h.message); w.off?.("error", h.error); w.off?.("exit", h.exit); },
        extractMessage: (msg) => msg,
        asyncCleanup: true,
        unrefTimer: true,
      },
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

    const workerEntryUrl = new URL("./tool-executor-webworker.js", import.meta.url).toString();
    const pool = this._getOrCreatePool(`web:${workerEntryUrl}`, async () => new Worker(new URL("./tool-executor-webworker.js", import.meta.url), { type: "module" }));

    return this._executePooledWorker({
      pool, resolvedModuleUrl, exportName, args, context, timeoutMs,
      platformOps: {
        subscribe: (w, h) => { w.addEventListener?.("message", h.message); w.addEventListener?.("error", h.error); },
        unsubscribe: (w, h) => { w.removeEventListener?.("message", h.message); w.removeEventListener?.("error", h.error); },
        extractMessage: (evt) => evt?.data,
        asyncCleanup: false,
        unrefTimer: false,
      },
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
