import { topologicalSort as sortStages } from "./orchestrator.js";
import { isPlainObject, toNonEmptyString } from "../shared/value-utils.js";

function normalizeDag(dag) {
  if (!isPlainObject(dag)) {
    throw new TypeError("BlockDAGExecutor: dag must be an object");
  }
  const nodes = Array.isArray(dag.nodes) ? dag.nodes : [];
  if (nodes.length === 0) {
    throw new Error("BlockDAGExecutor: dag.nodes must be a non-empty array");
  }
  return { nodes };
}

function buildNodeMap(nodes) {
  const nodeById = new Map();
  for (const node of nodes) {
    const id = toNonEmptyString(node?.id);
    if (!id) throw new Error("BlockDAGExecutor: node.id must be a non-empty string");
    if (nodeById.has(id)) {
      throw new Error(`BlockDAGExecutor: duplicate node id "${id}"`);
    }
    const block = toNonEmptyString(node?.block);
    if (!block) throw new Error(`BlockDAGExecutor: node "${id}" missing block`);
    const dependsOn = Array.isArray(node?.dependsOn) ? node.dependsOn : [];
    nodeById.set(id, { id, block, dependsOn });
  }
  return nodeById;
}

function resolveDagId(dag, runContext, checkpoint) {
  return (
    toNonEmptyString(dag?.id) ||
    toNonEmptyString(dag?.dagId) ||
    toNonEmptyString(checkpoint?.dagId) ||
    toNonEmptyString(runContext?.runId) ||
    "dag_unknown"
  );
}

function serializeState(state) {
  if (!state) return state;
  if (typeof state.serialize === "function") return state.serialize();
  if (typeof state.toJSON === "function") return state.toJSON();
  return state;
}

function coerceResultFromState(stateValue) {
  if (isPlainObject(stateValue) && Object.prototype.hasOwnProperty.call(stateValue, "state")) {
    return stateValue;
  }
  return { state: stateValue };
}

function resolveEmitter(eventBus, blockApi) {
  if (blockApi && typeof blockApi.emit === "function") return blockApi.emit;
  if (eventBus && typeof eventBus.emit === "function") return eventBus.emit.bind(eventBus);
  return null;
}

function emitEvent(emit, name, status, payload, extra = {}) {
  if (typeof emit !== "function") return;
  emit(name, {
    actor: payload?.block ? `block:${payload.block}` : "dag-executor",
    status,
    payload,
    ...extra,
  });
}

function wrapNodeEmitter({ emit, nodeId, block, startTimeRef }) {
  if (typeof emit !== "function") return undefined;
  return (name, record = {}) => {
    if (name === "dag.node.started" || name === "dag.node.completed" || name === "dag.node.failed") {
      const payload = isPlainObject(record?.payload) ? record.payload : {};
      const nextPayload = { nodeId, block, ...payload };
      if (name !== "dag.node.started") {
        const durationMs =
          typeof record?.durationMs === "number"
            ? record.durationMs
            : typeof startTimeRef?.current === "number"
              ? Date.now() - startTimeRef.current
              : undefined;
        if (typeof durationMs === "number" && nextPayload.duration === undefined) {
          nextPayload.duration = durationMs;
        }
      }
      emit(name, { ...record, payload: nextPayload });
      return;
    }
    emit(name, record);
  };
}

export class BlockDAGExecutor {
  constructor(blockRegistry, options = {}) {
    if (!blockRegistry || typeof blockRegistry.getBlockExecutor !== "function") {
      throw new TypeError("BlockDAGExecutor: blockRegistry must provide getBlockExecutor(name)");
    }
    this.blockRegistry = blockRegistry;
    this.parallel = options.parallel !== false;
    const continueOnError = options.continueOnError;
    const failFast = options.failFast;
    this.continueOnError =
      typeof continueOnError === "boolean" ? continueOnError : typeof failFast === "boolean" ? !failFast : false;
    this.eventBus = options.eventBus || null;
  }

