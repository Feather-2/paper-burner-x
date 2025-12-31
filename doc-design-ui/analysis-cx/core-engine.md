# Codex-Core Agent 核心引擎深度分析

## 1. 架构 (Architecture)

`codex-rs/core` 是整个 Agent 的 "大脑"，采用了极其严谨的 **"任务驱动型 (Task-driven) 运行时"**。

- **ToolOrchestrator (工具编排器)**: 它是工具执行的中枢神经，实现了 `Approval → Sandbox Selection → Attempt → Retry` 的闭环逻辑。它将 "是否需要用户批准" 和 "使用哪个沙箱" 从具体的工具实现中解耦出来。
- **SessionTask 抽象**: 所有的 Agent 行为（如普通对话、Undo 撤销、Review 代码）都被抽象为 `SessionTask`。每个 Task 都是异步执行的，并持有 `CancellationToken` 以支持随时中断。
- **Skills 动态加载系统**: 通过 `SkillsManager` 实现了基于目录（CWD）的 Skill 动态发现与加载。Skill 不仅包含 Prompt，还关联了具体的脚本执行逻辑，支持系统级 Skill 和用户自定义 Skill 的共存。

## 2. 优化 Trick

- **Ghost Snapshot (快照撤销)**: `UndoTask` 利用 Git 的 "Ghost Commit" 机制。在执行危险操作前，Agent 会自动创建一个隐形快照（Snapshot），用户执行 `undo` 时，系统会通过 `restore_ghost_commit` 瞬间回滚文件系统状态。这比基于文本的撤销要鲁棒得多。
- **智能重试 (Retry with Escalation)**: 当一个工具在沙箱中执行失败（例如因为权限不足被 Denied），Orchestrator 会根据策略询问用户 "是否在无沙箱环境下重试"。这种 "先安全，后提权" 的策略平衡了易用性与安全性。
- **双层缓存机制**: `SkillsManager` 使用 `RwLock<HashMap>` 缓存每个工作目录的 Skill 加载结果，避免了频繁的文件系统扫描。
- **遥测集成 (OTEL)**: 在 Orchestrator 层面深度集成了 OpenTelemetry，记录每一个 `tool_decision` 的来源（是用户决定的还是配置决定的），这对于 Agent 的行为审计和效果调优至关重要。

## 3. 对 Agent Docs 的可取之处

- **"万物皆 Task"**: 我们的 Agent 设计应当参考 `SessionTask` 模型，将复杂的 AI 流程拆分为一个个独立的、可取消的、可重试的任务单元。
- **文件系统的 "后悔药"**: 必须在 Agent 文档中引入 "执行前自动快照" 的规范，尤其是在涉及文件系统大规模修改的任务中，基于 Git 或文件副本的 `Undo` 是提升 Agent 可信度的关键。
- **显式的工具生命周期**: Orchestrator 展现的五阶段生命周期（评估权限 -> 用户确认 -> 环境准备 -> 执行 -> 结果处理/重试）应作为我们开发自定义 Agent Tool 的标准流程图。
