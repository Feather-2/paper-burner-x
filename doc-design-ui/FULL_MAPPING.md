# Paper Burner：全量对照矩阵（analysis-* + ref/* → 本仓库）

生成时间：2025-12-31  
目标：把 `doc-design-ui/analysis-cc/*`、`doc-design-ui/analysis-cx/*`、`doc-design-ui/analysis-jsagent/*` 以及 `ref/*` 的关键条目逐条映射到本仓库的实现文件/符号，并标注 `done/partial/todo/n-a`。

---

## 0. 状态定义（Legend）

- `done`：本仓库已有实现，且在 `workflow-runtime + ui-v2`/实际 Stage 中可达（不是“仅存在文件”）。
- `partial`：已有实现但不完整/只覆盖部分场景/未接入主路径/与参考实现存在显著差异。
- `todo`：本仓库缺失（或仅有占位、未接入）。
- `n-a`：对本仓库形态（Browser-Only / 非 CLI / 无本地进程）不适用，或刻意不做（例如 OS 级沙箱）。

---

## 1. analysis-jsagent（本仓库自检映射）

> 这一组文档描述的是 `js/agents` 的现状；这里主要做“文档断言 vs 实际代码”核对，并指出不一致之处。

### 1.1 `doc-design-ui/analysis-jsagent/runtime-advanced.md`

- Telemetry 状态追踪 — `done` — Repo: `js/agents/runtime/telemetry/loop-runtime-state.js`（`getRuntimeState()` 被 `js/agents/runtime/core/agent-loop.js` 的 `checkPaused()` 使用）
- Run 回放控制 — `done` — Repo: `js/agents/runtime/telemetry/replay-controller.js`（Workflow 侧入口：`js/ppt/workflow/workflow-runtime.js` 的 `getReplayController()/startReplay()`）
- RunStore 遥测落盘 — `done` — Repo: `js/agents/runtime/telemetry/runstore-telemetry.js`（订阅：`js/ppt/workflow/workflow-runtime.js` 的 `_ensureTelemetrySubscription()`）
- 插件化中间件链 — `done` — Repo: `js/agents/runtime/middleware/middleware-chain.js`
- 工具执行隔离（Worker）— `done` — Repo: `js/agents/runtime/tools/tool-executor.js` + `js/agents/runtime/tools/tool-executor-worker.js` + `js/agents/runtime/tools/tool-executor-webworker.js`
- Schema 强校验 — `done` — Repo: `js/agents/runtime/tools/schema-validator.js`（触发事件：`tool.validation.failed`，见 `js/agents/runtime/tools/tool-executor.js`）
- 健康哨兵 / watchdog — `partial` — Repo: `js/agents/runtime/compression/watchdog.js`（运行时侧）+ `js/agents/stages/deepsearch/tools/watchdog/handler.js`（工具侧）；缺口：对“子代理死循环/卡死”的统一回收策略未形成跨 stage 规范
- 令牌桶式 RateLimit — `done` — Repo: `js/agents/llm/rate-limit.js`（TokenBucketRateLimiter）+ `js/ppt/workflow/workflow-runtime.js`（Browser-only 接入）+ `js/agents/llm/model-router.js`（模型级 rate limiter）

### 1.2 `doc-design-ui/analysis-jsagent/shared-utils.md`

- `stage-api.js` — `done` — Repo: `js/agents/shared/utils/stage-api.js`
- `budget.js` — `done` — Repo: `js/agents/shared/utils/budget.js`（DeepSearch 另有 `js/agents/stages/deepsearch/model/budget.js`）
- `robust-json.js`（容错 JSON）— `done` — Repo: `js/agents/shared/utils/robust-json.js`（被 DeepSearch/Design/Cicada 等调用）
- `message-utils.js` — `done` — Repo: `js/agents/shared/utils/message-utils.js`
- `deque.js` — `done` — Repo: `js/agents/shared/utils/deque.js`
- `safe-regex.js` — `done` — Repo: `js/agents/shared/utils/safe-regex.js`
- `value-utils.js`（deepClone/deepMerge 等）— `done` — Repo: `js/agents/shared/utils/value-utils.js`
- Prompt Cache（按哈希避免重复构建）— `partial` — Repo: `js/agents/prompts/prompt-loader.js`（按 prompt key 缓存，不是“输入→hash→结果”的 Builder Cache）

### 1.3 `doc-design-ui/analysis-jsagent/subagents-collaboration.md`

- DeepSearch 子代理注册/隔离 — `done` — Repo: `js/agents/stages/deepsearch/subagents.js`（`createTaskScopedSharedContext()` + 动态 import `getDeepSearchAgentLoop()`）
- Design 子代理（Visual/Slide）— `done` — Repo: `js/agents/stages/design/subagents/`（入口：`js/agents/stages/design/index.js`）
- 子代理“握手协议” — `done` — Repo: `js/agents/stages/design/generators/layout-protocol.js`
- 子代理继承父级 stageApi/modelRouter — `done` — Repo: `js/agents/stages/deepsearch/subagents.js`（合并 `parentStageApi`）
- 子代理健康监控/强制回收 — `partial` — Repo: `js/agents/runtime/compression/watchdog.js`（可触发干预）但缺少“父代理统一监控子代理”的标准接口

### 1.4 `doc-design-ui/analysis-jsagent/mcp-archive.md`

