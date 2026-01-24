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

- ChatOptions: `{ messages: Array<{ role, content }>, usage? }`
- ChatResponse: `{ content, model, usage: { total_tokens }, finish_reason, system_fingerprint, logprobs }`
- ScenarioStep: `{ input?, expectedOutput?, toolCall?, args?, expectedResult?, assertEvent?, eventCount? }`
- Scenario: `{ name, steps, setup?, teardown? }`
- ScenarioResult: `{ name, passed, steps: Array<{ index, passed, output?, error? }>, errors }`
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
    // 建议工具函数签名以 args 对象为入参，避免位置参数扩展困难
    search: ({ query }) => ({ success: true, results: [{ title: `Result: ${query}` }] }),
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

// Mock fetch（路由与响应配置以 mock-suite.js 的 MockServer API 为准）
const server = new MockServer();
// e.g. 将 server 作为 fetch 替身注入到被测代码中（或使用 createMockTestEnv 组合注入）
```
