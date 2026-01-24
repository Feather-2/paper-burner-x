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

## Transcript & TrialMetrics

- `Transcript.entries` 是一个按时间顺序的数组，常见 `entry.type` 包括：
  - `output`：模型/Agent 的输出（turn 统计基于该类型）
  - `tool_call`：工具调用（toolCalls 统计基于该类型）
  - 其他类型以实现为准（例如 input/error 等）
- 每条 entry 可带 `entry.metadata`，用于记录 token 统计/计时等附加信息。
  - harness 会尝试从以下字段提取 token 计数并汇总到 `TrialMetrics.totalTokens`：
    - `metadata.totalTokens` / `metadata.tokens` / `metadata.tokenCount`
    - `metadata.usage.total_tokens`（兼容部分 LLM client 的 usage 结构）
- `TrialMetrics` 当前实现会至少包含：`turns`, `toolCalls`, `totalTokens`（若无 metadata 则为 0）。

## Metrics（pass@k / pass^k）

- `passAtK(trials, k)`: 经验 passRate 估计下的 `pass@k = 1 - (1 - passRate)^k`
- `passExpK(trials, k)`: 经验 passRate 估计下的 `pass^k = (passRate)^k`（语义：k 次全部成功）

## Error 记录

- trial 执行/grader 过程中抛出的异常会被 harness 记录并序列化为 plain object，便于存档与 JSON 序列化。
- 当前序列化字段：
  - `message`: 错误消息
  - `name`: 错误类型（若可用）
  - `stack`: 堆栈（若可用）
- 如果评估结果会被展示给终端用户或写入外部系统，建议在输出层对 `stack` 做剥离或脱敏，避免泄露内部路径/实现细节。