- MCP Provider：local-mcp / nexus — `done` — Repo: `js/agents/mcp/local-mcp-provider.js` + `js/agents/mcp/mcp-nexus-provider.js`
- 智能提取器 — `done` — Repo: `js/agents/mcp/smart-content-extractor.js`
- 远程 Tool → Skill 桥接 — `done` — Repo: `js/agents/mcp/nexus-skill-provider.js`
- Checkpoint Schema — `done` — Repo: `js/agents/shared/archive/checkpoint-schema.js`
- Archive（快照存取接口）— `done` — Repo: `js/agents/shared/archive/archive.js`（MapAdapter + 可替换 adapter）
- “连接池/心跳” — `todo`（文档断言与实现不一致）— Repo: `js/agents/mcp/mcp-nexus-provider.js` 仅实现 transport discovery + tools cache + timeout
- “存档压缩/重复块引用化/校验和” — `todo`（文档断言与实现不一致）— Repo: `js/agents/shared/archive/archive.js` 当前不做去重压缩/校验和
- MCP auto-discovery + preload — `partial` — Ref(Claude): `ref/claude-code-open-main/src/mcp/auto-discovery.ts` — Repo: Browser-first 自动发现（localStorage）+ schema preload/cache + healthCheck + SSE subscribe（`js/agents/mcp/auto-discovery.js` + `js/agents/mcp/mcp-client.js` + `js/agents/mcp/mcp-nexus-provider.js` + `js/agents/mcp/sse.js` + `js/ppt/workflow/workflow-runtime.js`）+ ResourceManager（`js/agents/mcp/resource-manager.js`）；缺口：prompts/roots/完整 connection manager 仍未对齐

### 1.5 `doc-design-ui/analysis-jsagent/runtime-orchestration.md`

- `AgentOrchestrator` — `done` — Repo: `js/agents/runtime/orchestrator.js`
- `BaseAgentLoop` + Pause/Resume — `done` — Repo: `js/agents/runtime/core/agent-loop.js`（`StagePausedError`、`checkPaused()`、用户输入队列）
- EventBus（通配符订阅/回放/背压）— `done` — Repo: `js/agents/runtime/events/event-bus.js`（`subscribe()` + `enableBackpressure()` + `replay()`）
- UnifiedAgentContext（门面）— `partial` — Repo: `js/agents/runtime/context/unified-agent-context.js`（DeepSearch 通过动态 import 尝试启用，见 `js/agents/stages/deepsearch/deepsearch-agent-loop.js`）
- CicadaCompressor（压缩）— `done` — Repo: `js/agents/runtime/compression/cicada-compressor.js`（LLM 压缩 + anchor 保留）
- “工具输出单条持久化/预览（<persisted-output>）” — `done`（但机制不同）— Repo: `js/agents/runtime/persisted-output.js` + `js/agents/stages/deepsearch/deepsearch-agent-loop.js`（`maybePersistToolOutput()`）

### 1.6 `doc-design-ui/analysis-jsagent/sdk-lifecycle.md`

- AgentBuilder（链式组装）— `done` — Repo: `js/agents/sdk/AgentBuilder.js`
- Capability 懒加载/注册制 — `done`（以 builder 组合为主）— Repo: `js/agents/sdk/AgentBuilder.js` + `js/agents/sdk/CapabilityInterface.d.ts`
- BacktrackManager（春秋蝉）— `done` — Repo: `js/agents/sdk/BacktrackManager.js`（DeepSearch 另有：`js/agents/stages/deepsearch/runtime/backtrack-manager.js`）
- 事件通配符监听 — `done` — Repo: `js/agents/runtime/events/event-bus.js`（`subscribe('deepsearch.*', ...)`）

### 1.7 `doc-design-ui/analysis-jsagent/stages-pipelines.md`

- textprep / codesearch / deepsearch / design 四阶段结构 — `done` — Repo: `js/agents/stages/`（各子目录）
- Design 黑板 — `done` — Repo: `js/agents/stages/design/design-blackboard.js`
- 差异化修复（设计）— `done` — Repo: `js/agents/stages/design/design-repair.js`
- 引用系统（citations）— `done` — Repo: `js/agents/stages/deepsearch/report/citations.js`
- “压缩后锚点识别” — `partial` — Repo: `js/agents/runtime/compression/cicada-compressor.js`（anchor 保留）+ DeepSearch writing handler 的启发式（`js/agents/stages/deepsearch/runtime/writing-phase-handler.js`）

### 1.8 `doc-design-ui/analysis-jsagent/infrastructure-ingestion.md`

- ingest adapters（pdf/pptx/docx/video/audio/code）— `done` — Repo: `js/agents/ingest/adapters/`
- asset-understanding — `done` — Repo: `js/agents/ingest/asset-understanding.js`
- chunked-loader — `done` — Repo: `js/agents/ingest/chunked-loader.js`
- retrieval（BM25/Readaround/router）— `done` — Repo: `js/agents/retrieval/`
- model-router + ppt-model-bridge — `done` — Repo: `js/agents/llm/model-router.js` + `js/agents/llm/ppt-model-bridge.js`
- “Git 深度集成” — `todo` — Repo: 当前无结构化 git 模块（对标 Claude：`ref/claude-code-open-main/src/git/`）

### 1.9 `doc-design-ui/analysis-jsagent/extensions-assistance.md`

