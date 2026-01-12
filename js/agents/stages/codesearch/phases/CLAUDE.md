# phases (codesearch) - 代码搜索阶段

三阶段代码搜索流程。

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | 入口 |
| `planning-phase.js` | 规划阶段 |
| `execution-phase.js` | 执行阶段 |
| `summarizing-phase.js` | 总结阶段 |

## 规划阶段

```javascript
import { PlanningPhase } from 'js/agents/stages/codesearch/phases';

const planner = new PlanningPhase({ llm });
const plan = await planner.run({
  query: 'How does authentication work?',
  context: projectContext,
});
// → { strategies: ['symbol', 'semantic', 'grep'], filters: [...] }
```

## 执行阶段

```javascript
import { ExecutionPhase } from 'js/agents/stages/codesearch/phases';

const executor = new ExecutionPhase({ indexStore, vectorIndex });
const results = await executor.run(plan);
// → [{ file, symbols, snippets, relevance }]
```

## 总结阶段

```javascript
import { SummarizingPhase } from 'js/agents/stages/codesearch/phases';

const summarizer = new SummarizingPhase({ llm });
const summary = await summarizer.run(results, query);
// → { answer, references: [...] }
```
