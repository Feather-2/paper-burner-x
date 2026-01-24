# di - 依赖注入

IoC 容器，管理服务生命周期与解析规则（支持父子容器，便于测试/覆写）。

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | 入口 |
| `container.js` | `Container` - IoC 容器实现（scope、懒加载、父子容器） |
| `defaults.js` | 默认服务注册（`ServiceId` 与预置容器工厂） |
| `global-container.js` | 全局容器单例（兼容层；仅供 legacy `getGlobalX()` 使用） |

## 生命周期（Scope）

```javascript
export const SINGLETON = Symbol('singleton'); // 单例：同一容器内只创建一次
export const TRANSIENT = Symbol('transient'); // 瞬时：每次解析创建新实例
```

## 解析规则（父子容器）

- `new Container(parent)` 用于“测试容器覆写 + 回退父容器”的场景。
- 解析顺序：先当前容器，再回退到 `parent`（若存在）。
- 建议：生产代码显式传递 `container`；测试用 child container 注入 mock/override。

## `tryGet` 的告警行为

- `tryGet(id)` 适用于“筛选依赖”：未注册时返回 `undefined`，并在非 production 环境默认 `console.warn` 提示。
- 生产环境判定（兼容浏览器/Node，且避免硬引用 Node 全局）：
  - 优先读取 `globalThis.process?.env?.NODE_ENV === 'production'`
  - 其次读取 `import.meta.env?.MODE === 'production'`
  - 若两者均不可用/访问抛错，则默认视为非 production（会 warn）

## Browser-first 兼容性

- 该模块应保持 ES Modules（`import/export`），避免 `require()`、`__dirname`、`__filename`。
- 默认服务（`defaults.js`）如依赖 Node-only 能力（如文件锁、磁盘 I/O），建议：
  - 将 Node-only 默认注册拆分到独立入口（例如 `defaults.node.js`），或
  - 在工厂内部使用动态 `import()` 并做环境判断，避免浏览器打包时静态引入 Node-only 依赖。

## 使用示例

```javascript
import { Container, SINGLETON, TRANSIENT, ServiceId } from 'js/agents/runtime/di';

const container = new Container();

// 注册单例
container.register(ServiceId.LOGGER, () => console, { scope: SINGLETON });

// 注册工厂（支持 async factory）
container.register(
  ServiceId.EVENT_BUS,
  async (c) => {
    const logger = await c.get(ServiceId.LOGGER);
    return { logger };
  },
  { scope: TRANSIENT }
);

// 解析（异步工厂需要 await）
const eventBus = await container.get(ServiceId.EVENT_BUS);
```

## 常用 API

```javascript
// 注册常量
container.registerValue(ServiceId.LOGGER, console);

// 覆盖/重置（测试用；生产代码避免使用 override/reset 影响全局稳定性）
container.override(ServiceId.LOGGER, () => ({ info() {}, warn() {}, error() {} }));
container.reset();

// 读取与枚举
const logger = container.tryGet(ServiceId.LOGGER);
const ids = container.getServiceIds();
```

## 预置容器

```javascript
import { createAgentContainer, createTestContainer, ServiceId } from 'js/agents/runtime/di';

// 生产容器（overrides 为 factory 映射）
const container = createAgentContainer({
  [ServiceId.LOGGER]: () => console,
});

// 测试容器（推荐：每个用例创建一次，避免全局单例污染）
const testContainer = createTestContainer({
  [ServiceId.LOGGER]: () => console,
});
```

## Global Container（兼容层）

- `global-container.js` 提供 process-wide 容器，仅用于 legacy `getGlobalX()`。
- 新代码：通过参数传递 `container`，并用 `ServiceId` 显式解析依赖。
- 插件/技能隔离：避免向不可信插件暴露全局容器对象；推荐为插件创建 child container，并仅暴露只读 resolve 能力（或白名单 ServiceId），防止覆盖 `Kernel/EventBus/StateBus` 等关键单例。
