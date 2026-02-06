/**
 * Shared dependency resolvers for ingest adapters.
 *
 * Resolution order: stageApi injection → globalThis → dynamic import.
 * Centralizes duplicate resolveTurndownService/resolveDOMParser across
 * html.js, docx.js, epub.js (AUDIT E4).
 */

/**
 * Resolve TurndownService.
 * @param {Record<string, any>} [stageApi]
 * @returns {Promise<any>}
 */
export async function resolveTurndownService(stageApi) {
  if (typeof stageApi?.TurndownService === "function") return stageApi.TurndownService;
  if (typeof globalThis?.TurndownService === "function") return globalThis.TurndownService;
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
