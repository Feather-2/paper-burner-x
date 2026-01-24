# examples - SDK 示例

用于演示 SDK 的核心能力：capability 注册（useCapability）、事件/Hook、子代理、记忆/Recall、回溯/Backtrack，以及韧性编排流程。

> **文件统计**: 5 个 JS 文件

## 模块描述

- 面向开发者的可运行示例脚本，展示 SDK 的典型用法与行为
- 覆盖 useCapability（简写 handler / definition+handler）、event/hook、subagent、memory/recall、backtrack 与冲突校验流程
- 适合作为测试样例或学习入口（示例中包含调试型日志，生产环境请按需删减/脱敏）

## 核心文件

| 文件 | 职责 |
|------|------|
| `basic-usage.js` | useCapability 用法：最小 handler 注册 + definition/activation（keywords）注册；事件订阅；Hook 审计示例 |
| `subagent-usage.js` | 子代理注册与 Task 工具调用流程示例 |
| `memory-recall.js` | 记忆归档与 Recall 工具的 list/search/get 演示 |
| `backtrack-usage.js` | Backtrack 回溯示例：构造 checkpoint、调用 Backtrack 并读取 checkpointId/state/hint；可输出 skill catalog prompt 便于调试 |
| `webarranger-resilience.js` | WebArranger 韧性流程与冲突判定示例 |

## 关键概念

- `createAgent(...).useCapability(...).build()`：流式构建能力与执行入口
- `useCapability(name, handler)`：以最小 handler 形式注册 capability
- `useCapability(name, { definition, handler })`：以 definition + handler 形式注册 capability（可包含 `activation.keywords` 等元信息）
- `onEvent('domain:action'|pattern)`：订阅事件并观察运行轨迹
- `useHook('before'|'after')`：拦截工具调用、跳过执行或丰富结果（常用于审计/记录）
- `useSubagent` + `Task`：注册子代理并由主代理分派任务
- `useCicada` + `Recall`：记忆归档与检索（list/search/get）
- `useBacktrack` + `Backtrack`：回溯到历史 checkpoint，并保留提示信息（如 `hint`）
- `agent.getSkillCatalogPrompt()`：输出技能目录 Prompt（调试用途，生产环境慎用/避免输出）
- `agent.toolExecutor(toolName, args, ctx)`：在示例/测试场景中模拟模型调用工具（如 `Backtrack`）
- `DiscoveryStatus`/cross-verify：用于冲突检测与语义核验的韧性流程

## 常见任务

- 运行基础示例：`node js/agents/sdk/examples/basic-usage.js`
- 运行子代理示例：`node js/agents/sdk/examples/subagent-usage.js`
- 运行记忆回想示例：`node js/agents/sdk/examples/memory-recall.js`
- 运行回溯示例：`node js/agents/sdk/examples/backtrack-usage.js`
- 运行韧性编排示例：`node js/agents/sdk/examples/webarranger-resilience.js`
