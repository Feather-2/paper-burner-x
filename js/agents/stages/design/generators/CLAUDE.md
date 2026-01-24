# generators (design) - 生成器

幻灯片内容与视觉资产生成。

## 核心文件

| 文件 | 职责 |
|------|------|
| `design-tokens.js` | 设计令牌生成/校验 |
| `design-system-generator.js` | DesignSystem 生成与 overrides 合并 |
| `layout-generator.js` | 布局原型 HTML 生成 |
| `layout-protocol.js` | 布局类型/区域协议 |
| `image-generator.js` | ImageGenerator - 图像生成/填充 |
| `svg-generator.js` | SVGGenerator - SVG 生成/填充 |
| `batch-generator.js` | 批量生成（system prompt 外置加载/缓存） |

## 设计令牌

```javascript
import { generateDesignTokens } from 'js/agents/stages/design/generators';

const { theme, designTokens } = generateDesignTokens({
  theme: 'dark',
  fontFamily: 'Inter',
  safeMarginPct: 8,
});
// → { theme, visualPreference, designTokens: { colors, typography, spacing, grid, visualPreference } }
```

## 设计系统

```javascript
import { generateDesignSystem } from 'js/agents/stages/design/generators/design-system-generator.js';

const system = await generateDesignSystem(
  {
    contentSummary: '...',
    tone: 'calm',
    userPreferences: { designSystemOverrides: { typography: { lineHeight: 1.3 } } },
  },
  { modelRouter, aiApiService, constraints: { safeMarginPct: 8 } }
);
// → validated DesignSystem + legacy designTokens sync
```

说明：
- `designSystemOverrides` 使用深度合并（overrides 优先），并过滤 `__proto__`/`prototype`/`constructor` 键以避免原型污染。
- `visualPreference` 支持 string（如 `'dark'`）或对象（如 `{ mode: 'dark' }`），内部会将 `mode` 规范化为小写。

## 批量生成

- system prompt 通过 `loadPrompt('design/batch-generator-system')` 外置加载；加载失败时回退到内置 fallback。
- prompt 结果会缓存，避免重复加载。
- 模型输出为 JSON 数组（形如 `[{ slideIntentId, slideHtml }]`）；在进入 HTML/DSL 拼装与渲染前，务必对结构与长度做校验，并对可渲染 HTML 做安全处理（避免 XSS）。

## 布局协议

```javascript
import { resolveLayoutType, getRegion, regionToDslAttrs } from 'js/agents/stages/design/generators/layout-protocol.js';

const layout = resolveLayoutType('agenda');
const region = getRegion(layout, 'title');
const attrs = regionToDslAttrs(region, { width: 960, height: 540 });
```

## 图像生成

```javascript
import { ImageGenerator, fillImagePlaceholders } from 'js/agents/stages/design/generators';

const gen = new ImageGenerator({ imageProvider });
const { filledSlots } = await gen.generate(imageSlots, contentPackage, designSystem);
const { deckHtmlDsl: filledHtml } = fillImagePlaceholders(deckHtmlDsl, filledSlots);
```

## SVG 生成

```javascript
import { SVGGenerator, fillSvgPlaceholders } from 'js/agents/stages/design/generators';

const svgGen = new SVGGenerator();
const { results } = await svgGen.generate(svgSlots, designSystem);
const { deckHtmlDsl: filledHtml } = fillSvgPlaceholders(deckHtmlDsl, results);
```
