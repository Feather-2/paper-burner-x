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
];

/**
 * 创建工具执行器
 * @param {object} options
 * @param {object} options.fs - 文件系统接口 (readFile, readdir, stat)
 * @param {Function} options.globFn - glob 函数
 * @param {string} options.basePath - 项目根目录
 * @param {number} options.maxFileSize - 最大文件大小限制 (bytes)
 * @param {number} options.maxResults - 最大返回结果数
 */
export function createToolExecutor(options = {}) {
  const {
    fs,
    globFn,
    basePath = ".",
    maxFileSize = 512 * 1024, // 512KB
    maxResults = 100,
    maxLineLength = 500,
  } = options;

  // 路径安全检查
  function safePath(inputPath) {
    const path = String(inputPath || "").trim();
    // 防止路径遍历
    if (path.includes("..") || path.startsWith("/")) {
      throw new Error(`Invalid path: ${path}`);
    }
    return path || ".";
  }

  // glob 工具
  async function glob({ pattern, path }) {
    if (!pattern) throw new Error("glob: pattern is required");
    const searchPath = safePath(path);

    if (!globFn) {
      return { error: "glob function not available", files: [] };
    }

    try {
      const files = await globFn({ pattern, path: searchPath });
      const limited = Array.isArray(files) ? files.slice(0, maxResults) : [];
      return {
        files: limited,
        total: Array.isArray(files) ? files.length : 0,
        truncated: Array.isArray(files) && files.length > maxResults,
      };
    } catch (err) {
      return { error: String(err?.message || err), files: [] };
    }
  }

  // grep 工具
  async function grep({ pattern, path, regex = false, caseSensitive = false }) {
    if (!pattern) throw new Error("grep: pattern is required");

    // 如果提供了 path，先 glob 找文件，再搜索
    let targetFiles = [];
    if (path) {
      const globResult = await glob({ pattern: "**/*", path: safePath(path) });
      targetFiles = globResult.files || [];
    }

    // 读取文件内容构建 chunks
    const chunks = [];
    for (const file of targetFiles.slice(0, 50)) { // 限制文件数
      try {
        const content = await read_file({ path: file });
        if (content.content) {
          chunks.push({ chunkId: file, text: content.content });
        }
      } catch {
        // 跳过无法读取的文件
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
          spans: m.spans.slice(0, 5), // 每个文件最多 5 个匹配位置
        })),
        total: matches.length,
        truncated: matches.length > maxResults,
      };
    } catch (err) {
      return { error: String(err?.message || err), matches: [] };
    }
  }

  // read_file 工具
  async function read_file({ path, startLine, endLine }) {
    if (!path) throw new Error("read_file: path is required");
    const filePath = safePath(path);

    if (!fs?.readFile) {
      return { error: "fs.readFile not available", content: null };
    }

    try {
      // 检查文件大小
      if (fs.stat) {
        const stats = await fs.stat(filePath);
        if (stats.size > maxFileSize) {
          return {
            error: `File too large: ${stats.size} bytes (max ${maxFileSize})`,
            content: null,
            size: stats.size,
          };
        }
      }

      const buffer = await fs.readFile(filePath);
      const content = buffer.toString("utf8");
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

      return {
        content: numberedContent,
        path: filePath,
        totalLines: lines.length,
        range: { start, end },
        truncated: end < lines.length || start > 1,
      };
    } catch (err) {
      return { error: String(err?.message || err), content: null };
    }
  }

  // list_dir 工具
  async function list_dir({ path, showHidden = false }) {
    const dirPath = safePath(path);

    if (!fs?.readdir) {
      return { error: "fs.readdir not available", entries: [] };
    }

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      const filtered = showHidden
        ? entries
        : entries.filter(e => !e.name.startsWith("."));

      const result = filtered.slice(0, maxResults).map(e => ({
        name: e.name,
        type: e.isDirectory() ? "dir" : "file",
      }));

      // 排序：目录在前，文件在后
      result.sort((a, b) => {
        if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      return {
        entries: result,
        path: dirPath,
        total: filtered.length,
        truncated: filtered.length > maxResults,
      };
    } catch (err) {
      return { error: String(err?.message || err), entries: [] };
    }
  }

  // tree 工具
  async function tree({ path, depth = 3, pattern } = {}) {
    const rootPath = safePath(path || ".");
    const maxDepth = Math.min(depth, 5); // 限制最大深度

    if (!fs?.readdir) {
      return { error: "fs.readdir not available", tree: "" };
    }

    const lines = [];
    let fileCount = 0;
    let dirCount = 0;
    const maxFiles = 200; // 限制总文件数

    async function walk(dir, prefix = "", currentDepth = 0) {
      if (currentDepth >= maxDepth || fileCount + dirCount > maxFiles) return;

      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        const filtered = entries
          .filter(e => !e.name.startsWith("."))
          .filter(e => {
            if (!pattern) return true;
            if (e.isDirectory()) return true;
            // 简单的模式匹配
            const ext = e.name.split(".").pop();
            return pattern.includes(ext) || pattern.includes("*");
          });

        filtered.sort((a, b) => {
          if (a.isDirectory() !== b.isDirectory()) {
            return a.isDirectory() ? -1 : 1;
          }
          return a.name.localeCompare(b.name);
        });

        for (let i = 0; i < filtered.length; i++) {
          if (fileCount + dirCount > maxFiles) break;

          const entry = filtered[i];
          const isLast = i === filtered.length - 1;
          const connector = isLast ? "└── " : "├── ";
          const icon = entry.isDirectory() ? "📁" : "📄";

          lines.push(`${prefix}${connector}${icon} ${entry.name}`);

          if (entry.isDirectory()) {
            dirCount++;
            const newPrefix = prefix + (isLast ? "    " : "│   ");
            await walk(`${dir}/${entry.name}`, newPrefix, currentDepth + 1);
          } else {
            fileCount++;
          }
        }
      } catch {
        // 跳过无法读取的目录
      }
    }

    lines.push(`📁 ${rootPath}`);
    await walk(rootPath);

    return {
      tree: lines.join("\n"),
      stats: { files: fileCount, dirs: dirCount },
      truncated: fileCount + dirCount >= maxFiles,
      depth: maxDepth,
    };
  }

  return {
    glob,
    grep,
    read_file,
    list_dir,
    tree,

    // 工具定义（供 LLM 使用）
    definitions: TOOL_DEFINITIONS,

    // 执行工具
    async execute(toolName, args) {
      const tools = { glob, grep, read_file, list_dir, tree };
      const fn = tools[toolName];
      if (!fn) {
        return { error: `Unknown tool: ${toolName}` };
      }
      return fn(args);
    },
  };
}

/**
 * 格式化工具定义为 LLM 可读格式
 */
export function formatToolDefinitionsForLLM() {
  return TOOL_DEFINITIONS.map(tool => {
    const params = Object.entries(tool.parameters)
      .map(([name, def]) => `  - ${name}: ${def.description}${def.required ? " (必需)" : ""}`)
      .join("\n");

    const examples = tool.examples
      .map(ex => `  ${JSON.stringify(ex)}`)
      .join("\n");

    return `### ${tool.name}
${tool.description}

参数:
${params}

示例:
${examples}`;
  }).join("\n\n");
}
