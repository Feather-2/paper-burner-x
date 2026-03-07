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

## 13. 进度更新（2026-03-07 第三轮，回到主线）

本轮在完成修复回看审计之后，重新回到主线清理剩余失败测试，结果如下：

- 全量 agents 自动化测试已达到 **20,058 / 0 fail**
- `npx tsc -p js/agents/tsconfig.json --pretty false` 诊断从 **442** 进一步降到 **440**

本轮主线修复点：

- `js/agents/runtime/core/context/subagent-budget.js`
  - 修正 release / abort 对“已消耗预算”和“未使用预算”的记账语义
  - 现在只回收未使用部分，已消耗部分继续占用 distributable budget
- `tests/unit/agents/plugins/checkpoints/index.test.js`
  - 补齐 `safeJsonParseDetailed` mock，恢复 checkpoint index / payload 解析链测试
- `tests/unit/agents/runtime/core/agent-loop-message-handling.test.js`
  - 同步 `onBeforeCompress` / `onAfterCompress` 新回调契约
- `tests/integration/agents/stages/codesearch/phases-index.vitest.test.js`
  - 同步 shared/index 新导出与 mock 映射
- `tests/unit/agents/llm/ppt-model-bridge.test.js`
  - 同步新 usage roles：`cicada_summary` / `summarizer` / `extractor`
- `tests/unit/agents/mcp/local-mcp-provider.test.js`
  - 放宽为 `objectContaining`，避免对新增默认字段过绑定
- `tests/integration/agents/stages/deepsearch/helpers.test.js`
  - 改为验证 node id 后缀合法且连续调用不重复，不再写死内部计数细节
- `tests/integration/agents/stages/deepsearch/tool-handlers.test.js`
  - 同步新的 todo id 格式
- `tests/integration/agents/skills.test.js`
  - 同步 fallback 安全策略：允许 `Blocked pattern` 或 `Fallback eval is disabled`
- `tests/unit/agents/ingest/index.test.js`
  - 同步 rawTextAdapter.parse 的新参数结构（signal / checkCancelled）
- `tests/unit/agents/runtime/core/context/subagent-budget.test.js`
  - 统一两套测试对“预算回收语义”的预期，避免和当前实现契约冲突

当前状态：

- **测试主线已全绿**
- **TSC 仍有 440 条诊断**
- 下一阶段应重新集中火力处理 TSC 热点，而不是继续改测试

## 14. 进度更新（2026-03-07 第四轮，TSC 热点首批）

本轮开始真正集中处理 `js/agents` 的 TSC 热点，优先选择 `node-compat` 中“高密度、低行为风险、适合精确类型修复”的文件：

- `js/agents/core/node-compat/shims/fs.js`
- `js/agents/core/node-compat/shims/net.js`

结果：

- `npx tsc -p js/agents/tsconfig.json --pretty false`
  - 诊断从 **440** 降到 **351**
  - 单轮减少 **89** 条

### 本轮修复内容

1. `js/agents/core/node-compat/shims/fs.js`
   - 引入 `FsError` / `asFsError()` / `createFsError()`
   - 系统性收敛 `Error.code` / `Error.path` 扩展的类型问题
   - 修正 `copyFileSync()` 对 `readFileSync()` 返回 `string | Uint8Array` 的分支处理
   - 保持原有运行时语义，不用 `any` 压过去

2. `js/agents/core/node-compat/shims/net.js`
   - 引入 `NetError` / `createNetError()`
   - 系统性收敛 `code / errno / syscall / address / port` 扩展错误对象
   - 把 `Socket._write` 从与 `Duplex` 冲突的方法定义改成实例属性赋值，保持 Node stream shim 契约一致
   - 修正 `RangeError.code` 与 `listen(0)` 失败分支的类型问题

### 验证

- `tests/unit/agents/core/node-compat/shims/fs.test.js`
- `tests/unit/agents/core/node-compat/shims/net.test.js`