- Prompts 外部化（Markdown）— `done` — Repo: `js/agents/prompts/` + `js/agents/prompts/prompt-loader.js`
- “提示词延迟渲染/变量注入” — `partial` — Repo: `js/agents/prompts/prompt-loader.js` 已提供 `renderPromptTemplate()`，DeepSearch system prompt 已迁移（`js/agents/stages/deepsearch/deepsearch-agent-loop.js`）；缺口：其他 stage 的模板/Builder 仍未统一收口
- Skills 动态注入 — `done` — Repo: `js/agents/skills/manager.js` + `js/agents/skills/loader.browser.js` + `js/agents/skills/user-store.js`
- Mock 测试套件 — `done` — Repo: `js/agents/testing/mock-suite.js`
- “Mock 录制 → Case 转换” — `partial` — Repo: 现有 mock-suite 可模拟/回放，但未形成“一键录制真实交互并转 mock”的产品化命令

### 1.10 `doc-design-ui/analysis-jsagent/README.md`

- 多模态支持（pdf/pptx/docx/video/audio）— `done` — Repo: `js/agents/ingest/adapters/`
- 春秋蝉 Backtrack — `done` — Repo: `js/agents/stages/deepsearch/runtime/backtrack-manager.js` + `js/agents/sdk/BacktrackManager.js`
- DeepSearch 闭环（Todo/Gap）— `done` — Repo: `js/agents/stages/deepsearch/`（`manage-todos`/`evaluate-gaps`/report pipeline）
- “安全沙箱化（Docker/Bwrap）” — `n-a`（Browser-Only）— 对标参考：`ref/claude-code-open-main/src/sandbox/`、`ref/codex-main/docs/sandbox.md`
- “极简 title-only 摘要” — `done` — Repo: `js/agents/runtime/core/agent-loop.js`（`titleOnlySummaryThreshold/titleOnlySummaryMaxWords`，超过阈值对旧消息做 title-only 摘要）
- “codesearch 集成 Tree-sitter” — `done` — Repo: `js/agents/shared/parser/tree-sitter-wasm.js` + `js/agents/stages/codesearch/indexing/symbol-indexer.js`
- “Tool Output 预览机制” — `done` — Repo: `js/agents/runtime/persisted-output.js` + `js/agents/stages/deepsearch/tools/get-artifact/handler.js`

---

## 2. analysis-cc（Claude Code）对照映射

> 参考实现目录：`ref/claude-code-open-main/`（分析文档来自该仓库的结构审计）。

### 2.1 `doc-design-ui/analysis-cc/core-agents.md`

- ConversationLoop（循环/消息流）— `done` — Ref: `ref/claude-code-open-main/src/core/loop.ts` — Repo: `js/agents/runtime/core/agent-loop.js`（`BaseAgentLoop`）+ `js/agents/runtime/orchestrator.js`
- Extended Thinking 展示/记录 — `partial` — Ref: `ref/claude-code-open-main/src/core/loop.ts` — Repo: 主要以事件/日志形式展示（`deepsearch.log.*`/ProcessPanel）；未形成显式的 `Thinking/Answer` 分块渲染
- Persisted Output（大输出落盘 + 预览）— `done` — Ref: `ref/claude-code-open-main/src/core/loop.ts`（persisted-output 语义）— Repo: `js/agents/runtime/persisted-output.js` + `js/agents/stages/deepsearch/tools/get-artifact/handler.js` + UI: `js/ppt/ui-v2/modals/modal-manager.js`（Artifacts Browser）
- 权限控制（会话级 “always allow”）— `done` — Ref: `ref/claude-code-open-main/src/permissions/` — Repo: `js/agents/runtime/policy/manager.js`（`remember:"always"` 写规则）+ UI: `js/ppt/ui-v2/modals/modal-manager.js`
- Session（消息/usage/权限设置持久化）— `partial` — Ref: `ref/claude-code-open-main/src/core/session.ts` — Repo: `js/agents/storage/run-store.js`（events/artifacts）+ `js/agents/storage/run-exporter.js`（zip 导出/导入）+ UI Runs 列表/编辑/删除（`js/ppt/ui-v2/modals/modal-manager.js` + `js/ppt/workflow/workflow-runtime.js` + `js/agents/storage/run-store.js#updateRunContext`）；缺口：更细粒度 session prefs（usage/模型/权限）仍未产品化
- Agents: plan/explore/resume/parallel — `partial` — Ref: `ref/claude-code-open-main/src/agents/` — Repo: 以 Stage 划分替代（codesearch/deepsearch/design）；已支持 `/resume runId [step]` 调用 `resumeWorkflowFromPlan`（UI: `js/ppt/ui-v2/views/modern-research-view.js` + `js/ppt/ui-v2/modals/modal-manager.js`；Runtime: `js/ppt/workflow/workflow-runtime.js`）；缺口：explore/parallel 等仍未产品化
- cleanOldPersistedOutputs（旧大输出清理）— `done` — Ref: `ref/claude-code-open-main/src/core/loop.ts` — Repo: persisted tool outputs 默认注入“最小引用”（无 preview）+ kept 消息会剔除旧 preview 并做硬截断保护（`js/agents/runtime/persisted-output.js`、`js/agents/runtime/core/agent-loop.js`）
- 智能截断（优先换行）— `partial` — Ref: `ref/claude-code-open-main/src/core/loop.ts` — Repo: persisted preview/kept message 已优先按换行/空格截断（`js/agents/runtime/persisted-output.js`、`js/agents/runtime/core/agent-loop.js`）；缺口：其他散落 `slice()` 仍未统一收口

