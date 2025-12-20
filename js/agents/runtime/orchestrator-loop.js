import { BaseAgentLoop, checkCancelled } from "./agent-loop.js";
import { RequirementAnalyzer } from "./requirement-analyzer.js";
import { CapabilityLoader } from "./capability-loader.js";
import { RouterAgent } from "./router-agent.js";
import { CicadaCompressor } from "./cicada-compressor.js";
import { BlockDAGExecutor } from "./block-dag-executor.js";
import { RuntimeEvents } from "./events.js";
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
function stageName(stage) {
  if (typeof stage === "string") return stage;
  if (stage && typeof stage === "object") return stage.name || stage.block || stage.id || "";
  return "";
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
    this.dagExecutor =
      deps.dagExecutor ?? (deps.blockRegistry ? new BlockDAGExecutor(deps.blockRegistry, { eventBus: deps.eventBus }) : null);
    this._iteration = 0;
  }
  async run(task, context = {}) {
    const runId = (context && typeof context === "object" && (context.runId || context.runContext?.runId)) || `run_${Date.now()}`;
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
    const runContext = { ...(context.runContext && typeof context.runContext === "object" ? context.runContext : {}), runId };
    const stageContext = { ...context, runId, signal };
    this._emit(RuntimeEvents.RUN_STARTED, { runId, task }, "started");
    this._iteration = 0;
    try {
      const analysis = await this._runStage(runId, "analyze", signal, () => this.analyzer.analyze(task, stageContext), "analysis");
      await this._runStage(runId, "load_capabilities", signal, () => this.loader.loadRequired(analysis.requiredCapabilities));
      const plan = await this._runStage(runId, "plan", signal, () => this.router.plan(task, { ...stageContext, analysis }), "plan");
      const initialInput = this._buildInitialInput(task, context);
      const blockApi = {
        ...(context.blockApi && typeof context.blockApi === "object" ? context.blockApi : {}),
        signal,
        eventBus,
        modelRouter: context.modelRouter || this.router.modelRouter || this.compressor.modelRouter || null,
        aiApiService: context.aiApiService,
        localRetriever: context.localRetriever,
        externalSearchProvider: context.externalSearchProvider,
        logger: context.logger,
        checkCancelled: () => checkCancelled(signal),
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
          return this._executeBlocks(plan.stages, { runContext, initialInput, blockApi, signal });
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
      this._emit(RuntimeEvents.RUN_COMPLETED, { runId, result, compressed }, "completed");
      return { result, compressed, plan, analysis };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const event = signal?.aborted ? RuntimeEvents.RUN_CANCELLED : RuntimeEvents.RUN_FAILED;
      const status = signal?.aborted ? "cancelled" : "failed";
      this._emit(event, { runId, error: message }, status);
      throw err;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }
  async _runStage(runId, stage, signal, fn, key) {
    this._emit(RuntimeEvents.STAGE_STARTED, { runId, stage }, "started");
    checkCancelled(signal);
    const value = await fn();
    this._emit(RuntimeEvents.STAGE_COMPLETED, { runId, stage, ...(key ? { [key]: value } : {}) }, "completed");
    return value;
  }
  _buildInitialInput(task, context) {
    const base = context && typeof context === "object" ? context.initialInput || context.input : null;
    const input = base && typeof base === "object" && !Array.isArray(base) ? { ...base } : {};
    if (task && typeof task === "object" && !Array.isArray(task)) Object.assign(input, task);
    else if (typeof task === "string" && !input.taskGoal) input.taskGoal = task;
    if (input.sources === undefined) {
      const sources = Array.isArray(context?.sources) ? context.sources : Array.isArray(context?.assets) ? context.assets : null;
      if (sources) input.sources = sources;
    }
    if (input.userConfig === undefined && context?.userConfig && typeof context.userConfig === "object") input.userConfig = context.userConfig;
    return input;
  }
  async _executeBlocks(stages, { runContext, initialInput, blockApi, signal } = {}) {
    const results = {};
    for (const stage of Array.isArray(stages) ? stages : []) {
      checkCancelled(signal);
      if (this.opts.maxIterations > 0 && this._iteration++ >= this.opts.maxIterations) throw new Error("OrchestratorLoop: max iterations reached");
      const name = stageName(stage);
      if (!name) continue;
      const executor = this.loader.blocks?.getBlockExecutor?.(name);
      if (typeof executor !== "function") {
        results[name] = { ok: false, error: `Missing executor for block "${name}"` };
        continue;
      }
      const deps = Array.isArray(stage?.dependsOn) ? stage.dependsOn : [];
      for (const dep of deps) {
        if (!Object.prototype.hasOwnProperty.call(results, dep)) {
          throw new Error(`OrchestratorLoop: missing dependency results for "${name}": ${dep}`);
        }
      }
      const input = deps.length === 0
        ? initialInput
        : deps.length === 1
          ? results[deps[0]]
          : Object.fromEntries(deps.map((dep) => [dep, results[dep]]));
      results[name] = await executor(runContext, input, blockApi);
    }
    return results;
  }
  _emit(name, payload, status = "info") {
    const emit = this.emit || this.eventBus?.emit;
    if (typeof emit === "function") emit(name, { actor: "orchestrator", status, payload });
  }
}
export default OrchestratorLoop;
