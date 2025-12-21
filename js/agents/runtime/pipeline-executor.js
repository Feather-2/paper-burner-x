import { BlockDAGExecutor } from "./block-dag-executor.js";
import { isPlainObject, toNonEmptyString } from "../shared/value-utils.js";

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
    : typeof stage.dependsOn === "string"
      ? stage.dependsOn
          .split(",")
          .map((dep) => dep.trim())
          .filter(Boolean)
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

function resolvePipelineId(pipeline, context) {
  const fromPipeline = isPlainObject(pipeline) ? pipeline.id || pipeline.pipelineId : null;
  const fromContext = isPlainObject(context) ? context.pipelineId || context.runId || context.runContext?.runId : null;
  const resolved =
    toNonEmptyString(typeof pipeline === "string" ? pipeline : null) ||
    toNonEmptyString(fromPipeline) ||
    toNonEmptyString(fromContext) ||
    `pipeline_${Date.now()}`;
  if (resolved.includes(":")) {
    throw new TypeError("PipelineExecutor: pipelineId must not include ':'");
  }
  return resolved;
}

function resolveRunContext(context, pipelineId) {
  const base = isPlainObject(context?.runContext) ? context.runContext : {};
  const runId = toNonEmptyString(base.runId) || toNonEmptyString(context?.runId) || pipelineId;
  return { ...base, runId };
}

function resolveBlockApi(context) {
  const base = isPlainObject(context?.blockApi)
    ? context.blockApi
    : isPlainObject(context?.stageApi)
      ? context.stageApi
      : isPlainObject(context?.api)
        ? context.api
        : null;
  return base || (isPlainObject(context) ? context : {});
}

async function resolvePipelineById(id, context, checkpointStore) {
  const pipelineId = toNonEmptyString(id);
  if (!pipelineId) return null;

  const fromContext = context?.pipelines;
  if (fromContext instanceof Map) {
    const found = fromContext.get(pipelineId);
    if (isPlainObject(found)) return found;
  } else if (isPlainObject(fromContext) && isPlainObject(fromContext[pipelineId])) {
    return fromContext[pipelineId];
  }

  if (typeof context?.getPipeline === "function") {
    const found = await context.getPipeline(pipelineId);
    if (isPlainObject(found)) return found;
  }

  if (checkpointStore && typeof checkpointStore.load === "function") {
    const snapshot = await checkpointStore.load(pipelineId);
    const meta = isPlainObject(snapshot?.metadata) ? snapshot.metadata : null;
    if (meta && isPlainObject(meta.pipeline)) return meta.pipeline;
  }

  return null;
}

function normalizePipelineShape(pipeline) {
  if (!isPlainObject(pipeline)) {
    throw new TypeError("PipelineExecutor: pipeline must be a Pipeline object or pipeline ID");
  }
  const stages = Array.isArray(pipeline.stages) ? pipeline.stages : null;
  if (!stages || stages.length === 0) {
    throw new Error("PipelineExecutor: pipeline.stages must be a non-empty array");
  }
  return { ...pipeline, stages };
}

/**
 * Pipeline 执行器 - 纯执行，不做审查决策
 * 审查和压缩由上层 Agent Loop 负责
 */
export class PipelineExecutor {
  /**
   * @param {Object} blockRegistry - Block 注册表
   * @param {Object} options
   * @param {Object} [options.eventBus] - 事件总线
   * @param {Object} [options.checkpointStore] - checkpoint 存储（Archive 实例）
   * @param {boolean} [options.parallel=true] - 是否并行执行同层 Stage
   */
  constructor(blockRegistry, options = {}) {
    if (!blockRegistry || typeof blockRegistry.getBlockExecutor !== "function") {
      throw new TypeError("PipelineExecutor: blockRegistry must provide getBlockExecutor(name)");
    }

    this.blockRegistry = blockRegistry;
    this.eventBus = options.eventBus || null;
    this.checkpointStore = options.checkpointStore || null;
    this.parallel = options.parallel !== false;

    this.dagExecutor = new BlockDAGExecutor(blockRegistry, {
      eventBus: this.eventBus,
      parallel: this.parallel,
    });
  }

  /**
   * 执行 Pipeline
   * @param {Object|string} pipeline - Pipeline 对象 { id, stages } 或 pipeline ID
   * @param {Object} input - 初始输入
   * @param {Object} context - 执行上下文
   * @returns {Promise<{ results, checkpoints }>}
   */
  async execute(pipeline, input, context = {}) {
    const ctx = isPlainObject(context) ? context : {};
    const pipelineId = resolvePipelineId(pipeline, ctx);

    const resolved =
      typeof pipeline === "string" ? await resolvePipelineById(pipelineId, ctx, this.checkpointStore) : pipeline;
    const pipelineObj = normalizePipelineShape(resolved);

    const dag = { id: pipelineId, ...this.buildDAG(pipelineObj.stages) };
    const runContext = resolveRunContext(ctx, pipelineId);
    const blockApi = resolveBlockApi(ctx);

    this.dagExecutor.eventBus = ctx.eventBus || this.eventBus || null;

    const { results, checkpoints } = await this.dagExecutor.execute(dag, runContext, input, blockApi);
    await this._storeCheckpoints(pipelineId, pipelineObj, input, checkpoints);
    return { results, checkpoints };
  }

