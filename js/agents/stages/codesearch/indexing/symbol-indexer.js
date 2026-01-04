import { computeSha256 } from "../../../storage/artifact-manager.js";
import { initTreeSitter, loadTreeSitterLanguage } from "../../../shared/parser/tree-sitter-wasm.js";
import CodeSearchIndexStore from "./index-store.js";

import { isPlainObject, toNonEmptyString } from "../../../shared/utils/value-utils.js";
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

function isBlankLine(line) {
  return !String(line || "").trim();
}

function stripBlockCommentMarkers(text) {
  let s = String(text || "");
  s = s.replace(/^\s*\/\*\*?/, "");
  s = s.replace(/\*\/\s*$/, "");
  const lines = s.split("\n").map((line) => line.replace(/^\s*\*\s?/, "").trimEnd());
  return lines.join("\n").trim();
}

function stripLineCommentMarkers(lines) {
  const out = [];
  for (const line of Array.isArray(lines) ? lines : []) {
    const s = String(line || "");
    const idx = s.indexOf("//");
    if (idx < 0) continue;
    out.push(s.slice(idx + 2).trim());
  }
  return out.join("\n").trim();
}

function extractLeadingDoc(lines, startLine, { maxLines = 20, maxChars = 1200 } = {}) {
  const list = Array.isArray(lines) ? lines : [];
  const anchor = Number.isFinite(Number(startLine)) ? Math.floor(Number(startLine)) : 0;
  let i = Math.min(list.length - 1, Math.max(0, anchor - 2));

  // Skip blank lines directly above the declaration.
  while (i >= 0 && isBlankLine(list[i])) i -= 1;
  if (i < 0) return null;

  const line = String(list[i] || "").trim();

  // 1) Block comment (/* ... */), including JSDoc (/** ... */).
  if (line.includes("*/")) {
    const collected = [];
    let linesUsed = 0;
    let foundStart = false;
    for (let j = i; j >= 0 && linesUsed < maxLines; j--) {
      const raw = String(list[j] || "");
      collected.unshift(raw);
      linesUsed += 1;
      if (raw.includes("/*")) {
        foundStart = true;
        break;
      }
    }
    if (!foundStart) return null;
    const cleaned = stripBlockCommentMarkers(collected.join("\n"));
    if (!cleaned) return null;
    const clipped = cleaned.length > maxChars ? cleaned.slice(0, maxChars) + "..." : cleaned;
    return clipped;
  }

  // 2) Line comments (// ...), common in JS/TS.
  if (line.startsWith("//")) {
    const collected = [];
    let linesUsed = 0;
    for (let j = i; j >= 0 && linesUsed < maxLines; j--) {
      const raw = String(list[j] || "");
      const trimmed = raw.trim();
      if (!trimmed.startsWith("//")) break;
      collected.unshift(raw);
      linesUsed += 1;
    }
    const cleaned = stripLineCommentMarkers(collected);
    if (!cleaned) return null;
    const clipped = cleaned.length > maxChars ? cleaned.slice(0, maxChars) + "..." : cleaned;
    return clipped;
  }

  return null;
}

function extractSignature(lines, startLine, { maxChars = 240 } = {}) {
  const list = Array.isArray(lines) ? lines : [];
  const idx = Number.isFinite(Number(startLine)) ? Math.floor(Number(startLine)) - 1 : -1;
  if (idx < 0 || idx >= list.length) return null;
  let line = String(list[idx] || "").trim();
  if (!line) return null;
  const brace = line.indexOf("{");
  if (brace >= 0) line = line.slice(0, brace).trim();
  if (!line) return null;
  return line.length > maxChars ? line.slice(0, maxChars) + "..." : line;
}

function extractWithRegex(text, path) {
  const lines = String(text || "").split("\n");
  const out = [];

  const push = (kind, name, lineNo, signature) => {
    if (!name) return;
    const doc = extractLeadingDoc(lines, lineNo);
    out.push({
      name,
      kind,
      file: path,
      startLine: lineNo,
      endLine: lineNo,
      signature: signature || null,
      ...(doc ? { doc } : {}),
      parser: "regex",
    });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;

    let m = trimmed.match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/);
    if (m) {
      push("function", m[1], i + 1, extractSignature(lines, i + 1) || trimmed);
      continue;
    }

    m = trimmed.match(/^(?:export\s+)?class\s+([A-Za-z0-9_$]+)/);
    if (m) {
      push("class", m[1], i + 1, extractSignature(lines, i + 1) || trimmed);
      continue;
    }

    m = trimmed.match(/^(?:export\s+)?interface\s+([A-Za-z0-9_$]+)/);
    if (m) {
      push("interface", m[1], i + 1, extractSignature(lines, i + 1) || trimmed);
      continue;
    }

    m = trimmed.match(/^(?:export\s+)?type\s+([A-Za-z0-9_$]+)\s*=/);
    if (m) {
      push("type", m[1], i + 1, extractSignature(lines, i + 1) || trimmed);
      continue;
    }

    m = trimmed.match(/^(?:export\s+)?enum\s+([A-Za-z0-9_$]+)/);
    if (m) {
      push("enum", m[1], i + 1, extractSignature(lines, i + 1) || trimmed);
      continue;
    }
  }

  return out;
}

