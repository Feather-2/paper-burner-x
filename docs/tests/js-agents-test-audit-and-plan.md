# js/agents 测试审计与修复计划

- **日期**: 2026-03-07
- **范围**: `js/agents/**`, `tests/unit/agents/**`, `tests/integration/agents/**`, `tests/e2e/**`
- **目标**: 先建立可信测试/类型基线，再从 `core` 开始逐步消灭 `tsc` 与测试失败，最后补齐自动化测试层级并固化方案。
- **假设**: 现阶段“覆盖情况”以 **可自动执行** 的 `.test.js` 为准，`tests/e2e/manual/*.html` 仅算手工验证资产，不计入自动化覆盖率。

## 1. 本次基线命令

```bash
npx tsc -p js/agents/tsconfig.json --pretty false
npx vitest run tests/unit/agents tests/integration/agents js/agents --reporter=json --outputFile=tmp/agents-vitest-baseline.json
npx vitest run tests/unit/agents/core tests/integration/agents/core js/agents/core --reporter=json --outputFile=tmp/agents-core-vitest-baseline.json
```

## 2. 当前结论（先看这个）

### 2.1 自动化测试分布失衡

当前 `js/agents` 的自动化测试是典型的 **“单测很重，系统验证偏弱”**：

| 类别 | 数量 | 备注 |
|---|---:|---|
| `tests/unit/agents/**/*.test.js` | 693 | 主体测试层 |
| `tests/integration/agents/**/*.test.js` | 110 | 有一定规模，但仍偏少 |
| `js/agents/**/__tests__/**/*.test.js` | 12 | colocated 风格尚未成体系 |
| 自动化 `tests/e2e/**/*.test.js` | 0 | 缺失 |
| `tests/e2e/manual/*.html` | 47 | 仅手工验证 |
| agents 相关 smoke | 1 | `tests/integration/agents/runtime/di-defaults-smoke.test.js` |

如果把 colocated 测试并入“单测型测试”，当前 agents 自动化测试结构大致是：

- **单元/近单元**: 705（约 **86.5%**）
- **集成**: 110（约 **13.5%**）
- **自动化 e2e**: 0
- **独立 smoke**: 近似为 0

这不是“没测试”，而是**缺少跨模块启动链路验证**，对微内核/插件/阶段编排系统来说，回归拦截能力不够。

### 2.2 全量 agents 测试基线

来自 `tmp/agents-vitest-baseline.json`：

- 总测试数：**20,033**
- 通过：**19,996**
- 失败：**37**
- 失败文件：**21**

失败热点：

1. `tests/integration/agents/platform-tools.test.js`
2. `tests/integration/agents/skills.test.js`
3. `tests/unit/agents/ingest/index.test.js`
4. `tests/unit/agents/llm/ppt-model-bridge.test.js`
5. `tests/unit/agents/mcp/local-mcp-provider.test.js`
6. `tests/unit/agents/shared/index.test.js`
7. `tests/integration/agents/runtime/telemetry.test.js`
8. `tests/unit/agents/plugins/checkpoints/index.test.js`
9. `tests/unit/agents/runtime/context/subagent-budget.test.js`
10. `tests/unit/agents/runtime/core/agent-loop-message-handling.test.js`
11. `tests/unit/agents/runtime/hooks/hook-registry.test.js`
12. `tests/unit/agents/runtime/memory/l3-storage.test.js`
13. `tests/integration/agents/core/sandbox/tool-executor.additional-branches.test.js`
14. `tests/integration/agents/core/sandbox/tool-executor.sandbox.test.js`
15. `tests/integration/agents/runtime/hooks/hook-event.test.js`
16. `tests/integration/agents/stages/codesearch/phases-index.vitest.test.js`
17. `tests/integration/agents/stages/deepsearch/helpers.test.js`
18. `tests/integration/agents/stages/deepsearch/tool-handlers.test.js`
19. `js/agents/core/node-compat/polyfills/__tests__/error-stack-trace.test.js`
20. `tests/unit/agents/runtime/core/middleware/middleware-chain.test.js`
21. `tests/unit/agents/stages/design/runtime/design-blackboard.test.js`