  /**
   * 从 checkpoint 恢复执行
   * @param {string} pipelineId
   * @param {string} checkpointId
   * @param {Object} context
   * @returns {Promise<{ results, checkpoints }>}
   */
  async resume(pipelineId, checkpointId, context = {}) {
    const ctx = isPlainObject(context) ? context : {};
    const runId = toNonEmptyString(pipelineId);
    if (!runId) {
      throw new TypeError("PipelineExecutor.resume: pipelineId must be a non-empty string");
    }

    const ckpt = toNonEmptyString(checkpointId);
    if (!ckpt) {
      throw new TypeError("PipelineExecutor.resume: checkpointId must be a non-empty string");
    }

    if (!this.checkpointStore || typeof this.checkpointStore.restore !== "function") {
      throw new Error("PipelineExecutor.resume: checkpointStore with restore() is required");
    }

    const fullCheckpointId = ckpt.includes(":") ? ckpt : `${runId}:${ckpt}`;
    const restored = await this.checkpointStore.restore(fullCheckpointId);
    const meta = isPlainObject(restored?.metadata) ? restored.metadata : {};

    const pipelineFromMeta = isPlainObject(meta.pipeline) ? meta.pipeline : null;
    const resolvedPipeline = pipelineFromMeta || (await resolvePipelineById(runId, ctx, this.checkpointStore));
    const pipelineObj = normalizePipelineShape(resolvedPipeline);

    const dag = { id: runId, ...this.buildDAG(pipelineObj.stages) };
    const runContext = resolveRunContext(ctx, runId);
    const blockApi = resolveBlockApi(ctx);

    const checkpointPayload = {
      dagId: runId,
      checkpointId: toNonEmptyString(meta.dagCheckpointId) || ckpt,
      completedNodes: Array.isArray(meta.completedNodes) ? meta.completedNodes : undefined,
      nodeStates: isPlainObject(restored?.nodeStates) ? restored.nodeStates : {},
      initialInput: meta.initialInput,
      input: meta.initialInput,
    };

    this.dagExecutor.eventBus = ctx.eventBus || this.eventBus || null;

    const { results, checkpoints } = await this.dagExecutor.resume(dag, runContext, checkpointPayload, blockApi);
    await this._storeCheckpoints(runId, pipelineObj, meta.initialInput, checkpoints);
    return { results, checkpoints };
  }

  /**
   * 轻量检查：标记问题但不决策
   * @param {string} stageId
   * @param {Object} result
   * @returns {{ needsReview: boolean, reason?: string }}
   */
  quickCheck(_stageId, result) {
    // 结果为空
    if (!result || (typeof result === "object" && Object.keys(result).length === 0)) {
      return { needsReview: true, reason: "empty_result" };
    }
    // 显式标记错误
    if (result.error || result._error) {
      return { needsReview: true, reason: "has_error" };
    }
    // 低置信度
    if (typeof result.confidence === "number" && result.confidence < 0.5) {
      return { needsReview: true, reason: "low_confidence" };
    }
    return { needsReview: false };
  }

  /**
   * 将 stages 数组转换为 DAG nodes
   * @param {Array} stages - [{ name, dependsOn? }]
   * @returns {{ nodes: Array }}
   */
  buildDAG(stages) {
    const list = Array.isArray(stages) ? stages : [];
    const nodes = [];
    for (const stage of list) {
      const node = normalizeStageDescriptor(stage);
      if (!node) continue;
      nodes.push(node);
    }
    return { nodes };
  }

  async _storeCheckpoints(pipelineId, pipeline, input, checkpoints) {
    if (!this.checkpointStore || typeof this.checkpointStore.save !== "function") return;
    const list = Array.isArray(checkpoints) ? checkpoints : [];

    for (const checkpoint of list) {
      const timestamp = toNonEmptyString(checkpoint?.checkpointId) || toNonEmptyString(checkpoint?.timestamp) || String(Date.now());
      const nodeStates = isPlainObject(checkpoint?.nodeStates) ? checkpoint.nodeStates : {};
      const metadata = {
        pipeline,
        completedNodes: Array.isArray(checkpoint?.completedNodes) ? checkpoint.completedNodes : undefined,
        dagId: toNonEmptyString(checkpoint?.dagId) || pipelineId,
        dagCheckpointId: toNonEmptyString(checkpoint?.checkpointId),
        initialInput: input,
      };
      await this.checkpointStore.save(pipelineId, { nodeStates, timestamp, metadata });
    }
  }
}

