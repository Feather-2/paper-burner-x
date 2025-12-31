# JS Agent 增强设计建议 (参考 Claude Code)

本方案旨在借鉴 Claude Code (CC) 的优秀工程实践，对我们现有的 `js/agents` 架构进行系统性增强。

## 1. 结构化语义洞察 (Structured Insights)
**现状**: 我们的 Agent 主要依赖正则和 Grep 进行代码检索。
**借鉴 CC 设计**:
- **引入 Tree-sitter WASM**: 在 `js/agents/vfs` 或 `ingest` 层集成 Tree-sitter。
    - **符号提取**: 为项目自动生成 `symbols.json` 索引，包含函数签名 (Signatures) 和 JSDoc 摘要。
    - **语义导航**: 支持基于 AST 的“引用查找”和“定义跳转”，而不仅仅是文本匹配。
- **结构化 Git 分析 (`GitAnalysis`)**:
    - 封装 `git diff --shortstat` 和 `git diff origin/main...HEAD`。
    - 为 Agent 提供 JSON 格式的变更报告（包含 insertions, deletions, modified files），帮助其在修改前评估风险。

## 2. 任务连续性与计划持久化 (Persistence & Planning)
**现状**: 我们的计划（Plan）通常存在于内存或单个会话中，缺乏版本化管理。
**借鉴 CC 设计**:
- **计划版本控制器 (`PlanPersistenceManager`)**:
    - 将 `deepsearch` 的计划持久化到 `.agent/plans/` 目录。
    - 支持状态流转：`draft` (草稿) -> `approved` (已批准) -> `in_progress` (执行中)。
    - **回滚能力**: 允许用户或 Agent 将计划恢复到之前的任意版本。
- **断点续传机制**:
    - 记录任务的 Checkpoint（包含当前待办列表、已收集证据、LLM 状态）。
    - 进程崩溃或手动中止后，支持 `resume` 命令一键恢复。

## 3. 极简上下文管理与输出存根 (Context Efficiency)
**现状**: 我们使用 Cicada 进行压缩，但仍倾向于全量摘要。
**借鉴 CC 设计**:
- **Title-only 极简摘要**: 
    - 当 Token 超过 80% 阈值时，除最近 3 轮外，其余对话压缩为“10个词以内的短标题”。
    - 采用“倒序预算收集”算法，确保最近的工具输出不被截断。
- **巨型输出存根 (Stubbing)**:
    - 对于超过 50KB 的工具返回结果（如读取大型文件或巨型日志），在上下文中仅保留一个 `Reference ID` 和 `Summary`。
    - 当 LLM 明确要求查看细节时，再通过 `read_stub` 工具按需加载。

## 4. 工程化配置与生命周期钩子 (Lifecycle & Config)
**现状**: 配置逻辑较为散乱，缺乏严格的层级覆盖。
**借鉴 CC 设计**:
- **七层配置优先级**:
    - 企业强制配置 > 环境变量 > 项目级配置 (`.agent/config.json`) > 用户全局配置 > 默认配置。
    - 使用 Zod 进行强类型校验，防止非法配置导致运行时错误。
- **两级事件模型**:
    - **CLI 级**: 监控插件加载、环境检测。
    - **Action 级**: `before_tool_call`, `after_thinking`, `on_error`。
    - 允许开发者通过插件（Middlewares）挂载自定义的安全审计或成本监控逻辑。

## 5. 安全沙箱与事务性保障 (Security & Safety)
**现状**: 命令直接在宿主环境执行，缺乏回滚保护。
**借鉴 CC 设计**:
- **自动 Checkpoint**:
    - 在调用 `write_file` 或 `execute_command` 之前，自动在 `.agent/backups/` 备份受影响文件。
    - 结合“春秋蝉”机制，实现真正意义上的“事务性回退”。
- **沙箱隔离**:
    - 探索通过 WASM (针对代码解析) 或 Docker (针对执行) 运行高风险代码，实现权限最小化。

## 6. 实施路线图 (Roadmap)

1.  **Phase 1 (Infrastructure)**: 集成 Tree-sitter 并封装 `GitAnalysis` 模块。
2.  **Phase 2 (Reliability)**: 实现计划持久化与项目级配置系统。
3.  **Phase 3 (Efficiency)**: 引入极简摘要算法与巨型输出存根机制。
4.  **Phase 4 (Hardening)**: 完善两级生命周期钩子与自动备份回滚。
