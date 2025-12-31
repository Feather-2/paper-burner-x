# Codex-RS 系统层分析报告 (Sandbox & Protocol)

## 1. 架构 (Architecture)

Codex-RS 的系统层关注 **"确定性安全执行"** 与 **"跨模块通信标准化"**。

- **多层次沙箱 (Linux Sandbox)**: 
    - **Landlock**: 在文件系统层面，通过 Landlock ABI 实现细粒度的路径访问控制。默认全局只读，仅对明确指定的 `writable_roots` 授予写权限。
    - **Seccomp**: 在内核调用层面，通过 `seccompiler` 过滤网络相关的系统调用（如 `connect`, `bind`, `accept`）。特别地，它允许 `AF_UNIX` 域套接字，这使得 Agent 能够与本地服务（如 Docker 或 Unix 套接字管理的服务）通信，同时阻断外部网络。
- **协议驱动型开发 (Protocol Crate)**: `codex-protocol` 被设计为高度纯净（Minimal dependencies）的数据契约层。它统合了内部 UI 交互（Core <-> TUI）和外部服务（App Server）的数据格式，确保了整个工具链的一致性。

## 2. 优化 Trick

- **线程级沙箱隔离**: `apply_sandbox_policy_to_current_thread` 确保沙箱策略仅应用于当前子进程执行线程，避免了沙箱污染 CLI 的主控制逻辑。
- **白名单机制**: Seccomp 过滤器默认 Allow 其它调用，但显式 Deny 网络相关调用。这种 "只封堵风险点" 的策略在保证安全的同时，最大程度地兼容了现有的开发工具（如 `cargo clippy` 需要 socketpair）。
- **Ext-Trait 模式**: 协议层只定义原始 POJO/Struct，复杂的业务逻辑（如权限检查、路径转换）通过在其它层定义 `Ext` 特性来扩展。这保持了核心数据结构的极简和高性能。

## 3. 对 Agent Docs 的可取之处

- **Agent 运行的 "最小权限原则"**: 我们的 Agent 在执行用户脚本或修改代码时，应当借鉴这种 Landlock + Seccomp 的双重保险。这在 Agent 文档中应作为安全开发的 "金标准"。
- **环境隔离的最佳实践**: 显式地允许 `AF_UNIX` 但禁止 TCP/UDP，是一种非常聪明的 Agent 通信策略，既保证了 Agent 与受控侧（Sidecar）通信，又防止了数据外泄。
- **契约先行**: 在开发新的 Agent Skill 或工具时，应先在 `protocol` 层定义好入参和出参的 Schema。
