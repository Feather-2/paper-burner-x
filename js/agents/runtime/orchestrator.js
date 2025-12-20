import { EventBus } from "./event-bus.js";
import { RunContext } from "./run-context.js";
import { ActorType, OrchestratorState, isValidOrchestratorState } from "./constants.js";
import { RuntimeEvents } from "./events.js";

/**
 * 拓扑排序 - 计算 Stage 执行顺序
 * @param {Map} stages - name -> { dependsOn: string[] }
 * @returns {{ sorted: string[], layers: string[][] }} 排序结果和并行层级
 */
function topologicalSort(stages) {
  const inDegree = new Map();
  const adjList = new Map();
  const allNames = [...stages.keys()];

  // 初始化
  for (const name of allNames) {
    inDegree.set(name, 0);
    adjList.set(name, []);
  }

  // 构建图
  for (const [name, stage] of stages) {
    const deps = Array.isArray(stage.dependsOn) ? stage.dependsOn : [];
    for (const dep of deps) {
      if (!stages.has(dep)) {
        throw new Error(`Stage "${name}" depends on unknown stage "${dep}"`);
      }
      adjList.get(dep).push(name);
      inDegree.set(name, inDegree.get(name) + 1);
    }
  }

  // Kahn's algorithm with layer tracking
  const sorted = [];
  const layers = [];
  let queue = allNames.filter((n) => inDegree.get(n) === 0);

  while (queue.length > 0) {
    layers.push([...queue]); // 同一层可并行
    const nextQueue = [];

    for (const node of queue) {
      sorted.push(node);
      for (const neighbor of adjList.get(node)) {
        inDegree.set(neighbor, inDegree.get(neighbor) - 1);
        if (inDegree.get(neighbor) === 0) {
          nextQueue.push(neighbor);
        }
      }
    }
    queue = nextQueue;
  }

  if (sorted.length !== allNames.length) {
    const remaining = allNames.filter((n) => !sorted.includes(n));
    throw new Error(`Circular dependency detected involving: ${remaining.join(", ")}`);
  }

  return { sorted, layers };
}

class StageTimeoutError extends Error {
  constructor(message, { stageName, timeoutMs } = {}) {
    super(message);
    this.name = "StageTimeoutError";
    this.stageName = stageName;
    this.timeoutMs = timeoutMs;
  }
}

class StageCancelledError extends Error {
  constructor(message, { stageName } = {}) {
    super(message);
    this.name = "StageCancelledError";
    this.stageName = stageName;
  }
}

function makeCombinedSignal(signals) {
  const alive = signals.filter(Boolean);
  if (alive.length === 0) return undefined;
  if (alive.length === 1) return alive[0];

  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.any === "function") {
    return AbortSignal.any(alive);
  }

  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  for (const s of alive) {
    if (s.aborted) return s;
    s.addEventListener("abort", onAbort, { once: true });
  }
  return ctrl.signal;
}

function abortErrorFromSignal(signal, stageName) {
  const reason = signal?.reason;
  const msg = typeof reason === "string" ? reason : "Run cancelled";
  return new StageCancelledError(msg, { stageName });
}

export class AgentOrchestrator {
  constructor({ mode, scenario, constraints, runId, eventBus, services } = {}) {
    this.runContext = new RunContext({ runId, mode, scenario, constraints });
    this.eventBus = eventBus || new EventBus({ runId: this.runContext.runId });
    this._services = services && typeof services === "object" ? services : {};

    this._stages = new Map(); // name -> { fn, actor, timeoutMs }
    this._runAbort = new AbortController();
    this._state = OrchestratorState.IDLE;
  }

  get state() {
    return this._state;
  }

  /**
   * 注册一个 Stage
   * @param {string} name - Stage 名称
   * @param {Function} fn - Stage 执行函数
   * @param {Object} options - 选项
   * @param {string} [options.actor="system"] - 执行者类型
   * @param {number} [options.timeoutMs] - 超时时间
   * @param {string[]} [options.dependsOn] - 依赖的 Stage 名称列表
   * @param {Function} [options.condition] - 条件函数，返回 true 才执行
   */
  registerStage(name, fn, { actor = "system", timeoutMs, dependsOn, condition } = {}) {
    if (typeof fn !== "function") {
      throw new TypeError("registerStage(name, fn): fn must be a function");
    }
    if (dependsOn !== undefined && !Array.isArray(dependsOn)) {
      throw new TypeError("registerStage(name, fn, { dependsOn }): dependsOn must be an array");
    }
    if (condition !== undefined && typeof condition !== "function") {
      throw new TypeError("registerStage(name, fn, { condition }): condition must be a function");
    }
    this._stages.set(name, { fn, actor, timeoutMs, dependsOn, condition });
  }

