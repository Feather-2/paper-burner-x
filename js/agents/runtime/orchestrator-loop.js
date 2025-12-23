import { BaseAgentLoop, checkCancelledOrPaused } from "./agent-loop.js";
import { ensureRuntimeState, LoopRuntimeStatuses } from "./loop-runtime-state.js";
import { RequirementAnalyzer } from "./requirement-analyzer.js";
import { CapabilityLoader } from "./capability-loader.js";
import { RouterAgent } from "./router-agent.js";
import { CicadaCompressor } from "./cicada-compressor.js";
import { BlockDAGExecutor } from "./block-dag-executor.js";
import { Archive, MapAdapter } from "../shared/archive.js";
import { AsyncCompressor } from "./async-compressor.js";
import { ReviewRules } from "./review-rules.js";
import { ArchiveEvents, CompressionEvents, EventStatus, ReviewEvents, RuntimeEvents } from "./events.js";
import { createStageApi } from "../shared/stage-api.js";
import { StagePausedError } from "./stage-errors.js";
import { safeInt, safeNumber } from "../shared/value-utils.js";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function recordPausedRun(runStore, runId, { checkpointId, reason, timestamp } = {}) {
  const store = runStore && typeof runStore === "object" ? runStore : null;
  if (!store) return;
  if (typeof store.updateManifest !== "function") return;

  try {
    const existing = typeof store.getManifest === "function" ? await store.getManifest(runId) : null;
    const manifest = isPlainObject(existing)
      ? { ...existing }
      : { schemaVersion: "0.1", runId, createdAt: new Date().toISOString(), artifacts: [] };

    const runtime = isPlainObject(manifest.runtime) ? { ...manifest.runtime } : {};
    runtime.status = "paused";
    runtime.pausedCheckpointId = typeof checkpointId === "string" && checkpointId ? checkpointId : null;
    runtime.pausedReason = typeof reason === "string" && reason ? reason : null;
    runtime.pausedAt = typeof timestamp === "string" && timestamp ? timestamp : new Date().toISOString();
    manifest.runtime = runtime;

    await store.updateManifest(runId, manifest);
  } catch {
    // ignore runStore persistence errors
  }
}

export const defaultOptions = Object.freeze({
  maxIterations: 0,
  timeout: 0,
  enableCompression: true,
  enableReview: true,
  enableAsyncCompression: true,
  compressionLayers: ["tool_output", "session_history", "llm_summary"],
});

function withDefaults(opts = {}) {
  const raw = opts && typeof opts === "object" ? opts : {};
  return {
    ...defaultOptions,
    ...raw,
    maxIterations: Number.isFinite(raw.maxIterations) ? raw.maxIterations : defaultOptions.maxIterations,
    timeout: Number.isFinite(raw.timeout) ? raw.timeout : defaultOptions.timeout,
    enableCompression: raw.enableCompression !== false,
    enableReview: raw.enableReview !== false,
    enableAsyncCompression: raw.enableAsyncCompression !== false,
    compressionLayers:
      Array.isArray(raw.compressionLayers) && raw.compressionLayers.length
        ? raw.compressionLayers
        : defaultOptions.compressionLayers,
  };
}

function mergeSignals(a, b) {
  const signals = [a, b].filter(Boolean);
  if (signals.length === 0) return null;
  if (signals.length === 1) return signals[0];
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.any === "function") return AbortSignal.any(signals);

  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const s of signals) {
    if (s.aborted) return s;
    s.addEventListener?.("abort", abort, { once: true });
  }
  return controller.signal;
}

function normalizeStageDescriptor(stage) {
  if (typeof stage === "string") {
    const name = stage.trim();
    return name ? { id: name, block: name, dependsOn: [] } : null;
  }
  if (!stage || typeof stage !== "object") return null;

  const id = typeof stage.id === "string" ? stage.id.trim() : "";
  const name = typeof stage.name === "string" ? stage.name.trim() : "";
  const block = typeof stage.block === "string" ? stage.block.trim() : "";

  const resolvedId = id || name || block;
  const resolvedBlock = block || name || id;
  if (!resolvedId || !resolvedBlock) return null;

  const dependsOn = Array.isArray(stage.dependsOn)
    ? stage.dependsOn.map((dep) => (typeof dep === "string" ? dep.trim() : "")).filter(Boolean)
    : [];

  const node = { id: resolvedId, block: resolvedBlock, dependsOn };

  if (typeof stage.timeoutMs === "number" && Number.isFinite(stage.timeoutMs) && stage.timeoutMs > 0) {
    node.timeoutMs = stage.timeoutMs;
  }
  if (typeof stage.condition === "function") {
    node.condition = stage.condition;
  }

  return node;
}

