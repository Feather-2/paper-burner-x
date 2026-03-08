# js/agents 测试总控主文档（2026-03-08）

> 本文档是 `js/agents` 测试工作的 **master inventory + master backlog + master roadmap**。  
> 它整合并收束以下 6 份文档：
>
> 1. `docs/tests/js-agents-test-gap-audit-2026-03-08.md`
> 2. `docs/tests/js-agents-test-backlog-2026-03-08.md`
> 3. `docs/tests/js-agents-test-architecture-audit-2026-03-08.md`
> 4. `docs/tests/js-agents-test-gap-supplement-2026-03-08.md`
> 5. `docs/tests/js-agents-test-module-structure-check-2026-03-08.md`
> 6. `docs/tests/js-agents-test-exhaustive-check-2026-03-08.md`
>
> 从这份文档开始，后续 `js/agents` 的补测工作应以本文件为唯一总控入口。

---

## 0. 当前稳定基线

当前 `js/agents` 的实现和测试基线如下：

- `npx tsc -p js/agents/tsconfig.json --pretty false` → **0 diagnostics**
- `npm run test:agents` → **20058 / 0 fail**

这个基线非常关键，因为后续补测可以默认建立在“实现已稳定”之上。

---

## 1. 本文档要解决的问题

本文件统一回答以下问题：

1. `js/agents` 的整体结构与层级是什么？
2. 哪些模块/子模块/能力域仍然是测试弱点？
3. 现有单元测试、集成测试、smoke/E2E 的主要缺口是什么？
4. 哪些文件根本没进入测试映射口径？
5. 哪些模块拆分方式导致测试容易遗漏？
6. 后续补测试应该按什么顺序推进？

---

## 2. `js/agents` 的四层结构（统一视角）

### Layer A — 微内核基础层

代表目录：

- `js/agents/core`
- `js/agents/shared`
- `js/agents/vfs`
- `js/agents/storage`

关键能力：

- Kernel
- EventBus / StateBus / ServiceBus / MessageBus
- Plugin / Preset / Compat
- Archive / Contracts / CRDT
- Sandbox / NodeCompat / WebRuntime
- Shared utils / tokenizers / retry strategy
- VFS / checkpoint / delta sync

### Layer B — 运行时协调层

代表目录：

- `js/agents/runtime`
- `js/agents/runtime/core`
- `js/agents/runtime/hooks`
- `js/agents/runtime/tools`
- `js/agents/runtime/api`
- `js/agents/runtime/context`
- `js/agents/runtime/safety`

关键能力：

- AgentLoop
- Orchestrator
- Worker stack
- ToolRegistry / ToolExecutor
- Hook system
- Stage API factory
- UnifiedAgentContext
- Scheduler / SessionGate / Permissions

### Layer C — 业务能力层

代表目录：

- `js/agents/stages`
- `js/agents/plugins`
- `js/agents/ingest`
- `js/agents/mcp`
- `js/agents/llm`
- `js/agents/skills`

关键能力：

- DeepSearch / Design / CodeSearch / TextPrep
- Telemetry / Memory / Context / Compression / Services / Coordination
- 文档摄取、多格式适配
- MCP provider / transport / resource management
- Model routing / image provider / overflow recovery
- Skills loading / render / sandbox adapter

### Layer D — 对外入口与开发支撑层

代表目录：

- `js/agents/sdk`
- `js/agents/cli`
- `js/agents/testing`
- `js/agents/index.js`
- `js/agents/stages/index.js`

关键能力：

- SDK facade
- HTTP API server
- convenience wrappers
- builder/factory
- mock suite
- demo/test CLI
- aggregate export surface

---

## 3. 当前最重要的总体结论

### 3.1 不是“测试少”，而是“测试结构不健康”

当前我们已经有：

- `tests/unit/agents`：**694** 个测试文件
- `tests/integration/agents`：**110** 个测试文件
- `tests/smoke`：**1** 个 smoke 文件
- `tests/e2e`：**1** 个自动化 E2E 文件

这说明问题不是“完全没有测试”，而是：