### 2.3 core 子集测试基线

来自 `tmp/agents-core-vitest-baseline.json`：

- 总测试数：**3,128**
- 通过：**3,120**
- 失败：**8**
- 失败 suite：**10**

core 相关失败集中在两类：

1. **sandbox / tool-executor 行为分支**
   - `tests/integration/agents/core/sandbox/tool-executor.additional-branches.test.js`
   - `tests/integration/agents/core/sandbox/tool-executor.sandbox.test.js`
2. **node-compat polyfill 行为**
   - `js/agents/core/node-compat/polyfills/__tests__/error-stack-trace.test.js`

这说明：**从 core 开始修是对的，但第一批并不应该直接大改 EventBus/Kernel，而应先清理 `node-compat` 和 `sandbox` 的类型/行为噪音。**

### 2.4 tsc 基线比运行期失败更糟

`npx tsc -p js/agents/tsconfig.json --pretty false` 当前共有 **651** 条诊断：

| 顶层模块 | 诊断数 |
|---|---:|
| `core` | 342 |
| `runtime` | 146 |
| `plugins` | 54 |
| `stages` | 37 |
| `retrieval` | 23 |
| `mcp` | 18 |
| `sdk` | 12 |
| `vfs` | 9 |
| `skills` | 4 |
| `llm` | 3 |
| `shared` | 2 |
| `js/shared/adapters/base-adapter.js` | 1 |

其中最重要的事实不是“core 很烂”，而是：

- **102 条诊断来自 colocated `__tests__`**，说明源码与测试被一起喂给了 `tsc`
- `js/agents/tsconfig.json` 当前 `types: []`，并且只给了 DOM lib，直接制造了 Node builtins 的类型噪音
- 一部分错误属于 **路径写错 / JSDoc 契约漂移 / 缺失声明**，不是运行时真实缺陷

### 2.5 现有覆盖地图可用，但已陈旧

`.test-map.json` 生成时间：**2026-01-22T13:15:39.597Z**。

摘要：

- 覆盖目标：**90%**
- 当前记录：**68.1%**
- `js/agents` 总文件：**543**
- 已覆盖：**370**
- stale：**29**
- untested：**144**

低覆盖模块（按 `.test-map.json`）包括：

| 模块 | 覆盖率 | 备注 |
|---|---:|---|
| `js/agents/cli` | 0.0% | 非核心，但完全裸奔 |
| `js/agents/index.js` | 0.0% | 入口未覆盖 |
| `js/agents/sdk` | 29.4% | 高层 API 缺系统化验证 |
| `js/agents/mcp` | 55.0% | 集成不足 |
| `js/agents/skills` | 55.6% | 依赖 sandbox/loader |
| `js/agents/retrieval` | 61.5% | 算法有测，闭环不够 |
| `js/agents/runtime` | 65.4% | 胶水层缺口大 |
| `js/agents/stages` | 68.3% | 关键阶段多，但跨层验证不足 |
| `js/agents/vfs` | 70.0% | 操作层和协议层仍有空洞 |

core 内部未覆盖/陈旧热点：

- `js/agents/core/archive/archive-core.js`
- `js/agents/core/archive/storage-adapter.js`
- `js/agents/core/sandbox/system/index.js`
- `js/agents/core/kernel-compat.js`
- `js/agents/core/sandbox/plugin.js`
- `js/agents/core/sandbox/pool.js`
- `js/agents/core/secure-plugin-loader.js`
- `js/agents/core/di/defaults.js`（stale）
- `js/agents/core/event-bus-utils.js`（stale）
- `js/agents/core/event-bus.js`（stale）

## 3. 为什么现在不该直接硬修业务逻辑

先修 `tsc` 基线比直接修具体测试更值钱，原因很简单：

