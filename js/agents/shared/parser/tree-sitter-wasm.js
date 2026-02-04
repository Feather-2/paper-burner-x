let _initPromise = null;
let _parserMod = null;

import { isWasmSupported } from "../utils/wasm-support.js";
import { isNodeLike } from "../platform.js";

function isWebRuntime() {
  if (isNodeLike()) return false;
  return typeof fetch === "function" && typeof URL === "function";
}

function resolveBaseUrl(baseUrl) {
  const raw = typeof baseUrl === "string" && baseUrl.trim() ? baseUrl.trim() : "wasm/tree-sitter/";
  const normalized = raw.endsWith("/") ? raw : raw + "/";
  try {
    return new URL(normalized, globalThis.location?.href).toString();
  } catch {
    return normalized;
  }
}

export const DEFAULT_TREE_SITTER_WASM_BASE_URL = "wasm/tree-sitter/";

/**
 * Initialize web-tree-sitter (WASM) in browser.
 * @param {object} [options]
 * @param {string} [options.wasmBaseUrl="wasm/tree-sitter/"]
 * @returns {Promise<{Parser:any,Language:any,wasmBaseUrl:string}|null>}
 */
export async function initTreeSitter({ wasmBaseUrl = DEFAULT_TREE_SITTER_WASM_BASE_URL } = {}) {
  if (!isWebRuntime()) return null;
  if (!isWasmSupported()) throw new Error("Tree-sitter requires WebAssembly support");
  if (_parserMod) return _parserMod; // Already initialized successfully
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const base = resolveBaseUrl(wasmBaseUrl);
    const mod = await import("web-tree-sitter");
    const Parser = mod.Parser || mod.default?.Parser || mod.default;
    const Language = mod.Language || mod.default?.Language;
    const ParserAny =
      /** @type {{ init: (options: { locateFile: (name: string) => string }) => Promise<void> } | null | undefined} */ (Parser);
    const LanguageAny = /** @type {{ load: (url: string) => Promise<unknown> } | null | undefined} */ (Language);
    if (!ParserAny || typeof ParserAny.init !== "function") {
      throw new Error("web-tree-sitter Parser.init unavailable");
    }
    if (!LanguageAny || typeof LanguageAny.load !== "function") {
      throw new Error("web-tree-sitter Language.load unavailable");
    }

    await ParserAny.init({
      locateFile: (name) => new URL(name, base).toString(),
    });

    _parserMod = { Parser: ParserAny, Language: LanguageAny, wasmBaseUrl: base };
    return _parserMod;
  })().catch((err) => {
    // Clear cached promise on failure to allow retry (avoid zombie promise).
    _initPromise = null;
    throw err;
  });

  return _initPromise;
}

/**
 * Load a Tree-sitter language from a WASM file.
 * @param {string} wasmFileName - The WASM file name for the language (e.g., "tree-sitter-javascript.wasm").
 * @param {object} [options] - Options.
 * @param {string} [options.wasmBaseUrl="wasm/tree-sitter/"] - Base URL for WASM files.
 * @returns {Promise<any | null>} The loaded Language object, or null if not in web runtime.
 */
export async function loadTreeSitterLanguage(wasmFileName, { wasmBaseUrl = DEFAULT_TREE_SITTER_WASM_BASE_URL } = {}) {
  const env = await initTreeSitter({ wasmBaseUrl });
  if (!env) return null;
  const name = typeof wasmFileName === "string" ? wasmFileName.trim() : "";
  if (!name) throw new Error("loadTreeSitterLanguage(wasmFileName): wasmFileName is required");
  return env.Language.load(new URL(name, env.wasmBaseUrl).toString());
}

export default { initTreeSitter, loadTreeSitterLanguage, DEFAULT_TREE_SITTER_WASM_BASE_URL };
