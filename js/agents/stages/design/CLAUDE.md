# design - 设计阶段 (PPT/幻灯片生成)

AI 驱动的幻灯片设计和生成阶段，负责从输入需求到可审阅 deck 的全流程编排。

> **文件统计**: 58 个 JS 文件

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | 模块入口 |
| `agent-loop.js` | `DesignAgentLoop` 主编排器：阶段推进、并发、暂停/恢复、回滚、生命周期事件发射、EventBus 背压适配、DI 注入 |
| `design-agent.js` | `DesignStage` 轻量封装与 `runDesignStage` 适配入口 |
| `edit-agent-loop.js` | `EditAgentLoop`（交互编辑主循环） |
| `model.js` | 设计阶段模型调用封装（路由/超时） |
| `design-tools.js` | 设计工具定义（tool definitions） |
| `design-helpers.js` | 设计辅助：trace 上下文、错误边界、并发配置加载、回滚错误等 |
| `states.js` | 状态机定义 |
| `constants.js` | 常量与枚举（`ImageTaskStatus` / `RenderType` / `VisualType` 等，含 JSDoc typedef） |

## 关键内部模块

| 文件 | 职责 |
|------|------|
| `internal/phases/index.js` | 阶段编排入口（preparation / planning / layout / generating / visual / review / batch-repair） |
| `internal/state-manager.js` | Loop 状态持久化、暂停/恢复（resume）与 schema 版本兼容 |
| `internal/deck-operations.js` | Deck 读写、增量更新发射、最终收敛（finalize）、watchdog/超时管理；按 `imageConcurrency` 控制图像相关并发 |
| `internal/tool-handler.js` | Tooling 初始化与工具调用处理 |
| `internal/design-blackboard.js` | 设计黑板与跨阶段共享上下文 |
| `internal/design-loop-types.js` | DesignLoop 公共类型定义（JSDoc typedef） |

## 子目录

| 目录 | 职责 |
|------|------|
| `generators/` | 生成器（design-tokens、layout、image、svg、batch） |
| `dsl/` | 幻灯片 DSL 规则与构建器 |
| `refiner/` | QA 验证与精调 |
| `subagents/` | 子 Agent（SlideSubAgent、VisualSubAgent） |
| `edit-mode/` | 编辑模式 |
| `internal/` | 内部运行时（phase runtime / deck-ops / state-manager / tooling） |
| `shared/` | 共享工具 |
| `image/` | 图像处理（image-planner 等） |
| `reviewer/` | 审核 |
| `banana/` | 实验性功能 |

## 状态机

主流程以 `internal/phases/` 为准，概念流程通常为：

```text
Design flow: preparation → planning → layout → generating → visual → review → complete
(必要时: batch-repair / backtrack / pause)

SlideStatus: PENDING → GENERATING → REVIEWING → APPROVED
VisualSlotStatus: EMPTY → GENERATING → FILLED → ERROR
ImageTaskStatus: PENDING → RUNNING → SUCCESS / FAILED / SKIPPED
```

## 事件与背压

`DesignAgentLoop` 支持面向 EventBus 的背压能力适配：

- `EventBusBackpressureConfig`：`coalescePattern`、`deferNonCoalesced`、`maxQueueSize`
- `BackpressureCapableEventBus`：可选 `enableBackpressure()` 与 `_backpressure` 状态
- 生命周期事件通过 `createLifecycleEmitter` / `getEmitFn` 统一发射路径

## 并发与超时

`DesignAgentLoop` 支持并发配置（默认值来自 `DESIGN_LOOP_DEFAULTS`，可被 `loadDesignConcurrencyConfig()` 覆盖）：

- `batchSize`：每批处理的 slide 数量（最小 1）
- `imageConcurrency`：图像/视觉任务并发上限
- 其它并发参数以 `DESIGN_LOOP_DEFAULTS` 为准

超时控制由 `internal/deck-operations.js` 的 watchdog 相关逻辑统一管理，避免长任务阻塞。

## 错误处理与回滚

- `BacktrackError`：用于阶段回滚控制信号
- `resolveErrorBoundary()`：统一错误边界策略
- `finalizeDeck()`：结束阶段最终一致性收敛
- `resumeDesignAgentLoop`：中断恢复时保障状态连续性

## 对外 API

- `DesignAgentLoop`：设计阶段主循环
- `DesignStage`：继承式封装，便于被上层编排器注册
- `DESIGN_AGENT_TOOL_DEFINITIONS`：设计阶段工具定义导出

## 维护约定

- 调整阶段顺序时，同步更新 `internal/phases/index.js` 与本文件状态机描述
- 调整并发策略时，同步更新 `DESIGN_LOOP_DEFAULTS` 与 `loadDesignConcurrencyConfig()` 文档
- 新增状态/枚举时，优先在 `constants.js` 补充 typedef 与只读导出
- 涉及暂停/恢复与回滚路径改动时，必须补充对应异常恢复测试