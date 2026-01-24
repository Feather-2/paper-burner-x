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

负责单页幻灯片内容生成，支持读取 linkedFiles/linkedAssets 作为补充上下文，并解析 HTML 产出 visual slots。

linkedFiles 在 Node 环境默认关闭（避免任意文件读取），需要显式设置允许的根目录；启用后会对路径进行受控校验（仅允许根目录范围内），并对读取内容做长度上限控制（防止将大文件直接灌入上下文）。

```javascript
import { SlideSubAgent } from 'js/agents/stages/design/subagents';
import { setLinkedFilesRoot } from 'js/agents/stages/design/subagents/slide-agent.js';

// 允许读取 linkedFiles 的受控根目录（建议传入绝对路径）；不设置则默认禁止读取
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

管理设计资产、分类与 slide 关联，并提供 snapshot 导出/恢复。

### 资产分类（category）

AssetRegistry 支持以下标准分类：

- `uploaded`: 用户上传（同义：`upload` / `uploaded`）
- `extracted`: 文档/PDF 抽取（同义：`pdf` / `extracted`）
- `videoFrames`: 视频帧（同义：`video` / `videoframes` / `frames`）
- `generated`: 生成资产（同义：`generated` / `gen`；未识别时通常会落到该类）

通常可通过 `asset.source` 自动推断分类；也可显式传入 `{ category }`（会做 normalize）。

### 安全注意

- slide 映射的 key 会对 `__proto__` / `constructor` / `prototype` 做防护，避免原型污染。
- 资产 id 由内部安全的时间戳 id 生成器创建（如 `makeSecureTimestampedId('asset')`）。

```javascript
import { AssetRegistry } from 'js/agents/stages/design/subagents';

const registry = new AssetRegistry();

// 1) 通过 source 推断分类
const assetId = registry.addAsset({ data: logoBase64, mimeType: 'image/png', source: 'upload' });
const asset = registry.getAsset(assetId);

// 2) 显式指定分类（可选）
registry.addAsset({ data: logoBase64, mimeType: 'image/png' }, { category: 'uploaded' });

registry.linkToSlide('slide-1', [assetId]);
const slideAssets = registry.getAssetsForSlide('slide-1');

const snapshot = registry.export();
const restored = AssetRegistry.fromJSON(snapshot);
```
