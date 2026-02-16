/**
 * CodeSearch 工具集
 *
 * 提供给 Agent Loop 的代码探索工具：
 * - glob: 文件模式匹配
 * - grep: 内容搜索
 * - read_file: 读取文件（支持行范围）
 * - list_dir: 列出目录
 * - tree: 目录树
 */

import { grepChunks } from "../../retrieval/grep.js";
import SymbolIndexer from "./indexing/symbol-indexer.js";
import { computeSha256 } from "../../storage/artifact-manager.js";
import { multiEditTextFileWithPolicy, writeTextFileWithPolicy } from "../../vfs/operations.js";
import { isPlainObject } from "../../shared/index.js";
import {
  TOOL_DEFINITIONS,
  buildPaths as buildPathsHelper,
  bufferToText,
  joinPaths,
  normalizeBaseRoot,
  normalizeStringArray,
  normalizeWorkspaceId as normalizeWorkspaceIdHelper,
  readTextForIndexing as readTextForIndexingHelper,
  safeRelativePath as safeRelativePathHelper,
} from "./code-tools-helpers.js";

export { TOOL_DEFINITIONS, formatToolDefinitionsForLLM } from "./code-tools-helpers.js";

/**
 * @typedef {object} FileSystemLike
 * @property {(path:string)=>Promise<any>=} readFile
 * @property {(path:string, opts?:any)=>Promise<any>=} readdir
 * @property {(path:string)=>Promise<any>=} stat
 *
 * @typedef {object} VfsLike
 * @property {(path:string)=>Promise<string>=} readText
 * @property {(path:string)=>Promise<any>=} readFile
 * @property {(path:string)=>Promise<any>=} stat
 * @property {(path:string, opts?:any)=>Promise<any>=} readdir
 * @property {(path:string, opts?:any)=>Promise<any>=} list
 * @property {(path:string, text:string)=>Promise<any>=} writeText
 *
 * @typedef {object} LoggerLike
 * @property {(msg:string, meta?:any)=>void=} debug
 * @property {(msg:string, meta?:any)=>void=} info
 * @property {(msg:string, meta?:any)=>void=} warn
 * @property {(msg:string, meta?:any)=>void=} error
 *
 * @typedef {(eventName:string, payload:any)=>void} EmitFn
 *
 * @typedef {object} WatchdogLike
 * @property {(action:any)=>void=} recordAction
 *
 * @typedef {{ files: string[], total: number, truncated: boolean, error?: string }} GlobToolResult
 *
 * @typedef {InstanceType<typeof String> & {
 *   content: string,
 *   path: string,
 *   totalLines: number,
 *   range: { start: number, end: number },
 *   truncated: boolean
 * }} ReadFileToolResult
 *
 * @typedef {{ name: string, type: "file" | "dir" }} ListDirEntry
 * @typedef {{ entries: ListDirEntry[], path: string, total: number, truncated: boolean, error?: string }} ListDirToolResult
 *
 * @typedef {object} CodeToolExecutorOptions
 * @property {FileSystemLike=} fs - 文件系统接口 (readFile, readdir, stat)
 * @property {VfsLike=} vfs - Browser-first VFS（可选）
 * @property {(args:{pattern:string, path?:string})=>Promise<string[]>=} globFn - glob 函数（可选）
 * @property {string=} basePath - 项目根目录（可选；主要用于调用方记录）
 * @property {number=} maxFileSize - 最大文件大小限制 (bytes)
 * @property {number=} maxResults - 最大返回结果数
 * @property {number=} maxLineLength - 单行最大字符数（read_file 截断）
 * @property {string=} wasmBaseUrl - Tree-sitter wasm baseUrl（可选）
 * @property {string=} workspaceId - 符号索引命名空间（可选）
 * @property {LoggerLike=} logger - logger（可选）
 * @property {EmitFn=} emit - emit 函数（可选）
 * @property {any=} policy
 * @property {any=} runStore
 * @property {string=} runId
 * @property {any=} stageApi
 * @property {WatchdogLike=} watchdog
 *
 * @typedef {object} CodeToolExecutor
 * @property {(args:{pattern:string, path?:string})=>Promise<any>} glob
 * @property {(args:{pattern:string, path?:string, regex?:boolean, caseSensitive?:boolean})=>Promise<any>} grep
 * @property {(args:{path:string, startLine?:number, endLine?:number})=>Promise<any>} read_file
 * @property {(args?:{path?:string, content?:string, checkpoint?:boolean})=>Promise<any>} write_file
 * @property {(args?:{path?:string, edits?:any[], checkpoint?:boolean})=>Promise<any>} multi_edit
 * @property {(args:{path:string, showHidden?:boolean})=>Promise<any>} list_dir
 * @property {(args?:{path?:string, depth?:number, pattern?:string})=>Promise<any>} tree
 * @property {(args?:{pattern?:string, path?:string, paths?:Array<string>, limit?:number, force?:boolean, workspaceId?:string})=>Promise<any>} index_symbols
 * @property {(args?:{query?:string, pathPrefix?:string, limit?:number, workspaceId?:string})=>Promise<any>} find_symbol
 * @property {any[]} definitions
 * @property {(toolName:string, args:any)=>Promise<any>} execute
 *
 * 创建工具执行器
 * @param {CodeToolExecutorOptions} [options]
 * @returns {CodeToolExecutor}
 */
