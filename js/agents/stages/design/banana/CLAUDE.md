# banana - Banana Pro 实验性批量图像生成

一次性生成整套幻灯片图片，支持整体重新生成（非 inpainting）。

> **文件统计**: 1 个 JS 文件

## 模块描述

基于 `slideIntent` 与 `designSystem` 构建图片生成 prompt，调用注入的 `imageGenerator` 批量产出幻灯片画面，并提供单张重新生成能力。

## 核心文件

| 文件 | 职责 |
|------|------|
| `banana-generator.js` | 默认配置、类型定义、prompt 构建、批量生成与重新生成、类封装 |

## 关键概念

- `BANANA_CONFIG`: 默认模型/尺寸/并发上限/重试次数配置，可被调用参数覆盖。
- `BananaSlideIntent`: 单页意图输入（标题、要点、布局提示等），通常来自上游设计阶段或 UI。
- `BananaDesignSystem`: 设计系统输入（主题、配色、字体等）。
- `BananaImageGenerator`: 图片生成器接口，需实现 `generate({ prompt, width, height, model })` 并返回 `{ url? | base64? }`。
- `buildImagePrompt`: 组合 `BananaSlideIntent` + `BananaDesignSystem`，可追加 `additionalPrompt`。
- `runBananaGenerate`: 依赖 `imageGenerator.generate` 产图；通过 `emit` 发送 `banana.generating` 与 `banana.completed`；支持 `signal` 提前终止剩余任务；可通过 options 覆盖 `width`/`height`/`model`。
- `regenerate`: 全图重新生成；`bbox` 仅作位置参考，不影响生成逻辑；通过 `emit` 发送 `banana.regenerating`。
- `BananaBatchSummary`: 批量汇总（`total`/`success`/`failed`）。
- `BananaSlideGenerateResult`: 单页生成结果（`slideIndex`/`success`/`image`/`prompt`/`error` 等字段）。
- `BananaGenerator`: 注入 `imageGenerator` 与 config 的便捷封装，提供 `setImageGenerator` / `getConfig`。

## 常见任务

1) 批量生成

```javascript
import { runBananaGenerate } from './banana-generator';

const result = await runBananaGenerate(slideIntents, designSystem, {
  imageGenerator,
  additionalPrompt: 'Use cinematic lighting',
});
```

2) 重新生成单张

```javascript
import { regenerate } from './banana-generator';

const result = await regenerate(
  {
    slideIndex: 2,
    command: 'Reduce clutter on the right side',
    slideIntent,
    designSystem,
  },
  { imageGenerator }
);
```

3) 使用类封装

```javascript
import { createBananaGenerator } from './banana-generator';

const generator = createBananaGenerator({ imageGenerator });
const batch = await generator.generate(slideIntents, designSystem);
```
