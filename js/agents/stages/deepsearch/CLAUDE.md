# deepsearch - 深度搜索阶段

多轮文档分析、任务规划、证据记录与报告生成。

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | 入口：runDeepSearchAgent / runDeepSearchTodosStage |
| `deepsearch-agent-loop.js` | 主循环：planning -> execution -> writing |
| `phases/planning-phase.js` | 规划阶段：system prompt 构建与收敛策略 |
| `phases/execution-phase.js` | 工具调用、超时与 checkpoint |
| `phases/writing-phase.js` | 写作阶段与回溯 |
| `state.js` | DeepSearchState 与序列化 |
| `source-manager.js` | 文档读取/检索与语义搜索 |
| `tools/index.js` | 工具注册与执行 |
| `capabilities-loader.js` | 动态能力加载 |

## 子目录

| 目录 | 职责 |
|------|------|
| `tools/` | 工具定义和处理器 |
| `phases/` | 阶段划分 |
| `model/` | 预算/定价模型 |
| `report/` | 报告生成、引用 |
| `internal/` | 内部运行时组件 |
| `state/` | 状态管理 |
| `utils/` | 工具函数 |

## 工具 (tools/)

| 工具 | 文件 | 用途 |
|------|------|------|
| advise-task | `advise-task/handler.js` | 任务建议 |
| ask-user | `ask-user/handler.js` | 用户交互/澄清 |
| cross-verify | `cross-verify/handler.js` | 交叉验证事实/冲突 |
| evaluate-gaps | `evaluate-gaps/handler.js` | 缺口评估与优先级 |
| get-artifact | `get-artifact/handler.js` | 读取持久化大输出 |
| get-task-result | `get-task-result/handler.js` | 获取子任务结果 |
| list-docs | `list-docs/handler.js` | 列出可用文档 |
| manage-todos | `manage-todos/handler.js` | 任务列表管理 |
| read-doc | `read-doc/handler.js` | 读取文档内容 |
| record-finding | `record-finding/handler.js` | 记录 claims/gaps/conflicts |
| refine-planning | `refine-planning/handler.js` | 规划细化 |
| search-docs | `search-docs/handler.js` | 关键词/语义检索 |
| skill | `skill/handler.js` | 读取 Skill 指令 |
| task | `task/handler.js` | 启动子代理任务 |
| watchdog | `watchdog/handler.js` | 资源监控/回溯触发 |
| write-report | `write-report/handler.js` | 报告生成与引用 |

## 状态结构

```javascript
DeepSearchState {
  runId: string,
  taskGoal: string,
  userConfig: object,
  iteration: number,
  maxIterations: number,
  planningTree: object,
  checkpoints: [],
  trajectoryId?: string,
  trajectoryConfig?: object,
  writeBacktrackCount: number,
  writeSnapshots: [],
  L0: { sources: [], assets: [], sourceIndex?: object|null },
  L1: {
    scanSummary: object|null,
    deepDivePlan: object|null,
    gaps: [],
    retrieved: [],
    claims: [],
    evidenceLedger: [],
    dataTables: [],
    slideIntents: [],
    outlineCandidates: [],
    report: object|null,
    conflicts: [],
    openQuestions: [],
    condensedMemory: object|null,
  },
  L2: {
    retrievedChunks: [],
    scratchpad: object,
    thoughtHistory: [],
    logs: [],
    tokenUsage: { input: number, output: number, total: number, estimatedCostUSD: number },
    awaitUserFeedback: boolean,
    taskImpossible: boolean,
    reason: string,
  },
  todos: [],
  timeline: [],
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