- 单元测试很多，但价值密度不均
- 集成测试有规模，但链路分布不均
- smoke/E2E 明显偏弱
- 很多高杠杆模块并没有被系统性保护

### 3.2 `.test-map.json` 只能说明一部分问题

之前审计已经确认：

- 可映射源码文件：**543**
- 已覆盖：**370**
- 未覆盖：**124**
- 过时：**29**
- 映射覆盖率：**68.1%**

但穷举复查又确认：

- `js/agents` 实际源码文件：**692**
- `.test-map.json` 识别到的源码文件：**482**
- **未进入映射口径的文件：215**

这意味着：

> 不能再只盯 `.test-map.json` 的“未覆盖 / stale”，还必须同时关注 **映射盲区**。

### 3.3 现在真正的风险，不只是某个文件没测，而是“整个测试组织方式会漏”

这一点在第 5、6 轮复查里已经被确认：

- 聚合入口太多
- helper / handler / bridge 文件太多
- 某些重要目录没有局部锚点
- 超大文件很多，但测试没有按子域拆

---

## 4. 当前测试弱点总表（最终版）

### 4.1 模块级弱点（基于 gap audit + supplement + exhaustive）

| 模块 | 风险级别 | 主要问题 |
|---|---|---|
| `core` | S0 / P0 | 映射盲区最大根区；高级能力多；compat/sandbox/node-compat/webruntime 易漏 |
| `runtime` | S0 / P0 | 核心执行链切片多；worker/tool/context/scheduler 回归风险高 |
| `stages` | S0 / P0 | 深层 handler / phases / internal 子模块多；主流程有测不等于内部测透 |
| `plugins` | P0 | 长状态、副作用、恢复与持久化类能力多 |
| `sdk` | S0 / P0 | 入口层偏薄，`sdk/http` 尤其被低估 |
| `mcp` | S0 / P1 | provider/transport/resource/extractor 平面混放，容易假覆盖 |
| `vfs` | S0 / P1 | backend 与 protocol 混合，测试必须拆两层 |
| `llm` | P1 | model-router / image-provider / internal fallback 仍存在 stale / 盲区 |
| `skills` | P1 | manager/registry 有基础，但 skill 资产层不在本文范围内 |
| `shared` | P1 | utils 数量多，属于高耦合基础件 |

### 4.2 当前最值得警惕的 12 个测试域

1. Core Buses
2. Plugin Kernel / Presets / Compat
3. Sandbox Matrix
4. NodeCompat Compatibility Matrix
5. WebRuntime Bridge Layer
6. Archive / Restore / Recovery
7. Runtime Worker Stack
8. Runtime Tool Execution Stack
9. Design Async Pipeline
10. DeepSearch Phase Machine + Tool Handlers
11. MCP Provider / Transport / Resource Layer
12. SDK / HTTP / VFS Entry Surface

---

## 5. 映射盲区重点清单（最终版）

### 5.1 最大盲区目录

按风险综合排序：

1. `js/agents/core/node-compat`
2. `js/agents/runtime/core`
3. `js/agents/stages/deepsearch`
4. `js/agents/core/sandbox`
5. `js/agents/core/webruntime`
6. `js/agents/stages/design`
7. `js/agents/mcp`
8. `js/agents/sdk/http`
9. `js/agents/vfs`
10. `js/agents/plugins/memory`

### 5.2 这些盲区意味着什么

- 它们不是简单的“无测试”
- 而是：**没有被现有测试映射体系可靠纳入**
- 所以后续 backlog 里必须有专门的“盲区清扫批次”

---

## 6. 模块拆分与测试入口问题（最终版）

### 6.1 应明确立规则的文件类型

后续测试建设必须对这些文件类型建立专门规则：

- `index.js` → export surface test
- `helpers.js` → focused unit / regression test
- `handler.js` → handler contract test
- `bridge.js` → protocol / integration test
- `adapter.js` → input/output compatibility test
- `constants.js` → 通常不单独大测，但需由使用侧和 export surface 覆盖
- >800 行超大文件 → 必须拆成子域测试

### 6.2 当前最典型的结构性低估区

- `sdk/http`
- `mcp`
- `vfs`
- `core/node-compat`
- `runtime/core`
- `stages/deepsearch/tools/*`

