# reviewer (design) - 审核

设计阶段的自动审查模块，基于 DSL 统计与一致性规则生成问题清单、修复建议与评分。

## 模块描述

对生成后的整套幻灯片进行全局风格检查（颜色、字体、布局），输出评分与摘要，必要时提供修复建议并可批量应用编辑。当前审查基于 deckHtmlDsl 的样式/布局标记；截图分析接口已预留但未接入主流程。

## 核心文件

| 文件 | 职责 |
|------|------|
| `auto-reviewer.js` | 审查上下文构建、问题检测、评分与修复建议、AutoReviewer 类 |

## 关键概念

- `ReviewContext`: 由 `deckHtmlDsl` + `slidesMeta` 构建，包含解析后的 `allDsl` 与运行时 `options`
- `ReviewIssue`/`ReviewFix`: 问题与修复建议结构，是否可自动修复由 `autoFixable` 决定
- `REVIEW_CONFIG`: 一致性阈值、评分扣分权重与状态评级（`statusThresholds`）
- 一致性评分: 基于问题严重度扣分，低于 `minConsistencyScore` 判定为不通过
- `AutoReviewResult`: `issues`、`fixes`、`score`、`summary`、`pass` 等审查输出

## 依赖与协作

- `deck-analyzer.collectAllDsl`: 从 `deckHtmlDsl` 解析 `allDsl` 供一致性检查
- `deck-editor`: `AutoReviewer.applyFixes()` 中批量编辑 DSL
- `screenshot-stitcher`: 预留用于多页截图分析（当前未接入 `runAutoReview`）

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