均已通过。

### 下一步

继续按同样标准推进下一批 TSC 热点：

1. `js/agents/core/node-compat/npm/tarball.js`
2. `js/agents/core/node-compat/shims/assert.js`
3. `js/agents/retrieval/retrieval-router.js`
4. `js/agents/runtime/core/orchestrator-core.js`

## 15. 进度更新（2026-03-07 第五轮，TSC 热点第二批）

继续沿着 `node-compat` 的高密度文件推进，本轮处理：

- `js/agents/core/node-compat/npm/tarball.js`
- `js/agents/core/node-compat/shims/assert.js`

结果：

- `npx tsc -p js/agents/tsconfig.json --pretty false`
  - 诊断从 **351** 降到 **339**
  - 单轮减少 **12** 条

### 本轮修复内容

1. `js/agents/core/node-compat/npm/tarball.js`
   - 增加 `TarballError`
   - 用 `toArrayBufferExact()` 显式把 `Uint8Array` 转成精确 `ArrayBuffer`
   - 修复 `Blob` / `crypto.subtle.digest` 的 `BufferSource` 类型不匹配
   - 避免依赖未收窄的全局 `Buffer`，改为从 `globalThis.Buffer` 显式取值

2. `js/agents/core/node-compat/shims/assert.js`
   - 增加 `ErrorWithCode` / `hasErrorCode()`
   - 修复 `throws` / `rejects` 分支里对 `err.code` 的不安全访问
   - 保持断言语义不变，仅收紧错误对象契约

### 验证

- `tests/unit/agents/core/node-compat/npm/tarball.test.js`
- `tests/unit/agents/core/node-compat/shims/assert.test.js`

均已通过。

### 下一步

继续进入下一批热点：

1. `js/agents/retrieval/retrieval-router.js`
2. `js/agents/runtime/core/orchestrator-core.js`
3. `js/agents/plugins/side-effects/side-effect-journal-helpers.js`

## 16. 进度更新（2026-03-07 第六轮，TSC 热点第三批）

继续推进下一批热点：

- `js/agents/retrieval/retrieval-router.js`
- `js/agents/runtime/core/orchestrator-core.js`

结果：

- `npx tsc -p js/agents/tsconfig.json --pretty false`
  - 诊断从 **339** 降到 **306**
  - 单轮减少 **33** 条

### 本轮修复内容

1. `js/agents/retrieval/retrieval-router.js`
   - 引入 `RetrievalConfig` / `Bm25LoadOptions`
   - 清理 `retrieve()` 的 JSDoc 结构错误，修正重复的 `mmr` 声明
   - 为 `persistBm25Index / awaitPersistBm25 / grepRegex / caseSensitive / scoreMerge / scoring / seedByGap` 等配置补齐类型
   - 修正 `mmr !== false` 语义判断，避免把布尔开关和对象配置混淆

2. `js/agents/runtime/core/orchestrator-core.js`
   - 补齐 `AgentOrchestratorOptions` / `RegisterStageOptions`
   - 为 mixin 注入的方法增加显式声明：`registerAgent/start/_emitRunFailed/_emitRunEnded/_getEffectiveConcurrencyLimit/_rejectParallelWaiters`
   - 收紧 `services` / `container` / `configValidation` / `eventBusBackpressure` 的结构化类型
   - 修正 `getStatus()` 返回类型为 `OrchestratorStateValue`

### 验证

- `tests/unit/agents/retrieval/retrieval-router.test.js`
- `tests/integration/agents/retrieval-router.vitest.test.js`
- `tests/unit/agents/runtime/core/orchestrator-core.test.js`
- `tests/integration/agents/runtime.test.js`

均已通过。

### 下一步

继续进入下一批热点：

1. `js/agents/plugins/side-effects/side-effect-journal-helpers.js`
2. `js/agents/mcp/mcp-client.js`
3. `js/agents/runtime/core/api/stage-api-helpers.js`

