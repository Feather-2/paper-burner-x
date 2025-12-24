# CodeSearch Step 提示词

## 当前任务

用户查询：{QUERY}

## 进度

当前步骤：{STEP} / {MAX_STEPS}

## 当前待办 (open todos)

{OPEN_TODOS}

## 已有观察

{OBSERVATIONS}

## 你的下一步

根据已有信息，从 open todos 中选择一个执行；如果发现新的待办，可补充 newTodos。
如果已满足需求且没有 open todos，输出 "action": "done"。

## 输出格式（严格 JSON）

### 单个工具调用

```json
{
  "thought": "我的思考...",
  "todoId": "todo_x",
  "todoIndex": 1,
  "action": "tool_name",
  "args": { "param": "value" },
  "todoStatus": "pending|completed|cancelled",
  "newTodos": [
    { "text": "...", "priority": "medium", "queryHints": ["..."], "expectedEvidence": "..." }
  ]
}
```

### 仅新增待办

```json
{
  "thought": "补充待办...",
  "action": "add_todo",
  "newTodos": [
    { "text": "...", "priority": "medium", "queryHints": ["..."], "expectedEvidence": "..." }
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
