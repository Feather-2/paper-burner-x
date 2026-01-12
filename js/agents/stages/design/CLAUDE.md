# design - 设计阶段 (PPT/幻灯片生成)

AI 驱动的幻灯片设计和生成。

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | 模块入口 |
| `agent-loop.js` | DesignAgentLoop |
| `design-agent.js` | DesignStage, runDesignStage |
| `design-tools.js` | 设计工具定义 |
| `states.js` | 状态机定义 |
| `constants.js` | 常量 |

## 子目录

| 目录 | 职责 |
|------|------|
| `generators/` | 生成器（design-tokens, layout, image, svg, batch） |
| `dsl/` | 幻灯片 DSL 规则和构建器 |
| `refiner/` | QA 验证、React 精调 |
| `subagents/` | 子 Agent（SlideSubAgent, VisualSubAgent） |
| `edit-mode/` | 编辑模式 |
| `runtime/` | 运行时（deck-planner） |
| `shared/` | 共享工具 |
| `image/` | 图像处理 |
| `reviewer/` | 审核 |
| `banana/` | 实验性功能 |

## 状态机

```
DesignPhase: INIT → PLANNING → GENERATING → REFINING → COMPLETE
SlideStatus: PENDING → GENERATING → REVIEWING → APPROVED
VisualSlotStatus: EMPTY → GENERATING → FILLED → ERROR
```

## 使用示例

```javascript
import { DesignAgentLoop, runDesignStage } from 'js/agents/stages/design';

// 方式 1: Agent Loop
const agent = new DesignAgentLoop({ eventBus });
const deck = await agent.run({
  topic: '2024 年度报告',
  style: 'corporate',
  slideCount: 10,
});

// 方式 2: Stage API
const result = await runDesignStage(runContext, {
  outline: [...],
  assets: [...],
});
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
