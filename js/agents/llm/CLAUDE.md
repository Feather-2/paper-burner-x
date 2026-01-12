# llm - LLM 提供者层

模型路由、速率限制和多模态支持。

## 核心文件

| 文件 | 职责 |
|------|------|
| `provider.js` | ModelEntry 类型定义，断言函数 |
| `model-router.js` | 模型路由，按 tag 选择模型 |
| `rate-limit.js` | 速率限制器 |
| `overflow-recovery.js` | Token 溢出恢复 |
| `model-events.js` | LLM 事件类型 |
| `constants.js` | 常量（MODEL_TAGS 等） |

## 特殊提供者

| 文件 | 职责 |
|------|------|
| `image-provider.js` | 图像生成 |
| `whisper-provider.js` | 语音转文字 |
| `mock-provider.js` | 测试用 Mock |
| `ppt-model-bridge.js` | PPT 生成桥接 |

## 模型标签

```javascript
const MODEL_TAGS = ['text', 'vision', 'reasoning', 'long-context', 'fast', 'cheap'];
```

## 使用示例

```javascript
import { ModelRouter } from 'js/agents/llm/model-router.js';

const router = new ModelRouter(models);
const model = router.select({ tags: ['vision', 'fast'] });
```

## 速率限制

```javascript
import { RateLimiter } from 'js/agents/llm/rate-limit.js';

const limiter = new RateLimiter({ rpm: 60, tpm: 100000 });
await limiter.acquire(estimatedTokens);
```
