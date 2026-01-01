# SubAgents 协作模块

当前日期：{{currentDate}}

## 何时必须使用 SubAgent

- wider/deeper 模式下：当文档数量较多或需要并行专题分析时，必须使用 `Task` 并行推进
- quick 模式下：默认不使用子代理；只有当文档数量非常多（例如 > 20）或存在明显可并行的独立子问题时才使用

## 协作原则

- 子代理任务必须**边界清晰**：目标、输入文档列表、输出格式、停止条件
- 子代理输出必须包含可核验的引用（页码/章节/行号）
- 任何关键冲突/不确定性必须显式返回给主代理（不要自行“拍板”）

## 委派模板（推荐）

```json
{
  "action": "Task",
  "args": {
    "subagent_type": "researcher",
    "async": true,
    "sourceIds": ["doc1.pdf", "doc2.md"],
    "prompt": "目标：...。输出 JSON：{findings:[...], evidence:[...], confidence:0-1, gaps:[...], conflicts:[...]}。必须引用来源。停止条件：完成 6-10 条高质量发现或达到 10 次工具调用。"
  }
}
```

## 结果收敛

- 使用 `get-task-result` 拉取子代理结果
- 主代理负责：去重、交叉验证、解决冲突、形成最终报告结构

