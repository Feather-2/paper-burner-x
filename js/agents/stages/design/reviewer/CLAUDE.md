# reviewer (design) - 审核

设计阶段的自动审查模块，基于 DSL 统计与一致性规则生成问题清单、修复建议与评分；并支持可选的多页截图分析以补充视觉类检查。

## 模块描述

对生成后的整套幻灯片进行全局风格检查（颜色、字体、布局），输出评分与摘要，必要时提供修复建议并可批量应用编辑。审查主要基于 `deckHtmlDsl` 的样式与布局标记；在启用截图能力时，可通过 `screenshot-stitcher` 进行多页截图拼接与分析，用于发现仅靠 DSL 难以覆盖的视觉问题。

## 核心文件

| 文件 | 职责 |
|------|------|
| `auto-reviewer.js` | 审查上下文构建（DSL + 元数据 + 可选截图）、问题检测、评分与修复建议、`AutoReviewer` 类 |

## 审查流程

1. 解析输入 `DeckPackage`，构建 `ReviewContext`
2. 通过 `collectAllDsl` / `createDeckAnalyzer` 收集全局 DSL 统计
3. 可选执行 `screenshot-stitcher` 多页截图分析（失败时降级）
4. 产出 `ReviewIssue` 与 `ReviewFix`，并按严重度计算一致性分数
5. 生成 `AutoReviewResult`（`issues`、`fixes`、`score`、`summary`、`pass`、`status`）
6. 按需通过 `AutoReviewer.applyFixes()` 批量写回 `deckHtmlDsl`

## 关键概念

- `DeckPackage`：输入包，包含 `deckHtmlDsl` 与可选 `slidesMeta`
- `SlideMeta`：单页元信息（`index`、`title`、`layout`、`data`）
- `ReviewContext`：由 `deckHtmlDsl` 与 `slidesMeta` 构建，包含解析后的 `allDsl` 与运行时 `options`
- `ReviewIssue` / `ReviewFix`：问题与修复建议结构，`autoFixable` 标记是否可自动修复
- `REVIEW_CONFIG`：一致性阈值、评分扣分权重与状态评级阈值
- `ReviewOptions`：运行参数，支持 `signal` 取消、`config` 覆盖、直接阈值覆盖、`autoFixEnabled`、`scoring`/`thresholds`/`statusThresholds` 子配置
- `AutoReviewResult`：审查输出（`issues`、`fixes`、`score`、`summary`、`pass`、`status`）
- `DesignSystem`：设计系统输入，兼容从 `designTokens` 或 `tokens` 读取颜色与字体 token

## 配置覆盖说明

- 支持两层配置：全局 `config` 覆盖 + 顶层快捷覆盖字段
- 顶层字段（如 `maxColorVariants`、`minConsistencyScore`）用于快速覆写常用阈值
- `scoring`、`thresholds`、`statusThresholds` 用于细粒度评分与告警调优
- 建议在调用侧固定覆盖优先级，避免多源配置冲突

## 依赖与协作

- `deck-analyzer.collectAllDsl` / `createDeckAnalyzer`：从 `deckHtmlDsl` 解析 `allDsl`，供一致性检查与统计使用
- `deck-editor`：`AutoReviewer.applyFixes()` 中批量编辑 DSL
- `screenshot-stitcher`：在启用截图分析时负责多页截图拼接与特征抽取，异常时应降级为仅 DSL 检查

## 常见任务

```javascript
import { runAutoReview } from 'js/agents/stages/design/reviewer/auto-reviewer.js';

const result = await runAutoReview(deckPackage, designSystem, {
  maxColorVariants: 6,
  minConsistencyScore: 75,
  autoFixEnabled: true
});

console.log(result.summary, result.pass, result.issues);
```

```javascript
import { createAutoReviewer } from 'js/agents/stages/design/reviewer/auto-reviewer.js';

const reviewer = createAutoReviewer({
  config: {
    scoring: { errorPenalty: 12, warningPenalty: 5 },
    statusThresholds: { poor: 40, fair: 70, good: 85 }
  }
});

const review = await reviewer.review(deckPackage, designSystem, {
  thresholds: { topColorsToShow: 5 }
});
```

```javascript
import { createAutoReviewer } from 'js/agents/stages/design/reviewer/auto-reviewer.js';

const reviewer = createAutoReviewer();
const { fixes } = await reviewer.review(deckPackage, designSystem);
const { fixedDeckHtmlDsl } = await reviewer.applyFixes(deckPackage, fixes);
```