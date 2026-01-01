# 素材批量分析提示词

分析这些图片以便在演示文稿幻灯片中复用。按提供的顺序返回 JSON 数组，每张图片一个条目：
[
  {
    "index": 0,
    "description": "1-2句描述",
    "category": "photo|chart|diagram|icon|illustration|table|screenshot|logo|other",
    "topics": ["主题1", "主题2"],
    "suggestedUse": ["cover", "content", "comparison", "process", "summary"],
    "visualStyle": "realistic|flat|3d|sketch|minimalist|detailed",
    "dominantColors": ["#hex1", "#hex2"],
    "hasText": true/false,
    "textContent": "提取的文字内容（如有）"
  }
]
只返回 JSON 数组，不要解释。