### 2.2 `doc-design-ui/analysis-cc/prompts-tools.md`

- SystemPromptBuilder（模块化拼接）— `partial` — Ref: `ref/claude-code-open-main/src/prompt/builder.ts` — Repo: Prompts 外部化 + `js/agents/prompts/prompt-loader.js#renderPromptTemplate` 统一变量注入（DeepSearch 已接入）；缺口：模板组件化 + 多 attachment 组合的统一 Builder
- AttachmentManager（环境附件）— `partial` — Ref: `ref/claude-code-open-main/src/prompt/attachments.ts` — Repo: 目前主要注入 Tools/Skills Catalog；缺口：Git/诊断/环境信息作为可选附件体系
- PromptCache（hash 缓存构建）— `partial` — Ref: `ref/claude-code-open-main/src/prompt/cache.ts` — Repo: `js/agents/prompts/prompt-loader.js`（按 key 缓存加载）
- ToolRegistry — `partial` — Ref: `ref/claude-code-open-main/src/agents/tools.ts` — Repo: `js/agents/runtime/tools/tool-executor.js`（执行与校验）；工具注册分散在各 stage（如 `js/agents/stages/deepsearch/tools/index.js`）
- MultiEditTool — `done` — Ref: `ref/claude-code-open-main/src/tools/multiedit.ts` — Repo: VFS 事务编辑（`js/agents/vfs/operations.js#multiEditTextFileWithPolicy`）+ CodeSearch tools（`js/agents/stages/codesearch/code-tools.js`：`multi_edit`/`write_file`）
- LSPTool — `todo` — Ref: `ref/claude-code-open-main/src/tools/lsp/`（如存在）— Repo: 无 LSP 集成（可用 Tree-sitter/regex 索引替代一部分）
- McpTool（外部工具协议）— `partial` — Ref: `ref/claude-code-open-main/src/mcp/` — Repo: `js/agents/mcp/*`（client/provider），但“以 MCP schema 驱动的通用工具面”尚未产品化为统一 tool
- Token 估算 — `done` — Ref: `ref/claude-code-open-main/src/prompt/*` — Repo: `js/agents/runtime/core/agent-loop.js` + `js/agents/runtime/memory/memory-store.js` + `js/agents/runtime/compression/cicada-compressor.js`
- truncateToLimit + system-reminder — `partial` — Ref: `ref/claude-code-open-main/src/prompt/*` — Repo: BaseAgentLoop 已有 Cicada + 高填充率 title-only（`js/agents/runtime/core/agent-loop.js`）；DeepSearch 会注入 `<reminder>`（`js/agents/stages/deepsearch/deepsearch-agent-loop.js`）；缺口：通用的 prompt builder truncateToLimit 统一入口
- Diff-based EditTool — `partial` — Ref: `ref/claude-code-open-main/src/tools/edit.ts`（类比）— Repo: Design edit-mode 有操作级别增量编辑（`js/agents/stages/design/edit-mode/*`）；但对“代码文件编辑”的 diff 工具未建立

### 2.3 `doc-design-ui/analysis-cc/context-git.md`

- Summarizer（预算到顶自摘要）— `done` — Ref: `ref/claude-code-open-main/src/context/summarizer.ts` — Repo: `js/agents/runtime/compression/cicada-compressor.js`（LLM 压缩 + anchor 保留）
- collectWithinBudget（倒序收集）— `partial` — Ref: `ref/claude-code-open-main/src/context/*` — Repo: Cicada 采用 `keepLastTurns` 保留尾部，等价思路但实现不同
- “5-10 word title” 极简摘要 — `done` — Ref: `ref/claude-code-open-main/src/context/*` — Repo: `js/agents/runtime/core/agent-loop.js`（title-only summary）
- Git 结构化分析（DiffStats/CommitHistory/Merge-base）— `todo` — Ref: `ref/claude-code-open-main/src/git/` — Repo: 当前无 git 模块/工具

### 2.4 `doc-design-ui/analysis-cc/mcp-parser.md`

- MCP 资源管理器（resource manager adapter）— `partial` — Ref: `ref/claude-code-open-main/src/mcp/` — Repo: Browser-first ResourceManager（list/read/cache/subscribe）（`js/agents/mcp/resource-manager.js`），基于 provider 通知（SSE）做订阅更新
- MCP auto-discovery + preload + subscribe — `partial` — Ref: `ref/claude-code-open-main/src/mcp/auto-discovery.ts` — Repo: 已实现 auto-discovery + preload/cache（`js/agents/mcp/auto-discovery.js`）+ provider 级 subscribeNotifications(SSE)（`js/agents/mcp/mcp-nexus-provider.js` + `js/agents/mcp/sse.js`）；workflow-runtime 默认接入；缺口：完整 ConnectionManager/资源树 roots/prompt 同步仍未对齐
- Tree-sitter 符号提取（Query/.scm）— `partial` — Ref: `ref/claude-code-open-main/docs/comparison/analysis/parser-analysis.md` — Repo: `js/agents/shared/parser/tree-sitter-wasm.js` + `js/agents/stages/codesearch/indexing/symbol-indexer.js`（AST 遍历，不使用 `.scm query`）
- 符号缓存（queryCache/compiled query）— `done` — Ref: `ref/claude-code-open-main/src/parser/*` — Repo: SymbolIndexer queryCache + recordsCache（`js/agents/stages/codesearch/indexing/symbol-indexer.js`）
- 文档注释关联（JSDoc/docstring）— `done` — Ref: `ref/claude-code-open-main/src/parser/*` — Repo: 符号条目已关联前导注释（`js/agents/stages/codesearch/indexing/symbol-indexer.js`：`doc` 字段）
- 预过滤大文件 — `partial` — Ref: `ref/claude-code-open-main/src/mcp/*` — Repo: CodeSearch 工具对单文件 size 有上限（默认 512KB，`js/agents/stages/codesearch/code-tools.js`）