## 17. 进度更新（2026-03-07 第七轮，TSC 热点第四批）

继续推进下一批热点：

- `js/agents/plugins/side-effects/side-effect-journal-helpers.js`
- `js/agents/mcp/mcp-client.js`
- `js/agents/runtime/core/api/stage-api-helpers.js`

结果：

- `npx tsc -p js/agents/tsconfig.json --pretty false`
  - 诊断从 **306** 降到 **272**
  - 单轮减少 **34** 条

### 本轮修复内容

1. `js/agents/plugins/side-effects/side-effect-journal-helpers.js`
   - 明确 `buildJournalEntry()` 的返回结构
   - 对 `checkpoint` / `meta` 做局部收窄后再展开，避免对 `unknown` 直接 spread

2. `js/agents/mcp/mcp-client.js`
   - 对 `err`、`err.error`、`err.mcpResult.error`、`err.response` 做显式 record 收窄
   - 修复 circuit-breaker 错误分类逻辑中的 `unknown` 属性访问

3. `js/agents/runtime/core/api/stage-api-helpers.js`
   - 补充 `ServiceContainerLike`
   - 补充 `TokenUsageSummary`
   - 允许 `usageMissing` 作为返回字段，避免“契约比实现窄”的问题

### 验证

- `tests/unit/agents/mcp/mcp-client.test.js`
- `tests/integration/agents/mcp/mcp-provider.test.js`

均已通过。

### 当前状态

- 全量 agents 测试仍然保持 **20,058 / 0 fail**
- TSC 诊断已降到 **272**

### 下一步

继续进入下一批热点：

1. `js/agents/runtime/core/js-sandbox-worker.node.js`
2. `js/agents/runtime/core/errors/error-taxonomy.js`
3. `js/agents/plugins/debug/logger.js`

## 18. 进度更新（2026-03-07 第八轮，TSC 热点第五批）

继续推进下一批热点：

- `js/agents/runtime/core/js-sandbox-worker.node.js`
- `js/agents/runtime/core/errors/error-taxonomy.js`
- `js/agents/plugins/debug/logger.js`

结果：

- `npx tsc -p js/agents/tsconfig.json --pretty false`
  - 诊断从 **272** 降到 **249**
  - 单轮减少 **23** 条

### 本轮修复内容

1. `js/agents/runtime/core/js-sandbox-worker.node.js`
   - 收窄 array-like / typed-array / requestLimits 的输入结构
   - 修复 `assertArrayBuffer()` 传参类型
   - 修正 `createRestrictedGlobals()` audit 参数契约
   - 移除 Node `vm` 类型定义中不存在的 `microtaskMode` 选项，避免伪契约

2. `js/agents/runtime/core/errors/error-taxonomy.js`
   - 增加 `ClassifiedError`
   - 对 `retryable / category / code / status` 做显式错误对象收窄

3. `js/agents/plugins/debug/logger.js`

## 19. 进度更新（2026-03-07 第九轮，TSC 热点第六批）

继续推进下一批热点：

- `js/agents/runtime/core/stage-rpc-bridge.js`
- `js/agents/plugins/transports/process-transport.js`
- `js/agents/stages/design/agent-loop.js`
- `js/agents/shared/utils/backpressure-init.js`

结果：

- `npx tsc -p js/agents/tsconfig.json --pretty false`
  - 诊断从 **249** 降到 **229**
  - 单轮减少 **20** 条

### 本轮修复内容

1. `js/agents/runtime/core/stage-rpc-bridge.js`
   - 增加 `StageRpcResponseEnvelope`
   - 收紧 `serializeRpcError()` 与 response envelope 解包逻辑
   - 让 handler 返回值与 `MessageBus.on()` 的签名兼容

