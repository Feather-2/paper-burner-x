# Analysis: Planning & Persistence (计划与持久化)

## 1. 架构 (Architecture)

### 计划模式 (`src/plan/`)
- **计划持久化管理器 (`PlanPersistenceManager`)**: 
  - **分层存储**: 计划保存在 `~/.claude/plans/`，模板在 `plan-templates/`，版本历史在 `plan-versions/`。
  - **版本控制**: 支持自动创建计划版本，并能通过 `restoreVersion` 随时回滚到之前的任意版本。
  - **状态流转**: 计划状态包括 `draft`, `pending`, `approved`, `in_progress`, `completed`, `abandoned`, `rejected`。
  - **导出能力**: 支持导出为 JSON, Markdown, HTML 格式，包含需求分析、决策理由和实施步骤。
  - **过期机制**: 默认保留最近 500 个计划，90 天后自动清理过期计划。
- **对比引擎 (`PlanComparisonManager`)**: 支持跨多个计划的批量对比（Batch Compare），基于成本、复杂度等维度生成对比报告。
- **模板系统**: 支持从 `PlanTemplate` 预定义步骤快速初始化新计划。

### 检查点系统 (`src/checkpoint/`)
- **全量快照**: 系统在执行重大变更前，会记录当前工作区的状态快照（Checkpoints）。
- **事务性回滚**: 如果任务失败或用户不满意，可以回滚到任意一个历史检查点，类似于 Git 但比 Git 更轻量（仅记录受影响文件）。

## 2. 优化 Trick (Optimization Tricks)

- **影子计划执行**: 在 `plan` 模式下，Agent 可以尝试调用某些只读工具来验证假设，而不会产生真实的磁盘修改。
- **增量持久化**: 持久化逻辑只保存 `diff` 和 `metadata`，而不是整个会话的克隆，节省了大量的 I/O 开销。
- **状态压缩**: 在保存长对话的 `Plan` 时，会进行自动压缩，移除中间调试产生的冗余日志。

## 3. 对我们 Agent (docs\agents) 的可取之处

- **“先计划后执行”模式**: 我们的 Agent 目前往往是走一步看一步。引入 `plan` 模块，可以让 Agent 在写代码前先输出一个结构化的方案，并根据方案进行成本预估。
- **多方案对比**: 当遇到重构任务时，要求 Agent 给出 A/B 两个方案，并由用户（或另一个 Agent 角色）进行对比选择。
- **自动 Checkpoint**: 在我们的 Agent 调用 `write_file` 或 `execute_command` 之前，自动在临时目录存一份原文件备份，提供一键撤销的能力。
- **任务连续性**: 目前我们的 Agent 进程结束任务就丢失了。引入 `persistence` 机制，让我们可以实现“断点续传”，即便网络中断也能从上次的位置继续。
