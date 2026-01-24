# design - 设计阶段 (PPT/幻灯片生成)

AI 驱动的幻灯片设计和生成。

> **文件统计**: 58 个 JS 文件

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | 模块入口 |
| `agent-loop.js` | DesignAgentLoop（主编排器：阶段推进、并发、暂停/恢复、回滚） |
| `design-agent.js` | DesignStage, runDesignStage |
| `edit-agent-loop.js` | EditAgentLoop（交互编辑主循环） |
| `model.js` | 设计阶段模型调用封装（路由/超时） |
| `design-tools.js` | 设计工具定义（tool definitions） |
| `design-helpers.js` | 设计阶段辅助：trace 上下文、错误边界、并发配置、回滚错误等 |
| `states.js` | 状态机定义 |
| `constants.js` | 常量与枚举（ImageTaskStatus/RenderType/VisualType 等） |

## 关键内部模块

| 文件 | 职责 |
|------|------|
| `internal/phases/index.js` | 阶段编排入口（preparation/planning/layout/generating/visual/review 等） |
| `internal/state-manager.js` | Loop 状态持久化、暂停/恢复（resume）与 schema 版本管理 |
| `internal/deck-operations.js` | Deck 读写与增量更新发射、最终收敛（finalize）、watchdog/超时管理 |
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

建议在浏览器环境下为这些参数设置合理上限，避免 UI 卡死或触发 API 限流。

## 暂停/恢复与回滚

- 暂停：通过 `StagePausedError` 作为控制流信号返回上层。
- 恢复：`internal/state-manager.js` 提供 `resumeDesignAgentLoop` 相关能力。
- 回滚：`BacktrackError` 用于触发回滚/重试策略（对外导出，供调用方区分错误类型）。
- 状态 schema：`SCHEMA_VERSION` 用于持久化状态的版本标识，变更需同步迁移策略与测试。

## 使用示例

```javascript
import {
  DesignAgentLoop,
  runDesignStage,
  BacktrackError,
  DESIGN_AGENT_TOOL_DEFINITIONS,
} from 'js/agents/stages/design';

// 方式 1: Agent Loop
const agent = new DesignAgentLoop({ eventBus, batchSize: 5 });
try {
  const deck = await agent.run({
    topic: '2024 年度报告',
    style: 'corporate',
    slideCount: 10,
  });
} catch (err) {
  if (err instanceof BacktrackError) {
    // 可选：提示用户重试或执行回滚后的恢复逻辑
  }
  throw err;
}

// 方式 2: Stage API
const result = await runDesignStage(runContext, {
  outline: [...],
  assets: [...],
});

// 工具定义（用于宿主侧安装/展示工具能力）
console.log(DESIGN_AGENT_TOOL_DEFINITIONS);
```

## 生成器

```javascript
import { generateDesignTokens, ImageGenerator, SVGGenerator } from 'js/agents/stages/design';

// 设计令牌
const tokens = generateDesignTokens({ theme: 'dark', accent: '#007AFF' });

// 图像填充
const imageGen = new ImageGenerator(llmProvider);
await imageGen.fillImagePlaceholders(slides);

// SVG 生成
const svgGen = new SVGGenerator();
await svgGen.fillSvgPlaceholders(slides);
```
