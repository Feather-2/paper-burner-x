// 工具定义（供 LLM 理解）
export const TOOL_DEFINITIONS = [
  {
    name: "glob",
    description: "文件模式匹配，返回匹配的文件路径列表",
    parameters: {
      pattern: { type: "string", description: "glob 模式，如 **/*.ts, src/**/*.js", required: true },
      path: { type: "string", description: "搜索基础路径，默认为项目根目录", required: false },
    },
    examples: [
      { pattern: "**/*.ts" },
      { pattern: "src/components/**/*.tsx" },
      { pattern: "*.config.{js,json}" },
    ],
  },
  {
    name: "grep",
    description: "在文件内容中搜索关键词或正则表达式",
    parameters: {
      pattern: { type: "string", description: "搜索模式（关键词或正则）", required: true },
      path: { type: "string", description: "搜索路径，可以是文件或目录", required: false },
      regex: { type: "boolean", description: "是否使用正则表达式", required: false },
      caseSensitive: { type: "boolean", description: "是否区分大小写", required: false },
    },
    examples: [
      { pattern: "export function" },
      { pattern: "import.*from", regex: true },
      { pattern: "TODO|FIXME", regex: true },
    ],
  },
  {
    name: "read_file",
    description: "读取文件内容，支持指定行范围",
    parameters: {
      path: { type: "string", description: "文件路径", required: true },
      startLine: { type: "number", description: "起始行号（从 1 开始）", required: false },
      endLine: { type: "number", description: "结束行号（包含）", required: false },
    },
    examples: [
      { path: "src/index.ts" },
      { path: "package.json", startLine: 1, endLine: 20 },
      { path: "src/main.ts", startLine: 50, endLine: 100 },
    ],
  },
  {
    name: "write_file",
    description: "写入文件内容（整文件覆盖）。Browser-first：优先使用 VFS，并记录 vfs_checkpoint.json 以支持撤销/回滚。",
    parameters: {
      path: { type: "string", description: "文件路径", required: true },
      content: { type: "string", description: "写入内容（文本）", required: true },
      checkpoint: { type: "boolean", description: "是否记录 VFS checkpoint（默认 true）", required: false },
    },
    examples: [
      { path: "notes/todo.md", content: "# TODO\n- item\n" },
    ],
  },
  {
    name: "multi_edit",
    description: "对单文件执行多处精确替换（事务语义：全部成功才写入；失败则不写入）。默认要求每个 old_string 在文件中唯一。",
    parameters: {
      path: { type: "string", description: "文件路径", required: true },
      edits: {
        type: "array",
        description: "编辑列表：{old_string,new_string}",
        required: true,
      },
      checkpoint: { type: "boolean", description: "是否记录 VFS checkpoint（默认 true）", required: false },
    },
    examples: [
      { path: "src/app.js", edits: [{ old_string: "const x = 1", new_string: "const x = 2" }] },
    ],
  },
  {
    name: "list_dir",
    description: "列出目录内容",
    parameters: {
      path: { type: "string", description: "目录路径", required: true },
      showHidden: { type: "boolean", description: "是否显示隐藏文件", required: false },
    },
    examples: [
      { path: "src" },
      { path: ".", showHidden: true },
    ],
  },
  {
    name: "tree",
    description: "显示目录树结构",
    parameters: {
      path: { type: "string", description: "目录路径", required: false },
      depth: { type: "number", description: "最大深度，默认 3", required: false },
      pattern: { type: "string", description: "文件过滤模式", required: false },
    },
    examples: [
      { depth: 2 },
      { path: "src", depth: 3 },
      { path: ".", depth: 2, pattern: "*.ts" },
    ],
  },
  {
    name: "index_symbols",
    description: "为代码库构建符号索引（Tree-sitter-wasm 优先，失败则 regex 回退），用于后续快速定位函数/类/类型等符号",
    parameters: {
      pattern: { type: "string", description: "glob 模式，如 src/**/*.ts（与 paths 二选一）", required: false },
      path: { type: "string", description: "glob 的搜索基础路径，默认项目根目录", required: false },
      paths: { type: "array", description: "显式文件列表（与 pattern 二选一）", required: false },
      limit: { type: "number", description: "最多索引多少个文件（默认 200）", required: false },
      force: { type: "boolean", description: "是否强制重建（默认 false）", required: false },
      workspaceId: { type: "string", description: "索引命名空间（默认 default）", required: false },
    },
    examples: [
      { pattern: "src/**/*.{js,ts,tsx}" },
      { paths: ["src/main.ts", "src/app.ts"] },
    ],
  },
  {
    name: "find_symbol",
    description: "在已建立的符号索引中搜索符号名称（需要先 index_symbols）",
    parameters: {
      query: { type: "string", description: "符号名或子串", required: true },
      pathPrefix: { type: "string", description: "限定文件路径前缀（可选）", required: false },
      limit: { type: "number", description: "最多返回多少条（默认 50）", required: false },
      workspaceId: { type: "string", description: "索引命名空间（默认 default）", required: false },
    },
    examples: [
      { query: "createVfs" },
      { query: "Policy", pathPrefix: "js/agents/" },
    ],
  },
];

