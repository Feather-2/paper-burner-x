# Paper Burner Agents：纯浏览器端架构与细节建议

> 目标：在**不依赖 Node.js / 本地进程 / 自建后端**的前提下，让当前 `js/agents` 体系在浏览器中可运行、可扩展、可调试、可回放，并对标 Claude Code / Codex 的工程强度。
>
> 依据：`doc-design-ui/analysis-cc/*`、`doc-design-ui/analysis-cx/*`、`doc-design-ui/analysis-jsagent/*`、`doc-design-ui/AGENT_HIDDEN_FEATURES.md`、`js/agents/ARCHITECTURAL_REVIEW.md`、`js/agents/events.d.ts`、`js/agents/runtime/events/event-bus.js`。

---

## 0. 设计原则（Browser-Only Hard Constraints）

1. **运行时约束**：仅浏览器（Window + WebWorker + ServiceWorker + WASM），不假设 `fs`、`child_process`、`worker_threads`、本地 MCP stdio、Docker 等能力存在。
2. **能力边界显式化**：所有“文件/网络/剪贴板/下载”等能力一律走**Tool + Policy + Approval**，默认最小权限（Deny by default）。
3. **上下文只追加（Cache-Friendly）**：尽量不“编辑”历史；把动态知识以 tool_result 的形式追加，优先命中 Prompt Cache（对齐 Skills 文章的“只追加不编辑”范式）。
4. **大数据不进上下文**：工具输出、HTML、PDF 解析结果等进入**外部存储（ID 引用）**，上下文只保留摘要/索引/locator（Observation Masking）。
5. **UI 与 Agent 解耦**：主线程只做渲染/交互；推理循环、压缩、检索、解析、工具执行尽量在 Worker 内完成（避免 UI 冻结）。
6. **可回放/可撤销优先**：所有关键状态变更走事件流（Op-Event / event-sourcing），支持 Replay 与 Backtrack。

---

## 1. 当前 `js/agents` 架构（As-Is 摘要）

### 1.1 核心运行模型：Stage 驱动 + Loop

- `AgentOrchestrator`：注册并按序执行 stages（`textprep` / `codesearch` / `deepsearch` / `design`），全局 `AbortSignal` 管控取消/暂停。
- `BaseAgentLoop`：统一的循环框架，支持暂停点（`StagePausedError`）与中止信号合并（`mergeSignals`）。
- `EventBus`：贯穿全链路的事件基座，UI/Telemetry/各阶段监听 `started/progress/completed/failed` 等事件，实现逻辑与展示解耦。

### 1.2 记忆与上下文：L0-L3 + Cicada（春秋蝉）压缩

- L0（Immutable）：任务目标、系统约束、关键 TODO（应永久保留、不可压缩）。
- L1（Working）：当前轮消息、实时信号、近期决策（可压缩/合并）。
- L2（Condensed）：摘要、Claims、阶段发现（周期更新，需防语义漂移）。
- L3（Archive）：检查点/快照/索引（外部存储，按需召回）。
- `CicadaCompressor`：在 token 阈值附近触发异步压缩（`queueMicrotask`），并在模型调用前通过同步屏障（如 `flushCompression`）避免竞态。

### 1.3 工具系统：Schema 校验 + Worker 隔离

- Tool 定义 + JSON Schema 强校验（避免 LLM 乱参）。
- `ToolExecutor` 支持隔离模式（Node 侧有 `worker_threads`；浏览器应对齐为 WebWorker）。
- 需要补齐 Claude Code 的 `<persisted-output>`：巨型工具返回要“落盘 + 预览 + 引用”。

### 1.4 Skills / Prompts：知识外置 + 动态注入

- Prompts 外部化（Markdown 模板 + loader），按阶段分类。
- Skills 注入式管理（`SkillInjection` 已有索引优化倾向），适合做“渐进式披露：元数据 -> SKILL.md -> assets/scripts/references”。
- 关键工程点：Skill 内容最好作为 tool_result 追加进 messages（保持 prompt cache）。

### 1.5 MCP：Local + Nexus Provider（但纯浏览器有断点）

- 本地 MCP / Nexus 中转可扩展工具生态，但“纯浏览器”无法直接跑 stdio 本地进程。
- 当前更合理的 browser-only 路径：**只接 Web 可达的 MCP Server（HTTP/SSE/WS，且 CORS 允许）**，或把工具“内置为 Web-native Tools / WASM Tools”。

