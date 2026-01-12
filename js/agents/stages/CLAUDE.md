# stages - 业务阶段

预定义的 Agent 工作流阶段。

## 子模块索引

| 阶段 | 路径 | 职责 |
|------|------|------|
| **deepsearch** | `deepsearch/CLAUDE.md` | 深度搜索：多轮文档分析、任务规划、报告生成 |
| **design** | `design/` | 设计阶段：PPT/幻灯片生成 |
| **codesearch** | `codesearch/` | 代码搜索：符号索引、语义检索 |
| **textprep** | `textprep/` | 文本预处理：声明提取 |

## DeepSearch

```javascript
import { runDeepSearchAgent, DeepSearchState } from 'js/agents/stages/deepsearch';

const result = await runDeepSearchAgent(runContext, {
  sources: [doc1, doc2],
  taskGoal: '分析市场趋势',
  userConfig: { maxIterations: 10 },
});
```

### DeepSearch Tools

| Tool | 文件 | 用途 |
|------|------|------|
| advise-task | `tools/advise-task/` | 任务建议 |
| ask-user | `tools/ask-user/` | 用户交互 |
| get-task-result | `tools/get-task-result/` | 获取任务结果 |
| list-docs | `tools/list-docs/` | 列出文档 |
| read-doc | `tools/read-doc/` | 读取文档 |
| refine-planning | `tools/refine-planning/` | 规划细化 |
| watchdog | `tools/watchdog/` | 看门狗 |

## Design

```javascript
import { DesignAgentLoop } from 'js/agents/stages/design';

const designer = new DesignAgentLoop({ eventBus });
const deck = await designer.run({ topic: '年度报告' });
```

## CodeSearch

```javascript
import { CodeSearchStage } from 'js/agents/codesearch';

const stage = new CodeSearchStage({ indexStore });
const results = await stage.search('authentication flow');
```

### CodeSearch Phases

1. `planning-phase.js` - 规划
2. `execution-phase.js` - 执行
3. `summarizing-phase.js` - 总结
