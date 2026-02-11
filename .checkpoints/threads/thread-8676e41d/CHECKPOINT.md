# Checkpoint: 浏览器 Node 运行时 — 差距修复 + 集成

**Thread ID**: thread-8676e41d
**Saved**: 2026-02-12T00:30:00Z
**Branch**: feat-pptgen1
**Last Commit**: e2a2e484 - feat(sandbox): sandbox-tool for ToolExecutor, PackageManager wiring (1084 tests)
**Session History**: 11 sessions in thread

## Current Task

完成 Checkpoint #10 的全部 Next Steps（P1/P2/P3 + 集成），从 resolve.exports 到 ToolExecutor 集成。

## Completed Work

### Session #011 新增

- **P1 resolve.exports** — `ae4422c9`
  - module-resolver.js: resolveExportConditions + resolvePackageExports + parsePackageSpecifier
  - 条件优先级: browser > module > import > require > default
  - 支持 string/array/object/path-mapped/conditional/wildcard pattern
  - 支持 scoped packages (@scope/pkg/sub)
  - resolveDirectory 先查 exports['.']，再 fallback browser/main
  - resolveNodeModules 支持 subpath exports (convex/server → exports['./server'])

- **P1 Module wrapping** — `ae4422c9`
  - require.js: wrapper 从 5→11 参数
  - +process, console, Buffer, global, globalThis, __dynamicImport
  - globals config 允许自定义注入
  - __dynamicImport 绑定 child require (对接 transform-esm)

- **P2 SW keepalive + reconnect** — `ae4422c9`
  - server-bridge.js: controllerchange 监听 + _attachControllerChange()
  - maxReconnects 限制防止无限重连
  - stop() 清理 controllerchange listener

- **P2 http.request()/http.get()** — `ae4422c9`
  - http.js: ClientRequest 类 (fetch-based)，支持 write/end/abort/setTimeout
  - request() 支持 string URL / URL 对象 / options 对象
  - get() = request + end
  - IncomingMessage.fromFetchResponse() 从 fetch Response 构造

- **P2 Streaming response** — `ae4422c9`
  - ClientRequest._doFetch() 使用 ReadableStream reader pump
  - SSE / streaming AI response 可直接消费

- **P3 crypto sign/verify** — `2e87fda9`
  - createSign/createVerify via Web Crypto API
  - wrapKey() helper 包装 CryptoKey

- **P3 browser field object remapping** — `2e87fda9`
  - module-resolver.js resolveDirectory 增加 browser object 处理
  - {"./node.js": "./browser.js"} 形式的映射

- **P3 zlib brotli** — `2e87fda9`
  - brotliCompress/brotliDecompress callback stubs
  - brotliCompressSync/brotliDecompressSync/createBrotliCompress/createBrotliDecompress 带清晰错误

- **集成 #9 sandbox → Agent Runtime** — `e2a2e484`
  - sandbox-tool.js: createSandboxTool() 工厂，创建 execute_code 工具
  - VFS + require + builtins + optional npm install

- **集成 #10 npm → Skill 系统** — `e2a2e484`
  - sandbox-adapter.js: wire PackageManager option through enhanceWithSandbox
  - createSandboxedSkillsManager 支持 packageManager 选项

### 历史完成工作

- PRD 22 个功能点全部实现（P0/P1/P2/P3）
- 测试修复 531 failed → 11 failed（98% 降低）
- WebSocket CRDT Transport, AgentRegistry, TraceContextPropagator
- TaskBoardOrchestratorBridge, CostAggregator, SharedTaskBoard
- SDK 分层, 800 行硬标准
- Shim 审计对标（15 模块，11 MATCH + 3 PARTIAL + 1 LOW）

## Uncommitted Changes

无源码未提交变更。仅 .checkpoints/ 文件有变更。

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
| Shim 对标 almostnode-main 而非 1:1 复制 | 我们用 JS+JSDoc，他们用 TS；取其功能不取其实现 | #010 |
| exports 条件优先级 browser > module > import > require > default | 浏览器优先环境 | #011 |
| 11 参数 wrapper 包含 __dynamicImport | transform-esm 将 import() 转为 __dynamicImport() | #011 |
| ClientRequest 基于 fetch 实现 | 浏览器唯一可用的 HTTP 客户端 | #011 |
| sandbox-tool 采用懒初始化 | 避免未使用时创建 NodeEnv 开销 | #011 |

## Test State

Sandbox 测试：54 files, 1084 tests, 0 failures。

## Key Files

| File | Role |
|------|------|
| `docs/prd-browser-node-runtime.md` | 浏览器 Node 运行时 PRD（22 功能点） |
| `js/agents/core/sandbox/create-sandbox.js` | 三级安全工厂 |
| `js/agents/core/sandbox/create-node-env.js` | 统一门面 |
| `js/agents/core/sandbox/vfs-snapshot.js` | VFS 快照同步 |
| `js/agents/core/sandbox/require.js` | CommonJS require (11参数wrapper) |
| `js/agents/core/sandbox/module-resolver.js` | 模块解析 (exports + browser remap) |
| `js/agents/core/sandbox/transform-esm.js` | ESM→CJS 转换 |
| `js/agents/core/sandbox/server-bridge.js` | SW HTTP 桥 (keepalive + reconnect) |
| `js/agents/core/sandbox/sandbox-tool.js` | ToolExecutor 集成工具 |
| `js/agents/core/sandbox/hmr.js` | HMR 热更新 |
| `js/agents/core/sandbox/npm/` | npm 包管理器 |
| `js/agents/core/sandbox/shims/` | 15+ Node.js shim 模块 |
| `js/agents/core/sandbox/shims/http.js` | HTTP (391行, +ClientRequest) |
| `js/agents/core/sandbox/shims/crypto.js` | Crypto (+sign/verify) |
| `js/agents/core/sandbox/shims/zlib.js` | Zlib (+brotli stubs) |
| `js/agents/skills/sandbox-adapter.js` | Skills ↔ Sandbox 桥接 (+PackageManager) |

## Next Steps (Priority Order)

1. [集成] 端到端测试：createSandboxTool → ToolExecutor.register → execute
2. [集成] createNodeEnv 配合真实 VFS + npm install 集成测试
3. [优化] module-resolver 缓存 package.json 读取结果
4. [优化] ClientRequest 支持 HTTPS (复用 http shim)
5. [文档] 更新 CLAUDE.md 反映 sandbox 完整架构

## Architecture Health

| 指标 | 数值 |
|------|------|
| 文件数 | ~645 |
| 跨层违规 | 0 |
| >800 行文件 | 0 |
| PRD 完成 | 22/22 |
| Shim MATCH | 12/15 |
| Shim PARTIAL | 2/15 |
| Shim LOW | 1/15 |
| Sandbox 测试 | 1084 (54 files) |

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
| 009 | PRD全量实施+P2/P3完成+测试修复 | - | ~80% |
| 010 | Shim审计对标+深度差距分析 | - | ~75% |
| 011 | 差距修复P1-P3+ToolExecutor集成 | - | ~85% |
