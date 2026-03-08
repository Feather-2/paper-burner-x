# js/agents 测试补齐执行清单（2026-03-08）

> 本文档是 `docs/tests/js-agents-test-gap-audit-2026-03-08.md` 的执行版。  
> 前者回答“缺什么、弱点在哪”；本文回答“下一步逐项做什么、按什么顺序做、每项要覆盖什么 case”。

---

## 0. 当前基线

在开始补测试之前，当前 `js/agents` 基线已经稳定：

- `npx tsc -p js/agents/tsconfig.json --pretty false` → **0 diagnostics**
- `npm run test:agents` → **20058 / 0 fail**

这意味着接下来的工作重点，不是修实现，而是：

1. 补齐未覆盖单元测试
2. 更新过时测试
3. 补强关键集成链路
4. 建立最小 smoke / E2E 闭环

---

## 1. 执行原则

### 1.1 总原则

- **测试是 requirement-driven，不是 implementation-driven**
- 每个测试任务必须至少覆盖：
  - happy path
  - edge / boundary
  - error handling
  - valid state transitions
- 先补**高风险、高耦合、高回归概率**模块
- 先补**行为测试**，后补“补数字”的覆盖率测试
- 禁止为了覆盖率写低价值重复测试

### 1.2 优先级定义

- **P0**：最近发生过回归 / 高耦合执行中枢 / 一旦出错会放大到全局
- **P1**：关键链路模块，但有部分测试基础
- **P2**：边角模块、导出面、兼容层、工具层

### 1.3 批次策略

建议按 4 个工作流推进，而不是按目录暴力平推：

1. **Unit-P0 批**：先补最关键单元测试
2. **Unit-Stale 批**：更新过时测试
3. **Integration 批**：补业务链路
4. **Smoke/E2E 批**：建立关键路径闭环

---

## 2. 总体 backlog 结构

| 工作流 | 目标 | 结果物 |
|---|---|---|
| Unit-P0 | 给关键模块补首批高价值单测 | 新增/补充 `tests/unit/agents/**` |
| Unit-Stale | 更新已失效或覆盖不足的旧测试 | 修改现有 unit/integration tests |
| Integration | 把 runtime/design/deepsearch/sdk 关键业务链路补齐 | 新增 `tests/integration/agents/**` |
| Smoke/E2E | 建立最小 CI 闭环 | 新增 `tests/smoke/**` / `tests/e2e/**` |

---

## 3. Unit-P0：第一优先级单元测试清单

> 这些任务应优先执行，完成后才能显著缓解“测试倒挂”。

### 3.1 Runtime 核心

#### 3.1.1 `js/agents/runtime/core/tool-registry.js`
- **目标测试文件**：`tests/unit/agents/runtime/core/tool-registry.extended.test.js`
- **要补的 case**：
  - before/after hooks 顺序与失败策略
  - persistence 成功 / warn / fail 三种模式
  - quota reject / allow / missing manager
  - normalizeToolResult 与 audit 注入
  - tool handler 抛错、返回非法结果、大输出
  - background persist 不阻塞返回
- **优先级**：P0

#### 3.1.2 `js/agents/runtime/core/worker-rpc.js`
- **目标测试文件**：`tests/unit/agents/runtime/core/worker-rpc.extended.test.js`
- **要补的 case**：
  - invalid rpc frame 被忽略
  - timeout / abort / worker exit / worker error
  - pending calls 清理
  - recreate worker 后恢复调用
  - eventBus 事件发射完整性
- **优先级**：P0

#### 3.1.3 `js/agents/runtime/core/worker-pool.js`
- **目标测试文件**：`tests/unit/agents/runtime/core/worker-pool.extended.test.js`
- **要补的 case**：
  - idle worker 复用
  - maxWorkers 限制
  - queue timeout
  - worker 创建失败
  - warmup 行为
  - close 后拒绝新任务
- **优先级**：P0

#### 3.1.4 `js/agents/runtime/core/api/stage-api-factory.js`
- **目标测试文件**：`tests/unit/agents/runtime/core/api/stage-api-factory.test.js`
- **要补的 case**：
  - legacy 参数形态
  - object 形态
  - stageName + services 混合形态
  - 空 services / 非法 services
  - factory 生成对象是否满足最小 Stage API 契约
