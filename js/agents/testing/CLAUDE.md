# testing - 测试工具

单元测试和集成测试辅助，提供 Mock 测试环境与场景回放。

## 文件

| 文件 | 职责 |
|------|------|
| `mock-suite.js` | MockModelClient / MockMcpProvider / MockEventBus / MockServer / ScenarioRunner / createMockTestEnv |

## Mock 套件

核心导出：
- MockModelClient: 模拟 LLM 响应
- MockMcpProvider: 模拟 MCP 工具调用
- MockEventBus: 事件捕获和断言
- MockServer: fetch 兼容的 Mock 服务
- ScenarioRunner: 预定义场景回放
- createMockTestEnv: 一键创建测试环境

### 使用示例

```javascript
import {
  MockModelClient,
  MockMcpProvider,
  MockEventBus,
  MockServer,
  ScenarioRunner,
  createMockTestEnv,
} from 'js/agents/testing/mock-suite.js';

// 独立组件
const modelClient = new MockModelClient({ responses: { default: 'OK' } });
const mcpProvider = new MockMcpProvider({
  tools: {
    search: (query) => ({ success: true, results: [{ title: `Result: ${query}` }] }),
  },
});
const eventBus = new MockEventBus();
eventBus.on('agent:step', () => {});

// 场景回放
const runner = new ScenarioRunner({ modelClient, mcpProvider, eventBus });
await runner.run({ name: 'basic', steps: [{ input: 'hello', expectedOutput: 'OK' }] });

// Mock fetch
const server = new MockServer().setJsonResponse('/health', { ok: true });
await server.fetch('http://mock.local/health');

// 一键环境
const env = createMockTestEnv();
const stageApi = env.createStageApi();
stageApi.emit('agent:step', { ok: true });
```