### 2.5 `doc-design-ui/analysis-cc/ui-renderer.md`

- 终端 UI（Ink/TSX）— `n-a` — 本仓库为浏览器 UI（`js/ppt/ui-v2/*`）
- Autocomplete（/command、@mention、path）— `partial` — Ref: `ref/claude-code-open-main/src/ui/autocomplete/` — Repo: slash commands palette + runId/steps 补全（`js/ppt/ui-v2/views/modern-research-view.js`）；缺口：@mention/path 自动补全未做
- MarkdownBlock 分块渲染 — `partial` — Ref: `ref/claude-code-open-main/src/ui/markdown-renderer.ts` — Repo: UI 侧对 artifacts/diff/approvals 有分块展示，但对消息输出未形成统一 block renderer
- DiffView（side-by-side/unified）— `done` — Ref: `ref/claude-code-open-main/src/ui/components/DiffView.tsx` — Repo: `vfs_checkpoint.json`（`js/agents/vfs/diff.js`）+ UI 支持 unified/side-by-side 切换与 Restore（`js/ppt/ui-v2/modals/modal-manager.js`）
- PermissionPrompt（交互式确认）— `done` — Ref: `ref/claude-code-open-main/src/ui/*` — Repo: `js/ppt/ui-v2/modals/modal-manager.js`（Approvals modal）

### 2.6 `doc-design-ui/analysis-cc/lifecycle-config.md`

- Lifecycle 事件总线 — `partial` — Ref: `ref/claude-code-open-main/src/lifecycle/` — Repo: `js/agents/runtime/events/event-bus.js` + `js/agents/runtime/orchestrator.js`（stage lifecycle events）
- 强类型配置（Zod）— `todo` — Ref: `ref/claude-code-open-main/src/config/` — Repo: 当前无统一 Zod 配置校验（仅局部校验/normalize）
- 七层配置覆盖 — `todo` — Ref: `ref/claude-code-open-main/src/config/` — Repo: 仅有少量“env > config.json > default”（例如 `js/agents/cli/model-client.js`）
- 配置热重载/备份/迁移 — `todo` — Ref: `ref/claude-code-open-main/src/config/` — Repo: 暂无

### 2.7 `doc-design-ui/analysis-cc/security-permissions.md`

- PBAC / PolicyEngine — `done` — Ref: `ref/claude-code-open-main/src/permissions/` — Repo: `js/agents/runtime/policy/engine.js`（type/tool/resource/path + priority + deny 优先；支持 all/any/not、timeRange、domain suffix、glob/wildcard；暂未做 env 条件）
- RuntimeMonitor（网络/文件/命令拦截）— `partial` — Ref: `ref/claude-code-open-main/src/security/` — Repo: 主要在 ToolExecutor/VFS 操作点做 gate（`js/agents/runtime/tools/tool-executor.js`、`js/agents/vfs/operations.js`）；缺口：统一的“全链路监控层”
- 审计日志（允许/拒绝均记录）— `done` — Ref: `ref/claude-code-open-main/src/security/audit.ts` — Repo: `policy.*` + `tool.*` + `vfs.*` 事件可持久化回放（`js/agents/runtime/events/event-bus.js` + `js/agents/storage/run-store.js`），UI 可见（FlowViz/Artifacts/Approvals）
- 命令注入检测 — `todo` — Ref: `ref/claude-code-open-main/src/security/*` — Repo: 暂无命令净化/注入检测专用模块

### 2.8 `doc-design-ui/analysis-cc/sandbox-environment.md`

- OS 级沙箱（docker/bwrap/seatbelt）— `n-a`（Browser-Only）— Ref: `ref/claude-code-open-main/src/sandbox/` — Repo: 以浏览器能力边界 + Policy/Approval 替代
- 资源限制器（CPU/Mem/Net）— `n-a` — Repo: 浏览器环境无法等价控制；可在 tool isolation (Worker) 侧做限时/限量（局部已有 timeout）
- 虚拟文件系统（mount）— `partial` — Repo: `js/agents/vfs/vfs.opfs.js`（OPFS）+ `js/agents/vfs/vfs.memory.js`（降级）属于“浏览器侧 VFS”

### 2.9 `doc-design-ui/analysis-cc/background-services.md`

- 优先级任务队列（并发控制）— `todo` — Ref: `ref/claude-code-open-main/src/background/` — Repo: `js/agents/runtime/orchestrator.js` 为顺序队列，无 priority/并发上限
- ShellManager（后台进程 SIGSTOP/SIGCONT）— `n-a`（Browser-Only）— Repo: 无本地 shell 进程
- Teleport（远程会话迁移）— `todo` — Ref: `ref/claude-code-open-main/src/teleport/` — Repo: 仅 Run zip 导出/导入（`js/agents/storage/run-exporter.js` + UI 入口）

### 2.10 `doc-design-ui/analysis-cc/multimedia-extensions.md`

