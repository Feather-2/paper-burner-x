import { computeSha256 } from "../../../storage/artifact-manager.js";
import { initTreeSitter, loadTreeSitterLanguage } from "../../../shared/parser/tree-sitter-wasm.js";
import CodeSearchIndexStore from "./index-store.js";

function toNonEmptyString(v) {
  if (v === null || v === undefined) return "";
  const s = String(v).trim();
  return s.length ? s : "";
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function extname(path) {
  const p = toNonEmptyString(path);
  const idx = p.lastIndexOf(".");
  return idx >= 0 ? p.slice(idx).toLowerCase() : "";
}

function detectLanguageForPath(path) {
  const ext = extname(path);
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs" || ext === ".jsx") return "javascript";
  if (ext === ".ts") return "typescript";
  if (ext === ".tsx") return "tsx";
  if (ext === ".json") return "json";
  return null;
}

const LANGUAGE_WASM = Object.freeze({
  javascript: "tree-sitter-javascript.wasm",
  typescript: "tree-sitter-typescript.wasm",
  tsx: "tree-sitter-tsx.wasm",
  json: "tree-sitter-json.wasm",
});

function extractWithRegex(text, path) {
  const lines = String(text || "").split("\n");
  const out = [];

  const push = (kind, name, lineNo, signature) => {
    if (!name) return;
    out.push({
      name,
      kind,
      file: path,
      startLine: lineNo,
      endLine: lineNo,
      signature: signature || null,
      parser: "regex",
    });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;

    let m = trimmed.match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/);
    if (m) {
      push("function", m[1], i + 1, trimmed);
      continue;
    }

    m = trimmed.match(/^(?:export\s+)?class\s+([A-Za-z0-9_$]+)/);
    if (m) {
      push("class", m[1], i + 1, trimmed);
      continue;
    }

    m = trimmed.match(/^(?:export\s+)?interface\s+([A-Za-z0-9_$]+)/);
    if (m) {
      push("interface", m[1], i + 1, trimmed);
      continue;
    }

    m = trimmed.match(/^(?:export\s+)?type\s+([A-Za-z0-9_$]+)\s*=/);
    if (m) {
      push("type", m[1], i + 1, trimmed);
      continue;
    }

    m = trimmed.match(/^(?:export\s+)?enum\s+([A-Za-z0-9_$]+)/);
    if (m) {
      push("enum", m[1], i + 1, trimmed);
      continue;
    }
  }

  return out;
}

function extractJsTsSymbolsFromTree(rootNode, path) {
  const out = [];
  if (!rootNode) return out;

  const visit = (node) => {
    if (!node) return;
    const type = node.type;

    // JS/TS nodes
    if (type === "function_declaration" || type === "generator_function_declaration") {
      const nameNode = node.childForFieldName?.("name");
      const name = toNonEmptyString(nameNode?.text);
      const startLine = (nameNode?.startPosition?.row ?? node.startPosition?.row ?? 0) + 1;
      const endLine = (node.endPosition?.row ?? startLine - 1) + 1;
      if (name) {
        out.push({ name, kind: "function", file: path, startLine, endLine, signature: null, parser: "tree-sitter" });
      }
    } else if (type === "class_declaration") {
      const nameNode = node.childForFieldName?.("name");
      const name = toNonEmptyString(nameNode?.text);
      const startLine = (nameNode?.startPosition?.row ?? node.startPosition?.row ?? 0) + 1;
      const endLine = (node.endPosition?.row ?? startLine - 1) + 1;
      if (name) {
        out.push({ name, kind: "class", file: path, startLine, endLine, signature: null, parser: "tree-sitter" });
      }
    } else if (type === "interface_declaration") {
      const nameNode = node.childForFieldName?.("name");
      const name = toNonEmptyString(nameNode?.text);
      const startLine = (nameNode?.startPosition?.row ?? node.startPosition?.row ?? 0) + 1;
      const endLine = (node.endPosition?.row ?? startLine - 1) + 1;
      if (name) {
        out.push({ name, kind: "interface", file: path, startLine, endLine, signature: null, parser: "tree-sitter" });
      }
    } else if (type === "type_alias_declaration") {
      const nameNode = node.childForFieldName?.("name");
      const name = toNonEmptyString(nameNode?.text);
      const startLine = (nameNode?.startPosition?.row ?? node.startPosition?.row ?? 0) + 1;
      const endLine = (node.endPosition?.row ?? startLine - 1) + 1;
      if (name) {
        out.push({ name, kind: "type", file: path, startLine, endLine, signature: null, parser: "tree-sitter" });
      }
    } else if (type === "enum_declaration") {
      const nameNode = node.childForFieldName?.("name");
      const name = toNonEmptyString(nameNode?.text);
      const startLine = (nameNode?.startPosition?.row ?? node.startPosition?.row ?? 0) + 1;
      const endLine = (node.endPosition?.row ?? startLine - 1) + 1;
      if (name) {
        out.push({ name, kind: "enum", file: path, startLine, endLine, signature: null, parser: "tree-sitter" });
      }
    }

    const children = Array.isArray(node.namedChildren) ? node.namedChildren : [];
    for (const child of children) visit(child);
  };

  visit(rootNode);
  return out;
}

