import { isPlainObject } from "../shared/utils/value-utils.js";
import { createSafeRegex } from "../shared/utils/safe-regex.js";

function compileRegex(pattern, caseSensitive) {
  if (pattern instanceof RegExp) {
    const flags = pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g";
    const wantI = !caseSensitive;
    const hasI = flags.includes("i");
    const outFlags = wantI && !hasI ? flags + "i" : !wantI && hasI ? flags.replace(/i/g, "") : flags;
    return new RegExp(pattern.source, outFlags);
  }
  const src = String(pattern || "");
  const flags = caseSensitive ? "gu" : "giu";
  return createSafeRegex(src, flags);
}

function findAllLiteral(haystack, needle) {
  const spans = [];
  if (!needle) return spans;
  let idx = 0;
  while (true) {
    const at = haystack.indexOf(needle, idx);
    if (at === -1) break;
    spans.push({ start: at, end: at + needle.length });
    idx = at + (needle.length || 1);
    if (spans.length >= 50) break;
  }
  return spans;
}

/**
 * @param {Array<{chunkId:string,text:string}>} chunks
 * @param {string|RegExp} pattern
 * @param {{regex?:boolean,caseSensitive?:boolean}=} options
 * @returns {Array<{chunkId:string,matchCount:number,spans:Array<{start:number,end:number}>}>}
 */
export function grepChunks(chunks, pattern, options = {}) {
  if (!Array.isArray(chunks)) throw new TypeError("grepChunks(chunks, pattern): chunks must be an array");
  if (!isPlainObject(options)) throw new TypeError("grepChunks(chunks, pattern, options): options must be an object");

  const regex = Boolean(options.regex) || pattern instanceof RegExp;
  const caseSensitive = Boolean(options.caseSensitive);

  const out = [];
  if (regex) {
    const re = compileRegex(pattern, caseSensitive);
    for (const c of chunks) {
      const text = String((c && c.text) || "");
      re.lastIndex = 0;
      const spans = [];
      let m;
      while ((m = re.exec(text))) {
        const start = m.index;
        const end = start + (m[0] ? m[0].length : 0);
        spans.push({ start, end });
        if (m[0] === "") re.lastIndex++; // avoid infinite loop
        if (spans.length >= 50) break;
      }
      if (spans.length) out.push({ chunkId: c.chunkId, matchCount: spans.length, spans });
    }
    return out;
  }

  const needleRaw = String(pattern || "");
  if (!needleRaw) return [];
  const needle = caseSensitive ? needleRaw : needleRaw.toLowerCase();

  for (const c of chunks) {
    const textRaw = String((c && c.text) || "");
    const text = caseSensitive ? textRaw : textRaw.toLowerCase();
    const spans = findAllLiteral(text, needle);
    if (spans.length) out.push({ chunkId: c.chunkId, matchCount: spans.length, spans });
  }
  return out;
}