2. `js/agents/plugins/transports/process-transport.js`
   - 补齐 `ProcessTransportOptions`
   - 收紧 `ChildProcessLike`（增加 `pid`）
   - 修正 `spawn()` 返回值与 connect timeout 错误对象的类型

3. `js/agents/stages/design/agent-loop.js`
   - 增加 `DesignCoreRuntime`
   - 补 `_activeStep` 字段声明
   - 收紧 `_initCoreRuntime()` 返回契约

4. `js/agents/shared/utils/backpressure-init.js`
   - 把 `enableBackpressureIfNeeded()` 调整为真正的边界收窄函数
   - 接受 `unknown` 输入，内部收窄成 `BackpressureCapableEventBus`
   - 这样既保持运行时兼容，也避免调用方被迫伪装成精确 `EventBus`

### 验证

- `tests/unit/agents/runtime/core/stage-rpc-bridge.test.js`
- `tests/unit/agents/plugins/transports/process-transport.test.js`
- `tests/unit/agents/stages/design/agent-loop.test.js`
- `tests/integration/agents/stages/design.test.js`

均已通过。

### 当前状态

- 全量 agents 测试仍然保持 **20,058 / 0 fail**
- TSC 诊断已降到 **229**

### 下一步

继续进入下一批热点：

1. `js/agents/vfs/operations.js`
2. `js/agents/core/node-compat/shims/crypto.js`
3. `js/agents/core/node-compat/shims/http.js`

## 20. 进度更新（2026-03-07 第十轮，TSC 热点第七批）

继续推进下一批热点：

- `js/agents/vfs/operations.js`
- `js/agents/core/node-compat/shims/crypto.js`
- `js/agents/core/node-compat/shims/http.js`

结果：

- `npx tsc -p js/agents/tsconfig.json --pretty false`
  - 诊断从 **229** 降到 **212**
  - 单轮减少 **17** 条

### 本轮修复内容

1. `js/agents/vfs/operations.js`
   - 增加 `CancellableLike` / `VfsAbortError`
   - 修复 `abort/cancel` 探测与取消错误对象扩展

2. `js/agents/core/node-compat/shims/crypto.js`
   - 增加 `CryptoShimError` / `TypedArrayLike`
   - 收紧 `randomInt()` / `normalizeAlgorithm()` 的错误对象和 typed-array 参数契约

3. `js/agents/core/node-compat/shims/http.js`

## 21. 进度更新（2026-03-07 第十一轮，TSC 热点第八批）

继续推进下一批热点：

- `js/agents/core/node-compat/shims/http2.js`
- `js/agents/core/node-compat/shims/index.js`

结果：

- `npx tsc -p js/agents/tsconfig.json --pretty false`
  - 诊断从 **212** 降到 **200**
  - 单轮减少 **12** 条

### 本轮修复内容

1. `js/agents/core/node-compat/shims/http2.js`
   - 增加 `Http2ShimError` / `UnsupportedServer`
   - 修复不支持错误对象的 `code` 扩展
   - 修复 stub server 上 `isStub/supported/listen/close` 的类型声明

2. `js/agents/core/node-compat/shims/index.js`
   - 收紧 `createBuiltinModules()` 的 config 契约
   - 为 `modules.fs` / `modules.child_process` 的延迟注入补齐类型
   - 清理重复/冲突的 JSDoc 参数声明

### 验证

- `tests/unit/agents/core/node-compat/shims/http2.test.js`
- `tests/unit/agents/core/node-compat/shims/index.test.js`
- `tests/unit/agents/vfs/operations.test.js`
- `tests/unit/agents/core/node-compat/shims/crypto.test.js`
- `tests/unit/agents/core/node-compat/shims/http.test.js`

均已通过。

### 当前状态

- 全量 agents 测试仍然保持 **20,058 / 0 fail**
- TSC 诊断已降到 **200**

### 下一步

继续进入下一批热点：

1. `js/agents/core/node-compat/shims/http2.js` 关联文件（若新热点出现）
2. 重新统计剩余热点，优先处理超过 5 条的文件

