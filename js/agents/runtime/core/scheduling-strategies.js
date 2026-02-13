import { toNonEmptyString } from "../../shared/index.js";
import { OrchestratorState } from "./constants.js";

/**
 * @typedef {import("./constants.js").OrchestratorState[keyof import("./constants.js").OrchestratorState]} OrchestratorStateValue
 */

/**
 * Scheduling modes for stage execution
 */
export const SchedulingMode = Object.freeze({
  SEQUENTIAL: "sequential",
  PARALLEL: "parallel",
});

/**
 * Scheduling strategy methods for AgentOrchestrator.
 * These methods handle stage execution scheduling (sequential/parallel).
 */
export const SchedulingStrategies = {
  /**
   * Run a single stage (routes to sequential or parallel execution)
   * @param {string} stageName
   * @param {any} input
   * @returns {Promise<any>}
   */
  async runStage(stageName, input) {
    this._ensureNotDisposed();
    const name = toNonEmptyString(stageName);
    if (!name) throw new Error("AgentOrchestrator.runStage(stageName): stageName must be a non-empty string");

    if (this._schedulingMode === SchedulingMode.PARALLEL) {
      return this._runStageParallel(name, input);
    }

    // Sequential mode: Force sequential execution (shared UI + persistence assumptions).
    this._queue = this._queue.then(
      () => this._runStageNow(name, input),
      () => this._runStageNow(name, input)
    );
    return this._queue;
  },

  /**
   * Run multiple stages in parallel with concurrency limit
   * @param {Array<{name: string, input?: any}>} stages - Stages to run
   * @returns {Promise<Map<string, any>>} Map of stageName -> result
   */
  async runStagesParallel(stages) {
    this._ensureNotDisposed();
    if (!Array.isArray(stages) || stages.length === 0) {
      return new Map();
    }

    if (this.state !== OrchestratorState.RUNNING) this.start();
    if (this.signal.aborted) throw new Error("Run cancelled");

    const results = new Map();
    const concurrencyLimit = await this._getEffectiveConcurrencyLimit();
    const pending = [...stages];
    const executing = new Set();
    const allErrors = [];

    const runNext = async () => {
      while (pending.length > 0 && executing.size < concurrencyLimit) {
        const { name, input } = pending.shift();
        const stageName = toNonEmptyString(name);
        if (!stageName) continue;

        const promise = this._runStageNow(stageName, input)
          .then((result) => {
            results.set(stageName, { success: true, result });
            executing.delete(promise);
            return runNext();
          })
          .catch((error) => {
            const errorMessage = error?.message || String(error);
            results.set(stageName, { success: false, error: errorMessage });
            allErrors.push(new Error(`Stage "${stageName}": ${errorMessage}`));
            executing.delete(promise);
            return runNext();
          });

        executing.add(promise);
      }

      if (executing.size > 0) {
        await Promise.race(executing);
      }
    };

    await runNext();
    // Wait for all remaining
    if (executing.size > 0) {
      await Promise.allSettled(executing);
    }

    return results;
  },

  /**
   * Run stages with explicit DAG dependencies (layered parallelism).
   *
   * Example:
   * - A (no deps)
   * - B depends on A
   * - C depends on A
   * -> level1: [A], level2: [B, C]
   *
   * @param {Array<{name: string, input?: any, dependsOn?: string[]}>} stages
   * @param {{ continueOnError?: boolean } | undefined} [options]
   * @returns {Promise<Map<string, any>>} Map of stageName -> {success, result|error|skipped}
   */
  async runStagesGraph(stages, options = {}) {
    this._ensureNotDisposed();
    const list = Array.isArray(stages) ? stages : [];
    if (list.length === 0) return new Map();

    const continueOnError = options?.continueOnError === true;

    /** @type {Map<string, { name: string, input?: any, dependsOn?: string[] }>} */
    const byName = new Map();
    for (const item of list) {
      const stageName = toNonEmptyString(item?.name);
      if (!stageName) continue;
      byName.set(stageName, item);
    }

    const graph = this.taskGraph;
    graph.clear();
    try {
      for (const [stageName, item] of byName) {
        const deps = Array.isArray(item?.dependsOn) ? item.dependsOn : [];
        graph.addTask(stageName, deps);
      }

      const levels = graph.getLevels();
      const results = new Map();

      for (const level of levels) {
        /** @type {Array<{name: string, input?: any}>} */
        const runnable = [];

        for (const stageName of level) {
          const node = byName.get(stageName);
          const deps = Array.isArray(node?.dependsOn) ? node.dependsOn : [];

          let blockedBy = null;
          for (const dep of deps) {
            const r = results.get(dep);
            if (r && r.success === false) {
              blockedBy = dep;
              break;
            }
          }

          if (blockedBy) {
            results.set(stageName, { success: false, skipped: true, error: `dependency_failed:${blockedBy}` });
            continue;
          }

          runnable.push({ name: stageName, input: node?.input });
        }

        if (runnable.length) {
          const levelResults = await this.runStagesParallel(runnable);
          for (const [name, outcome] of levelResults.entries()) {
            results.set(name, outcome);
          }
        }

        if (!continueOnError) {
          for (const stageName of level) {
            const r = results.get(stageName);
            if (r && r.success === false && !r.skipped) {
              throw new Error(`Stage failed: ${stageName}: ${r.error || "unknown_error"}`);
            }
          }
        }
      }

      return results;
    } finally {
      graph.clear();
    }
  },

  /**
   * Run stage with parallel mode concurrency control
   * @private
   * @param {string} stageName
   * @param {any} input
   * @returns {Promise<any>}
   */
  async _runStageParallel(stageName, input) {
    this._ensureNotDisposed();
    // Wait for slot - 每次唤醒后重新获取 limit（可能动态变化）
    while (true) {
      const limit = await this._getEffectiveConcurrencyLimit();
      if (this._inFlight < limit) break;
      await this._waitForParallelSlot();
      if (this.signal.aborted) throw new Error("Run cancelled");
    }

    this._inFlight++;
    try {
      return await this._runStageNow(stageName, input);
    } finally {
      this._inFlight--;
      this._releaseParallelSlot();
    }
  },

  /**
   * @private
   * @returns {Promise<void>}
   */
  async _waitForParallelSlot() {
    if (this.signal.aborted) throw new Error("Run cancelled");
    return await new Promise((resolve, reject) => {
      const entry = { resolve, reject, onAbort: null };
      if (this.signal && typeof this.signal.addEventListener === "function") {
        entry.onAbort = () => {
          this._removeParallelWaiter(entry);
          reject(new Error("Run cancelled"));
        };
        this.signal.addEventListener("abort", entry.onAbort, { once: true });
      }
      this._parallelWaiters.push(entry);
    });
  },

  /**
   * @private
   * @param {{ resolve: Function, reject: Function, onAbort: Function | null }} entry
   * @returns {void}
   */
  _removeParallelWaiter(entry) {
    if (entry?.onAbort && this.signal && typeof this.signal.removeEventListener === "function") {
      this.signal.removeEventListener("abort", /** @type {EventListener} */ (entry.onAbort));
    }
    this._parallelWaiters = this._parallelWaiters.filter((w) => w !== entry);
  },

  /**
   * @private
   * @returns {void}
   */
  _releaseParallelSlot() {
    while (this._parallelWaiters.length) {
      const waiter = this._parallelWaiters.shift();
      if (!waiter) continue;
      if (waiter.onAbort && this.signal && typeof this.signal.removeEventListener === "function") {
        this.signal.removeEventListener("abort", waiter.onAbort);
      }
      waiter.resolve();
      break;
    }
  },

  /**
   * @private
   * @param {Error | string} reason
   * @returns {void}
   */
  _rejectParallelWaiters(reason) {
    if (!this._parallelWaiters.length) return;
    const err = reason instanceof Error ? reason : new Error(String(reason || "Orchestrator disposed"));
    const waiters = this._parallelWaiters.splice(0);
    for (const waiter of waiters) {
      if (!waiter) continue;
      if (waiter.onAbort && this.signal && typeof this.signal.removeEventListener === "function") {
        this.signal.removeEventListener("abort", waiter.onAbort);
      }
      waiter.reject(err);
    }
  },

  /**
   * @returns {Promise<number>}
   */
  async _getEffectiveConcurrencyLimit() {
    this._ensureNotDisposed();
    const limit = this._maxConcurrency;
    const matrix = await this._getDegradationMatrix();
    if (!matrix) return limit;
    try {
      if (!matrix.isFeatureEnabled("parallelRequests")) return 1;
    } catch {
      // ignore
    }
    return limit;
  },
};