  topologicalSort(dag) {
    const { nodes } = normalizeDag(dag);
    const nodeById = buildNodeMap(nodes);
    const stages = new Map();
    for (const [id, node] of nodeById.entries()) {
      stages.set(id, { dependsOn: node.dependsOn });
    }
    return sortStages(stages);
  }

  buildLayers(sorted, dag) {
    if (!Array.isArray(sorted)) {
      throw new TypeError("BlockDAGExecutor.buildLayers(sorted): sorted must be an array");
    }
    const { nodes } = normalizeDag(dag);
    const nodeById = buildNodeMap(nodes);
    const levels = new Map();
    const layers = [];

    for (const nodeId of sorted) {
      const node = nodeById.get(nodeId);
      if (!node) throw new Error(`BlockDAGExecutor.buildLayers: missing node "${nodeId}"`);
      const deps = Array.isArray(node.dependsOn) ? node.dependsOn : [];
      let level = 0;
      for (const dep of deps) {
        const depLevel = levels.get(dep);
        if (depLevel === undefined) {
          throw new Error(`BlockDAGExecutor.buildLayers: missing dependency "${dep}" for "${nodeId}"`);
        }
        level = Math.max(level, depLevel + 1);
      }
      levels.set(nodeId, level);
      if (!layers[level]) layers[level] = [];
      layers[level].push(nodeId);
    }

    return layers.filter(Boolean);
  }

  async execute(dag, runContext, input, blockApi = {}) {
    return this._run({ dag, runContext, input, blockApi, checkpoint: null });
  }

  async resume(dag, runContext, checkpoint, blockApi = {}) {
    return this._run({ dag, runContext, input: null, blockApi, checkpoint });
  }

  async _run({ dag, runContext, input, blockApi, checkpoint }) {
    const { nodes } = normalizeDag(dag);
    const nodeById = buildNodeMap(nodes);
    const dagId = resolveDagId(dag, runContext, checkpoint);
    const { sorted } = this.topologicalSort(dag);
    const layers = this.buildLayers(sorted, dag);

    const results = {};
    const checkpoints = [];
    const completedNodes = new Set();
    const nodeStates = {};
    const latestCheckpointRef = { current: checkpoint || null };
    const emit = resolveEmitter(this.eventBus, blockApi);
    const baseBlockApi = blockApi && typeof blockApi === "object" ? blockApi : null;

    if (checkpoint) {
      const completed = Array.isArray(checkpoint.completedNodes) ? checkpoint.completedNodes : [];
      const storedStates = isPlainObject(checkpoint.nodeStates) ? checkpoint.nodeStates : {};
      const fallbackCompleted = completed.length ? completed : Object.keys(storedStates);
      for (const nodeId of fallbackCompleted) {
        completedNodes.add(nodeId);
        if (Object.prototype.hasOwnProperty.call(storedStates, nodeId)) {
          nodeStates[nodeId] = storedStates[nodeId];
          results[nodeId] = coerceResultFromState(storedStates[nodeId]);
        }
      }
    }

    const startedAt = Date.now();
    emitEvent(emit, "dag.started", "started", { dagId, nodeCount: nodes.length });

    for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
      const layer = layers[layerIndex] || [];
      const runnable = layer.filter((nodeId) => !completedNodes.has(nodeId));
      if (runnable.length === 0) continue;

      const layerStartedAt = Date.now();
      emitEvent(emit, "dag.layer.started", "started", { layer: layerIndex, nodes: runnable });

      await this.executeLayer(runnable, {
        nodeById,
        runContext,
        initialInput: input ?? checkpoint?.input ?? checkpoint?.initialInput,
        results,
        completedNodes,
        nodeStates,
        checkpoints,
        latestCheckpointRef,
        emit,
        baseBlockApi,
        dagId,
      });

      emitEvent(emit, "dag.layer.completed", "completed", { layer: layerIndex, duration: Date.now() - layerStartedAt });
    }

