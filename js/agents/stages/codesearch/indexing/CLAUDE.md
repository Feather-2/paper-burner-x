# indexing (codesearch) - 代码索引

符号索引和存储。

## 核心文件

| 文件 | 职责 |
|------|------|
| `symbol-indexer.js` | SymbolIndexer - 符号提取 |
| `index-store.js` | IndexStore - 索引存储 |

## SymbolIndexer

```javascript
import { SymbolIndexer } from 'js/agents/stages/codesearch/indexing';

const indexer = new SymbolIndexer({
  languages: ['javascript', 'typescript', 'python'],
});

const symbols = await indexer.index('/path/to/project');
// → [{ name, type, file, line, signature, doc }]
```

## IndexStore

```javascript
import { IndexStore } from 'js/agents/stages/codesearch/indexing';

const store = new IndexStore('/path/to/index');

// 写入
await store.save(symbols);

// 查询
const matches = await store.query({
  type: 'function',
  name: /^handle/,
});

// 按文件查询
const fileSymbols = await store.getByFile('src/auth.js');
```
