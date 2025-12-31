# Prompts 文件夹审查报告 (js/agents/prompts)

## 1. 潜在问题清单

### 1.1 提示词加载与管理 (Loader & Lifecycle)
- **缓存策略近似性**: `prompt-loader.js` 使用 Map 插入顺序近似 LRU（第 44 行）。虽然简单，但在频繁删除和重新插入时，性能在高负载下可能不如专门的 LRU 库。
- **环境检测脆弱**: `getBasePath`（第 73 行）包含大量的 if-else 逻辑来处理各种环境。在一些非标准的 Web Worker 或隔离沙箱环境下，可能无法正确识别路径，导致加载失败。
- **同步加载限制**: `loadPromptSync` 显式禁止了浏览器环境（第 217 行），这限制了前端在初始化阶段同步获取关键提示词的能力（虽然推荐异步，但在某些 Legacy 架构中可能需要）。

### 1.2 模版引擎 (Template Engine)
- **缺乏嵌套变量支持**: `renderPromptTemplate`（第 323 行）仅支持扁平化变量或带点的 Key，但不支持真正的嵌套对象递归解析。
- **错误可见性 vs 鲁棒性**: 默认保留未解析的占位符（`keepUnresolved = true`，第 323 行）。虽然方便调试，但如果模型误将 `{{VAR}}` 当作实际指令执行，可能导致意想不到的幻觉。
- **正则注入风险**: `escapeRegExp` 被用于占位符匹配（第 286, 346 行）。虽然处理了，但动态构建正则在大规模循环渲染时可能存在性能隐患。

### 1.3 提示词内容质量 (Content Quality)
- **过于庞大的 System Prompt**: `deepsearch/system.md` 极长（超过 1200 行）。虽然逻辑严密，但这占据了极大的输入 Context Window，并可能导致模型在执行中由于指令相互干扰而忽略某些约束。
- **过度约束风险**: `deepsearch/system.md` 中包含大量“强制”（强制触发、强制检查点等）指令（第 99, 872, 930 行）。过多的硬性规则可能削弱模型在面对非典型文档时的灵活性。
- **魔术变量依赖**: 提示词中大量使用 `{{minWords.quick}}` 等变量（第 1005 行）。如果 `config.json` 或 `vars` 传入不当，模型会看到未填充的占位符，严重影响输出。

### 1.4 安全性 (Security)
- **路径穿越验证强度**: `validateKey`（第 111 行）仅阻止了 `..` 和特殊字符。虽然足以防范大多数攻击，但没有校验加载的 Key 是否确实存在于预期的 `prompts` 子目录下。

## 2. 改进建议
1. **提示词精简**: 将 `deepsearch/system.md` 拆分为核心逻辑 + 按需加载的扩展模块（Skill 模式），减少单次请求的 Token 浪费。
2. **增强路径安全**: `loadPrompt` 在 Node 环境下已检查 `startsWith(basePath)`，建议在浏览器端也增加对 `filePath` 的有效域校验。
3. **引入模版校验**: 在渲染完成后，增加一个可选的校验步骤，如果发现未填充的 `{{VAR}}`，主动打印 Warning 或抛出异常。
4. **统一变量命名**: 建立严格的变量字典，避免 `currentDate` 和 `date` 这种命名不一致导致模版渲染失败。
5. **支持 Markdown 预编译**: 考虑在构建阶段将 Markdown 提示词转换为 JSON 或 JS 模块，减少运行时的 I/O 和解析开销。

## cc是如何解决这个问题的

Claude Code (CC) 通过模块化的提示词架构和严谨的构建流程解决了提示词臃肿及管理混乱的问题：

1.  **模块化系统提示词 (Modular System Prompt)**:
    *   **组件化拼接**: CC 并不使用单一的长 Markdown 文件，而是将系统提示词拆分为多个核心组件：`CORE_IDENTITY`, `TOOL_GUIDELINES`, `CODING_GUIDELINES`, `TASK_MANAGEMENT` 等 ([`src/prompt/templates.ts`](ref/claude-code-open-main/src/prompt/templates.ts))。
    *   **按需构建**: `SystemPromptBuilder` ([`src/prompt/builder.ts`](ref/claude-code-open-main/src/prompt/builder.ts)) 根据当前的 `PromptContext`（如环境信息、权限模式、诊断信息）动态组装提示词，避免了将无关指令塞进上下文。
    *   **纯浏览器端适配**: 这种基于 JS 字符串常量的组件化方案，避免了浏览器端频繁的 I/O 加载 Markdown 文件的开销，且非常容易进行代码拆分和按需加载。

2.  **智能 Token 估算与截断**:
    *   **优先级截断**: 当提示词超过 `maxTokens` 时，`SystemPromptBuilder` 会执行智能截断策略 ([`src/prompt/builder.ts`](ref/claude-code-open-main/src/prompt/builder.ts))。它会优先保留身份、任务和代码指南等核心部分，优先截断非核心的附件（Attachments），并插入 `<system-reminder>` 告知模型上下文已部分截断。
    *   **多语言感知**: 估算算法考虑了亚洲字符和代码块的不同比例，使得在混合语言环境下的估算更加精准。

3.  **高性能缓存系统**:
    *   **Hash 校验**: CC 实现了 `PromptCache` ([`src/prompt/cache.ts`](ref/claude-code-open-main/src/prompt/cache.ts))，利用 SHA-256 计算提示词内容的哈希。这不仅用于本地内存缓存，还能配合 LLM Provider 的 `system_prompt_hash` 实现 API 侧的缓存优化，显著降低首字延迟。
    *   **LRU 清理**: 缓存系统内置了基于 `expiresAt` 的清理机制和 `maxEntries` 限制，确保存储不会无限增长。

4.  **环境感知的动态注入**:
    *   **环境模板**: 提供了 `getEnvironmentInfo`, `getIdeInfo`, `getGitStatusInfo` 等一系列函数 ([`src/prompt/templates.ts`](ref/claude-code-open-main/src/prompt/templates.ts))。这些函数实时从当前运行环境提取数据，通过结构化的 `<env>` 标签注入到 Prompt 中，保证了模型始终拥有最新的上下文，解决了 jsagents 中“环境检测脆弱”的问题。
    *   **纯浏览器端适配**: 在浏览器端，可以轻松替换这些环境函数，从 `window.location` 或浏览器 Agent API 获取信息，而无需修改核心构建逻辑。
