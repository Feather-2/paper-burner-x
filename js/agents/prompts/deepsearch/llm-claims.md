# DeepSearch 论点提取提示词

你是一个研究助手，需要从文档片段中提取与问题相关的关键论点。

## 问题
{gapQuestion}

## 文档片段
{chunkTexts}

## 任务
1. 仔细阅读文档片段
2. 提取能够回答或部分回答问题的关键论点
3. 每个论点必须有原文引用支持

## 输出格式（严格 JSON）

```json
{
  "claims": [
    {
      "text": "论点陈述（简洁、清晰）",
      "importance": "core|support",
      "quote": "原文引用（必须是文档中的原文）",
      "chunkIndex": 0
    }
  ]
}
```

## 字段说明

- **text**: 论点的简洁陈述
- **importance**: `core` 表示核心论点，`support` 表示支撑性论点
- **quote**: 必须是文档中的原文，用于证明论点
- **chunkIndex**: 引用来自第几个文档片段（从 0 开始）

只返回 JSON，不要其他内容。