## 22. 进度更新（2026-03-07 第十二轮，热点再平衡）

本轮先不追求单文件清零，而是对新一轮热点做“高收益预清理”：

- `js/agents/core/node-compat/shims/stream.js`
- `js/agents/core/webruntime/hmr.js`
- `js/agents/plugins/side-effects/side-effect-journal-helpers.js`

结果：

- `npx tsc -p js/agents/tsconfig.json --pretty false`
  - 诊断从 **200** 降到 **194**
  - 单轮减少 **6** 条

### 本轮修复内容

1. `js/agents/core/node-compat/shims/stream.js`
   - 为 `Readable.from()` 增加 iterable / asyncIterable 分流收窄
   - 增加 `StreamShimError`
   - 对 `write after end` 错误对象补齐 `code`
   - 开始调整 `Transform` 的 `_write` 结构，减少与 `Duplex` 的签名冲突

2. `js/agents/core/webruntime/hmr.js`
   - 为 `HmrClient` 显式声明 mixin 注入的 `on/off/emit`
   - 收紧 `handleFileChange()` 中 update 对象的类型

3. `js/agents/plugins/side-effects/side-effect-journal-helpers.js`
   - 引入与 journal 主模块对齐的 `SideEffectJournalEntry` / `SideEffectJournalCheckpointRef`
   - 让 helper 的 `buildJournalEntry()` 返回结构与主模块契约一致

### 当前判断

- 这批文件还没完全清零，但已经把类型基础打平了，后续继续收口成本更低
- 当前剩余最突出的仍然是：
  - `js/agents/core/node-compat/shims/stream.js`
  - `js/agents/core/sandbox/skill-sandbox.js`
  - `js/agents/core/webruntime/hmr.js`
  - `js/agents/plugins/side-effects/side-effect-journal.js`

### 当前状态

- 全量 agents 测试仍然保持 **20,058 / 0 fail**
- TSC 诊断已降到 **194**
   - 补齐 `askCallback` 的精确签名
   - 收紧网络策略错误 / abort 错误 / bad port 错误对象类型

### 验证

- `tests/unit/agents/vfs/operations.test.js`
- `tests/unit/agents/core/node-compat/shims/crypto.test.js`
- `tests/unit/agents/core/node-compat/shims/http.test.js`
- `tests/unit/agents/core/node-compat/shims/https.test.js`
- `tests/integration/agents/runtime.test.js`

均已通过。

### 当前状态

- 全量 agents 测试仍然保持 **20,058 / 0 fail**
- TSC 诊断已降到 **212**

### 下一步

继续进入下一批热点：

1. `js/agents/core/node-compat/shims/http2.js`
2. `js/agents/core/node-compat/shims/index.js`
3. `js/agents/runtime/core/errors/error-taxonomy.js` 相关联文件（如有新增暴露）
   - 增加 `LoggerPluginContext`
   - 显式声明 `_loggerUnsubs` 生命周期字段
   - 修正 `registerEventListeners()` 返回类型

### 验证

- `tests/unit/agents/runtime/core/js-sandbox-worker.node.test.js`
- `tests/unit/agents/plugins/debug/logger.test.js`
- `tests/unit/agents/core/plugin.test.js`
- `tests/integration/agents/plugins/event-driven.test.js`

均已通过。

### 当前状态

- 全量 agents 测试仍然保持 **20,058 / 0 fail**
- TSC 诊断已降到 **249**

### 下一步

继续进入下一批热点：

1. `js/agents/runtime/core/stage-rpc-bridge.js`
2. `js/agents/plugins/transports/process-transport.js`
3. `js/agents/stages/design/agent-loop.js`

## 12. 代码质量回看（2026-03-07）

按“不能用 `any`/`unknown` 逃避问题、不能靠降行为换绿灯”的标准，回看了本轮之前提交，确认存在两类需要纠正的修法：