  /**
   * 获取 Stage 的拓扑排序结果
   * @returns {{ sorted: string[], layers: string[][] }}
   */
  getExecutionPlan() {
    return topologicalSort(this._stages);
  }

  start({ payload } = {}) {
    if (this._state !== OrchestratorState.IDLE) return;
    this._state = OrchestratorState.RUNNING;
    this.eventBus.emit(RuntimeEvents.RUN_STARTED, {
      actor: ActorType.SYSTEM,
      status: "started",
      payload: {
        mode: this.runContext.mode,
        scenario: this.runContext.scenario,
        constraints: this.runContext.constraints,
        ...(payload || {}),
      },
    });
  }

  stop(reason = "cancelled") {
    if (this._state !== OrchestratorState.RUNNING) return;
    this._state = OrchestratorState.CANCELLED;
    this._runAbort.abort(reason);
    this.eventBus.emit(RuntimeEvents.RUN_CANCELLED, {
      actor: ActorType.SYSTEM,
      status: "cancelled",
      payload: { reason },
    });
  }

  end({ payload } = {}) {
    if (this._state !== OrchestratorState.RUNNING) return;
    this._state = OrchestratorState.ENDED;
    this.eventBus.emit(RuntimeEvents.RUN_COMPLETED, {
      actor: ActorType.SYSTEM,
      status: "completed",
      payload,
    });
  }

  async run(pipelineFn) {
    this.start();
    try {
      const result = await pipelineFn(this);
      if (this._state === OrchestratorState.RUNNING) this.end();
      return result;
    } catch (err) {
      if (this._state === OrchestratorState.CANCELLED) throw err;
      this._state = OrchestratorState.FAILED;
      this.eventBus.emit(RuntimeEvents.RUN_FAILED, {
        actor: ActorType.SYSTEM,
        status: "failed",
        payload: { message: err?.message, name: err?.name },
      });
      throw err;
    }
  }

  /**
   * 按 DAG 依赖关系自动执行所有注册的 Stage
   * @param {Object} [options] - 执行选项
   * @param {Object} [options.initialInput] - 初始输入
   * @param {boolean} [options.parallel=true] - 是否并行执行同层 Stage
   * @param {Function} [options.onStageResult] - Stage 完成回调 (name, result) => void
   * @param {boolean} [options.skipOnDependencySkipped=true] - 依赖被跳过时是否也跳过
   * @returns {Promise<Map<string, any>>} 各 Stage 的执行结果
   */
  async runDAG({ initialInput, parallel = true, onStageResult, skipOnDependencySkipped = true } = {}) {
    this.start({ payload: { mode: "dag", parallel } });

    const results = new Map();
    const skipped = new Set();

    try {
      const { layers } = this.getExecutionPlan();

      for (const layer of layers) {
        if (this._state !== OrchestratorState.RUNNING) break;

        // 过滤掉条件不满足的 Stage
        const toRun = [];
        for (const name of layer) {
          const stage = this._stages.get(name);

          // 检查依赖是否被跳过
          if (skipOnDependencySkipped && stage.dependsOn?.length) {
            const hasSkippedDep = stage.dependsOn.some((dep) => skipped.has(dep));
            if (hasSkippedDep) {
              skipped.add(name);
              this.eventBus.emit(`${name}.skipped`, {
                actor: stage.actor || "system",
                status: "skipped",
                payload: { reason: "dependency_skipped" },
              });
              continue;
            }
          }

          // 检查条件
          if (stage.condition) {
            const shouldRun = await stage.condition(this.runContext, results);
            if (!shouldRun) {
              skipped.add(name);
              this.eventBus.emit(`${name}.skipped`, {
                actor: stage.actor || "system",
                status: "skipped",
                payload: { reason: "condition_false" },
              });
              continue;
            }
          }
          toRun.push(name);
        }

        if (toRun.length === 0) continue;

        // 收集依赖的输出作为输入
        const getInput = (name) => {
          const stage = this._stages.get(name);
          const deps = stage.dependsOn || [];
          if (deps.length === 0) return initialInput;
          if (deps.length === 1) return results.get(deps[0]);
          // 多依赖时合并为对象
          const merged = {};
          for (const dep of deps) {
            merged[dep] = results.get(dep);
          }
          return merged;
        };

        if (parallel && toRun.length > 1) {
          // 并行执行同层 Stage，使用 AbortController 支持取消
          const layerAbort = new AbortController();
          let firstError = null;

          const promises = toRun.map(async (name) => {
            try {
              // 如果已经有错误，直接返回
              if (layerAbort.signal.aborted) {
                return { name, status: "cancelled" };
              }
              const input = getInput(name);
              const result = await this.runStage(name, input);
              results.set(name, result);
              onStageResult?.(name, result);
              return { name, status: "success", result };
            } catch (err) {
              // 第一个错误触发取消
              if (!firstError) {
                firstError = err;
                layerAbort.abort(err.message);
              }
              return { name, status: "failed", error: err };
            }
          });

          const settled = await Promise.all(promises);

          // 如果有失败的，抛出第一个错误
          if (firstError) {
            throw firstError;
          }
        } else {
          // 顺序执行
          for (const name of toRun) {
            const input = getInput(name);
            const result = await this.runStage(name, input);
            results.set(name, result);
            onStageResult?.(name, result);
          }
        }
      }

      if (this._state === OrchestratorState.RUNNING) {
        this.end({ payload: { stagesRun: results.size, stagesSkipped: skipped.size } });
      }
      return results;
    } catch (err) {
      if (this._state === OrchestratorState.CANCELLED) throw err;
      this._state = OrchestratorState.FAILED;
      this.eventBus.emit(RuntimeEvents.RUN_FAILED, {
        actor: ActorType.SYSTEM,
        status: "failed",
        payload: { message: err?.message, name: err?.name, results: [...results.keys()] },
      });
      throw err;
    }
  }

