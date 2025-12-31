import { matchGlob } from "../../vfs/glob.js";

function escapeRegExp(s) {
  return s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeGlobPattern(pattern) {
  let p = typeof pattern === "string" ? pattern : "";
  if (!p) return "";
  p = p.replaceAll("\\", "/").trim();
  while (p.startsWith("./")) p = p.slice(2);
  while (p.startsWith("/")) p = p.slice(1);
  return p;
}

export function matchWildcard(pattern, value) {
  const p = typeof pattern === "string" ? pattern : "";
  const v = typeof value === "string" ? value : "";
  if (!p) return false;
  if (!p.includes("*")) return p === v;
  const re = new RegExp("^" + p.split("*").map(escapeRegExp).join(".*") + "$");
  return re.test(v);
}

export function matchAnyWildcard(patterns, value) {
  if (patterns === null || patterns === undefined) return true;
  const list = Array.isArray(patterns) ? patterns : [patterns];
  if (list.length === 0) return true;
  for (const p of list) {
    if (typeof p !== "string") continue;
    if (matchWildcard(p, value)) return true;
  }
  return false;
}

export function matchAnyGlob(patterns, path) {
  if (patterns === null || patterns === undefined) return true;
  const list = Array.isArray(patterns) ? patterns : [patterns];
  if (list.length === 0) return true;
  for (const p of list) {
    if (typeof p !== "string") continue;
    const normalized = normalizeGlobPattern(p);
    if (!normalized) continue;
    if (matchGlob(normalized, path)) return true;
  }
  return false;
}

export default { matchWildcard, matchAnyWildcard, matchAnyGlob };