1. **类型逃逸**
   - `js/agents/core/event-bus.js` 里把 archive 直接放宽成了 `any`
   - `js/agents/core/state-bus.js` 里把 archive 放宽成了 `any`
   - `js/agents/core/node-compat/npm/index.js` 里把事件 payload map 压扁成了 `Record<string, unknown>`

2. **风险**
   - 这些改动虽然能降噪，但会让真实契约丢失，后续继续演化时更容易把错误藏起来

本轮已经把这三处改回**显式契约**：

- `js/agents/core/event-bus.js`
  - 增加 `EventBusArchive` / `EventBusArchiveSnapshot`
  - 明确 `list/load/save/delete` 与历史快照结构
- `js/agents/core/state-bus.js`
  - 增加 `StateBusArchive` / `StateBusArchiveSnapshot`
  - 用 `StateRecord` + `asStateRecord()` 做局部收窄，而不是继续放大类型
- `js/agents/core/node-compat/npm/index.js`
  - 恢复精确的事件 payload typedef
  - `EventEmitter` 改为按事件名约束 payload 类型

验证结果：

- `npx tsc -p js/agents/tsconfig.json --pretty false` 中，上述三个文件已不再报错
- `tests/unit/agents/core/state-bus.test.js`
- `tests/unit/agents/core/event-bus.test.js`
- `tests/unit/agents/core/node-compat/npm/index.test.js`

都已回归通过。

继续回看后，还确认了一处“不是类型逃逸、但属于实现被拍平”的问题：

- `js/agents/plugins/telemetry/trace-context.js`
  - 曾经把无 WebCrypto 时的 fallback 从内部 PRNG + counter 退化成了 `Math.random()`
  - 这会降低 fallback 语义精度，也让实现为了兼容旧断言而变弱

该问题已重做：

- 恢复为 `xorshift32 + counter + 时间扰动` 的明确非加密 fallback
- 测试不再写死“必须走 Math.random”，而是验证：
  - trace/span id 的 hex 长度合法
  - fallback 连续调用不会简单重复
  - warning 中的 mode 明确为 `xorshift32-counter`

验证通过：

- `tests/unit/agents/plugins/telemetry/trace-context.test.js`
- `tests/integration/agents/runtime/telemetry.test.js`

---

> 备注：本文件记录的是 **修复前基线**。后续每完成一个阶段，应更新本文件中的失败数、覆盖空洞和目标比例偏差。

## 13. 第 12 轮，继续清理 TSC 热点（2026-03-08）

本轮继续按“只补契约、不拍平逻辑”的原则清理 `js/agents` 热点，覆盖了 node-compat、sandbox、runtime、skills、codesearch、design 多个子模块。

### 本轮处理文件

- `js/agents/core/node-compat/shims/https.js`
- `js/agents/core/node-compat/shims/process.js`
- `js/agents/core/node-compat/shims/stream.js`
- `js/agents/core/node-compat/shims/worker_threads.js`
- `js/agents/core/node-compat/sandbox-tool.js`
- `js/agents/core/sandbox/iframe-eval-bridge.js`
- `js/agents/core/sandbox/iframe-sandbox.js`
- `js/agents/core/sandbox/skill-sandbox.js`
- `js/agents/core/webruntime/hmr.js`
- `js/agents/mcp/resource-manager.js`
- `js/agents/plugins/compression/cicada.js`
- `js/agents/plugins/side-effects/side-effect-journal.js`
- `js/agents/retrieval/bm25.js`
- `js/agents/runtime/core/orchestrator-helpers.js`
- `js/agents/runtime/core/persisted-output.js`
- `js/agents/runtime/core/tool-registry.js`
- `js/agents/runtime/core/vfs-proxy.js`
- `js/agents/runtime/core/worker-factory.js`
- `js/agents/runtime/core/worker-rpc.js`
- `js/agents/runtime/hooks/hook-registry.js`
- `js/agents/sdk/http/request-handler.js`
- `js/agents/skills/manager.js`
- `js/agents/stages/codesearch/indexing/symbol-indexer.js`
- `js/agents/stages/deepsearch/phases/planning-phase-helpers.js`
- `js/agents/stages/design/edit-agent-loop.js`
- `js/agents/stages/design/model.js`
- `js/agents/stages/design/subagents/slide-agent.js`

