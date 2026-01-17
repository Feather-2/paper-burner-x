# core - 微内核核心

提供 Kernel、三大总线、插件系统、CRDT 共识层和沙箱执行环境。

## API 层次

| Level | API | 用途 |
|-------|-----|------|
| 0 | `quickKernel()`, `minimalKernel()` | 一行创建 |
| 1 | `KernelBuilder` | 链式配置 |
| 2 | `new Kernel()` + `usePreset()` | 完整控制 |
| 3 | `EventBus`, `StateBus`, `ServiceBus` | 底层组件 |

## 核心文件

| 文件 | 职责 |
|------|------|
| `kernel.js` | Kernel 主类，生命周期管理 |
| `event-bus.js` | EventBus + Lamport Clock + 模式匹配 |
| `state-bus.js` | 细粒度状态订阅 |
| `service-bus.js` | 服务注册/发现 + Retry/Timeout/Cache 代理 |
| `message-bus.js` | 跨 Agent 消息传递 |
| `plugin.js` | createPlugin, PluginManager, PluginContext |
| `presets.js` | 预设配置 (minimal/standard/deepsearch/production) |
| `compat.js` | 旧 API 兼容层 |
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
    ctx.events.on('agent:step', (e) => track(e));
  }
});

// 服务代理
import { createRetryProxy, createCacheProxy } from 'js/agents/core';

const robustService = createRetryProxy(
  createCacheProxy(originalService, { ttl: 5000 }),
  { maxRetries: 3 }
);
```

## 事件模式匹配

```javascript
eventBus.on('agent:*', handler);      // 通配符
eventBus.on('llm:complete', handler); // 精确匹配
```

## 安全插件加载

```javascript
import { SecurePluginLoader } from 'js/agents/core';

const loader = new SecurePluginLoader({ baseUrl: 'https://cdn.example.com' });

// 加载远程插件 (SRI 验证)
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
```
