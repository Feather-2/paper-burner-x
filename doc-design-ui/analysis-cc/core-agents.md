# Analysis: Core & Agents (核心与代理)

## 1. 架构 (Architecture)

Claude Code 的核心架构采用了典型的 **Loop (循环)** 模式，辅以 **Session (会话)** 管理和 **Tool Registry (工具注册表)**。

- **`ConversationLoop` (`core/loop.ts`)**: 这是整个系统的引擎。它负责：
  - 管理消息流（User -> Assistant -> Tool -> User）。
  - 处理 **Extended Thinking** (思维链) 的显示与记录。
  - 实现 **持久化输出 (Persisted Output)** 机制，解决上下文窗口限制。
  - **权限控制**: 集成了 `handlePermissionRequest`，在执行敏感工具前询问用户，并支持会话级的“总是允许”。
- **`Session` (`core/session.ts`)**: 状态持久化中心，记录消息历史、使用统计 (Tokens/Cost) 和权限设置。
- **`Agents` 模块 (`src/agents/`)**: 并不是简单的单一 Agent，而是功能化的子代理集合：
  - `plan.ts`: **软件架构师代理**。负责任务需求分析（功能/非功能需求）、架构决策记录（理由与权衡）、详细步骤规划、关键文件识别（3-5个）以及风险评估。它在“只读模式”下运行，严禁修改文件。
  - `explore.ts`: 负责代码库探索。
  - `monitor.ts`: **监控系统**。提供执行跟踪、资源监控（Token/Cost/API Latency）、性能分析（识别瓶颈）和告警机制（超时、高成本、高错误率）。
  - `communication.ts`: **代理间通信机制**。实现消息总线（Message Bus）、共享状态管理（带锁机制的 Shared State）以及代理协调器（任务分配、负载均衡、死锁检测）。
  - `resume.ts`: 提供任务恢复能力。
  - `parallel.ts`: 支持并行执行多个子任务（虽然在 CLI 中受限，但架构上预留了空间）。
  - `monitor.ts`: 监控代理执行。
  - `communication.ts`: 处理代理间消息传递。

## 2. 优化 Trick (Optimization Tricks)

- **持久化输出标签 (`<persisted-output>`)**: 
  - 当工具输出超过阈值（400KB）时，系统会将其包装在标签内并只显示预览。
  - **旧输出清理**: `cleanOldPersistedOutputs` 会自动从历史消息中清除旧的大型工具结果，仅保留最近的几个，防止 Context 溢出。
- **动态系统提示词构建 (`SystemPromptBuilder`)**: 
  - 系统提示词不是静态的，而是根据当前工作目录、Git 状态、平台信息等动态生成。
- **思维泄露控制**:
  - 对 `Thinking` 过程有专门的 UI 处理，支持实时流式展示或在后台静默运行。
- **智能截断**: 
  - 工具输出截断时优先寻找换行符，保证人类可读性。

## 3. 对我们 Agent (docs\agents) 的可取之处

- **任务恢复机制 (`resume.ts`)**: 我们的 Agent 在处理长时间任务或崩溃后，需要类似的 `resume` 逻辑来恢复状态，而不是重头开始。
- **会话级权限记忆**: 我们的系统可以引入“本次会话允许此操作”的选择，减少频繁弹窗干扰。
- **上下文自动管理**: 模仿其 `cleanOldPersistedOutputs` 逻辑，自动识别并精简历史中的冗余大型数据（如大型 AST 或文件列表）。
- **工具输出格式化**: 使用预览机制处理巨量工具返回结果，提升 LLM 处理效率并降低 Token 消耗。
