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
const SINGLETON = 'singleton';  // 单例
const TRANSIENT = 'transient';  // 每次创建新实例
```

## 使用示例

```javascript
import { Container, SINGLETON, TRANSIENT, ServiceId } from 'js/agents/runtime/di';

const container = new Container();

// 注册单例
container.register(ServiceId.LLM, LlmProvider, SINGLETON);

// 注册工厂
container.registerFactory(ServiceId.AGENT, (c) => {
  return new Agent({
    llm: c.resolve(ServiceId.LLM),
    eventBus: c.resolve(ServiceId.EVENT_BUS),
  });
}, TRANSIENT);

// 解析
const agent = container.resolve(ServiceId.AGENT);
```

## 预置容器

```javascript
import { createAgentContainer, createTestContainer } from 'js/agents/runtime/di';

// 生产容器
const container = createAgentContainer({ config });

// 测试容器 (带 Mock)
const testContainer = createTestContainer({ mockLlm: true });
```
