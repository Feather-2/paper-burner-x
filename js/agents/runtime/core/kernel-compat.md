# kernel - 微内核兼容层

为历史运行时代码/测试保留 MicroKernel API 的兼容实现。

> **文件统计**: 1 个 JS 文件

## 模块描述

`runtime/kernel` 提供旧版微内核表层：以 EventBus 为核心做事件收发桥接，提供轻量服务注册表，并把调度请求统一转发到 scheduler。新系统主线使用 `js/agents/core` 的 Kernel，此处主要用于兼容。

## 核心文件

| 文件 | 职责 |
|------|------|
| `micro-kernel.js` | MicroKernel 兼容实现：EventBus + hooks、服务注册、request/schedule、provider 生命周期 |

## 关键概念

- **构造选项**: `scheduler`、`providers`、`runId`；`runId` 传入 EventBus 便于 trace。
- **内建服务**: 自动注册 `ServiceId.KERNEL`、`kernel`、`ServiceId.EVENT_BUS`。
- **EventBus**: 内部创建 EventBus 并调用 `enhanceEventBusWithHooks`，handler 接收 raw payload。
- **Service Registry**: `register(id, value|factory)` + `getService(id)`，支持懒加载工厂。
- **request/response**: `request()` 仅调用首个 handler，支持 `timeoutMs/timeout`，默认 30s；无 handler 时等待超时后抛错。
- **schedule**: 支持 `() => any` 或 dispatch task；dispatch 统一转发到 `scheduler.dispatch()` 并携带 `priority`。
- **Providers**: `start()` 先 `register()` 再 `start()`，`stop()` 负责清理。

## 常见任务

创建内核并注册服务：

```javascript
import { MicroKernel } from 'js/agents/runtime/kernel/micro-kernel.js';
import { ServiceId } from 'js/agents/runtime/di';

const kernel = new MicroKernel({ scheduler, providers: [providerA], runId: 'run-1' });
kernel.register(ServiceId.LOGGER, console);

await kernel.start();
```

订阅/请求事件（handler 只接收 payload）：

```javascript
const off = kernel.on('ping', (payload) => ({ ok: true, payload }));

kernel.emit('ping', { id: 1 });

const result = await kernel.request('ping', { id: 2 }, { timeoutMs: 5000 });
off();
```

调度任务：

```javascript
await kernel.schedule(
  { runtimeType: 'js', code: 'return 1 + 1', inputState: {}, options: { timeoutMs: 1000 } },
  5
);
```

直接执行函数任务：

```javascript
const value = await kernel.schedule(() => 123);
```

停止并清理：

```javascript
await kernel.stop();
```
