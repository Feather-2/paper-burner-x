# core - 微内核核心

提供 Kernel、四大总线、插件系统、CRDT 共识层和沙箱执行环境，并提供旧 ServiceProvider → 新 Plugin 的兼容层（含 register/start/stop 生命周期桥接）。

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
| `event-bus.js` | EventBus：发布/订阅、Lamport Clock、模式匹配、背压调度 |
| `event-bus-helpers.js` | EventBus 辅助函数：RegExp 安全测试、RunStore 适配校验、背压默认参数 |
| `event-bus-subscriptions.js` | 事件订阅存储：精确/通配/优先级订阅与退订 |
| `event-bus-utils.js` | 事件名/模式校验、模式匹配工具（支持 `:` 与 `.` 分隔；支持 `*`/`?`） |
| `event-record.js` | 事件记录结构与标准化工具 |
| `state-bus.js` | 细粒度状态订阅 |
| `service-bus.js` | 服务注册/发现 + Retry/Timeout/Cache 代理 |
| `message-bus.js` | MessageBus：RPC over EventBus，跨 Agent/Stage 请求-响应通信 |
| `plugin.js` | `createPlugin`, PluginManager, PluginContext |
| `presets.js` | 预设配置（minimal/standard/deepsearch/production） |
| `compat.js` | 旧 API 兼容层：旧 ServiceProvider → 新 Plugin，映射 register/start/stop 生命周期 |
| `secure-plugin-loader.js` | SecurePluginLoader：远程插件 SRI 验证加载 |

## 子模块索引

| 子模块 | 路径 | 职责 |
|--------|------|------|
| **crdt** | `crdt/` | CRDT 共识：LWWRegister, GCounter, PNCounter, LWWMap, ORSet, CRDTDocument |
| **sandbox** | `sandbox/` | 沙箱隔离：WASM (QuickJS) + System (Bubblewrap/Seatbelt/Docker) |

## 旧 Provider 兼容（ServiceProvider → Plugin）

- 旧接口：`provider.register(kernel)`（必需）
- 可选生命周期：`provider.start(kernel)`、`provider.stop(kernel)`
- 识别函数：`isServiceProvider(value)`
- 适配函数：`adaptProvider(provider)`

生命周期映射关系：

- `register(kernel)` → Plugin `install(ctx)`
- `start(kernel)` → Plugin `onStart(ctx)`
- `stop(kernel)` → Plugin `onStop(ctx)`

兼容层通过 `createKernelCompat(ctx)` 提供旧接口所需的桥接能力（事件、状态、服务、日志等），用于平滑迁移到新 Plugin 体系。

## EventBus 要点

- 支持精确订阅、通配订阅与优先级订阅
- 背压默认参数在 `event-bus-helpers.js` 统一定义
- 对 RegExp 匹配重置 `lastIndex`，避免 `/g`、`/y` 引发状态污染
- RunStore 适配器在运行时校验 `getEvents`、`appendEvents/appendEvent` 形状

## 常用模式

```javascript
import { createPlugin, adaptProvider, isServiceProvider } from 'js/agents/core';

const analyticsPlugin = createPlugin({
  name: 'analytics',
  async install(ctx) {
    const off = ctx.events.on('agent:step', (event) => track(event), { priority: 10 });
    return () => off();
  }
});

if (isServiceProvider(legacyProvider)) {
  kernel.use(adaptProvider(legacyProvider));
}
```

## 稳定性建议

- Kernel/EventBus/StateBus 属于全局关键路径，插件不可直接改写内核私有状态
- 兼容层内部状态建议使用私有符号或闭包，避免与其他插件上下文字段冲突
- 长生命周期订阅必须在卸载时显式退订，避免监听器泄漏
- 外部输入（provider 名称、配置对象、事件 payload）应做类型与边界校验

## 测试建议

- 状态机转换：覆盖 install/start/stop/error 分支
- 并发安全：覆盖并发 emit 与优先级订阅排序稳定性
- 插件生命周期：覆盖 legacy provider 注册、启动、停止一致性
- 覆盖率目标：模块级 ≥ 90%，最低 ≥ 70%