### 1.6 浏览器端已知挑战（来自审计）

- UI 冻结：压缩、深克隆、解析/正则扫描若在主线程会卡死。
- CORS：浏览器直连第三方 API 受限（需要可 CORS 的提供商/端点）。
- Secrets：API Key 落在 LocalStorage/IndexedDB 有 XSS 风险（需加密与 CSP）。

---

## 2. 目标架构（To-Be）：Browser-Only “Op-Event + Worker Runtime”

### 2.1 总体分层

```
┌─────────────────────────────── Browser UI (Main Thread) ───────────────────────────────┐
│ Chat/Console UI · Diff Viewer · Plan/Todos · Approvals · Skill Manager · Replay Viewer │
│                         ▲ postMessage(Op/Event) ▼                                      │
└─────────────────────────┬───────────────────────────────┬──────────────────────────────┘
                          │                               │
                          │                               └── Service Worker (可选): 缓存/离线/下载
                          ▼
┌────────────────────────────── Agent Runtime (Dedicated Worker) ───────────────────────┐
│ Orchestrator · BaseAgentLoop · ToolOrchestrator · PolicyEngine · SkillManager          │
│ MemoryStore(L0-L3) · CicadaCompressor · RunStore/Telemetry · MCP Client (Web)          │
│             │                                     │                                    │
│             ├── Tool Workers（可选）：Search/Parse/OCR/Embedding/Compression            │
│             └── Storage：IndexedDB + OPFS(大对象/Blob)                                  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 UI <-> Agent 的契约：Op-Event（对齐 Codex）

- **UI 发 Op**：`Op::SendUserMessage` / `Op::Approve` / `Op::Cancel` / `Op::Backtrack` / `Op::LoadSkillPack` …
- **Agent 发 Event**：`Event::AssistantDelta` / `Event::ToolCall` / `Event::ToolResult` / `Event::PlanUpdated` / `Event::CheckpointCreated` / `Event::Error` …
- 所有事件写入 `RunStore`，支持：回放（Replay）、定位卡点、导出调试包（zip）。

#### 2.2.1 EventRecord 作为“单一真源”（对齐现有 EventBus）

当前 `js/agents/runtime/events/event-bus.js` 已经具备事件溯源（event-sourcing）的骨架：任何 `emit()` 最终都会落成统一结构的 `EventRecord`。

建议将其正式升级为“跨 Worker / UI 的唯一数据契约”，并把 `js/agents/events.d.ts` 作为类型层面的契约入口：

- **Record vs Payload 分层**：`runId/eventId/ts/name/actor/status/meta` 属于 record；业务数据一律放在 `payload`。
- **避免 root 漏字段**：不要把 `iteration/mode/error/...` 等业务字段散落在 record root（否则下游 bridge/UI 很容易丢数据）。
- **UI Bridge 两种模式**：
  1. **传完整 record（推荐）**：UI 层用 `evt.payload` 渲染、用 `evt.runId/ts/actor` 做过滤/回放索引。
  2. **只传 payload（兼容）**：bridge 层必须把 `evt.runId` 等必要 meta 合并进 payload（至少保证 `runId` 可用）。
- **生命周期命名规范（建议固化）**：
  - Run：`run.started` → `run.completed|run.failed|run.cancelled` → `run.ended`（`run.completed/run.failed` 可作为兼容别名）。
  - Stage：`${stage}.started/.progress/.completed/.failed`（UI 层将 `.completed` 与旧 `.ended` 视作同义）。
  - 领域事件：`deepsearch.*`、`design.*`、`ingest.*`、`compression.*`、`*.log.*`。

---

## 3. 关键模块建议（Browser-Only 可落地）

### 3.1 ToolOrchestrator：权限、审计、持久化输出

1. **工具分级 + PolicyEngine（PBAC 思路）**
   - Tool metadata：`capabilities: ["fs.read", "fs.write", "net.fetch", "ui.prompt", ...]`
   - Policy：按 tool + 资源路径（glob）+ host/domain + 时间窗组合（`and/or/not`），Deny 优先。
2. **Approval UX（会话记忆）**
   - 支持：允许一次 / 本次会话允许 / 总是允许（保存到加密配置）。
3. **Persisted Output（必做）**
   - 阈值：单次 tool_result 超过 N KB => 写入 OPFS/IndexedDB Blob，返回 `<persisted-output id=... preview=...>`。
   - 上下文仅注入 preview + locator；完整内容通过 UI “展开查看”。
4. **Observation Masking**
   - HTML/PDF/OCR/日志等原文不入上下文；只保存：摘要、关键字段、引用 ID、以及“如何复现/重新取数”的指令。

### 3.2 Browser 文件系统：VFS + OPFS +（可选）File System Access API

1. **统一 VFS 抽象**
   - 读写接口统一：`read(path) / write(path) / list(glob) / stat / diff / snapshot`。
2. **两种工作区来源**
   - **默认**：OPFS（Origin Private File System），适合“纯浏览器闭环编辑/生成”。
   - **增强**：File System Access API（用户授权映射本地目录）；注意：无法可靠监听外部修改 => 采用“写前校验指纹”。
3. **检查点/撤销（Browser 版 Ghost Snapshot）**
   - 写操作前对目标文件生成 `sha256`（或增量 hash），存入 checkpoint。
   - 回滚时按 diff/旧版本恢复；避免全量复制（大文件用 chunked diff）。

### 3.3 Skill 系统：渐进式披露 + 可移植 Skill Pack

1. **SkillPack 作为可分发单元**
   - `manifest.json`：`name/description/tags/version/allowedTools/entry(SKILL.md)`。
   - 支持：内置包（随站点发布）+ 用户导入 zip（纯浏览器离线可用）。
2. **触发机制**
   - 启动仅加载 `name + description + tags`（元数据）。
   - 触发时用 `Skill` 工具加载完整 SKILL.md，并以 tool_result 追加进 messages（保持缓存）。
3. **规则引擎（参考 Claude Code 的 Action Transform Engine）**
   - 在“写入文件/提交 patch”前，对 diff 做正则 lint + transform（例如替换 `console.log` -> `logger.info`）。
   - Browser 端实现不依赖 AST 也能覆盖 80% 场景；高级场景可接 Tree-sitter-wasm。

### 3.4 MCP（Browser-Only 版本）

1. **只支持 Web Transport 的 MCP**
   - HTTP(S) + SSE / WebSocket，且要求 CORS 允许（或同源）。
2. **内置 MCP-to-Tool 适配层**
   - 把远端 MCP 工具声明拉取后转为本地 Tool schema（并缓存 TTL）。
3. **可选“增强模式”（不破坏纯浏览器）**
   - 若用户自愿配置 `workerEndpoint/proxyEndpoint`（如自托管/第三方），则开启更多工具；核心应用仍可在无该配置时运行。

### 3.5 解析与检索：WASM 化、Worker 化、可索引

1. **Search**
   - 小规模：纯 JS + 倒排索引（IndexedDB）。
   - 大规模：`ripgrep` 替代为 wasm/自研 tokenizer + 线性扫描（在 Search Worker）。
2. **语义解析（Tree-sitter-wasm）**
   - 用 `.scm` query 抽取符号（函数/类/注释），构建 `symbols.json`（仅索引，不塞上下文）。
3. **索引策略**
   - 增量构建：按文件 hash 判断是否需要重建。
   - 预算友好：索引存储在 IndexedDB，按需召回片段。

### 3.6 上下文治理：抗退化 + 抗漂移

1. **Anchored Iterative Summarization（锚定摘要）**
   - 固定锚点：`taskGoal / hardConstraints / openTodos / decisions` 永不进入递归摘要。
2. **退化检测（Lost-in-the-middle / Poisoning）**
   - 在压缩前后对锚点做一致性校验；发现漂移时触发 `Backtrack` 或重新注入原始约束。
3. **Token 估算**
   - 先用启发式；再逐步引入轻量 tokenizer（WASM）以减少溢出误差。

### 3.7 安全：Secrets、CSP、审计

1. **Secrets 加密存储（必须）**
   - 用 WebCrypto 生成/派生密钥（passphrase 解锁），加密存放到 IndexedDB。
   - 解密后的 key 仅驻留内存，支持“一次会话”模式。
2. **CSP + Markdown 渲染隔离**
   - 禁止 `unsafe-inline`，对渲染内容做严格消毒；工具输出默认按纯文本展示，富文本需要白名单。
3. **审计日志**
   - 记录：tool name、参数摘要、权限决策、结果 hash、写入文件 diff id；支持导出。

### 3.8 流式输出与鲁棒解析：避免“工具调用崩溃”

1. **流式数据的容错 JSON Parser**
   - 对齐 Claude Code 的 `parseTolerantJSON` 思路：对“半截 JSON / 尾逗号 / 引号未闭合”等做状态机修复，降低流式中断导致的工具调用崩溃。
2. **背压（Backpressure）与 UI 增量渲染**
   - 主线程渲染严格限频（例如按帧或按字节窗口合并 delta），避免“输出风暴”卡死页面。
3. **结构化输出块（Block Renderer）**
   - 把消息拆成：Thinking / ToolCall / ToolResult / Answer / Warnings 等块类型；ToolResult 默认折叠并只显示 preview（与 persisted-output 统一）。

### 3.9 交互层：Slash Commands / 自动补全 / Diff 体验

1. **Slash Commands（参考 Claude Code）**
   - 建议至少提供：`/help`、`/reset`、`/export-run`、`/import-run`、`/tokens`、`/policy`、`/skills`、`/checkpoint`。
2. **三路补全**
   - `/command`、`@mention`（如 `@file` / `@symbol` / `@skill`）、`path/to/file`（基于 VFS 索引）。
3. **DiffView 作为一级能力**
   - 工具写文件必须产出 diff；UI 支持 unified/side-by-side；写入前必须可预览 + 可撤销。

### 3.10 浏览器能力探测与降级（WASM Fallback Pattern）

1. **双轨加载**
   - 能用原生 Web API（如 `DOMParser`/`File System Access`）则用；否则回退到纯 JS/WASM（如线性 HTML 扫描器、OPFS）。
2. **能力矩阵（必须显式）**
   - `supportsOPFS` / `supportsFSAccess` / `supportsWorkerModule` / `supportsWebCrypto` / `supportsWasmSIMD` 等决定启用哪些 Tools/Stages。
3. **不可用时的“产品化降级”**
   - 例如：无 FS Access => 仅 OPFS 工作区；无 WASM SIMD => 降级为小规模索引或分块扫描；无跨域权限 => 禁用某些网络工具并提示用户配置 CORS 兼容端点。

---

## 4. 面向落地的 Roadmap（建议分 4 个里程碑）

1. **M1：Worker Runtime + Op-Event**
   - 把 Orchestrator/Loop 移入 Dedicated Worker；UI 仅收发 Op/Event；RunStore 可回放。
2. **M2：VFS + Checkpoints + Persisted Output**
   - OPFS 工作区；写前 checkpoint；大输出落盘引用；Diff/Undo 可用。
3. **M3：Skills 渐进式披露 + Policy/Approval**
   - SkillPack 导入；Skill tool 注入；PolicyEngine + 审计 + 会话记忆授权。
4. **M4：WASM Search/Parse + MCP(Web)**
   - Tree-sitter-wasm 符号索引；检索 worker；Web-MCP 工具生态接入。

---

## 5. 快速对标表（建议优先级）

| 能力 | 参考来源 | 对 Browser-Only 的落地建议 | 优先级 |
| --- | --- | --- | --- |
| `<persisted-output>` 巨型输出治理 | Claude Code | OPFS/IndexedDB Blob + preview + 引用 | P0 |
| Op-Event 协议化运行时 | Codex | UI<->Worker 数据契约 + RunStore replay | P0 |
| PBAC/PolicyEngine + 审计 | Claude Code | capabilities + domain/path policy + approval | P0 |
| Skills 渐进式披露 | Skills 文章/Claude Code | 元数据索引 + tool_result 注入保持缓存 | P0 |
| Checkpoint/Undo | Codex/Claude Code | diff-based snapshot（Browser 版 ghost） | P1 |
| Tree-sitter Query 符号提取 | Claude Code | tree-sitter-wasm + symbols index | P1 |
| Rule/Transform Engine | Claude Code | 写入前 regex lint/transform | P2 |
| Code Fingerprinting | Claude Code | write 前 hash 校验 + 可选签名（libsodium/tweetnacl） | P2 |
