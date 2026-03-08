# js/agents 测试架构深度审计（2026-03-08）

> 本文档是在以下两份文档基础上的进一步下钻：
>
> - `docs/tests/js-agents-test-gap-audit-2026-03-08.md`
> - `docs/tests/js-agents-test-backlog-2026-03-08.md`
>
> 目标不再只是回答“哪里缺测试”，而是回答：
>
> 1. `js/agents` 的真实层级结构是什么；
> 2. 各层应该如何进入测试；
> 3. Core 的高级能力应该如何单独建模测试；
> 4. 为什么前面的 backlog 仍然不能覆盖全部内容；
> 5. 后续测试建设应该如何分层推进。

---

## 0. 当前稳定基线

当前工作树已经达到以下稳定基线：

- `npx tsc -p js/agents/tsconfig.json --pretty false` → **0 diagnostics**
- `npm run test:agents` → **20058 / 0 fail**

这给了我们一个非常重要的前提：

> 接下来的测试建设，是在“实现已经稳定”的前提下做结构优化，而不是边修实现边补测试。

---

## 1. 先回答一个核心问题：`js/agents` 不是一个模块，而是一套分层系统

如果只把它看成“很多 JS 文件”，测试视角一定会失真。  
从代码结构与 `CLAUDE.md` 可以明确看出，`js/agents` 至少分成以下几层：

### 1.1 Layer A — 微内核基础层（Core）

代表目录：

- `js/agents/core`
- `js/agents/shared`
- `js/agents/vfs`
- `js/agents/storage`

职责：

- Kernel / EventBus / StateBus / ServiceBus / MessageBus
- 插件系统与兼容层
- 沙箱隔离（WASM / Worker / iframe / system）
- CRDT / contracts / archive / node-compat / webruntime
- 通用工具、tokenizer、value-utils、logger、error-utils
- VFS / checkpoint / delta sync

### 1.2 Layer B — 运行时协调层（Runtime）

代表目录：

- `js/agents/runtime`
- `js/agents/runtime/core`
- `js/agents/runtime/hooks`
- `js/agents/runtime/tools`
- `js/agents/runtime/api`
- `js/agents/runtime/context`
- `js/agents/runtime/safety`

职责：

- AgentLoop
- Orchestrator
- Worker stack
- ToolRegistry / ToolExecutor
- HookRegistry / HookRunner
- Stage API 生成
- UnifiedAgentContext
- SessionGate / permissions / queue / scheduler

### 1.3 Layer C — 业务能力层（Stages / Plugins / Ingest / MCP / LLM / Skills）

代表目录：

- `js/agents/stages`
- `js/agents/plugins`
- `js/agents/ingest`
- `js/agents/mcp`
- `js/agents/llm`
- `js/agents/skills`

职责：

- DeepSearch / Design / CodeSearch / TextPrep
- Compression / Telemetry / Memory / Plan / Context / Coordination
- 文档摄取与多格式适配
- MCP provider / transport / resource manager
- Model router / image provider / overflow recovery
- Skills loading / rendering / sandbox adapter

### 1.4 Layer D — 对外入口与开发支撑层（SDK / CLI / Testing）

代表目录：

- `js/agents/sdk`
- `js/agents/cli`
- `js/agents/testing`
- `js/agents/index.js`
- `js/agents/stages/index.js`

职责：

- 对外简化 API
- HTTP server / convenience wrappers
- demo / test CLI
- mock suite
- aggregate export surface

---

## 2. 为什么前一份 backlog 还不够“覆盖所有内容”

前一份 backlog 的主要目标是：

- 找出最危险的单元测试缺口
- 找出关键集成链路
- 建立 smoke / E2E 最小闭环

它是对的，但它有一个有意的偏向：

> **优先级优先于完整性。**

也就是说，前一份 backlog 更偏“先打高价值目标”，而不是“逐层扫描所有内容”。

你现在要求的是更进一步：

- 不只是 P0/P1/P2
- 而是把 **整个 `js/agents` 体系逐层看透**
- 特别是 **Core 的高级能力**，不能被 Runtime/Stages 的大模块掩盖

这份文档就是补这个缺口。

---

## 3. 各层应该如何进入测试

这一部分是最关键的框架。

### 3.1 Core 层：应该以“能力矩阵”进入测试，不是按文件平推

Core 不是一堆普通 util。它有很多**高级能力**，每个能力都应该被当成独立测试域：

#### Core 高级能力 A：四总线

- EventBus
- StateBus
- ServiceBus
- MessageBus

