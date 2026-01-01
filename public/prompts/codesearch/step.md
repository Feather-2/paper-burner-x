# CodeSearch Step 提示词

## 当前任务

用户查询：{QUERY}

## 进度

当前步骤：{STEP} / {MAX_STEPS}

## 当前待办 (open todos)

{OPEN_TODOS}

## 已有观察

{OBSERVATIONS}

## Todo 质量指南

<todo_quality>
**高质量 Todo 示例**：
```
- 读取 src/index.ts 分析入口点
- grep "export.*function" 找公开 API
- 分析 utils/ 目录的工具函数
```

**低质量 Todo 示例**（避免）：
```
- 看代码
- 搜索一下
- 继续分析
```

**Todo 检查**：
- [ ] 具体可执行（包含文件/模式）
- [ ] 5-10 词描述
- [ ] 有明确预期结果
</todo_quality>

## 你的下一步

根据已有信息，从 open todos 中选择一个执行；如果发现新的待办，可补充 newTodos。
如果已满足需求且没有 open todos，输出 "action": "done"。

## 输出格式（严格 JSON）

### 单个工具调用

```json
{
  "thought": "进度: {STEP}/{MAX_STEPS} | 执行: [todo描述] | 预期: [预期结果]",
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

### 批量工具调用（推荐用于独立操作）

```json
{
  "thought": "需要并行执行多个独立搜索...",
  "actions": [
    { "action": "grep", "args": { "pattern": "import.*React" } },
    { "action": "grep", "args": { "pattern": "export default" } },
    { "action": "read_file", "args": { "path": "package.json" } }
  ],
  "todoId": "todo_x",
  "todoStatus": "completed",
  "newTodos": []
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
  "thought": "总结: [关键发现] | 置信度: [高/中/低]",
  "action": "done"
}
```

<batch_call_guidelines>
**适合批量调用**：
- 同时搜索多个不同的关键词
- 并行读取多个已知路径的文件
- 同时用不同 glob 模式查找文件

**不适合批量调用**：
- 下一步依赖上一步结果
- 需要根据结果决定方向
</batch_call_guidelines>

只返回 JSON，不要其他内容。
