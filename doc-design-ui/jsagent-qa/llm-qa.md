# LLM 文件夹审查报告 (js/agents/llm)

## 1. 潜在问题清单

### 1.1 核心路由逻辑 (Router & Reliability)
- **并发与限流实现不一**: `model-router.js` 中有一个简单的 `RateLimiter`（第 85 行），而 `rate-limit.js` 中有一个更复杂的 `TokenBucketRateLimiter`（第 59 行）。路由目前仅使用了前者，这导致限流功能相对单薄，不支持 Burst 等特性。
- **Failover 策略过于简单**: `ModelRouter` 仅在捕获 Error 时切换。对于 API 返回 429 (Too Many Requests) 但未抛出原生 Error 的情况（取决于 Provider 的实现），可能无法正确触发健康检查更新。
- **Round Robin 索引持久化缺失**: `_rrNextIndexByUsage` 是内存中的 Map。在 Server 重启或页面刷新后，路由总是从第一个模型开始，这在模型负载不均时会导致首个模型频繁被“打爆”。

### 1.2 类型检查与契约 (Validation & Contract)
- **强类型依赖硬编码**: `provider.js` 中的 `assertUsageConfig` 硬编码了 `worker, planner, analyst, writer, vision`（第 50 行）。如果应用层想要自定义一种角色（如 `coder`），该断言会失效或报错。
- **Tag 验证过于严格**: `assertModelEntry` 对未知 Tag 抛出异常（第 36 行）。这对于向前兼容性不利，如果未来引入了新的模型能力 Tag，旧的代码库将无法加载这些配置。

### 1.3 图像与多模态 (Vision)
- **图像生成适配器缺乏统一基类**: `GeminiImageAdapter` 和 `OpenAIImageAdapter` 是独立的函数。虽然这种函数式写法简洁，但它们没有共享诸如“自动重试”、“请求审计日志”等高级功能。
- **尺寸转换魔数**: `deriveGeminiDimensions`（第 36 行）中硬编码了各种比例的像素值。这些应该作为可配置的常量。
- **Token 统计缺失**: 所有 LLM 调用均未通过 `provider.js` 统一提取 `usage` 信息（如 prompt_tokens, completion_tokens），这使得 Agent 的成本监控变得困难。

### 1.4 环境兼容性 (Environment)
- **混合代码污染**: `image-provider.js` 中直接引用了 `localStorage` 和 `loadModelKeys`（第 373, 382 行）。`loadModelKeys` 看起来是一个外部注入的全局函数，这在没有预加载相关脚本的环境下会导致 ReferenceError。
- **EventEmitter 冗余**: `model-router.js` 自行实现了一个简易 `EventEmitter`（第 5 行）。在已经有 SDK 级事件总线的情况下，这种私有实现增加了理解成本，且不支持通配符订阅。

## 2. 改进建议
1. **统一限流组件**: 将 `rate-limit.js` 中的 `TokenBucketRateLimiter` 集成到 `ModelRouter` 中。
2. **解耦 Usage 断言**: 允许在构造 `ModelRouter` 时动态注册合法的 `usages`，或者将断言改为警告。
3. **增加 Token 跟踪**: 在 `BaseProvider` 的契约中增加对响应 `usage` 字段的强制要求，并在 `ModelRouter` 中抛出相关度量指标。
4. **清理全局依赖**: `image-provider.js` 应该通过构造函数接收配置加载器，而不是直接访问 `localStorage` 或全局函数。
5. **增强 Failover**: 引入对 HTTP 状态码的感知，特别是针对 429 和 5xx 错误的差异化冷却策略。

## cc是如何解决这个问题的

Claude Code (CC) 通过一套严谨的模型管理和统计系统解决了 LLM 调用层面的可靠性与监控问题：

1.  **高级限流与调度**:
    *   **统一限流器**: CC 实现了功能完备的 `RateLimiter` ([`src/ratelimit/index.ts`](ref/claude-code-open-main/src/ratelimit/index.ts))，支持请求频率和 Token 消耗的双重限流。
    *   **队列化处理**: 请求不仅仅是被拦截，而是进入 `queueRequest` 队列。当限流重置（`rate-limit-reset`）时，队列会自动恢复执行，这比简单的 Failover 更稳健。
    *   **纯浏览器端适配**: 该限流器基于 `setTimeout` 和异步队列，不依赖 Node.js 特有 API，完美适配浏览器并发控制。

2.  **健壮的回退与重试 (Failover)**:
    *   **错误类型感知**: CC 的 `ModelFallback` ([`src/models/fallback.ts`](ref/claude-code-open-main/src/models/fallback.ts)) 定义了详细的 `retryableErrors` 列表，包括 `overloaded_error`, `rate_limit_error` 以及各类网络超时。
    *   **自动回退**: 在主模型不可用且错误可重试时，`executeWithFallback` 会自动切换到备用模型，并记录切换事件以便后续审计。
    *   **纯浏览器端适配**: 所有的回退逻辑都是纯逻辑封装，通过 Promise 链实现，不产生任何环境依赖。

3.  **精确的 Token 与成本监控**:
    *   **多维度统计**: `ModelStats` 类 ([`src/models/stats.ts`](ref/claude-code-open-main/src/models/stats.ts)) 负责按模型记录输入/输出 Token、缓存 Token 以及思维 Token (Thinking Tokens)。
    *   **成本计算**: 它不仅记录 Token，还结合 `modelConfig` 中的定价数据实时计算美元成本（`costUSD`）。
    *   **性能指标**: 提供 `tokensPerSecond`、`cacheHitRate` 和平均延迟等关键性能指标。
    *   **纯浏览器端适配**: 统计数据保存在内存 Map 中，非常适合在 UI 界面上实时展示给用户，且无需后端数据库支持即可实现会话级的成本监控。

4.  **去全局依赖与模块化**:
    *   **配置驱动**: 所有的模型信息、能力标签和定价都由 [`src/models/config.ts`](ref/claude-code-open-main/src/models/config.ts) 统一管理，避免了 jsagents 中那种散落在各处的硬编码和全局函数调用。
    *   **标准事件总线**: CC 使用标准的 `EventEmitter` 处理限流和模型切换事件，保持了 API 的一致性。
