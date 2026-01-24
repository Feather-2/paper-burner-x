# indexing (codesearch) - 代码索引

符号索引、查询与持久化存储（默认 IndexedDB）。

## 核心文件

| 文件 | 职责 |
|------|------|
| `symbol-indexer.js` | SymbolIndexer - 读取文件→ Tree-sitter 解析→ 提取符号→ 写入/查询索引 |
| `index-store.js` | CodeSearchIndexStore - 索引存储（IndexedDB `symbols` store；含输入归一化与事务封装） |

## 运行环境

- Browser: 使用 IndexedDB（DB: `CodeSearchIndexDB`，version: `1`，store: `symbols`）持久化符号索引
- Node.js: 若无 `indexedDB`（或不提供 polyfill），`CodeSearchIndexStore` 无法工作；请注入自定义 `store`（或提供 IndexedDB polyfill）

## 数据模型（摘要）

```javascript
/**
 * @typedef {object} SymbolEntry
 * @property {string} name - 符号名
 * @property {string} kind - 符号类别（函数/类/变量等，取决于 parser）
 * @property {string=} type - 类型信息（可选）
 * @property {string} file - 所在文件路径
 * @property {number} startLine - 起始行（1-based）
 * @property {number} endLine - 结束行（1-based）
 * @property {string=} signature - 签名（可选）
 * @property {string=} doc - 文档注释（可选；渲染到 UI 时应按纯文本转义）
 * @property {string=} parser - 解析器标识（可选）
 *
 * @typedef {object} SymbolRecord
 * @property {string} key - 由 workspaceId + path（归一化后）生成的稳定 key
 * @property {string} workspaceId - 空值会归一化为 'default'
 * @property {string} path - 归一化后的文件路径（必须非空）
 * @property {string|null} sha256 - 文件内容 hash（可为空）
 * @property {SymbolEntry[]} symbols - 符号列表
 * @property {string} updatedAt - ISO 时间戳
 */
```

## SymbolIndexer

```javascript
import { SymbolIndexer } from 'js/agents/stages/codesearch/indexing/symbol-indexer.js';
import CodeSearchIndexStore from 'js/agents/stages/codesearch/indexing/index-store.js';

const store = new CodeSearchIndexStore();

const indexer = new SymbolIndexer({
  vfs: { readText: async (path) => await readText(path) },
  store, // 可选：不传则使用内部默认 store 策略
  workspaceId: 'default', // 为空时归一化为 'default'
  wasmBaseUrl: '/assets/tree-sitter/', // 可选：Tree-sitter wasm 资源 base URL（建议使用同源相对路径）
  logger: console, // 可选：{debug/info/warn/error}
  emit: (eventName, payload) => {}, // 可选：事件埋点
});

// 索引单个文件（不支持的后缀会被 skipped）
const result = await indexer.indexFile('src/auth.js');
// → { ok, path, skipped, symbols }

// 批量索引
await indexer.indexFiles(['src/auth.js', 'src/user.js']);

// 查询符号
const matches = await indexer.query({ query: 'handle', pathPrefix: 'src/' });
// → [{ name, kind, type, file, startLine, endLine, signature, doc, parser }]
```

### 支持的文件类型

- JavaScript: `.js` `.mjs` `.cjs` `.jsx`
- TypeScript: `.ts`
- TSX: `.tsx`
- JSON: `.json`

## CodeSearchIndexStore

```javascript
import CodeSearchIndexStore from 'js/agents/stages/codesearch/indexing/index-store.js';

const store = new CodeSearchIndexStore();

// 写入（sha256 或 hash 二选一；updatedAt 不传则由实现填充为当前时间）
// 注意：workspaceId 为空会归一化为 'default'；path 必须是非空字符串
await store.putSymbolRecord('default', 'src/auth.js', {
  sha256,
  // hash: sha256, // alias（fallback）
  symbols,
  // updatedAt: new Date().toISOString(),
});

// 读取
const record = await store.getSymbolRecord('default', 'src/auth.js');
// → { key, workspaceId, path, sha256, symbols, updatedAt } | null
```