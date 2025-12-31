# SDK 文件夹审查报告 (js/agents/sdk)

## 1. 潜在问题清单

### 1.1 架构设计与构建模式 (Architecture & Pattern)
- **AgentBuilder 的不完整导出**: `AgentBuilder.build()` 返回一个 `AgentInstance`（第 270 行）。虽然构建过程包含了大量的自动配置逻辑（如 Cicada, Task 工具自动注入），但 `AgentInstance` 默认没有 `run` 循环实现（第 523 行），导致初次使用的开发者如果不显式调用 `setLoop`，Agent 将无法实际运行，缺乏一个标准的“开箱即用”默认 Loop。
- **循环依赖风险**: `AgentBuilder` 直接导入了大量的 Runtime 组件（Cicada, TaskTool, RecallTool 等）。虽然目前是通过 SDK 层作为聚合，但如果 Runtime 组件反向依赖 SDK 中的类型定义，会导致 ESM 循环导入报错或初始化异常。
- **过时的别名映射**: `useSkill` 标记为 `@deprecated`（第 147 行），但 SDK 内部的提示词生成方法仍叫 `getSkillCatalogPrompt`（虽然有别名，但内部逻辑未统一，第 506 行）。这种不一致会增加模型对工具命名的理解偏差。

### 1.2 状态管理与回溯 (State & Backtrack)
- **回溯逻辑的深度拷贝开销**: `BacktrackManager` 在回溯时使用 `deepClone` 整个 Snapshot（第 71 行）。对于包含大量文档索引和长消息历史的 Agent，这种同步的深度拷贝会造成显著的内存压力和 UI 卡顿。
- **回溯 ID 的不确定性**: 在未提供 ID 时，`prepareBacktrack` 盲目通过 `listArchives` 选取倒数第二个存档作为回滚点（第 49 行）。这种基于时间顺序的猜测在并发操作或多子任务环境下非常不可靠，可能回滚到错误的逻辑分支。
- **存档清理机制缺失**: SDK 提供了大量的快照（Checkpoint）和存档（Archive）能力，但没有暴露任何关于存档生命周期管理（TTL）或容量超限清理的 API。长期运行会导致本地存储（如 IndexedDB）占满。

### 1.3 子代理与分布式 (Subagents)
- **子代理上下文隔离的脆弱性**: `SubagentRegistry` 仅通过工厂函数创建实例（第 12 行）。虽然 `Task` 工具尝试传递上下文，但 SDK 层没有强制规范子代理的 `inheritedContext` 如何与主代理的安全策略（Policies）对齐，可能导致安全策略被子代理绕过。
- **通配符订阅性能**: `onEvent` 允许注册通配符处理器（第 239 行）。由于 `EventBus` 的实现较为简单，当存在大量细碎事件且有多个通配符订阅时，匹配算法的性能开销会随着订阅数呈线性增长。

### 1.4 类型安全 (Type Safety)
- **定义文件滞后**: `CapabilityInterface.d.ts` 等类型定义文件看起来是手动维护的（第 37 行开始的 JSDoc），没有与实际的 JS 实现代码（如 `AgentBuilder`）保持同步验证。在没有 TypeScript 强校验的情况下，IDE 的补全可能误导开发者传入错误的配置结构。

## 2. 改进建议
1. **提供内置 DefaultLoop**: 为 `AgentInstance` 提供一个默认的单轮或简单的工具执行 Loop，降低入门门槛。
2. **重构 Backtrack 存储**: 引入 Immutable.js 结构或基于增量（Diff）的快照机制，大幅降低回溯时的内存克隆开销。
3. **增加存储管理 API**: 在 SDK 中增加 `purgeArchives(options)` 方法，允许按时间、大小或任务 ID 清理不再需要的历史快照。
4. **统一命名空间**: 全面移除 Skill 相关的遗留命名，强制统一为 Capability，确保 SDK API 与模型 Prompt 中的术语 100% 对齐。
5. **增强 EventBus 路由**: 在 `EventBus` 中引入更高效的 Trie 树结构进行事件名匹配，优化通配符订阅性能。

## cc是如何解决这个问题的

Claude Code (CC) 通过高度集成且自给自足的工具系统（Tools System）以及模块化的子代理（Subagents）架构解决了 SDK 层的工程化挑战：

1.  **开箱即用的工具集成 (Standard Toolset)**:
    *   **统一注册**: CC 通过 `registerAllTools` ([`src/tools/index.ts`](ref/claude-code-open-main/src/tools/index.ts)) 默认注入了包括文件操作、搜索、Bash 执行、MCP 和子代理管理在内的全套工具。
    *   ** Conversation Loop**: `ConversationLoop` ([`src/core/loop.ts`](ref/claude-code-open-main/src/core/loop.ts)) 提供了标准的执行逻辑，开发者无需手动编写 Loop 即可让 Agent 具备完整的自主行动能力，解决了 jsagents 中“缺乏默认 Loop”的问题。

2.  **模块化与强类型子代理**:
    *   **专门化代理**: CC 定义了多种内置子代理类型（如 `Explore`, `Plan`, `claude-code-guide`），并带有明确的 `whenToUse` 描述 ([`src/tools/agent.ts`](ref/claude-code-open-main/src/tools/agent.ts))。
    *   **上下文 Fork 机制**: `TaskTool` 支持 `forkContext` 选项。它会小心地过滤和转换父对话历史（只保留文本内容，剥离工具调用细节），确保子代理既能获得必要上下文，又不会被主代理的中间状态干扰。
    *   **纯浏览器端适配**: 这种子代理模式基于 `uuid` 追踪和 `json` 状态序列化，非常适合在浏览器端通过 `Web Workers` 或多个 Iframe 并行运行多个 Agent 实例。

3.  **增量状态与存储管理**:
    *   **增量 Checkpoint**: 针对回溯时的“深度拷贝开销”，CC 引入了基于增量 Diff 的 Checkpoint 系统 ([`src/checkpoint/index.ts`](ref/claude-code-open-main/src/checkpoint/index.ts))。它只存储文件变更的差异，极大降低了内存和存储压力。
    *   **自动清理与配额**: 内置了 `cleanupOldCheckpoints` 和 `enforceStorageLimits` 机制，支持按 retention 天数（默认 30 天）或存储配额（默认 500MB）自动回收空间，解决了 jsagents 中“清理机制缺失”的问题。

4.  **TypeScript 优先与架构解耦**:
    *   **强类型定义**: 全套代码使用 TypeScript 编写，所有的工具输入（`InputSchema`）和输出（`ToolResult`）都有严格的类型定义，确保持续迭代中代码与文档的 100% 同步。
    *   **Hooks 机制**: 采用 Hooks 模式处理子代理的启动和停止 ([`src/hooks/index.ts`](ref/claude-code-open-main/src/hooks/index.ts))，避免了 Agent 逻辑与 SDK 的强耦合。
