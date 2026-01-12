# generators (design) - 生成器

幻灯片内容生成。

## 核心文件

| 文件 | 职责 |
|------|------|
| `design-tokens.js` | 设计令牌生成 |
| `layout-generator.js` | 布局生成 |
| `image-generator.js` | ImageGenerator - 图像生成/填充 |
| `svg-generator.js` | SVGGenerator - SVG 生成 |
| `batch-generator.js` | 批量生成 |

## 设计令牌

```javascript
import { generateDesignTokens } from 'js/agents/stages/design/generators';

const tokens = generateDesignTokens({
  theme: 'dark',
  accent: '#007AFF',
  fontFamily: 'Inter',
});
// → { colors, typography, spacing, shadows }
```

## 图像生成

```javascript
import { ImageGenerator, fillImagePlaceholders } from 'js/agents/stages/design/generators';

const gen = new ImageGenerator(llmProvider);
await fillImagePlaceholders(slides, gen);
```

## SVG 生成

```javascript
import { SVGGenerator, fillSvgPlaceholders } from 'js/agents/stages/design/generators';

const svgGen = new SVGGenerator();
await fillSvgPlaceholders(slides);
```
