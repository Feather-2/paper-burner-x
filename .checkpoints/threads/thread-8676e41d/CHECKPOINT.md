# Checkpoint: js/agents 架构审计 + SDK 分层

**Thread ID**: thread-8676e41d
**Saved**: 2026-02-10T00:15:00Z
**Branch**: feat-pptgen1
**Last Commit**: d548b9de - docs: add multi-agent collaboration roadmap to architecture design doc
**Session History**: 1 session in thread

## Current Task

所有架构审计和 SDK 分层任务已完成。最后完成了多 Agent 协作路线图文档。

## Completed Work

### 800 行硬标准（16 个文件拆分，19 个 helper 模块）
- `37d3eaa8` mcp-nexus-provider 1068→743
- `71e4a792` batch-generator 1061→518
- `1e91be29` skill-executor 1039→791
- `905a1d6b` code-tools 1003→720
- `126c1f0a` stage-api-factory 985→439
- `ade454f8` prompt-loader 971→603
- `42b574e1` smart-content-extractor 946→565
- `a0e77f29` mock-suite 901→764
- `87be7525` tool-executor 896→746
- `b4ffee52` planning-phase 885→376
- `a0917aac` message-manager 854→768
- `c2db3931` event-bus 838→661
- `8f02c9aa` react-refiner-tools 819→529
- `da644520` orchestrator 808→768
- `430c9e8c` write-report/handler 807→723
- `c906cd96` side-effect-journal 804→768

### 跨层违规修复
- `c743d2ac` RetryStrategy 从 runtime/core → shared
- `398a50e6` PerformanceRouter 从 runtime/routing → llm
- `9347d8cb` EventBus import 改为 runtime barrel

### 架构微调
- `c69edc0b` textprep/index.js 拆分 (552→1 行 barrel)
- `1f69d95a` 清理 5 个 re-export shim
- `3ea6d3d9` deepsearch/tools/index.js 拆分 (270→48 行 barrel)

### SDK 分层
- `3cc177ae` SDK L0 convenience API (runDeepSearch/runDesign)
- `8fb9e99e` SDK 移除 Stage re-export，对齐框架独立原则
- `d548b9de` 多 Agent 协作路线图文档

### Bug 修复
- `361c0903` PdfAdapter 全局缓存 → 实例级注入
- `98756f36` storage-crypto.js JSON.parse reviver 误传 slice() + response-limits.js 缺失 reviver

### 架构审计结论（不需修改）
- C2 ToolPermissions vs PolicyEngine — 互补分层，已集成
- C3 DeltaSync vs SyncManager — 不同层级，不需合并
- E4 Ingest DI — 不需全量 DI
- C7 pluginRegistry manifest — 已有 registerPluginsFromManifest()

## Uncommitted Changes

| File | Type | Description |
|------|------|-------------|
| `.checkpoints/` | New (untracked) | Checkpoint thread 数据 |

## Key Decisions

| Decision | Rationale | Session |
|----------|----------|---------|
| `-helpers.js` 命名约定 | 统一模式，易发现，1:1 配对 | #001 |
| SDK 不导出 Stage 类 | 核心框架零业务依赖，对齐 Vercel AI SDK/LangChain 最佳实践 | #001 |
| L0 convenience 不从 SDK barrel 导出 | 使用者按需 import 具体路径，避免隐式捆绑 | #001 |
| RetryStrategy 下移 shared | 通用重试模式不属于 runtime 层 | #001 |
| PerformanceRouter 下移 llm | LLM 路由逻辑属于 LLM 基础设施层 | #001 |

## Test State

未运行完整测试套件（750 个测试文件存在）。
node --check 验证通过所有改动文件。

## Key Files

| File | Role |
|------|------|
| `js/agents/sdk/index.js` | SDK 核心入口（已精简为框架 API only） |
| `js/agents/sdk/convenience.js` | L0 便捷函数（runDeepSearch/runDesign） |
| `docs/sdk-architecture-design.md` | SDK 架构设计文档 + 多 Agent 路线图 |
| `js/agents/shared/retry-strategy.js` | RetryStrategy（从 runtime 下移） |
| `js/agents/llm/performance-router.js` | PerformanceRouter（从 runtime 下移） |

## Next Steps (Priority Order)

1. [P1] 多 Agent 协作阶段 1：Agent 通信协议定义 (contracts/agent-message.js)
2. [P1] 现有 Stage 使用 MessageBus RPC 集成验证
3. [P2] 多 Agent 协作阶段 2：WebSocket Transport for CRDT
4. [P2] Agent 身份注册与发现机制
5. [P3] Orchestrator 暴露 getStatus() API
6. [P3] 跨 Agent TraceContext propagation
7. [P4] Coordinator 模式 + Leader 选举
8. [P4] 全局一致性检查点

## Architecture Health

| 指标 | 数值 |
|------|------|
| 文件数 | 567 |
| 总行数 | 151,010 |
| 平均行数 | 267 |
| 最大文件 | 791 行 |
| 跨层违规 | 0 |
| 空 catch | 0 |
| >800 行文件 | 0 |
| Re-export shim | 0 |
| 测试文件 | 750 |
| DI 注册 | 40 |

## Session History

| # | Name | Archived | Context Used |
|---|------|----------|-------------|
| 001 | 架构审计+SDK分层 | - | ~90% |
