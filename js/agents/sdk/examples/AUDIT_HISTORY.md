# Audit History - examples

Archived issues from security audits.

---

## Archived: 2026-01-18

### [RESOLVED] 类型安全/JSDoc
*Archived: 2026-01-18T21:26:50.558Z*

- **File**: js/agents/sdk/examples/subagent-usage.js:17
- **Description**: JSDoc 使用 `Promise<any>`，违反禁止 any 的规范，降低类型安全（同样问题出现在 line 30）。
- **Suggestion**: 在文件顶部定义具体返回类型（`@typedef`）或引用 SDK 的 Agent 类型，并改为 `@returns {Promise<Agent>}`。
```
/**
 * 创建探索子代理
 * @param {{ prompt: string, model: string }} options
 * @returns {Promise<any>}
 */
```

### [RESOLVED] JSDoc 参数描述缺失
*Archived: 2026-01-18T21:26:50.558Z*

- **File**: js/agents/sdk/examples/subagent-usage.js:16
- **Description**: `@param` 缺少描述，且解构参数没有说明用途，影响可读性。
- **Suggestion**: 补充描述，如 `@param {{ prompt: string, model: string }} options - 子代理创建参数`，或拆分为 `options.prompt`/`options.model`。
```
* @param {{ prompt: string, model: string }} options
```

### [RESOLVED] JSDoc 返回值描述缺失
*Archived: 2026-01-18T21:26:50.558Z*

- **File**: js/agents/sdk/examples/basic-usage.js:89
- **Description**: 导出的 `runExamples`/`runDemo` 等公共 API 仅标注类型，缺少返回值描述，不符合 JSDoc 规范（其他示例文件同样存在）。
- **Suggestion**: 补充返回值描述，例如 `@returns {Promise<void>} 执行示例并输出日志`，并同步到其他 exported 入口。
```
/**
 * 运行所有示例
 * @returns {Promise<void>}
 */
```

### [RESOLVED] 事件命名格式
*Archived: 2026-01-18T21:26:50.558Z*

- **File**: js/agents/sdk/examples/basic-usage.js:35
- **Description**: 事件名示例使用 `demo.*`，与约定的 `domain:action` 格式不一致，可能误导使用者。
- **Suggestion**: 改为 `demo:emit` 或保留通配语义但使用 `demo:*` 并注明命名约定。
```
.onEvent("demo.*", (event) => {
```

### [RESOLVED] 输入验证缺失
*Archived: 2026-01-18T21:26:50.558Z*

- **File**: js/agents/sdk/examples/basic-usage.js:20
- **Description**: 能力处理函数直接使用 `args.text/name/query` 等输入，缺少类型/边界检查；作为示例可能被直接复制到生产。
- **Suggestion**: 在 handler 内做基本校验/默认值（例如 `typeof args.text === 'string'`），或展示轻量校验器用法。
```
.useCapability("echo", async (args) => ({
```

### [RESOLVED] 浏览器兼容性
*Archived: 2026-01-18T21:26:50.558Z*

- **File**: js/agents/sdk/examples/basic-usage.js:107
- **Description**: 入口判断依赖 `process.argv`，属于 Node-only API；若在浏览器打包或运行会报错（其他示例也有同样写法）。
- **Suggestion**: 添加 `typeof process !== 'undefined'` 保护或移至独立 Node-only 入口文件。
```
if (import.meta.url === `file://${process.argv[1]}`) {
```

---

