import { BaseAdapter, toNonEmptyString } from "./base.js";

// 支持的代码文件扩展名 -> 语言映射
const EXT_TO_LANG = {
  // JavaScript/TypeScript
  js: "javascript", mjs: "javascript", cjs: "javascript",
  ts: "typescript", mts: "typescript", cts: "typescript",
  jsx: "jsx", tsx: "tsx",
  // Python
  py: "python", pyw: "python", pyi: "python",
  // Java/Kotlin/Scala
  java: "java", kt: "kotlin", kts: "kotlin", scala: "scala",
  // C/C++/C#
  c: "c", h: "c", cpp: "cpp", hpp: "cpp", cc: "cpp", cxx: "cpp",
  cs: "csharp",
  // Go/Rust
  go: "go", rs: "rust",
  // Ruby/PHP/Swift
  rb: "ruby", php: "php", swift: "swift",
  // Shell
  sh: "bash", bash: "bash", zsh: "zsh", fish: "fish", ps1: "powershell",
  // Web
  html: "html", htm: "html", css: "css", scss: "scss", sass: "sass", less: "less",
  vue: "vue", svelte: "svelte",
  // Data/Config
  json: "json", yaml: "yaml", yml: "yaml", toml: "toml",
  xml: "xml", ini: "ini", cfg: "ini", conf: "ini",
  env: "shell", gitignore: "gitignore", dockerignore: "dockerignore",
  // SQL
  sql: "sql",
  // Markdown/Text (fallback)
  md: "markdown", markdown: "markdown", txt: "text",
  // Other
  r: "r", lua: "lua", perl: "perl", pl: "perl",
  hs: "haskell", ex: "elixir", exs: "elixir", erl: "erlang",
  clj: "clojure", cljs: "clojure", lisp: "lisp", el: "lisp",
  ml: "ocaml", fs: "fsharp", fsx: "fsharp",
  dart: "dart", groovy: "groovy", gradle: "groovy",
  makefile: "makefile", dockerfile: "dockerfile",
};

// 安全：禁止的文件扩展名（可能包含敏感信息或可执行内容）
const BLOCKED_EXTENSIONS = new Set([
  "exe", "dll", "so", "dylib", "bin", "com", "bat", "cmd", "msi",
  "jar", "war", "ear", "class",
  "zip", "tar", "gz", "rar", "7z", "bz2", "xz",
  "pem", "key", "crt", "cer", "p12", "pfx", "jks",
  "db", "sqlite", "sqlite3", "mdb",
  "pyc", "pyo", "o", "obj", "a", "lib",
  "wasm", "node",
]);

// 安全：文件大小限制 (1MB)
const MAX_FILE_SIZE = 1 * 1024 * 1024;

// 安全：敏感文件名模式
const SENSITIVE_PATTERNS = [
  /^\.env/, /^\.secret/, /^\.credential/,
  /password/i, /secret/i, /private.*key/i,
  /id_rsa/, /id_ed25519/, /id_ecdsa/,
];

function extOfName(name) {
  const n = String(name || "").toLowerCase();
  // Handle special filenames like Makefile, Dockerfile
  const base = n.split("/").pop() || "";
  if (base === "makefile") return "makefile";
  if (base === "dockerfile") return "dockerfile";
  if (base === "gemfile") return "ruby";
  if (base === "rakefile") return "ruby";
  if (base === "podfile") return "ruby";
  if (base === "vagrantfile") return "ruby";
  if (base === "jenkinsfile") return "groovy";
  if (base === "build.gradle") return "gradle";
  if (base === "cmakelists.txt") return "cmake";

  const dot = n.lastIndexOf(".");
  if (dot === -1) return "";
  return n.slice(dot + 1);
}

function getLang(filename) {
  const ext = extOfName(filename);
  return EXT_TO_LANG[ext] || "text";
}

function isSupportedCodeFile(filename) {
  const ext = extOfName(filename);
  return ext in EXT_TO_LANG;
}

function isBlockedFile(filename) {
  const ext = extOfName(filename);
  if (BLOCKED_EXTENSIONS.has(ext)) return true;
  const name = String(filename || "").toLowerCase();
  return SENSITIVE_PATTERNS.some(p => p.test(name));
}

async function basenameOfPath(path) {
  const { basename } = await import("node:path");
  return basename(path);
}

async function readTextFromPath(path) {
  const { readFile, stat } = await import("node:fs/promises");
  const stats = await stat(path);
  if (stats.size > MAX_FILE_SIZE) {
    throw new Error(`File too large: ${stats.size} bytes (max ${MAX_FILE_SIZE})`);
  }
  const buf = await readFile(path);
  return { text: buf.toString("utf8"), size: buf.length };
}

export class CodeAdapter extends BaseAdapter {
  constructor(options = {}) {
    super({ ...options, adapterName: "code" });
    this.maxFileSize = options.maxFileSize || MAX_FILE_SIZE;
  }

