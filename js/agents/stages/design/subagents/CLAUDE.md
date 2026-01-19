# subagents (design) - 设计子 Agent

专门化的设计子 Agent。

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | 入口 |
| `slide-agent.js` | SlideSubAgent - 单页生成 |
| `visual-agent.js` | VisualSubAgent - 视觉元素生成 |
| `asset-registry.js` | AssetRegistry - 资产注册与映射 |

## SlideSubAgent

负责单页幻灯片内容生成，支持读取 linkedFiles/linkedAssets 作为补充上下文，并解析 HTML 产出 visual slots。linkedFiles 在 Node 环境默认关闭（避免任意文件读取），需要显式设置允许的根目录。

```javascript
import { SlideSubAgent } from 'js/agents/stages/design/subagents';
import { setLinkedFilesRoot } from 'js/agents/stages/design/subagents/slide-agent.js';

setLinkedFilesRoot('/abs/path/to/linked-files');

const agent = new SlideSubAgent({ designSystem, assetRegistry, dslRules });

const result = await agent.run({
  slideIntent,
  slideIndex: 0,
  slideNo: 1,
  emit,
});

const { htmlDsl, visualSlots, status } = result;
```

## VisualSubAgent

负责视觉元素（图表、图像、资产）填充，自动决定 renderType（ai-image/svg/asset）并返回统计报告。

```javascript
import { VisualSubAgent } from 'js/agents/stages/design/subagents';

const visual = new VisualSubAgent({ assetRegistry, imageProvider, svgGenerator });

const result = await visual.run(visualSlots, designSystem, contentPackage, {
  emit,
  svgConcurrency: 2,
  imageConcurrency: 4,
});

const { assetResults, report } = result;
```

## AssetRegistry

管理设计资产、分类与 slide 关联。

```javascript
import { AssetRegistry } from 'js/agents/stages/design/subagents';

const registry = new AssetRegistry();

const assetId = registry.addAsset({ data: logoBase64, mimeType: 'image/png', source: 'uploaded' });
const asset = registry.getAsset(assetId);

registry.linkToSlide('slide-1', [assetId]);
const slideAssets = registry.getAssetsForSlide('slide-1');

const snapshot = registry.export();
const restored = AssetRegistry.fromJSON(snapshot);
```