    emitEvent(emit, "dag.completed", "completed", {
      dagId,
      duration: Date.now() - startedAt,
      results,
    });

    return { results, checkpoints };
  }

  async executeLayer(layer, context) {
    const runNode = async (nodeId) => this._executeNode(nodeId, context);
    const errors = [];

    if (this.parallel && layer.length > 1) {
      const settled = await Promise.all(
        layer.map(async (nodeId) => {
          try {
            const result = await runNode(nodeId);
            return { status: "fulfilled", nodeId, result };
          } catch (err) {
            return { status: "rejected", nodeId, error: err };
          }
        })
      );

      for (const item of settled) {
        if (item.status === "rejected") errors.push(item.error);
      }
    } else {
      for (const nodeId of layer) {
        try {
          await runNode(nodeId);
        } catch (err) {
          errors.push(err);
          if (!this.continueOnError) break;
        }
      }
    }

    if (errors.length && !this.continueOnError) {
      throw errors[0];
    }
  }

  async _executeNode(nodeId, context) {
    const { nodeById, runContext, initialInput, results, completedNodes, nodeStates } = context;
    const node = nodeById.get(nodeId);
    if (!node) throw new Error(`BlockDAGExecutor: unknown node "${nodeId}"`);

    const deps = Array.isArray(node.dependsOn) ? node.dependsOn : [];
    const missingDeps = deps.filter((dep) => !Object.prototype.hasOwnProperty.call(results, dep));
    if (missingDeps.length) {
      if (this.continueOnError) return { skipped: true, reason: "missing_dependencies", missingDeps };
      throw new Error(`BlockDAGExecutor: missing dependency results for "${nodeId}": ${missingDeps.join(", ")}`);
    }

    const input =
      deps.length === 0
        ? initialInput
        : deps.length === 1
          ? results[deps[0]]
          : deps.reduce((acc, dep) => {
              acc[dep] = results[dep];
              return acc;
            }, {});

    const executor = this.blockRegistry.getBlockExecutor(node.block);
    if (typeof executor !== "function") {
      emitEvent(context.emit, "dag.node.failed", "failed", {
        nodeId,
        block: node.block,
        error: { message: `Missing executor for block "${node.block}"`, name: "BlockNotRegistered" },
      });
      if (this.continueOnError) return { skipped: true, reason: "missing_executor" };
      throw new Error(`BlockDAGExecutor: missing executor for block "${node.block}"`);
    }

    const startTimeRef = { current: Date.now() };
    const baseApi = context.baseBlockApi;
    const nodeBlockApi = Object.assign(Object.create(baseApi || null), {
      emit: wrapNodeEmitter({ emit: context.emit, nodeId, block: node.block, startTimeRef }),
      getCheckpoint:
        baseApi && typeof baseApi.getCheckpoint === "function" ? baseApi.getCheckpoint.bind(baseApi) : () => context.latestCheckpointRef.current,
    });

    const result = await executor(runContext, input, nodeBlockApi);
    results[nodeId] = result;

    const state = result?.state;
    let stateCheckpoint = null;
    if (state && typeof state.saveCheckpoint === "function") {
      const checkpointId = `ckpt_${nodeId}_${completedNodes.size + 1}`;
      stateCheckpoint = state.saveCheckpoint({ checkpointId });
    }

    completedNodes.add(nodeId);
    const serializedState = stateCheckpoint?.stateSnapshot ?? serializeState(state);
    nodeStates[nodeId] = serializedState;

    const checkpointId = `ckpt_${nodeId}_${completedNodes.size}`;
    const snapshot = {
      dagId: context.dagId,
      completedNodes: Array.from(completedNodes),
      nodeStates: { ...nodeStates },
      timestamp: new Date().toISOString(),
      checkpointId,
    };
    context.checkpoints.push(snapshot);
    context.latestCheckpointRef.current = snapshot;
    emitEvent(context.emit, "dag.checkpoint", "info", { nodeId, checkpointId });

    return result;
  }
}
