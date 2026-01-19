# llm - LLM 提供者层

模型路由、速率限制和多模态支持。

> **文件统计**: 17 个 JS 文件

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | 模块入口与统一导出 |
| `provider.js` | ModelEntry/UsageConfig 断言，MODEL_TAGS 与 BaseProvider |
| `model-router.js` | 按 usage/tag/策略路由模型，支持熔断与性能路由 |
| `rate-limit.js` | TokenBucketRateLimiter 与限流配置读取 |
| `overflow-recovery.js` | Token 溢出恢复 |
| `model-events.js` | 浏览器兼容事件发射器 |
| `constants.js` | ModelUsage/RouterStrategy/ModelHealth/TransportKind 等常量 |

## 内部模块 (internal/)

| 文件 | 职责 |
|------|------|
| `internal/call-executor.js` | 执行模型调用、重试与 failover，记录 token/延迟 |
| `internal/config-parser.js` | ModelRouter 配置解析、日志/策略/持久化初始化 |
| `internal/provider-selection.js` | usage/tag 解析与候选选择、性能路由注册 |
| `internal/health-manager.js` | 健康状态与熔断器管理 |
| `internal/fallback.js` | 错误归类与冷却时间计算 |
| `internal/rate-limit.js` | 每模型限流器装配与缓存 |

## 最近变更

- **TokenBucketRateLimiter**: `maxQueue=0` 语义调整 - 队列为空时允许新任务入队（即使有 in-flight），仅当队列已有 1 个待执行任务时拒绝

## 特殊提供者

| 文件 | 职责 |
|------|------|
| `image-provider.js` | 图像生成 |
| `whisper-provider.js` | 语音转文字 |
| `mock-provider.js` | 测试用 Mock |
| `ppt-model-bridge.js` | PPT 生成桥接 |

## 模型标签

```javascript
import { MODEL_TAGS } from 'js/agents/llm/provider.js';

// MODEL_TAGS = ['text', 'vision', 'reasoning', 'long-context', 'fast', 'cheap'];
```

## 使用示例

```javascript
import { ModelRouter } from 'js/agents/llm/model-router.js';

const router = new ModelRouter({
  models,
  usageConfig,
  providers,
});

const resp = await router.call({
  usage: 'worker',
  messages,
});
```

## 速率限制

```javascript
import { TokenBucketRateLimiter } from 'js/agents/llm/rate-limit.js';

const limiter = new TokenBucketRateLimiter({ rps: 2, burst: 4, concurrency: 1 });
const resp = await limiter.schedule(() => provider.chat({ model, messages }));
```