### 这轮做了什么

- 把多处“实现已返回扩展字段，但 JSDoc 仍写窄”的结果对象补成显式契约：
  - sandbox fallback 结果
  - sandbox tool handler 结果
  - persisted-output scoped config / cleanup 选项
- 把多个“局部私有字段动态挂载”补成文件内精确别名，而不是放大成 `any`：
  - `compression/cicada` 的 `_cicadaUnsub`
  - worker 相关 `_workerId`
  - hooks 的 `_execCount` / `_lastExecTime`
- 修正多处 `checkJs` 无法自动收窄的联合分支：
  - `validated.ok === false`
  - `parsed.ok === false`
  - `pathInfo.ok === false`
- 修正多个 Node/Web shim 的错误对象扩展类型：
  - `process` / `worker_threads` / request timeout
- 修复多个过时或错误的函数契约：
  - `slide-agent` 中 async realpath 返回值注释错误
  - `planning-phase-helpers` / `edit-agent-loop` 缺失 options 字段
  - `worker-factory` 返回的并非单一 DOM Worker，而是受管的跨运行时 worker
  - `bm25` stopwords 改为 `ReadonlySet` 契约，避免把只读集合硬写成可变 `Set`

### 当前结果

- `npx tsc -p js/agents/tsconfig.json --pretty false`
  - 诊断数从 **146** 降到 **85**
  - 单轮再减少 **61** 条

### 验证

已通过的窄回归：

- `tests/unit/agents/runtime/core/worker-factory.test.js`
- `tests/unit/agents/runtime/core/worker-rpc.test.js`
- `tests/unit/agents/sdk/http/request-handler.test.js`
- `tests/unit/agents/mcp/resource-manager.test.js`
- `tests/unit/agents/stages/deepsearch/phases/planning-phase-helpers.test.js`
- `tests/unit/agents/stages/deepsearch/phases/planning-phase-system-prompt.test.js`
- `tests/unit/agents/skills/manager.test.js`
- `tests/integration/agents/skills.test.js`
- `tests/integration/agents/skills-manager.test.js`
- `tests/unit/agents/stages/codesearch/indexing/symbol-indexer.test.js`
- `tests/integration/agents/stages/codesearch.test.js`
- `tests/unit/agents/stages/design/edit-agent-loop.test.js`
- `tests/integration/agents/stages/design/redos-safety.test.js`
- `tests/unit/agents/core/node-compat/shims/process.test.js`
- `tests/unit/agents/core/node-compat/shims/stream.test.js`
- `tests/unit/agents/core/node-compat/shims/https.test.js`
- `tests/unit/agents/core/sandbox/iframe-eval-bridge.test.js`
- `tests/unit/agents/core/webruntime/hmr.test.js`
- `tests/unit/agents/plugins/side-effects/side-effect-journal.test.js`
- `js/agents/core/sandbox/__tests__/skill-sandbox-resource-limits.test.js`
- `js/agents/core/sandbox/__tests__/skill-sandbox-unified-comlink.test.js`

### 下一步

继续优先扫剩余 `2 diagnostics` 的文件，按最小 diff 批量收口：

1. `js/agents/core/node-compat/npm/resolver.js`
2. `js/agents/core/node-compat/shims/{buffer,dns,module,util,ws,zlib}.js`
3. `js/agents/core/sandbox/{create-sandbox,skill-executor-core,skill-validation,system/seatbelt}.js`
4. `js/agents/runtime/core/{agent-coordination,python-adapter,scheduler,vfs-proxy-client}.js`
5. `js/agents/plugins/telemetry/runstore-telemetry.js`

