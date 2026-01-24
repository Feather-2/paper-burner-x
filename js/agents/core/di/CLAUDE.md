# di - 依赖注入

IoC 容器，管理服务生命周期与解析规则（支持父子容器，便于测试/覆写）。

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | 入口 |
| `container.js` | Container - IoC 容器实现（scope、懒加载、父子容器） |
| `defaults.js` | 默认服务注册（ServiceId 与预置容器工厂） |
| `global-container.js` | 全局容器单例（兼容层；仅供 legacy getGlobalX 使用） |

## 生命周期（Scope）

```javascript
export const SINGLETON = Symbol("singleton"); // 单例：同一容器内只创建一次
export const TRANSIENT = Symbol("transient"); // 瞬时：每次解析创建新实例
```

## 解析规则（父子容器）

- `Container` 可选传入 `parent`，用于“测试容器覆写 + 回退父容器”的场景。
- 解析顺序：先当前容器，再回退到 `parent`（若存在）。
- 建议：生产代码显式传递 `container`；测试用 child container 注入 mock/override。

## `tryGet` 的告警行为

- `tryGet(id)` 适用于“厠选依赖”：未注册时返回 `undefined`，并在非 production 环境默认 `console.warn` 提示。
- 生产环境判定：`process.env.NODE_ENV === "production"` 或 `import.meta.env.MODE === "production"` 时默认不 warn。

## 使用示例

```javascript
import { Container, SINGLETON, TRANSIENT, ServiceId } from "js/agents/runtime/di";

const container = new Container();

// 注册单例
container.register(ServiceId.LLM, () => new LlmProvider(), { scope: SINGLETON });

// 注册工厂（支持 async factory）
container.register(
  ServiceId.AGENT,
  async (c) => {
    return new Agent({
      llm: await c.get(ServiceId.LLM),
      eventBus: await c.get(ServiceId.EVENT_BUS),
    });
  },
  { scope: TRANSIENT }
);

// 解析（异步工厂需要 await）
const agent = await container.get(ServiceId.AGENT);
```

## 常用 API

```javascript
// 注册常量
container.registerValue(ServiceId.LOGGER, console);

// 覆盖/重置（测试用）
container.override(ServiceId.LLM, () => mockLlm);
container.reset();

// 读取与枚举
const logger = container.tryGet(ServiceId.LOGGER);
const ids = container.getServiceIds();
```

## 预置容器

```javascript
import { createAgentContainer, createTestContainer, ServiceId } from "js/agents/runtime/di";

// 生产容器（overrides 为 factory 映射）
const container = createAgentContainer({
  [ServiceId.LOGGER]: () => customLogger,
});

// 测试容器（mocks 为 value 映射）
const testContainer = createTestContainer({
  [ServiceId.LLM]: mockLlm,
});
```

## 全局容器（legacy）

- `global-container.js` 是兼容层：仅用于旧的 `getGlobalX()` 访问器。
- 新代码避免依赖全局容器：它会削弱插件隔离与可测试性（更难控制依赖边界）。
