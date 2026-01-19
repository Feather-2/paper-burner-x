# di - 依赖注入

IoC 容器，管理服务生命周期。

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | 入口 |
| `container.js` | Container - IoC 容器 |
| `defaults.js` | 默认服务注册 |
| `global-container.js` | 全局容器单例 |

## 生命周期

```javascript
const SINGLETON = Symbol("singleton"); // 单例
const TRANSIENT = Symbol("transient"); // 每次创建新实例
```

## 使用示例

```javascript
import { Container, SINGLETON, TRANSIENT, ServiceId } from "js/agents/runtime/di";

const container = new Container();

// 注册单例
container.register(ServiceId.LLM, () => new LlmProvider(), { scope: SINGLETON });

// 注册工厂
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
