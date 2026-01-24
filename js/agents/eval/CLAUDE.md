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
import { EvalHarness } from 'js/agents/eval';

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
  id: 't1',
  description: 'Echo task',
  input: 'hello',
  graders: [{ type: 'regex', options: { pattern: '^echo:hello$' } }],
};

const result = await harness.runTask(task);
// result: { taskId, trials, passRate, passAtK, passExpK, ... }
```

### 2) 运行 suite（并发）

```js
const suite = { suiteId: 'demo', tasks: [task] };
const suiteResult = await harness.runSuite(suite, { concurrency: 4 });
// suiteResult: { suiteId, tasks, aggregated, ... }
```

## 核心数据结构（JSDoc）

- `js/agents/eval/types.js`: `EvalTask`, `EvalSuite`, `Trial`, `Transcript`, `TranscriptEntry`, `GraderConfig`, `GraderResult`, `TaskResult`, `EvalSuiteResult`, `TrialMetrics` 等。

### Transcript & TrialMetrics

- `Transcript.entries` 是一个按时间顺序的数组，常见 `entry.type` 包括：
  - `output`：模型/Agent 的输出（turn 统计基于该类型）
  - `tool_call`：工具调用（toolCalls 统计基于该类型）
  - 其他类型以实现为准（例如 input/error 等）
- 每条 entry 可带 `entry.metadata`，用于记录 token 统计/计时等附加信息。
  - harness 会尝试从以下字段提取 token 计数并汇总到 `TrialMetrics.totalTokens`：
    - `metadata.totalTokens` / `metadata.tokens` / `metadata.tokenCount`
    - `metadata.usage.total_tokens`（兼容部分 LLM client 的 usage 结构）
- `TrialMetrics` 当前实现会至少包含：`turns`, `toolCalls`, `totalTokens`（若无 metadata 则为 0）。

### Error 记录

- trial 失败时，harness 会把异常序列化为对象（`message`, `name`, `stack`）。
- 若 transcript / 结果对外暴露，建议在上层做 redaction（例如去掉 `stack`）。

## 内置 Graders

### Deterministic（推荐优先使用）

- `regex`：输出文本正则匹配（`options.pattern/patterns`, `match:any|all`, `invert`, `minMatches`）
- `state_check`：检查 outcome（支持 `options.path` 与 subset match）
- `tool_calls`：校验 transcript 中的工具调用（required/forbidden/sequence/match）
- `transcript`：对 turns/tokens/latency 等做约束（其中 tokens 可来自 `TranscriptEntry.metadata`）

### Composite

- `composite`：把多个 grader 组合为一个评分器（组合语义以实现为准）

### Content / Back-compat

- `js/agents/eval/graders/content.js`:
  - `EvaluateStage`：旧接口兼容层
  - 默认导出：content grader（`js/agents/eval/index.js` 也 re-export 了 default）

### LLM-as-Judge（需要 llmClient）

需要在 `runTask/runSuite` 传入 `llmClient`（或在 `new EvalHarness({ llmClient })` 注入）。支持 `MockModelClient` 的 `.chat()` 形态。

- `llm_rubric`：基于 rubric 评分（`options.rubric`）
- `llm_assertion`：自然语言断言（`options.assertions`）

## Metrics（指标与聚合）

- `passAtK(trials, k)`：用经验 passRate 估计 `pass@k`（IID 假设）
- `passExpK(trials, k)`：用经验 passRate 估计 `pass^k`（IID 假设）
- `aggregateResults(...)`：聚合单任务/整套 suite 的统计结果（字段以实现为准）

## 入口导出

- `js/agents/eval/index.js` 导出：
  - `EvalHarness`
  - 所有 `types.js` 类型
  - graders registry 与 graders
  - metrics utilities
  - back-compat: `EvaluateStage` 与 content 默认导出