  /**
   * Check if a file is a supported code file
   */
  static isSupported(filename) {
    return isSupportedCodeFile(filename) && !isBlockedFile(filename);
  }

  /**
   * Get supported extensions list
   */
  static getSupportedExtensions() {
    return Object.keys(EXT_TO_LANG);
  }

  /**
   * @param {string|{name?:string,filename?:string,type?:string,size?:number,text?:Function,arrayBuffer?:Function,content?:string}} input
   * @returns {Promise<object>} ParsedDocument
   */
  async parse(input) {
    const t0 = Date.now();

    let filename = "";
    let size = undefined;
    let code = "";

    if (typeof input === "string") {
      filename = await basenameOfPath(input);

      // Security check
      if (isBlockedFile(filename)) {
        throw new Error(`CodeAdapter: blocked file type for security: ${filename}`);
      }

      const res = await readTextFromPath(input);
      size = res.size;
      code = res.text;
    } else if (input && typeof input === "object") {
      filename = toNonEmptyString(input.name) || toNonEmptyString(input.filename) || "code.txt";
      size = Number.isFinite(input.size) ? input.size : undefined;

      // Security check
      if (isBlockedFile(filename)) {
        throw new Error(`CodeAdapter: blocked file type for security: ${filename}`);
      }
      if (size && size > this.maxFileSize) {
        throw new Error(`CodeAdapter: file too large: ${size} bytes (max ${this.maxFileSize})`);
      }

      if (typeof input.text === "function") {
        code = String(await input.text());
      } else if (typeof input.arrayBuffer === "function") {
        const buf = Buffer.from(await input.arrayBuffer());
        code = buf.toString("utf8");
        size = size ?? buf.length;
      } else if (typeof input.content === "string") {
        code = input.content;
      } else {
        throw new Error("CodeAdapter.parse(input): unsupported file-like input");
      }
    } else {
      throw new TypeError("CodeAdapter.parse(input): input must be a path string or a file-like object");
    }

    const lang = getLang(filename);
    const lineCount = code.split("\n").length;

    // Build markdown with code block
    const markdown = this.buildMarkdown(filename, code, lang);

    const parsed = this.buildParsedDocument({
      sourceType: "code",
      origin: { filename, lang, size },
      markdown,
      assets: [],
      metadata: {
        title: filename,
        language: lang,
        lineCount,
        extension: extOfName(filename),
      },
      parseInfo: { adapter: "code", durationMs: Date.now() - t0 },
    });

    return parsed;
  }

  /**
   * Build markdown from code with optional comment extraction
   */
  buildMarkdown(filename, code, lang) {
    const parts = [];

    // Title
    parts.push(`# ${filename}`);
    parts.push("");

    // Extract file-level doc comment if present
    const docComment = this.extractDocComment(code, lang);
    if (docComment) {
      parts.push(docComment);
      parts.push("");
    }

    // Language badge
    parts.push(`**Language:** \`${lang}\``);
    parts.push("");

    // Code block
    parts.push("```" + lang);
    parts.push(code);
    parts.push("```");

    return parts.join("\n");
  }

  /**
   * Extract leading doc comment from code
   */
  extractDocComment(code, lang) {
    const lines = code.split("\n");
    const comments = [];
    let inBlock = false;

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines at start
      if (!trimmed && comments.length === 0) continue;

      // Check for block comment start
      if (!inBlock) {
        if (trimmed.startsWith("/**") || trimmed.startsWith("/*")) {
          inBlock = true;
          const content = trimmed.replace(/^\/\*\*?\s*/, "").replace(/\*\/$/, "").trim();
          if (content) comments.push(content);
          if (trimmed.endsWith("*/")) inBlock = false;
          continue;
        }
        // Python/Ruby docstring
        if ((lang === "python" || lang === "ruby") && (trimmed.startsWith('"""') || trimmed.startsWith("'''"))) {
          const quote = trimmed.slice(0, 3);
          if (trimmed.length > 6 && trimmed.endsWith(quote)) {
            comments.push(trimmed.slice(3, -3).trim());
          } else {
            inBlock = true;
            const content = trimmed.slice(3).trim();
            if (content) comments.push(content);
          }
          continue;
        }
        // Line comments (// or #)
        if (trimmed.startsWith("//") || trimmed.startsWith("#")) {
          comments.push(trimmed.replace(/^\/\/\s*|^#\s*/, ""));
          continue;
        }
        // Not a comment, stop
        break;
      }

      // Inside block comment
      if (inBlock) {
        if (trimmed.endsWith("*/") || trimmed.endsWith('"""') || trimmed.endsWith("'''")) {
          const content = trimmed.replace(/\*\/$|"""$|'''$/, "").replace(/^\*\s*/, "").trim();
          if (content) comments.push(content);
          inBlock = false;
          continue;
        }
        comments.push(trimmed.replace(/^\*\s*/, ""));
      }
    }

    // Only return if we have meaningful content
    const doc = comments.join("\n").trim();
    return doc.length > 10 ? doc : null;
  }
}
