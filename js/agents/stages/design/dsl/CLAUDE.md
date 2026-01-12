# dsl (design) - 幻灯片 DSL

幻灯片定义语言和构建器。

## 核心文件

| 文件 | 职责 |
|------|------|
| `dsl-builder.js` | buildSlideHtml - 从 DSL 构建 HTML |
| `dsl-rules.js` | DSL 规则定义 |

## DSL 结构

```javascript
const slide = {
  layout: 'title-content',
  title: '市场分析',
  content: [
    { type: 'text', value: '2024 年市场增长 15%' },
    { type: 'chart', chartType: 'bar', data: [...] },
    { type: 'image', placeholder: true, alt: '市场份额图' },
  ],
  style: {
    background: '#1a1a1a',
    accent: '#007AFF',
  },
};
```

## 构建 HTML

```javascript
import { buildSlideHtml } from 'js/agents/stages/design/dsl';

const html = buildSlideHtml(slide, designTokens);
```
