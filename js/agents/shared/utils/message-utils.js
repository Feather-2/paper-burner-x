import { toNonEmptyString } from "./value-utils.js";

/**
 * @typedef {Record<string, any> & { role?: string, content?: any }} ChatMessage
 */

/**
 * Inject a system hint into a chat message list without mutating the original array.
 * @param {ChatMessage[] | null | undefined} messages
 * @param {unknown} hint
 * @returns {ChatMessage[]}
 */
export function injectSystemHint(messages, hint) {
  const text = toNonEmptyString(hint);
  const list = Array.isArray(messages)
    ? messages.map((msg) => (msg && typeof msg === "object" ? { ...msg } : msg))
    : [];

  if (!text) return list;

  // Avoid duplicating hints when multiple wrappers call injectSystemHint().
  for (const msg of list) {
    if (!msg || typeof msg !== "object" || msg.role !== "system") continue;
    const content = typeof msg.content === "string" ? msg.content : String(msg.content ?? "");
    if (content.includes(text)) return list;
  }

  const hintMsg = { role: "system", content: text };

  if (list.length === 0) return [hintMsg];

  // Cache-friendly strategy: do NOT mutate the prefix (system[0]) or unshift.
  // Insert the hint as late as possible (before the last user/tool turn) so the
  // historical prefix stays stable for prompt caching.
  let insertAt = list.length;
  for (let i = list.length - 1; i >= 0; i--) {
    const msg = list[i];
    if (!msg || typeof msg !== "object") continue;
    if (msg.role === "user" || msg.role === "tool") {
      insertAt = i;
      break;
    }
  }

  list.splice(insertAt, 0, hintMsg);
  return list;
}
