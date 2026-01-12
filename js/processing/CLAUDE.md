# Processing 模块

Paper-Burner 的内容处理层，负责文档解析、Markdown 处理、参考文献提取。

## 模块职责

- **Markdown 处理**：解析、增强、修复
- **公式处理**：LaTeX 公式后处理
- **参考文献**：检测、提取、DOI 解析、索引
- **内容分块**：文档分块用于 RAG

## 主要组件

| 组件 | 文件 | 职责 |
|------|------|------|
| Markdown 处理器 | markdown_processor*.js | Markdown 解析和渲染 |
| 公式处理器 | formula_post_processor*.js | LaTeX 公式处理 |
| 参考文献检测 | reference-detector.js | 识别文献引用 |
| DOI 解析器 | reference-doi-resolver.js | 从 DOI 获取元数据 |
| 参考文献提取 | reference-extractor.js | 提取完整文献信息 |
| 参考文献索引 | reference-indexer.js | 建立引用索引 |
| 内容分块 | content-list-to-chunks.js | RAG 用文档分块 |
| 子块分割 | sub_block_segmenter.js | 细粒度分块 |
| 标注 AST | annotation_plugin_ast.js | 标注 AST 插件 |

## 数据流

```
原始文档
    ↓
Markdown 处理器 (解析)
    ↓
公式处理器 (LaTeX)
    ↓
参考文献提取
    ↓
内容分块 (RAG)
    ↓
嵌入索引 (Agent 使用)
```

## ESM 双版本

同 js/ui，每个组件提供 `.js` 和 `.esm.js` 双版本。

## 与 Agent 集成

- **Ingest Stage**：使用 Markdown 处理器解析文档
- **Retrieval**：使用内容分块建立向量索引
- **DeepSearch**：使用参考文献提取增强分析

## 开发注意

- AST 处理需考虑性能（大文档）
- 参考文献格式多样，检测需鲁棒
- 分块策略影响 RAG 质量
