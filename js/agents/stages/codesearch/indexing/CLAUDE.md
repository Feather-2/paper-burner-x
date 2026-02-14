# indexing (codesearch) - 代码索引

符号索引、查询与持久化存储（默认 IndexedDB），服务于 CodeSearch 阶段的定位与增量更新。

## 核心文件

| 文件 | 职责 |
|------|------|
| `symbol-indexer.js` | `SymbolIndexer`：读取源码 -> Tree-sitter 解析 -> 提取符号 -> 写入索引 |
| `index-store.js` | `CodeSearchIndexStore`：索引存储层（IndexedDB `symbols`），输入归一化与事务封装 |

## 本次实现更新（需同步认知）

- `index-store.js`
  - 新增 IndexedDB 能力探测：`hasIndexedDB()`
  - 新增请求/事务 Promise 封装：`promisifyRequest()`、`promisifyTransaction()`
  - 新增 schema 幂等初始化：`ensureObjectStore()`、`ensureIndex()`
  - 统一归一化：`workspaceId` 空值回退 `'default'`，`path` 需为非空字符串
  - 写入参数支持 `hash` 作为 `sha256` 别名（fallback）

- `symbol-indexer.js`
  - 语言识别覆盖：`.js/.mjs/.cjs/.jsx/.ts/.tsx/.json`
  - 新增语言 wasm 映射常量：`LANGUAGE_WASM`
  - 注释清洗工具：`stripBlockCommentMarkers()`、`stripLineCommentMarkers()`
  - 引入 `LRUCache` 以减少重复初始化/加载开销

## 运行环境

- Browser：默认使用 IndexedDB（DB: `CodeSearchIndexDB`，version: `1`，store: `symbols`）
- Node.js：若无 `indexedDB`，`CodeSearchIndexStore` 需注入自定义 `store` 或提供 IndexedDB polyfill

## 数据模型（摘要）

```javascript
/**
 * @typedef {object} SymbolEntry
 * @property {string} name - 符号名
 * @property {string} kind - 符号类别（function/class/variable 等）
 * @property {string=} type - 类型信息（可选）
 * @property {string} file - 所在文件路径
 * @property {number} startLine - 起始行（1-based）
 * @property {number} endLine - 结束行（1-based）
 * @property {string=} signature - 签名（可选）
 * @property {string=} doc - 文档注释（渲染到 UI 时必须按纯文本转义）
 * @property {string=} parser - 解析器标识（可选）
 *
 * @typedef {object} SymbolRecord
 * @property {string} key - workspaceId + 归一化 path 的稳定 key
 * @property {string} workspaceId - 空值会归一化为 'default'
 * @property {string} path - 归一化后的文件路径（必须非空）
 * @property {string|null} sha256 - 文件内容 hash（可为空）
 * @property {SymbolEntry[]} symbols - 符号列表
 * @property {string} updatedAt - ISO 时间戳
 */
```

## SymbolIndexer 使用示例

```javascript
import { SymbolIndexer } from 'js/agents/stages/codesearch/indexing/symbol-indexer.js';
import CodeSearchIndexStore from 'js/agents/stages/codesearch/indexing/index-store.js';

const store = new CodeSearchIndexStore();

const indexer = new SymbolIndexer({
  vfs: { readText: async (path) => readText(path) },
  store,
  workspaceId: 'default',
  wasmBaseUrl: '/assets/tree-sitter/',
  logger: console,
  emit: (eventName, payload) => {}
});

const result = await indexer.indexFile('src/auth.js');
// 典型返回：{ ok, path, skipped, reason?, count?, durationMs? }
```

## 安全与质量约束

- 禁止将未校验路径直接传入 `vfs.readText`（需限制 workspace root）
- `wasmBaseUrl` 建议仅允许同源相对路径或 allowlist
- 输出到 UI 的 `doc/signature/name` 必须做转义，禁止直接拼接 `innerHTML`
- 禁止使用 `eval` / `new Function`
- 对长耗时步骤（文件读取、wasm 加载、解析）建议设置 `timeoutMs` 与可取消机制
