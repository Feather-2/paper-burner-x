# banana - Banana Pro 实验性批量图像生成

一次性生成整套幻灯片图片，支持整体重新生成（非 inpainting）。

> **文件统计**: 1 个 JS 文件

## 模块描述

基于 `slideIntent` 与 `designSystem` 构建图片生成 prompt，调用注入的 `imageGenerator` 批量产出幻灯片画面，并提供单张重新生成能力。

该模块面向 Design Stage 的 Banana Pro 模式（Mode B），强调“整批生成 + 单页重生”的可控流程。

## 核心文件

| 文件 | 职责 |
|------|------|
| `banana-generator.js` | 默认配置、类型定义、prompt 构建、批量生成与重新生成、类封装 |

## 公开类型

- `BananaConfig`: 生成配置（`defaultModel` / `defaultWidth` / `defaultHeight` / `maxConcurrency` / `retryCount`）。
- `BananaSlideIntent`: 单页意图输入（可选：`slideIntentId` / `title` / `pageType` / `visualFocus` / `keyMessage` / `layoutHint` / `bullets`）。
- `BananaDesignSystem`: 设计系统输入（可选：`theme` / `colorScheme` / `fontFamily`）。
- `BananaImageGenerator`: 图片生成器接口，需实现 `generate({ prompt, width, height, model })` 并返回 `{ url? | base64? }`。
- `BananaBatchSummary`: 批量汇总（`total` / `success` / `failed`）。
- `BananaSlideGenerateResult`: 单页结果（`slideIndex` / `slideIntentId?` / `success` / `image?` / `prompt?` / `error?` 等字段）。

## 核心 API

- `buildImagePrompt(slideIntent, designSystem, additionalPrompt?)`
  - 组合 `BananaSlideIntent + BananaDesignSystem`，生成最终图像提示词。
- `runBananaGenerate(slideIntents, designSystem, options)`
  - 批量生成主入口。
  - 依赖 `imageGenerator.generate` 产图。
  - 支持并发、重试、可选取消信号（`AbortSignal`）。
  - 通过 `emit` 抛出过程事件（如开始/完成）。
- `regenerate(payload, options)`
  - 单张整图重新生成。
  - `bbox` 仅作参考，不走局部 inpainting。
- `BananaGenerator`
  - 便捷封装，注入 `imageGenerator` 和配置。
  - 提供 `setImageGenerator()` / `getConfig()` 等管理能力。

## 运行约束

- `slideIntents` 必须为数组；空数组返回空批次结果。
- `width` / `height` 应为正整数；建议调用前进行边界校验。
- 长任务建议始终传入 `AbortSignal`，用于用户取消与超时中断。
- `maxConcurrency`、`retryCount` 建议设置上限，避免请求风暴。

## 安全与鲁棒性建议

- 对 `width` / `height` / `maxConcurrency` / `retryCount` 做整数与范围约束。
- 对 `model` 做白名单校验，避免非预期模型路由。
- 对生成结果中的 `url` / `base64` 做格式校验（协议、MIME、长度）。
- 对外展示错误时使用友好消息，内部保留详细日志。

## 常见任务

1) 批量生成

```javascript
import { runBananaGenerate } from './banana-generator.js';

const result = await runBananaGenerate(slideIntents, designSystem, {
  imageGenerator,
  additionalPrompt: 'Use cinematic lighting',
});
```

2) 重新生成单张

```javascript
import { regenerate } from './banana-generator.js';

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
import { BananaGenerator, runBananaGenerate } from './banana-generator.js';

const banana = new BananaGenerator({ imageGenerator });
const config = banana.getConfig();
banana.setImageGenerator(imageGenerator);

const result = await runBananaGenerate(slideIntents, designSystem, {
  ...config,
  imageGenerator,
});
```
