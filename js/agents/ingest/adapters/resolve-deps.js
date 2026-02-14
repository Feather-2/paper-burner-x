/**
 * Shared dependency resolvers for ingest adapters (AUDIT E4).
 *
 * Provides unified dependency injection for all ingest adapters, eliminating
 * scattered globalThis checks and inconsistent error messages.
 *
 * Resolution order: stageApi injection → globalThis → dynamic import.
 *
 * Usage:
 * - Adapters call resolve functions with stageApi parameter
 * - If dependency is missing, resolvers return null
 * - Adapters throw clear errors with installation instructions
 *
 * Supported dependencies:
 * - TurndownService (HTML → Markdown conversion)
 * - DOMParser (HTML/XML parsing)
 * - mammoth (DOCX → HTML conversion)
 * - PPTXSlideParser (PPTX parsing)
 * - OcrManager (PDF OCR processing)
 * - whisperApi (Audio/Video transcription)
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

/**
 * Resolve OCR manager (for PDF processing).
 * @param {Record<string, any>} [stageApi]
 * @returns {any}
 */
export function resolveOcrManager(stageApi) {
  // 1. stageApi injection (highest priority)
  if (stageApi?.ocr && typeof stageApi.ocr.processFile === "function") return stageApi.ocr;
  if (stageApi?.ocrManager && typeof stageApi.ocrManager.processFile === "function") return stageApi.ocrManager;

  // 2. globalThis (browser environment)
  const OcrManagerClass = globalThis?.OcrManager;
  if (!OcrManagerClass) return null;

  // If already instantiated
  if (typeof OcrManagerClass.processFile === "function") return OcrManagerClass;

  // If it's a class, instantiate it
  if (typeof OcrManagerClass === "function") {
    try {
      const instance = new OcrManagerClass();
      return typeof instance.processFile === "function" ? instance : null;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Resolve Whisper API (for audio/video transcription).
 * @param {Record<string, any>} [stageApi]
 * @param {any} [injected] - Constructor-injected whisperApi
 * @param {'audio'|'video'} [mode='audio'] - Adapter mode (affects method name fallback)
 * @returns {any}
 */
export function resolveWhisperApi(stageApi, injected, mode = 'audio') {
  const api = stageApi?.whisperApi || stageApi?.services?.whisperApi || injected;
  if (!api) return null;

  // Standard method: transcribe
  if (typeof api.transcribe === "function") return api;

  // Fallback methods based on mode
  if (mode === 'audio' && typeof api.transcribeAudio === "function") {
    return { transcribe: api.transcribeAudio.bind(api) };
  }
  if (mode === 'video' && typeof api.transcribeVideo === "function") {
    return { transcribe: api.transcribeVideo.bind(api) };
  }

  return null;
}
