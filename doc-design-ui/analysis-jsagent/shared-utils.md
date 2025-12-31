# Analysis: Shared Utils & Optimization (共享工具与优化)

## 1. 架构 (Architecture)

### 原子工具库 (`js/agents/shared/utils/`)
这些工具是整个 `js/agents` 系统的细胞，支撑着高层逻辑的健壮性：
- **`stage-api.js`**: 核心服务注入点。通过 `createStageApi` 为各阶段提供统一的 `signal`, `emit`, `modelRouter` 等接口。支持 `validateStageApi` 契约校验，确保服务注入的完整性。
- **`value-utils.js`**: 语义化值处理中心。提供了 `toNonEmptyString`, `safeInt` 等具备明确空值行为的转换工具。
- **`budget.js`**: 专门用于 Token 和成本预算的管理，防止单次任务出现非预期的费用。
- **`robust-json.js`**: 针对 LLM 输出不稳定的特性，实现了带有容错能力的 `robustParseJson`。
- **`message-utils.js`**: 封装了 `injectSystemHint` 等逻辑，用于在对话历史中动态插入系统提示。

## 2. 优化 Trick (Optimization Tricks)

- **中英文混合 Token 估算**: `estimateTokenCount` 采用差异化估算（英文 1:4，中日韩 1:1.6），比单纯的字符计数更接近 OpenAI 等主流模型的计费标准。
- **深度克隆隔离**: `deepClone` 原生支持 `Map` 和 `Set`，确保“春秋蝉”回溯系统在快照恢复时彻底切断对象引用。
- **JSON 序列化清理**: `sanitizeForJson` 自动处理循环引用并将其替换为 `[Circular]`，同时清理不可序列化的函数和 Symbol，保证了存档操作的原子性。
- **阶段 API 合并**: 通过 `mergeStageApis` 和 `createChildApi` 实现了服务能力的层级继承，降低了复杂流水线中的配置重复。

## 3. 对比 Claude Code (analysis-cc) 的优势与差距

- **优势**: 我们的 **值处理契约**（`value-utils.js`）非常严谨。每个函数都有明确的失效返回值（如 `undefined` 或 `null`），减少了高层逻辑中的隐式 Bug。
- **优势**: **深度对象克隆能力**。由于我们大量使用 Map/Set 维护状态，`deepClone` 对这些类型的原生支持使我们的快照系统比 Claude Code 更易于扩展。
- **差距**: Claude Code 在 `utils/terminal-setup.ts` 中对终端交互（如 Spinner, Progress Bar）的封装非常精致。
- **改进点**: 借鉴 Claude Code 的 `system-prompt-cache` 哈希机制，在 `stage-api` 层面对高频使用的提示词进行指纹识别和缓存。
