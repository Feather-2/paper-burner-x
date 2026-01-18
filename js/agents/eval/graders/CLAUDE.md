# graders (eval) - 评分器实现

EvalHarness 的评分器实现集合，涵盖确定性规则、LLM-as-judge、组合聚合与内容质量评估（EvaluateStage 兼容）。

## 模块描述

- 将 trial 的输出/状态/transcript 转换为统一的 `GraderResult`
- 通过 `GraderRegistry` 管理与查找 grader，实现可扩展的评分体系
- 默认注册表一次性加载 deterministic、content、LLM judge、composite 四类 grader

## 核心文件

- `index.js`: GraderRegistry、默认 registry、全部导出入口
- `deterministic.js`: `regex`/`state_check`/`tool_calls`/`transcript` 等确定性检查
- `llm-judge.js`: `llm_rubric`/`llm_assertion`/`llm_pairwise` 与 JSON 解析/客户端适配
- `composite.js`: `all_pass`/`weighted`/`threshold` 聚合多个 `GraderResult`（支持按 `types` 子集过滤）
- `content.js`: EvaluateStage 与 `content` grader（内置 completeness/accuracy/clarity/relevance，支持维度配置）

## 关键概念

- **Grader 合约**：`{ type, grade }`，返回 `GraderResult { passed, score, reason, issues }`
- **输入类型**：确定性 grader 多接收 output 或 transcript；composite 接收 `GraderResult[]`
- **LLM-as-judge**：需提供 `llmClient`，默认要求返回严格 JSON；优先使用 deterministic
- **Pairwise 对比**：`llm_pairwise` 需要 `options.outputB/baseline/compareTo`
- **Composite 子集**：`all_pass`/`weighted`/`threshold` 支持 `options.types` 过滤指定 graderType
- **Threshold 聚合**：`options.threshold` 默认 0.6；`options.use` 支持 `avg|min|max`
- **EvaluateStage 配置**：`stage` 支持 `strict`/`dimensions`/`dimensionConfig` 控制维度与阈值
- **自定义评估器**：`registerEvaluator/unregisterEvaluator` 扩展维度，并通过 `dimensionConfig` 注入权重/参数

## 常见任务

### 1) 使用默认 registry

```js
import { defaultGraderRegistry } from "js/agents/eval/graders";

defaultGraderRegistry.listTypes();
```

### 2) 配置 deterministic grader

```js
const task = {
  graders: [{ type: "regex", options: { pattern: "^ok$" } }],
};
```

### 3) 使用 LLM-as-judge

```js
const task = {
  graders: [{ type: "llm_rubric", options: { rubric: "必须回答且准确" } }],
};
// runTask/runSuite 需传入 llmClient
```

### 4) 聚合评分（weighted + types 子集）

```js
const task = {
  graders: [
    { type: "regex", options: { pattern: "pass" } },
    { type: "weighted", options: { weights: { regex: 1 }, types: ["regex"] } },
  ],
};
```

### 5) 使用 content grader（EvaluateStage 兼容）

```js
const task = {
  graders: [
    {
      type: "content",
      options: {
        stage: {
          passThreshold: 0.7,
          strict: true,
          dimensions: ["completeness", "accuracy"],
        },
      },
    },
  ],
};
```

### 6) 使用 threshold 聚合

```js
const task = {
  graders: [
    { type: "regex", options: { pattern: "pass" } },
    { type: "threshold", options: { threshold: 0.7, use: "min", types: ["regex"] } },
  ],
};
```
