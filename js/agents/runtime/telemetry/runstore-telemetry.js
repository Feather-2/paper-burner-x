import { isPlainObject, toNonEmptyString } from "../../shared/utils/value-utils.js";

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

function upsertTodo(todosById, evt) {
  const payload = isPlainObject(evt?.payload) ? evt.payload : {};
  const todoId = toNonEmptyString(payload.todoId);
  if (!todoId) return;

  const prev = todosById.get(todoId) || { todoId };
  const next = { ...prev };

  if (toNonEmptyString(payload.text)) next.text = String(payload.text);
  if (toNonEmptyString(payload.status)) next.status = String(payload.status);
  if (toNonEmptyString(payload.relatedGapId)) next.relatedGapId = String(payload.relatedGapId);

  if (!next.createdAt && (evt?.name === "deepsearch.todo.created" || String(evt?.name || "").endsWith(".todo.created"))) {
    next.createdAt = evt.ts;
  }
  next.updatedAt = evt.ts;

  todosById.set(todoId, next);
}

/**
 * Subscribe EventBus telemetry into RunStore, while aggregating timeline/todos for UI.
 * @param {object} eventBus EventBus
 * @param {object} runStore RunStore
 * @param {object} [options]
 * @param {number} [options.maxTimelineEntries=2000] Sliding window size for in-memory timeline (<=0 disables limit).
 * @returns {{timeline:Array<object>,todos:Array<object>,flush:Function,unsubscribe:Function,snapshot:Function}}
 */
export function subscribeTelemetry(eventBus, runStore, options = {}) {
  const bus = ensureEventBus(eventBus);
  const store = ensureRunStore(runStore);

  const maxTimelineEntriesRaw = typeof options?.maxTimelineEntries === "number" ? options.maxTimelineEntries : null;
  const maxTimelineEntries =
    maxTimelineEntriesRaw === null || !Number.isFinite(maxTimelineEntriesRaw) ? 2000 : maxTimelineEntriesRaw <= 0 ? Infinity : Math.floor(maxTimelineEntriesRaw);

  const timeline = [];
  const todosById = new Map();
  let pending = Promise.resolve();

  const handler = (evt) => {
    if (evt?.meta?.replay) return;
    timeline.push(toTimelineRow(evt));
    if (maxTimelineEntries !== Infinity && timeline.length > maxTimelineEntries) {
      timeline.splice(0, timeline.length - maxTimelineEntries);
    }

    if (String(evt?.name || "").includes("todo.")) upsertTodo(todosById, evt);

    const runId = toNonEmptyString(evt?.runId) || toNonEmptyString(bus?.runId);
    if (!runId) return;
    pending = pending.then(() => store.appendEvent(runId, evt)).catch(() => {});
  };

  const unsubscribe = bus.on("*", handler);

  const flush = async () => pending;
  const snapshot = () => ({ timeline: timeline.slice(), todos: [...todosById.values()] });

  return {
    timeline,
    get todos() {
      return [...todosById.values()];
    },
    flush,
    snapshot,
    unsubscribe,
  };
}