export class SymbolIndexer {
  constructor({ vfs, store, workspaceId = "default", wasmBaseUrl, logger, emit } = {}) {
    this.vfs = vfs || null;
    this.store = store instanceof CodeSearchIndexStore ? store : new CodeSearchIndexStore();
    this.workspaceId = toNonEmptyString(workspaceId) || "default";
    this.wasmBaseUrl = wasmBaseUrl;
    this.logger = logger || null;
    this.emit = typeof emit === "function" ? emit : null;

    this._langCache = new Map(); // lang -> Language
    this._treeSitterReady = false;
    this._treeSitterFailed = false;
  }

  _log(level, msg, data) {
    if (this.logger && typeof this.logger[level] === "function") {
      this.logger[level](`[SymbolIndexer] ${msg}`, data || {});
    }
  }

  _emit(name, payload) {
    if (typeof this.emit === "function") this.emit(name, payload);
  }

  async _ensureTreeSitter() {
    if (this._treeSitterReady) return true;
    if (this._treeSitterFailed) return false;
    try {
      await initTreeSitter({ ...(this.wasmBaseUrl ? { wasmBaseUrl: this.wasmBaseUrl } : {}) });
      this._treeSitterReady = true;
      return true;
    } catch (err) {
      this._treeSitterFailed = true;
      const msg = err instanceof Error ? err.message : String(err);
      this._log("warn", "Tree-sitter init failed; falling back to regex", { error: msg });
      return false;
    }
  }

  async _getLanguage(langId) {
    const id = toNonEmptyString(langId);
    if (!id) return null;
    if (this._langCache.has(id)) return this._langCache.get(id);
    const wasm = LANGUAGE_WASM[id];
    if (!wasm) return null;

    const ok = await this._ensureTreeSitter();
    if (!ok) return null;

    try {
      const lang = await loadTreeSitterLanguage(wasm, { ...(this.wasmBaseUrl ? { wasmBaseUrl: this.wasmBaseUrl } : {}) });
      if (lang) this._langCache.set(id, lang);
      return lang;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._log("warn", `Failed to load language wasm: ${id}`, { error: msg });
      return null;
    }
  }

  async extractSymbols(text, path) {
    const file = toNonEmptyString(path);
    const langId = detectLanguageForPath(file);
    if (!langId) return extractWithRegex(text, file);

    const lang = await this._getLanguage(langId);
    if (!lang) return extractWithRegex(text, file);

    try {
      const mod = await import("web-tree-sitter");
      const Parser = mod.Parser || mod.default?.Parser || mod.default;
      const parser = new Parser();
      parser.setLanguage(lang);
      const tree = parser.parse(String(text || ""));
      const root = tree?.rootNode;
      if (!root) return extractWithRegex(text, file);
      return extractJsTsSymbolsFromTree(root, file);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._log("warn", "Tree-sitter parse failed; falling back to regex", { file, error: msg });
      return extractWithRegex(text, file);
    }
  }

  async indexFile(path) {
    if (!this.vfs || typeof this.vfs.readText !== "function") {
      throw new Error("SymbolIndexer.indexFile: vfs.readText is required");
    }
    const file = toNonEmptyString(path);
    if (!file) throw new Error("SymbolIndexer.indexFile: path is required");

    const text = await this.vfs.readText(file);
    const sha256 = await computeSha256(text);

    const existing = await this.store.getSymbolRecord(this.workspaceId, file);
    if (existing && existing.sha256 && sha256 && existing.sha256 === sha256) {
      return { ok: true, path: file, skipped: true, symbols: existing.symbols || [] };
    }

    const symbols = await this.extractSymbols(text, file);
    await this.store.putSymbolRecord(this.workspaceId, file, { sha256, symbols });
    return { ok: true, path: file, skipped: false, symbols };
  }

  async indexFiles(paths = []) {
    const list = Array.isArray(paths) ? paths : [];
    const results = [];
    for (const p of list) {
      const file = toNonEmptyString(p);
      if (!file) continue;
      try {
        results.push(await this.indexFile(file));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ ok: false, path: file, error: msg });
      }
    }
    return results;
  }

  async query({ query = "", pathPrefix = "", limit = 50 } = {}) {
    const q = toNonEmptyString(query).toLowerCase();
    const prefix = toNonEmptyString(pathPrefix);
    const lim = Number.isFinite(Number(limit)) ? Math.max(1, Math.floor(Number(limit))) : 50;

    const rows = await this.store.listSymbolRecords(this.workspaceId);
    const out = [];
    for (const row of rows) {
      const file = toNonEmptyString(row?.path);
      if (prefix && !file.startsWith(prefix)) continue;
      for (const sym of Array.isArray(row?.symbols) ? row.symbols : []) {
        if (!sym || typeof sym !== "object") continue;
        const name = toNonEmptyString(sym.name);
        if (!name) continue;
        if (q && !name.toLowerCase().includes(q)) continue;
        out.push(sym);
        if (out.length >= lim) return out;
      }
    }
    return out;
  }
}

export default SymbolIndexer;