- PDF/SVG/image 处理 — `done` — Ref: `ref/claude-code-open-main/src/media/` — Repo: `js/agents/ingest/adapters/`（pdf/pptx/docx/…）+ `js/agents/stages/design/generators/svg-generator.js`
- RateLimit（令牌桶）— `done` — Ref: `ref/claude-code-open-main/src/ratelimit/` — Repo: `js/agents/llm/rate-limit.js` + `js/ppt/workflow/workflow-runtime.js`
- Updater/CodeSign/Chrome 扩展通信 — `n-a/partial` — Repo: 浏览器静态站点不做 CLI updater；Chrome 扩展通信不在当前产品化范围

### 2.11 `doc-design-ui/analysis-cc/cloud-providers.md`

- 多云后端 detectProvider / Bedrock / Vertex / SigV4 — `todo` — Ref: `ref/claude-code-open-main/src/providers/` — Repo: 当前由外部 `aiApiService` 注入提供能力，`js/agents/llm/model-router.js` 只做 usage 路由，不做云后端探测/签名
- 模型别名映射（MODEL_MAPPING）— `partial` — Ref: `ref/claude-code-open-main/src/providers/*` — Repo: ModelRouter 支持 usage→模型列表映射（`js/agents/llm/model-router.js`），但不做跨云 alias 解析

### 2.12 `doc-design-ui/analysis-cc/commands-plugins.md`

- Slash commands（/config /auth /compact …）— `partial` — Ref: `ref/claude-code-open-main/src/commands/` — Repo: 已有 Browser UI 的 slash commands（`js/ppt/ui-v2/views/modern-research-view.js`），通过 `ui.action` 驱动 modal/undo/replay（`js/ppt/ui-v2/modals/modal-manager.js`）；缺口：未实现 Claude CLI 的完整命令体系与参数交互
- 插件体系（hooks 注入）— `partial` — Ref: `ref/claude-code-open-main/src/plugins/` — Repo: ToolExecutor hooks + middleware-chain 提供“拦截点”，但缺少插件包/发现/生命周期
- 交互式参数补问（命令缺参）— `partial` — Repo: 有 ask-user 工具（`js/agents/stages/deepsearch/tools/ask-user/handler.js`）+ Approvals modal，但未抽象为命令系统通用机制

### 2.13 `doc-design-ui/analysis-cc/plan-persistence.md`

- Plan mode（多方案对比/成本量化）— `partial` — Ref: `ref/claude-code-open-main/src/plan/` — Repo: 已有 PlanStore + Plans Manager（`js/agents/runtime/plan/plan-store.js` + `js/ppt/workflow/workflow-runtime.js` + `js/ppt/ui-v2/modals/modal-manager.js`）；缺口：成本量化/对比视图仍未对齐
- Plan 持久化（跨会话恢复）— `done` — Ref: `ref/claude-code-open-main/src/plan/persistence.ts` — Repo: Plan JSON 写入 RunStore artifacts（`js/agents/runtime/plan/plan-store.js` + `js/ppt/workflow/workflow-runtime.js`）+ UI restore/resume（`js/ppt/ui-v2/modals/modal-manager.js`）
- Checkpoints（事务性回滚）— `partial` — Ref: `ref/claude-code-open-main/src/checkpoint/` — Repo: VFS checkpoints（`js/agents/vfs/checkpoints.js`）+ Restore UI（`js/ppt/ui-v2/modals/modal-manager.js`）；缺口：对“所有工具写入”的统一 pre/post checkpoint

### 2.14 `doc-design-ui/analysis-cc/README.md`

- 自消化上下文（Summarizer）— `done` — Ref: `ref/claude-code-open-main/src/context/summarizer.ts` — Repo: `js/agents/runtime/compression/cicada-compressor.js`
- 分层安全栅栏（Policy + Monitor）— `partial` — Ref: `ref/claude-code-open-main/src/permissions/` + `ref/claude-code-open-main/src/security/` — Repo: `js/agents/runtime/policy/*` + `tool.*`/`policy.*` 审计事件；缺口：统一 RuntimeMonitor
- 持久化任务状态（跨会话）— `partial` — Repo: `js/agents/storage/run-store.js` + `js/agents/storage/run-exporter.js`（Run 级别）；缺口：Plan/Session 级恢复 UX
- 结构化代码洞察（Tree-sitter/LSP）— `partial` — Repo: Tree-sitter wasm 已落地；LSP 未落地（见 5 节）
- “引入沙箱机制（Docker）” — `n-a`（Browser-Only）
- “实现任务恢复（resume）” — `partial` — Repo: Run replay + zip import（`js/ppt/workflow/workflow-runtime.js`、`js/agents/storage/run-exporter.js`）；缺口：对中断执行点的“继续跑”语义
- “优化 Prompt 结构（模块化附件）” — `partial` — Repo: Prompts 外部化 + 动态注入；缺口：AttachmentManager/Builder 体系
- “强化视觉体验（结构化块渲染）” — `partial` — Repo: Artifacts/Approvals 已分块；缺口：对主消息流的统一 block renderer

---

## 3. analysis-cx（Codex）对照映射

> 参考实现目录：`ref/codex-main/`（Rust core + Node wrapper + 协议与沙箱）。

### 3.1 `doc-design-ui/analysis-cx/codex-cli.md`

- Node wrapper + vendor 原生二进制分发 — `n-a` — Ref: `ref/codex-main/codex-cli/` — Repo: 浏览器端项目，不分发 native binary
- 进程/信号转发 — `n-a`
- 包管理器探测 — `n-a`