  async runStage(name, input, { timeoutMs, actor, payload } = {}) {
    if (this._state === OrchestratorState.IDLE) this.start();
    if (this._state !== OrchestratorState.RUNNING) {
      throw new Error(`Cannot run stage when orchestrator state=${this._state}`);
    }

    const stage = this._stages.get(name);
    if (!stage) {
      throw new Error(`Stage not registered: ${name}`);
    }

    const stageActor = actor ?? stage.actor ?? "system";
    const stageTimeoutMs = timeoutMs ?? stage.timeoutMs;
    const startedAt = Date.now();

    this.eventBus.emit(`${name}.started`, {
      actor: stageActor,
      status: "started",
      payload,
    });

    const timeoutCtrl = typeof stageTimeoutMs === "number" ? new AbortController() : null;
    let timer = null;
    if (timeoutCtrl) {
      timer = setTimeout(() => timeoutCtrl.abort("timeout"), stageTimeoutMs);
    }

    const signal = makeCombinedSignal([this._runAbort.signal, timeoutCtrl?.signal]);
    const stageApi = {
      runContext: this.runContext,
      signal,
      eventBus: this.eventBus,
      emit: (eventName, record) => this.eventBus.emit(eventName, record),
      progress: (progressPayload, extra = {}) =>
        this.eventBus.emit(`${name}.progress`, {
          actor: stageActor,
          status: "progress",
          payload: progressPayload,
          ...extra,
        }),
      checkCancelled: () => {
        if (signal?.aborted) throw abortErrorFromSignal(signal, name);
      },
      // Inject services (aiApiService, modelRouter, visionApi, etc.)
      ...this._services,
    };

    const stagePromise = (async () => stage.fn(this.runContext, input, stageApi))();

    try {
      const result = await Promise.race([
        stagePromise,
        new Promise((_, reject) => {
          if (!signal) return;
          if (signal.aborted) return reject(abortErrorFromSignal(signal, name));
          signal.addEventListener(
            "abort",
            () => {
              if (timeoutCtrl?.signal.aborted) {
                reject(new StageTimeoutError(`Stage timed out: ${name}`, { stageName: name, timeoutMs: stageTimeoutMs }));
              } else {
                reject(abortErrorFromSignal(signal, name));
              }
            },
            { once: true }
          );
        }),
      ]);

      const durationMs = Date.now() - startedAt;
      this.eventBus.emit(`${name}.completed`, {
        actor: stageActor,
        status: "completed",
        durationMs,
      });
      // 过渡期兼容：同时 emit .ended 别名
      this.eventBus.emit(`${name}.ended`, {
        actor: stageActor,
        status: "ended",
        durationMs,
      });
      return result;
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      this.eventBus.emit(`${name}.failed`, {
        actor: stageActor,
        status: "failed",
        durationMs,
        payload: { message: err?.message, name: err?.name },
      });
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

// Expose common error types without exporting extra classes from this module.
AgentOrchestrator.StageTimeoutError = StageTimeoutError;
AgentOrchestrator.StageCancelledError = StageCancelledError;

// Export topologicalSort for testing
export { topologicalSort };