function buildDagFromStages(stages) {
  const list = Array.isArray(stages) ? stages : [];
  const nodes = [];
  for (const stage of list) {
    const node = normalizeStageDescriptor(stage);
    if (!node) continue;
    nodes.push(node);
  }
  return { nodes };
}

const DEFAULT_COMPRESSION_POLICY = Object.freeze({
  maxContextTokens: 0,
  reserveOutputTokens: 0,
  safetyBufferTokens: 0,
  targetUsage: 0.6,
  highWater: 0.75,
  lowWater: 0.55,
  critical: 0.95,
  horizonSteps: 2,
  cooldownTurns: 2,
  minDeltaTokens: 1200,
  graceTurns: 1,
  autoCompress: false,
  estimateTarget: "results",
});

function clampRatio(value, fallback) {
  const n = safeNumber(value);
  if (n === null) return fallback;
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

function normalizeInt(value, fallback) {
  const n = safeInt(value);
  return n === null ? fallback : Math.max(0, n);
}

function normalizeCompressionPolicy(raw, fallback) {
  const base = isPlainObject(fallback) ? fallback : {};
  const cfg = isPlainObject(raw) ? raw : {};

  const maxContextTokens = safeInt(cfg.maxContextTokens ?? cfg.maxTokens ?? cfg.contextTokens ?? base.maxContextTokens) ?? 0;
  const reserveOutputTokens = safeInt(cfg.reserveOutputTokens ?? cfg.reserveTokens ?? base.reserveOutputTokens) ?? 0;
  const safetyBufferTokens = safeInt(cfg.safetyBufferTokens ?? cfg.safetyBuffer ?? base.safetyBufferTokens) ?? 0;
  const targetUsage = clampRatio(cfg.targetUsage ?? base.targetUsage ?? DEFAULT_COMPRESSION_POLICY.targetUsage, DEFAULT_COMPRESSION_POLICY.targetUsage);
  const highWater = clampRatio(cfg.highWater ?? cfg.softHigh ?? base.highWater ?? DEFAULT_COMPRESSION_POLICY.highWater, DEFAULT_COMPRESSION_POLICY.highWater);
  const lowWater = clampRatio(cfg.lowWater ?? cfg.softLow ?? base.lowWater ?? DEFAULT_COMPRESSION_POLICY.lowWater, DEFAULT_COMPRESSION_POLICY.lowWater);
  const critical = clampRatio(cfg.critical ?? cfg.forceAt ?? base.critical ?? DEFAULT_COMPRESSION_POLICY.critical, DEFAULT_COMPRESSION_POLICY.critical);
  const horizonSteps = normalizeInt(cfg.horizonSteps ?? base.horizonSteps ?? DEFAULT_COMPRESSION_POLICY.horizonSteps, DEFAULT_COMPRESSION_POLICY.horizonSteps);
  const cooldownTurns = normalizeInt(cfg.cooldownTurns ?? base.cooldownTurns ?? DEFAULT_COMPRESSION_POLICY.cooldownTurns, DEFAULT_COMPRESSION_POLICY.cooldownTurns);
  const minDeltaTokens = normalizeInt(cfg.minDeltaTokens ?? base.minDeltaTokens ?? DEFAULT_COMPRESSION_POLICY.minDeltaTokens, DEFAULT_COMPRESSION_POLICY.minDeltaTokens);
  const graceTurns = normalizeInt(cfg.graceTurns ?? base.graceTurns ?? DEFAULT_COMPRESSION_POLICY.graceTurns, DEFAULT_COMPRESSION_POLICY.graceTurns);
  const autoCompress = cfg.autoCompress === true || base.autoCompress === true;
  const estimateTarget = typeof cfg.estimateTarget === "string"
    ? cfg.estimateTarget
    : (typeof base.estimateTarget === "string" ? base.estimateTarget : DEFAULT_COMPRESSION_POLICY.estimateTarget);
  const estimateTokens =
    typeof cfg.estimateTokens === "function"
      ? cfg.estimateTokens
      : (typeof base.estimateTokens === "function" ? base.estimateTokens : null);

  const enabled = cfg.enabled !== undefined
    ? Boolean(cfg.enabled)
    : maxContextTokens > 0;

  return {
    ...DEFAULT_COMPRESSION_POLICY,
    ...base,
    ...cfg,
    maxContextTokens,
    reserveOutputTokens,
    safetyBufferTokens,
    targetUsage,
    highWater,
    lowWater,
    critical,
    horizonSteps,
    cooldownTurns,
    minDeltaTokens,
    graceTurns,
    autoCompress,
    estimateTarget,
    estimateTokens,
    enabled,
  };
}

function estimateTokensForValue(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === "string") return Math.ceil(value.length / 4);
  try {
    const text = JSON.stringify(value);
    return Math.ceil(text.length / 4);
  } catch {
    return Math.ceil(String(value ?? "").length / 4);
  }
}

