// ===== Reflect Prompt: LLM 自主判断是否需要更多信息 =====
export const REFLECT_PROMPT = `你是一个研究助手，需要判断当前收集的证据是否足以回答用户的问题。

## 用户问题
{taskGoal}

## 覆盖情况统计
{coverageStats}

## 未覆盖的知识缺口
{uncoveredGaps}

## 核心论点样本 (共 {totalClaims} 个)
{coreClaims}

## 任务
基于以上覆盖情况，判断：
1. 当前证据是否足以回答用户问题的核心部分？
2. 未覆盖的缺口是否关键？是否需要外部搜索补充？

## 输出格式 (严格 JSON)
{
  "sufficient": true/false,           // 证据是否充分
  "confidence": 0.0-1.0,              // 置信度 (0.8+ 表示很确定)
  "reason": "简短说明判断理由",
  "missingAspects": ["缺失方面1"],    // 如果不充分，列出关键缺失
  "suggestedQueries": ["搜索词1"]     // 如果不充分，建议的搜索词 (最多3个)
}

只返回 JSON，不要其他内容。`;

// ===== LLM Claims Prompt: 基于 gap.question 从 chunks 提取更精准论点 =====
export const LLM_CLAIMS_PROMPT = `你是一个研究助手，需要从文档片段中提取与问题相关的关键论点。

## 问题
{gapQuestion}

## 文档片段
{chunkTexts}

## 任务
1. 仔细阅读文档片段
2. 提取能够回答或部分回答问题的关键论点
3. 每个论点必须有原文引用支持

## 输出格式 (JSON)
{
  "claims": [
    {
      "text": "论点陈述（简洁、清晰）",
      "importance": "core|support",
      "quote": "原文引用（必须是文档中的原文）",
      "chunkIndex": 0  // 引用来自哪个 chunk
    }
  ]
}
`;
