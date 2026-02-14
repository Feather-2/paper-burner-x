# eval - Agent 评估框架

完整的 Agent evaluation harness：支持多次 trial、transcript 记录、确定性/LLM graders、统计指标（pass@k / pass^k）与结果聚合。

## 目录结构

```text
js/agents/eval/
├── index.js
├── types.js
├── graders/
│   ├── index.js
│   ├── deterministic.js
│   ├── llm-judge.js
│   ├── composite.js
│   └── content.js          # EvaluateStage (back-compat) + contentGrader (default)
├── harness.js
└── metrics.js
```

## 模块出口（index.js）

- Types: `export * from './types.js'`
- Graders: `export * from './graders/index.js'`
- Harness: `export { EvalHarness } from './harness.js'`
- Metrics: `export * from './metrics.js'`
- Back-compat:
  - `export { EvaluateStage } from './graders/content.js'`
  - `export { default } from './graders/content.js'`（根模块默认导出 contentGrader）

## 快速开始

### 1) 运行一个 task（多次 trial）

```js
import { EvalHarness } from 'js/agents/eval';

const harness = new EvalHarness({
  agentFactory: async ({ task, trialIndex }) => ({
    async run(input) {
      return `echo:${input}`;
    },
  }),
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
```

### 2) 运行 suite（并发）

```js
const suite = { suiteId: 'demo', tasks: [task] };
const suiteResult = await harness.runSuite(suite, { concurrency: 4 });
```

## 核心数据结构（JSDoc）

- `js/agents/eval/types.js`: `EvalTask`, `EvalSuite`, `Trial`, `Transcript`, `TranscriptEntry`, `GraderConfig`, `GraderResult`, `TaskResult`, `EvalSuiteResult`, `TrialMetrics` 等。

## Transcript & TrialMetrics

- `Transcript.entries` 是按时间顺序的数组，常见 `entry.type` 包括：
  - `output`：模型/Agent 的输出（turn 统计基于该类型）
  - `tool_call`：工具调用（toolCalls 统计基于该类型）
  - 其他类型以实现为准（例如 input/error）
- `computeTrialMetrics(transcript)` 的统计口径：
  - `turns`：`entry.type === 'output'` 的数量
  - `toolCalls`：`entry.type === 'tool_call'` 的数量
  - `totalTokens`：从 `entry.metadata.totalTokens | tokens | tokenCount | usage.total_tokens` 聚合

## 指标计算（metrics.js）

- `passAtK(trials, k)`：基于经验 `passRate` 估计「k 次中至少一次成功」概率。
- `passExpK(trials, k)`：基于经验 `passRate` 估计「k 次全部成功」概率。
- `aggregateResults(taskResults)`：聚合 suite 级统计指标。
- 概率结果通过 `clamp01` 归一化到 `[0, 1]`。