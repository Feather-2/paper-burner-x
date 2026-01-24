# retrieval - 检索系统

文档和代码检索引擎。

> **文件统计**: 10 个 JS 文件

## 最近变更

- **bm25**: 新增索引规模限额归一化（maxTokensPerDoc / maxUniqueTerms / maxPostingsPerTerm / maxTermLength），默认启用安全上限
- **grepChunks**: 引入安全正则编译（复杂度限制以降低 ReDoS 风险）并支持 maxMatchesPerChunk
- **hybrid-retrieval**: 数值参数统一做 finite/非负归一化，避免 NaN/负值影响融合排序

## 核心文件

| 文件 | 职责 |
|------|------|
| `retrieval-router.js` | 检索路由器：BM25 + Grep 合并、MMR 重排、ReadAround 扩展 |
| `bm25.js` | BM25 关键词检索与索引序列化（含索引规模/term 长度限额） |
| `vector-search.js` | 向量索引构建与相似度检索 |
| `hybrid-retrieval.js` | BM25 + 向量检索融合（RRF） |
| `mmr.js` | MMR (Maximal Marginal Relevance) 多样性重排 |
| `grep.js` | 正则/模式检索（安全正则 + 匹配数限额） |
| `readaround.js` | 上下文扩展读取 |
| `scope.js` | 检索范围定义 |
| `toc-builder.js` | 目录结构构建 |
| `tool-chain.js` | 检索工具链（glob → grep） |

## 参数与限额

- **BM25 索引限额**（见 `bm25.js`）：
  - maxTokensPerDoc = 10_000
  - maxUniqueTerms = 50_000
  - maxPostingsPerTerm = 10_000
  - maxTermLength = 64
  - 传入非正数/非有限数会回退到默认值
- **Grep 匹配限额**（见 `grep.js`）：
  - maxMatchesPerChunk 默认 50
  - 当 pattern 为 RegExp 时会对 pattern.source 做复杂度校验并可能抛错

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
import { RetrievalRouter } from './retrieval-router.js';

const router = new RetrievalRouter({ topK: 8, windowSize: 1 });

const sourceIndex = { sourceId: 'doc_1', chunks, toc, fullText };
const gaps = [{ gapId: 'g1', query: '安装步骤' }];

const results = await router.retrieve(sourceIndex, gaps, {
  useBm25: true,
  useGrep: true,
  mmr: { lambda: 0.7 },
});
```

```javascript
import { buildIndex } from './bm25.js';
import { grepChunks } from './grep.js';

const bm25Index = buildIndex(chunks, {
  maxTokensPerDoc: 10_000,
  maxUniqueTerms: 50_000,
  maxPostingsPerTerm: 10_000,
  maxTermLength: 64,
});

const grepHits = grepChunks(chunks, 'TODO', {
  regex: false,
  caseSensitive: false,
  maxMatchesPerChunk: 50,
});
```

```javascript
import { hybridSearch } from './hybrid-retrieval.js';
import { buildIndex } from './bm25.js';
import { buildIndexAsync as buildVectorIndexAsync } from './vector-search.js';

const bm25Index = buildIndex(chunks);
const { vectorIndex } = await buildVectorIndexAsync(chunks, { embeddingService });

const fused = await hybridSearch({ bm25Index, vectorIndex }, 'query', {
  embeddingService,
  limit: 10,
});
```