/**
 * @param {string} input
 * @returns {string}
 */
export function normalizePathInput(input) {
  return String(input ?? "").trim().replace(/\\/g, "/");
}

/**
 * @param {string} input
 * @returns {boolean}
 */
export function isWindowsAbsolutePath(input) {
  const value = String(input || "");
  return /^[a-zA-Z]:/.test(value) || value.startsWith("\\\\") || value.startsWith("//");
}

/**
 * @param {string} input
 * @returns {string|null}
 */
export function normalizePosixPath(input) {
  const cleaned = normalizePathInput(input);
  if (!cleaned || cleaned === ".") return "";
  const isAbs = cleaned.startsWith("/");
  const parts = [];
  for (const seg of cleaned.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") return null;
    parts.push(seg);
  }
  const joined = parts.join("/");
  if (isAbs) return joined ? `/${joined}` : "/";
  return joined;
}

/**
 * @param {string} input
 * @returns {string}
 */
export function normalizeBaseRoot(input) {
  const raw = String(input ?? "").trim();
  if (!raw) {
    throw new Error("basePath must not be empty");
  }
  const cleaned = normalizePathInput(raw);
  if (cleaned === "/" || isWindowsAbsolutePath(raw) || isWindowsAbsolutePath(cleaned)) {
    throw new Error(`Invalid basePath: ${raw}`);
  }
  const normalized = normalizePosixPath(cleaned);
  if (normalized == null || normalized === "/") {
    throw new Error(`Invalid basePath: ${raw}`);
  }
  return normalized;
}

/**
 * @param {string} base
 * @param {string} rel
 * @returns {string}
 */
export function joinPaths(base, rel) {
  const b = String(base || "").replace(/\/+$/, "");
  const r = String(rel || "").replace(/^\/+/, "");
  if (!b) return r;
  if (!r) return b;
  return `${b}/${r}`;
}

/**
 * @param {any} inputPath
 * @returns {string}
 */