function extractJsTsSymbolsFromTree(rootNode, path, lines) {
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
        const doc = extractLeadingDoc(lines, startLine);
        const signature = extractSignature(lines, startLine);
        out.push({
          name,
          kind: "function",
          file: path,
          startLine,
          endLine,
          signature: signature || null,
          ...(doc ? { doc } : {}),
          parser: "tree-sitter",
        });
      }
    } else if (type === "class_declaration") {
      const nameNode = node.childForFieldName?.("name");
      const name = toNonEmptyString(nameNode?.text);
      const startLine = (nameNode?.startPosition?.row ?? node.startPosition?.row ?? 0) + 1;
      const endLine = (node.endPosition?.row ?? startLine - 1) + 1;
      if (name) {
        const doc = extractLeadingDoc(lines, startLine);
        const signature = extractSignature(lines, startLine);
        out.push({
          name,
          kind: "class",
          file: path,
          startLine,
          endLine,
          signature: signature || null,
          ...(doc ? { doc } : {}),
          parser: "tree-sitter",
        });
      }
    } else if (type === "interface_declaration") {
      const nameNode = node.childForFieldName?.("name");
      const name = toNonEmptyString(nameNode?.text);
      const startLine = (nameNode?.startPosition?.row ?? node.startPosition?.row ?? 0) + 1;
      const endLine = (node.endPosition?.row ?? startLine - 1) + 1;
      if (name) {
        const doc = extractLeadingDoc(lines, startLine);
        const signature = extractSignature(lines, startLine);
        out.push({
          name,
          kind: "interface",
          file: path,
          startLine,
          endLine,
          signature: signature || null,
          ...(doc ? { doc } : {}),
          parser: "tree-sitter",
        });
      }
    } else if (type === "type_alias_declaration") {
      const nameNode = node.childForFieldName?.("name");
      const name = toNonEmptyString(nameNode?.text);
      const startLine = (nameNode?.startPosition?.row ?? node.startPosition?.row ?? 0) + 1;
      const endLine = (node.endPosition?.row ?? startLine - 1) + 1;
      if (name) {
        const doc = extractLeadingDoc(lines, startLine);
        const signature = extractSignature(lines, startLine);
        out.push({
          name,
          kind: "type",
          file: path,
          startLine,
          endLine,
          signature: signature || null,
          ...(doc ? { doc } : {}),
          parser: "tree-sitter",
        });
      }
    } else if (type === "enum_declaration") {
      const nameNode = node.childForFieldName?.("name");
      const name = toNonEmptyString(nameNode?.text);
      const startLine = (nameNode?.startPosition?.row ?? node.startPosition?.row ?? 0) + 1;
      const endLine = (node.endPosition?.row ?? startLine - 1) + 1;
      if (name) {
        const doc = extractLeadingDoc(lines, startLine);
        const signature = extractSignature(lines, startLine);
        out.push({
          name,
          kind: "enum",
          file: path,
          startLine,
          endLine,
          signature: signature || null,
          ...(doc ? { doc } : {}),
          parser: "tree-sitter",
        });
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
    this._parserPromise = null;
    this._parserInstance = null;
    this._indexRevision = 0;
    this._recordsCache = new Map(); // workspaceId -> { rev, rows }
    this._queryCache = new Map(); // key -> { rev, results }
    this._queryCacheMax = 50;
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

  async _getParser() {
    if (this._parserInstance) return this._parserInstance;
    if (this._parserPromise) return this._parserPromise;

    this._parserPromise = Promise.resolve()
      .then(async () => {
        const mod = await import("web-tree-sitter");
        const Parser = mod.Parser || mod.default?.Parser || mod.default;
        if (!Parser) throw new Error("web-tree-sitter Parser unavailable");
        const parser = new Parser();
        this._parserInstance = parser;
        return parser;
      })
      .catch((err) => {
        this._parserPromise = null;
        throw err;
      });

    return this._parserPromise;
  }

  _bumpRevision() {
    this._indexRevision += 1;
    this._recordsCache.clear();
    this._queryCache.clear();
  }

  invalidateCaches() {
    this._bumpRevision();
  }

  async _listSymbolRecordsCached(workspaceId) {
    const ws = toNonEmptyString(workspaceId) || "default";
    const cached = this._recordsCache.get(ws);
    if (cached && cached.rev === this._indexRevision && Array.isArray(cached.rows)) {
      return cached.rows;
    }
    const rows = await this.store.listSymbolRecords(ws);
    this._recordsCache.set(ws, { rev: this._indexRevision, rows: Array.isArray(rows) ? rows : [] });
    return Array.isArray(rows) ? rows : [];
  }

  async extractSymbols(text, path) {
    const file = toNonEmptyString(path);
    const langId = detectLanguageForPath(file);
    if (!langId) return extractWithRegex(text, file);

    const lang = await this._getLanguage(langId);
    if (!lang) return extractWithRegex(text, file);

    try {
      const parser = await this._getParser();
      parser.setLanguage(lang);
      const sourceText = String(text || "");
      const tree = parser.parse(sourceText);
      const root = tree?.rootNode;
      if (!root) return extractWithRegex(text, file);
      const lines = sourceText.split("\n");
      return extractJsTsSymbolsFromTree(root, file, lines);
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
    this._bumpRevision();
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

    const cacheKey = `${this.workspaceId}::${prefix}::${q}::${lim}`;
    const cached = this._queryCache.get(cacheKey);
    if (cached && cached.rev === this._indexRevision && Array.isArray(cached.results)) {
      // LRU bump
      this._queryCache.delete(cacheKey);
      this._queryCache.set(cacheKey, cached);
      return cached.results.slice(0, lim);
    }

    const rows = await this._listSymbolRecordsCached(this.workspaceId);
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
    this._queryCache.set(cacheKey, { rev: this._indexRevision, results: out });
    while (this._queryCache.size > this._queryCacheMax) {
      const firstKey = this._queryCache.keys().next().value;
      if (!firstKey) break;
      this._queryCache.delete(firstKey);
    }
    return out;
  }
}

export default SymbolIndexer;