### 3.2 `doc-design-ui/analysis-cx/codex-rs-core.md`

- Op ↔ Event 解耦（UI 与推理/工具执行分离）— `done` — Ref: `ref/codex-main/codex-rs/tui/src/chatwidget/agent.rs` — Repo: `js/agents/runtime/events/event-bus.js` + `js/ppt/workflow/agent-event-bridge.js`
- History/Backtrack（非线性会话）— `partial` — Ref: `ref/codex-main/codex-rs/tui/src/app_backtrack.rs` — Repo: DeepSearch backtrack（`js/agents/stages/deepsearch/runtime/backtrack-manager.js`）+ VFS checkpoints；缺口：面向用户的“全局对话 fork/回溯” UX
- Overlay/Pager（大文本展示）— `done` — Repo: Artifacts Browser（events.jsonl、persisted outputs、diff）提供大文本查看（`js/ppt/ui-v2/modals/modal-manager.js`）

### 3.3 `doc-design-ui/analysis-cx/codex-rs-system.md`

- Landlock/Seccomp OS 沙箱 — `n-a`（Browser-Only）— Ref: `ref/codex-main/codex-rs/*sandbox*` — Repo: 不适用
- “最小权限原则”的运行时表达 — `partial` — Repo: PolicyEngine/Approval（`js/agents/runtime/policy/*`）可表达一部分能力边界，但无法提供 OS 级强保证
- “契约先行” protocol crate — `partial` — Repo: 事件契约/类型定义（`js/agents/events.d.ts`）与 EventRecord schemaVersion（`js/agents/runtime/events/event-bus.js`）

### 3.4 `doc-design-ui/analysis-cx/core-engine.md`

- ToolOrchestrator（Approval→Sandbox→Attempt→Retry）— `partial` — Ref: `ref/codex-main/codex-rs/core/` — Repo: ToolExecutor（schema 校验 + hooks + retries + policy gate，`js/agents/runtime/tools/tool-executor.js`）；缺口：sandbox selection 不适用
- “万物皆 Task / 可取消” — `partial` — Ref: `SessionTask` 模型 — Repo: `AgentOrchestrator` 支持取消（AbortSignal），但缺少统一 Task 抽象/队列优先级
- Ghost Snapshot（Git 级撤销）— `partial` — Ref: `ref/codex-main/docs/slash_commands.md` 的 `/undo` 语义 — Repo: VFS checkpoint restore（文件级）；缺口：对真实 git 工作区的 ghost commit
- Retry with Escalation（沙箱失败→提权重试）— `n-a/partial` — Repo: 无 OS 沙箱；但可用 Policy “prompt/allow” 切换代替一部分体验

### 3.5 `doc-design-ui/analysis-cx/sdk-mcp.md`

- Thread/Session 持久化语义 — `partial` — Ref: `ref/codex-main/docs/skills.md`/sessions — Repo: RunStore + zip 导出/导入（Run 级别，不是 Thread API）
- shell-tool-mcp（安全 bash）— `n-a` — Repo: 浏览器端无本地 bash
- MCP 作为工具协议 — `partial` — Repo: `js/agents/mcp/*`（但未作为统一 tool 生态产品化）

### 3.6 `doc-design-ui/analysis-cx/aux-modules.md`

- Rust file-search（高性能搜索）— `n-a/partial` — Repo: codesearch 以 VFS + glob/regex/tree-sitter 为主（`js/agents/stages/codesearch/*`）
- ANSI 转换 — `n-a`（Web UI 不依赖 ANSI）
- 云端任务拉取（get_task/apply_command）— `todo` — Repo: 暂无“任务队列/远程任务”模型

### 3.7 `doc-design-ui/analysis-cx/server-ci.md`

- JSON-RPC App Server（IDE 插件）— `todo` — Ref: `ref/codex-main/codex-rs/app-server*` — Repo: 暂无
- CI prompt/ascii check — `todo` — Ref: `ref/codex-main/scripts/asciicheck.py` — Repo: 暂无对应 CI 校验脚本

### 3.8 `doc-design-ui/analysis-cx/summary-agent-design.md`

- Op-Event 契约模式 — `done` — Ref: `ref/codex-main/codex-rs/tui/src/chatwidget/agent.rs` — Repo: `js/agents/runtime/events/event-bus.js` + `js/ppt/workflow/agent-event-bridge.js`
- 沙箱分级制（ReadOnly/WorkspaceWrite/FullAccess）— `n-a/partial` — Ref: `ref/codex-main/docs/sandbox.md` — Repo: 无 OS 沙箱；但可用 Policy/Approval 做“能力分级”的近似
- MCP 作为标准工具接口 — `partial` — Ref: `ref/codex-main/shell-tool-mcp/` — Repo: `js/agents/mcp/*` 已有，但尚未形成统一的“工具生态接入与缓存 schema（TTL）”
- Undo（会话/文件回滚）— `partial` — Ref: Codex `/undo` + ghost snapshot — Repo: VFS checkpoint restore + Design edit undo/redo；缺口：Git ghost snapshot

---

## 4. ref/codex-main（关键实现点 → 本仓库映射）

> 这一节直接对照 Codex 官方文档/协议形态，避免只看二次分析文本。

