# indexing (codesearch) - 代码索引

符号索引和存储。

## 核心文件

| 文件 | 职责 |
|------|------|
| `symbol-indexer.js` | SymbolIndexer - 符号提取 |
| `index-store.js` | CodeSearchIndexStore - 索引存储 |

## SymbolIndexer

```javascript
import { SymbolIndexer } from 'js/agents/stages/codesearch/indexing/symbol-indexer.js';

const indexer = new SymbolIndexer({
  vfs: { readText: async (path) => await readText(path) },
  workspaceId: 'default',
});

// 索引单个文件
const result = await indexer.indexFile('src/auth.js');
// → { ok, path, skipped, symbols }

// 批量索引
await indexer.indexFiles(['src/auth.js', 'src/user.js']);

// 查询符号
const matches = await indexer.query({ query: 'handle', pathPrefix: 'src/' });
// → [{ name, kind, type, file, startLine, endLine, signature, doc, parser }]
```

## CodeSearchIndexStore

```javascript
import CodeSearchIndexStore from 'js/agents/stages/codesearch/indexing/index-store.js';

const store = new CodeSearchIndexStore();

// 写入
await store.putSymbolRecord('default', 'src/auth.js', { sha256, symbols });

// 读取
const record = await store.getSymbolRecord('default', 'src/auth.js');

// 列表
const rows = await store.listSymbolRecords('default');
```