- **优先级**：P0

#### 3.1.5 `js/agents/runtime/core/context/unified-agent-context.js`
- **目标测试文件**：补强 `tests/unit/agents/runtime/core/context/unified-agent-context.test.js`
- **要补的 case**：
  - acquire/release 串行锁
  - release 泄漏场景
  - runIdFactory / context id 传播
  - snapshot/restore 行为一致性
- **优先级**：P0

### 3.2 Design 高风险链路

#### 3.2.1 `js/agents/stages/design/model.js`
- **目标测试文件**：补强 `tests/integration/agents/design/model-caller.test.js` + 新增单元文件 `tests/unit/agents/stages/design/model.test.js`
- **要补的 case**：
  - hard timeout
  - outer abort 与 hard timeout 竞态
  - late settle fulfilled / rejected
  - aiApiService 路径
  - modelRouter legacy/new signatures
  - flushCompression 先行
  - debugLog / logger gating
- **优先级**：P0

#### 3.2.2 `js/agents/stages/design/generators/design-system-generator.js`
- **目标测试文件**：`tests/unit/agents/stages/design/generators/design-system-generator.test.js`
- **要补的 case**：
  - valid AI output
  - invalid AI output fallback
  - retry exhausted fallback
  - parse/validate error 分类
  - design token completeness
- **优先级**：P0

#### 3.2.3 `js/agents/stages/design/shared/safe-emit.js`
- **目标测试文件**：`tests/unit/agents/stages/design/shared/safe-emit.test.js`
- **要补的 case**：
  - emit 成功
  - emit handler 抛错被吞并/上报
  - 缺失 emit 时 no-op
- **优先级**：P1

### 3.3 DeepSearch 核心

#### 3.3.1 `js/agents/stages/deepsearch/deepsearch-agent-loop.js`
- **目标测试文件**：补强 `tests/unit/agents/stages/deepsearch/deepsearch-agent-loop.test.js`
- **要补的 case**：
  - planning → execution → writing 正常路径
  - planning phase fail
  - writing phase fallback
  - traceContext span 注入
  - callModel 注入与 responseHandler 配合
- **优先级**：P0

#### 3.3.2 `js/agents/stages/deepsearch/phases/execution-phase.js`
- **目标测试文件**：`tests/unit/agents/stages/deepsearch/phases/execution-phase.test.js`
- **要补的 case**：
  - decision 解析成功/失败
  - tool execute success/error
  - cancel mid-step
  - tool call count 与 iteration state 更新
- **优先级**：P0

#### 3.3.3 `js/agents/stages/deepsearch/phases/writing-phase.js`
- **目标测试文件**：`tests/unit/agents/stages/deepsearch/phases/writing-phase.test.js`
- **要补的 case**：
  - generate report
  - skip when no writing needed
  - citations / formatting fallback
  - report completion guarantees
- **优先级**：P0

### 3.4 Plugins / Services

#### 3.4.1 `js/agents/plugins/services/vfs.js`
- **目标测试文件**：补强 `tests/unit/agents/plugins/services/vfs.test.js`
- **要补的 case**：
  - createVfs backend 差异
  - delete fallback path
  - glob fallback init path
  - write emit side-effect
- **优先级**：P0

#### 3.4.2 `js/agents/plugins/telemetry/cost-aggregator.js`
- **目标测试文件**：补强 `tests/unit/agents/plugins/telemetry/cost-aggregator.test.js`
- **要补的 case**：
  - hydrate latest snapshot
  - persist scheduling / dirty flush
  - callback error swallow
  - eventBus auto record
- **优先级**：P0

#### 3.4.3 `js/agents/plugins/telemetry/token-tracker.js`
- **目标测试文件**：补强 `tests/unit/agents/plugins/telemetry/token-tracker.test.js`
- **要补的 case**：
  - usageMissing
  - ring buffer overwrite
  - archive restore / save
  - onPersistenceError callback
- **优先级**：P0

---

## 4. Unit-Stale：需要优先更新的旧测试

> 这部分不是新建测试，而是把旧测试修到真正覆盖当前实现。

### 4.1 必须更新的旧测试目标

