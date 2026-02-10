# Checkpoint: js/agents 架构审计 + SDK 分层 + 多Agent协作

**Thread ID**: thread-8676e41d
**Saved**: 2026-02-10T22:40:00Z
**Branch**: feat-pptgen1
**Last Commit**: 14e985ee - feat(telemetry): add CostAggregator for cross-agent token usage summary
**Session History**: 5 sessions in thread

## Current Task

多 Agent 协作阶段 1 全部完成，阶段 2 (P2) 核心项完成。P1 三项 + P2 两项共 5 个 commit 已提交。

## Completed Work

### Session #005: 多Agent协作 Phase 1 收尾 + Phase 2 核心

#### P1 #1: orchestrator.js + events.js 提交 + 测试 (6d721336)
- `orchestrator.js` — `getStatus()` API: state/runId/stages/inFlight/childAgentCount/aborted
- `events.js` — AgentLifecycleEvents 新增 IDLE/BUSY/STOPPED/DEGRADED
- `registerStage` 规范化：actor 验证 (isValidActorType)、timeoutMs 归一化、options 对象保留
- `runStagesParallel` 移除 AggregateError throw，results Map 已包含错误信息
- 修复空白字符串 stage name 拒绝
- 70 个测试全部通过

#### P1 #3: AgentLifecycleEvents 广播集成 (0ca5be22)
- `orchestrator.js:343` — start() 发出 `agent:busy`
- `orchestrator.js:360` — stop() 发出 `agent:stopped`
- `orchestrator.js:374` — end() 发出 `agent:stopped`
- `orchestrator.js:726` — 降级时发出 `agent:degraded`
- 新增 lifecycle broadcast 测试

#### P1 #2: SharedTaskBoard (9cf3d91f)
- `core/contracts/shared-task-board.js` — 跨 Agent 共享任务列表
- 原子 claim 语义防止双重认领
- 优先级排序 pending 列表
- Snapshot/restore 持久化
- EventBus 集成（可选）
- 31 个单元测试全部通过

#### P2 #4: StageRpcBridge (e82dede6)
- `runtime/core/stage-rpc-bridge.js` — 跨 Stage MessageBus RPC 桥接
- registerHandler/request 模式
- Scoped client factory
- 12 个单元测试全部通过

#### P2 #5: CostAggregator (14e985ee)
- `plugins/telemetry/cost-aggregator.js` — 跨 Agent token 使用汇总
- Per-agent 和全局 token 累积
- Model-level breakdown
- EventBus 自动记录 llm.complete
- Snapshot/restore 持久化
- 15 个单元测试全部通过

### 历史完成工作 (Session #001-#004)

- Session #001: 800 行硬标准拆分 (16 文件)、跨层违规修复、架构微调
- Session #002: SDK 分层、Stage re-export 移除
- Session #003: Checkpoint 文档、Hapi 自动发现
- Session #004: agent-message.js 通信协议 (41 测试)、Claude Agent Teams 对比分析、Orchestrator getStatus() 初版

## Uncommitted Changes

无未提交改动。所有 P1/P2 工作已全部提交。

## Key Decisions

| Decision | Rationale | Session |
|----------|----------|--------|
| `-helpers.js` 命名约定 | 统一模式，易发现，1:1 配对 | #001 |
| SDK 不导出 Stage 类 | 核心框架零业务依赖 | #001 |
| RetryStrategy 下移 shared | 通用重试模式不属于 runtime 层 | #001 |
| PerformanceRouter 下移 llm | LLM 路由逻辑属于 LLM 基础设施层 | #001 |
| Hapi 凭据自动发现 | 从 ~/.hapi/settings.json 读取 | #003 |
| agent-message 4 种消息类型 | task-request/result + status-update + knowledge-share 覆盖多Agent协作核心场景 | #004 |
| domain:action taskType 格式 | 与 EventBus 事件名格式一致，便于 MessageBus 路由 | #004 |
| runStagesParallel 不抛 AggregateError | results Map 已包含 success/failure 信息，抛异常导致 runStagesGraph 丢失部分结果 | #005 |
| registerStage actor 验证 | isValidActorType 验证 + rawActor 保留原始值用于 getStatus 显示 | #005 |
| SharedTaskBoard 原子 claim | 单线程 JS 天然原子，claim 检查 status===pending 后立即改为 running | #005 |
| StageRpcBridge 不侵入 Stage | 通过 stageApi 注入，Stage 不需要改动即可获得 RPC 能力 | #005 |
| CostAggregator 与 TokenTracker 互补 | Tracker 记录明细，Aggregator 跨 Agent 汇总，各司其职 | #005 |

## Test State

- orchestrator.test.js: 30 tests passed
- events.test.js: 41 tests passed
- shared-task-board.test.js: 31 tests passed
- stage-rpc-bridge.test.js: 12 tests passed
- cost-aggregator.test.js: 15 tests passed
- agent-message.test.js: 41 tests passed
- 本 session 新增测试: 129 tests (跨 5 个文件)
- disposable.test.js 4 个失败为已有问题（logger mock 格式）

## Key Files

| File | Role |
|------|------|
| `js/agents/core/contracts/agent-message.js` | 多Agent通信协议 — 4 种消息 + 验证器 + 工厂 |
| `js/agents/core/contracts/shared-task-board.js` | 共享任务列表 — claim 语义 + 快照持久化 |
| `js/agents/core/contracts/index.js` | Contracts barrel |
| `js/agents/runtime/core/orchestrator.js` | Orchestrator — getStatus() + lifecycle 广播 |
| `js/agents/runtime/core/stage-rpc-bridge.js` | 跨 Stage MessageBus RPC 桥接 |
| `js/agents/runtime/events/events.js` | AgentLifecycleEvents (IDLE/BUSY/STOPPED/DEGRADED) |
| `js/agents/plugins/telemetry/cost-aggregator.js` | 跨 Agent token 使用汇总 |
| `docs/sdk-architecture-design.md` | 架构文档 (8.5/8.6 Claude 对比分析) |

## Next Steps (Priority Order)

1. [P2] 多 Agent 协作阶段 2：WebSocket Transport for CRDT
2. [P3] Agent 身份注册与发现机制
3. [P3] 跨 Agent TraceContext propagation
4. [P4] Coordinator 模式 + Leader 选举
5. [P4] SharedTaskBoard 与 Orchestrator 集成（自动 claim + 完成通知）
6. [P4] CostAggregator UI Dashboard 组件

## Architecture Health

| 指标 | 数值 |
|------|------|
| 文件数 | ~573 |
| 最大文件 | 798 行 |
| 跨层违规 | 0 |
| >800 行文件 | 0 |
| Re-export shim | 0 |
| 测试文件 | ~755 |
| 新增 contracts | 2 (agent-message + shared-task-board) |
| 新增 runtime | 1 (stage-rpc-bridge) |
| 新增 plugins | 1 (cost-aggregator) |
| 新增测试 | 5 files (129 tests) |

## Session History

| # | Name | Archived | Context Used |
|---|------|----------|-------------|
| 001 | 架构审计+SDK分层 | - | ~90% |
| 002 | 多Agent协作推进 | - | ~85% |
| 003 | Checkpoint文档更新+Save | - | ~40% |
| 004 | 多Agent协作-Phase1 | - | ~70% |
| 005 | Phase1收尾+Phase2核心 | - | ~75% |
