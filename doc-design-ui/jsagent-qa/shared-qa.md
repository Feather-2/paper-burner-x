# Shared 文件夹审查报告 (js/agents/shared)

## 1. 潜在问题清单

### 1.1 工具函数契约 (Utility Contracts)
- **Token 估算公式的局限性**: `estimateTokenCount` 使用固定的 1.6 倍 CJK 系数（第 132 行）。虽然这是一个通用的启发式值，但对于某些特定模型（如 GPT-4o 或 Gemini 2.0），其 Tokenizer 的效率可能完全不同，导致在关键边界（如 128K 限制）附近产生误判。
- **深度克隆的性能瓶颈**: `deepClone` 是递归实现的，且包含了对 Map 和 Set 的处理（第 142 行）。在处理包含数千个节点的大型 Agent 状态时，这种同步的深度递归会导致明显的 CPU 阻塞，且没有针对大数组或嵌套层次过深的保护。
- **类型转换的隐式行为**: `toBoolean`（第 51 行）将所有非 `true/1/yes/on` 的字符串都视为 `false`。这意味着如果输入了一个拼写错误的 `"truu"`, 它会静默转换为 `false` 而不发出警告，可能导致配置逻辑错误。

### 1.2 JSON 健壮性与安全 (JSON & Security)
- **正则保护的启发式特征**: `isPotentiallyDangerous`（第 16 行）仅通过简单的正则匹配来检测 ReDoS。这种黑名单机制很容易绕过，且 `createSafeRegex` 在检测到危险后直接抛出异常（第 43 行），这可能导致 Agent 在处理来自模型的非预期（但合法）正则时发生崩溃。
- **JSON 修复的副作用**: `fixCommonJsonIssues` 尝试通过简单的正则替换来闭合字符串和括号（第 113 行）。在极端情况下（如字符串内部包含类似代码的文本），这种“粗暴”的修复可能会破坏原本合法的内容，导致语义改变。
- **循环引用处理**: `sanitizeForJson` 虽然处理了循环引用（第 208 行），但它将所有的非 JSON 兼容类型（如 function）直接丢弃（返回 `undefined`）。在调试环境下，这会导致丢失关键的上下文信息。

### 1.3 存档与持久化 (Archive & Persistence)
- **ID 碰撞风险**: `Archive.save` 使用 `Date.now()` 作为基础 ID，并有 100 次碰撞重试限制（第 94, 99 行）。在极高性能的并发场景下（如快速迭代的子代理）， 100 次重试可能在 1ms 内耗尽，导致任务异常中断。
- **存储配额意识缺失**: `IndexedDBAdapter` 直接使用 `indexedDB.open`（第 294 行），但没有监听 `onblocked` 事件，也没有查询浏览器的 `navigator.storage.estimate()`。当磁盘空间不足时，Agent 可能会因无法写入 Checkpoint 而导致长任务在中途由于“不可言说”的 IO 错误崩溃。
- **过期清理逻辑不透明**: `deleteOlderThan` 依赖外部调用（第 211 行）。缺乏后台自动清理机制（Housekeeping），导致如果不手动维护，用户的浏览器存储空间会随着时间持续膨胀。

### 1.4 环境兼容性 (Compatibility)
- **Browser-only 依赖渗入**: `IndexedDBAdapter` 强依赖全局 `indexedDB` 变量。虽然有 `FallbackAdapter`，但在纯 Node.js 服务端环境下，初次尝试打开 IndexedDB 的失败会触发不必要的控制台警告和延迟。

## 2. 改进建议
1. **参数化 Token 估算**: 允许 `estimateTokenCount` 接收一个 `modelFamily` 参数，根据不同模型（GPT, Claude, Gemini）采用不同的分词策略或特定的系数。
2. **异步克隆/序列化**: 引入基于 `Web Worker` 的克隆方案，或使用增量快照，避免在大状态下的 Event Loop 阻塞。
3. **引入持久化管理策略**: 为 `Archive` 增加配置项，如 `maxArchiveSize` 或 `retentionPolicy`，实现自动的后台过期清理。
4. **增强 JSON 提取逻辑**: 使用更成熟的流式 JSON 解析器（如 `json-repair`）替代基于正则的 `fixCommonJsonIssues`。
5. **改进 ID 生成**: 在 `checkpointId` 中引入随机后缀（如 `nanoid` 长度为 4 的部分），彻底消除高频保存时的 ID 冲突风险。
6. **环境预检测**: 在 `shared/index.js` 中增加环境特性检测，自动为不同环境（Node/Browser/Worker）加载对应的最优适配器。

## cc是如何解决这个问题的

Claude Code (CC) 通过统一的工具函数库和标准化的跨平台实现，解决了 Shared 层的健壮性和兼容性问题：

1.  **更精确的多语言 Token 估算**:
    *   **细粒度权重**: CC 在 [`src/prompt/builder.ts`](ref/claude-code-open-main/src/prompt/builder.ts) 中的 `estimateTokens` 实现不仅考虑了 CJK（2.0 字符/Token），还专门为代码块（3.0 字符/Token）、特殊字符（0.1 Token/个）和换行（0.5 Token/行）分配了权重。
    *   **模型感知**: 估算逻辑可以根据 `PromptContext` 中的模型类型进行微调，显著降低了长上下文下的溢出风险。

2.  **安全的 ID 生成与并发处理**:
    *   **UUID v4**: 相比于 jsagents 使用 `Date.now()` 产生的碰撞风险，CC 统一使用 `uuidv4` 生成唯一 ID ([`src/utils/index.ts`](ref/claude-code-open-main/src/utils/index.ts))，彻底消除了 ID 冲突。
    *   **会话隔离**: 所有的持久化操作（Session, Checkpoint）都基于 UUID 路径隔离，天然支持高并发。

3.  **工业级的持久化清理机制**:
    *   **内置 Housekeeping**: `CheckpointSession` 系统内置了 `cleanupOldCheckpoints` 逻辑 ([`src/checkpoint/index.ts`](ref/claude-code-open-main/src/checkpoint/index.ts))，会在初始化时自动清理超过 `RETENTION_DAYS`（默认 30 天）的历史记录。
    *   **配额强制执行**: 内置 `enforceStorageLimits` 函数，实时监控存储大小并确保其不超过 `MAX_STORAGE_SIZE_MB` (500MB)。当超出时，它会按时间顺序自动删除旧存档，解决了 jsagents 中“存储无限膨胀”的问题。

4.  **环境友好的工具封装**:
    *   **跨平台 openUrl**: 提供了鲁棒的 `openUrl` 实现 ([`src/utils/index.ts`](ref/claude-code-open-main/src/utils/index.ts))，能够自动识别 `darwin`/`win32`/`linux` 平台并调用正确的底层指令。
    *   **纯浏览器端适配**: 工具库采用了标准的 ESM 导出，核心逻辑（如 `isPathSafe`, `diffStrings`, `formatFileSize`）均不依赖 Node.js 特有模块，可以直接在浏览器端 UI 或 Worker 中无损运行。

5.  **健壮的数据处理**:
    *   **Safe JSON Parse**: 统一使用 `safeJsonParse` 包装器，避免了因模型返回非法 JSON 导致的运行时崩溃。
    *   **增量 Diff 算法**: 使用 `longestCommonSubsequence` (LCS) 算法实现增量存储，避开了同步执行“大对象深度拷贝”带来的性能瓶颈。
    