## 14. 第 13 轮，继续收口剩余热点（2026-03-08）

这一轮继续针对剩余 1~2 条诊断的文件做“边界收窄 + 契约补全”，没有通过简化逻辑来换绿灯。

### 本轮处理文件

- `js/agents/core/crdt/document.js`
- `js/agents/core/node-compat/npm/resolver.js`
- `js/agents/core/node-compat/polyfills/text-decoder.js`
- `js/agents/core/node-compat/shims/{dns,module,util,ws,zlib,events}.js`
- `js/agents/core/sandbox/skill-sandbox.js`
- `js/agents/core/sandbox/skill-validation.js`
- `js/agents/llm/overflow-recovery.js`
- `js/agents/plugins/coordination/process-coordinator.js`
- `js/agents/plugins/telemetry/runstore-telemetry.js`
- `js/agents/runtime/core/python-adapter.js`
- `js/agents/runtime/core/vfs-proxy-client.js`
- `js/agents/runtime/tools/platform/browser.js`
- `js/agents/sdk/http/{browser-server,node-server}.js`
- `js/agents/shared/utils/token-cache.js`
- `js/agents/stages/codesearch/phases/planning-phase.js`
- `js/agents/stages/deepsearch/subagents.js`
- `js/agents/stages/deepsearch/tools/task/handler.js`
- `js/agents/vfs/vfs-sync-protocol.js`

### 这轮做了什么

- 补齐多处错误对象扩展字段：`code/protocol/hostname/path`
- 修正多处 browser/node fallback 的 `Buffer` 使用方式，避免直接依赖未收窄的全局构造器
- 给 `overflow-recovery`、`process-coordinator`、`planning-phase` 等位置加局部精确收窄，避免在 `object` / `unknown` 上直接取字段
- 给 `runstore-telemetry`、`task/handler` 补充缺失的返回/记录契约字段
- 修正 `browser-server` / `node-server` 对 `createRequestHandler().dispose()` 的静态契约
- 把 `deepsearch/subagents` 的 backpressure 调用改成现有契约接受的参数，不改行为目标

### 当前结果

- `npx tsc -p js/agents/tsconfig.json --pretty false`
  - 诊断数从 **85** 降到 **40**
  - 单轮再减少 **45** 条

### 验证

已通过的窄回归：

- `tests/unit/agents/sdk/http/browser-server.test.js`
- `tests/unit/agents/sdk/http/node-server.test.js`
- `tests/unit/agents/shared/utils/token-cache.test.js`
- `tests/unit/agents/stages/codesearch/phases/planning-phase.test.js`
- `tests/integration/agents/stages/codesearch.test.js`
- `tests/integration/agents/skills-manager.test.js`
- `tests/unit/agents/core/node-compat/shims/util.test.js`
- `tests/unit/agents/core/node-compat/shims/ws.test.js`
- `tests/unit/agents/core/node-compat/shims/zlib.test.js`
- `tests/unit/agents/core/node-compat/shims/dns.test.js`
- `tests/unit/agents/core/node-compat/shims/module.test.js`
- `tests/unit/agents/core/node-compat/shims/events.test.js`
- `tests/unit/agents/core/crdt/document.test.js`
- `tests/unit/agents/vfs/vfs-sync-protocol.test.js`

### 下一步

剩余热点主要集中在：

1. `js/agents/core/node-compat/shims/buffer.js`
2. `js/agents/core/sandbox/create-sandbox.js`
3. `js/agents/core/sandbox/system/seatbelt.js`
4. `js/agents/core/webruntime/sw-handler.js`
5. `js/agents/runtime/core/{agent-coordination,scheduler}.js`
6. 多个只剩 1 条诊断的边角文件
