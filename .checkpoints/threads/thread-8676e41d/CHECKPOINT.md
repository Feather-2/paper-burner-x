# Checkpoint: 浏览器 Node 运行时 Sandbox 实现 + 测试修复

**Thread ID**: thread-8676e41d
**Saved**: 2026-02-11T16:00:00Z
**Branch**: feat-pptgen1
**Last Commit**: 99e1190c - feat(sandbox): add three-level factory, unified facade, stack-trace polyfill (52 tests)
**Session History**: 9 sessions in thread

## Current Task

浏览器 Node 运行时 PRD 实施。P0 和 P1 全部完成，剩余 P2/P3 待推进。同时持续修复测试基础设施。

## Completed Work

### Session #009 新增

- Checkpoint 保存（本次）

### Session #008 新增

- 深度分析 `ref/almostnode-main/` 全部源码
- 产出 22 个借鉴点 PRD: `docs/prd-browser-node-runtime.md`（634 行）
- [P0] VFS 快照同步 — `vfs-snapshot.js` + `vfs-events.js`（28 tests）
- [P0] 三级安全工厂 — `create-sandbox.js` + `sandbox-interface.js`（52 tests）
- [P0] 统一门面 — `create-node-env.js`
- [P1] Error.captureStackTrace polyfill — `polyfills/stack-trace.js`
- [P1] CORS Proxy — `cors-proxy.js`
- [P1] REPL 上下文 — `repl.js`
- [P1] 跨域 iframe 沙箱 — `iframe-sandbox.js`
- [P1] Comlink Worker 通信 — `worker-comlink.js`

### Session #007 测试修复

- LamportClock 循环依赖修复（lazy init + 直接 import）— `322914ef`
- Logger mock 基础设施（14 files）— `1d405dd5`
- model-client, mcp/index, agents/index 测试修复（268 tests）— `96d31c30`
- vfs, transports, skill-executor, cicada, deck-editor 修复（185 tests）— `f0766468`
- 19 批量测试修复（memory, design, deepsearch, runtime）— `9bd26692`
- 测试通过率：96.9% → 改善中

### 历史完成工作

- WebSocket CRDT Transport（24 tests）
- AgentRegistry / TraceContextPropagator / AgentCoordinator
- TaskBoardOrchestratorBridge（23 tests）
- CostAggregator 导出 + cost-formatter（13 tests）
- EventBus/MessageBus trace 传播
- agent-message trace 字段（41 tests）
- SharedTaskBoard 原子 claim（31 tests）
- StageRpcBridge 跨 Stage RPC（12 tests）
- 800 行硬标准 + SDK 分层

## Uncommitted Changes

| File | Type | Description |
|------|------|-------------|
| 33 test files | Modified | 测试 mock 修复（待提交或继续修复） |
| 4 sandbox files | Untracked | cors-proxy, iframe-sandbox, repl, worker-comlink（需确认是否已 committed） |

## Key Decisions

| Decision | Rationale | Session |
|----------|----------|--------|
| `-helpers.js` 命名约定 | 统一模式，易发现，1:1 配对 | #001 |
| SDK 不导出 Stage 类 | 核心框架零业务依赖 | #001 |
| Hapi 凭据自动发现 | ~/.hapi/settings.json | #003 |
| WebSocket Transport 双模式 send | 兼容 SyncManager 两种调用风格 | #006 |
| Trace 传播用可选字段非侵入式注入 | 完全向后兼容 | #007 |
| 浏览器 Node 运行时采用 AlmostNode 模式 | 完整 require + 40+ shim + 三级隔离 | #008 |
| 所有沙箱代码放 js/agents/core/sandbox/ | 统一目录，与现有沙箱代码共存 | #008 |
| JS+JSDoc 无 TypeScript | 项目约定，最大化跨端兼容 | #008 |

## Test State

测试修复进展：531 failed → ~64 failed（88% 降低）。
剩余 33 个未提交的测试修复文件。

## Key Files

| File | Role |
|------|------|
| `docs/prd-browser-node-runtime.md` | 浏览器 Node 运行时 PRD（22 功能点） |
| `js/agents/core/sandbox/create-sandbox.js` | 三级安全工厂 |
| `js/agents/core/sandbox/sandbox-interface.js` | 沙箱接口契约 |
| `js/agents/core/sandbox/create-node-env.js` | 统一门面 |
| `js/agents/core/sandbox/vfs-snapshot.js` | VFS 快照同步 |
| `js/agents/core/sandbox/vfs-events.js` | VFS 事件桥 |
| `js/agents/core/sandbox/cors-proxy.js` | CORS 代理 |
| `js/agents/core/sandbox/iframe-sandbox.js` | 跨域 iframe 沙箱 |
| `js/agents/core/sandbox/repl.js` | REPL 上下文 |
| `js/agents/core/sandbox/worker-comlink.js` | Comlink Worker |
| `js/agents/core/sandbox/polyfills/stack-trace.js` | Error.captureStackTrace |

## Next Steps (Priority Order)

1. [P2] 实施 #7 完整 fs shim — `shims/fs.js`
2. [P2] 实施 #4 CommonJS require — `require.js` + `module-resolver.js`
3. [P2] 实施 #5 ESM→CJS 转换 — `transform-esm.js`
4. [P2] 实施 #9 child_process + just-bash — `shims/child-process.js`
5. [P2] 实施 #8 SW HTTP 桥 — `server-bridge.js` + `sw-handler.js`
6. [P2] 实施 #17 DevServer 抽象 — `dev-server.js`
7. [P2] 实施 #19 VFSAdapter — `vfs-adapter.js`
8. [P2] 实施 #22 Zlib + Brotli — `shims/zlib.js`
9. [P3] 实施 #10 npm 包管理器 — `npm/` 目录
10. [P3] 实施 #6 40+ Node.js shim 模块 — `shims/` 目录
11. [P3] 实施 #18 HMR — `hmr.js`
12. [P3] 实施 #16 Sandbox 部署工具 — `sandbox-deploy.js`
13. [P3] 实施 #13 TextDecoder polyfill — `polyfills/text-decoder.js`
14. [持续] 剩余测试修复（~33 files uncommitted）

## Architecture Health

| 指标 | 数值 |
|------|------|
| 文件数 | ~600 |
| 跨层违规 | 0 |
| >800 行文件 | 0 |
| P0 完成 | 3/3 |
| P1 完成 | 5/5 |
| P2 完成 | 0/8 |
| P3 完成 | 0/5 |

## Session History

| # | Name | Archived | Context Used |
|---|------|----------|-------------|
| 001 | 架构审计+SDK分层 | - | ~90% |
| 002 | 多Agent协作推进 | - | ~85% |
| 003 | Checkpoint文档更新+Save | - | ~40% |
| 004 | 多Agent协作-Phase1 | - | ~80% |
| 005 | 多Agent协作-Phase1续 | - | ~60% |
| 006 | 多Agent协作-Phase2推进 | - | ~70% |
| 007 | Phase2续-Trace传播+Bridge+Formatter+测试修复 | - | ~85% |
| 008 | AlmostNode分析+浏览器Node运行时PRD+Sandbox P0/P1 | - | ~90% |
| 009 | Checkpoint保存+继续推进 | - | ~10% |
