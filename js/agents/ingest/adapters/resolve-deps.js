/**
 * Shared dependency resolvers for ingest adapters.
 *
 * Resolution order: stageApi injection → globalThis → dynamic import.
 * Centralizes duplicate resolveTurndownService/resolveDOMParser across
 * html.js, docx.js, epub.js (AUDIT E4).
 */

/**
 * Resolve TurndownService (sync: stageApi/globalThis only).
 * @param {Record<string, any>} [stageApi]
 * @returns {Function | null}
 */
export function resolveTurndownService(stageApi) {
  if (typeof stageApi?.TurndownService === "function") return stageApi.TurndownService;
  if (typeof globalThis?.TurndownService === "function") return globalThis.TurndownService;
  return null;
}

/**
 * Async import TurndownService (Node.js / bundler fallback).
 * @returns {Promise<Function | null>}
 */
export async function importTurndownService() {
  try {
    const mod = await import(/* @vite-ignore */ "turndown");
    return mod.default || mod.TurndownService || mod;
  } catch {
    return null;
  }
}

/**
 * Resolve DOMParser.
 * @param {Record<string, any>} [stageApi]
 * @returns {any}
 */
export function resolveDOMParser(stageApi) {
  if (typeof stageApi?.DOMParser === "function") return stageApi.DOMParser;
  if (typeof globalThis.DOMParser === "function") return globalThis.DOMParser;
  return null;
}

/**
 * Resolve mammoth library.
 * @param {Record<string, any>} [stageApi]
 * @returns {any}
 */
export function resolveMammoth(stageApi) {
  if (stageApi?.mammoth && typeof stageApi.mammoth.convertToHtml === "function") return stageApi.mammoth;
  if (globalThis?.mammoth && typeof globalThis.mammoth.convertToHtml === "function") return globalThis.mammoth;
  return null;
}

/**
 * Async import mammoth (Node.js fallback).
 * @returns {Promise<any>}
 */
export async function importMammoth() {
  try {
    const mod = await import(/* @vite-ignore */ "mammoth");
    const mammoth = mod?.default || mod;
    return mammoth && typeof mammoth.convertToHtml === "function" ? mammoth : null;
  } catch {
    return null;
  }
}

/**
 * Resolve PPTX parser.
 * @param {Record<string, any>} [stageApi]
 * @returns {Promise<any>}
 */
export async function resolvePptxParser(stageApi) {
  if (stageApi?.pptxParser && typeof stageApi.pptxParser.parse === "function") return stageApi.pptxParser;
  if (typeof globalThis?.PPTXSlideParser === "function") return new globalThis.PPTXSlideParser();
  return null;
}
