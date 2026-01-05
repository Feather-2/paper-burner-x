/**
 * Runtime Scheduler
 * 
 * 微内核架构下的核心调度组件。
 * 职责：
 * 1. 管理多种运行时 (JS, Python, etc.)
 * 2. 分发执行任务
 * 3. 统一上下文构建
 */

import { toPositiveInt } from "../../shared/utils/value-utils.js";

export const RuntimeHealthStatus = Object.freeze({
  HEALTHY: "healthy",
  DEGRADED: "degraded",
  UNHEALTHY: "unhealthy",
});

function toFiniteNumber(value, fallback) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

function clamp01(value, fallback) {
  const n = toFiniteNumber(value, fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function defaultTime() {
  return {
    now: () => Date.now(),
  };
}

export const TaskPriority = Object.freeze({
  HIGH: 0,
  NORMAL: 1,
  LOW: 2,
});

export class RuntimeScheduler {
  constructor(options = {}) {
    this.runtimes = new Map();
    this.eventBus = options.eventBus;
    this.vfs = options.vfs;

    // --- Health & isolation ---
    this._healthStatus = new Map(); // runtimeType -> RuntimeHealthStatus
    this._healthMetrics = new Map(); // runtimeType -> metrics snapshot
    this._time = options.time && typeof options.time.now === "function" ? options.time : defaultTime();

    // --- Task scheduling ---
    const scheduling = options.scheduling && typeof options.scheduling === "object" ? options.scheduling : {};
    this._taskQueues = new Map();      // runtimeType -> sorted task array
    this._inFlightCounts = new Map();  // runtimeType -> number
    this._maxConcurrent = toPositiveInt(scheduling.maxConcurrentPerRuntime, 3);
    this._maxQueueSize = toPositiveInt(scheduling.maxQueueSize, 100);
    this._taskSeq = 0;                 // tie-breaker for equal priorities

    const health = options.health && typeof options.health === "object" ? options.health : {};
    this._healthConfig = Object.freeze({
      degradedFailureThreshold: toPositiveInt(health.degradedFailureThreshold, 1),
      unhealthyFailureThreshold: toPositiveInt(health.unhealthyFailureThreshold, 3),
      degradedLatencyMs: toPositiveInt(health.degradedLatencyMs, 2_000),
      unhealthyLatencyMs: toPositiveInt(health.unhealthyLatencyMs, 10_000),
      latencyEwmaAlpha: clamp01(health.latencyEwmaAlpha, 0.2),
      recentErrorsMax: toPositiveInt(health.recentErrorsMax, 5),
      recoverySuccessThreshold: toPositiveInt(health.recoverySuccessThreshold, 2),
      recoveryProbeCodeByType: health.recoveryProbeCodeByType && typeof health.recoveryProbeCodeByType === "object"
        ? health.recoveryProbeCodeByType
        : Object.freeze({}),
    });
  }

  /**
   * 注册运行时适配器
   * @param {string} type 
   * @param {RuntimeAdapter} adapter 
   */
  registerRuntime(type, adapter) {
    this.runtimes.set(type, adapter);
    this._ensureHealthEntry(type);
  }

  _ensureHealthEntry(type) {
    if (!this._healthMetrics.has(type)) {
      this._healthMetrics.set(type, {
        totalCalls: 0,
        successCount: 0,
        failureCount: 0,
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
        blockedCount: 0,
        averageLatencyMs: null,
        lastLatencyMs: null,
        lastError: null,
        recentErrors: [],
        isolated: false,
        isolatedAt: null,
        isolationReason: null,
        recoverySuccessStreak: 0,
        lastUpdatedAt: this._time.now(),
        lastStatusChangeAt: this._time.now(),
      });
    }

    if (!this._healthStatus.has(type)) {
      this._healthStatus.set(type, RuntimeHealthStatus.HEALTHY);
    }
  }

  /**
   * 获取运行时健康状态
   * @param {string} [runtimeType] - 可选；不传则返回所有运行时状态
   */
  getHealthStatus(runtimeType) {
    if (runtimeType) {
      this._ensureHealthEntry(runtimeType);
      return this._healthStatus.get(runtimeType) || RuntimeHealthStatus.HEALTHY;
    }

    const out = {};
    for (const type of this.runtimes.keys()) {
      this._ensureHealthEntry(type);
      out[type] = this._healthStatus.get(type);
    }
    return out;
  }

  /**
   * 返回各运行时健康指标（成功率、平均延迟、最近错误等）
   * @param {string} [runtimeType] - 可选；不传则返回所有运行时指标
   */
  getHealthMetrics(runtimeType) {
    const format = (type) => {
      this._ensureHealthEntry(type);
      const m = this._healthMetrics.get(type);
      const total = m.totalCalls;
      return {
        runtimeType: type,
        status: this.getHealthStatus(type),
        isolated: m.isolated,
        totalCalls: total,
        successCount: m.successCount,
        failureCount: m.failureCount,
        blockedCount: m.blockedCount,
        successRate: total > 0 ? m.successCount / total : null,
        averageLatencyMs: m.averageLatencyMs,
        lastLatencyMs: m.lastLatencyMs,
        consecutiveFailures: m.consecutiveFailures,
        consecutiveSuccesses: m.consecutiveSuccesses,
        lastError: m.lastError,
        recentErrors: Array.isArray(m.recentErrors) ? [...m.recentErrors] : [],
        isolatedAt: m.isolatedAt,
        isolationReason: m.isolationReason,
        recoverySuccessStreak: m.recoverySuccessStreak,
        lastUpdatedAt: m.lastUpdatedAt,
        lastStatusChangeAt: m.lastStatusChangeAt,
      };
    };

    if (runtimeType) return format(runtimeType);

    const out = {};
    const types = new Set([...this.runtimes.keys(), ...this._healthMetrics.keys()]);
    for (const type of types) {
      out[type] = format(type);
    }
    return out;
  }

  /**
   * 手动隔离某个运行时（将不再调度新任务）
   * @param {string} runtimeType
   * @param {Object} [options]
   * @param {string} [options.reason]
   */
  isolateRuntime(runtimeType, options = {}) {
    const type = String(runtimeType || "");
    if (!type) throw new Error("RuntimeScheduler.isolateRuntime(runtimeType): runtimeType must be a non-empty string");

    this._ensureHealthEntry(type);
    const metrics = this._healthMetrics.get(type);
    if (metrics.isolated) return;

    metrics.isolated = true;
    metrics.isolatedAt = this._time.now();
    metrics.isolationReason = typeof options.reason === "string" && options.reason.trim().length ? options.reason.trim() : "manual_isolation";
    metrics.recoverySuccessStreak = 0;
    metrics.lastUpdatedAt = this._time.now();

    this._setHealthStatus(type, RuntimeHealthStatus.UNHEALTHY, { reason: metrics.isolationReason });
  }

  _clearIsolation(runtimeType, { reason } = {}) {
    this._ensureHealthEntry(runtimeType);
    const metrics = this._healthMetrics.get(runtimeType);
    if (!metrics.isolated) return;

    metrics.isolated = false;
    metrics.isolatedAt = null;
    metrics.isolationReason = null;
    metrics.recoverySuccessStreak = 0;
    metrics.consecutiveFailures = 0;
    metrics.lastUpdatedAt = this._time.now();

    // 恢复后先标记为 DEGRADED，待后续任务表现稳定再自动恢复 HEALTHY
    this._setHealthStatus(runtimeType, RuntimeHealthStatus.DEGRADED, { reason: reason || "recovered" });
  }

  _setHealthStatus(runtimeType, next, meta = {}) {
    const prev = this._healthStatus.get(runtimeType) || RuntimeHealthStatus.HEALTHY;
    if (prev === next) return;

    this._healthStatus.set(runtimeType, next);
    const metrics = this._healthMetrics.get(runtimeType);
    if (metrics) metrics.lastStatusChangeAt = this._time.now();

    // Optional event emission for observability (best-effort)
    try {
      this.eventBus?.emit?.("runtime.health.changed", {
        runtimeType,
        from: prev,
        to: next,
        reason: typeof meta.reason === "string" ? meta.reason : undefined,
        ts: this._time.now(),
      });
    } catch {
      // ignore
    }
  }

  _updateLatencyEwma(metrics, latencyMs) {
    const ms = toFiniteNumber(latencyMs, null);
    if (!Number.isFinite(ms) || ms < 0) return;
    metrics.lastLatencyMs = ms;

    const alpha = this._healthConfig.latencyEwmaAlpha;
    if (!Number.isFinite(metrics.averageLatencyMs)) {
      metrics.averageLatencyMs = ms;
      return;
    }
    // EWMA: next = alpha * sample + (1-alpha) * prev
    metrics.averageLatencyMs = alpha * ms + (1 - alpha) * metrics.averageLatencyMs;
  }

  _recordResult(runtimeType, result, { latencyMs, isProbe = false, blocked = false } = {}) {
    this._ensureHealthEntry(runtimeType);
    const metrics = this._healthMetrics.get(runtimeType);
    metrics.lastUpdatedAt = this._time.now();

    if (blocked) {
      metrics.blockedCount += 1;
      return;
    }

    metrics.totalCalls += 1;
    this._updateLatencyEwma(metrics, latencyMs);

    const success = !!result?.success;
    if (success) {
      metrics.successCount += 1;
      metrics.consecutiveSuccesses += 1;
      metrics.consecutiveFailures = 0;
      if (isProbe) metrics.recoverySuccessStreak += 1;
    } else {
      metrics.failureCount += 1;
      metrics.consecutiveFailures += 1;
      metrics.consecutiveSuccesses = 0;
      if (isProbe) metrics.recoverySuccessStreak = 0;

      const message = typeof result?.error === "string" && result.error.trim().length ? result.error.trim() : "Runtime execution failed";
      const errObj = {
        message,
        at: this._time.now(),
      };
      metrics.lastError = errObj;

      const max = this._healthConfig.recentErrorsMax;
      metrics.recentErrors = Array.isArray(metrics.recentErrors) ? metrics.recentErrors : [];
      metrics.recentErrors.unshift(errObj);
      if (metrics.recentErrors.length > max) {
        metrics.recentErrors.length = max;
      }
    }
  }

  _evaluateHealth(runtimeType) {
    this._ensureHealthEntry(runtimeType);
    const metrics = this._healthMetrics.get(runtimeType);
    if (metrics.isolated) return RuntimeHealthStatus.UNHEALTHY;

    if (metrics.consecutiveFailures >= this._healthConfig.unhealthyFailureThreshold) return RuntimeHealthStatus.UNHEALTHY;
    if (Number.isFinite(metrics.averageLatencyMs) && metrics.averageLatencyMs >= this._healthConfig.unhealthyLatencyMs) {
      return RuntimeHealthStatus.UNHEALTHY;
    }

    if (metrics.consecutiveFailures >= this._healthConfig.degradedFailureThreshold) return RuntimeHealthStatus.DEGRADED;
    if (Number.isFinite(metrics.averageLatencyMs) && metrics.averageLatencyMs >= this._healthConfig.degradedLatencyMs) {
      return RuntimeHealthStatus.DEGRADED;
    }

    return RuntimeHealthStatus.HEALTHY;
  }

  /**
   * 获取调度队列状态
   * @param {string} [runtimeType]
   */
  getQueueStats(runtimeType) {
    const format = (type) => {
      const queue = this._taskQueues.get(type) || [];
      const inFlight = this._inFlightCounts.get(type) || 0;
      return {
        runtimeType: type,
        queueSize: queue.length,
        inFlight,
        maxConcurrent: this._maxConcurrent,
        maxQueueSize: this._maxQueueSize,
      };
    };

    if (runtimeType) return format(runtimeType);

    const out = {};
    for (const type of this.runtimes.keys()) {
      out[type] = format(type);
    }
    return out;
  }

  _ensureQueueEntry(type) {
    if (!this._taskQueues.has(type)) this._taskQueues.set(type, []);
    if (!this._inFlightCounts.has(type)) this._inFlightCounts.set(type, 0);
  }

  /**
   * 调度执行任务（带队列和优先级）
   * @param {string} type 运行时类型
   * @param {string} code 代码内容
   * @param {Object} inputState 状态快照
   * @param {Object} options 额外选项
   * @param {number} [options.priority=TaskPriority.NORMAL] - 任务优先级
   * @param {AbortSignal} [options.signal]
   * @param {Object} [options.dependencies]
   */
  async dispatch(type, code, inputState, options = {}) {
    const runtime = this.runtimes.get(type);
    if (!runtime) {
      throw new Error(`Runtime not registered: ${type}`);
    }

    this._ensureHealthEntry(type);
    this._ensureQueueEntry(type);

    // UNHEALTHY 运行时自动隔离：不再调度新任务
    const currentStatus = this.getHealthStatus(type);
    const metrics = this._healthMetrics.get(type);
    if (metrics.isolated || currentStatus === RuntimeHealthStatus.UNHEALTHY) {
      this._recordResult(type, { success: false, error: `Runtime is isolated: ${type}` }, { blocked: true });
      return { success: false, error: `Runtime is isolated: ${type}`, metrics: { duration: 0 } };
    }

    const priority = typeof options.priority === "number" && Number.isFinite(options.priority)
      ? Math.max(0, Math.floor(options.priority))
      : TaskPriority.NORMAL;
    const seq = this._taskSeq++;

    const inFlight = this._inFlightCounts.get(type) || 0;

    // 可以立即执行
    if (inFlight < this._maxConcurrent) {
      return this._executeTask(type, runtime, code, inputState, options);
    }

    // 需要排队
    const queue = this._taskQueues.get(type);
    if (queue.length >= this._maxQueueSize) {
      return { success: false, error: `Queue full for runtime: ${type}`, metrics: { duration: 0, queued: false } };
    }

    // 创建排队任务
    return new Promise((resolve) => {
      const task = { type, runtime, code, inputState, options, priority, seq, resolve };

      // 按优先级插入（priority 小的在前，相同优先级按 seq）
      let inserted = false;
      for (let i = 0; i < queue.length; i++) {
        const existing = queue[i];
        if (priority < existing.priority || (priority === existing.priority && seq < existing.seq)) {
          queue.splice(i, 0, task);
          inserted = true;
          break;
        }
      }
      if (!inserted) queue.push(task);
    });
  }

  async _executeTask(type, runtime, code, inputState, options) {
    this._inFlightCounts.set(type, (this._inFlightCounts.get(type) || 0) + 1);

    // 构建统一上下文
    const context = {
      vfs: this.vfs,
      state: inputState,
      emit: (name, payload) => this.eventBus?.emit(name, payload),
      signal: options.signal
    };

    const startTime = this._time.now();
    let result;

    try {
      // 预加载依赖
      if (options.dependencies && runtime.preload) {
        await runtime.preload(options.dependencies);
      }

      // 执行
      const raw = await runtime.execute(code, context);
      const endTime = this._time.now();
      const latencyMs = Math.max(0, endTime - startTime);

      result = raw && typeof raw === "object" && "success" in raw
        ? raw
        : { success: true, data: raw, metrics: raw?.metrics };

      this._recordResult(type, result, { latencyMs });

      const nextStatus = this._evaluateHealth(type);
      if (nextStatus === RuntimeHealthStatus.UNHEALTHY) {
        this.isolateRuntime(type, { reason: "auto_unhealthy" });
      } else {
        this._setHealthStatus(type, nextStatus, { reason: "auto_evaluate" });
      }

      // Auto-recover from DEGRADED when stable
      if (nextStatus === RuntimeHealthStatus.DEGRADED) {
        const m = this._healthMetrics.get(type);
        if (m.consecutiveSuccesses >= this._healthConfig.recoverySuccessThreshold && (m.averageLatencyMs ?? 0) < this._healthConfig.degradedLatencyMs) {
          this._setHealthStatus(type, RuntimeHealthStatus.HEALTHY, { reason: "stable_success" });
        }
      }
    } catch (err) {
      const endTime = this._time.now();
      const latencyMs = Math.max(0, endTime - startTime);
      const message = err instanceof Error ? err.message : String(err);
      result = { success: false, error: message, metrics: { duration: latencyMs } };

      this._recordResult(type, result, { latencyMs });

      const nextStatus = this._evaluateHealth(type);
      if (nextStatus === RuntimeHealthStatus.UNHEALTHY) {
        this.isolateRuntime(type, { reason: "auto_unhealthy" });
      } else {
        this._setHealthStatus(type, nextStatus, { reason: "auto_evaluate" });
      }
    } finally {
      this._inFlightCounts.set(type, Math.max(0, (this._inFlightCounts.get(type) || 1) - 1));
      this._drainQueue(type);
    }

    return result;
  }

  _drainQueue(type) {
    const queue = this._taskQueues.get(type);
    if (!queue || !queue.length) return;

    const inFlight = this._inFlightCounts.get(type) || 0;
    if (inFlight >= this._maxConcurrent) return;

    // 取队首任务执行
    const task = queue.shift();
    if (!task) return;

    this._executeTask(task.type, task.runtime, task.code, task.inputState, task.options)
      .then(task.resolve)
      .catch((err) => task.resolve({ success: false, error: err?.message || String(err) }));
  }

  /**
   * 调度执行任务
   * @deprecated Use dispatch() instead - this is kept for backward compatibility
   */

  _defaultProbeCode(runtimeType) {
    const type = String(runtimeType || "").toLowerCase();
    if (type === "js" || type === "javascript") return "return true;";
    if (type === "python" || type === "py") return "1+1";
    return "";
  }

  /**
   * 探测隔离运行时是否恢复（建议由上层定期调用）
   * - 探测成功累计达到 recoverySuccessThreshold 后自动解除隔离
   */
  async recoveryCheck() {
    const types = new Set([...this._healthMetrics.keys(), ...this.runtimes.keys()]);
    const results = {};

    for (const type of types) {
      this._ensureHealthEntry(type);
      const metrics = this._healthMetrics.get(type);
      if (!metrics.isolated) continue;

      const runtime = this.runtimes.get(type);
      if (!runtime) continue;

      const startTime = this._time.now();
      try {
        let ok = false;
        let res = null;

        if (typeof runtime.healthCheck === "function") {
          res = await runtime.healthCheck({
            vfs: this.vfs,
            emit: (name, payload) => this.eventBus?.emit(name, payload),
          });
          if (typeof res === "boolean") ok = res;
          else if (res && typeof res === "object" && "success" in res) ok = !!res.success;
          else ok = true;
        } else if (typeof runtime.execute === "function") {
          const probeCode = this._healthConfig.recoveryProbeCodeByType[type] ?? this._defaultProbeCode(type);
          res = await runtime.execute(probeCode, {
            vfs: this.vfs,
            state: {},
            emit: (name, payload) => this.eventBus?.emit(name, payload),
          });
          ok = !!res?.success;
        } else {
          ok = false;
          res = { success: false, error: "Runtime has no healthCheck/execute" };
        }

        const endTime = this._time.now();
        const latencyMs = Math.max(0, endTime - startTime);
        this._recordResult(type, ok ? { success: true } : { success: false, error: res?.error || "Health check failed" }, { latencyMs, isProbe: true });

        results[type] = { ok, latencyMs };

        if (ok && metrics.recoverySuccessStreak >= this._healthConfig.recoverySuccessThreshold) {
          this._clearIsolation(type, { reason: "recovery_probe_success" });
        }
      } catch (err) {
        const endTime = this._time.now();
        const latencyMs = Math.max(0, endTime - startTime);
        const message = err instanceof Error ? err.message : String(err);
        this._recordResult(type, { success: false, error: message }, { latencyMs, isProbe: true });
        results[type] = { ok: false, latencyMs, error: message };
      }
    }

    return results;
  }
}
