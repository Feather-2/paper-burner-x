# JS Agent 全量结构分析汇总 (我们的 Agent)

我已对 `js/agents` 目录下的所有模块进行了深度分析。我们的智能体系统采用高度解耦的“阶段驱动”架构，能够处理复杂的办公自动化和深度研究任务。

## 分析文件导航

| 分析维度 | 涵盖文件夹 | 主要内容 |
| :--- | :--- | :--- |
| [**运行时高级特性**](runtime-advanced.md) | `runtime/telemetry`, `runtime/middleware` | 轨迹重放控制、中间件插件链、Worker 线程执行隔离 |
| [**共享工具与优化**](shared-utils.md) | `shared/utils` | 鲁棒 JSON 解析、Token 预算控制、ReDoS 安全正则、双端历史队列 |
| [**子代理与协作**](subagents-collaboration.md) | `stages/*/subagents`, `design/subagents` | 任务作用域隔离、Proxy 拦截共享黑板、多代理握手协议 |
| [**协议与存档**](mcp-archive.md) | `mcp`, `shared/archive` | MCP Nexus 云端中转、Schema 驱动的存档、快照校验机制 |
| [**运行时与编排**](runtime-orchestration.md) | `runtime` | 智能体循环、状态管理、上下文压缩、事件总线 |
| [**SDK 与生命周期**](sdk-lifecycle.md) | `sdk`, `shared` | 流式构建器、春秋蝉回溯机制、能力注册制 |
| [**阶段与流水线**](stages-pipelines.md) | `stages` | 文本准备、代码搜索、深度研究、设计执行 |
| [**基础设施与数据获取**](infrastructure-ingestion.md) | `ingest`, `llm`, `storage`, `retrieval` | 多模态解析器、模型路由、智能检索工具链 |
| [**扩展与辅助**](extensions-assistance.md) | `mcp`, `prompts`, `skills`, `testing`, `cli` | 结构化 Prompt 管理、动态技能注入、Mock 测试套件 |
| [**CC 增强建议**](enhancement-plan-cc.md) | N/A | 参考 Claude Code 的结构化洞察、计划持久化与配置层级增强方案 |

## 整体架构核心优劣势

### 核心优势 (对比 Claude Code)
1.  **全能多模态支持**: 我们不仅处理代码，还能处理 Office 文档、视频抽帧和音频。
2.  **弹性回溯系统 (春秋蝉)**: 允许 Agent 发现错误后精确回滚到之前的逻辑快照，具备极强的自愈力。
3.  **闭环研究能力**: `deepsearch` 模块具备自治的计划拆解与 Gap 评估机制。

### 核心改进空间 (借鉴 Claude Code)
1.  **安全沙箱化**: 我们的命令执行缺乏系统级沙箱隔离（Claude Code 拥有完整的 Docker/Bubblewrap 体系）。
2.  **极简上下文摘要**: 我们的压缩偏向全量摘要，可以引入 Claude Code 的 `Title-only` 极简摘要来进一步节省 Token。
3.  **结构化代码洞察**: 目前对代码的理解仍主要基于正则和 Grep，建议引入 Tree-sitter 实现符号级的语义导航。

## 下一步行动建议

-   在 `js/agents/runtime/tools` 中引入 **Tool Output 预览机制**，防止巨型返回结果撑破上下文。
-   将 `js/agents/sdk` 中的配置逻辑与项目根目录的配置文件关联，实现 **项目级配置覆盖**。
-   在 `js/agents/stages/codesearch` 中集成 **Tree-sitter 解析器**，对标 Claude Code 的符号提取能力。
