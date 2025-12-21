import { BaseAgentLoop, checkCancelled } from "./agent-loop.js";
import { RequirementAnalyzer } from "./requirement-analyzer.js";
import { CapabilityLoader } from "./capability-loader.js";
import { RouterAgent } from "./router-agent.js";
import { CicadaCompressor } from "./cicada-compressor.js";
import { BlockDAGExecutor } from "./block-dag-executor.js";
import { EventStatus, RuntimeEvents } from "./events.js";
import { createStageApi } from "../shared/stage-api.js";

export const defaultOptions = Object.freeze({
  maxIterations: 0,
  timeout: 0,
  enableCompression: true,
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

export class OrchestratorLoop extends BaseAgentLoop {
  constructor(deps = {}, opts = {}) {
    super({ eventBus: deps.eventBus, actor: "orchestrator", stageName: "orchestrator" });

    this.opts = withDefaults(opts);

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
      new CicadaCompressor({ modelRouter: deps.modelRouter, archive: deps.archive, eventBus: deps.eventBus });

    this.dagExecutor = deps.dagExecutor ?? (deps.blockRegistry ? new BlockDAGExecutor(deps.blockRegistry, { eventBus: deps.eventBus }) : null);

    this._iteration = 0;
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

    const signal = mergeSignals(context.signal, timeoutSignal) || context.signal || timeoutSignal || null;

    const runContext = {
      ...(context.runContext && typeof context.runContext === "object" ? context.runContext : {}),
      runId,
    };

    const stageContext = { ...context, runId, signal, runContext };

    this._emit(RuntimeEvents.RUN_STARTED, { runId, task }, EventStatus.STARTED);
    this._iteration = 0;

    try {
      const analysis = await this._runStage(runId, "analyze", signal, () => this.analyzer.analyze(task, stageContext), "analysis");

      await this._runStage(runId, "load_capabilities", signal, () => this.loader.loadRequired(analysis.requiredCapabilities));

      const plan = await this._runStage(runId, "plan", signal, () => this.router.plan(task, { ...stageContext, analysis }), "plan");

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
        checkCancelled: () => checkCancelled(signal),
      });

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
          wrappedRegistry.getBlockExecutor = (name) => {
            const executor = baseRegistry.getBlockExecutor(name);
            if (typeof executor !== "function") return executor;
            return async (...args) => {
              if (this.opts.maxIterations > 0 && this._iteration++ >= this.opts.maxIterations) {
                throw new Error("OrchestratorLoop: max iterations reached");
              }
              return executor(...args);
            };
          };

          const executor = new BlockDAGExecutor(wrappedRegistry, { eventBus, parallel: false });
          const { results } = await executor.execute({ id: runId, nodes }, runContext, initialInput, blockApi);
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
    checkCancelled(signal);
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
