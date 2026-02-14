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
- 事件名与模式由 `event-bus-utils.js` 统一校验，支持 `:` 与 `.` 分隔
- 支持 `*` / `?` 通配规则的模式匹配
- 背压默认参数在 `event-bus-helpers.js` 统一定义
- 对 RegExp 相关路径使用安全测试与输入校验，避免异常模式影响调度
- 监听器应在插件停止或上下文释放时退订，防止内存泄漏

## StateBus 要点

- 提供细粒度状态订阅，减少无关更新传播
- 建议通过受控状态变更路径更新数据，避免共享可变对象导致竞态
- 对高并发更新场景需明确冲突处理策略

## ServiceBus 要点

- 提供服务注册/发现与统一调用入口
- 内置 Retry/Timeout/Cache 代理能力
- 服务命名遵循 camelCase，便于跨模块一致发现与治理

## MessageBus 要点

- 基于 EventBus 提供 RPC 请求-响应语义
- 用于跨 Agent/Stage 的通信编排
- 请求侧应配置超时与错误回传策略，避免悬挂请求

## Plugin 与安全边界

- 使用 `createPlugin` 定义插件，统一接入生命周期
- PluginManager 负责安装与生命周期调度
- PluginContext 提供受控能力入口，减少对内核内部状态的直接耦合
- 远程插件加载通过 `secure-plugin-loader.js` 执行 SRI 校验
- 不可信插件建议结合 `sandbox/` 子模块隔离运行

## 维护与测试建议

- 事件名遵循 `domain:action`（如 `agent:step`）
- 异步调用要么显式处理异常，要么向上抛出
- 避免 `eval` / `new Function` / 未校验动态执行路径
- 重点测试：状态机转换、并发安全、插件生命周期、监听器释放
- 覆盖率目标 ≥ 90%（最低不低于 70%）
