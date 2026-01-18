# examples - SDK 示例

用于演示 SDK 的核心能力：能力注册、事件/Hook、子代理、记忆/回溯，以及韧性编排流程。

> **文件统计**: 5 个 JS 文件

## 模块描述

- 面向开发者的可运行示例脚本，展示 SDK 的典型用法与行为
- 覆盖 capability、event/hook、subagent、memory/recall、backtrack 与冲突校验流程
- 适合作为测试样例或学习入口

## 核心文件

| 文件 | 职责 |
|------|------|
| `basic-usage.js` | 基础构建：能力注册、事件订阅、Hook、懒加载 capability 与运行示例 |
| `subagent-usage.js` | 子代理注册与 Task 工具调用流程示例 |
| `memory-recall.js` | 记忆归档与 Recall 工具的 list/search/get 演示 |
| `backtrack-usage.js` | Backtrack 回溯工具 + Recall 的时间线切换示例 |
| `webarranger-resilience.js` | WebArranger 韧性流程与冲突判定示例 |

## 关键概念

- `createAgent(...).useCapability(...).build()`：流式构建能力与执行入口
- `onEvent('domain:action'|pattern)`：订阅事件并观察运行轨迹
- `useHook('before'|'after')`：拦截工具调用、跳过执行或丰富结果
- `useSubagent` + `Task`：注册子代理并由主代理分派任务
- `useCicada` + `Recall`：记忆归档与检索（list/search/get）
- `useBacktrack` + `Backtrack`：回溯到历史 checkpoint，并保留提示信息
- `DiscoveryStatus`/cross-verify：用于冲突检测与语义核验的韧性流程

## 常见任务

- 运行基础示例：`node js/agents/sdk/examples/basic-usage.js`
- 运行子代理示例：`node js/agents/sdk/examples/subagent-usage.js`
- 运行记忆回想示例：`node js/agents/sdk/examples/memory-recall.js`
- 运行回溯示例：`node js/agents/sdk/examples/backtrack-usage.js`
- 运行韧性编排示例：`node js/agents/sdk/examples/webarranger-resilience.js`
