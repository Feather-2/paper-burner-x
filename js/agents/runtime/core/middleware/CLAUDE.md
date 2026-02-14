# middleware - 中间件系统

AgentLoop 横切关注点的统一中间件链，采用 Koa 风格洋葱圈模型。

## 核心文件

| 文件 | 职责 |
|------|------|
| `middleware-chain.js` | `Stage` 常量 + `MiddlewareChain` 执行器 + 中间件注册能力（含 `useAll` 批量注册） |

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

> 说明：这是文档里的约定；实际字段以运行时 `ctx` 结构为准。

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
  return { ok: true };
});
```

### 批量注册

```js
chain.useAll([
  async (ctx, next) => next(),
  async (ctx, next) => next(),
]);
```

`useAll` 内部复用 `use` 的参数校验逻辑，建议只传入中间件函数数组。

### API

| 方法 | 说明 |
|------|------|
| `use(middleware)` | 注册单个中间件；非函数参数抛出 `TypeError` |
| `useAll(middlewares)` | 批量注册中间件（依次调用 `use`） |
| `execute(ctx, handler?)` | 执行中间件链并在末端调用 `handler` |

## 执行语义与约束

- 执行顺序遵循洋葱模型：`before` 正序进入，`after` 逆序返回。
- 中间件应保持幂等、可组合、可观测（建议通过 `emit` 上报关键事件）。
- `ctx.state` 建议仅存储可序列化数据，避免隐式共享复杂对象。
- 中间件内部如需中断，应抛出明确错误类型并由上层统一处理。

## 安全与稳定性建议

- 对批量注册输入做边界约束（类型、数量上限），避免异常迭代器导致阻塞。
- 工具调用相关中间件应在进入 `beforeTool` 前完成参数白名单校验。
- pre/post 钩子异常建议隔离处理并记录 telemetry，避免影响主链路可用性。
- 长生命周期场景建议配合缓存回收策略，防止 `ctx.state` 持续膨胀。

## 测试建议

- 工具调用边界：空参数、超长参数、类型错误参数。
- Hook 异常处理：pre/post 抛错不应导致不可控崩溃。
- 并发边界：并行请求下中间件顺序与上下文隔离性。
- 内存压力：大输入与长链场景下回收行为。