这些区域如果不单独提升为测试主题，会继续反复遗漏。

---

## 7. 单元测试总 backlog（统一版）

> 这一部分吸收了 backlog 文档 + supplement + exhaustive 结果。

### 7.1 Unit-P0（必须先做）

#### Runtime 核心
- `runtime/core/tool-registry.js`
- `runtime/core/worker-rpc.js`
- `runtime/core/worker-pool.js`
- `runtime/core/api/stage-api-factory.js`
- `runtime/core/context/unified-agent-context.js`
- `runtime/core/python-adapter.js`

#### Design 核心
- `stages/design/model.js`
- `stages/design/generators/design-system-generator.js`
- `stages/design/shared/safe-emit.js`

#### DeepSearch 核心
- `stages/deepsearch/deepsearch-agent-loop.js`
- `stages/deepsearch/phases/execution-phase.js`
- `stages/deepsearch/phases/writing-phase.js`
- `stages/deepsearch/subagents.js`
- `stages/deepsearch/tools/task/handler.js`

#### Plugins / Services
- `plugins/services/vfs.js`
- `plugins/telemetry/cost-aggregator.js`
- `plugins/telemetry/token-tracker.js`

### 7.2 Unit-S0（映射盲区优先批）

#### Core / Compat / Sandbox
- `core/node-compat/create-node-env.js`
- `core/node-compat/require.js`
- `core/node-compat/sandbox-tool.js`
- `core/node-compat/npm/{resolver,registry,tarball}.js`
- `core/sandbox/network-policy-utils.js`
- `core/sandbox/resource-lock.js`
- `core/sandbox/proxy-bridge.js`
- `core/webruntime/{server-bridge,sw-handler,vfs-snapshot,worker-comlink,worker-comlink-node}.js`
- `core/contracts/{agent-message,trace-propagator}.js`

#### Runtime 深层切片
- `runtime/core/agent-loop-phases.js`
- `runtime/core/agent-loop-steps.js`
- `runtime/core/agent-loop-user-actions.js`
- `runtime/core/orchestrator-core.js`
- `runtime/core/scheduling-strategies.js`
- `runtime/core/stage-rpc-bridge.js`
- `runtime/core/errors/{error-taxonomy,error-fingerprint,error-aggregator}.js`

#### DeepSearch handlers
- `stages/deepsearch/tools/advise-task/handler.js`
- `stages/deepsearch/tools/ask-user/handler.js`
- `stages/deepsearch/tools/cross-verify/handler.js`
- `stages/deepsearch/tools/evaluate-gaps/handler.js`
- `stages/deepsearch/tools/get-task-result/handler.js`
- `stages/deepsearch/tools/manage-todos/handler.js`
- `stages/deepsearch/tools/read-doc/handler.js`
- `stages/deepsearch/tools/record-finding/handler.js`
- `stages/deepsearch/tools/refine-planning/handler.js`
- `stages/deepsearch/tools/search-docs/handler.js`

#### SDK / MCP / VFS 入口
- `sdk/http/*`
- `sdk/examples/*`
- `mcp/{resource-manager,http-mcp-transport,sse-mcp-transport,stdio-mcp-transport,http-proxy}.js`
- `vfs/index.js`

### 7.3 Unit-Stale（旧测试更新）

优先更新：

- `runtime/core/tool-registry.test.js`
- `runtime/core/worker-rpc.test.js`
- `runtime/tools/tool-executor*`
- `stages/design/agent-loop.test.js`
- `stages/design/index.test.js`
- `stages/codesearch/code-tools.test.js`
- `core/event-bus*.test.js`
- `llm/model-router` 相关测试

---

## 8. 集成测试总 backlog（统一版）

### 8.1 Runtime 集成链路

- `tool-registry × persisted-output × error-boundary`
- `worker-pool × worker-rpc × worker-factory`
- `session-gate × sdk/http/{node,browser}-server`
- `unified-agent-context × stage-api-factory × orchestrator`

### 8.2 Design 集成链路

