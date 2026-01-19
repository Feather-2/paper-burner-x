import { cryptoRandomHex } from "../../shared/index.js";

export function generateId(prefix = "id") {
  const ts = Date.now().toString(36);
  const rand = cryptoRandomHex(3);
  return `${prefix}_${ts}_${rand}`;
}

export function truncate(text, maxLen = 200) {
  if (!text || text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}
