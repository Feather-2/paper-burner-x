# retrieval - 检索系统

文档和代码检索引擎。

> **文件统计**: 10 个 JS 文件

## 最近变更

- **rrfFuse**: 默认空数组参数，允许缺省/undefined 输入，避免类型校验异常

## 核心文件

| 文件 | 职责 |
|------|------|
| `retrieval-router.js` | 检索路由器：BM25 + Grep 合并、MMR 重排、ReadAround 扩展 |
| `bm25.js` | BM25 关键词检索与索引序列化 |
| `vector-search.js` | 向量索引构建与相似度检索 |
| `hybrid-retrieval.js` | BM25 + 向量检索融合（RRF） |
| `mmr.js` | MMR (Maximal Marginal Relevance) 多样性重排 |
| `grep.js` | 正则/模式检索 |
| `readaround.js` | 上下文扩展读取 |
| `scope.js` | 检索范围定义 |
| `toc-builder.js` | 目录结构构建 |
| `tool-chain.js` | 检索工具链（glob → grep） |

## 检索策略

```
Gap Queries
  ↓
Scope (TOC)
  ↓
BM25 + Grep (score merge)
  ↓
MMR (optional)
  ↓
ReadAround
  ↓
Results
```

```
HybridSearch
  Query
    ├─ BM25
    └─ Vector
  ↓
RRF Fusion
  ↓
Results
```

## 使用示例

```javascript
import { RetrievalRouter } from "./retrieval-router.js";

const router = new RetrievalRouter({ topK: 8, windowSize: 1 });

const sourceIndex = { sourceId: "doc_1", chunks, toc, fullText };
const gaps = [{ gapId: "g1", query: "安装步骤" }];

const results = await router.retrieve(sourceIndex, gaps, {
  useBm25: true,
  useGrep: true,
  mmr: { lambda: 0.7 },
});
```

```javascript
import { hybridSearch } from "./hybrid-retrieval.js";
import { buildIndex } from "./bm25.js";
import { buildIndexAsync as buildVectorIndexAsync } from "./vector-search.js";

const bm25Index = buildIndex(chunks);
const { vectorIndex } = await buildVectorIndexAsync(chunks, { embeddingService });

const fused = await hybridSearch({ bm25Index, vectorIndex }, "query", {
  embeddingService,
  limit: 10,
});
```

## Vector Search 依赖

- `embeddingService.embed(texts, opts)` 需返回与 `texts` 对齐的向量数组。

## BM25 参数

- `k1`: 词频饱和参数 (默认 1.5)
- `b`: 文档长度归一化 (默认 0.75)

## MMR 参数

- `lambda`: 相关性 vs 多样性权衡 (0-1)

## Hybrid 参数

- `rrfK`: RRF 融合参数 (默认 60)
- `bm25Weight`: BM25 权重 (默认 1.0)
- `vectorWeight`: 向量检索权重 (默认 1.0)