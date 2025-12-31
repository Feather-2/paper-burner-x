# Analysis: Background & Services (后台服务与基础设施)

## 1. 架构 (Architecture)

### 后台任务管理 (`src/background/`)
- **后台任务管理器 (`BackgroundTaskManager`)**: 核心单例，协调以下子模块：
  - **`ShellManager`**: 管理多路后台 Shell 进程。支持最大进程数限制（默认 10）、输出大小限制（10MB）和默认运行时长（1小时）。
  - **`SimpleTaskQueue`**: 实现并发任务调度，默认最大并发数为 10。
  - **`TimeoutManager`**: 提供精细的超时控制，支持优雅关闭（Graceful Shutdown）超时设置。
  - **`PersistenceManager`**: 实现任务状态的自动恢复（Auto Restore），支持 24 小时的状态有效期。
- **状态追踪**: 通过 `getStats()` 提供完整的 Shell、队列、超时和持久化统计信息。

### 辅助基础设施
- **流式响应系统 (`src/streaming/`)**: 基于 SSE (Server-Sent Events) 或消息流构建，支持在终端实时打字机式输出思维链和回答。
- **诊断系统 (`src/diagnostics/`)**: 自动收集环境错误信息，为反馈和调试提供结构化数据。
- **远程会话迁移 (`src/teleport/`)**: 一个高级功能，支持在不同终端或环境之间迁移当前的会话状态。

## 2. 优化 Trick (Optimization Tricks)

- **SIGSTOP/SIGCONT 调度**: 允许 Agent 在不需要 CPU 时“冻结”后台任务，而不是杀掉它们，这对于保持长时间运行的编译或测试任务非常有用。
- **输出截断与预览**: `ShellManager` 对输出大小有严格限制（默认 10MB），超过后会自动丢弃并插入提示，防止内存溢出。
- **任务超时强制杀号**: 所有的后台任务都带有 `maxRuntime` 定时器，超时后先发 `SIGTERM` 优雅关闭，1秒后若无效则发 `SIGKILL` 强杀。
- **FIFO + Priority 混合调度**: 队列不仅看优先级，同优先级内严格遵守先进先出，保证了任务处理的可预测性。

## 3. 对我们 Agent (docs\agents) 的可取之处

- **长时间任务支持**: 我们的 Agent 目前多为同步或简单的异步等待。引入 `ShellManager` 模式，可以让 Agent 启动一个测试任务后继续进行其他操作，并随时回来查看输出。
- **并发任务编排**: 利用 `TaskQueue` 的并发控制（如限制 maxConcurrent=5），防止 Agent 在尝试并行修复多个 Bug 时瞬间撑爆系统资源。
- **会话“传送”能力**: 模仿 `teleport` 功能，允许用户在 Web 端和 CLI 端同步 Agent 的操作进度。
- **进程级控制能力**: 赋予 Agent 对进程的细粒度控制（Pause/Resume），使其在处理需要人工干预的复杂流水线时更具灵活性。
