/**
 * Stage 工具函数
 * 从 state.js 拆分出的 emit/stage 相关工具
 */
import { EVENT_SCHEMA_VERSION, EventStatus } from "./utils/state-utils.js";

/**
 * 创建带限流的 stage 事件发射器
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

  return (name, payload, { status = EventStatus.COMPLETED, throttle = true } = {}) => {
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
}

/**
 * 生成唯一节点 ID
 */
export function generateNodeId(runId, kind, { stage, iteration, trajectoryId } = {}) {
  const parts = [runId || "run", kind];
  if (stage) parts.push(stage);
  if (typeof iteration === "number") parts.push(`i${iteration}`);
  if (trajectoryId) parts.push(trajectoryId);
  return parts.join("_") + "_" + Date.now().toString(36);
}

/**
 * 检查是否已取消
 */
export function checkCancelled(stageApi) {
  if (typeof stageApi?.checkCancelled === "function") stageApi.checkCancelled();
  if (stageApi?.signal?.aborted) {
    const reason = stageApi.signal.reason;
    throw new Error(typeof reason === "string" ? reason : "Run cancelled");
  }
}
