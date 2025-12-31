# CLI 文件夹审查报告 (js/agents/cli)

## 1. 潜在问题清单

### 1.1 安全性问题 (Security)
- **API Key 泄露风险**: `js/agents/cli/config.json` 中直接包含了硬编码的 `apiKey` (sk-rbgqjt...)。虽然 store 中可能是一个测试 Key，但不应提交到代码库中。
- **敏感信息暴露**: `demo.js` 在打印事件时使用 `JSON.stringify(payload)`，如果 payload 包含敏感信息（如 API Key 注入到 Prompt 中后的反馈），会直接输出到控制台。

### 1.2 健壮性与错误处理 (Robustness)
- **网络异常处理**: `CliModelClient.chat` 使用了原生 `fetch`，但没有处理超时 (timeout) 情况。在长时间没有响应时，Agent 可能会挂起。
- **API 错误处理**: `CliModelClient.chat` 仅截取了前 200 个字符 of 错误信息。对于复杂的 API 错误（如 Rate Limit 携带的具体重试时间），这些信息可能不够。
- **配置文件缺失处理**: 虽然 `CliModelRouter` 构造函数有警告，但如果 `config.json` 不存在且没有环境变量，直到调用 `getClient` 时才会抛出 Error。

### 1.3 代码质量与维护性 (Maintainability)
- **代码重复**: `demo.js` 中的帮助信息（第 21-42 行）提到的环境变量和选项，与 `model-client.js` 中的默认值（如 `https://api.deepseek.com/v1`）存在硬编码重复。
- **幻数与硬编码**:
    - `model-client.js` 中硬编码了 `https://api.deepseek.com/v1`。
    - `config.json` 中 `vision` 模型被配置为 `gpt-5.2`，这显然是一个占位符。
- **过时的注释**: `demo.js` 第 30 行提到 `node js/agents/sdk/cli-demo.js`，但实际路径是 `js/agents/cli/demo.js`。
- **类型定义不一致**: `model-client.js` 定义了 `@typedef {{models: Record<string, ModelConfig>, roles: Record<string, string>, default: string}} CliConfig`，但实际 `config.json` 中使用的是 `tiers` 而不是 `roles`（虽然代码里有兼容逻辑）。

### 1.4 功能缺陷 (Functional Gaps)
- **上下文截断缺失**: `CliModelClient` 接收 `maxTokens` 但没有对输入 `messages` 进行 token 计算和截断保护，如果上下文过长会直接导致 API 报错。
- **AbortSignal 传递**: `CliModelClient.chat` 没有接收并传递 `AbortSignal` 给 `fetch`，导致即使 `context.signal` 触发了，底层的 HTTP 请求也不会被取消。

## 2. 改进建议
1. **清理配置**: 立即删除 `config.json` 中的实际 API Key，并确保 `.gitignore` 包含该文件。
2. **增强 fetch**: 为 `CliModelClient.chat` 添加超时控制和 `AbortSignal` 支持。
3. **完善类型**: 统一 `CliConfig` 的定义，优先推荐 `tiers` 结构，并提供更清晰的示例。
4. **路径同步**: 修正 `demo.js` 中的帮助文档路径。
5. **日志增强**: 允许在 `CliModelRouter` 中配置日志级别，避免在生产或集成测试中打印过多的控制台信息。

## cc是如何解决这个问题的

Claude Code (CC) 在其实现中通过以下方式解决了上述 CLI 相关问题：

1.  **安全性问题**:
    *   **API Key 保护**: CC 使用专门的敏感数据扫描器 ([`src/security/sensitive.ts`](ref/claude-code-open-main/src/security/sensitive.ts))。它定义了大量的正则表达式模式（如 `Anthropic API Key`, `OpenAI API Key` 等）来检测代码和日志中的敏感信息。
    *   **脱敏输出**: 提供了 `maskSensitive` 和 `createMaskedValue` 函数，在将数据输出到终端或上传日志前，会自动对检测到的敏感信息进行脱敏处理（保留前后 4 位，中间遮盖）。
    *   **纯浏览器端适配**: 这种基于正则表达式的扫描器可以直接运行在 Web Worker 或主线程中，无需 Node.js 环境。

2.  **网络与健壮性**:
    *   **超时控制**: CC 封装了通用的超时处理机制 ([`src/network/timeout.ts`](ref/claude-code-open-main/src/network/timeout.ts))，利用 `AbortSignal.timeout`（或其兼容实现）为 fetch 请求提供强制超时限制。
    *   **错误重试**: 通过 `withRetry` 函数 ([`src/network/retry.ts`](ref/claude-code-open-main/src/network/retry.ts))，CC 支持指数退避和抖动（Jitter）策略。它不仅检查 HTTP 状态码（如 429, 5xx），还会根据错误消息内容判断是否可重试。
    *   **纯浏览器端适配**: 浏览器原生支持 `AbortController` 和 `fetch` 的信号中断，CC 的这套封装完全适用于浏览器环境。

3.  **功能缺陷与上下文管理**:
    *   **Token 估算与截断**: CC 拥有复杂的 `SystemPromptBuilder` ([`src/prompt/builder.ts`](ref/claude-code-open-main/src/prompt/builder.ts))。在构建请求前，它会调用 `estimateTokens` 对内容进行估算，并定义了优先级截断逻辑（优先保留身份信息、输出风格和代码指南，截断附件）。
    *   **Aborting**: 所有的核心异步操作都接收并透传 `AbortSignal`，确保用户取消操作或界面销毁时能立即停止网络请求和计算任务。
    *   **纯浏览器端适配**: 这种在客户端进行 Token 估算和主动截断的做法，能有效减少浏览器端因请求过大而导致的内存压力和网络失败风险。