export function createToolExecutor(options = {}) {
  const {
    fs,
    vfs,
    globFn,
    basePath = ".",
    maxFileSize = 512 * 1024, // 512KB
    maxResults = 100,
    maxLineLength = 500,
    wasmBaseUrl,
    workspaceId,
    logger,
    emit,
    policy,
    runStore,
    runId,
    stageApi,
    watchdog,
  } = options;

  const basePathValue = String(basePath ?? "").trim();
  const baseRoot = normalizeBaseRoot(basePathValue);
  const baseRootIsAbs = baseRoot.startsWith("/");
  const baseRootForFs = baseRoot || ".";
  const baseRootForVfs = baseRootIsAbs ? "" : baseRoot;
  /** @type {{
   * baseRootIsAbs: boolean,
   * baseRoot: string,
   * baseRootForFs: string,
   * baseRootForVfs: string,
   * workspaceId: string|undefined,
   * fs: FileSystemLike|undefined,
   * vfs: VfsLike|undefined,
   * }} */
  const helperContext = {
    baseRootIsAbs,
    baseRoot,
    baseRootForFs,
    baseRootForVfs,
    workspaceId,
    fs,
    vfs,
  };
  /** @param {any} inputPath */
  const safeRelativePath = (inputPath) => safeRelativePathHelper(helperContext, inputPath);
  /** @param {any} inputPath */
  const buildPaths = (inputPath) => buildPathsHelper(helperContext, inputPath);
  /** @param {any=} input */
  const normalizeWorkspaceId = (input) => normalizeWorkspaceIdHelper(helperContext, input);
  /** @param {string} filePath */
  const readTextForIndexing = (filePath) => readTextForIndexingHelper(helperContext, filePath);

  const symbolIndexer = new SymbolIndexer({
    vfs:
      vfs && typeof vfs.readText === "function"
        ? /** @type {{ readText: (path: string) => Promise<string> }} */ (vfs)
        : { readText: readTextForIndexing },
    workspaceId: normalizeWorkspaceId(),
    ...(wasmBaseUrl ? { wasmBaseUrl } : {}),
    ...(logger ? { logger } : {}),
    ...(typeof emit === "function" ? { emit } : {}),
  });

  // glob 工具
  /**
   * @param {{ pattern: string, path?: string }} args
   * @returns {Promise<GlobToolResult>}
   */
  async function glob({ pattern, path }) {
    if (!pattern) throw new Error("glob: pattern is required");
    const { vfsPath } = buildPaths(path);

    if (!globFn) {
      /** @type {string[]} */
      const empty = [];
      const out = /** @type {GlobToolResult} */ (/** @type {unknown} */ (empty));
      out.files = empty;
      out.total = 0;
      out.truncated = false;
      out.error = "glob function not available";
      return out;
    }

    try {
      const files = await globFn({ pattern, path: vfsPath });
      const limited = Array.isArray(files) ? files.slice(0, maxResults) : [];
      /** @type {string[]} */
      const result = limited.slice();
      const out = /** @type {GlobToolResult} */ (/** @type {unknown} */ (result));
      out.files = result;
      out.total = Array.isArray(files) ? files.length : 0;
      out.truncated = Array.isArray(files) && files.length > maxResults;
      return out;
    } catch (err) {
      /** @type {string[]} */
      const empty = [];
      const out = /** @type {GlobToolResult} */ (/** @type {unknown} */ (empty));
      out.files = empty;
      out.total = 0;
      out.truncated = false;
      out.error = String(err?.message || err);
      return out;
    }
  }

  // ── ripgrep 快速路径 (Node.js only) ──────────────────────────
  /** @type {Promise<((args: string[]) => Promise<{success:boolean, stdout:string}>)|null>|null} */
  let _rgLoaderPromise = null;

  /**
   * Lazy-load ripgrep executor. Returns null if unavailable (browser / rg not installed).
   * @returns {Promise<((args: string[]) => Promise<{success:boolean, stdout:string}>)|null>}
   */
  function loadRgExecutor() {
    if (_rgLoaderPromise) return _rgLoaderPromise;
    if (!fs) { _rgLoaderPromise = Promise.resolve(null); return _rgLoaderPromise; }
    _rgLoaderPromise = import(/* @vite-ignore */ "child_process").then(cp => {
      /** @param {string[]} args */
      return (args) => new Promise((resolve) => {
        const proc = cp.execFile("rg", args, { maxBuffer: 2 * 1024 * 1024, timeout: 30000 }, (err, stdout) => {
          resolve({ success: !err || proc?.exitCode === 0, stdout: stdout || "" });
        });
      });
    }).catch(() => null);
    return _rgLoaderPromise;
  }

  /**
   * Parse ripgrep output into codesearch match format.
   * @param {string} stdout
   * @returns {Array<{file:string, matchCount:number, spans:Array<{start:number,end:number}>}>}
   */
  function parseRgMatches(stdout) {
    /** @type {Map<string, {count:number, spans:Array<{start:number,end:number}>}>} */
    const byFile = new Map();
    for (const line of stdout.split("\n")) {
      if (!line) continue;
      const m = line.match(/^(.+?):(\d+):/);
      if (!m) continue;
      const file = m[1];
      const lineNum = parseInt(m[2], 10);
      let entry = byFile.get(file);
      if (!entry) { entry = { count: 0, spans: [] }; byFile.set(file, entry); }
      entry.count++;
      if (entry.spans.length < 5) entry.spans.push({ start: lineNum, end: lineNum });
    }
    return [...byFile.entries()].map(([file, e]) => ({
      file,
      matchCount: e.count,
      spans: e.spans,
    }));
  }

  // grep 工具
  /**
   * @param {{ pattern: string, path?: string, regex?: boolean, caseSensitive?: boolean }} args
   * @returns {Promise<any>}
   */
  async function grep({ pattern, path, regex = false, caseSensitive = false }) {
    if (!pattern) throw new Error("grep: pattern is required");

    // ── Node.js 快速路径：ripgrep ──
    if (fs) {
      const rgExec = await loadRgExecutor();
      if (rgExec) {
        try {
          const searchDir = path
            ? joinPaths(baseRootForFs, safeRelativePath(path))
            : baseRootForFs;
          const rgArgs = [
            regex ? "-e" : "-F",
            pattern,
            "--line-number",
            "--no-heading",
            `--max-count=${maxResults}`,
            caseSensitive ? "" : "-i",
            searchDir,
          ].filter(Boolean);
          const result = await rgExec(rgArgs);
          if (result.success && result.stdout) {
            const matches = parseRgMatches(result.stdout);
            return {
              matches: matches.slice(0, maxResults),
              total: matches.length,
              truncated: matches.length >= maxResults,
            };
          }
        } catch (err) {
          logger?.debug?.("grep: ripgrep failed, falling back to JS", {
            error: String(err?.message || err),
          });
        }
      }
    }

    // ── 降级路径：纯 JS grepChunks (浏览器 / rg 不可用) ──
    let targetFiles = [];
    if (path) {
      const globResult = await glob({ pattern: "**/*", path });
      targetFiles = globResult.files || [];
    }

    const chunks = [];
    for (const file of targetFiles.slice(0, 50)) {
      try {
        const content = await read_file({ path: file });
        if (content.content) {
          chunks.push({ chunkId: file, text: content.content });
        }
      } catch (err) {
        logger?.warn?.("grep: failed to read file", {
          path: file,
          error: String(err?.message || err),
        });
      }
    }

    if (chunks.length === 0) {
      return { matches: [], message: "No files to search" };
    }

    try {
      const matches = grepChunks(chunks, pattern, { regex, caseSensitive });
      return {
        matches: matches.slice(0, maxResults).map(m => ({
          file: m.chunkId,
          matchCount: m.matchCount,
          spans: m.spans.slice(0, 5),
        })),
        total: matches.length,
        truncated: matches.length > maxResults,
      };
    } catch (err) {
      return { error: String(err?.message || err), matches: [] };
    }
  }

  // read_file 工具
  /**
   * @param {{ path: string, startLine?: number, endLine?: number }} args
   * @returns {Promise<ReadFileToolResult>}
   */
  async function read_file({ path, startLine, endLine }) {
    if (!path) throw new Error("read_file: path is required");
    const { fsPath, vfsPath, displayPath } = buildPaths(path);

    if (!fs?.readFile && !(vfs && (typeof vfs.readText === "function" || typeof vfs.readFile === "function"))) {
      throw new Error("read_file: fs.readFile or vfs.readText is required");
    }

    try {
      // 检查文件大小
      if (fs?.stat || vfs?.stat) {
        const stats = fs?.stat ? await fs.stat(fsPath) : await vfs.stat(vfsPath);
        if (stats.size > maxFileSize) {
          throw new Error(`File too large: ${stats.size} bytes (max ${maxFileSize})`);
        }
      }

      let content;
      if (fs?.readFile) {
        const buffer = await fs.readFile(fsPath);
        content = bufferToText(buffer);
      } else if (vfs && typeof vfs.readText === "function") {
        content = await vfs.readText(vfsPath);
      } else {
        const buffer = await vfs.readFile(vfsPath);
        content = bufferToText(buffer);
      }
      const lines = content.split("\n");

      // 行范围处理
      const start = typeof startLine === "number" ? Math.max(1, startLine) : 1;
      const end = typeof endLine === "number" ? Math.min(lines.length, endLine) : lines.length;

      const selectedLines = lines.slice(start - 1, end);
      const numberedContent = selectedLines
        .map((line, i) => {
          const lineNum = start + i;
          const truncatedLine = line.length > maxLineLength
            ? line.slice(0, maxLineLength) + "..."
            : line;
          return `${lineNum}│${truncatedLine}`;
        })
        .join("\n");

      const output = /** @type {ReadFileToolResult} */ (new String(numberedContent));
      output.content = numberedContent;
      output.path = displayPath;
      output.totalLines = lines.length;
      output.range = { start, end };
      output.truncated = end < lines.length || start > 1;
      return output;
    } catch (err) {
      const message = String(err?.message || err);
      throw new Error(message);
    }
  }

  /**
   * @param {{ path?: string, content?: string, checkpoint?: boolean }=} args
   * @returns {Promise<any>}
   */
  async function write_file({ path, content, checkpoint = true } = {}) {
    if (!path) throw new Error("write_file: path is required");
    if (!vfs || typeof vfs.writeText !== "function") {
      return { error: "vfs.writeText not available (Browser-only write requires VFS)" };
    }

    const { vfsPath } = buildPaths(path);
    const text = typeof content === "string" ? content : String(content ?? "");
    if (text.length > maxFileSize) {
      return { error: `Content too large: ${text.length} chars (max ${maxFileSize})` };
    }

    try {
      const res = await writeTextFileWithPolicy({
        vfs,
        path: vfsPath,
        text,
        policy: policy || stageApi?.policy,
        runStore: runStore || stageApi?.runStore,
        runId: runId || stageApi?.runContext?.runId,
        stageApi: stageApi || { emit },
        checkpoint: checkpoint !== false,
      });
      return { ok: true, ...res };
    } catch (err) {
      return { error: String(err?.message || err) };
    }
  }

  /**
   * @param {{ path?: string, edits?: any[], checkpoint?: boolean }=} args
   * @returns {Promise<any>}
   */
  async function multi_edit({ path, edits, checkpoint = true } = {}) {
    if (!path) throw new Error("multi_edit: path is required");
    if (!vfs || typeof vfs.writeText !== "function") {
      return { error: "vfs.writeText not available (Browser-only write requires VFS)" };
    }

    const { vfsPath } = buildPaths(path);

    try {
      const res = await multiEditTextFileWithPolicy({
        vfs,
        path: vfsPath,
        edits: Array.isArray(edits) ? edits : [],
        policy: policy || stageApi?.policy,
        runStore: runStore || stageApi?.runStore,
        runId: runId || stageApi?.runContext?.runId,
        stageApi: stageApi || { emit },
        checkpoint: checkpoint !== false,
      });
      return { ok: true, ...res };
    } catch (err) {
      return { error: String(err?.message || err) };
    }
  }

  // list_dir 工具
  /**
   * @param {{ path: string, showHidden?: boolean }} args
   * @returns {Promise<ListDirToolResult>}
   */
  async function list_dir({ path, showHidden = false }) {
    const { fsPath, vfsPath, displayPath } = buildPaths(path);

    if (!fs?.readdir && !vfs?.readdir && !vfs?.list) {
      /** @type {ListDirEntry[]} */
      const empty = [];
      const out = /** @type {ListDirToolResult} */ (/** @type {unknown} */ (empty));
      out.entries = empty;
      out.path = displayPath;
      out.total = 0;
      out.truncated = false;
      out.error = "list_dir requires fs.readdir or vfs.readdir/list";
      return out;
    }

    try {
      const entries = fs?.readdir
        ? await fs.readdir(fsPath, { withFileTypes: true })
        : vfs?.readdir
          ? await vfs.readdir(vfsPath, { withFileTypes: true })
          : await vfs.list(vfsPath);
      const normalized = (Array.isArray(entries) ? entries : [])
        .map(
          /** @returns {ListDirEntry | null} */
          (entry) => {
            if (typeof entry === "string") {
              return { name: entry, type: "file" };
            }
            if (entry && typeof entry.name === "string") {
              if (typeof entry.isDirectory === "function") {
                return { name: entry.name, type: entry.isDirectory() ? "dir" : "file" };
              }
              if (typeof entry.isDirectory === "boolean") {
                return { name: entry.name, type: entry.isDirectory ? "dir" : "file" };
              }
              if (typeof entry.kind === "string") {
                return { name: entry.name, type: entry.kind === "dir" || entry.kind === "directory" ? "dir" : "file" };
              }
              if (typeof entry.type === "string") {
                return { name: entry.name, type: entry.type === "dir" || entry.type === "directory" ? "dir" : "file" };
              }
            }
            return null;
          }
        )
        .filter((e) => e != null);

      const filtered = showHidden ? normalized : normalized.filter((e) => !e.name.startsWith("."));

      const result = filtered.slice(0, maxResults).map((e) => ({ name: e.name, type: e.type }));

      // 排序：目录在前，文件在后
      result.sort((a, b) => {
        if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      const output = result.slice();
      const out = /** @type {ListDirToolResult} */ (/** @type {unknown} */ (output));
      out.entries = output;
      out.path = displayPath;
      out.total = filtered.length;
      out.truncated = filtered.length > maxResults;
      return out;
    } catch (err) {
      /** @type {ListDirEntry[]} */
      const empty = [];
      const out = /** @type {ListDirToolResult} */ (/** @type {unknown} */ (empty));
      out.entries = empty;
      out.path = displayPath;
      out.total = 0;
      out.truncated = false;
      out.error = String(err?.message || err);
      return out;
    }
  }

  // tree 工具
  /**
   * @param {{ path?: string, depth?: number, pattern?: string }=} args
   * @returns {Promise<any>}
   */
  async function tree({ path, depth = 3, pattern } = {}) {
    const { fsPath, vfsPath, displayPath } = buildPaths(path || ".");
    const rootPath = fs?.readdir ? fsPath : vfsPath;
    const maxDepth = Math.min(depth, 5); // 限制最大深度

    if (!fs?.readdir && !vfs?.readdir && !vfs?.list) {
      return { error: "tree requires fs.readdir or vfs.readdir/list", tree: "" };
    }

    const lines = [];
    let fileCount = 0;
    let dirCount = 0;
    const maxFiles = 200; // 限制总文件数

    const readEntries = async (dirPath) => {
      const entries = fs?.readdir
        ? await fs.readdir(dirPath, { withFileTypes: true })
        : vfs?.readdir
          ? await vfs.readdir(dirPath, { withFileTypes: true })
          : await vfs.list(dirPath);
      return (Array.isArray(entries) ? entries : [])
        .map((entry) => {
          if (typeof entry === "string") {
            return { name: entry, isDir: false };
          }
          if (entry && typeof entry.name === "string") {
            if (typeof entry.isDirectory === "function") {
              return { name: entry.name, isDir: entry.isDirectory() };
            }
            if (typeof entry.isDirectory === "boolean") {
              return { name: entry.name, isDir: entry.isDirectory };
            }
            if (typeof entry.kind === "string") {
              return { name: entry.name, isDir: entry.kind === "dir" || entry.kind === "directory" };
            }
            if (typeof entry.type === "string") {
              return { name: entry.name, isDir: entry.type === "dir" || entry.type === "directory" };
            }
          }
          return null;
        })
        .filter(Boolean);
    };

    async function walk(dir, prefix = "", currentDepth = 0) {
      if (currentDepth >= maxDepth || fileCount + dirCount > maxFiles) return;

      try {
        const entries = await readEntries(dir);
        const filtered = entries
          .filter(e => !e.name.startsWith("."))
          .filter(e => {
            if (!pattern) return true;
            if (e.isDir) return true;
            // 简单的模式匹配
            const ext = e.name.split(".").pop();
            return pattern.includes(ext) || pattern.includes("*");
          });

        filtered.sort((a, b) => {
          if (a.isDir !== b.isDir) {
            return a.isDir ? -1 : 1;
          }
          return a.name.localeCompare(b.name);
        });

        for (let i = 0; i < filtered.length; i++) {
          if (fileCount + dirCount > maxFiles) break;

          const entry = filtered[i];
          const isLast = i === filtered.length - 1;
          const connector = isLast ? "└── " : "├── ";
          const icon = entry.isDir ? "📁" : "📄";

          lines.push(`${prefix}${connector}${icon} ${entry.name}`);

          if (entry.isDir) {
            dirCount++;
            const newPrefix = prefix + (isLast ? "    " : "│   ");
            await walk(joinPaths(dir, entry.name), newPrefix, currentDepth + 1);
          } else {
            fileCount++;
          }
        }
      } catch {
        // 跳过无法读取的目录
      }
    }

    lines.push(`📁 ${displayPath}`);
    await walk(rootPath);

    return {
      tree: lines.join("\n"),
      stats: { files: fileCount, dirs: dirCount },
      truncated: fileCount + dirCount >= maxFiles,
      depth: maxDepth,
    };
  }

  /**
   * @param {{ pattern?: string, path?: string, paths?: string[] | string, limit?: number, force?: boolean, workspaceId?: string }=} args
   * @returns {Promise<any>}
   */
  async function index_symbols({ pattern, path, paths, limit = 200, force = false, workspaceId: wsId } = {}) {
    const ws = normalizeWorkspaceId(wsId);
    symbolIndexer.workspaceId = ws;

    const fileList = [];
    const seen = new Set();

    for (const p of normalizeStringArray(paths)) {
      const { vfsPath: sp } = buildPaths(p);
      if (seen.has(sp)) continue;
      seen.add(sp);
      fileList.push(sp);
    }

    if (fileList.length === 0) {
      const pat = String(pattern || "").trim();
      if (!pat) throw new Error("index_symbols: pattern or paths is required");
      const { vfsPath: searchPath } = buildPaths(path);
      if (!globFn) {
        return { error: "glob function not available", indexed: 0, skipped: 0, failed: 0, files: [] };
      }
      const files = await globFn({ pattern: pat, path: searchPath });
      for (const f of Array.isArray(files) ? files : []) {
        const { vfsPath: sp } = buildPaths(f);
        if (seen.has(sp)) continue;
        seen.add(sp);
        fileList.push(sp);
      }
    }

    const lim = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(1000, Math.floor(Number(limit)))) : 200;
    const targetFiles = fileList.slice(0, lim);

    let indexed = 0;
    let skipped = 0;
    let failed = 0;
    const results = [];

    for (const file of targetFiles) {
      try {
        const { fsPath, vfsPath } = buildPaths(file);
        if (fs?.stat) {
          const stats = await fs.stat(fsPath);
          if (stats?.size > maxFileSize) {
            failed += 1;
            results.push({ ok: false, path: vfsPath, error: `File too large: ${stats.size} bytes (max ${maxFileSize})` });
            continue;
          }
        }

        if (force) {
          const text = await readTextForIndexing(vfsPath);
          const symbols = await symbolIndexer.extractSymbolsAsync(text, vfsPath);
          const sha256 = await computeSha256(text);
          await symbolIndexer.store.putSymbolRecord(ws, vfsPath, { sha256, symbols });
          symbolIndexer.invalidateCaches?.();
          indexed += 1;
          results.push({ ok: true, path: vfsPath, skipped: false, symbolsCount: symbols.length });
          continue;
        }

        const res = await symbolIndexer.indexFile(vfsPath);
        if (res?.skipped) skipped += 1;
        else indexed += 1;
        results.push({ ok: true, path: vfsPath, skipped: !!res?.skipped, symbolsCount: Array.isArray(res?.symbols) ? res.symbols.length : 0 });
      } catch (err) {
        failed += 1;
        results.push({ ok: false, path: file, error: String(err?.message || err) });
      }
    }

    return {
      workspaceId: ws,
      indexed,
      skipped,
      failed,
      total: targetFiles.length,
      truncated: fileList.length > targetFiles.length,
      files: results,
      hint: "Use find_symbol to query after indexing.",
    };
  }

  /**
   * @param {{ query?: string, pathPrefix?: string, limit?: number, workspaceId?: string }=} args
   * @returns {Promise<any>}
   */
  async function find_symbol({ query, pathPrefix = "", limit = 50, workspaceId: wsId } = {}) {
    const q = String(query || "").trim();
    if (!q) throw new Error("find_symbol: query is required");
    const ws = normalizeWorkspaceId(wsId);
    symbolIndexer.workspaceId = ws;

    try {
      const matches = await symbolIndexer.query({
        query: q,
        pathPrefix: String(pathPrefix || "").trim(),
        limit,
      });

      return {
        workspaceId: ws,
        query: q,
        total: Array.isArray(matches) ? matches.length : 0,
        matches: Array.isArray(matches) ? matches.slice(0, maxResults) : [],
        truncated: Array.isArray(matches) && matches.length > maxResults,
        hint: "If no matches, run index_symbols first (or expand the indexed patterns).",
      };
    } catch (err) {
      return { error: String(err?.message || err), matches: [] };
    }
  }

  return {
    glob,
    grep,
    read_file,
    write_file,
    multi_edit,
    list_dir,
    tree,
    index_symbols,
    find_symbol,

    // 工具定义（供 LLM 使用）
    definitions: TOOL_DEFINITIONS,

    // 执行工具
    async execute(toolName, args) {
      const tools = { glob, grep, read_file, write_file, multi_edit, list_dir, tree, index_symbols, find_symbol };
      const fn = tools[toolName];
      if (!fn) {
        return { error: `Unknown tool: ${toolName}` };
      }

      if (watchdog && typeof watchdog.recordAction === "function") {
        try {
          watchdog.recordAction({ type: toolName, args: isPlainObject(args) ? args : {} });
        } catch {
          // ignore watchdog failures
        }
      }
      return fn(args);
    },
  };
}
