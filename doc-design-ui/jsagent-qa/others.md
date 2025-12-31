# Agent Loop 深度改进建议 (综合审计报告)

本报告汇总了对 `js/agents` 子模块进行的深度架构审计结果，旨在解决现有系统中潜在的数据一致性、性能瓶颈及工程化规范问题。

## 1. 架构与状态管理 (Architecture & State)

### 1.1 从“双向门面”转向“单向数据流”
*   **现状问题**：`UnifiedAgentContext` (门面) 与 `BaseAgentLoop` 之间存在逻辑冗余与双向写入风险。在高频并发场景下容易产生“双源真理”冲突。
*   **改进建议**：引入类似 Redux 的单向状态树，让 `AgentLoop` 成为唯一修改状态的入口。其他组件通过订阅快照更新，消除同步滞后。

### 1.2 引入结构共享 (Immutable Data)
*   **现状问题**：`MemoryStore` 的 checkpoint 和 `deepClone` 在处理数千条消息或复杂 DSL 时，会导致显著的 CPU 峰值和 GC 压力。
*   **改进建议**：引入 `Immer` 或 `Immutable.js` 实现结构共享。创建快照时仅占用微量新内存，将性能提升数个数量级。

### 1.3 声明式状态机可视化
*   **现状问题**：`AgentStatus` 目前仅为简单枚举，逻辑拓扑关系不透明。
*   **改进建议**：引入 XState 风格的声明式状态机定义，支持自动生成运行逻辑拓扑图，提升可维护性与调试直观度。

### 1.4 强化副作用的事务性 (WAL & Saga)
*   **现状问题**：`SideEffectJournal` 的回滚是“尽力而为”的异步过程。若回溯中途失败，物理 VFS 与逻辑状态将陷入不一致。
*   **改进建议**：
    *   引入 **Write-Ahead Logging (WAL)** 机制，在物理操作前先落盘日志。
    *   将 `SideEffectJournal` 扩展为通用的 **补偿模式 (Saga Pattern)**，为每个 Tool 调用提供显式的 Undo Action。

### 1.5 彻底的实例私有化
*   **现状问题**：`BaseAgentLoop` 内部存在某些单例机制 (如 `_loaded` 标记)，在高并发多租户场景下存在全局污染隐患。
*   **改进建议**：彻底清理单例残留，确保所有状态均属于实例私有。

---

## 2. 性能与资源管理 (Performance & Resources)

### 2.1 全面 Web Worker 池化
*   **现状问题**：BM25 索引构建、ToC 解析、AssetHash 计算及 Ingest 规范化目前挤在主线程，导致大文件处理时 UI 卡顿。
*   **收益**：引入真正的 `WorkerPool` 处理计算密集型任务，确保 UI 响应不受文档规模影响。

### 2.2 内存压力与 LRU 置换
*   **现状问题**：`EventBus` 事件记录和 `SideEffectJournal` 在超长任务中内存占用持续走高。
*   **改进建议**：引入基于 `LruMap` 的旧事件持久化与置换机制，防止 OOM。

### 2.3 并发度权重信号量 (Weighted Semaphore)
*   **改进建议**：引入权重信号量，根据 Token 消耗预估动态限制并发数，防止触发上游 API Rate Limit 或主线程内存激增。

### 2.4 Token 估算精度优化
*   **现状问题**：目前的启发式算法 (chars/4) 在代码片段或多模态数据下存在 10-20% 偏差，易导致溢出错误。
*   **改进建议**：引入更精确的 Tokenizer 计数逻辑或增加更保守的缓冲区。

### 2.5 存储配额管理
*   **改进建议**：为 `RunStore` (IndexedDB) 增加自动清理策略 (TTL/LRU)，防止随着 `runId` 累积导致浏览器存储超限。

---

## 3. 稳健性与安全性 (Robustness & Security)

### 3.1 标准化 Tool 响应协议
*   **现状问题**：多处存在 `candidates.filter(Boolean)` 等猜测式解析。
*   **改进建议**：在 SDK 层强约束一套标准的 `AgentResponse Schema`，减少运行时解析逻辑的不确定性。

### 3.2 自愈数据的置信度标记
*   **现状问题**：`RobustJSON` 强行闭合括号可能导致语义完全扭曲。
*   **改进建议**：所有经过修复的数据打上 `__auto_fixed: true` 标签，并在回溯管理器中赋予其更高的“不信任权重”。

