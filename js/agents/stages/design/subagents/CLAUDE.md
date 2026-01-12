# subagents (design) - 设计子 Agent

专门化的设计子 Agent。

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | 入口 |
| `slide-subagent.js` | SlideSubAgent - 单页生成 |
| `visual-subagent.js` | VisualSubAgent - 视觉元素生成 |
| `asset-registry.js` | AssetRegistry - 资产注册 |

## SlideSubAgent

负责单页幻灯片内容生成：

```javascript
import { SlideSubAgent } from 'js/agents/stages/design/subagents';

const agent = new SlideSubAgent({ llm, designTokens });
const slide = await agent.generate({
  title: '第一章：概述',
  outline: '...',
  style: 'corporate',
});
```

## VisualSubAgent

负责视觉元素（图表、图像）：

```javascript
import { VisualSubAgent } from 'js/agents/stages/design/subagents';

const visual = new VisualSubAgent({ imageGen, svgGen });
await visual.fill(slide.visuals);
```

## AssetRegistry

管理设计资产：

```javascript
import { AssetRegistry } from 'js/agents/stages/design/subagents';

const registry = new AssetRegistry();
registry.register('logo', logoBuffer, 'image/png');
registry.register('chart-1', chartSvg, 'image/svg+xml');

const asset = registry.get('logo');
```