function selectCompressionLayers(pressure, policy, fallbackLayers) {
  const forceLayers = Array.isArray(policy?.forceLayers) ? policy.forceLayers : fallbackLayers;
  const mediumLayers = Array.isArray(policy?.mediumLayers)
    ? policy.mediumLayers
    : ["tool_output", "session_history"];
  const lowLayers = Array.isArray(policy?.lowLayers)
    ? policy.lowLayers
    : ["tool_output"];

  if (typeof pressure !== "number" || !Number.isFinite(pressure)) return lowLayers;
  if (pressure >= policy.critical) return forceLayers;
  if (pressure >= policy.highWater + 0.08) return mediumLayers;
  return lowLayers;
}

function buildCompressionHint(advice) {
  if (!advice) return "";
  const mode = advice.mode;
  if (mode !== "advice" && mode !== "force") return "";
  const pct = Math.round((advice.pressure || 0) * 100);
  const predicted = safeInt(advice.predictedTokens) ?? 0;
  const budget = safeInt(advice.budgetTokens) ?? 0;
  const layers = Array.isArray(advice.suggestedLayers) ? advice.suggestedLayers.join(", ") : "";
  const action = mode === "force"
    ? "Context near limit; compression forced. Older details may be summarized."
    : "Context pressure high; you may compress older memory if needed.";
  const layerHint = layers ? ` Suggested layers: ${layers}.` : "";
  return `Context pressure ${pct}% (predicted ${predicted}/${budget} tokens). ${action}${layerHint}`;
}

export class OrchestratorLoop extends BaseAgentLoop {
  constructor(deps = {}, opts = {}) {
    super({ eventBus: deps.eventBus, actor: "orchestrator", stageName: "orchestrator" });

    this.opts = withDefaults(opts);

    const rawOpts = opts && typeof opts === "object" ? opts : {};
    const injectedArchive = deps.archive;
    const isArchiveAdapter =
      injectedArchive &&
      typeof injectedArchive === "object" &&
      typeof injectedArchive.get === "function" &&
      typeof injectedArchive.set === "function" &&
      typeof injectedArchive.delete === "function" &&
      typeof injectedArchive.keys === "function";

    this.archive =
      injectedArchive && typeof injectedArchive === "object" && typeof injectedArchive.save === "function"
        ? injectedArchive
        : isArchiveAdapter
          ? new Archive(injectedArchive)
          : new Archive(new MapAdapter());

    this.analyzer =
      deps.requirementAnalyzer ??
      new RequirementAnalyzer({
        shadowModel: deps.shadowModel,
        mcpNexus: deps.mcpNexus,
        skillRegistry: deps.skillRegistry,
        blockRegistry: deps.blockRegistry,
      });

    this.loader =
      deps.capabilityLoader ??
      new CapabilityLoader({ blockRegistry: deps.blockRegistry, skillRegistry: deps.skillRegistry, mcpNexus: deps.mcpNexus });

    this.router =
      deps.routerAgent ??
      new RouterAgent({
        modelRouter: deps.modelRouter,
        blockRegistry: deps.blockRegistry,
        modelTier: deps.modelTier,
        eventBus: deps.eventBus,
        dagExecutor: deps.dagExecutor,
      });

    this.compressor =
      deps.cicadaCompressor ??
      new CicadaCompressor({
        modelRouter: deps.modelRouter,
        archive: this.archive?.storage ?? injectedArchive,
        eventBus: deps.eventBus,
      });

    this.asyncCompressor =
      deps.asyncCompressor ??
      new AsyncCompressor({
        cicada: this.compressor,
        layers:
          Array.isArray(rawOpts.compressionLayers) && rawOpts.compressionLayers.length
            ? rawOpts.compressionLayers
            : ["tool_output"],
      });

    this.reviewRules = deps.reviewRules ?? new ReviewRules();

    this.dagExecutor = deps.dagExecutor ?? (deps.blockRegistry ? new BlockDAGExecutor(deps.blockRegistry, { eventBus: deps.eventBus }) : null);

    this._iteration = 0;
    this._compressionState = {
      lastTokens: null,
      lastAdviceTurn: -Infinity,
      lastForcedTurn: -Infinity,
    };
  }

