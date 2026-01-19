# middleware - 中间件系统

AgentLoop 横切关注点的统一中间件链，采用 Koa 风格洋葱圈模型。

## 核心文件

| 文件 | 职责 |
|------|------|
| `middleware-chain.js` | MiddlewareChain + Stage 常量 + 内置中间件工厂 |

## 设计理念

```
请求 → [mw1 before] → [mw2 before] → [mw3 before] → handler
                                                        ↓
响应 ← [mw1 after]  ← [mw2 after]  ← [mw3 after]  ← result
```

中间件签名: `async (ctx, next) => result`

## Stage 常量

```javascript
import { Stage } from 'js/agents/runtime/core/middleware/middleware-chain.js';

Stage.BEFORE_AGENT  // 请求入口
Stage.BEFORE_MODEL  // 模型调用前
Stage.AFTER_MODEL   // 模型调用后
Stage.BEFORE_TOOL   // 工具调用前
Stage.AFTER_TOOL    // 工具调用后
Stage.AFTER_AGENT   // 请求结束
```

## MiddlewareChain

```javascript
import { MiddlewareChain } from 'js/agents/runtime/core/middleware/middleware-chain.js';

const chain = new MiddlewareChain();

// 添加中间件
chain.use(async (ctx, next) => {
  console.log('before');
  const result = await next();
  console.log('after');
  return result;
});

// 执行
await chain.execute(ctx, finalHandler);
```

### API

| 方法 | 说明 |
|------|------|
| `use(middleware)` | 添加中间件 |
| `useAll(middlewares)` | 批量添加 |
| `insertAt(index, middleware)` | 指定位置插入 |
| `remove(middleware)` | 移除中间件 |
| `execute(ctx, finalHandler?)` | 执行中间件链 |
| `clear()` | 清空所有中间件 |
| `length` | 中间件数量 |

## 内置中间件

| 工厂函数 | 用途 |
|----------|------|
| `createLoggingMiddleware({ logger, prefix })` | 日志记录 |
| `createTelemetryMiddleware({ emit, actor, stageName })` | 遥测事件 |
| `createCancellationMiddleware()` | 取消检查 (AbortSignal) |
| `createTimeoutMiddleware({ timeout, onTimeout })` | 超时保护 |
| `createRetryMiddleware({ maxRetries, retryDelay, shouldRetry })` | 失败重试 |
| `createSnapshotMiddleware({ onBeforeSnapshot, onAfterSnapshot })` | 状态快照 |
| `createShadowSystemMiddleware({ getShadowHints })` | 影子系统注入 |
| `createBlackboardMiddleware({ blackboard, syncKeys })` | 黑板同步 |
| `createDefaultMiddlewareChain(options)` | 预配置链 |

## 使用示例

### 基础用法

```javascript
import {
  MiddlewareChain,
  createCancellationMiddleware,
  createTimeoutMiddleware,
  createLoggingMiddleware,
} from 'js/agents/runtime/core/middleware/middleware-chain.js';

const chain = new MiddlewareChain();

chain.use(createCancellationMiddleware());
chain.use(createLoggingMiddleware({ logger: console }));
chain.use(createTimeoutMiddleware({ timeout: 30000 }));

await chain.execute({ stepName: 'llm-call', signal }, async (ctx) => {
  return await model.complete(ctx.messages);
});
```

### 预配置链

```javascript
import { createDefaultMiddlewareChain } from 'js/agents/runtime/core/middleware/middleware-chain.js';

const chain = createDefaultMiddlewareChain({
  logger: console,
  emit: eventBus.emit,
  timeout: 60000,
  maxRetries: 2,
});
```

### 短路处理

```javascript
chain.use(async (ctx, next) => {
  if (!ctx.authorized) {
    throw new Error('Unauthorized');  // 短路，不执行后续中间件
  }
  return next();
});
```

## 与 Hooks 的关系

- **Hooks** (`hooks/`): 事件驱动的钩子注册/执行，基于 HookRegistry
- **Middleware** (`core/middleware/`): 洋葱圈执行模型，适合横切关注点

两者可以配合使用：Hooks 处理离散事件，Middleware 处理连续执行流。