1. **类型环境错误会放大噪音**
   - `js/agents/tsconfig.json` 没有 Node 类型，`node:*`、`fs`、`http`、`child_process` 一类错误会铺天盖地。
2. **测试文件被纳入源码检查**
   - 当前 `core/**/*.js`、`runtime/**/*.js` 会把 `__tests__` 一起带进去，主线诊断被污染。
3. **路径/JSDoc 漂移属于低风险高收益修复**
   - 如 `archive-core.js` 路径、`create-node-env.js` 的 JSDoc import、`npm/index.js` 的注释语法问题，修掉能立即降低噪音。
4. **真正的运行时行为失败数量其实不大**
   - 当前全量 agents 是 **37** 个失败测试，不是系统性崩坏；但 `tsc` 有 **651** 条诊断，会拖垮后续工作效率。

## 4. 从 core 开始的修复顺序（建议严格按这个来）

### Phase 0：先建立干净类型基线

优先文件：

1. `js/agents/tsconfig.json`
2. `js/agents/core/node-compat/shims/fs.js`
3. `js/agents/core/sandbox/pool.js`
4. `js/agents/core/node-compat/create-node-env.js`
5. `js/agents/core/node-compat/npm/index.js`

目标：

- 把 `tsc` 的环境噪音、JSDoc 语法噪音、错误对象扩展噪音先降下来
- 把测试文件与生产源码的检查边界分开
- 为后续 core 行为修复提供可信信号

### Phase 1：清掉 core 当前运行失败

优先修复：

1. `js/agents/core/node-compat/polyfills/error-stack-trace.js` 相关行为
2. `js/agents/runtime/tools/tool-executor.js` 与 sandbox/PackageManager 分支
3. 与上述行为直接对应的测试断言

目标：

- 让 `tests/unit/agents/core/**`
- `tests/integration/agents/core/**`
- `js/agents/core/**/__tests__/**`

先恢复全绿。

### Phase 2：补 core 缺失测试

先补而不是先扩散到 stages：

1. `js/agents/core/sandbox/pool.js`
2. `js/agents/core/sandbox/plugin.js`
3. `js/agents/core/sandbox/system/index.js`
4. `js/agents/core/archive/archive-core.js`
5. `js/agents/core/archive/storage-adapter.js`
6. `js/agents/core/kernel-compat.js`
7. `js/agents/core/secure-plugin-loader.js`
8. `js/agents/core/event-bus.js` / `event-bus-helpers.js` 的 trace/错误传播边界

### Phase 3：再进 runtime / plugins / stages

优先原因：这些层是 **胶水层**，也是最容易因为 core 变更回归的地方。

建议先后顺序：

1. `runtime/core/*`：orchestrator、agent-loop、message-handling、middleware
2. `plugins/context/*`：fold / io / 恢复链
3. `mcp/*`：helpers / fallback / 错误映射
4. `stages/deepsearch/*`：tool-catalog / handler / report write path
5. `stages/design/*`：design-state / loop / generator helpers

### Phase 4：补 smoke 与 e2e

这是当前最缺的层，不补就没有“系统还活着”的保证。

优先新增：

1. `tests/smoke/agents-startup.smoke.test.js`
   - `quickKernel()`
   - `AgentBuilder`
   - `createAgent()` 最小 happy path
2. `tests/smoke/agents-core-buses.smoke.test.js`
   - EventBus / MessageBus / StateBus 最小闭环
3. `tests/e2e/agents-basic-flow.test.js`
   - kernel → tool registry → tool execute → event capture
4. `tests/e2e/deepsearch-minimal-flow.test.js`
   - 最小任务输入到报告输出
5. `tests/e2e/design-minimal-flow.test.js`
   - 最小 design loop 到状态收敛

## 5. 现在最值得补的 10 个测试空洞

