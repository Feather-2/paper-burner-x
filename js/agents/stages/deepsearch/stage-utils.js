/**
 * Stage 工具函数
 * 从 state.js 拆分出的 emit/stage 相关工具
 */
import { EVENT_SCHEMA_VERSION, EventStatus } from "./utils/state-utils.js";

let nodeIdLastTs = 0;
let nodeIdCounter = 0;

/**
 * 创建带限流的 stage 事件发射器
 * @param {object} stageApi - Stage API 对象，需提供 emit 或 eventBus.emit 方法
 * @param {string} [actor="deepsearch"] - 事件 actor 标识
 * @param {() => object} [getContext] - 可选的上下文获取函数
 * @returns {((name: string, payload: any, meta?: { status?: string, throttle?: boolean }) => void) | null}
 */
export function makeStageEmitter(stageApi, actor = "deepsearch", getContext) {
  const emitFn =
    typeof stageApi?.emit === "function"
      ? stageApi.emit.bind(stageApi)
      : typeof stageApi?.eventBus?.emit === "function"
        ? stageApi.eventBus.emit.bind(stageApi.eventBus)
        : null;

  if (!emitFn) return null;

  const lastEmitTime = new Map();
  const MIN_INTERVAL_MS = 100;

  /** @type {(name:string, payload:any, meta?:{ status?: string, throttle?: boolean })=>void} */
  const emitter = (name, payload, { status = EventStatus.COMPLETED, throttle = true } = {}) => {
    if (throttle) {
      const now = Date.now();
      const last = lastEmitTime.get(name);
      if (typeof last === "number" && now - last < MIN_INTERVAL_MS) return;
      lastEmitTime.set(name, now);
    }

    const ctx = typeof getContext === "function" ? getContext() : {};
    emitFn(name, {
      schemaVersion: EVENT_SCHEMA_VERSION,
      name,
      ts: new Date().toISOString(),
      actor,
      status,
      ...ctx,
      payload,
    });
  };

  return emitter;
}

/**
 * 生成唯一节点 ID
 */
/**
 * @param {string} runId
 * @param {string} kind
 * @param {{ stage?: string, iteration?: number, trajectoryId?: string }=} options
 * @returns {string}
 */
export function generateNodeId(runId, kind, { stage, iteration, trajectoryId } = {}) {
  const parts = [runId || "run", kind];
  if (stage) parts.push(stage);
  if (typeof iteration === "number") parts.push(`i${iteration}`);
  if (trajectoryId) parts.push(trajectoryId);
  const now = Date.now();
  if (now > nodeIdLastTs) {
    nodeIdLastTs = now;
    nodeIdCounter = 0;
  } else {
    nodeIdCounter += 1;
  }
  return `${parts.join("_")}_${nodeIdLastTs.toString(36)}_${nodeIdCounter.toString(36)}`;
}

/**
 * 检查是否已取消
 * @param {object} stageApi - Stage API 对象
 * @returns {void}
 * @throws {Error} 当运行已被取消时抛出错误
 */
export function checkCancelled(stageApi) {
  if (typeof stageApi?.checkCancelled === "function") stageApi.checkCancelled();
  if (stageApi?.signal?.aborted) {
    const reason = stageApi.signal.reason;
    throw new Error(typeof reason === "string" ? reason : "Run cancelled");
  }
}
