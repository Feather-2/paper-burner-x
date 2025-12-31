# Claude Code 全量结构分析汇总

我已对 `ref/claude-code-open-main/src` 目录下的所有 40+ 个文件夹进行了系统性分析。为了保证分析的深度，我将功能相近的模块进行了归类。

## 分析文件导航

| 分析维度 | 涵盖文件夹 | 主要内容 |
| :--- | :--- | :--- |
| [**核心与代理**](core-agents.md) | `core`, `agents` | 循环机制、思维链展示、任务恢复 |
| [**提示词与工具**](prompts-tools.md) | `prompt`, `tools`, `models`, `providers`, `skills` | 模块化 Prompt、Token 估算、差异化编辑 |
| [**上下文与 Git**](context-git.md) | `context`, `memory`, `git`, `github`, `session` | 智能摘要、滑动窗口、Git 深度集成 |
| [**协议与解析**](mcp-parser.md) | `mcp`, `parser`, `lsp`, `search` | MCP 资源管理、Tree-sitter 符号提取 |
| [**交互与渲染**](ui-renderer.md) | `ui`, `renderer`, `cli`, `notifications` | React 式终端 UI、增强型渲染 |
| [**生命周期与配置**](lifecycle-config.md) | `lifecycle`, `config`, `auth`, `env`, `network`, `utils` | 七层配置优先级、事件总线、自动备份 |
| [**安全与权限**](security-permissions.md) | `security`, `permissions`, `organization` | PBAC 策略引擎、运行时拦截、审计日志 |
| [**后台服务与扩展**](background-services.md) | `background`, `streaming`, `teleport`, `diagnostics` | 优先级任务队列、Shell 进程管理 |
| [**多媒体与系统**](multimedia-extensions.md) | `media`, `chrome`, `codesign`, `updater`, `ratelimit` | 多模态解析、代码签名、自动更新 |
| [**云提供商支持**](cloud-providers.md) | `providers`, `models` | AWS Bedrock/Vertex 适配、模型别名映射、AWS V4 签名 |
| [**沙箱与环境**](sandbox-environment.md) | `sandbox`, `ide`, `types` | 跨平台沙箱隔离、资源配额、环境自适应 |

## 整体架构核心 Trick 总结

1.  **自消化上下文**: 通过 `Summarizer` 在 Token 耗尽前自动生成极简摘要。
2.  **分层安全栅栏**: 结合声明式 `Policy` 和运行时 `Monitor` 实现双重防护。
3.  **持久化任务状态**: 无论是 `background` 进程还是 `plan` 方案，均可跨会话存取。
4.  **结构化代码洞察**: 深度依赖 Tree-sitter 和 LSP 而非简单文本检索。

## 对我们项目的核心改进建议

-   **引入沙箱机制**: 将 Agent 的高风险命令移入 Docker 执行。
-   **实现任务恢复**: 记录任务 Checkpoint，支持任务崩溃后的一键恢复。
-   **优化 Prompt 结构**: 采用模块化附件模式动态构建系统提示词。
-   **强化视觉体验**: 采用结构化块渲染模式，提升终端交互的可读性。
