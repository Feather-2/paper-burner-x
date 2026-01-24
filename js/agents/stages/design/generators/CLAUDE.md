# generators (design) - 生成器

幻灯片内容与视觉资产生成（Browser-first, Node.js compatible）。

## 核心文件

| 文件 | 职责 |
|------|------|
| `design-tokens.js` | 设计令牌生成/校验 |
| `design-system-generator.js` | DesignSystem 生成与 overrides 合并（含 visualPreference 规范化、原型污染防护） |
| `layout-generator.js` | 布局原型 HTML 生成 |
| `layout-protocol.js` | 布局类型/区域协议 |
| `image-generator.js` | ImageGenerator - 图像生成/填充 |
| `svg-generator.js` | SVGGenerator - SVG 生成/填充 |
| `batch-generator.js` | 批量生成（system prompt 外置加载/缓存；模型输出 JSON 提取/解析；事件上报） |

## 设计令牌

```javascript
import { generateDesignTokens } from 'js/agents/stages/design/generators';

const { theme, designTokens } = generateDesignTokens({
  theme: 'dark',
  fontFamily: 'Inter',
  safeMarginPct: 8,
});
// -> { theme, visualPreference, designTokens: { colors, typography, spacing, grid, visualPreference } }
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
// -> validated DesignSystem (+ legacy designTokens sync)
```

说明：
- `designSystemOverrides` 使用深度合并（overrides 优先），并过滤 `__proto__`/`prototype`/`constructor` 键以避免原型污染。
- `visualPreference` 支持 string（如 `'dark'`）或对象（如 `{ mode: 'dark' }`），内部会将 `mode` 规范化为小写。

## 批量生成

- system prompt 通过 `loadPrompt('design/batch-generator-system')` 外置加载；内部做缓存：
  - `_cachedSystemPrompt` 缓存已加载内容
  - `_systemPromptLoadPromise` 缓存进行中的加载 Promise，避免并发重复加载
- 加载失败时回退到内置 `FALLBACK_SYSTEM_PROMPT`。
- 为避免 prompt 过长，正文会按 `BATCH_GENERATOR_DEFAULTS.maxContentLength` 截断（默认 `800`）。
- 模型输出为 JSON 数组（形如 `[{ slideIntentId, slideHtml }]`）；在进入 HTML/DSL 拼装与渲染前，务必：
  - 校验结构（数组/字段类型/长度上限/必填字段）
  - 过滤危险键（如 `__proto__`）与危险属性（如 `onload`）
  - 对可渲染 HTML 做白名单清洗/转义，避免 XSS（模型输出也视为不可信输入）
- 事件上报建议通过 `safeEmit(...)` 包装，避免观测代码影响主流程。

## 布局协议

```javascript
import { resolveLayoutType, getRegion, regionToDslAttrs } from 'js/agents/stages/design/generators/layout-protocol.js';

const layout = resolveLayoutType('agenda');
const region = getRegion(layout, 'title');
const attrs = regionToDslAttrs(region, { width: 960, height: 540 });
```

## 图像生成

```javascript
import { ImageGenerator, fillImagePlaceholders } from 'js/agents/stages/design/generators/image-generator.js';
```

说明：
- `ImageGenerator` 负责生成/获取图像资源。
- `fillImagePlaceholders` 用于扫描并填充 `slideHtml`/DSL 中的图片占位；具体入参/出参以 `image-generator.js` 实际导出为准。

## SVG 生成

```javascript
import { SVGGenerator } from 'js/agents/stages/design/generators/svg-generator.js';
```

说明：
- `SVGGenerator` 负责生成/填充 SVG 资产；批量填充 API 以 `svg-generator.js` 实际导出为准。