1. `quickKernel()` / `AgentBuilder` / `createAgent()` 启动冒烟
2. `core/event-bus.js` + `event-bus-helpers.js` + `message-bus.js` 事件/trace/错误传播集成
3. `runtime/core/orchestrator-core.js`、`agent-coordination.js` 状态转换与调度
4. `core/sandbox/skill-executor-core.js`、`skill-validation.js` 拒绝路径/资源限制
5. `stages/deepsearch/tools/tool-catalog.js`、`tool-executor-ds.js` 最小闭环
6. `stages/design/internal/design-state.js`、generator helpers 的 loop 一致性
7. `plugins/context/fold.js` + `io.js` 持久化与损坏恢复
8. `mcp/mcp-nexus-helpers.js`、`smart-content-helpers.js` fallback/错误映射
9. `sdk/http/stream-events.js` 断流/重连/abort/late event
10. `stages/textprep/textprep-stage.js` + `ingest/adapters/resolve-deps.js` 的轻量链路

## 6. 建议的目标测试比例

对 `js/agents` 这类微内核 + 插件 + 阶段系统，建议目标不是追求“全部都做 e2e”，而是分层：

- **70%~75% 单元测试**：覆盖算法、纯函数、边界条件
- **20%~25% 集成测试**：覆盖核心模块之间的接口契约和状态转换
- **5%~10% smoke/e2e**：覆盖启动链、关键业务链、环境兼容性

当前实际结构更接近：

- **86.5% 单元/近单元**
- **13.5% 集成**
- **0% 自动化 e2e**
- **≈0% 独立 smoke**

结论：**不是测试不够多，而是测试层次不健康。**

## 7. 设计质量审查关注点（留待测试清零后复核）

待核心测试恢复绿色后，需要专项检查以下问题：

1. **模块边界是否过宽**
   - `runtime/core/*` 与 `stages/*` 是否泄漏太多实现细节
2. **JSDoc 契约是否可信**
   - 现在已有多处类型漂移，说明注释不是可靠事实源
3. **入口导出是否稳定**
   - `js/agents/stages/index.js` 已出现重复导出诊断，需要清点 API surface
4. **Node / Browser 双环境分叉是否过深**
   - `node-compat`、`sandbox`、`webruntime` 类型和行为容易分叉
5. **测试是否过度依赖实现细节**
   - 一部分失败看起来像断言写死了内部结构，而不是验证公开契约

## 8. Definition of Done

以下条件全部满足，才算这轮完成：

- `npx tsc -p js/agents/tsconfig.json --pretty false` 通过
- `npx vitest run tests/unit/agents tests/integration/agents js/agents` 通过
- core 子集测试全绿
- 新增 smoke/e2e 可在 CI 中自动执行
- `docs/tests/` 中补齐：
  - 当前基线
  - 分阶段修复计划
  - 测试矩阵
  - 新增 smoke/e2e 说明
- 测试结构从“单测挤压一切”改善为分层结构

## 9. 下一步执行清单

1. 先修 `js/agents/tsconfig.json`，拆开源码与测试检查边界
2. 清 `core/node-compat` 与 `core/sandbox` 的低风险类型债
3. 跑 core 子集测试，逐个清 8 个失败测试
4. 为 core 补缺失单测/集成测试
5. 扩展到 runtime / plugins / stages
6. 新建 `tests/smoke/` 与自动化 `tests/e2e/`
7. 全量回归后，再做一次 `js/agents` 设计质量复盘

## 10. 进度更新（2026-03-07 第一轮）

本轮已经完成的实际改进：

- `tsc` 诊断从 **651** 降到 **442**（减少 **209** 条）
- `core` 子集测试从 **3128/8 fail** 改善为 **3128/0 fail**
- 全量 agents 自动化测试从 **20,033 总数 / 37 fail** 变为 **20,037 总数 / 29 fail**
- 新增自动化 **smoke**：`tests/smoke/agents-startup.smoke.test.js`
- 新增自动化 **e2e**：`tests/e2e/agents-basic-flow.test.js`
- `vitest.config.js` 与 `package.json` 已纳入 smoke/e2e 测试入口

