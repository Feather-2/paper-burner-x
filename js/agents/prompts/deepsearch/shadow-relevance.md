# Shadow Agent 相关性判断提示词

判断这段内容是否回答了问题。

## 问题
{question}

## 内容
{content}

## 输出格式（严格 JSON）
{
  "relevant": true/false,
  "confidence": 0.0-1.0,
  "reason": "简短理由（20字内）",
  "keyInfo": "如果相关，提取关键信息（50字内）"
}

只返回 JSON。
