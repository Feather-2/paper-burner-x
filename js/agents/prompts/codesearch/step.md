# CodeSearch Step 提示词

## 当前任务

用户查询：{QUERY}

## 进度

当前步骤：{STEP} / {MAX_STEPS}

## 已有观察

{OBSERVATIONS}

## 你的下一步

根据已有信息，决定下一步操作。如果已经有足够信息回答用户问题，输出 "action": "done"。

## 输出格式（严格 JSON）

### 单个工具调用

```json
{
  "thought": "我的思考...",
  "action": "tool_name",
  "args": { "param": "value" }
}
```

### 批量工具调用（独立操作可并行）

```json
{
  "thought": "我需要同时执行多个独立操作...",
  "actions": [
    { "action": "grep", "args": { "pattern": "..." } },
    { "action": "read_file", "args": { "path": "..." } }
  ]
}
```

### 分析完成

```json
{
  "thought": "总结我的发现...",
  "action": "done"
}
```

只返回 JSON，不要其他内容。
