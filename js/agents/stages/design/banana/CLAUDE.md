# banana - Banana Pro 实验性批量图像生成

一次性生成整套幻灯片图片，支持整体重新生成（非 inpainting）。

> **文件统计**: 1 个 JS 文件

## 模块描述

基于 `slideIntent` 与 `designSystem` 拼接 prompt，调用图片生成器批量产出幻灯片画面，并提供单张重新生成能力。

## 核心文件

| 文件 | 职责 |
|------|------|
| `banana-generator.js` | 默认配置、prompt 构建、批量生成与重新生成、类封装 |

## 关键概念

- `BANANA_CONFIG`: 默认模型/尺寸/并发/重试配置（当前批量生成按顺序执行）。
- `buildImagePrompt`: 组合 `BananaSlideIntent` + `BananaDesignSystem`，可追加 `additionalPrompt`。
- `runBananaGenerate`: 依赖 `imageGenerator.generate` 产图；通过 `emit` 发送 `banana.generating` 与 `banana.completed`；支持 `signal` 提前终止剩余任务；可通过 options 覆盖 `width`/`height`/`model`。
- `regenerate`: 全图重新生成；`bbox` 仅作位置参考，不影响生成逻辑；通过 `emit` 发送 `banana.regenerating`。
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