本轮完成的核心修复范围：

- 类型基线：`js/agents/tsconfig.json`
- core 契约与总线：`js/agents/core/contracts/*`、`event-bus*`、`message-bus`
- node-compat：`create-node-env.js`、`execution-strategy.js`、`npm/index.js`、`polyfills/stack-trace.js`
- sandbox：`js/agents/core/sandbox/pool.js`、`js/agents/core/node-compat/sandbox-tool.js`
- 工具执行链：`js/agents/runtime/tools/tool-executor.js`

下一轮优先级不变，但焦点应切到 **非 core 剩余失败**：

1. `tests/unit/agents/plugins/checkpoints/index.test.js`
2. `tests/unit/agents/runtime/context/subagent-budget.test.js`
3. `tests/unit/agents/runtime/core/agent-loop-message-handling.test.js`
4. `tests/integration/agents/platform-tools.test.js`
5. `tests/integration/agents/skills.test.js`
6. `tests/unit/agents/shared/index.test.js` / `tests/integration/agents/stages/codesearch/phases-index.vitest.test.js`

## 11. 进度更新（2026-03-07 第二轮）

本轮继续只在 `js/agents/**`、对应 `tests/**`、`docs/tests/**` 范围内收敛修复，结果如下：

- 全量 agents 自动化测试从 **20,037 / 29 fail** 进一步降到 **20,045 / 20 fail**
- 新清掉的失败主要集中在：
  - `runtime/tools/platform`
  - `plugins/telemetry/trace-context`
  - `runtime/hooks/*`
  - `shared/index`
  - `runtime/memory/l3-storage`
  - `runtime/core/middleware`
  - `stages/design/runtime/design-blackboard`
  - `integration/runtime` 中 worker fixture 路径问题

本轮关键改动：

- 实现修复：
  - `js/agents/runtime/tools/platform/index.js`
  - `js/agents/plugins/telemetry/trace-context.js`
- 测试与契约更新：
  - `tests/integration/agents/runtime.test.js`
  - `tests/integration/agents/runtime/hooks/hook-event.test.js`
  - `tests/unit/agents/runtime/hooks/hook-registry.test.js`
  - `tests/unit/agents/shared/index.test.js`
  - `tests/unit/agents/plugins/telemetry/trace-context.test.js`
  - `tests/unit/agents/runtime/memory/l3-storage.test.js`
  - `tests/unit/agents/runtime/core/middleware/middleware-chain.test.js`
  - `tests/unit/agents/stages/design/runtime/design-blackboard.test.js`

当前剩余失败清单已经收敛到 10 组：

1. `tests/integration/agents/skills.test.js`
2. `tests/unit/agents/ingest/index.test.js`
3. `tests/unit/agents/llm/ppt-model-bridge.test.js`
4. `tests/unit/agents/mcp/local-mcp-provider.test.js`
5. `tests/integration/agents/stages/codesearch/phases-index.vitest.test.js`
6. `tests/integration/agents/stages/deepsearch/helpers.test.js`
7. `tests/integration/agents/stages/deepsearch/tool-handlers.test.js`
8. `tests/unit/agents/plugins/checkpoints/index.test.js`
9. `tests/unit/agents/runtime/context/subagent-budget.test.js`
10. `tests/unit/agents/runtime/core/agent-loop-message-handling.test.js`

下一轮优先级建议：

1. 先清 `plugins/checkpoints`（5 fail）和 `runtime/context/subagent-budget`（4 fail）  
2. 再清 `agent-loop-message-handling`（2 fail）  
3. 最后处理 `skills / ingest / llm / mcp / deepsearch` 的单点失败  

这样可以继续用最小 diff 换最多绿灯。

---

> 备注：本文件记录的是 **修复前基线**。后续每完成一个阶段，应更新本文件中的失败数、覆盖空洞和目标比例偏差。
