# Tree-Sitter 多语言支持方案

> 来源：2025-01 OMO 对比分析
> 状态：设计完成，待实施

## 概述

扩展 js/agents 的 tree-sitter WASM 支持，覆盖主流编程语言。

## 现状

### 已支持语言

| 语言 | WASM 文件 | 状态 |
|------|-----------|------|
| JavaScript | `tree-sitter-javascript.wasm` | ✅ 代码中引用 |
| TypeScript | `tree-sitter-typescript.wasm` | ✅ 代码中引用 |
| TSX | `tree-sitter-tsx.wasm` | ✅ 代码中引用 |
| JSON | `tree-sitter-json.wasm` | ✅ 代码中引用 |

### 关键文件

- `shared/parser/tree-sitter-wasm.js` - WASM 加载器
- `stages/codesearch/indexing/symbol-indexer.js` - 符号索引器

---

## 扩展方案

### Tier 1 - 高优先级 (AI4Sci + 通用开发)

| 语言 | 扩展名 | npm 包 | 用途 |
|------|--------|--------|------|
| **Python** | `.py` | `tree-sitter-python` | AI/ML 代码分析 |
| **Markdown** | `.md` | `tree-sitter-markdown` | 文档解析 |
| **HTML** | `.html` | `tree-sitter-html` | 网页结构 |
| **CSS** | `.css` | `tree-sitter-css` | 样式分析 |
| **YAML** | `.yml/.yaml` | `tree-sitter-yaml` | 配置文件 |
| **TOML** | `.toml` | `tree-sitter-toml` | 配置文件 |

### Tier 2 - 中优先级 (系统语言)

| 语言 | 扩展名 | npm 包 | 用途 |
|------|--------|--------|------|
| **Go** | `.go` | `tree-sitter-go` | 后端/CLI |
| **Rust** | `.rs` | `tree-sitter-rust` | 系统编程 |
| **C** | `.c/.h` | `tree-sitter-c` | 系统编程 |
| **C++** | `.cpp/.hpp` | `tree-sitter-cpp` | 系统编程 |
| **Java** | `.java` | `tree-sitter-java` | 企业应用 |
| **Kotlin** | `.kt` | `tree-sitter-kotlin` | Android |

### Tier 3 - 低优先级 (其他)

| 语言 | 扩展名 | npm 包 |
|------|--------|--------|
| **Ruby** | `.rb` | `tree-sitter-ruby` |
| **PHP** | `.php` | `tree-sitter-php` |
| **Swift** | `.swift` | `tree-sitter-swift` |
| **Bash** | `.sh` | `tree-sitter-bash` |
| **SQL** | `.sql` | `tree-sitter-sql` |
| **Lua** | `.lua` | `tree-sitter-lua` |
| **Zig** | `.zig` | `tree-sitter-zig` |

---

## 实施步骤

### Step 1: 更新语言映射

**文件**: `stages/codesearch/indexing/symbol-indexer.js`

```javascript
function detectLanguageForPath(path) {
  const ext = extname(path);
  const EXT_TO_LANG = {
    // Tier 1
    '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascript',
    '.ts': 'typescript',
    '.tsx': 'tsx',
    '.json': 'json',
    '.py': 'python',
    '.md': 'markdown',
    '.html': 'html', '.htm': 'html',
    '.css': 'css',
    '.yml': 'yaml', '.yaml': 'yaml',
    '.toml': 'toml',
    // Tier 2
    '.go': 'go',
    '.rs': 'rust',
    '.c': 'c', '.h': 'c',
    '.cpp': 'cpp', '.hpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp',
    '.java': 'java',
    '.kt': 'kotlin', '.kts': 'kotlin',
    // Tier 3
    '.rb': 'ruby',
    '.php': 'php',
    '.swift': 'swift',
    '.sh': 'bash', '.bash': 'bash',
    '.sql': 'sql',
    '.lua': 'lua',
    '.zig': 'zig',
  };
  return EXT_TO_LANG[ext] || null;
}

const LANGUAGE_WASM = Object.freeze({
  // Tier 1
  javascript: 'tree-sitter-javascript.wasm',
  typescript: 'tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-tsx.wasm',
  json: 'tree-sitter-json.wasm',
  python: 'tree-sitter-python.wasm',
  markdown: 'tree-sitter-markdown.wasm',
  html: 'tree-sitter-html.wasm',
  css: 'tree-sitter-css.wasm',
  yaml: 'tree-sitter-yaml.wasm',
  toml: 'tree-sitter-toml.wasm',
  // Tier 2
  go: 'tree-sitter-go.wasm',
  rust: 'tree-sitter-rust.wasm',
  c: 'tree-sitter-c.wasm',
  cpp: 'tree-sitter-cpp.wasm',
  java: 'tree-sitter-java.wasm',
  kotlin: 'tree-sitter-kotlin.wasm',
  // Tier 3
  ruby: 'tree-sitter-ruby.wasm',
  php: 'tree-sitter-php.wasm',
  swift: 'tree-sitter-swift.wasm',
  bash: 'tree-sitter-bash.wasm',
  sql: 'tree-sitter-sql.wasm',
  lua: 'tree-sitter-lua.wasm',
  zig: 'tree-sitter-zig.wasm',
});
```

### Step 2: 创建 WASM 目录结构

