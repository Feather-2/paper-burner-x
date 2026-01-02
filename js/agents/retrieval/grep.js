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

function normalizeMaxMatches(value, fallback) {
  if (value === Infinity) return Infinity;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function findAllLiteral(haystack, needle, maxMatches) {
  const spans = [];
  if (!needle) return spans;
  const max = normalizeMaxMatches(maxMatches, 50);
  let idx = 0;
  while (true) {
    const at = haystack.indexOf(needle, idx);
    if (at === -1) break;
    spans.push({ start: at, end: at + needle.length });
    idx = at + (needle.length || 1);
    if (max !== Infinity && spans.length >= max) break;
  }
  return spans;
}

function toPositiveInt(value, fallback) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function sleep0() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * @param {Array<{chunkId:string,text:string}>} chunks
 * @param {string|RegExp} pattern
 * @param {{regex?:boolean,caseSensitive?:boolean,maxMatchesPerChunk?:number}=} options
 * @returns {Array<{chunkId:string,matchCount:number,spans:Array<{start:number,end:number}>}>}
 */
export function grepChunks(chunks, pattern, options = {}) {
  if (!Array.isArray(chunks)) throw new TypeError("grepChunks(chunks, pattern): chunks must be an array");
  if (!isPlainObject(options)) throw new TypeError("grepChunks(chunks, pattern, options): options must be an object");

  const regex = Boolean(options.regex) || pattern instanceof RegExp;
  const caseSensitive = Boolean(options.caseSensitive);
  const maxMatchesPerChunk = normalizeMaxMatches(options.maxMatchesPerChunk, 50);

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
        if (maxMatchesPerChunk !== Infinity && spans.length >= maxMatchesPerChunk) break;
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
    const spans = findAllLiteral(text, needle, maxMatchesPerChunk);
    if (spans.length) out.push({ chunkId: c.chunkId, matchCount: spans.length, spans });
  }
  return out;
}

/**
 * Async grep implementation for large chunk lists (yields to the event loop to keep UI responsive).
 *
 * @param {Array<{chunkId:string,text:string}>} chunks
 * @param {string|RegExp} pattern
 * @param {{regex?:boolean,caseSensitive?:boolean,signal?:AbortSignal,yieldEvery?:number,maxMatchesPerChunk?:number}=} options
 * @returns {Promise<Array<{chunkId:string,matchCount:number,spans:Array<{start:number,end:number}>}>>}
 */
export async function grepChunksAsync(chunks, pattern, options = {}) {
  if (!Array.isArray(chunks)) throw new TypeError("grepChunksAsync(chunks, pattern): chunks must be an array");
  if (!isPlainObject(options)) throw new TypeError("grepChunksAsync(chunks, pattern, options): options must be an object");

  const signal = options.signal;
  const yieldEvery = toPositiveInt(options.yieldEvery, 200);
  const maxMatchesPerChunk = normalizeMaxMatches(options.maxMatchesPerChunk, 50);

  const regex = Boolean(options.regex) || pattern instanceof RegExp;
  const caseSensitive = Boolean(options.caseSensitive);

  const out = [];
  if (regex) {
    const re = compileRegex(pattern, caseSensitive);
    for (let i = 0; i < chunks.length; i++) {
      if (signal?.aborted) throw new Error("grepChunksAsync: aborted");
      if (i > 0 && yieldEvery > 0 && i % yieldEvery === 0) await sleep0();

      const c = chunks[i];
      const text = String((c && c.text) || "");
      re.lastIndex = 0;
      const spans = [];
      let m;
      while ((m = re.exec(text))) {
        const start = m.index;
        const end = start + (m[0] ? m[0].length : 0);
        spans.push({ start, end });
        if (m[0] === "") re.lastIndex++; // avoid infinite loop
        if (maxMatchesPerChunk !== Infinity && spans.length >= maxMatchesPerChunk) break;
      }
      if (spans.length) out.push({ chunkId: c.chunkId, matchCount: spans.length, spans });
    }
    return out;
  }

  const needleRaw = String(pattern || "");
  if (!needleRaw) return [];
  const needle = caseSensitive ? needleRaw : needleRaw.toLowerCase();

  for (let i = 0; i < chunks.length; i++) {
    if (signal?.aborted) throw new Error("grepChunksAsync: aborted");
    if (i > 0 && yieldEvery > 0 && i % yieldEvery === 0) await sleep0();

    const c = chunks[i];
    const textRaw = String((c && c.text) || "");
    const text = caseSensitive ? textRaw : textRaw.toLowerCase();
    const spans = findAllLiteral(text, needle, maxMatchesPerChunk);
    if (spans.length) out.push({ chunkId: c.chunkId, matchCount: spans.length, spans });
  }
  return out;
}
