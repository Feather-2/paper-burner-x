/**
 * Stage 工具函数
 * 从 state.js 拆分出的 emit/stage 相关工具
 */
import { EVENT_SCHEMA_VERSION, EventStatus } from "./utils/state-utils.js";
import { makeSecureTimestampedId, toNonEmptyString } from "../../shared/index.js";

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
 * @param {{ stage?: string, iteration?: number, trajectoryId?: string, idFactory?: ((meta: { prefix: string, runId: string, kind: string, stage?: string, iteration?: number, trajectoryId?: string, timestamp: number }) => string|null|undefined)|null }=} options
 * @returns {string}
 */
export function generateNodeId(runId, kind, { stage, iteration, trajectoryId, idFactory } = {}) {
  const safeRunId = toNonEmptyString(runId) || "run";
  const safeKind = toNonEmptyString(kind) || "node";
  const parts = [safeRunId, safeKind];
  if (stage) parts.push(stage);
  if (typeof iteration === "number") parts.push(`i${iteration}`);
  if (trajectoryId) parts.push(trajectoryId);

  const prefix = parts.join("_");
  const ts = Date.now();

  if (typeof idFactory === "function") {
    try {
      const custom = toNonEmptyString(idFactory({
        prefix,
        runId: safeRunId,
        kind: safeKind,
        ...(stage ? { stage } : {}),
        ...(typeof iteration === "number" ? { iteration } : {}),
        ...(trajectoryId ? { trajectoryId } : {}),
        timestamp: ts,
      }));
      if (custom) return custom;
    } catch {
      // ignore custom id factory failures and fallback to secure id.
    }
  }

  return makeSecureTimestampedId(prefix, { allowInsecureFallback: true });
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