```
wasm/tree-sitter/
├── tree-sitter.wasm           # 核心 WASM
├── tree-sitter-javascript.wasm
├── tree-sitter-typescript.wasm
├── tree-sitter-tsx.wasm
├── tree-sitter-json.wasm
├── tree-sitter-python.wasm    # Tier 1 新增
├── tree-sitter-markdown.wasm
├── tree-sitter-html.wasm
├── tree-sitter-css.wasm
├── tree-sitter-yaml.wasm
├── tree-sitter-toml.wasm
├── tree-sitter-go.wasm        # Tier 2 新增
├── tree-sitter-rust.wasm
├── tree-sitter-c.wasm
├── tree-sitter-cpp.wasm
├── tree-sitter-java.wasm
└── tree-sitter-kotlin.wasm
```

### Step 3: 构建 WASM 脚本

**新文件**: `scripts/build-tree-sitter-wasm.sh`

```bash
#!/bin/bash
# 构建 tree-sitter WASM 文件

LANGS=(
  # Tier 1
  "tree-sitter-javascript"
  "tree-sitter-typescript"
  "tree-sitter-python"
  "tree-sitter-markdown"
  "tree-sitter-html"
  "tree-sitter-css"
  "tree-sitter-yaml"
  "tree-sitter-toml"
  # Tier 2
  "tree-sitter-go"
  "tree-sitter-rust"
  "tree-sitter-c"
  "tree-sitter-cpp"
  "tree-sitter-java"
  "tree-sitter-kotlin"
)

OUT_DIR="wasm/tree-sitter"
mkdir -p "$OUT_DIR"

for lang in "${LANGS[@]}"; do
  echo "Building $lang..."
  npx tree-sitter build-wasm node_modules/$lang
  mv "${lang##*-}.wasm" "$OUT_DIR/$lang.wasm"
done

echo "Done. WASM files in $OUT_DIR"
```

### Step 4: 懒加载优化

**更新**: `shared/parser/tree-sitter-wasm.js`

```javascript
// 语言 WASM 缓存
const _languageCache = new Map();

/**
 * 懒加载语言 WASM
 * @param {string} lang - 语言名称
 * @param {object} [options]
 * @returns {Promise<any>}
 */
export async function loadLanguage(lang, { wasmBaseUrl } = {}) {
  if (_languageCache.has(lang)) {
    return _languageCache.get(lang);
  }

  const env = await initTreeSitter({ wasmBaseUrl });
  if (!env) return null;

  const wasmFile = LANGUAGE_WASM[lang];
  if (!wasmFile) {
    throw new Error(`Unsupported language: ${lang}. Supported: ${Object.keys(LANGUAGE_WASM).join(', ')}`);
  }

  const language = await env.Language.load(
    new URL(wasmFile, env.wasmBaseUrl).toString()
  );
  _languageCache.set(lang, language);
  return language;
}

/**
 * 预加载常用语言
 */
export async function preloadCommonLanguages(options) {
  const common = ['javascript', 'typescript', 'python', 'json'];
  await Promise.all(common.map(lang => loadLanguage(lang, options).catch(() => null)));
}
```

---

## 符号提取规则

每种语言需要定义符号提取规则：

### Python 符号提取

```javascript
const PYTHON_SYMBOL_QUERIES = {
  function: '(function_definition name: (identifier) @name)',
  class: '(class_definition name: (identifier) @name)',
  method: '(function_definition name: (identifier) @name) @method',
  variable: '(assignment left: (identifier) @name)',
  import: '(import_statement (dotted_name) @name)',
};
```

### Go 符号提取

```javascript
const GO_SYMBOL_QUERIES = {
  function: '(function_declaration name: (identifier) @name)',
  method: '(method_declaration name: (field_identifier) @name)',
  type: '(type_declaration (type_spec name: (type_identifier) @name))',
  struct: '(type_declaration (type_spec name: (type_identifier) @name type: (struct_type)))',
  interface: '(type_declaration (type_spec name: (type_identifier) @name type: (interface_type)))',
  const: '(const_declaration (const_spec name: (identifier) @name))',
  var: '(var_declaration (var_spec name: (identifier) @name))',
};
```

### Rust 符号提取

```javascript
const RUST_SYMBOL_QUERIES = {
  function: '(function_item name: (identifier) @name)',
  struct: '(struct_item name: (type_identifier) @name)',
  enum: '(enum_item name: (type_identifier) @name)',
  trait: '(trait_item name: (type_identifier) @name)',
  impl: '(impl_item type: (type_identifier) @name)',
  const: '(const_item name: (identifier) @name)',
  static: '(static_item name: (identifier) @name)',
  mod: '(mod_item name: (identifier) @name)',
};
```

---

## 文件大小预估

| 语言 | WASM 大小 (gzip) |
|------|------------------|
| JavaScript | ~150 KB |
| TypeScript | ~200 KB |
| Python | ~180 KB |
| Go | ~160 KB |
| Rust | ~250 KB |
| C/C++ | ~300 KB |
| Java | ~180 KB |
| **Tier 1 合计** | ~1.2 MB |
| **全部合计** | ~3.5 MB |

**优化策略**:
- 懒加载：仅按需加载使用的语言
- CDN：WASM 文件可部署到 CDN
- 预加载：可选预加载常用语言

---

## 优先级

| 优先级 | 任务 | 工作量 |
|--------|------|--------|
| **P1** | Tier 1 语言 (Python/Markdown/HTML/CSS/YAML) | 低 |
| **P2** | Tier 2 语言 (Go/Rust/C/Java) | 低 |
| **P2** | 符号提取规则 (Python/Go/Rust) | 中 |
| **P3** | Tier 3 语言 | 低 |
| **P3** | 懒加载优化 | 低 |

---

## 参考资源

- [tree-sitter GitHub](https://github.com/tree-sitter/tree-sitter)
- [web-tree-sitter npm](https://www.npmjs.com/package/web-tree-sitter)
- [tree-sitter 语言列表](https://tree-sitter.github.io/tree-sitter/#available-parsers)
