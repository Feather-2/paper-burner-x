# DeepSearch 证据充分性判断提示词

你是一个研究助手，需要判断当前收集的证据是否足以回答用户的问题。

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

只返回 JSON，不要其他内容。
