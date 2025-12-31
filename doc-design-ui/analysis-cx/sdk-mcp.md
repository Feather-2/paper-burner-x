# SDK & Shell-Tool-MCP 分析报告

## 1. 架构 (Architecture)

Codex 通过提供多语言 SDK 和标准 MCP Server，极大地扩展了 Agent 的生态边界。

- **面向 Thread 的 SDK 设计 (TS SDK)**: `sdk/typescript` 采用了简洁的 `Codex -> Thread` 模型。`Codex` 类作为全局配置和执行引擎（`CodexExec`）的持有者，而 `Thread` 类则承载具体的对话逻辑和持久化标识。这种设计非常符合 AI 会话天然的流式、有状态特征。
- **解耦的 Shell 执行引擎 (Shell-Tool-MCP)**: 
    - 这是一个标准的 MCP (Model Context Protocol) 服务，其核心职责是为 Agent 提供一个安全的、可控制的 Bash 环境。
    - **封装逻辑**: 它不仅启动服务器，还负责定位平台特定的原生组件（如 `codex-execve-wrapper`），通过这种方式，它为不同 OS 上的 Agent 提供了一致的 Shell 操作接口。

## 2. 优化 Trick

- **持久化语义一致性**: SDK 明确支持 `resumeThread(id)`，并且提示 Thread 数据持久化在 `~/.codex/sessions`。这种将 "内存状态" 与 "磁盘持久化" 紧密结合的做法，极大地简化了开发者处理长时间运行任务（Long-running tasks）的难度。
- **Wrapper 模式的极致应用**: 在 `shell-tool-mcp` 中，甚至对 Bash 路径的选择都进行了细致的平台适配（`resolveBashPath`）。这种 "垫片 (Shim/Wrapper)" 思想确保了核心逻辑不必关心底层环境的破碎性。
- **二进制完整性检查**: 在启动关键服务前，使用 `accessSync` 检查所有必需的原生二进制文件是否存在。这在分布式或 npm 分发的工具中是非常必要的防御性编程手段。

## 3. 对 Agent Docs 的可取之处

- **工具协议化 (MCP)**: Codex 的实现证明了 MCP 协议在 Agent 生态中的核心价值。我们的 Agent 文档应当重点推荐甚至强制要求新工具的接入必须遵循 MCP 标准。
- **面向状态的 SDK 开发**: 在我们的 Agent SDK 设计中，应参考 `Thread` 的概念，将复杂的 Agent 运行状态（Memory, Plan, Context）封装在单一的会话对象中，对外仅暴露极简的 `ask/run` 接口。
- **平台感知与自动修复**: `shell-tool-mcp` 的初始化流程是一个完美的 "环境自检" 模板，应录入我们的 Agent 最佳实践手册。
