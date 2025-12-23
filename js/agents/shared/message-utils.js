import { toNonEmptyString } from "./value-utils.js";

export function injectSystemHint(messages, hint) {
  const text = toNonEmptyString(hint);
  const list = Array.isArray(messages)
    ? messages.map((msg) => (msg && typeof msg === "object" ? { ...msg } : msg))
    : [];

  if (!text) return list;

  if (list.length === 0) {
    return [{ role: "system", content: text }];
  }

  const first = list[0];
  if (first && typeof first === "object" && first.role === "system") {
    const content = typeof first.content === "string" ? first.content : String(first.content ?? "");
    if (!content.includes(text)) {
      list[0] = { ...first, content: content ? `${text}\n\n${content}` : text };
    }
    return list;
  }

  list.unshift({ role: "system", content: text });
  return list;
}
