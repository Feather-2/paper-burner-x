import { BaseProvider, assertChatMessages, assertChatResponse } from "./provider.js";

import { isPlainObject, toNonEmptyString } from "../shared/index.js";

/**
 * @typedef {{ role: string, content: (string | Array<Record<string, any>>) }} ChatMessage
 */

/**
 * @typedef {object} ChatResponse
 * @property {string} content
 * @property {string} model
 * @property {string} provider
 */

/**
 * @typedef {object} MockOutcomeContext
 * @property {string} model
 * @property {ChatMessage[]} messages
 * @property {any=} images
 * @property {number} callIndex
 */

/**
 * @typedef {object} MockOutcomeObject
 * @property {string=} content
 * @property {unknown=} throw
 * @property {number=} delayMs
 */

/**
 * @typedef {string | Error | MockOutcomeObject | ((ctx: MockOutcomeContext) => (unknown | Promise<unknown>))} MockProviderOutcome
 */

/**
 * @typedef {object} MockProviderOptions
 * @property {string=} id
 * @property {string=} name
 * @property {Record<string, MockProviderOutcome | MockProviderOutcome[]>=} behaviors
 * @property {MockProviderOutcome=} defaultOutcome
 */

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
  /**
   * @param {MockProviderOptions} [options]
   */
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

  /**
   * @returns {Array<{ model: string, messages: ChatMessage[], images?: any }>}
   */
  get calls() {
    return this._calls;
  }

  /**
   * @param {string} modelId
   * @param {MockProviderOutcome | MockProviderOutcome[]} outcomes
   * @returns {void}
   */
  setBehaviors(modelId, outcomes) {
    const m = toNonEmptyString(modelId);
    if (!m) throw new TypeError("setBehaviors(modelId, outcomes): modelId must be a non-empty string");
    const list = Array.isArray(outcomes) ? outcomes : [outcomes];
    this._behaviors.set(
      m,
      list.map((o) => normalizeOutcome(o))
    );
  }

  /**
   * @param {string} modelId
   * @param {MockProviderOutcome} outcome
   * @returns {void}
   */
  pushOutcome(modelId, outcome) {
    const m = toNonEmptyString(modelId);
    if (!m) throw new TypeError("pushOutcome(modelId, outcome): modelId must be a non-empty string");
    const q = this._behaviors.get(m) || [];
    q.push(normalizeOutcome(outcome));
    this._behaviors.set(m, q);
  }

  /**
   * @param {{ model: string, messages: ChatMessage[], images?: any }} [input]
   * @returns {Promise<ChatResponse>}
   */
  async chat({ model, messages, images } = /** @type {any} */ ({})) {
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
