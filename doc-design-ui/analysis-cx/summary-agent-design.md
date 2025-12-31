# Codex 核心架构与 Agent 设计总结报告

本报告基于对 `codex-main` 仓库中各核心组件（CLI, Rust Backend, SDK, MCP）的深入分析，总结其对我们项目 `docs/agents` 建设的战略价值。

## 1. 宏观架构总结

Codex 展现了一个 **"三位一体"** 的 Agent 系统架构：

1.  **高性能原语层 (Rust Core)**: 负责最重的任务——安全沙箱 (Landlock/Seccomp)、大文件解析、并发执行调度。
2.  **多态交互层 (TUI/CLI/SDK)**: 针对不同场景提供适配。TUI 用于人类深度协作，CLI 用于快速触发，SDK 用于三方集成。
3.  **开放工具协议 (MCP)**: 将具体的能力（如 Shell 执行、代码分析）解耦为独立的服务，实现 Agent 能力的即插即用。

## 2. 核心优化 Trick 沉淀

| 领域 | 核心 Trick | 收益 |
| :--- | :--- | :--- |
| **执行安全** | 线程级 Seccomp 网络过滤 + 允许 AF_UNIX | 既防止了数据外泄，又保证了 Agent 能够与本地 Sidecar 协同。 |
| **状态管理** | 基于会话的 Fork 与回溯 (Backtracking) | AI 任务不再是线性的，支持 "探索 - 错误 - 撤销 - 重定向" 的高级工作流。 |
| **分发效率** | 预编译二进制 + Node.js 动态检测分发器 | 兼顾了原生的高性能和 Web 生态的极致分发便捷性。 |
| **用户反馈** | 独立于 UI 的 CommitTick 动画线程 | 在终端中实现了类似 Web 端的心跳/正在输入反馈，消除用户焦虑。 |

## 3. 对我们 Agent Docs 的关键贡献点

基于 Codex 的设计，我们建议在 `docs/agents` 中强化以下设计规范：

### A. 引入 "Op-Event" 契约模式
不再让 Agent 直接操作函数，而是通过发送 `Op` 指令并监听 `Event` 状态流。这不仅方便调试（可回放日志），更利于跨进程/跨语言的 Agent 协作。

### B. 建立 "沙箱分级制"
参考 Codex 的 `SandboxPolicy`，我们将 Agent 的权限显式划分为：
- **ReadOnly**: 仅允许读取工作区。
- **WorkspaceWrite**: 允许修改工作区文件（需 Landlock 保护）。
- **FullAccess**: 提示用户高风险操作，需显式授权。

### C. 推荐 MCP 作为标准工具接口
所有的 Agent Skills (在我们的 `js/agents/skills` 目录中) 应当优先封装为 MCP Server，利用协议标准来实现跨 Agent 的能力共享。

### D. 增强 "回溯 (Undo)" 能力的设计指导
在文档中增加关于 "Agent 状态持久化与回滚" 的专门章节。参考 Codex 的 `sessions` 持久化方案，指导开发者如何实现 "即使重启，任务也能断点续传" 的鲁棒 Agent。

---
*本系列分析报告已全部落盘至 `doc-design-ui/analysis-cx/` 目录。*