export function safeRelativePath(inputPath) {
  const baseRootIsAbs = Boolean(this?.baseRootIsAbs);
  const baseRoot = String(this?.baseRoot || "");
  const baseRootForVfs = String(this?.baseRootForVfs || "");

  const raw = String(inputPath ?? "").trim();
  if (!raw) return "";
  const cleaned = normalizePathInput(raw);
  if (isWindowsAbsolutePath(raw) || isWindowsAbsolutePath(cleaned)) {
    throw new Error(`Invalid path: ${raw}`);
  }
  const normalized = normalizePosixPath(cleaned);
  if (normalized == null || normalized === "/") {
    throw new Error(`Invalid path: ${raw}`);
  }
  if (!normalized || normalized === ".") return "";
  if (normalized.startsWith("/")) {
    if (!baseRootIsAbs) {
      throw new Error(`Invalid path: ${raw}`);
    }
    if (normalized === baseRoot) return "";
    if (normalized.startsWith(`${baseRoot}/`)) {
      return normalized.slice(baseRoot.length + 1);
    }
    throw new Error(`Invalid path: ${raw}`);
  }
  if (baseRootForVfs) {
    if (normalized === baseRootForVfs) return "";
    if (normalized.startsWith(`${baseRootForVfs}/`)) {
      return normalized.slice(baseRootForVfs.length + 1);
    }
  }
  return normalized;
}

/**
 * @param {any} inputPath
 * @returns {{ rel: string, fsPath: string, vfsPath: string, displayPath: string }}
 */
export function buildPaths(inputPath) {
  const baseRootForFs = String(this?.baseRootForFs || "");
  const baseRootForVfs = String(this?.baseRootForVfs || "");
  const safeRelativePathFn = typeof this?.safeRelativePath === "function" ? this.safeRelativePath : safeRelativePath;

  const rel = safeRelativePathFn(inputPath);
  const fsPath = joinPaths(baseRootForFs, rel);
  const vfsPath = joinPaths(baseRootForVfs, rel);
  const displayPath = joinPaths(baseRootForVfs, rel) || ".";
  return { rel, fsPath, vfsPath, displayPath };
}

/**
 * @param {any} buffer
 * @returns {string}
 */
export function bufferToText(buffer) {
  if (typeof buffer === "string") return buffer;
  if (buffer && typeof buffer.toString === "function") return buffer.toString("utf8");
  if (buffer instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(buffer));
  if (ArrayBuffer.isView(buffer)) {
    const bytes = new Uint8Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
    return new TextDecoder().decode(bytes);
  }
  return String(buffer ?? "");
}

/**
 * @param {any} value
 * @returns {string[]}
 */
export function normalizeStringArray(value) {
  const arr = Array.isArray(value) ? value : value ? [value] : [];
  return arr.map((v) => String(v || "").trim()).filter(Boolean);
}

/**
 * @param {any} input
 * @returns {string}
 */
export function normalizeWorkspaceId(input) {
  const s = String(input || "").trim();
  return s || String(this?.workspaceId || "").trim() || "default";
}

/**
 * @param {string} filePath
 * @returns {Promise<string>}
 */
export async function readTextForIndexing(filePath) {
  const buildPathsFn = typeof this?.buildPaths === "function" ? this.buildPaths : buildPaths;
  const { fsPath, vfsPath } = buildPathsFn(filePath);
  const vfs = this?.vfs;
  const fs = this?.fs;

  if (vfs && typeof vfs.readText === "function") return vfs.readText(vfsPath);
  if (vfs && typeof vfs.readFile === "function") {
    const buf = await vfs.readFile(vfsPath);
    return bufferToText(buf);
  }
  if (fs?.readFile) {
    const buf = await fs.readFile(fsPath);
    return bufferToText(buf);
  }
  throw new Error("index_symbols: vfs.readText or fs.readFile is required");
}

/**
 * 格式化工具定义为 LLM 可读格式
 * @returns {string} 格式化的工具定义文本（Markdown 格式）
 */
export function formatToolDefinitionsForLLM() {
  return TOOL_DEFINITIONS.map((tool) => {
    const params = Object.entries(tool.parameters)
      .map(([name, def]) => `  - ${name}: ${def.description}${def.required ? " (必需)" : ""}`)
      .join("\n");

    const examples = tool.examples
      .map((ex) => `  ${JSON.stringify(ex)}`)
      .join("\n");

    return `### ${tool.name}
${tool.description}

参数:
${params}

示例:
${examples}`;
  }).join("\n\n");
}