  async run(task, context = {}) {
    const runId =
      (context && typeof context === "object" && (context.runId || context.runContext?.runId)) ||
      `run_${Date.now()}`;

    const eventBus = context.eventBus || this.eventBus || null;
    this.eventBus = eventBus;
    this.emit = typeof context.emit === "function" ? context.emit : this.emit;

    if (this.router) this.router.eventBus = eventBus;
    if (this.compressor) this.compressor.eventBus = eventBus;
    if (this.dagExecutor) this.dagExecutor.eventBus = eventBus;

    let timeoutId = null;
    let timeoutSignal = null;
    if (this.opts.timeout > 0) {
      const controller = new AbortController();
      timeoutSignal = controller.signal;
      timeoutId = setTimeout(() => controller.abort("timeout"), this.opts.timeout);
    }

    const signal = mergeSignals(context.signal, timeoutSignal) || context.signal || timeoutSignal || new AbortController().signal;

    const runContext = {
      ...(context.runContext && typeof context.runContext === "object" ? context.runContext : {}),
      runId,
    };

    const stageResults =
      context?.stageResults && (typeof context.stageResults === "object" || context.stageResults instanceof Map)
        ? context.stageResults
        : {};

    const runtimeHints = isPlainObject(context?.runtimeHints) ? { ...context.runtimeHints } : {};
    const stageContext = { ...context, runId, signal, runContext, stageResults, runtimeHints };

    const runtimeState = ensureRuntimeState(signal, {
      status: LoopRuntimeStatuses.RUNNING,
      cursor: null,
      pausedReason: null,
      lastCheckpointId: null,
    });

    this._emit(RuntimeEvents.RUN_STARTED, { runId, task }, EventStatus.STARTED);
    this._iteration = 0;
    this._compressionState = {
      lastTokens: null,
      lastAdviceTurn: -Infinity,
      lastForcedTurn: -Infinity,
    };

    const compressionPolicy = normalizeCompressionPolicy(
      context?.compressionPolicy ??
        (isPlainObject(context) && safeInt(context?.maxContextTokens) ? { maxContextTokens: context.maxContextTokens } : {}),
      this.opts.compressionPolicy
    );
    const policyEnabled = compressionPolicy.enabled === true;
    let turnCount = 0;

    let checkpointClockMs = 0;
    const nextCheckpointTimestamp = () => {
      const now = Date.now();
      checkpointClockMs = Math.max(now, checkpointClockMs + 1);
      return new Date(checkpointClockMs).toISOString();
    };

    let analysis = null;
    let plan = null;

    try {
      analysis = await this._runStage(runId, "analyze", signal, () => this.analyzer.analyze(task, stageContext), "analysis");

      await this._runStage(runId, "load_capabilities", signal, () => this.loader.loadRequired(analysis.requiredCapabilities));

      plan = await this._runStage(runId, "plan", signal, () => this.router.plan(task, { ...stageContext, analysis }), "plan");

      const initialInput = this._buildInitialInput(task, context);

      const blockApi = createStageApi({
        ...(context.blockApi && typeof context.blockApi === "object" ? context.blockApi : {}),
        runContext,
        signal,
        eventBus,
        modelRouter: context.modelRouter || this.router.modelRouter || this.compressor.modelRouter || null,
        aiApiService: context.aiApiService,
        localRetriever: context.localRetriever,
        externalSearchProvider: context.externalSearchProvider,
        logger: context.logger,
        checkCancelled: () => checkCancelledOrPaused(signal),
        stageResults,
        runtimeHints,
      });

      const snapshotStageResults = () => {
        if (stageResults instanceof Map) {
          return Object.fromEntries(stageResults.entries());
        }
        if (stageResults && typeof stageResults === "object") {
          return { ...stageResults };
        }
        return {};
      };

      const applyReadyCompressions = () => {
        if (!this.opts.enableAsyncCompression || !this.asyncCompressor) return;
        const ready = this.asyncCompressor.getStatus().ready;
        if (ready.length === 0) return;
        this.asyncCompressor.applyReady(stageContext);
        for (const stageId of ready) {
          this._emit(CompressionEvents.COMPRESSION_APPLIED, { stageId, status: "applied" }, EventStatus.INFO);
        }
      };

      const evaluateCompression = (stageId, result, turn) => {
        if (!policyEnabled) return null;
        const target =
          compressionPolicy.estimateTarget === "stage"
            ? result
            : snapshotStageResults();
        const estimator = typeof compressionPolicy.estimateTokens === "function"
          ? compressionPolicy.estimateTokens
          : estimateTokensForValue;
        const currentTokens = Math.max(0, estimator(target));
        const prevTokens =
          typeof this._compressionState.lastTokens === "number"
            ? this._compressionState.lastTokens
            : currentTokens;
        const growthTokens = currentTokens - prevTokens;
        this._compressionState.lastTokens = currentTokens;

        const budgetTokens = Math.max(
          0,
          (compressionPolicy.maxContextTokens || 0) -
            compressionPolicy.reserveOutputTokens -
            compressionPolicy.safetyBufferTokens
        );
        const predictedTokens = Math.max(0, currentTokens + growthTokens * compressionPolicy.horizonSteps);
        const pressure = budgetTokens > 0 ? predictedTokens / budgetTokens : 1;

        let mode = "none";
        if (budgetTokens <= 0 || predictedTokens >= budgetTokens || pressure >= compressionPolicy.critical) {
          mode = "force";
        } else if (turn >= compressionPolicy.graceTurns && pressure >= compressionPolicy.highWater) {
          const cooldownOk =
            turn - this._compressionState.lastAdviceTurn >= compressionPolicy.cooldownTurns ||
            Math.abs(growthTokens) >= compressionPolicy.minDeltaTokens;
          if (cooldownOk) mode = "advice";
        }

        if (mode === "advice") this._compressionState.lastAdviceTurn = turn;
        if (mode === "force") this._compressionState.lastForcedTurn = turn;

        const suggestedLayers = selectCompressionLayers(pressure, compressionPolicy, this.opts.compressionLayers);

        return {
          mode,
          stageId,
          currentTokens,
          predictedTokens,
          budgetTokens,
          pressure,
          headroomTokens: budgetTokens - predictedTokens,
          growthTokens,
          maxContextTokens: compressionPolicy.maxContextTokens || 0,
          suggestedLayers,
        };
      };

      const applyCompressionHints = (decision) => {
        if (!policyEnabled) return;
        const hints = stageContext.runtimeHints && typeof stageContext.runtimeHints === "object"
          ? stageContext.runtimeHints
          : {};

        if (decision) {
          hints.compression = { ...decision };
          hints.system = buildCompressionHint(decision);
        } else {
          hints.compression = null;
          hints.system = "";
        }

        stageContext.runtimeHints = hints;
        blockApi.runtimeHints = hints;
      };

      const scheduleCompression = async (stageId, result, turn) => {
        const canScheduleAsync = this.opts.enableAsyncCompression && this.asyncCompressor;

        if (!policyEnabled) {
          if (!canScheduleAsync) return;
          try {
            this.asyncCompressor.schedule(stageId, result);
            this._emit(CompressionEvents.COMPRESSION_SCHEDULED, { stageId, status: "scheduled" }, EventStatus.INFO);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this._emit(
              CompressionEvents.COMPRESSION_FAILED,
              { stageId, status: "failed", error: message },
              EventStatus.FAILED
            );
          }
          return;
        }

        const decision = evaluateCompression(stageId, result, turn);
        applyCompressionHints(decision);

        if (decision?.mode === "force") {
          this._emit(
            CompressionEvents.COMPRESSION_FORCED,
            {
              stageId,
              status: "forced",
              pressure: decision.pressure,
              currentTokens: decision.currentTokens,
              predictedTokens: decision.predictedTokens,
              budgetTokens: decision.budgetTokens,
              headroomTokens: decision.headroomTokens,
              growthTokens: decision.growthTokens,
              maxContextTokens: decision.maxContextTokens,
              suggestedLayers: decision.suggestedLayers,
            },
            EventStatus.WARNING
          );

          if (this.opts.enableCompression && this.compressor) {
            try {
              const forced = await this.compressor.compress(result, {
                layers: this.opts.compressionLayers,
                archiveKey: runId,
              });
              const compressed =
                forced && typeof forced === "object" && Object.prototype.hasOwnProperty.call(forced, "context")
                  ? forced.context
                  : forced;
              if (stageResults instanceof Map) stageResults.set(stageId, compressed);
              else stageResults[stageId] = compressed;

              this._emit(CompressionEvents.COMPRESSION_APPLIED, { stageId, status: "forced" }, EventStatus.WARNING);
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              this._emit(
                CompressionEvents.COMPRESSION_FAILED,
                { stageId, status: "failed", error: message },
                EventStatus.FAILED
              );
            }
          }
          return;
        }

        if (decision?.mode === "advice") {
          this._emit(
            CompressionEvents.COMPRESSION_ADVISED,
            {
              stageId,
              status: "advised",
              pressure: decision.pressure,
              currentTokens: decision.currentTokens,
              predictedTokens: decision.predictedTokens,
              budgetTokens: decision.budgetTokens,
              headroomTokens: decision.headroomTokens,
              growthTokens: decision.growthTokens,
              maxContextTokens: decision.maxContextTokens,
              suggestedLayers: decision.suggestedLayers,
            },
            EventStatus.INFO
          );

          if (!compressionPolicy.autoCompress) return;
        }

        if (!compressionPolicy.autoCompress || !canScheduleAsync) return;

        try {
          this.asyncCompressor.schedule(stageId, result);
          this._emit(CompressionEvents.COMPRESSION_SCHEDULED, { stageId, status: "scheduled" }, EventStatus.INFO);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this._emit(
            CompressionEvents.COMPRESSION_FAILED,
            { stageId, status: "failed", error: message },
            EventStatus.FAILED
          );
        }
      };

      const runReview = (stageId, result) => {
        if (!this.opts.enableReview || !this.reviewRules) return;

        this._emit(ReviewEvents.REVIEW_STARTED, { stageId }, EventStatus.STARTED);
        try {
          const review = this.reviewRules.check(stageId, result);
          this._emit(
            ReviewEvents.REVIEW_COMPLETED,
            {
              stageId,
              pass: review.pass,
              severity: review.severity,
              reason: review.reason,
              suggestions: review.suggestions,
            },
            EventStatus.COMPLETED
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this._emit(ReviewEvents.REVIEW_FAILED, { stageId, error: message }, EventStatus.FAILED);
        }
      };

      const saveCheckpoint = async ({ stageId, final = false } = {}) => {
        if (!this.archive || typeof this.archive.save !== "function") return null;

        const timestamp = nextCheckpointTimestamp();
        const nodeStates = snapshotStageResults();
        const checkpointId = await this.archive.save(runId, {
          nodeStates,
          timestamp,
          metadata: { stageId: stageId ?? null, final },
        });
        runtimeState.lastCheckpointId = checkpointId;
        this._emit(
          ArchiveEvents.CHECKPOINT_SAVED,
          { runId, checkpointId, timestamp, nodeStates },
          EventStatus.COMPLETED
        );
        return checkpointId;
      };

      const result = await this._runStage(
        runId,
        "execute",
        signal,
        async () => {
          if (analysis.level >= 3 && this.dagExecutor && Array.isArray(plan.stages)) {
            const dag = this.router.assembleDAG(plan.stages);
            return this.dagExecutor.execute({ id: runId, nodes: dag.nodes }, runContext, initialInput, blockApi);
          }

          const nodes = buildDagFromStages(plan.stages).nodes;
          if (nodes.length === 0) return {};

          const baseRegistry = this.loader?.blocks;
          if (!baseRegistry || typeof baseRegistry.getBlockExecutor !== "function") {
            throw new Error("OrchestratorLoop: block registry with getBlockExecutor() is required");
          }

          const wrappedRegistry = Object.create(baseRegistry);
          const executor = new BlockDAGExecutor(wrappedRegistry, { eventBus, parallel: false });

          wrappedRegistry.getBlockExecutor = (name) => {
            const executorFn = baseRegistry.getBlockExecutor(name);
            if (typeof executorFn !== "function") return executorFn;

            return async (innerRunContext, input, innerApi) => {
              if (this.opts.maxIterations > 0 && this._iteration++ >= this.opts.maxIterations) {
                throw new Error("OrchestratorLoop: max iterations reached");
              }

              const stageId = name;
              applyReadyCompressions();
              const stageTurn = (turnCount += 1);

              const out = await executorFn(innerRunContext, input, innerApi);

              if (stageResults instanceof Map) stageResults.set(stageId, out);
              else stageResults[stageId] = out;

              runReview(stageId, out);
              await scheduleCompression(stageId, out, stageTurn);
              await saveCheckpoint({ stageId });

              return out;
            };
          };

          const { results } = await executor.execute({ id: runId, nodes }, runContext, initialInput, blockApi);

          if (this.opts.enableAsyncCompression && this.asyncCompressor) {
            applyReadyCompressions();
            const summary = await this.asyncCompressor.flush();
            for (const item of summary.failed || []) {
              const message = item?.error instanceof Error ? item.error.message : String(item?.error ?? "");
              this._emit(
                CompressionEvents.COMPRESSION_FAILED,
                { stageId: item.stageId, status: "failed", error: message },
                EventStatus.FAILED
              );
            }
            applyReadyCompressions();
          }

          await saveCheckpoint({ stageId: "final", final: true });

          return results;
        },
        "result"
      );

      const compressed = this.opts.enableCompression
        ? await this._runStage(
            runId,
            "compress",
            signal,
            () => this.compressor.compress(result, { layers: this.opts.compressionLayers, archiveKey: runId }),
            "compressed"
          )
        : null;

      this._emit(RuntimeEvents.RUN_COMPLETED, { runId, result, compressed }, EventStatus.COMPLETED);
      return { result, compressed, plan, analysis };
    } catch (err) {
      if (err instanceof StagePausedError) {
        runtimeState.status = LoopRuntimeStatuses.PAUSED;
        runtimeState.pausedReason = err.reason ?? runtimeState.pausedReason ?? null;
        runtimeState.lastCheckpointId = err.checkpointId ?? runtimeState.lastCheckpointId ?? null;
        await recordPausedRun(context?.runStore, runId, {
          checkpointId: runtimeState.lastCheckpointId,
          reason: runtimeState.pausedReason,
          timestamp: err.timestamp,
        });

        this._emit(
          RuntimeEvents.RUN_FAILED,
          {
            runId,
            error: err.message,
            status: "paused",
            checkpointId: runtimeState.lastCheckpointId,
            reason: runtimeState.pausedReason,
            timestamp: err.timestamp,
          },
          EventStatus.INFO
        );

        return {
          paused: true,
          checkpointId: runtimeState.lastCheckpointId,
          reason: runtimeState.pausedReason,
          plan,
          analysis,
        };
      }

      const message = err instanceof Error ? err.message : String(err);
      const event = signal?.aborted ? RuntimeEvents.RUN_CANCELLED : RuntimeEvents.RUN_FAILED;
      const status = signal?.aborted ? "cancelled" : EventStatus.FAILED;
      this._emit(event, { runId, error: message }, status);
      throw err;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  async _runStage(runId, stage, signal, fn, key) {
    this._emit(RuntimeEvents.STAGE_STARTED, { runId, stage }, EventStatus.STARTED);
    checkCancelledOrPaused(signal);
    const value = await fn();
    this._emit(RuntimeEvents.STAGE_COMPLETED, { runId, stage, ...(key ? { [key]: value } : {}) }, EventStatus.COMPLETED);
    return value;
  }

  _buildInitialInput(task, context) {
    const base = context && typeof context === "object" ? context.initialInput || context.input : null;
    const input = base && typeof base === "object" && !Array.isArray(base) ? { ...base } : {};

    if (task && typeof task === "object" && !Array.isArray(task)) Object.assign(input, task);
    else if (typeof task === "string" && !input.taskGoal) input.taskGoal = task;

    if (input.sources === undefined) {
      const sources =
        Array.isArray(context?.sources) ? context.sources : Array.isArray(context?.assets) ? context.assets : null;
      if (sources) input.sources = sources;
    }

    if (input.userConfig === undefined && context?.userConfig && typeof context.userConfig === "object") {
      input.userConfig = context.userConfig;
    }

    return input;
  }

  _emit(name, payload, status = EventStatus.INFO) {
    const emit = this.emit || this.eventBus?.emit;
    if (typeof emit === "function") emit(name, { actor: "orchestrator", status, payload });
  }
}

export default OrchestratorLoop;
