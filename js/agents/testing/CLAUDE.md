# testing - 测试工具

单元测试和集成测试辅助，提供 Mock 测试环境与场景回放。

## 文件

| 文件 | 职责 |
|------|------|
| `mock-suite.js` | MockModelClient / MockMcpProvider / MockEventBus / MockServer / ScenarioRunner / createMockTestEnv |

## Mock 套件

核心导出：
- MockModelClient: 模拟 LLM 响应（chat 接口）
- MockMcpProvider: 模拟 MCP 工具调用（tools 路由）
- MockEventBus: 事件捕获和断言（事件名建议使用 domain:action）
- MockServer: fetch 兼容的 Mock 服务（路由响应）
- ScenarioRunner: 预定义场景回放（input/toolCall/assertEvent）
- createMockTestEnv: 一键创建测试环境（组合 model/mcp/eventBus/server/runner）

## 类型定义（JSDoc）

- ChatOptions: `{ messages, usage? }`
- ChatResponse: `{ content, model, usage, finish_reason, system_fingerprint, logprobs }`
- ScenarioStep: `{ input?, expectedOutput?, toolCall?, args?, expectedResult?, assertEvent?, eventCount? }`
- Scenario: `{ name, steps, setup?, teardown? }`
- ScenarioResult: `{ name, passed, steps, errors }`
- MockTestEnvOptions: `{ model?, mcp? }`

## ScenarioRunner 场景格式

- `input` / `expectedOutput`: 走 MockModelClient（断言模型输出）
- `toolCall` / `args` / `expectedResult`: 走 MockMcpProvider（断言工具调用结果）
- `assertEvent` / `eventCount`: 走 MockEventBus（断言事件触发次数）

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

// 场景回放：同时覆盖 LLM 输出、工具调用、事件断言
const runner = new ScenarioRunner({ modelClient, mcpProvider, eventBus });
await runner.run({
  name: 'basic',
  steps: [
    { input: 'hello', expectedOutput: 'OK' },
    { toolCall: 'search', args: { query: 'a' }, expectedResult: { success: true } },
    { assertEvent: 'agent:step', eventCount: 1 },
  ],
});

// Mock fetch
const server = new MockServer().setJsonResponse('/health', { ok: true });
await server.fetch('http://mock.local/health');

// 一键环境（可用 options 覆盖默认 mock 行为）
const env = createMockTestEnv({ model: { responses: { default: 'OK' } } });
const stageApi = env.createStageApi();
stageApi.emit('agent:step', { ok: true });
```