正确测试方式：

- 单元测试：语义与边界
- 集成测试：总线之间的联动
- 回归测试：持久化 / 背压 / replay / wildcard / rpc response

#### Core 高级能力 B：Plugin 微内核

- Kernel
- PluginManager / PluginContext
- Presets
- compat layer（旧 provider → 新 plugin）

正确测试方式：

- 单元：生命周期 install/start/stop/uninstall
- 集成：多个 plugin 组合、DI 注入、冲突/顺序/失败恢复
- smoke：quickKernel / preset 最小启动

#### Core 高级能力 C：Sandbox 体系

- create-sandbox
- wasm sandbox
- iframe sandbox
- system sandbox
- seatbelt / violation store
- sandbox pool / resource lock

正确测试方式：

- 单元：backend 选择与错误分类
- 集成：tool-executor / skill-sandbox / node-env 真实联动
- 平台回归：Node / Browser / Worker 差异
- 异常：timeout / abort / deadlock / unsupported backend

#### Core 高级能力 D：node-compat / webruntime

- shims/*
- server-bridge
- sw-handler
- vfs-snapshot

正确测试方式：

- 单元：shim 契约
- 集成：bridge / handler 协同
- smoke：浏览器端虚拟 server / VFS 快照最小可用

#### Core 高级能力 E：Archive / CRDT / Contracts

- archive/*
- crdt/*
- contracts/*

正确测试方式：

- 单元：schema / merge / restore / serialization
- 集成：和 event/state/tool persistence 结合
- 异常：旧版本恢复、坏数据、链条断裂

### 3.2 Runtime 层：应该以“执行链路”进入测试

Runtime 不适合按单文件散点补测，而应该按执行链：

1. **任务入口链**
   - session gate
   - stage api
   - agent loop
2. **工具执行链**
   - tool registry
   - hook runner
   - tool executor
   - persisted output
3. **worker 链**
   - worker factory
   - worker rpc
   - worker pool
4. **上下文链**
   - unified-agent-context
   - stage-api-factory
   - orchestrator
5. **安全链**
   - tool permissions
   - scheduler
   - quota / guard / classification

### 3.3 Stages 层：应该以“阶段状态机 + 业务输出”进入测试

Stages 不是普通业务模块，它们是复杂状态机。测试应该聚焦：

- 输入是否被正确解释
- 状态是否按预期迁移
- 工具/模型调用是否正确组织
- 降级行为是否符合约定
- 输出是否满足后续消费者需要

其中：

- **Design**：异步调用、生成器、subagent、降级最复杂
- **DeepSearch**：planning/execution/writing 三段式状态机最复杂
- **CodeSearch**：执行步与索引/检索交织
- **TextPrep**：链路短，但要重边界和格式稳定性

### 3.4 Plugins 层：应该以“副作用与长期状态”进入测试

Plugins 最容易出现“测试不够像真实运行”的问题，因为它们涉及：

- telemetry
- memory
- context
- plan
- services
- side-effects
- coordination

这层不是看函数，而是看：

- 事件驱动是否正确
- 持久化是否正确
- 恢复后状态是否一致
- 跨 run / session 行为是否稳定

### 3.5 SDK / CLI 层：应该以“入口契约”进入测试

这里的重点不是内部逻辑复杂度，而是：

- 导出是否稳定
- 参数形态是否兼容
- 便利 API 是否与真实实现一致
- CLI 包装是否真的能调用到底层能力

也就是说，这层非常适合用：

- 单元：导出面 / 参数路由
- 集成：与真实 loop / server / VFS 联动
- smoke：最小 end-user 使用路径

---

## 4. Core 高级能力逐项分析（这是本轮最重要的补充）

### 4.1 EventBus / MessageBus / StateBus / ServiceBus

#### 现状

- 这些能力整体测试并不差，但不是“全面无死角”
- 映射里仍有 stale：
  - `js/agents/core/event-bus.js`
  - `js/agents/core/event-bus-utils.js`
  - `js/agents/core/di/defaults.js`

#### 弱点

- 背压 legacy 参数兼容
- replay / archive 恢复
- wildcard / pattern 匹配边界
- rpc response 校验链路
- service proxy 的超时/重试/cache 叠加行为

#### 应补方向

- **单元**：边界和参数矩阵
- **集成**：EventBus ↔ MessageBus ↔ ToolRegistry ↔ Telemetry
- **异常测试**：持久化失败 / malformed frame / backpressure drop

### 4.2 Plugin 系统与 Presets

#### 现状

- 基本启动能力有测
- 但 `secure-plugin-loader.js`、`kernel-compat.js` 仍未覆盖

#### 弱点

- 旧 provider 兼容层
- 插件私有字段生命周期
- 多 plugin 组合顺序
- preset 对默认能力的影响

#### 应补方向

- `kernel-compat`
- `secure-plugin-loader`
- `presets + quickKernel/minimalKernel`
- 插件冲突 / 卸载 / 失败恢复

### 4.3 Sandbox 体系

#### 现状

- 基础很多，但仍有未覆盖：
  - `core/sandbox/pool.js`
  - `core/sandbox/system/index.js`
  - 若干 system / backend 组合路径

#### 弱点

- backend 选择与 fallback
- pool acquire/release / priority / timeout
- system sandbox 违规记录 / profile 生成
- create-sandbox 的 auto priority
- 真实平台差异（browser/node)

#### 应补方向

- sandbox backend 选择矩阵
- pool 等待队列与优先级
- seatbelt / violation store
- wasm unavailable / iframe unavailable / main-thread fallback

### 4.4 node-compat / webruntime

#### 现状

- shim 数量很大，单体测试很多
- 但 bridge / handler / aggregate path 更薄

#### 弱点

- service worker / server bridge 交互
- snapshot / virtual request body / BodyInit 转换
- CLI / browser 环境差异

#### 应补方向

- bridge + sw-handler 联动测试
- snapshot 与 server/body 协议 round-trip
- node-compat 聚合入口兼容测试

### 4.5 Archive / CRDT / Contracts

#### 现状

- contracts/crdt 基础不错
- archive 层还有未覆盖文件

#### 弱点

- restore chain
- storage adapter edge cases
- old snapshot compatibility
- diff/base 引用断裂时如何处理

#### 应补方向

- archive-core / storage-adapter 单测
- archive 与 event/state/tool persistence 集成
- corrupted snapshot / missing base

---

## 5. 分层覆盖是否能覆盖“所有功能”？现在还不行

### 5.1 为什么不行

因为当前测试体系有三种偏差：

1. **按目录有很多测试，但按能力不完整**
2. **按函数有很多测试，但按状态机/链路不完整**
3. **按内部行为测得多，但按入口/用户路径测得少**

### 5.2 典型例子

- `Design model` 的问题：
  - 单测看起来不少
  - 但直到全量集成测试才暴露 `late settle` → `Unhandled Rejection`
- `DeepSearch subagents` 的问题：
  - 类型修补如果改了 legacy 行为
  - 只有少数行为测试能立刻抓出来
- `EventBus backpressure` 的问题：
  - 参数契约改变后，只有行为级测试能发现老语义被破坏

所以“覆盖所有内容”的真正含义不是 100% line coverage，而是：

> **每个层级、每类高级能力、每条关键链路，都至少有一层测试在保护它。**

---

## 6. 这次重新下钻后的新增判断

在前一轮 backlog 基础上，再补充以下重点：

### 6.1 前一轮低估的模块

#### A. `js/agents/core/*`
之前更多关注 runtime/stages，这次确认 core 的高级能力必须单列 backlog：

- `core/archive/archive-core.js`
- `core/archive/storage-adapter.js`
- `core/kernel-compat.js`
- `core/secure-plugin-loader.js`
- `core/sandbox/pool.js`
- `core/sandbox/system/index.js`
- `core/webruntime/server-bridge.js`
- `core/webruntime/sw-handler.js`
- `core/webruntime/vfs-snapshot.js`

#### B. `js/agents/sdk/*`
之前只把 sdk 视为入口层，现在看还需要分层：

- `sdk/AgentBuilder.js`
- `sdk/agent-factory.js`
- `sdk/config-loader.js`
- `sdk/http/*`
- `sdk/convenience.js`
- `sdk/examples/*`（至少 smoke）

#### C. `js/agents/mcp/*`
MCP 现在覆盖明显偏薄，不应该只放在 P1：

- `mcp/resource-manager.js`
- `mcp/http-mcp-transport.js`
- `mcp/sse-mcp-transport.js`
- `mcp/stdio-mcp-*`
- `mcp/http-proxy.js`

### 6.2 需要单独立项的高级能力测试域

建议后续 backlog 里，把下面这些当成**一级测试主题**，不是零散文件：

1. **Core Buses**
2. **Plugin Kernel**
3. **Sandbox Matrix**
4. **Worker Stack**
5. **Design Async Pipeline**
6. **DeepSearch Phase Machine**
7. **MCP Resource/Transport Layer**
8. **SDK Entry Surface**
9. **VFS Backend Consistency**
10. **Archive / Restore / Recovery**

---

## 7. 对现有文档与 backlog 的修正建议

### 7.1 现有 backlog 仍然有效

`docs/tests/js-agents-test-backlog-2026-03-08.md` 仍然可作为执行清单起点。

### 7.2 但应该再补一层“架构视角索引”

建议把后续实际补测工作组织成下面这种结构：

- **Backlog A：Core 高级能力补测**
- **Backlog B：Runtime 执行链补测**
- **Backlog C：Stage 状态机补测**
- **Backlog D：Plugin 副作用与恢复补测**
- **Backlog E：SDK/MCP/VFS 入口与桥接补测**
- **Backlog F：Smoke/E2E 闭环补测**

也就是说，后面不应只按文件推进，而要按**能力域 + 文件**双维度推进。

---

## 8. 这轮审计后的最终判断

### 8.1 当前真正的弱点

不是“某几个文件没测”。  
真正的弱点是：

- **高级能力没有被当成完整测试域对待**
- **有些层级（特别是 core / sdk / mcp / smoke/e2e）在总量上被低估**
- **Stages 与 Runtime 已经比较强，但 Core 与入口层的结构化保护仍不够**

### 8.2 如果要把 `js/agents` 真正测透，需要满足这三件事

1. **单元测试补口**：把未覆盖和 stale 清掉
2. **能力域测试建模**：Core buses / sandbox / worker / archive / sdk / mcp 单独成体系
3. **关键路径闭环**：startup / design / deepsearch / sdk/http / vfs 的 smoke/e2e 最小闭环成立

### 8.3 所以“全部分析透”的可执行结论是

后续测试建设必须同时看三张图：

- **目录图**：模块 / 子模块分层
- **能力图**：高级功能域
- **回归图**：最容易出行为回归的链路

只看其中一张图，都会继续产生测试倒挂。

---

## 9. 建议下一步

如果要继续落地，而不是停留在分析阶段，我建议按下面顺序继续写文档/执行：

1. 在现有 backlog 基础上，再拆一个 **Core 高级能力测试 backlog**
2. 再拆一个 **MCP / SDK / VFS 入口层 backlog**
3. 然后才开始逐批补代码测试

这样，才算真正把 `js/agents` 的测试规划看透。

---

## 附录 A：子模块级覆盖概览表

| 子模块 | total | covered | untested | stale | coverage |
|---|---:|---:|---:|---:|---:|
| `js/agents/cli/demo.js` | 1 | 0 | 1 | 0 | 0.0% |
| `js/agents/cli/model-client.js` | 1 | 0 | 1 | 0 | 0.0% |
| `js/agents/cli/test-deepsearch.js` | 1 | 0 | 1 | 0 | 0.0% |
| `js/agents/cli/test-memory.js` | 1 | 0 | 1 | 0 | 0.0% |
| `js/agents/core/archive` | 6 | 4 | 2 | 0 | 66.7% |
| `js/agents/core/compat.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/core/contracts` | 4 | 4 | 0 | 0 | 100.0% |
| `js/agents/core/crdt` | 6 | 6 | 0 | 0 | 100.0% |
| `js/agents/core/di` | 3 | 2 | 0 | 1 | 66.7% |
| `js/agents/core/event-bus-subscriptions.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/core/event-bus-utils.js` | 1 | 0 | 0 | 1 | 0.0% |
| `js/agents/core/event-bus.js` | 1 | 0 | 0 | 1 | 0.0% |
| `js/agents/core/event-record.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/core/kernel-compat.js` | 1 | 0 | 1 | 0 | 0.0% |
| `js/agents/core/kernel.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/core/lamport-clock.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/core/message-bus.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/core/presets.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/core/sandbox` | 13 | 10 | 3 | 0 | 76.9% |
| `js/agents/core/secure-plugin-loader.js` | 1 | 0 | 1 | 0 | 0.0% |
| `js/agents/core/service-bus.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/core/state-bus.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/eval/graders` | 4 | 3 | 1 | 0 | 75.0% |
| `js/agents/eval/harness.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/eval/index.js` | 1 | 0 | 1 | 0 | 0.0% |
| `js/agents/eval/metrics.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/eval/types.js` | 1 | 0 | 1 | 0 | 0.0% |
| `js/agents/index.js` | 1 | 0 | 1 | 0 | 0.0% |
| `js/agents/ingest/adapters` | 13 | 9 | 1 | 3 | 69.2% |
| `js/agents/ingest/asset-manager.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/ingest/asset-understanding.js` | 1 | 0 | 1 | 0 | 0.0% |
| `js/agents/ingest/chunked-loader.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/ingest/constants.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/ingest/extract-assets.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/ingest/index.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/ingest/ingest-stage.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/ingest/streaming` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/ingest/tools` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/llm/constants.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/llm/image-provider.js` | 1 | 0 | 0 | 1 | 0.0% |
| `js/agents/llm/index.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/llm/internal` | 5 | 2 | 3 | 0 | 40.0% |
| `js/agents/llm/mock-provider.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/llm/model-events.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/llm/model-router.js` | 1 | 0 | 0 | 1 | 0.0% |
| `js/agents/llm/overflow-recovery.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/llm/ppt-model-bridge.js` | 1 | 0 | 0 | 1 | 0.0% |
| `js/agents/llm/provider.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/llm/rate-limit.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/llm/whisper-provider.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/mcp/constants.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/mcp/content-extractor.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/mcp/content-sanitizer.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/mcp/http-mcp-transport.js` | 1 | 0 | 1 | 0 | 0.0% |
| `js/agents/mcp/http-proxy.js` | 1 | 0 | 1 | 0 | 0.0% |
| `js/agents/mcp/index.js` | 1 | 0 | 1 | 0 | 0.0% |
| `js/agents/mcp/local-mcp-provider.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/mcp/mcp-client.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/mcp/mcp-nexus-provider.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/mcp/mcp-shortcuts.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/mcp/mcp-transport.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/mcp/nexus-skill-provider.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/mcp/resource-manager.js` | 1 | 0 | 1 | 0 | 0.0% |
| `js/agents/mcp/smart-content-extractor.js` | 1 | 0 | 1 | 0 | 0.0% |
| `js/agents/mcp/sse-mcp-transport.js` | 1 | 0 | 1 | 0 | 0.0% |
| `js/agents/mcp/sse.js` | 1 | 0 | 1 | 0 | 0.0% |
| `js/agents/mcp/stdio-mcp-provider.js` | 1 | 0 | 1 | 0 | 0.0% |
| `js/agents/mcp/stdio-mcp-transport.js` | 1 | 0 | 1 | 0 | 0.0% |
| `js/agents/mcp/transport-factory.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/mcp/url-whitelist.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/plugins/analysis` | 3 | 3 | 0 | 0 | 100.0% |
| `js/agents/plugins/checkpoints` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/plugins/compression` | 10 | 6 | 4 | 0 | 60.0% |
| `js/agents/plugins/coordination` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/plugins/debug` | 2 | 2 | 0 | 0 | 100.0% |
| `js/agents/plugins/deps` | 2 | 2 | 0 | 0 | 100.0% |
| `js/agents/plugins/memory` | 30 | 25 | 3 | 2 | 83.3% |
| `js/agents/plugins/plan` | 2 | 1 | 0 | 1 | 50.0% |
| `js/agents/plugins/policy` | 4 | 0 | 4 | 0 | 0.0% |
| `js/agents/plugins/resilience` | 2 | 2 | 0 | 0 | 100.0% |
| `js/agents/plugins/routing` | 1 | 0 | 1 | 0 | 0.0% |
| `js/agents/plugins/services` | 4 | 3 | 1 | 0 | 75.0% |
| `js/agents/plugins/side-effects` | 1 | 0 | 1 | 0 | 0.0% |
| `js/agents/plugins/stages` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/plugins/telemetry` | 5 | 5 | 0 | 0 | 100.0% |
| `js/agents/plugins/transports` | 5 | 2 | 3 | 0 | 40.0% |
| `js/agents/prompts/formatters` | 8 | 8 | 0 | 0 | 100.0% |
| `js/agents/prompts/prompt-loader.js` | 1 | 0 | 1 | 0 | 0.0% |
| `js/agents/prompts/prompt-registry.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/prompts/prompt-template.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/retrieval/bm25.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/retrieval/embeddings` | 3 | 1 | 1 | 1 | 33.3% |
| `js/agents/retrieval/grep.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/retrieval/hybrid-retrieval.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/retrieval/mmr.js` | 1 | 0 | 1 | 0 | 0.0% |
| `js/agents/retrieval/readaround.js` | 1 | 0 | 1 | 0 | 0.0% |
| `js/agents/retrieval/retrieval-router.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/retrieval/scope.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/retrieval/toc-builder.js` | 1 | 0 | 1 | 0 | 0.0% |
| `js/agents/retrieval/tool-chain.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/retrieval/vector-search.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/runtime/core` | 48 | 31 | 13 | 4 | 64.6% |
| `js/agents/runtime/events` | 2 | 1 | 1 | 0 | 50.0% |
| `js/agents/runtime/hooks` | 4 | 3 | 0 | 1 | 75.0% |
| `js/agents/runtime/routing` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/runtime/safety` | 3 | 3 | 0 | 0 | 100.0% |
| `js/agents/runtime/tools` | 14 | 8 | 4 | 2 | 57.1% |
| `js/agents/sdk/agent-config.js` | 1 | 0 | 1 | 0 | 0.0% |
| `js/agents/sdk/agent-factory.js` | 1 | 0 | 1 | 0 | 0.0% |
| `js/agents/sdk/AgentBuilder.js` | 1 | 0 | 1 | 0 | 0.0% |
| `js/agents/sdk/AlertMonitor.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/sdk/BacktrackManager.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/sdk/config-loader.js` | 1 | 0 | 1 | 0 | 0.0% |
| `js/agents/sdk/DefaultAgentLoop.js` | 1 | 0 | 1 | 0 | 0.0% |
| `js/agents/sdk/DiscoveryManager.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/sdk/examples` | 5 | 0 | 5 | 0 | 0.0% |
| `js/agents/sdk/index.js` | 1 | 0 | 1 | 0 | 0.0% |
| `js/agents/sdk/injection-scanner.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/sdk/SoftBacktrackManager.js` | 1 | 0 | 1 | 0 | 0.0% |
| `js/agents/sdk/SubagentRegistry.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/shared/base` | 1 | 0 | 1 | 0 | 0.0% |
| `js/agents/shared/index.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/shared/parser` | 1 | 0 | 1 | 0 | 0.0% |
| `js/agents/shared/platform.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/shared/tokenizers` | 1 | 0 | 1 | 0 | 0.0% |
| `js/agents/shared/utils` | 25 | 20 | 5 | 0 | 80.0% |
| `js/agents/skills/index.js` | 1 | 0 | 1 | 0 | 0.0% |
| `js/agents/skills/loader.browser.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/skills/loader.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/skills/loader.node.js` | 1 | 0 | 1 | 0 | 0.0% |
| `js/agents/skills/manager.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/skills/model.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/skills/render.js` | 1 | 0 | 0 | 1 | 0.0% |
| `js/agents/skills/sandbox-adapter.js` | 1 | 0 | 0 | 1 | 0.0% |
| `js/agents/skills/user-store.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/stages/codesearch` | 8 | 4 | 3 | 1 | 50.0% |
| `js/agents/stages/deepsearch` | 40 | 28 | 12 | 0 | 70.0% |
| `js/agents/stages/design` | 57 | 40 | 11 | 6 | 70.2% |
| `js/agents/stages/textprep` | 7 | 7 | 0 | 0 | 100.0% |
| `js/agents/storage/artifact-manager.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/storage/run-exporter.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/storage/run-store-cache.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/storage/run-store-crud.js` | 1 | 0 | 1 | 0 | 0.0% |
| `js/agents/storage/run-store-queries.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/storage/run-store-utils.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/storage/run-store.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/testing/mock-suite.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/vfs/checkpoints.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/vfs/delta-sync.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/vfs/diff.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/vfs/diff.worker.js` | 1 | 0 | 1 | 0 | 0.0% |
| `js/agents/vfs/file-lock.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/vfs/fs-adapter.js` | 1 | 0 | 1 | 0 | 0.0% |
| `js/agents/vfs/glob.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/vfs/glob.worker.js` | 1 | 0 | 1 | 0 | 0.0% |
| `js/agents/vfs/index.browser.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/vfs/index.js` | 1 | 0 | 1 | 0 | 0.0% |
| `js/agents/vfs/index.node.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/vfs/operations.js` | 1 | 0 | 1 | 0 | 0.0% |
| `js/agents/vfs/path.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/vfs/storage-adapter.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/vfs/vfs-scan-async.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/vfs/vfs-scan.worker.js` | 1 | 0 | 1 | 0 | 0.0% |
| `js/agents/vfs/vfs.memory.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/vfs/vfs.node.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/vfs/vfs.opfs.js` | 1 | 1 | 0 | 0 | 100.0% |
| `js/agents/vfs/vfs.storage.js` | 1 | 1 | 0 | 0 | 100.0% |
