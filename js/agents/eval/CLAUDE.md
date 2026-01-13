# eval - Agent 评估框架

完整的 Agent evaluation harness：支持多次 trial、transcript 记录、确定性/LLM graders、统计指标（pass@k / pass^k）与结果聚合。

## 目录结构

```
js/agents/eval/
├── index.js
├── types.js
├── graders/
│   ├── index.js
│   ├── deterministic.js
│   ├── llm-judge.js
│   ├── composite.js
│   └── content.js          # EvaluateStage (back-compat) + contentGrader
├── harness.js
└── metrics.js
```

## 快速开始

### 1) 运行一个 task（多次 trial）

```js
import { EvalHarness } from "js/agents/eval";

const harness = new EvalHarness({
  // 你提供一个创建 Agent 的函数（每次 trial 都应返回全新实例）
  agentFactory: async ({ task, trialIndex }) => {
    return {
      async run(input) {
        return `echo:${input}`;
      },
    };
  },
  trialsPerTask: 3,
  concurrency: 4,
});

const task = {
  id: "t1",
  description: "Echo task",
  input: "hello",
  graders: [
    { type: "regex", options: { pattern: "^echo:hello$" } },
  ],
};

const result = await harness.runTask(task);
// result: { taskId, trials, passRate, passAtK, passExpK }
```

### 2) 运行 suite（并发）

```js
const suite = { suiteId: "demo", tasks: [task] };
const suiteResult = await harness.runSuite(suite, { concurrency: 4 });
// suiteResult: { suiteId, tasks, aggregated }
```

## 核心数据结构（JSDoc）

- `js/agents/eval/types.js`: `EvalTask`, `Trial`, `Transcript`, `GraderConfig`, `GraderResult`, `EvalSuiteResult` 等。

## 内置 Graders

### Deterministic（推荐优先使用）

- `regex`：输出文本正则匹配（`options.pattern/patterns`, `match:any|all`, `invert`, `minMatches`）
- `state_check`：检查 outcome（支持 `options.path` 与 subset match）
- `tool_calls`：校验 transcript 中的工具调用（required/forbidden/sequence/match）
- `transcript`：对 turns/tokens/latency 等做约束

### LLM-as-Judge（需要 llmClient）

需要在 `runTask/runSuite` 传入 `llmClient`（或在 `new EvalHarness({ llmClient })` 注入）。支持 `MockModelClient` 的 `.chat()` 形态。

- `llm_rubric`：基于 rubric 评分（`options.rubric`）
- `llm_assertion`：自然语言断言（`options.assertions`）
- `llm_pairwise`：A/B 对比（trial 输出 vs `options.baseline/outputB`）

与 `testing/mock-suite.js` 集成示例：

```js
import { createMockTestEnv } from "js/agents/testing/mock-suite.js";
import { EvalHarness } from "js/agents/eval";

const env = createMockTestEnv({ model: { responses: { default: "{\"passed\":true,\"score\":1,\"reason\":\"ok\",\"issues\":[]}" } } });
const harness = new EvalHarness({ agentFactory: async () => ({ run: async () => "answer" }), llmClient: env.modelClient });
```

### Composite（组合评分）

将多个 grader 的结果组合成一个新的 `GraderResult`：

- `all_pass`：全部通过才通过（score 取最小值）
- `weighted`：加权平均（可用 `options.weights` 覆盖权重）
- `threshold`：基于阈值判定通过（`options.threshold`, `use: avg|min|max`）

提示：把 composite grader 放在 `task.graders` 的最后，可以作为 trial 的最终 `passed/score`（也可用 `options.final: true` 显式指定）。

## Backward compatibility：EvaluateStage

原 `EvaluateStage` 已移动到 `js/agents/eval/graders/content.js`，依然可以从 `js/agents/eval` 导入：

```js
import EvaluateStage, { EvaluateStage as Named } from "js/agents/eval";
```

同时提供 `content` grader（包装 EvaluateStage）用于 harness：

```js
{ type: "content", options: { stage: { passThreshold: 0.6 }, input: { context: { type: "report" } } } }
```
