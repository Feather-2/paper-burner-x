import { isPlainObject, toNonEmptyString } from "../../shared/index.js";
import { createLogger } from "../../shared/index.js";

const logger = createLogger("runtime/telemetry/runstore-telemetry");

function ensureEventBus(eventBus) {
  if (!eventBus || typeof eventBus.on !== "function") {
    throw new TypeError("subscribeTelemetry(eventBus, runStore): eventBus must implement on(name, handler)");
  }
  return eventBus;
}

function ensureRunStore(runStore) {
  if (!runStore || typeof runStore.appendEvent !== "function") {
    throw new TypeError("subscribeTelemetry(eventBus, runStore): runStore must implement appendEvent(runId, event)");
  }
  return runStore;
}

function toTimelineRow(evt) {
  return {
    ts: evt?.ts,
    actor: evt?.actor,
    status: evt?.status,
    payload: evt?.payload,
    name: evt?.name,
  };
}

/**
 * 检查事件名是否匹配 todo 事件（兼容 domain.action 和 domain:action 格式）
 * @param {string|undefined} name - 事件名
 * @returns {boolean}
 */
function isTodoEvent(name) {
  const s = String(name || "");
  return s.includes("todo.") || s.includes("todo:");
}

/**
 * 检查事件名是否为 todo.created 事件（兼容 domain.action 和 domain:action 格式）
 * @param {string|undefined} name - 事件名
 * @returns {boolean}
 */
function isTodoCreatedEvent(name) {
  const s = String(name || "");
  return s.endsWith(".todo.created") || s.endsWith(":todo.created") || s === "todo.created" || s === "todo:created";
}

function upsertTodo(todosById, evt) {
  const payload = isPlainObject(evt?.payload) ? evt.payload : {};
  const todoId = toNonEmptyString(payload.todoId);
  if (!todoId) return;

  const prev = todosById.get(todoId) || { todoId };
  const next = { ...prev };

  if (toNonEmptyString(payload.text)) next.text = String(payload.text);
  if (toNonEmptyString(payload.status)) next.status = String(payload.status);
  if (toNonEmptyString(payload.relatedGapId)) next.relatedGapId = String(payload.relatedGapId);

  if (!next.createdAt && isTodoCreatedEvent(evt?.name)) {
    next.createdAt = evt.ts;
  }
  next.updatedAt = evt.ts;

  todosById.set(todoId, next);
}

/**
 * @typedef {{ maxTimelineEntries?: number, allowUnlimitedTimeline?: boolean }} RunstoreTelemetryOptions
 * @typedef {{
 *   timeline: Array<object>,
 *   todos: Array<object>,
 *   diagnostics: { appendSuccessCount: number, appendFailureCount: number, lastError: string | null, recentAppendErrors: Array<object>, maxTimelineEntries: number },
 *   flush: () => Promise<void>,
 *   unsubscribe: Function,
 *   snapshot: () => { timeline: Array<object>, todos: Array<object>, diagnostics: { appendSuccessCount: number, appendFailureCount: number, lastError: string | null, recentAppendErrors: Array<object>, maxTimelineEntries: number } }
 * }} RunstoreTelemetrySubscription
 */

/**
 * Subscribe EventBus telemetry into RunStore, while aggregating timeline/todos for UI.
 * @param {object} eventBus EventBus
 * @param {object} runStore RunStore
 * @param {RunstoreTelemetryOptions} [options]
 * @returns {RunstoreTelemetrySubscription}
 */
export function subscribeTelemetry(eventBus, runStore, options = {}) {
  const bus = ensureEventBus(eventBus);
  const store = ensureRunStore(runStore);

  const maxTimelineEntriesRaw = typeof options?.maxTimelineEntries === "number" ? options.maxTimelineEntries : null;
  const allowUnlimitedTimeline = options?.allowUnlimitedTimeline === true;
  const maxTimelineEntries =
    maxTimelineEntriesRaw === null || !Number.isFinite(maxTimelineEntriesRaw)
      ? 2000
      : maxTimelineEntriesRaw <= 0
        ? allowUnlimitedTimeline
          ? Infinity
          : 2000
        : Math.max(1, Math.floor(maxTimelineEntriesRaw));
  if (maxTimelineEntriesRaw !== null && Number.isFinite(maxTimelineEntriesRaw) && maxTimelineEntriesRaw <= 0 && !allowUnlimitedTimeline) {
    logger.warn("maxTimelineEntries<=0 is unsafe; fallback to default", {
      requested: maxTimelineEntriesRaw,
      applied: maxTimelineEntries,
    });
  }

  const timeline = [];
  const todosById = new Map();
  let pending = Promise.resolve();
  let lastError = null;
  let appendFailureCount = 0;
  let appendSuccessCount = 0;
  const recentAppendErrors = [];

  const handler = (evt) => {
    if (evt?.meta?.replay) return;
    timeline.push(toTimelineRow(evt));
    if (maxTimelineEntries !== Infinity && timeline.length > maxTimelineEntries) {
      timeline.splice(0, timeline.length - maxTimelineEntries);
    }

    if (isTodoEvent(evt?.name)) upsertTodo(todosById, evt);

    const runId = toNonEmptyString(evt?.runId) || toNonEmptyString(bus?.runId);
    if (!runId) return;
    pending = pending
      .then(async () => {
        await store.appendEvent(runId, evt);
        appendSuccessCount++;
      })
      .catch((err) => {
        lastError = err;
        appendFailureCount++;
        const message = err instanceof Error ? err.message : String(err ?? "");
        recentAppendErrors.push({ ts: Date.now(), message, runId, name: evt?.name });
        if (recentAppendErrors.length > 20) {
          recentAppendErrors.splice(0, recentAppendErrors.length - 20);
        }
        logger.warn("Telemetry append error", {
          error: message,
          runId,
          name: evt?.name,
          appendFailureCount,
        });
      });
  };

  const unsubscribe = bus.on("*", handler);

  /**
   * Flush pending writes.
   * @returns {Promise<void>} Resolves when all pending writes complete; rejects if the last write failed.
   */
  const flush = async () => {
    await pending;
    if (lastError) {
      const err = lastError;
      lastError = null;
      throw err;
    }
  };
  const diagnostics = () => ({
    appendSuccessCount,
    appendFailureCount,
    lastError: lastError ? (lastError instanceof Error ? lastError.message : String(lastError)) : null,
    recentAppendErrors: recentAppendErrors.slice(),
    maxTimelineEntries,
  });
  const snapshot = () => ({ timeline: timeline.slice(), todos: [...todosById.values()], diagnostics: diagnostics() });

  return {
    timeline,
    get todos() {
      return [...todosById.values()];
    },
    get diagnostics() {
      return diagnostics();
    },
    flush,
    snapshot,
    unsubscribe,
  };
}
