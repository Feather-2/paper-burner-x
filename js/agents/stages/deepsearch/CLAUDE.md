# deepsearch - 深度搜索阶段

多轮文档分析、任务规划和报告生成。

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | 入口，runDeepSearchAgent |
| `deepsearch-agent-loop.js` | DeepSearchAgentLoop |
| `state.js` | DeepSearchState 状态管理 |
| `todos.js` | TODO 任务管理 |
| `capabilities-loader.js` | 能力加载 |

## 子目录

| 目录 | 职责 |
|------|------|
| `tools/` | 工具定义和处理器 |
| `phases/` | 阶段划分 |
| `model/` | 预算/定价模型 |
| `report/` | 报告生成、引用 |
| `runtime/` | 运行时组件 |
| `state/` | 状态管理 |
| `utils/` | 工具函数 |

## 工具 (tools/)

| 工具 | 文件 | 用途 |
|------|------|------|
| advise-task | `advise-task/handler.js` | 任务建议 |
| ask-user | `ask-user/handler.js` | 用户交互 |
| get-task-result | `get-task-result/handler.js` | 获取子任务结果 |
| list-docs | `list-docs/handler.js` | 列出可用文档 |
| read-doc | `read-doc/handler.js` | 读取文档内容 |
| refine-planning | `refine-planning/handler.js` | 规划细化 |
| watchdog | `watchdog/handler.js` | 资源监控 |

## 状态结构

```javascript
DeepSearchState {
  runId: string,
  taskGoal: string,
  userConfig: object,
  L0: { sources: [], assets: [] },
  L1: { tasks: [], planning: {} },
  L2: { findings: [], citations: [] },
  L3: { report: string },
}
```

## 使用示例

```javascript
import { runDeepSearchAgent, DeepSearchState } from 'js/agents/stages/deepsearch';

const result = await runDeepSearchAgent(runContext, {
  sources: [pdfDoc, webPage],
  taskGoal: '分析 2024 年市场趋势',
  userConfig: {
    maxIterations: 15,
    language: 'zh-CN',
  },
});

console.log(result.report);
```
