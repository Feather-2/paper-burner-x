import { isPlainObject, toNonEmptyString } from "../shared/index.js";

export const MODEL_TAGS = Object.freeze(["text", "vision", "reasoning", "long-context", "fast", "cheap"]);

/**
 * Normalizes model tags array, removing duplicates and empty values.
 * @param {unknown[]} tags - Raw tags array.
 * @returns {string[]} Normalized unique tags.
 */
export function normalizeModelTags(tags) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(tags) ? tags : []) {
    const t = toNonEmptyString(raw);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * Asserts that an object is a valid ModelEntry.
 * @param {object} entry - Object to validate.
 * @throws {TypeError} If entry is invalid.
 */
export function assertModelEntry(entry) {
  if (!isPlainObject(entry)) throw new TypeError("ModelEntry must be an object");
  const id = toNonEmptyString(entry.id);
  const provider = toNonEmptyString(entry.provider);
  if (!id) throw new TypeError("ModelEntry.id must be a non-empty string");
  if (!provider) throw new TypeError("ModelEntry.provider must be a non-empty string");

  const tags = normalizeModelTags(entry.tags);
  if (!Array.isArray(entry.tags)) throw new TypeError("ModelEntry.tags must be an array");
  // NOTE: tags are intentionally open-ended for forward compatibility and custom routing.
  // Known tags are documented in MODEL_TAGS, but unknown tags are allowed.

  if (entry.limits !== undefined && !isPlainObject(entry.limits)) throw new TypeError("ModelEntry.limits must be an object when present");
  if (entry.limits?.maxTokens !== undefined && (typeof entry.limits.maxTokens !== "number" || !(entry.limits.maxTokens > 0))) {
    throw new TypeError("ModelEntry.limits.maxTokens must be a positive number when present");
  }
  if (entry.limits?.rateLimit !== undefined && (typeof entry.limits.rateLimit !== "number" || !(entry.limits.rateLimit > 0))) {
    throw new TypeError("ModelEntry.limits.rateLimit must be a positive number when present");
  }
}

/**
 * Asserts that an object is a valid UsageConfig.
 * @param {object} config - Object to validate.
 * @throws {TypeError} If config is invalid.
 */
export function assertUsageConfig(config) {
  if (!isPlainObject(config)) throw new TypeError("UsageConfig must be an object");
  for (const [k, list] of Object.entries(config)) {
    if (!toNonEmptyString(k)) throw new TypeError("UsageConfig keys must be non-empty strings");
    if (!Array.isArray(list)) throw new TypeError(`UsageConfig.${k} must be an array`);
    for (const m of list) {
      if (!toNonEmptyString(m)) throw new TypeError(`UsageConfig.${k} entries must be non-empty strings`);
    }
  }
}

/**
 * Asserts that messages array is valid for chat API.
 * @param {unknown[]} messages - Messages array to validate.
 * @throws {TypeError} If messages are invalid.
 */
export function assertChatMessages(messages) {
  if (!Array.isArray(messages)) throw new TypeError("messages must be an array");
  for (const m of messages) {
    if (!isPlainObject(m)) throw new TypeError("messages entries must be objects");
    const msg = /** @type {{ role?: unknown, content?: unknown }} */ (m);
    if (!toNonEmptyString(msg.role)) throw new TypeError("messages.role must be a non-empty string");
    const c = msg.content;
    const ok = typeof c === "string" || (Array.isArray(c) && c.every((p) => isPlainObject(p)));
    if (!ok) throw new TypeError("messages.content must be a string or an array of objects");
  }
}

/**
 * Asserts that a chat response object is valid.
 * @param {object} resp - Response object to validate.
 * @throws {TypeError} If response is invalid.
 */
export function assertChatResponse(resp) {
  if (!isPlainObject(resp)) throw new TypeError("chat() response must be an object");
  if (typeof resp.content !== "string") throw new TypeError("chat() response.content must be a string");
}

/**
 * Asserts that a provider implements the required interface.
 * @param {object} provider - Provider object to validate.
 * @throws {TypeError} If provider is invalid.
 */
export function assertProvider(provider) {
  if (!provider || typeof provider.chat !== "function") throw new TypeError("ModelProvider must implement chat()");
  const id = toNonEmptyString(provider.id);
  if (!id) throw new TypeError("ModelProvider.id must be a non-empty string");
}

/**
 * ModelProvider interface
 * chat({model, messages, images?}) -> Promise<{content: string, ...}>
 */
export class BaseProvider {
  /**
   * @param {{ id?: string, name?: string }} [options]
   */
  constructor({ id, name } = {}) {
    this.id = toNonEmptyString(id) || "provider_unknown";
    this.name = toNonEmptyString(name) || this.id;
    this.capabilities = ["chat"];
  }

  async chat(_input) {
    throw new Error("BaseProvider.chat() not implemented");
  }

  // Unified entrypoint for provider integrations.
  // Text providers treat call() as an alias for chat().
  async call(input) {
    return this.chat(input);
  }
}
