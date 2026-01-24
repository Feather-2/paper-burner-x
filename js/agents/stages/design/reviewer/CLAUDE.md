# reviewer (design) - 审核

设计阶段的自动审查模块，基于 DSL 统计与一致性规则生成问题清单、修复建议与评分；并支持可选的多页截图分析以补充视觉类检查。

## 模块描述

对生成后的整套幻灯片进行全局风格检查（颜色、字体、布局），输出评分与摘要，必要时提供修复建议并可批量应用编辑。审查主要基于 `deckHtmlDsl` 的样式/布局标记；在启用截图能力时，可通过 `screenshot-stitcher` 进行多页截图拼接/分析，用于发现仅靠 DSL 难以覆盖的视觉问题。

## 核心文件

| 文件 | 职责 |
|------|------|
| `auto-reviewer.js` | 审查上下文构建（DSL + 元数据 + 可选截图）、问题检测、评分与修复建议、AutoReviewer 类 |

## 关键概念

- `DeckPackage`: 输入包，包含 `deckHtmlDsl` 与可选 `slidesMeta`
- `SlideMeta`: 单页元信息（index/title/layout 等），用于将问题/修复精确定位到页面
- `ReviewContext`: 由 `deckHtmlDsl` + `slidesMeta` 构建，包含解析后的 `allDsl` 与运行时 `options`
- `ReviewIssue`/`ReviewFix`: 问题与修复建议结构，是否可自动修复由 `autoFixable` 决定
- `REVIEW_CONFIG`: 一致性阈值、评分扣分权重与状态评级（`statusThresholds`）
- 一致性评分: 基于问题严重度扣分，低于 `minConsistencyScore` 判定为不通过
- `ReviewOptions`: 审查运行参数（支持 `signal` 取消；并允许覆盖部分阈值如 `maxColorVariants`）
- `AutoReviewResult`: `issues`、`fixes`、`score`、`summary`、`pass` 等审查输出
- `DesignSystem`: 设计系统输入，兼容从 `designTokens` 或 `tokens` 读取颜色/字体等 token

## 依赖与协作

- `deck-analyzer.collectAllDsl` / `createDeckAnalyzer`: 从 `deckHtmlDsl` 解析 `allDsl`，供一致性检查与统计使用
- `deck-editor`: `AutoReviewer.applyFixes()` 中批量编辑 DSL
- `screenshot-stitcher`: 在启用截图分析时，负责多页截图拼接与特征抽取（实现不可用时应降级为仅 DSL 检查）

## 常见任务

```javascript
import { runAutoReview } from 'js/agents/stages/design/reviewer/auto-reviewer.js';

const result = await runAutoReview(deckPackage, designSystem);
console.log(result.summary, result.pass, result.issues);
```

```javascript
import { createAutoReviewer } from 'js/agents/stages/design/reviewer/auto-reviewer.js';

const reviewer = createAutoReviewer({ config: { maxColorVariants: 6 } });
const review = await reviewer.review(deckPackage, designSystem);
```

```javascript
import { createAutoReviewer } from 'js/agents/stages/design/reviewer/auto-reviewer.js';

const reviewer = createAutoReviewer();
const { fixes } = await reviewer.review(deckPackage, designSystem);
const { fixedDeckHtmlDsl } = await reviewer.applyFixes(deckPackage, fixes);
```
