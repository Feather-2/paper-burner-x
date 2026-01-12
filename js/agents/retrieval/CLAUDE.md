# retrieval - 检索系统

文档和代码检索引擎。

## 核心文件

| 文件 | 职责 |
|------|------|
| `retrieval-router.js` | 检索路由器，选择最优检索策略 |
| `bm25.js` | BM25 关键词检索 |
| `mmr.js` | MMR (Maximal Marginal Relevance) 多样性重排 |
| `grep.js` | 正则/模式检索 |
| `readaround.js` | 上下文扩展读取 |
| `scope.js` | 检索范围定义 |
| `toc-builder.js` | 目录结构构建 |
| `tool-chain.js` | 检索工具链 |

## 检索策略

```
Query
  ↓
RetrievalRouter
  ├─ BM25 (关键词匹配)
  ├─ Vector (语义相似)
  └─ Grep (模式匹配)
  ↓
MMR (多样性重排)
  ↓
Results
```

## 使用示例

```javascript
import { RetrievalRouter, BM25, MMR } from 'js/agents/retrieval';

const router = new RetrievalRouter({
  strategies: [
    new BM25({ k1: 1.5, b: 0.75 }),
    vectorIndex,
  ],
});

const results = await router.retrieve(query, { topK: 10 });
const diverse = MMR.rerank(results, { lambda: 0.7 });
```

## BM25 参数

- `k1`: 词频饱和参数 (默认 1.5)
- `b`: 文档长度归一化 (默认 0.75)

## MMR 参数

- `lambda`: 相关性 vs 多样性权衡 (0-1)
