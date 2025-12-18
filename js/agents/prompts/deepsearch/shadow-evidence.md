# Shadow Agent 证据质量评估提示词

评估这段内容作为证据的质量。

## 论点
{claim}

## 证据内容
{content}

## 输出格式（严格 JSON）
{
  "supports": true/false,
  "strength": "strong|moderate|weak|none",
  "confidence": 0.0-1.0,
  "reason": "简短理由（20字内）",
  "betterQuote": "如果有更好的引用，提取出来"
}

只返回 JSON。
