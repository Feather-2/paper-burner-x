# indexing (codesearch) - 代码索引

符号索引、查询与持久化存储（默认 IndexedDB）。

## 核心文件

| 文件 | 职责 |
|------|------|
| `symbol-indexer.js` | SymbolIndexer - 读取文件→ Tree-sitter 解析→ 提取符号→ 写入/查询索引 |
| `index-store.js` | CodeSearchIndexStore - 索引存储（IndexedDB `symbols` store） |

## 运行环境

- Browser: 使用 IndexedDB（DB: `CodeSearchIndexDB`，store: `symbols`）持久化符号索引
- Node.js: 若无 IndexedDB，建议注入自定义 `store`（具体是降级还是报错取决于 `index-store.js` 实现）

## SymbolIndexer

```javascript
import { SymbolIndexer } from 'js/agents/stages/codesearch/indexing/symbol-indexer.js';
import CodeSearchIndexStore from 'js/agents/stages/codesearch/indexing/index-store.js';

const store = new CodeSearchIndexStore();

const indexer = new SymbolIndexer({
  vfs: { readText: async (path) => await readText(path) },
  store, // 可选：不传则使用内部默认 store 策略
  workspaceId: 'default', // 为空时归一化为 'default'
  wasmBaseUrl: '/assets/tree-sitter/', // 可选：Tree-sitter wasm 资源 base URL
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

// 写入（sha256 或 hash 二选一；updatedAt 可覆盖默认时间）
await store.putSymbolRecord('default', 'src/auth.js', {
  sha256,
  // hash: sha256, // alias（fallback）
  symbols,
  updatedAt: new Date().toISOString(),
});

// 读取
const record = await store.getSymbolRecord('default', 'src/auth.js');
// → { key, workspaceId, path, sha256, symbols, updatedAt } | null

// 列表
const rows = await store.listSymbolRecords('default');
```

### SymbolRecord

- `key`: 存储主键（实现内部生成）
- `workspaceId`: 工作区 ID（空值会归一化为 `'default'`）
- `path`: 文件路径（非空字符串）
- `sha256`: 文件内容 hash（可为 `null`）
- `symbols`: 符号数组（由 SymbolIndexer 生成）
- `updatedAt`: ISO 时间字符串
