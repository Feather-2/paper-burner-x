# Agents 架构风险硬化落地（对标 Codex / Claude Code）

> 基于 `doc-design-ui/AGENTS_ARCHITECTURE_RISKS.md` 的风险清单，参考：
> - Codex：`ref/codex-main/`
> - Claude Code Open：`ref/claude-code-open-main/`
>
> 目标：把“风险 → 参考实现 → 本仓库落地/缺口”对齐成可执行的工程清单，并记录已落地的变更点。

---

## 0. 参考实现怎么做（抽取可迁移的工程解法）

### 0.1 Codex（`ref/codex-main/`）

- **强约束的运行时与可取消任务**：核心流程被建模为可取消/可恢复的任务单元（Task），并倾向于“错误显式化”（Rust `Result` + 统一事件流）。
- **文件系统“后悔药”**：提供 `/undo`，通过 **Ghost Snapshot / Ghost Commit** 机制回滚工作区（见 `ref/codex-main/docs/slash_commands.md`，以及实现线索 `ref/codex-main/codex-rs/utils/git/src/ghost_commits.rs`）。
- **资源治理**：大量模块通过 `cleanup()/drop/LRU` 等模式主动释放资源（例如 LRU cache：`ref/codex-main/codex-rs/utils/cache/src/lib.rs`）。

### 0.2 Claude Code Open（`ref/claude-code-open-main/`）

- **权限与审计闭环**：权限请求/决策/审计日志一体化（`ref/claude-code-open-main/src/permissions/`）。
- **文件检查点 + 增量 Diff + 回滚**：提供文件检查点系统，支持增量 diff、保留策略、压缩与失败回滚（`ref/claude-code-open-main/src/checkpoint/index.ts`）。
- **会话回滚语义（rewind/undo）**：提供命令层的回滚入口（例如 `/rewind` alias `/undo`，见 `ref/claude-code-open-main/tests/commands/README.md`）。

> 可迁移结论：两者都在“**副作用可撤销** + **状态机强约束** + **错误不吞**”上做了工程闭环；Browser-only 场景无法复刻 OS/Git 级能力，但可以用 **VFS checkpoints + side-effect journal + strict transitions** 做近似。

---

## 1. 风险清单 → 本仓库落地状态（截至当前）

### 1.1 异步陷阱与异常吞噬（Silent Failures）

- **落地**：移除 `catch (_) {}` 的静默吞错，改为结构化 `warn`（并对高频路径做“warn once”）。
  - `js/agents/stages/design/agent-loop.js`
  - `js/agents/mcp/smart-content-extractor.js`

### 1.2 状态机“软约束”（State Machine Integrity）

- **落地**：`BaseAgentLoop._transitionLoopStatus()` 增加可选的**严格校验**，默认在生产环境开启（可通过开关关闭/降级为 warn-only）。
  - 实现：`js/agents/runtime/core/agent-loop.js`
  - 开关：
    - 环境变量：`PB_STRICT_LOOP_STATUS_TRANSITIONS=0|1`
    - 浏览器：`localStorage["pb_strictLoopStatusTransitions"]=0|1`

### 1.3 Backtrack 的副作用缺口（Side-Effect Gaps）

- **落地**：已形成 **VFS checkpoints + SideEffectJournal + Backtrack rollback** 的自动闭环（Browser-only 版本的“可撤销副作用”）。
  - Journal：`js/agents/runtime/side-effects/side-effect-journal.js`（订阅 `vfs.write.*`，以 `vfs_checkpoint.json` 为可回滚单元）
  - 接入：`js/ppt/workflow/workflow-runtime.js`（创建 `services.sideEffects`，并在 run resume 时 hydration）
  - Checkpoint 记录 cursor：`js/agents/stages/deepsearch/deepsearch-agent-loop.js`（`metadata.sideEffectsCursor`）
  - Backtrack 时回滚：`js/agents/stages/deepsearch/runtime/backtrack-manager.js`（`rollbackToCursor()` best-effort）
  - UI 入口（对标 Codex/Claude 的 `/undo`）：`js/ppt/ui-v2/views/modern-research-view.js` + `js/ppt/ui-v2/modals/modal-manager.js`

### 1.4 存储层性能退化（RunStore 全量序列化）

- **现状**：`RunStore` 默认 IndexedDB 模式存储结构化对象（无需 `JSON.stringify`）；仅在使用 `storageAdapter(key-value)` 的降级形态时会 `JSON.stringify` 全量 state（见 `js/agents/storage/run-store.js`）。
- **缺口（P2）**：参考 Claude 的增量 diff 与 Codex 的事件化/任务化思路，引入：
  - JSON Patch（RFC 6902）或 domain patch（Todo/Timeline/Artifacts 分片）
  - 大对象 Blob/OPFS 分层存储，避免主线程 stringify 卡顿

### 1.5 资源治理（Resource Hygiene）

- **落地**：`PromptLoader` 的缓存改为 **LRU 上限**，避免静态 Map 无限增长。
  - 实现：`js/agents/prompts/prompt-loader.js`
  - 开关：`PB_PROMPT_CACHE_MAX_ENTRIES=<int>` 或 `localStorage["pb_promptCacheMaxEntries"]`

### 1.6 Ingest 不可中断/不可续传（Ingest Fragility）

- **落地**：已支持 **per-doc timeout + 断点续传（同 fingerprint）**，并把进度/产物写入 `ingest_result.json` artifact（`js/agents/ingest/ingest-stage.js`）。
  - timeout：`docTimeoutMs/perDocTimeoutMs` + `AbortSignal`（`withTimeout(..., { signal })`）
  - resume：`resumeEnabled`（默认开启），fingerprint 对齐时读取已处理 origins 并跳过
  - 持久化：默认写入 `ingest_result.json`（可用 `persist:false` 关闭）

---

## 2. 本次已落盘的代码变更（与风险项对应）

- `js/agents/runtime/core/agent-loop.js`：`loopStatus` 状态转换增加 strict 校验 + 生产默认开启 + `allowReset/force` 逃生阀
- `js/agents/prompts/prompt-loader.js`：Prompt 缓存升级为 LRU（可配置 max entries），避免长期运行内存膨胀
- `js/agents/stages/design/agent-loop.js`：localStorage 配置解析失败不再静默吞错
- `js/agents/mcp/smart-content-extractor.js`：不支持的选择器失败不再静默吞错（warn once）
- `js/agents/runtime/events/event-bus.js`：`subscribe(...,{signal})` 支持 AbortSignal 自动解挂，降低“僵尸订阅者”风险
- `js/ppt/ui-v2/views/modern-research-view.js` + `js/ppt/ui-v2/modals/modal-manager.js`：新增 `/undo`（Browser-only：基于 VFS checkpoints 的撤销入口）

---

## 3. 下一步（建议按 P0→P1 推进）

1. **RunStore 增量化（P2）**：将 state/todos/timeline 分片 + patch 化（或 JSON Patch），进一步降低大状态树写入成本。
2. **SideEffectJournal 体验增强（P1）**：补齐“分组撤销/多步撤销”（例如 `/undo 3`）与 side-effect entry 的 UI 可视化（让用户知道撤销了什么）。
3. **不可逆副作用标注（P1）**：对网络/外部系统写入做显式标注与审计（可撤销/不可撤销），避免回溯时产生因果错位的误解。
