# js/agents 待修复问题清单

> **Date**: 2026-02-15
> **Update**: 2026-02-16
> **Note**: This documents all issues found during the architecture comparison audit. Cross-reference with existing `js/agents/AUDIT.md` (58 open items).

## P0 — 结构性问题（全部已修复）

- 1-3 号问题已全部修复，见下方“已修复的问题（供参考）”表格。
- 主修复提交：`d25aa0a8`（Phase 1-4）。

## P1 — 局部问题（全部已修复）

- 4-10 号问题已完成修复与收尾，见下方“已修复的问题（供参考）”表格。
- 重命名与收尾提交：`dd8530fe`。
- 9 号“空 catch 块”为持续治理项，当前状态保持 `PARTIALLY FIXED`。

## 已修复的问题（供参考）

The following issues were found during initial audit but have been FIXED in recent commits:

| Issue | Commit | Status |
|-------|--------|--------|
| 1. Mixin 架构 (agent-loop.js) | d25aa0a8 | FIXED |
| 2. Resolver 探测 (tool-registry.js) | d25aa0a8 | FIXED |
| 3. 双拦截系统 (MiddlewareChain + HookRegistry) | d25aa0a8 | FIXED |
| 4. Design Stage Blackboard (design-blackboard.js) | d25aa0a8 | FIXED |
| 5. Archive 持久化频率 (event-bus.js) | d25aa0a8 | FIXED |
| 6. Kernel 封装破坏 (kernel.js) | d25aa0a8 | FIXED |
| 7. WorkerPool 全局单例 (tool-executor.js) | d25aa0a8 | FIXED |
| 8. DegradationMatrix 竞态 (orchestrator-core.js) | d25aa0a8 | FIXED |
| 9. 空 catch 块 (43 files) | db24b54c, 4a0967c7, d25aa0a8 | PARTIALLY FIXED |
| 10. renderPromptTemplate 重复 | dd8530fe | FIXED |
| EventBus waitFor memory leak | d3ab7d17 | FIXED |
| EventBus backpressure timer leak | a04de971 | FIXED |
| MessageBus inflight request leak | 20cb113f | FIXED |
| MessageManager async summary Promise leak | 92ceef68 | FIXED |
| MessageManager compression race condition | 92ceef68 | FIXED |
| StateBus subscription leak detection | d3ab7d17 | FIXED |
| RateLimit pump deadlock | 9d19d363 | FIXED |
| WorkerPool resource leak (process-level) | 896aac7a | FIXED |
| FileLock AbortSignal leak | aea4d9ad | FIXED |
| TabCoordinator listener leak | b6b96cae | FIXED |
| MCP Transport event listener leak | 30bba16d | FIXED |
| Policy check order (was after hooks) | tool-executor.js | FIXED |
| Orchestrator stage emit override | orchestrator-core.js | FIXED |
| Plugin state scope naming conflict | plugin.js | FIXED |
| Large file split (skill-executor, orchestrator) | bdc40eae | FIXED |
| Architecture comparison enhancements (4 items) | a721d030 | FIXED |
