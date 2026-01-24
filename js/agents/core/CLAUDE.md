# core - 微内核核心

提供 Kernel、三大总线、插件系统、CRDT 共识层和沙箱执行环境。

## API 层次

| Level | API | 用途 |
|-------|-----|------|
| 0 | `quickKernel()`, `minimalKernel()` | 一行创建 |
| 0.5 | `isServiceProvider()`, `adaptProvider()` | 兼容旧 ServiceProvider |
| 1 | `KernelBuilder` | 链式配置 |
| 2 | `new Kernel()` + `usePreset()` | 完整控制 |
| 3 | `EventBus`, `StateBus`, `ServiceBus` | 底层组件 |

## 核心文件

| 文件 | 职责 |
|------|------|
| `kernel.js` | Kernel 主类，生命周期管理 |
| `event-bus.js` | EventBus：发布/订阅、Lamport Clock、模式匹配 |
| `event-bus-subscriptions.js` | 事件订阅存储：精确/通配/优先级订阅与退订 |
| `event-bus-utils.js` | 事件名/模式校验、模式匹配工具（支持 `:` 与 `.` 分隔；支持 `*`/`?`） |
| `state-bus.js` | 细粒度状态订阅 |
| `service-bus.js` | 服务注册/发现 + Retry/Timeout/Cache 代理 |
| `message-bus.js` | 跨 Agent 消息传递 |
| `plugin.js` | `createPlugin`, PluginManager, PluginContext |
| `presets.js` | 预设配置 (minimal/standard/deepsearch/production) |
| `compat.js` | 旧 API 兼容层：旧 ServiceProvider → 新 Plugin (`adaptProvider`) |
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

## 事件命名与模式匹配

- 推荐事件名格式：`domain:action`（例如 `agent:step`）。
- 兼容格式：`domain.action`（历史/兼容用途；新代码仍建议用 `:`）。
- 支持通配符：
  - `*`：多字符通配
  - `?`：单字符通配

```javascript
// 模式匹配
eventBus.on('agent:*', handler);       // 通配符
eventBus.on('llm:complete', handler);  // 精确匹配
eventBus.on('*', handler);             // 监听所有事件（谨慎使用，注意性能与泄漏）

// 兼容命名
eventBus.on('agent.step', handler);
```

## 旧 ServiceProvider 兼容（compat）

当你有历史的 `ServiceProvider`（旧接口）需要在新 Kernel 中使用：

```javascript
import { isServiceProvider, adaptProvider } from 'js/agents/core';

if (isServiceProvider(legacyProvider)) {
  const plugin = adaptProvider(legacyProvider);
  kernel.use(plugin); // 具体挂载方式以 Kernel API 为准
}
```

约定（最低要求）：
- `provider.register(kernelCompat)` 必须存在
- 可选：`provider.start(kernelCompat)` / `provider.stop(kernelCompat)`
- 建议提供稳定的 `provider.name`，用于生成插件名 `compat/<name>`

## 安全插件加载

```javascript
import { SecurePluginLoader } from 'js/agents/core';

const loader = new SecurePluginLoader({ baseUrl: 'https://cdn.example.com' });

// 加载远程插件（SRI 验证）
const plugin = await loader.loadPlugin('/plugins/analytics.js', {
  integrity: 'sha256-abc123...',
});

// 批量加载
const { loaded, failed } = await loader.loadPlugins({
  plugins: [
    { url: '/plugins/a.js', integrity: 'sha256-...' },
    { url: '/plugins/b.js', integrity: 'sha256-...' },
  ],
});

for (const p of loaded) kernel.use(p);
if (failed.length) console.warn('Some plugins failed:', failed);
```
