import { matchGlob } from "../../vfs/glob.js";

/**
 * @typedef {string | string[] | null | undefined} PatternInput
 */

/**
 * @param {unknown} pattern
 * @returns {string}
 */
function normalizeGlobPattern(pattern) {
  let p = typeof pattern === "string" ? pattern : "";
  if (!p) return "";
  p = p.replaceAll("\\", "/").trim();
  while (p.startsWith("./")) p = p.slice(2);
  while (p.startsWith("/")) p = p.slice(1);
  return p;
}

/**
 * Two-pointer wildcard matching (avoids ReDoS from dynamic RegExp).
 * Supports '*' as multi-character wildcard.
 * O(m*n) worst case, but typically linear for reasonable patterns.
 * @param {unknown} pattern
 * @param {unknown} value
 * @returns {boolean}
 */
export function matchWildcard(pattern, value) {
  const p = typeof pattern === "string" ? pattern : "";
  const v = typeof value === "string" ? value : "";
  if (!p) return false;
  if (!p.includes("*")) return p === v;

  let pi = 0, vi = 0;
  let starIdx = -1, matchIdx = -1;

  while (vi < v.length) {
    if (pi < p.length && p[pi] !== "*" && p[pi] === v[vi]) {
      pi++;
      vi++;
    } else if (pi < p.length && p[pi] === "*") {
      starIdx = pi;
      matchIdx = vi;
      pi++;
    } else if (starIdx !== -1) {
      pi = starIdx + 1;
      matchIdx++;
      vi = matchIdx;
    } else {
      return false;
    }
  }

  while (pi < p.length && p[pi] === "*") {
    pi++;
  }

  return pi === p.length;
}

/**
 * @param {PatternInput} patterns
 * @param {unknown} value
 * @returns {boolean}
 */
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

/**
 * @param {PatternInput} patterns
 * @param {string} path
 * @returns {boolean}
 */
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
