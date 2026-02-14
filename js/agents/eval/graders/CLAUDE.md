# graders (eval) - 评分器实现

EvalHarness 的评分器实现集合，涵盖确定性规则、LLM-as-judge、组合聚合与内容质量评估（EvaluateStage 兼容）。

## 模块描述

- 将 trial 的 output/state/transcript 转换为统一的 `GraderResult`
- 通过 `GraderRegistry` 管理与查找 grader，实现可扩展的评分体系
- 默认注册表加载 deterministic、content、LLM judge、composite 四类 grader

## 核心文件

- `index.js`: `GraderRegistry`、默认 registry、导出入口
- `deterministic.js`: `regex`/`state_check`/`tool_calls`/`transcript` 等确定性检查（`regex` 使用 `createSafeRegex`）
- `llm-judge.js`: `llm_rubric`/`llm_assertion`/`llm_pairwise` 与 JSON 解析/客户端适配
- `composite.js`: `all_pass`/`weighted`/`threshold` 聚合多个 `GraderResult`
- `content.js`: EvaluateStage 与 `content` grader（内置 completeness/accuracy/clarity/relevance，支持维度配置与自定义评估器）

## 关键概念

- **Grader 合约**：`{ type, grade }`，返回 `GraderResult { graderType, passed, score, reason, issues }`
- **输入类型**：确定性 grader 主要接收 output/transcript；composite 接收 `GraderResult[]`
- **LLM-as-judge**：需提供 `llmClient`，默认要求返回严格 JSON；建议优先 deterministic
- **Pairwise 对比**：`llm_pairwise` 需要 `options.outputB/baseline/compareTo`
- **Composite 子集过滤**：`options.types` 支持 `string | string[]`，内部统一转为数组后按 `graderType` 过滤
- **All-pass 语义**：
  - 有可评结果：`passed = every(r.passed)`，`score = min(r.score)`（非有限值按 `0`）
  - 无可评结果：`passed = true`，`score = 1`
- **Threshold 聚合**：`options.threshold` 默认 `0.6`；`options.use` 支持 `avg|min|max`
- **Content 评估类型**：
  - `EvaluationInput`: `{ content, original?, context? }`
  - `EvaluationIssue`: `{ type, severity, message, location? }`
  - `Evaluator`: 单维度评估器（sync/async），返回 `{ score, issues? }`
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

### 3) 配置 composite 子集过滤

```js
const task = {
  graders: [{ type: "all_pass", options: { types: ["regex", "state_check"] } }],
};
```

### 4) 使用 content grader

```js
const task = {
  graders: [
    {
      type: "content",
      options: { strict: false, dimensions: ["completeness", "accuracy"] },
    },
  ],
};
```

## 设计约束

- deterministic grader 保持纯函数与可复现，避免隐式外部依赖
- composite grader 聚合前建议由调用方完成输入合法性校验
- `score` 约定范围为 `0..1`，跨 grader 聚合前建议归一化
- LLM judge 适用于开放式评价，确定性规则优先用于回归与门禁
