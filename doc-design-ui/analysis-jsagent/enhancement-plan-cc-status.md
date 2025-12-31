# JS Agent 增强设计建议（enhancement-plan-cc.md）落地核对

> 目标：对照 `doc-design-ui/analysis-jsagent/enhancement-plan-cc.md`，核对“已落地 / 部分落地 / 未落地 / Browser-only 不适用”，并给出本仓库的真实落点。
>
> 备注：本仓库的运行形态以 Browser-Only（UI v2 + workflow-runtime + `js/agents`）为主，因此对 Claude Code 的 CLI/Git/OS 沙箱能力会以 **VFS checkpoints + Policy/Approval + Worker isolation** 做近似替代。

---

## 1) Structured Insights（结构化语义洞察）

- ✅ **Tree-sitter WASM（符号提取/索引）**：已落地（并提供 regex fallback）。
  - WASM loader：`js/agents/shared/parser/tree-sitter-wasm.js`
  - 符号索引器：`js/agents/stages/codesearch/indexing/symbol-indexer.js`
  - 工具入口：`js/agents/stages/codesearch/code-tools.js`
- ⚠️ **结构化 Git 分析（GitAnalysis）**：Browser-only 形态下未直接接入 Git（无 `.git`/无本地进程权限假设）。
  - 现有替代：VFS checkpoints/diff/restore（“弱 Git”）— `js/agents/vfs/checkpoints.js` / `js/agents/vfs/diff.js` + UI 预览/Restore（`js/ppt/ui-v2/modals/modal-manager.js`）

## 2) Persistence & Planning（连续性与计划持久化）

- ✅ **Plan 持久化（PlanPersistenceManager 目标）**：已以 RunStore artifacts 形态落地（Browser-first）。
  - Plan schema & 状态机：`js/agents/runtime/plan/plan-store.js`
  - Plan 事件/落盘：`js/ppt/workflow/workflow-runtime.js`（`plan.created/plan.updated` + `plan.json` artifacts）
  - UI 管理：`js/ppt/ui-v2/modals/modal-manager.js`（Plans Manager：list/restore/resume）
- ✅ **断点续传 / Checkpoint**：
  - DeepSearch checkpoints/backtrack：`js/agents/stages/deepsearch/runtime/checkpoint.js` / `js/agents/stages/deepsearch/runtime/backtrack-manager.js`
  - Ingest 断点续传（同 fingerprint）：`js/agents/ingest/ingest-stage.js`（`ingest_result.json`）

## 3) Context Efficiency（上下文效率）

- ✅ **Cicada 压缩（含 anchors）**：已落地。
  - `js/agents/runtime/compression/cicada-compressor.js`
- ✅ **巨型输出存根（Stubbing / Persisted Output）**：已落地（超阈值写入 artifacts，prompt 仅保留 preview + artifactId）。
  - `js/agents/runtime/persisted-output.js` + `js/agents/stages/deepsearch/tools/get-artifact/handler.js`
- ✅ **Title-only 极简摘要（>80% 阈值）**：已落地（高填充率时对旧消息做 5–10 word title 摘要，显著降低 sessionSummary 体积）。
  - `js/agents/runtime/core/agent-loop.js`（`titleOnlySummaryThreshold/titleOnlySummaryMaxWords/titleOnlySummaryMaxChars`）
  - `js/agents/runtime/compression/cicada-compressor.js`（`titleOnly` + `titleMaxWords/titleMaxChars` 支持）

## 4) Lifecycle & Config（工程化配置与生命周期钩子）

- ✅ **状态机强约束（strict transitions）**：已落地（生产默认 strict，可降级 warn-only）。
  - `js/agents/runtime/core/agent-loop.js`（`PB_STRICT_LOOP_STATUS_TRANSITIONS` / `localStorage["pb_strictLoopStatusTransitions"]`）
- ⚠️ **生命周期 hooks（before/after/on_error 等）**：部分落地（中间件链 + 工具 hooks）。
  - `js/agents/runtime/middleware/middleware-chain.js`
  - `js/agents/runtime/tools/tool-executor.js`（before/after hooks）
- ❌ **七层配置优先级 + Zod 强校验**：未落地（当前以 normalize/局部校验为主）。

## 5) Security & Safety（安全与事务性保障）

- ✅ **可撤销副作用（VFS）**：已落地为 Browser-only 版本的“Ghost Snapshot/Checkpoint”近似。
  - VFS checkpoints：`js/agents/vfs/checkpoints.js`（artifact：`vfs_checkpoint.json`）
  - Side-effect journal + rollback：`js/agents/runtime/side-effects/side-effect-journal.js`
  - UI `/undo`：`js/ppt/ui-v2/views/modern-research-view.js`
- ✅ **执行隔离（Worker）**：已落地（Browser WebWorker + Node worker_threads 双实现）。
  - `js/agents/runtime/tools/tool-executor.js` / `js/agents/runtime/tools/tool-executor-webworker.js`
- `n-a` **OS 级沙箱（Docker/Bubblewrap）**：Browser-only 形态不可等价实现；以 Policy/Approval + Worker isolation 替代。

---

## 6) 结论（是否“都搞完了？”）

- enhancement-plan-cc 的关键“Browser-only 可落地项”（Plan/持久化、Cicada、Persisted Output、Tree-sitter、可撤销 VFS 副作用）已基本完成。
- Claude Code 的 CLI/Git/OS 沙箱/配置系统（Zod + 多层覆盖）目前仍是缺口或不适用项。
