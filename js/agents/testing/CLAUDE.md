# testing - 测试工具

单元测试和集成测试辅助。

## 文件

| 文件 | 职责 |
|------|------|
| `mock-suite.js` | Mock 对象套件 |

## Mock 套件

提供测试用的 Mock 实现：

```javascript
import { MockSuite } from 'js/agents/testing/mock-suite.js';

const mocks = new MockSuite();

// Mock LLM
mocks.mockLlm((messages) => ({
  content: 'Mocked response',
  usage: { total_tokens: 10 },
}));

// Mock MCP
mocks.mockMcp('web_search', (args) => ({
  results: [{ title: 'Test', url: 'https://...' }],
}));
```