| 源文件 | 关联测试 | 问题 | 动作 |
|---|---|---|---|
| `js/agents/runtime/core/tool-registry.js` | `tests/unit/agents/runtime/core/tool-registry.test.js` | 新 persistence / audit 行为覆盖不够 | 扩 case |
| `js/agents/runtime/core/worker-rpc.js` | `tests/unit/agents/runtime/core/worker-rpc.test.js` | 新 frame 校验与 eventBus 行为覆盖不够 | 扩 case |
| `js/agents/runtime/tools/tool-executor.js` | `tests/integration/agents/core/sandbox/tool-executor.error-handling.test.js` | 更偏错误路径，成功/竞态路径不足 | 补单测 + 集成测 |
| `js/agents/stages/design/agent-loop.js` | `tests/unit/agents/stages/design/agent-loop.test.js` | 与当前 design phases / downgrade 行为不同步 | 更新断言 |
| `js/agents/stages/design/generators/batch-generator.js` | `tests/unit/agents/stages/design/index.test.js` | 旧测试粒度过粗 | 拆出专项测试 |
| `js/agents/stages/codesearch/code-tools.js` | `tests/unit/agents/stages/codesearch/code-tools.test.js` | 工具契约变化后覆盖不足 | 更新 |
| `js/agents/llm/model-router.js` | 相关 integration tests | overflow / health / usage 路径变化 | 补 unit + integration |

### 4.2 更新策略

- 不要把旧测试“勉强改绿”
- 应当：
  1. 标出旧测试覆盖的旧行为
  2. 确认新行为是否更合理
  3. 调整断言到当前真实契约
  4. 如果旧测试粒度过粗，拆成新的单元测试

---

## 5. Integration backlog：要补齐的业务链路

### 5.1 Runtime integration

#### I-RT-01 `tool-registry × persisted-output × error-boundary`
- **目标文件**：`tests/integration/agents/runtime/tool-registry-persisted-output.test.js`
- **链路**：tool call → large output → persist → audit → error boundary
- **必须覆盖**：
  - 正常路径
  - persist warn
  - persist fail
  - large output truncation
  - hook error + tool error 叠加

#### I-RT-02 `worker-pool × worker-rpc × worker-factory`
- **目标文件**：`tests/integration/agents/runtime/worker-stack.test.js`
- **必须覆盖**：
  - worker 创建/复用/回收
  - timeout → reject
  - exit → recover
  - queue + pool limit

#### I-RT-03 `session-gate × sdk/http/{node,browser}-server`
- **目标文件**：`tests/integration/agents/runtime/http-session-gate.test.js`
- **必须覆盖**：
  - queue mode
  - reject mode
  - stream route
  - abort request

### 5.2 Design integration

#### I-DES-01 `design/model + generators + stage loop`
- **目标文件**：`tests/integration/agents/design/model-pipeline.test.js`
- **必须覆盖**：
  - ai success
  - timeout fallback
  - invalid output fallback
  - late settle no unhandled rejection

#### I-DES-02 `batch-generator × slide-agent × visual-subagent`
- **目标文件**：`tests/integration/agents/design/subagent-pipeline.test.js`
- **必须覆盖**：
  - slide intents parsing
  - linked assets
  - svg/image degrade
  - final deckHtmlDsl parseability

### 5.3 DeepSearch integration

#### I-DS-01 `planning → execution → writing`
- **目标文件**：`tests/integration/agents/deepsearch/full-loop.test.js`
- **必须覆盖**：
  - 正常闭环
  - planning fail
  - tool fail
  - writing skip/fallback
  - report output consistency

#### I-DS-02 `subagents + task handler`
- **目标文件**：`tests/integration/agents/deepsearch/subagents-task.test.js`
- **必须覆盖**：
  - async task
  - timeout task
  - abort task
  - compacted result
  - backpressure enable

### 5.4 SDK / MCP / VFS integration

#### I-SDK-01 `sdk/convenience + real loops`
- **目标文件**：`tests/integration/agents/sdk/convenience-flow.test.js`

#### I-MCP-01 `resource manager + provider notifications`
- **目标文件**：`tests/integration/agents/mcp/resource-update-flow.test.js`

#### I-VFS-01 `vfs/index + browser/node backends`
- **目标文件**：`tests/integration/agents/vfs/backend-consistency.test.js`