- `design/model + generators + stage loop`
- `batch-generator × slide-agent × visual-subagent`
- `design-system-generator` 动态/回退矩阵
- `design/index.js` export surface + runtime availability

### 8.3 DeepSearch 集成链路

- planning → execution → writing 全链路
- subagents + task handler
- report generation + citations/formatting fallback
- telemetry / trace propagation in deepsearch

### 8.4 SDK / MCP / VFS 集成链路

- `sdk/convenience + real loops`
- `mcp provider + resource updates`
- `vfs backend consistency`
- `sdk/http request-handler + browser/node server`

---

## 9. Smoke / E2E 总 backlog（统一版）

### 9.1 Smoke

已有：
- `tests/smoke/agents-startup.smoke.test.js`

应新增：
- `tests/smoke/agents-design.smoke.test.js`
- `tests/smoke/agents-deepsearch.smoke.test.js`
- `tests/smoke/agents-sdk.smoke.test.js`
- `tests/smoke/agents-vfs.smoke.test.js`
- `tests/smoke/agents-mcp.smoke.test.js`

### 9.2 E2E

已有：
- `tests/e2e/agents-basic-flow.test.js`

应新增：
- `tests/e2e/agents-design-flow.test.js`
- `tests/e2e/agents-deepsearch-flow.test.js`
- `tests/e2e/agents-http-api.test.js`
- `tests/e2e/agents-skill-loading.test.js`
- `tests/e2e/agents-worker-sandbox.test.js`

### 9.3 manual 页面

`tests/e2e/manual/*.html` 不应再被视为自动化能力的一部分，应单独管理为人工验证资产。

---

## 10. Definition of Done（统一版）

每个测试任务完成时必须满足：

1. 至少覆盖：happy / edge / error / valid state transition
2. 异步模块至少覆盖一个 timeout/abort/race
3. 桥接/协议模块至少覆盖一个 malformed input
4. index/helper/handler/bridge/adapter 文件必须进入明确测试规则
5. 超大文件必须按子域拆 case
6. 新测试不能只补覆盖率数字，必须补行为保护

---

## 11. 执行顺序（最终版）

### Phase 1 — 先补最危险的单元测试

1. `runtime/core/tool-registry.js`
2. `runtime/core/worker-rpc.js`
3. `runtime/core/worker-pool.js`
4. `runtime/core/api/stage-api-factory.js`
5. `stages/design/model.js`
6. `stages/deepsearch/phases/execution-phase.js`
7. `stages/deepsearch/phases/writing-phase.js`

### Phase 2 — 清扫映射盲区

优先顺序：

1. `core/node-compat`
2. `runtime/core`
3. `stages/deepsearch/tools/*`
4. `core/sandbox`
5. `core/webruntime`
6. `sdk/http`
7. `mcp`

### Phase 3 — 更新 stale 测试

重点：

- `runtime/core/tool-registry.test.js`
- `runtime/core/worker-rpc.test.js`
- `runtime/tools/tool-executor*`
- `stages/design/agent-loop.test.js`
- `stages/design/index.test.js`
- `stages/codesearch/code-tools.test.js`

### Phase 4 — 补关键集成链路

- runtime orchestration
- design async/fallback
- deepsearch full-loop
- sdk/mcp/vfs integration

### Phase 5 — 建立 smoke/E2E 闭环

- design smoke
- deepsearch smoke
- sdk smoke
- design e2e
- deepsearch e2e
- http api e2e

---

## 12. 现在是否还建议继续做第七轮纯分析？

不建议。

原因不是“绝对没有遗漏”，而是：

- 这 6 轮已经覆盖了：
  - 缺口
  - backlog
  - 架构分层
  - 映射盲区
  - 模块拆分问题
  - 穷举式复查
- 再做第七轮纯分析，边际收益会明显低于直接进入执行

因此，这份 master 文档之后，建议正式结束分析阶段，进入执行阶段。

---

## 13. 后续使用方式

从现在开始，后续测试补齐建议统一按下面顺序引用文档：

1. **总控入口**：本文件
2. **细节审计**：gap / architecture / supplement / structure / exhaustive
3. **执行清单**：backlog

也就是说：

> 本文件是总导航；其他文档是展开层。

