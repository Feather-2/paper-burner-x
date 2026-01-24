# design - 设计阶段 (PPT/幻灯片生成)

AI 驱动的幻灯片设计和生成。

> **文件统计**: 58 个 JS 文件

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | 模块入口 |
| `agent-loop.js` | DesignAgentLoop（主编排器：阶段推进、并发、暂停/恢复、回滚；支持 DI 容器注入） |
| `design-agent.js` | DesignStage, runDesignStage |
| `edit-agent-loop.js` | EditAgentLoop（交互编辑主循环） |
| `model.js` | 设计阶段模型调用封装（路由/超时） |
| `design-tools.js` | 设计工具定义（tool definitions） |
| `design-helpers.js` | 设计阶段辅助：trace 上下文、错误边界、并发配置加载、回滚错误等 |
| `states.js` | 状态机定义 |
| `constants.js` | 常量与枚举（ImageTaskStatus/RenderType/VisualType 等，含 JSDoc typedef） |

## 关键内部模块

| 文件 | 职责 |
|------|------|
| `internal/phases/index.js` | 阶段编排入口（preparation/planning/layout/generating/visual/review 等） |
| `internal/state-manager.js` | Loop 状态持久化、暂停/恢复（resume）与 schema 版本管理（含 `SCHEMA_VERSION` 概念） |
| `internal/deck-operations.js` | Deck 读写与增量更新发射、最终收敛（finalize）、watchdog/超时管理；按 `imageConcurrency` 控制图像相关并发 |
| `internal/tool-handler.js` | Tooling 初始化与工具调用处理 |
| `internal/design-blackboard.js` | 设计黑板/共享上下文（跨阶段共享） |
| `internal/design-loop-types.js` | DesignLoop 公共类型定义（JSDoc typedef） |

## 子目录

| 目录 | 职责 |
|------|------|
| `generators/` | 生成器（design-tokens, layout, image, svg, batch） |
| `dsl/` | 幻灯片 DSL 规则和构建器 |
| `refiner/` | QA 验证、React 精调 |
| `subagents/` | 子 Agent（SlideSubAgent, VisualSubAgent） |
| `edit-mode/` | 编辑模式 |
| `internal/` | 内部运行时（phase runtime / deck-ops / state-manager / tooling） |
| `shared/` | 共享工具 |
| `image/` | 图像处理（image-planner 等） |
| `reviewer/` | 审核 |
| `banana/` | 实验性功能 |

## 状态机

主流程以 `internal/phases/` 为准，概念流程通常为：

```
Design flow: preparation → planning → layout → generating → visual → review → complete
(必要时: batch-repair / backtrack / pause)

SlideStatus: PENDING → GENERATING → REVIEWING → APPROVED
VisualSlotStatus: EMPTY → GENERATING → FILLED → ERROR
ImageTaskStatus: PENDING → RUNNING → SUCCESS / FAILED / SKIPPED
```

## 并发与配置

`DesignAgentLoop` 支持并发配置（默认值来自 `DESIGN_LOOP_DEFAULTS`，可被 `loadDesignConcurrencyConfig()` 覆盖）：

- `batchSize`: 每批处理的 slide 数量（最小 1）
- `batchConcurrency`: 批处理并发（最小 1）
- `imageConcurrency`: 图片生成并发（最小 1）

实现要点（以 `agent-loop.js` 为准）：

- `batchSize` 优先使用构造参数，其次回退到配置/默认值
- `batchConcurrency`、`imageConcurrency` 当前由配置/默认值决定
- `DeckOperations` 初始化时会显式接收 `{ imageConcurrency }`

建议（Browser-first）：

- 为并发与批大小设置“合理上限”（避免配置被误设导致卡死/资源耗尽）
- 将并发参数限制为有限整数（避免 `Infinity`/小数等异常值）

## 构造参数与 DI

`DesignAgentLoop` 构造参数（见 `internal/design-loop-types.js` 的 `DesignLoopConstructorOptions`）：

- `eventBus`: 事件总线
- `tools`: 工具集合（供 tooling 初始化）
- `memoryStore` / `stateEngine`: 状态持久化与运行时依赖
- `container`: 可选 DI 容器（用于注入/复用运行时服务；不建议直接暴露给不可信 UI 输入）

## 错误与回滚

- 回滚/回溯相关错误类型通过 `BacktrackError` 暴露（来源：`design-helpers.js`）
- 设计阶段应避免吞掉异常：要么向上传播，要么记录后重新抛出
