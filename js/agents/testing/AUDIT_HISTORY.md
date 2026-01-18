# Audit History - testing

Archived issues from security audits.

---

## Archived: 2026-01-18

### [RESOLVED] JSDoc
*Archived: 2026-01-18T22:13:45.333Z*

- **File**: js/agents/testing/mock-suite.js:45
- **Description**: 多个导出 API 仅有描述性注释，缺少 @param/@returns/@typedef，未满足项目 JSDoc 类型注解要求，影响类型提示与静态检查。
- **Suggestion**: 为 MockModelClient.chat/ask、MockMcpProvider.search/fetch/callTool、MockServer.fetch、ScenarioRunner.run/runAll、createMockTestEnv 等补全 JSDoc，并为 options/steps 结构定义 @typedef。
```
/**
   * 模拟 chat 调用
   */
  async chat(options) {
```

### [RESOLVED] AsyncErrorHandling
*Archived: 2026-01-18T22:13:45.333Z*

- **File**: js/agents/testing/mock-suite.js:500
- **Description**: MockResponse.json 直接 JSON.parse，body 非合法 JSON 会抛出异常，导致 Promise reject 且错误上下文不足。
- **Suggestion**: 加入 try/catch，抛出更明确的错误或返回可断言的错误对象，避免测试中断缺少上下文。
```
async json() {
    const text = await this.text();
    return JSON.parse(text);
  }
```

### [RESOLVED] Convention
*Archived: 2026-01-18T22:13:45.333Z*

- **File**: js/agents/testing/mock-suite.js:263
- **Description**: MockEventBus 的示例事件名使用 "event"，未遵循 domain:action 约定，可能误导测试用例命名。
- **Suggestion**: 将示例改为如 `test:done`、`mcp:call` 等符合规范的事件名。
```
* - assertEmitted("event", 2) // 触发 2 次
```

---