- Sandbox & approvals（`ref/codex-main/docs/sandbox.md`）— `partial` — Repo: 本仓库已具备 Approval UI + Policy 审计事件流（`js/agents/runtime/policy/manager.js` + `js/ppt/ui-v2/modals/modal-manager.js`），但无 OS 沙箱（Browser-Only）
- Skills（`ref/codex-main/docs/skills.md`）— `partial` — Repo: Browser skills manifest + user skillpack（`js/agents/skills/loader.browser.js` + `public/skills/manifest.json` + `js/agents/skills/user-store.js`）；差异：Codex 的“只注入元数据、body 按需打开”与本仓库策略接近，但存储/发现机制不同
- Custom prompts as slash commands（`ref/codex-main/docs/prompts.md`）— `partial` — Repo: Prompts 外部化（`js/agents/prompts/*`），但无 `/prompts:<name>` 命令体系/参数校验 UI
- Slash commands（`ref/codex-main/docs/slash_commands.md`）— `partial` — Repo: Browser UI 已覆盖 `/status /undo /skills /approvals /history` 等子集（`js/ppt/ui-v2/views/modern-research-view.js`）；缺口：/diff/@mention 等仍未对齐 CLI 体验
- Execpolicy（`ref/codex-main/docs/execpolicy.md`）— `partial` — Repo: `js/agents/runtime/policy/engine.js` 支持 allow/deny + wildcard/glob + priority；缺口：starlark `.rules` 语法、match/not_match 自测、严格解析器

---

## 5. ref/claude-code-open-main（关键实现点 → 本仓库映射）

- Sandbox 实现（`ref/claude-code-open-main/docs/IMPLEMENTATION_CHECKLIST.md` + `ref/claude-code-open-main/src/sandbox/`）— `n-a`（Browser-Only）
- Plan persistence（`ref/claude-code-open-main/docs/PLAN_PERSISTENCE_IMPLEMENTATION.md` + `ref/claude-code-open-main/src/plan/`）— `done` — Repo: RunStore artifacts 保存 plan JSON + UI Plans Manager（`js/agents/runtime/plan/plan-store.js` + `js/ppt/workflow/workflow-runtime.js` + `js/ppt/ui-v2/modals/modal-manager.js`）
- Teleport（`ref/claude-code-open-main/docs/teleport-feature.md` + `ref/claude-code-open-main/src/teleport/`）— `partial` — Repo: 仅有 run zip 导入/导出（离线迁移），无实时远程连接
- Permissions（`ref/claude-code-open-main/src/permissions/`）— `done` — Repo: `js/agents/runtime/policy/*`（支持 all/any/not、timeRange、domain suffix、glob/wildcard + 审计事件流 + Policy Rules UI）
- Streaming tolerant JSON（官方 parseTolerantJSON 思路）— `done/partial` — Repo: `js/agents/shared/utils/robust-json.js` 已覆盖尾逗号/单引号/截断闭合等常见修复；缺口：与“流式增量 parser 状态机”并不等价（当前为整体修复再 parse）
- Tree-sitter wasm（`ref/claude-code-open-main/docs/comparison/analysis/parser-analysis.md`）— `done` — Repo: `js/agents/shared/parser/tree-sitter-wasm.js` + `public/wasm/tree-sitter/*` + `js/agents/stages/codesearch/indexing/symbol-indexer.js`
- LSP（`ref/claude-code-open-main/docs/LSP_IMPLEMENTATION_SUMMARY.md`）— `todo` — Repo: 暂无 LSP 客户端/工具

---

## 6. Gap 汇总（建议优先级）

> Browser-Only 的“限制 → 降级/替代”路线图见：`doc-design-ui/BROWSER_ONLY_FEASIBILITY.md`。

### P0（当前最影响对齐度/可靠性）

- Plan 持久化/恢复（Browser-first）— `done`（`js/agents/runtime/plan/plan-store.js` + `js/ppt/workflow/workflow-runtime.js` + `js/ppt/ui-v2/modals/modal-manager.js`）
- Policy 规则表达 + 规则管理 UI — `done`（`js/agents/runtime/policy/*` + `js/ppt/ui-v2/modals/modal-manager.js`）
- “弱 Git”（VFS checkpoints/diffstat/undo）— `partial`（`/changes` + `vfs_checkpoint.json`；缺口：merge-base/commit history）
- MCP auto-discovery + preload + schema cache — `partial`（`js/agents/mcp/auto-discovery.js` + `js/ppt/workflow/workflow-runtime.js`；已补齐 healthCheck + SSE notifications subscribe（`js/agents/mcp/mcp-nexus-provider.js` + `js/agents/mcp/sse.js`）+ ResourceManager（`js/agents/mcp/resource-manager.js`）；缺口：prompts/roots 全量对齐与统一 ConnectionManager）

### P1（体验与工程完整性）

- 输出 Block Renderer：Thinking/ToolCall/ToolResult/Answer/Warn 分块 — `partial`（Artifacts Browser 对 `events.jsonl` 已提供 Blocks/Raw 视图，覆盖 tool/policy/vfs/log/warn 分类：`js/ppt/ui-v2/modals/modal-manager.js`；缺口：对“LLM thinking/answer message” 的结构化渲染仍未对齐）
- DiffView side-by-side/unified — `done`
- “旧 persisted-output 清扫策略” — `done`
- /slash commands 输入层（命令 palette）— `done`

### P2（可选增强）

- 远程会话实时迁移（Teleport/WebSocket）
- 统一 Task 抽象与优先级队列（替代单纯顺序 orchestrator）
- CI 校验：prompt/skill/ascii check
