/**
 * Eval Harness - 评估执行引擎
 *
 * Responsibilities:
 * - Run tasks with multiple trials (to capture stochasticity)
 * - Record transcripts (inputs/outputs/tool calls/errors)
 * - Execute graders (sync/async)
 * - Aggregate per-task and per-suite metrics
 *
 * @module eval/harness
 */

import { defaultGraderRegistry } from "./graders/index.js";
import { aggregateResults, passAtK, passExpK } from "./metrics.js";

/**
 * @typedef {import('./types.js').EvalTask} EvalTask
 * @typedef {import('./types.js').EvalSuite} EvalSuite
 * @typedef {import('./types.js').Trial} Trial
 * @typedef {import('./types.js').Transcript} Transcript
 * @typedef {import('./types.js').TranscriptEntry} TranscriptEntry
 * @typedef {import('./types.js').GraderConfig} GraderConfig
 * @typedef {import('./types.js').GraderResult} GraderResult
 * @typedef {import('./types.js').TaskResult} TaskResult
 * @typedef {import('./types.js').EvalSuiteResult} EvalSuiteResult
 * @typedef {import('./types.js').TrialMetrics} TrialMetrics
 */

function now() {
  return Date.now();
}

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, Number(n)));
}

function toErrorObject(err) {
  if (!err) return { message: "Unknown error" };
  if (err instanceof Error) return { message: err.message, name: err.name, stack: err.stack };
  return { message: String(err) };
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function computeTrialMetrics(transcript) {
  const entries = Array.isArray(transcript?.entries) ? transcript.entries : [];
  const turns = entries.filter((e) => e?.type === "output").length;
  const toolCalls = entries.filter((e) => e?.type === "tool_call").length;
  const totalTokens = entries.reduce((acc, e) => {
    const m = e?.metadata;
    if (!m || typeof m !== "object") return acc;
    const direct = m.totalTokens ?? m.tokens ?? m.tokenCount;
    if (Number.isFinite(direct)) return acc + Number(direct);
    const usage = m.usage;
    if (usage && typeof usage === "object" && Number.isFinite(usage.total_tokens)) return acc + Number(usage.total_tokens);
    return acc;
  }, 0);

  const firstOutput = entries.find((e) => e?.type === "output");
  const timeToFirstToken = firstOutput && Number.isFinite(transcript?.startTime)
    ? Math.max(0, firstOutput.timestamp - transcript.startTime)
    : undefined;

  /** @type {TrialMetrics} */
  const metrics = { turns, toolCalls, totalTokens };
  if (timeToFirstToken !== undefined) metrics.timeToFirstToken = timeToFirstToken;
  return metrics;
}

function createLimiter(concurrency) {
  const limit = Number.isFinite(concurrency) ? Math.max(1, Math.floor(concurrency)) : 1;
  /** @type {Array<() => void>} */
  const queue = [];
  let active = 0;

  const next = () => {
    active--;
    const fn = queue.shift();
    if (fn) fn();
  };

  return async (fn) => {
    if (active >= limit) {
      await new Promise((resolve) => queue.push(resolve));
    }
    active++;
    try {
      return await fn();
    } finally {
      next();
    }
  };
}

function resolveAgentRunner(agent) {
  if (typeof agent === "function") return agent;
  if (!agent || typeof agent !== "object") return null;
  if (typeof agent.run === "function") return (input, ctx) => agent.run(input, ctx);
  if (typeof agent.execute === "function") return (input, ctx) => agent.execute(input, ctx);
  if (typeof agent.invoke === "function") return (input, ctx) => agent.invoke(input, ctx);
  return null;
}

function isCompositeType(type) {
  return type === "all_pass" || type === "weighted" || type === "threshold";
}

function selectFinalAggregatorIndex(graderConfigs) {
  if (!Array.isArray(graderConfigs)) return -1;

  let explicit = -1;
  for (let i = 0; i < graderConfigs.length; i++) {
    const g = graderConfigs[i];
    if (!g || typeof g !== "object") continue;
    const opt = asObject(g.options);
    if (opt?.final === true) explicit = i;
  }
  if (explicit !== -1) return explicit;

  for (let i = graderConfigs.length - 1; i >= 0; i--) {
    const g = graderConfigs[i];
    if (isCompositeType(g?.type)) return i;
  }
  return -1;
}

/**
 * Eval Harness - 评估执行引擎
 */
export class EvalHarness {
  constructor(options = {}) {
    this.agentFactory = options.agentFactory;
    this.graderRegistry = options.graderRegistry || defaultGraderRegistry;
    this.concurrency = Number.isFinite(options.concurrency) ? Math.max(1, Math.floor(options.concurrency)) : 4;
    this.trialsPerTask = Number.isFinite(options.trialsPerTask) ? Math.max(1, Math.floor(options.trialsPerTask)) : 3;
    this.recordEvents = options.recordEvents === true;
    this.llmClient = options.llmClient || null;
  }

  /**
   * 运行单个任务的多次试验
   * @param {EvalTask} task
   * @param {object} [options]
   * @param {number} [options.trialsPerTask]
   * @param {number} [options.passK] - pass@k / pass^k 的 k (默认 trialsPerTask)
   * @param {any} [options.llmClient] - judge graders 使用的 LLM client
   * @param {any} [options.context] - forwarded to agent runner
   * @returns {Promise<TaskResult>}
   */
  async runTask(task, options = {}) {
    if (!task || typeof task !== "object") throw new Error("EvalHarness.runTask(task): task must be an object");
    if (typeof task.id !== "string" || !task.id) throw new Error("EvalHarness.runTask(task): task.id must be a non-empty string");

    const trialsPerTask = Number.isFinite(options.trialsPerTask)
      ? Math.max(1, Math.floor(options.trialsPerTask))
      : this.trialsPerTask;

    const concurrency = Number.isFinite(options.concurrency)
      ? Math.max(1, Math.floor(options.concurrency))
      : this.concurrency;

    const limit = createLimiter(concurrency);

    /** @type {Trial[]} */
    const trials = new Array(trialsPerTask);
    const jobs = Array.from({ length: trialsPerTask }, (_v, trialIndex) => limit(async () => {
      const trial = await this._runTrial(task, trialIndex, options);
      trials[trialIndex] = trial;
    }));

    await Promise.all(jobs);

    const finalizedTrials = trials.filter(Boolean);
    const passRate = finalizedTrials.length === 0 ? 0 : finalizedTrials.filter((t) => t.passed).length / finalizedTrials.length;
    const k = Number.isFinite(options.passK) ? Math.max(1, Math.floor(options.passK)) : trialsPerTask;

    return {
      taskId: task.id,
      trials: finalizedTrials,
      passRate,
      passAtK: passAtK(finalizedTrials, k),
      passExpK: passExpK(finalizedTrials, k),
    };
  }

  /**
   * 运行评估套件
   * @param {EvalSuite} suite
   * @param {object} [options]
   * @param {number} [options.concurrency]
   * @param {number} [options.trialsPerTask]
   * @param {number} [options.passK]
   * @param {any} [options.llmClient]
   * @param {any} [options.context]
   * @returns {Promise<EvalSuiteResult>}
   */
  async runSuite(suite, options = {}) {
    if (!suite || typeof suite !== "object") throw new Error("EvalHarness.runSuite(suite): suite must be an object");
    const suiteId = typeof suite.suiteId === "string" && suite.suiteId ? suite.suiteId : "suite";
    const tasks = Array.isArray(suite.tasks) ? suite.tasks : [];

    const trialsPerTask = Number.isFinite(options.trialsPerTask)
      ? Math.max(1, Math.floor(options.trialsPerTask))
      : this.trialsPerTask;

    const concurrency = Number.isFinite(options.concurrency)
      ? Math.max(1, Math.floor(options.concurrency))
      : this.concurrency;

    const limit = createLimiter(concurrency);

    /** @type {Array<Trial[] | undefined>} */
    const trialsByTask = new Array(tasks.length);

    const jobs = [];
    for (let taskIndex = 0; taskIndex < tasks.length; taskIndex++) {
      const task = tasks[taskIndex];
      trialsByTask[taskIndex] = new Array(trialsPerTask);
      for (let trialIndex = 0; trialIndex < trialsPerTask; trialIndex++) {
        jobs.push(limit(async () => {
          const trial = await this._runTrial(task, trialIndex, options);
          trialsByTask[taskIndex][trialIndex] = trial;
        }));
      }
    }

    await Promise.all(jobs);

    /** @type {TaskResult[]} */
    const taskResults = tasks.map((task, idx) => {
      const trials = (trialsByTask[idx] || []).filter(Boolean);
      const passRate = trials.length === 0 ? 0 : trials.filter((t) => t.passed).length / trials.length;
      const k = Number.isFinite(options.passK) ? Math.max(1, Math.floor(options.passK)) : trialsPerTask;
      return {
        taskId: task.id,
        trials,
        passRate,
        passAtK: passAtK(trials, k),
        passExpK: passExpK(trials, k),
      };
    });

    const aggregated = aggregateResults(taskResults);
    return {
      suiteId,
      tasks: taskResults,
      aggregated,
    };
  }

  async _runTrial(task, trialIndex, options) {
    /** @type {unknown} */
    let agent = null;
    /** @type {unknown} */
    let outcome = null;
    /** @type {{ transcript: Transcript, record: (type: TranscriptEntry['type'], content: any, metadata?: any) => void, restore: () => void } | null} */
    let recorder = null;

    try {
      if (typeof this.agentFactory !== "function") {
        throw new Error("EvalHarness: agentFactory is required and must be a function");
      }

      agent = await this._createAgent(task, trialIndex, options);
      recorder = this._recordTranscript(agent, task, trialIndex, options);
      const { transcript, record } = recorder;

      // Record task input after instrumentation is installed.
      record("input", task.input, { taskId: task.id, trialIndex, description: task.description });

      const runner = resolveAgentRunner(agent);
      if (!runner) {
        throw new Error("Agent instance is not runnable (expected function or .run/.execute/.invoke)");
      }

      outcome = await runner(task.input, { task, trialIndex, ...(options.context && typeof options.context === "object" ? options.context : {}) });
      record("output", outcome, { taskId: task.id, trialIndex });
    } catch (err) {
      const errorObj = toErrorObject(err);
      outcome = { error: errorObj };
      if (!recorder) {
        recorder = this._recordTranscript(null, task, trialIndex, options);
        const taskId = task?.id ?? "unknown";
        const taskInput = task?.input;
        const taskDescription = task?.description;
        recorder.record("input", taskInput, { taskId, trialIndex, description: taskDescription });
      }
      const taskId = task?.id ?? "unknown";
      recorder.record("error", errorObj, { taskId, trialIndex });
    } finally {
      if (recorder) {
        recorder.transcript.endTime = now();
      }
      try {
        if (recorder) recorder.restore();
      } catch {
        // ignore restore errors
      }
      try {
        if (agent && (typeof agent === "object" || typeof agent === "function")) {
          const maybeDisposable = /** @type {{ dispose?: unknown }} */ (agent);
          const dispose = maybeDisposable.dispose;
          if (typeof dispose === "function") dispose.call(maybeDisposable);
        }
      } catch {
        // ignore dispose errors
      }
    }

    const transcript = recorder?.transcript || { entries: [], startTime: now(), endTime: now() };
    const latencyMs = transcript.endTime - transcript.startTime;
    const metrics = computeTrialMetrics(transcript);

    const graderResults = await this._runGraders(task, trialIndex, outcome, transcript, options);
    const { passed, score } = this._computeOverallResult(task, graderResults);

    /** @type {Trial} */
    return {
      taskId: task.id,
      trialIndex,
      transcript,
      outcome,
      graderResults,
      passed,
      score,
      latencyMs: Math.max(0, latencyMs),
      metrics,
    };
  }

  async _createAgent(task, trialIndex, options) {
    // Support both styles:
    // - (task, { trialIndex, ... }) => agent
    // - ({ task, trialIndex, ... }) => agent
    try {
      if (this.agentFactory.length >= 2) {
        return await this.agentFactory(task, { trialIndex, options });
      }
      return await this.agentFactory({ task, trialIndex, options });
    } catch (err) {
      throw new Error(`agentFactory failed for task ${task?.id || "unknown"}: ${err?.message || err}`);
    }
  }

  async _runGraders(task, trialIndex, outcome, transcript, options) {
    const configs = Array.isArray(task.graders) ? task.graders : [];
    const llmClient = options.llmClient || this.llmClient;

    /** @type {GraderResult[]} */
    const resultsByIndex = new Array(configs.length);

    // First pass: run non-composite graders (can be async).
    const baseConfigs = configs
      .map((cfg, idx) => ({ cfg, idx }))
      .filter(({ cfg }) => cfg && typeof cfg.type === "string" && !isCompositeType(cfg.type));

    const basePromises = baseConfigs.map(async ({ cfg, idx }) => {
      const grader = this.graderRegistry?.get?.(cfg.type);
      if (!grader) {
        return {
          idx,
          result: {
            graderType: cfg.type,
            passed: false,
            score: 0,
            reason: `Unknown grader type: ${cfg.type}`,
            issues: [{ type: "unknown_grader", severity: "error", message: `Unknown grader type: ${cfg.type}` }],
          },
        };
      }

      try {
        let r;
        if (cfg.type === "state_check") r = await grader.grade(outcome, cfg);
        else if (cfg.type === "tool_calls" || cfg.type === "transcript") r = await grader.grade(transcript, cfg);
        else if (cfg.type === "llm_rubric" || cfg.type === "llm_assertion") {
          r = await grader.grade({ output: outcome, expected: task.expected, task, transcript, trialIndex }, cfg, llmClient);
        }
        else if (cfg.type === "llm_pairwise") {
          const baseline = cfg.options && typeof cfg.options === "object"
            ? cfg.options.outputB ?? cfg.options.baseline ?? cfg.options.compareTo
            : undefined;
          if (baseline === undefined) {
            r = {
              graderType: cfg.type,
              passed: false,
              score: 0,
              reason: "llm_pairwise requires options.outputB/baseline/compareTo",
              issues: [{ type: "missing_baseline", severity: "error", message: "llm_pairwise requires options.outputB/baseline/compareTo" }],
            };
          } else {
            r = await grader.grade(outcome, baseline, cfg, llmClient);
          }
        } else {
          // Default: pass the raw outcome (most graders string-ify it anyway).
          r = await grader.grade(outcome, cfg, llmClient);
        }

        // Normalize basic invariants.
        const passed = r && typeof r.passed === "boolean" ? r.passed : false;
        const score = r && Number.isFinite(r.score) ? clamp01(r.score) : passed ? 1 : 0;

        return {
          idx,
          result: { graderType: cfg.type, ...r, passed, score },
        };
      } catch (err) {
        return {
          idx,
          result: {
            graderType: cfg.type,
            passed: false,
            score: 0,
            reason: `Grader failed: ${err?.message || err}`,
            issues: [{ type: "grader_error", severity: "error", message: `Grader failed: ${err?.message || err}` }],
          },
        };
      }
    });

    const baseResults = await Promise.all(basePromises);

    for (const { idx, result } of baseResults) resultsByIndex[idx] = result;

    // Second pass: composite graders (run in declaration order; can depend on previous results).
    for (let i = 0; i < configs.length; i++) {
      const cfg = configs[i];
      if (!cfg || typeof cfg.type !== "string") continue;
      if (!isCompositeType(cfg.type)) continue;

      const grader = this.graderRegistry?.get?.(cfg.type);
      if (!grader) {
        resultsByIndex[i] = {
          graderType: cfg.type,
          passed: false,
          score: 0,
          reason: `Unknown grader type: ${cfg.type}`,
          issues: [{ type: "unknown_grader", severity: "error", message: `Unknown grader type: ${cfg.type}` }],
        };
        continue;
      }

      try {
        const available = resultsByIndex.filter(Boolean);
        const r = await grader.grade(available, cfg, llmClient);
        const passed = r && typeof r.passed === "boolean" ? r.passed : false;
        const score = r && Number.isFinite(r.score) ? clamp01(r.score) : passed ? 1 : 0;
        resultsByIndex[i] = { graderType: cfg.type, ...r, passed, score };
      } catch (err) {
        resultsByIndex[i] = {
          graderType: cfg.type,
          passed: false,
          score: 0,
          reason: `Composite grader failed: ${err?.message || err}`,
          issues: [{ type: "grader_error", severity: "error", message: `Composite grader failed: ${err?.message || err}` }],
        };
      }
    }

    // Fill in any invalid/missing configs with explicit failures to keep alignment stable.
    for (let i = 0; i < configs.length; i++) {
      const cfg = configs[i];
      if (!cfg || typeof cfg.type !== "string") {
        resultsByIndex[i] = resultsByIndex[i] || {
          graderType: "invalid",
          passed: false,
          score: 0,
          reason: "Invalid grader config",
          issues: [{ type: "invalid_grader_config", severity: "error", message: "Invalid grader config" }],
        };
        continue;
      }
      if (!resultsByIndex[i]) {
        resultsByIndex[i] = {
          graderType: cfg.type,
          passed: false,
          score: 0,
          reason: `Missing grader result for ${cfg.type}`,
          issues: [{ type: "missing_grader_result", severity: "error", message: `Missing grader result for ${cfg.type}` }],
        };
      }
    }

    return resultsByIndex;
  }

  _computeOverallResult(task, graderResults) {
    const configs = Array.isArray(task.graders) ? task.graders : [];
    const finalIdx = selectFinalAggregatorIndex(configs);

    // If a composite grader is used as final aggregator, trust it.
    if (finalIdx !== -1) {
      const final = graderResults?.[finalIdx];
      if (final) return { passed: !!final.passed, score: clamp01(final.score) };
    }

    // Default: all base graders must pass; score is weighted avg.
    let passed = true;
    let totalWeight = 0;
    let sum = 0;

    for (let i = 0; i < configs.length; i++) {
      const cfg = configs[i];
      if (!cfg || typeof cfg.type !== "string") continue;
      if (isCompositeType(cfg.type)) continue;

      const r = graderResults?.[i];
      if (!r) continue;

      passed = passed && !!r.passed;
      const w = Number.isFinite(cfg.weight) ? Number(cfg.weight) : 1;
      totalWeight += w;
      sum += clamp01(r.score) * w;
    }

    const score = totalWeight > 0 ? sum / totalWeight : 0;
    return { passed, score: clamp01(score) };
  }

  /**
   * 记录 transcript
   * @param {any} agent
   * @param {EvalTask} task
   * @param {number} trialIndex
   * @param {any} [options]
   * @returns {{ transcript: Transcript, record: (type: TranscriptEntry['type'], content: any, metadata?: any) => void, restore: () => void }}
   */
  _recordTranscript(agent, task, trialIndex, options = {}) {
    /** @type {Transcript} */
    const transcript = {
      entries: [],
      startTime: now(),
      endTime: now(),
    };

    const record = (type, content, metadata) => {
      /** @type {TranscriptEntry} */
      const entry = {
        type,
        content,
        timestamp: now(),
      };
      if (metadata && typeof metadata === "object") entry.metadata = metadata;
      transcript.entries.push(entry);
    };

    /** @type {Array<() => void>} */
    const restorers = [];

    const recordEvents = options.recordEvents === true || this.recordEvents === true;

    // Instrument toolExecutor if present (preferred for precise tool_call/tool_result pairs).
    if (agent && typeof agent === "object" && typeof agent.toolExecutor === "function") {
      // Z2: check property descriptor before monkey-patching
      const desc = Object.getOwnPropertyDescriptor(agent, "toolExecutor") || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(agent) || {}, "toolExecutor");
      if (desc && desc.writable === false) {
        // Cannot patch — skip instrumentation silently
      } else {
      const original = agent.toolExecutor;
      agent.toolExecutor = async (name, params, ctx) => {
        record("tool_call", { name, args: params }, { taskId: task.id, trialIndex });
        try {
          const result = await original(name, params, ctx);
          record("tool_result", { name, result }, { taskId: task.id, trialIndex });
          return result;
        } catch (err) {
          record("tool_result", { name, error: toErrorObject(err) }, { taskId: task.id, trialIndex });
          throw err;
        }
      };
      restorers.push(() => {
        agent.toolExecutor = original;
      });
      } // end else (writable check)
    }

    // Best-effort event subscription (optional; can be noisy).
    if (recordEvents) {
      const eventBus = agent?.eventBus;
      const subscribe = eventBus && typeof eventBus.subscribe === "function"
        ? (pattern, handler) => eventBus.subscribe(pattern, handler)
        : typeof agent?.on === "function"
          ? (pattern, handler) => agent.on(pattern, handler)
          : null;

      if (subscribe) {
        const unsubscribe = subscribe("*", (evt) => {
          const name = typeof evt?.name === "string" ? evt.name : typeof evt?.type === "string" ? evt.type : "event";
          record("event", { name, payload: evt?.payload }, { taskId: task.id, trialIndex });
        });
        if (typeof unsubscribe === "function") restorers.push(unsubscribe);
      }
    }

    const restore = () => {
      for (const fn of restorers.splice(0)) {
        try { fn(); } catch { /* intentional: restore cleanup */ }
      }
    };

    return { transcript, record, restore };
  }
}
