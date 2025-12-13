import { BaseProvider, assertChatMessages, assertChatResponse } from "./provider.js";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toNonEmptyString(v) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function normalizeOutcome(outcome) {
  if (typeof outcome === "function") return outcome;
  if (outcome instanceof Error) return { throw: outcome };
  if (typeof outcome === "string") return { content: outcome };
  if (isPlainObject(outcome)) return outcome;
  return { content: String(outcome ?? "") };
}

/**
 * MockProvider outcome:
 * - string => {content}
 * - Error => throws
 * - {content, delayMs?} => success
 * - {throw: Error, delayMs?} => throws
 * - (ctx) => outcome | Promise<outcome>
 */
export class MockProvider extends BaseProvider {
  constructor({ id = "mock", name = "MockProvider", behaviors, defaultOutcome } = {}) {
    super({ id, name });
    this._behaviors = new Map();
    this._calls = [];
    this._defaultOutcome = normalizeOutcome(defaultOutcome ?? { content: "" });

    if (behaviors && typeof behaviors === "object") {
      for (const [modelId, outcomes] of Object.entries(behaviors)) {
        this.setBehaviors(modelId, outcomes);
      }
    }
  }

  get calls() {
    return this._calls;
  }

  setBehaviors(modelId, outcomes) {
    const m = toNonEmptyString(modelId);
    if (!m) throw new TypeError("setBehaviors(modelId, outcomes): modelId must be a non-empty string");
    const list = Array.isArray(outcomes) ? outcomes : [outcomes];
    this._behaviors.set(
      m,
      list.map((o) => normalizeOutcome(o))
    );
  }

  pushOutcome(modelId, outcome) {
    const m = toNonEmptyString(modelId);
    if (!m) throw new TypeError("pushOutcome(modelId, outcome): modelId must be a non-empty string");
    const q = this._behaviors.get(m) || [];
    q.push(normalizeOutcome(outcome));
    this._behaviors.set(m, q);
  }

  async chat({ model, messages, images } = {}) {
    const m = toNonEmptyString(model);
    if (!m) throw new TypeError("chat({model}): model must be a non-empty string");
    assertChatMessages(messages);

    const callIndex = this._calls.length;
    this._calls.push({ model: m, messages, images });

    const queue = this._behaviors.get(m) || this._behaviors.get("*") || [];
    const next = queue.length ? queue.shift() : this._defaultOutcome;
    if (queue.length || this._behaviors.has(m) || this._behaviors.has("*")) {
      if (this._behaviors.has(m)) this._behaviors.set(m, queue);
      if (!this._behaviors.has(m) && this._behaviors.has("*")) this._behaviors.set("*", queue);
    }

    const resolved = typeof next === "function" ? await next({ model: m, messages, images, callIndex }) : next;
    const outcome = normalizeOutcome(resolved);

    const delayMs = typeof outcome.delayMs === "number" && outcome.delayMs > 0 ? Math.floor(outcome.delayMs) : 0;
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));

    if (outcome.throw) throw outcome.throw instanceof Error ? outcome.throw : new Error(String(outcome.throw));

    const resp = { content: String(outcome.content ?? ""), model: m, provider: this.id };
    assertChatResponse(resp);
    return resp;
  }
}

