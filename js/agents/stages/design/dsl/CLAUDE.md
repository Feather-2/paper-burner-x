# dsl (design) - 幻灯片 DSL

幻灯片定义语言和构建器，负责将 slideIntent 或 Layout JSON 转换为 HTML DSL。

## 核心文件

| 文件 | 职责 |
|------|------|
| `dsl-builder.js` | buildSlideHtml / buildFromLayoutJson - 生成 HTML DSL |
| `dsl-rules.js` | DSL 规则加载与缓存（getDslRules/DSL_RULES） |

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

## 构建 HTML

```javascript
import { buildSlideHtml, buildFromLayoutJson } from 'js/agents/stages/design/dsl';

const htmlFromIntent = buildSlideHtml(
  slideIntent,
  designSystem,
  { claims: [...], evidenceLedger: [...] },
  { safeMode: true, slideNo: 1 }
);

const htmlFromLayout = buildFromLayoutJson(layoutJson, designSystem, { slideId: 'slide-1', title: '市场分析' });
```
