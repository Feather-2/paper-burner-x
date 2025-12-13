const STATE_SCHEMA_VERSION = "0.1";

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function toNonEmptyString(v) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

export function extractJsonCandidate(text) {
  const s = String(text || "").trim();
  if (!s) return null;

  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced && fenced[1]) return fenced[1].trim();

  const firstBrace = s.indexOf("{");
  const lastBrace = s.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) return s.slice(firstBrace, lastBrace + 1);

  const firstBracket = s.indexOf("[");
  const lastBracket = s.lastIndexOf("]");
  if (firstBracket >= 0 && lastBracket > firstBracket) return s.slice(firstBracket, lastBracket + 1);

  return s;
}

export function makeStageEmitter(stageApi, actor = "deepsearch") {
  const emitFn = stageApi?.emit || stageApi?.eventBus?.emit;
  if (typeof emitFn !== "function") return null;
  return (name, payload, { status = "completed" } = {}) => emitFn.call(stageApi?.eventBus || null, name, { actor, status, payload });
}

export function checkCancelled(stageApi) {
  if (typeof stageApi?.checkCancelled === "function") stageApi.checkCancelled();
  if (stageApi?.signal?.aborted) {
    const reason = stageApi.signal.reason;
    throw new Error(typeof reason === "string" ? reason : "Run cancelled");
  }
}

export class DeepSearchState {
  constructor({ runId, taskGoal, userConfig, L0, L1, L2, todos, timeline, createdAt, schemaVersion } = {}) {
    this.schemaVersion = toNonEmptyString(schemaVersion) || STATE_SCHEMA_VERSION;
    this.runId = toNonEmptyString(runId) || "run_unknown";
    this.createdAt = toNonEmptyString(createdAt) || new Date().toISOString();

    this.taskGoal = toNonEmptyString(taskGoal) || "";
    this.userConfig = isPlainObject(userConfig) ? userConfig : {};

    this.L0 = isPlainObject(L0)
      ? L0
      : {
          sources: [],
          sourceIndex: null,
        };

    this.L1 = isPlainObject(L1)
      ? L1
      : {
          scanSummary: null,
          deepDivePlan: null,
          gaps: [],
          retrieved: [],
          claims: [],
          evidenceLedger: [],
          dataTables: [],
          slideIntents: [],
          outlineCandidates: [],
          conflicts: [],
          openQuestions: [],
          condensedMemory: null,
        };

    this.L2 = isPlainObject(L2)
      ? L2
      : {
          retrievedChunks: [],
          scratchpad: {},
          logs: [],
        };

    this.todos = Array.isArray(todos) ? todos : [];
    this.timeline = Array.isArray(timeline) ? timeline : [];
  }

  addTodo({ todoId, text, status = "open", relatedGapId } = {}) {
    const id = toNonEmptyString(todoId) || `todo_${this.todos.length + 1}`;
    const t = toNonEmptyString(text) || "";
    const st = toNonEmptyString(status) || "open";
    const row = { todoId: id, text: t, status: st, ...(toNonEmptyString(relatedGapId) ? { relatedGapId: String(relatedGapId) } : {}) };
    this.todos.push(row);
    return row;
  }

  addTimeline({ name, status = "info", payload } = {}) {
    const n = toNonEmptyString(name) || "deepsearch.event";
    const st = toNonEmptyString(status) || "info";
    const row = { ts: new Date().toISOString(), name: n, status: st, ...(payload !== undefined ? { payload } : {}) };
    this.timeline.push(row);
    return row;
  }

  toJSON() {
    return {
      schemaVersion: this.schemaVersion,
      runId: this.runId,
      createdAt: this.createdAt,
      taskGoal: this.taskGoal,
      userConfig: this.userConfig,
      L0: this.L0,
      L1: this.L1,
      L2: this.L2,
      todos: this.todos,
      timeline: this.timeline,
    };
  }

  serialize({ pretty = false } = {}) {
    return JSON.stringify(this.toJSON(), null, pretty ? 2 : 0);
  }

  static fromJSON(json) {
    if (!isPlainObject(json)) throw new TypeError("DeepSearchState.fromJSON(json): json must be an object");
    return new DeepSearchState(json);
  }

  static deserialize(text) {
    const parsed = JSON.parse(String(text || ""));
    return DeepSearchState.fromJSON(parsed);
  }
}