---

## 6. Smoke / E2E backlog

### 6.1 Smoke backlog

#### S-01 Startup smoke
- 已有：`tests/smoke/agents-startup.smoke.test.js`
- 动作：保留，作为总入口健康检查

#### S-02 Design smoke
- **新增**：`tests/smoke/agents-design.smoke.test.js`
- **验证**：最小 contentPackage → deckHtmlDsl 可生成、可解析

#### S-03 DeepSearch smoke
- **新增**：`tests/smoke/agents-deepsearch.smoke.test.js`
- **验证**：最小 taskGoal → findings/report 至少有一个稳定输出

#### S-04 SDK smoke
- **新增**：`tests/smoke/agents-sdk.smoke.test.js`
- **验证**：`createAgent` / `AgentBuilder` 最小成功路径

#### S-05 VFS smoke
- **新增**：`tests/smoke/agents-vfs.smoke.test.js`
- **验证**：最小 backend 读写往返

### 6.2 自动化 E2E backlog

#### E-01 Agents basic flow E2E
- 已有：`tests/e2e/agents-basic-flow.test.js`
- 动作：扩展断言，不只验证启动

#### E-02 Design E2E
- **新增**：`tests/e2e/agents-design-flow.test.js`
- **验证**：从输入内容到最终设计产物

#### E-03 DeepSearch E2E
- **新增**：`tests/e2e/agents-deepsearch-flow.test.js`
- **验证**：从 query 到 report

#### E-04 HTTP API E2E
- **新增**：`tests/e2e/agents-http-api.test.js`
- **验证**：`/v1/run`、`/v1/run/stream`

### 6.3 manual 页面处理建议

`tests/e2e/manual/*.html` 不应算自动化覆盖。建议：

- 保留为人工验证资产
- 但单独建一份目录清单文档，标出哪些页面可以升级为自动化 smoke/E2E

---

## 7. 分批执行建议（真正可执行）

### 批次 A：最关键单元测试（建议先做）

1. `runtime/core/tool-registry.js`
2. `runtime/core/worker-rpc.js`
3. `runtime/core/worker-pool.js`
4. `runtime/core/api/stage-api-factory.js`
5. `stages/design/model.js`
6. `stages/deepsearch/phases/execution-phase.js`
7. `stages/deepsearch/phases/writing-phase.js`

**完成标准**：
- 每个文件新增/扩展测试，覆盖 happy/edge/error/state transition
- 对应源码不再处于“高风险但无直接单测”状态

### 批次 B：更新过时测试

1. `runtime/core/tool-registry.test.js`
2. `runtime/core/worker-rpc.test.js`
3. `stages/design/agent-loop.test.js`
4. `stages/design/index.test.js`
5. `stages/codesearch/code-tools.test.js`

**完成标准**：
- 去掉依赖旧行为的断言
- 新断言与当前实现契约一致

### 批次 C：补业务链路集成测试

1. runtime orchestration
2. design async/fallback
3. deepsearch full-loop
4. sdk/mcp/vfs integration

### 批次 D：补 smoke/E2E

1. design smoke
2. deepsearch smoke
3. sdk smoke
4. design e2e
5. deepsearch e2e
6. http api e2e

---

## 8. Definition of Done（每项任务完成标准）

每个测试任务完成时，必须满足：

- 新增测试不是“只补成功路径”
- 至少覆盖一个错误路径和一个边界路径
- 若是异步模块，至少覆盖一个 timeout / abort / race 场景
- 若是状态机模块，至少覆盖一个状态迁移
- 若是桥接模块（sdk/http/mcp/vfs/runtime），至少覆盖一个契约输入和一个非法输入

---

## 9. 建议下一步

建议直接从 **批次 A** 开始，不要再继续泛化摸排。

### 推荐起手顺序

1. `tests/unit/agents/runtime/core/tool-registry.extended.test.js`
2. `tests/unit/agents/runtime/core/worker-rpc.extended.test.js`
3. `tests/unit/agents/runtime/core/worker-pool.extended.test.js`
4. `tests/unit/agents/runtime/core/api/stage-api-factory.test.js`
5. `tests/unit/agents/stages/design/model.test.js`

这是当前最值的第一批补测工作。
