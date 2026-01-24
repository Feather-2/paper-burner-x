# dsl (design) - 幻灯片 DSL

幻灯片定义语言和构建器，负责将 slideIntent 或 Layout JSON 转换为 HTML DSL（供 SlideParser.parse() 解析）。构建过程中会对文本做 escape，对部分样式/属性值做白名单化 sanitize，以降低注入风险。

## 核心文件

| 文件 | 职责 |
|------|------|
| `dsl-builder.js` | buildSlideHtml / buildFromLayoutJson - 生成 HTML DSL（文本 escape + 属性/样式值 sanitize） |
| `dsl-rules.js` | DSL 规则动态加载与缓存（getDslRules / initDslRules / getDslRulesSync；读取失败会使用 fallback） |

## SlideIntent 结构 (buildSlideHtml)

```javascript
const slideIntent = {
  slideIntentId: 1,
  pageType: 'overview',
  title: '市场分析',
  content: { markdown: '- 2024 年市场增长 15%\n- 主要驱动因素...' },
  keyPoints: ['增长 15%', '驱动因素 A'],
  objective: '概览市场趋势',
  claimIds: ['c-1', 'c-2'],
};
```

## buildSlideHtml 调用与选项

支持两种调用形式：
1) buildSlideHtml(slideIntent, designSystem, contentPackage, options)
2) buildSlideHtml(slideIntent, designSystem, claims, evidences, options)

options 字段：
- safeMode: boolean - 强制 safe 布局（layout 固定为 safe）
- slideNo: number - 生成 slide id（如 slide-3）
- imageSlotsForSlide: 图片占位槽数组，生成 `data-el='image-placeholder'` 元素（slotId, aspectRatio?, purpose?）

## Layout JSON 结构 (buildFromLayoutJson)

```javascript
const layoutJson = {
  suggestedLayout: 'comparison',
  extractedPalette: ['#0ea5e9', '#22c55e'],
  elements: [
    { type: 'text', content: '市场分析', bounds: { x: 8, y: 8, w: 84, h: 10 }, style: { fontSize: 32, color: '#0f172a' } },
    { type: 'image', content: 'https://example.com/chart.png', bounds: { x: 10, y: 30, w: 30, h: 40 } },
  ],
};
```

支持元素类型：text / shape / image / table / chart（chartType: bar|line|pie|doughnut|area|scatter|radar）。

### 坐标与样式值 sanitize 约定

- bounds.x/y/w/h: 允许 number 或 string；内部会规范化为百分比字符串（如 10 -> '10%'），非法值会回退到默认值。
- style.color: 允许 hex / rgb(a) / hsl(a) / 颜色名；非法值会回退到默认值。
- 其他可能进入 HTML attribute 的字段建议上游做白名单校验（尤其是 URL 类字段）。

## buildFromLayoutJson 选项

options: { slideId?, title?, safeMode? }，safeMode 为 true 或 elements 为空时返回 safe layout。

## DSL Rules 加载 (dsl-rules)

- 推荐：`await getDslRules()`（内部缓存；读取失败会降级为最小 fallback，并记录 warn）
- 预初始化：`await initDslRules()`（等价于 getDslRules）
- 同步读取：`getDslRulesSync()`（需先 init；未初始化返回 null）

```javascript
import {
  buildSlideHtml,
  buildFromLayoutJson,
  getDslRules,
  initDslRules,
  getDslRulesSync
} from 'js/agents/stages/design/dsl';

await initDslRules();
const rules = getDslRulesSync() ?? (await getDslRules());

const htmlFromIntent = buildSlideHtml(
  slideIntent,
  designSystem,
  { claims: [...], evidenceLedger: [...] },
  { safeMode: true, slideNo: 1 }
);

const htmlFromLayout = buildFromLayoutJson(
  layoutJson,
  designSystem,
  { slideId: 'slide-1', title: '市场分析', safeMode: false }
);
```
