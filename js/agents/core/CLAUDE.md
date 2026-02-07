# core - 微内核核心

提供 Kernel、四大总线、插件系统、CRDT 共识层和沙箱执行环境，并提供旧 ServiceProvider → 新 Plugin 的兼容层。

## API 层次

| Level | API | 用途 |
|-------|-----|------|
| 0 | `quickKernel()`, `minimalKernel()` | 一行创建 |
| 0.5 | `isServiceProvider()`, `adaptProvider()` | 兼容旧 ServiceProvider |
| 1 | `KernelBuilder` | 链式配置 |
| 2 | `new Kernel()` + `usePreset()` | 完整控制 |
| 3 | `EventBus`, `StateBus`, `ServiceBus`, `MessageBus` | 底层组件 |

## 核心文件

| 文件 | 职责 |
|------|------|
| `kernel.js` | Kernel 主类，生命周期管理 |
| `event-bus.js` | EventBus：发布/订阅、Lamport Clock、模式匹配 |
| `event-bus-subscriptions.js` | 事件订阅存储：精确/通配/优先级订阅与退订 |
| `event-bus-utils.js` | 事件名/模式校验、模式匹配工具（支持 `:` 与 `.` 分隔；支持 `*`/`?`） |
| `state-bus.js` | 细粒度状态订阅 |
| `service-bus.js` | 服务注册/发现 + Retry/Timeout/Cache 代理 |
| `message-bus.js` | MessageBus：RPC over EventBus，跨 Agent/Stage 请求-响应通信 |
| `plugin.js` | `createPlugin`, PluginManager, PluginContext |
| `presets.js` | 预设配置 (minimal/standard/deepsearch/production) |
| `compat.js` | 旧 API 兼容层：旧 ServiceProvider → 新 Plugin (`isServiceProvider`, `adaptProvider`) |
| `secure-plugin-loader.js` | SecurePluginLoader - 远程插件 SRI 验证加载 |

## 子模块索引

| 子模块 | 路径 | 职责 |
|--------|------|------|
| **crdt** | `crdt/` | CRDT 共识：LWWRegister, GCounter, PNCounter, LWWMap, ORSet, CRDTDocument |
| **sandbox** | `sandbox/` | 沙箱隔离：WASM (QuickJS) + System (Bubblewrap/Seatbelt/Docker) |

## 常用模式

```javascript
// 创建插件
import { createPlugin } from 'js/agents/core';

const myPlugin = createPlugin({
  name: 'analytics',
  setup(ctx) {
    const off = ctx.events.on('agent:step', (e) => track(e));
    return () => off();
  }
});

// 带优先级订阅（数值越大越先执行，具体规则以实现为准）
ctx.events.on('agent:step', handler, { priority: 10 });

// 服务代理
import { createRetryProxy, createCacheProxy } from 'js/agents/core';

const robustService = createRetryProxy(
  createCacheProxy(originalService, { ttl: 5000 }),
  { maxRetries: 3 }
);
```

## 旧 Provider 兼容（ServiceProvider → Plugin）

- 旧接口：`provider.register(kernel)`
- 可选生命周期：`provider.start(kernel)`, `provider.stop(kernel)`
- 适配规则：
  - `register()` 在新 Plugin 的 `install()` 阶段执行
  - `start()/stop()` 映射到新 Plugin 的 `onStart()/onStop()`
- 命名：`adaptProvider()` 生成 `compat/<name>` 的插件名；建议旧 provider 显式提供稳定的 `provider.name`

```javascript
import { isServiceProvider, adaptProvider, KernelBuilder } from 'js/agents/core';

const legacyProvider = createLegacyProvider();

const builder = new KernelBuilder();

if (isServiceProvider(legacyProvider)) {
  builder.use(adaptProvider(legacyProvider));
} else {
  throw new TypeError('Expected legacy ServiceProvider');
}

const kernel = builder.build();
await kernel.start();
```

## 事件命名与模式匹配

- 推荐事件名格式：`domain:action`（例如 `agent:step`）。
- 兼容格式：`domain.action`（历史/兼容用途；新代码仍建议用 `:`）。
- 支持通配符（用于订阅 pattern）：
  - `*`：多字符通配
  - `?`：单字符通配

```javascript
// 精确订阅
eventBus.on('agent:step', handler);

// 通配订阅
eventBus.on('agent:*', handler);
eventBus.on('agent:st?p', handler);

// 订阅所有事件（谨慎使用）
eventBus.on('*', handler);

// 兼容的 '.' 分隔
eventBus.on('agent.step', handler);
```