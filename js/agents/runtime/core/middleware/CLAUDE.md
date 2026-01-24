# middleware - 中间件系统

AgentLoop 横切关注点的统一中间件链，采用 Koa 风格洋葱圈模型。

## 核心文件

| 文件 | 职责 |
|------|------|
| `middleware-chain.js` | `Stage` 常量 + `MiddlewareChain` + 内置中间件工厂 |

## 设计理念

```text
请求 → [mw1 before] → [mw2 before] → [mw3 before] → handler
                                                        ↓
响应 ← [mw1 after]  ← [mw2 after]  ← [mw3 after]  ← result
```

中间件签名: `async (ctx, next) => result`

- `ctx`: 运行上下文（`input/state/emit/signal/...`）
- `next`: 调用下一个中间件（返回下游结果）

## 类型约定（建议）

> 说明：这是文档里的约定；实际字段以运行时 ctx 结构为准。

```js
/**
 * @typedef {() => Promise<unknown>} Next
 * @typedef {(ctx: MiddlewareContext, next: Next) => Promise<unknown>} Middleware
 *
 * @typedef {object} MiddlewareContext
 * @property {unknown} input - 本次输入
 * @property {object} state - 可变状态（建议仅保存可序列化数据）
 * @property {(eventName: string, payload?: unknown) => void} emit - 事件/遥测
 * @property {AbortSignal|undefined} signal - 取消信号
 */
```

## Stage 常量

`Stage` 为冻结对象（`Object.freeze`），值为稳定的字符串标识（camelCase），可用于日志/遥测维度。

```js
import { Stage } from 'js/agents/runtime/core/middleware/middleware-chain.js';
```

| 常量 | 值 | 含义 |
|------|----|------|
| `Stage.BEFORE_AGENT` | `'beforeAgent'` | 请求入口 |
| `Stage.BEFORE_MODEL` | `'beforeModel'` | 模型调用前 |
| `Stage.AFTER_MODEL` | `'afterModel'` | 模型调用后 |
| `Stage.BEFORE_TOOL` | `'beforeTool'` | 工具调用前 |
| `Stage.AFTER_TOOL` | `'afterTool'` | 工具调用后 |
| `Stage.AFTER_AGENT` | `'afterAgent'` | 请求结束 |

## MiddlewareChain

```js
import { MiddlewareChain, Stage } from 'js/agents/runtime/core/middleware/middleware-chain.js';

const chain = new MiddlewareChain();

chain.use(async (ctx, next) => {
  ctx.emit?.('agent:mw', { stage: Stage.BEFORE_AGENT });
  const result = await next();
  return result;
});

await chain.execute(ctx, async () => {
  // 最终 handler（可选）
  return { ok: true };
});
```

### API

| 方法 | 说明 |
|------|------|
| `use(middleware)` | 添加中间件 |
| `useAll(middlewares)` | 批量添加（要求数组） |
| `insertAt(index, middleware)` | 指定位置插入 |
| `remove(middleware)` | 按引用移除 |
| `execute(ctx, finalHandler?)` | 执行中间件链 |
| `clear()` | 清空所有中间件 |
| `length` | 中间件数量 |

### 执行语义与约束

- `next()` 建议 `return await next()`，以保证 after 逻辑正常执行。
- 禁止多次调用 `next()`（Koa 风格约束）；`execute()` 应防止重入并抛出明确错误。
- 默认不吞异常：未捕获异常应向上传播；如需降级/兜底，请显式捕获并重新抛出带类型的错误。
- 并发注意：若同一个 `MiddlewareChain` 实例会被并行 `execute()`，建议在 `execute()` 开始时对中间件列表做快照，避免执行期间被 `use/remove/insertAt` 影响。

## 内置中间件

| 工厂函数 | 用途 |
|----------|------|
| `createLoggingMiddleware({ logger, prefix })` | 日志记录（建议脱敏） |
| `createTelemetryMiddleware({ emit, actor, stageName })` | 遥测事件（事件名建议 `domain:action`） |
| `createCancellationMiddleware()` | 取消检查（`AbortSignal`） |
| `createTimeoutMiddleware({ timeout, onTimeout })` | 超时保护（应清理定时器） |
| `createRetryMiddleware({ maxRetries, retryDelay, shouldRetry })` | 失败重试（应尊重取消） |
| `createSnapshotMiddleware({ onBeforeSnapshot, onAfterSnapshot })` | 状态快照（注意内存与隐私） |
| `createShadowSystemMiddleware({ getShadowHints })` | 影子系统注入（仅注入可信提示） |
| `createBlackboardMiddleware({ blackboard, syncKeys })` | 黑板同步（必须校验 key，防原型污染） |
| `createDefaultMiddlewareChain(options)` | 预配置链 |

## 安全与兼容性注意

- 禁止 `eval/new Function`，禁止把用户输入拼接进 `innerHTML`。
- 黑板/状态同步的 key 必须是 allowlist，显式拒绝 `__proto__`/`constructor`/`prototype`。
- 日志与遥测避免输出敏感信息（token、prompt、工具参数中的密钥等）。
- Browser-first：避免使用 `fs/path/process/__dirname` 等 Node-only API。

## 测试建议

- `execute()`：空链、单中间件、多中间件、抛错、重复 `next()`、finalHandler 缺省。
- timeout/retry：快速连续调用、AbortSignal 中断、定时器是否清理。
- blackboard/shadow：边界 key（空、超长、`__proto__`）、深层对象同步。