### 3.3 潜意识干扰防护 (Prompt Buffer)
*   **改进建议**：在 `ctx` 中建立专门的 `promptBuffer` 区域，统一管理各中间件对 Prompt 的修改，防止多中间件协作冲突。

### 3.4 VFS 并发锁定
*   **现状问题**：`OpfsVfs` 缺乏文件锁。
*   **改进建议**：实现文件锁定机制，防止并发写入导致的数据损坏。

### 3.5 Schema 驱动的参数自修复
*   **改进建议**：在中间件层引入 `JsonSchemaFixer`，利用 LLM 或启发式算法自动纠正模型输出中常见的参数类型错误。

---

## 4. 业务逻辑细节 (Logic Details)

### 4.1 检索精度提升
*   **改进建议**：BM25 增加分词器动态加载支持，提升中英文混排及专业领域文档的检索精度。

### 4.2 技能注册冲突检测
*   **改进建议**：`AgentBuilder` 在 `.useSkill` 时若发生同名覆盖应触发警告，防止业务技能意外替换系统级技能。

### 4.3 成本可视化
*   **改进建议**：将 `ModelRouter` 的流量监控上报至 UI 层“Token 仪表盘”，让用户对高频 Agent 的成本有直观感知。

### 4.4 去中心化健康感知
*   **改进建议**：将 `ModelRouter` 的熔断状态通过 `SharedWorker` 或 `BroadcastChannel` 同步，实现跨标签页的模型健康感知共享。

## cc是如何解决这个问题的

Claude Code (CC) 在复杂 Agent 循环、状态持久化和安全性方面提供了工业级的参考实现：

1.  **细粒度的 Checkpoint 与回滚机制**:
    *   **差异化存储**: CC 实现了 `FileCheckpoint` 系统 ([`src/checkpoint/index.ts`](ref/claude-code-open-main/src/checkpoint/index.ts))，采用增量 Diff (LCS 算法) 记录文件变更，相比 jsagents 的全量备份大大节省了资源。
    *   **自动保存与恢复**: 系统支持 `autoCheckpointInterval`。在发生错误或人为中断时，可以精确回滚到任意一个历史版本（Undo/Redo），确保了 VFS 的最终一致性。
    *   **纯浏览器端适配**: 虽然 CC 默认使用文件系统，但其增量存储逻辑完全可以移植到浏览器的 `IndexedDB` 或 `OPFS` 中，提供极佳的状态自愈能力。

2.  **分层会话管理**:
    *   **会话持久化**: `SessionManager` ([`src/session/index.ts`](ref/claude-code-open-main/src/session/index.ts)) 负责完整的会话生命周期，支持 Fork (分支) 和 Merge (合并) 操作。这种分支机制完美解决了 jsagents 建议中的“并行探索与合并”需求。
    *   **成本审计**: 会话元数据实时追踪 `tokenUsage` 和 `cost`，为“成本可视化”提供了底层数据支持。
    *   **纯浏览器端适配**: 会话数据以 JSON 格式存储，天然适合浏览器端的持久化方案。

3.  **声明式权限与安全策略**:
    *   **策略引擎**: `PolicyEngine` ([`src/permissions/policy.ts`](ref/claude-code-open-main/src/permissions/policy.ts)) 使用声明式 JSON 策略，支持 `and`/`or`/`not` 的复杂逻辑组合。这解决了 jsagents 提到的“中间件协作冲突”问题——所有权限校验都集中在统一的策略引擎中处理。
    *   **Deny 优先原则**: 在解决冲突时，CC 严格遵循“安全优先”策略，任何显式的 Deny 都会覆盖 Allow。
    *   **纯浏览器端适配**: 策略引擎是纯逻辑实现，不依赖特定环境，可以直接运行在浏览器的授权模块中。

4.  **精确的 Token 估算与资源控制**:
    *   **多语言 Tokenizer 估算**: `estimateTokens` ([`src/prompt/builder.ts`](ref/claude-code-open-main/src/prompt/builder.ts)) 考虑了亚洲字符和代码块的差异，显著提高了估算精度。
    *   **配额管理**: 拥有专门的 `QuotaManager` 监控消耗，防止超支。
