# js/agents 测试缺口摸排与计划（2026-03-08）

## 结论先说

当前 `js/agents` 的代码质量基线已经稳定：

- `npx tsc -p js/agents/tsconfig.json --pretty false` → **0 diagnostics**
- `npm run test:agents` → **20058 / 0 fail**

但测试结构仍然存在明显的“倒挂”问题：

1. **用例总数很高，但并不等于高价值覆盖**。
2. **单元测试缺口仍然成片存在**，尤其是 `stages`、`runtime`、`plugins`、`sdk`。
3. **已有测试中有一部分已经“过时”**：源码契约、执行路径或边界已经变化，但关联测试还停留在旧形态，只能覆盖局部。
4. **自动化冒烟 / E2E 明显偏少**，当前更多是“单元 + 集成很强，端到端验证很薄”。

这份文档目标不是追求一个漂亮覆盖率数字，而是回答三个问题：

- 哪些文件还**没有单元测试**或**关联测试已经过时**；
- 哪些**集成测试**应该优先补；
- 目前 **smoke / E2E** 的现状和缺口在哪里。

---

## 统计口径与数据来源

本次摸排使用以下数据源：

- 当前工作树源码：`js/agents/**`
- 当前测试目录：
  - `tests/unit/agents/**`
  - `tests/integration/agents/**`
  - `tests/smoke/**`
  - `tests/e2e/**`
  - `js/agents/**/*.{test,spec}.js`
- 测试映射产物：`.test-map.json`
- 当前完整回归基线：`npm run test:agents`

### 注意

- `.test-map.json` 给出的“untested/stale”是**最有用的结构化线索**，但它本质上是映射产物，不等于语义级覆盖证明。
- 因此，这里的“未覆盖”表示：**没有被当前映射系统识别到有效单元/近源测试保护**；
  “过时”表示：**已有关联测试，但从映射系统看已与源码变化不同步**。

---

## 一、总体进展概览

### 1. 源码 / 测试规模

- `js/agents` 下静态扫描到的 `.js` 文件：**692**
- 当前 `tests/** + js/agents/**` 中与 agents 相关的自动化测试文件：**881**

### 2. `.test-map.json` 识别到的可映射源码覆盖情况

- 可映射源码文件：**543**
- 已覆盖：**370**
- 未覆盖：**124**
- 过时：**29**
- 映射覆盖率：**68.1%**

### 3. 自动化测试层级数量

- `tests/unit/agents`：**694** 个测试文件
- `tests/integration/agents`：**110** 个测试文件
- `tests/smoke`：**1** 个 smoke 文件
- `tests/e2e`：**1** 个自动化 E2E 文件
- `js/agents/**/*test.js`：**12** 个近源测试文件

### 4. 关键判断

- **单元测试是主力**，数量非常多；
- **集成测试已经有规模**，但分布不均；
- **smoke / E2E 明显不足**，目前只能算“有入口，没有体系”；
- 高风险模块中，**`stages` / `runtime` / `plugins` / `sdk`** 的单测缺口最值得优先补。

---

## 二、单元测试：缺失与过时文件清单

### 1. 按模块汇总

| 模块 | 未覆盖 | 过时 | 风险说明 |
|---|---:|---:|---|
| `stages` | 26 | 7 | 业务阶段复杂、状态机和降级路径多，最容易出现“类型绿灯但行为回归” |
| `runtime` | 18 | 7 | 核心执行路径，任何偏差都会放大到多模块 |
| `plugins` | 17 | 3 | 持久化、上下文、服务注入与 telemetry 耦合高 |
| `sdk` | 12 | 0 | 对外入口层覆盖偏薄，容易出现便利 API 漂移 |
| `mcp` | 9 | 0 | 工具/资源/订阅流较多，当前单测保护不足 |
| `shared` | 8 | 0 | 基础设施模块少量缺口会被全局放大 |
| `core` | 7 | 3 | 沙箱/归档/兼容层仍有边界未充分保护 |
| `vfs` | 6 | 0 | 后端多态实现较多，建议补接口一致性测试 |
| `retrieval` | 4 | 1 | 嵌入、向量、检索缓存仍有盲区 |
| `llm` | 3 | 3 | fallback / health / image provider 等分支存在缺口 |
| `skills` | 2 | 2 | manager/registry 有测试，但仓库技能资产不在本清单内 |

### 2. 优先级判断

#### P0：应立即补测的未覆盖文件

这些文件要么是高耦合执行中枢，要么最近才修过真实 bug / TSC 热点：

- `js/agents/stages/deepsearch/deepsearch-agent-loop.js`
- `js/agents/stages/deepsearch/phases/execution-phase.js`
- `js/agents/stages/deepsearch/phases/writing-phase.js`
- `js/agents/stages/design/model.js`
- `js/agents/stages/design/generators/design-system-generator.js`
- `js/agents/runtime/core/orchestrator.js`
- `js/agents/runtime/core/python-adapter.js`
- `js/agents/runtime/core/api/stage-api-factory.js`
- `js/agents/runtime/core/context/unified-agent-context.js`
- `js/agents/runtime/core/vfs-proxy-host.js`
- `js/agents/plugins/services/vfs.js`
- `js/agents/plugins/telemetry/{cost-aggregator,token-tracker}.js`

#### P1：应优先更新的过时测试关联文件

这些文件不是“完全没测”，而是**测试可能已经不再覆盖现在最危险的行为**：

- `js/agents/runtime/core/tool-registry.js`
- `js/agents/runtime/core/worker-rpc.js`
- `js/agents/runtime/tools/tool-executor.js`
- `js/agents/stages/design/agent-loop.js`
- `js/agents/stages/design/generators/batch-generator.js`
- `js/agents/stages/codesearch/code-tools.js`
- `js/agents/core/event-bus.js`
- `js/agents/core/di/defaults.js`
- `js/agents/llm/model-router.js`

### 3. 完整清单（按模块分组）

下面清单是本次摸排的完整落单结果。

### stages

- 未覆盖单元测试文件：26
- 过时测试文件：7

**未覆盖**

- `js/agents/stages/codesearch/prompts.js`
- `js/agents/stages/codesearch/test-agent-loop.js`
- `js/agents/stages/codesearch/test.js`
- `js/agents/stages/deepsearch/capabilities-loader.js`
- `js/agents/stages/deepsearch/deepsearch-agent-loop.js`
- `js/agents/stages/deepsearch/internal/model-response-handler.js`
- `js/agents/stages/deepsearch/internal/shared-context.js`
- `js/agents/stages/deepsearch/internal/writing-phase-handler.js`
- `js/agents/stages/deepsearch/phases/execution-phase.js`
- `js/agents/stages/deepsearch/phases/writing-phase.js`
- `js/agents/stages/deepsearch/subagents.js`
- `js/agents/stages/deepsearch/todos.js`
- `js/agents/stages/deepsearch/tools/write-report/report-citations.js`
- `js/agents/stages/deepsearch/tools/write-report/report-formatting.js`
- `js/agents/stages/deepsearch/tools/write-report/report-template.js`
- `js/agents/stages/design/design-tools.js`
- `js/agents/stages/design/generators/design-system-generator.js`
- `js/agents/stages/design/generators/layout-protocol.js`
- `js/agents/stages/design/image/visual-renderer.js`
- `js/agents/stages/design/internal/deck-editor.js`
- `js/agents/stages/design/internal/design-loop-types.js`
- `js/agents/stages/design/internal/screenshot-stitcher.js`
- `js/agents/stages/design/internal/tool-handler.js`
- `js/agents/stages/design/model.js`
- `js/agents/stages/design/shared/safe-emit.js`
- `js/agents/stages/design/subagents/asset-registry.js`

**过时/需更新**

- `js/agents/stages/codesearch/code-tools.js` → 关联测试：`tests/unit/agents/stages/codesearch/code-tools.test.js`、`tests/integration/agents/stages/codesearch.test.js`
- `js/agents/stages/design/agent-loop.js` → 关联测试：`tests/unit/agents/stages/design/agent-loop.test.js`、`tests/unit/agents/stages/design/index.test.js`、`tests/integration/agents/stages/design/backtrack-layout.test.js`
- `js/agents/stages/design/edit-mode/edit-loop.js` → 关联测试：`tests/unit/agents/stages/design/edit-mode/edit-loop.test.js`
- `js/agents/stages/design/generators/batch-generator.js` → 关联测试：`tests/unit/agents/stages/design/index.test.js`
- `js/agents/stages/design/internal/phases/generating-phase.js` → 关联测试：`tests/unit/agents/stages/design/internal/phases/generating-phase.test.js`、`tests/unit/agents/stages/design/internal/phases/index.test.js`
- `js/agents/stages/design/internal/phases/preparation-phase.js` → 关联测试：`tests/unit/agents/stages/design/internal/phases/index.test.js`、`tests/unit/agents/stages/design/internal/phases/preparation-phase.test.js`
- `js/agents/stages/design/internal/state-manager.js` → 关联测试：`tests/unit/agents/stages/design/internal/state-manager.test.js`

### runtime

- 未覆盖单元测试文件：18
- 过时测试文件：7

**未覆盖**

- `js/agents/runtime/core/api/stage-api-factory.js`
- `js/agents/runtime/core/context/snapshotable.js`
- `js/agents/runtime/core/context/unified-agent-context.js`
- `js/agents/runtime/core/exec/command-executor.browser.js`
- `js/agents/runtime/core/exec/command-executor.node.js`
- `js/agents/runtime/core/js-sandbox-worker.js`
- `js/agents/runtime/core/js-sandbox-worker.node.js`
- `js/agents/runtime/core/mechanisms.js`
- `js/agents/runtime/core/micro-kernel.js`
- `js/agents/runtime/core/orchestrator.js`
- `js/agents/runtime/core/python-adapter.js`
- `js/agents/runtime/core/resource-guard.js`
- `js/agents/runtime/core/vfs-proxy-host.js`
- `js/agents/runtime/events/event-bus.js`
- `js/agents/runtime/tools/python-runtime-worker.js`
- `js/agents/runtime/tools/tool-executor-webworker.js`
- `js/agents/runtime/tools/tool-executor-worker.js`
- `js/agents/runtime/tools/tool-quotas.js`

**过时/需更新**

- `js/agents/runtime/core/agent-loop-message-handling.js` → 关联测试：`tests/unit/agents/runtime/core/agent-loop-message-handling.test.js`
- `js/agents/runtime/core/js-adapter.js` → 关联测试：`tests/unit/agents/runtime/core/js-adapter.test.js`
- `js/agents/runtime/core/tool-registry.js` → 关联测试：`tests/unit/agents/runtime/core/tool-registry.test.js`、`tests/integration/agents/runtime/core.test.js`
- `js/agents/runtime/core/worker-rpc.js` → 关联测试：`tests/unit/agents/runtime/core/worker-rpc.test.js`
- `js/agents/runtime/hooks/hook-runner.js` → 关联测试：`tests/unit/agents/runtime/core/tool-registry.test.js`、`tests/unit/agents/runtime/hooks/hook-runner.test.js`、`tests/unit/agents/runtime/hooks/index.test.js`
- `js/agents/runtime/tools/platform/node.js` → 关联测试：`tests/unit/agents/runtime/tools/platform/node.test.js`
- `js/agents/runtime/tools/tool-executor.js` → 关联测试：`tests/integration/agents/core/sandbox/tool-executor.error-handling.test.js`

### plugins

- 未覆盖单元测试文件：17
- 过时测试文件：3

**未覆盖**

- `js/agents/plugins/compression/impl/adaptive-zone-manager.js`
- `js/agents/plugins/compression/impl/cicada-compressor.js`
- `js/agents/plugins/compression/impl/compression.worker.js`
- `js/agents/plugins/compression/impl/context-predictor.js`
- `js/agents/plugins/memory/retrieval-engine.js`
- `js/agents/plugins/memory/unified-memory-store.js`
- `js/agents/plugins/memory/unified-memory-store.utils.js`
- `js/agents/plugins/policy/engine.js`
- `js/agents/plugins/policy/manager.js`
- `js/agents/plugins/policy/match.js`
- `js/agents/plugins/policy/store.js`
- `js/agents/plugins/routing/performance-router.js`
- `js/agents/plugins/services/scheduler.js`
- `js/agents/plugins/side-effects/side-effect-journal.js`
- `js/agents/plugins/transports/index.browser.js`
- `js/agents/plugins/transports/index.js`
- `js/agents/plugins/transports/process-transport.js`

**过时/需更新**

- `js/agents/plugins/memory/memory-store.impl.core.js` → 关联测试：`tests/unit/agents/plugins/memory/memory-store.impl.core.test.js`
- `js/agents/plugins/memory/memory-store.impl.l3.js` → 关联测试：`tests/unit/agents/plugins/memory/memory-store.impl.l3.test.js`
- `js/agents/plugins/plan/plan-store.js` → 关联测试：`tests/unit/agents/plugins/plan/index.test.js`、`tests/unit/agents/plugins/plan/plan-store.test.js`

### sdk

- 未覆盖单元测试文件：12
- 过时测试文件：0

**未覆盖**

- `js/agents/sdk/AgentBuilder.js`
- `js/agents/sdk/DefaultAgentLoop.js`
- `js/agents/sdk/SoftBacktrackManager.js`
- `js/agents/sdk/agent-config.js`
- `js/agents/sdk/agent-factory.js`
- `js/agents/sdk/config-loader.js`
- `js/agents/sdk/examples/backtrack-usage.js`
- `js/agents/sdk/examples/basic-usage.js`
- `js/agents/sdk/examples/memory-recall.js`
- `js/agents/sdk/examples/subagent-usage.js`
- `js/agents/sdk/examples/webarranger-resilience.js`
- `js/agents/sdk/index.js`

### core

- 未覆盖单元测试文件：7
- 过时测试文件：3

**未覆盖**

- `js/agents/core/archive/archive-core.js`
- `js/agents/core/archive/storage-adapter.js`
- `js/agents/core/kernel-compat.js`
- `js/agents/core/sandbox/plugin.js`
- `js/agents/core/sandbox/pool.js`
- `js/agents/core/sandbox/system/index.js`
- `js/agents/core/secure-plugin-loader.js`

**过时/需更新**

- `js/agents/core/di/defaults.js` → 关联测试：`tests/unit/agents/core/di/defaults.test.js`、`tests/unit/agents/core/di/index.test.js`
- `js/agents/core/event-bus-utils.js` → 关联测试：`tests/unit/agents/core/event-bus-subscriptions.test.js`、`tests/unit/agents/core/event-record.test.js`
- `js/agents/core/event-bus.js` → 关联测试：`tests/unit/agents/core/event-bus.test.js`、`tests/unit/agents/core/kernel.test.js`、`tests/unit/agents/core/message-bus.test.js`

### mcp

- 未覆盖单元测试文件：9
- 过时测试文件：0

**未覆盖**

- `js/agents/mcp/http-mcp-transport.js`
- `js/agents/mcp/http-proxy.js`
- `js/agents/mcp/index.js`
- `js/agents/mcp/resource-manager.js`
- `js/agents/mcp/smart-content-extractor.js`
- `js/agents/mcp/sse-mcp-transport.js`
- `js/agents/mcp/sse.js`
- `js/agents/mcp/stdio-mcp-provider.js`
- `js/agents/mcp/stdio-mcp-transport.js`

### shared

- 未覆盖单元测试文件：8
- 过时测试文件：0

**未覆盖**

- `js/agents/shared/base/disposable-base.js`
- `js/agents/shared/parser/tree-sitter-wasm.js`
- `js/agents/shared/tokenizers/adaptive-token-counter.js`
- `js/agents/shared/utils/event-emitter.js`
- `js/agents/shared/utils/file-watcher.js`
- `js/agents/shared/utils/lru-cache.js`
- `js/agents/shared/utils/stage-api.js`
- `js/agents/shared/utils/wasm-support.js`

### llm

- 未覆盖单元测试文件：3
- 过时测试文件：3

**未覆盖**

- `js/agents/llm/internal/config-parser.js`
- `js/agents/llm/internal/fallback.js`
- `js/agents/llm/internal/health-manager.js`

**过时/需更新**

- `js/agents/llm/image-provider.js` → 关联测试：`tests/unit/agents/llm/image-provider.test.js`、`tests/unit/agents/llm/index.test.js`
- `js/agents/llm/model-router.js` → 关联测试：`tests/unit/agents/llm/index.test.js`、`tests/unit/agents/llm/model-router.test.js`、`tests/integration/agents/llm/model-router.token-tracker.vitest.test.js`
- `js/agents/llm/ppt-model-bridge.js` → 关联测试：`tests/unit/agents/llm/index.test.js`

### vfs

- 未覆盖单元测试文件：6
- 过时测试文件：0

**未覆盖**

- `js/agents/vfs/diff.worker.js`
- `js/agents/vfs/fs-adapter.js`
- `js/agents/vfs/glob.worker.js`
- `js/agents/vfs/index.js`
- `js/agents/vfs/operations.js`
- `js/agents/vfs/vfs-scan.worker.js`

### ingest

- 未覆盖单元测试文件：2
- 过时测试文件：3

**未覆盖**

- `js/agents/ingest/adapters/node-io.js`
- `js/agents/ingest/asset-understanding.js`

**过时/需更新**

- `js/agents/ingest/adapters/docx.js` → 关联测试：`tests/unit/agents/ingest/adapters/docx.test.js`、`tests/unit/agents/ingest/index.test.js`
- `js/agents/ingest/adapters/markdown.js` → 关联测试：`tests/unit/agents/ingest/adapters/markdown.test.js`、`tests/unit/agents/ingest/index.test.js`
- `js/agents/ingest/adapters/pptx.js` → 关联测试：`tests/unit/agents/ingest/index.test.js`

### retrieval

- 未覆盖单元测试文件：4
- 过时测试文件：1

**未覆盖**

- `js/agents/retrieval/embeddings/hnsw-lite.js`
- `js/agents/retrieval/mmr.js`
- `js/agents/retrieval/readaround.js`
- `js/agents/retrieval/toc-builder.js`

**过时/需更新**

- `js/agents/retrieval/embeddings/embedding-service.js` → 关联测试：`tests/unit/agents/plugins/memory/index.test.js`、`tests/unit/agents/plugins/memory/retrieval-engine.test.js`、`tests/unit/agents/retrieval/embeddings/embedding-service.test.js`

### cli

- 未覆盖单元测试文件：4
- 过时测试文件：0

**未覆盖**

- `js/agents/cli/demo.js`
- `js/agents/cli/model-client.js`
- `js/agents/cli/test-deepsearch.js`
- `js/agents/cli/test-memory.js`

### skills

- 未覆盖单元测试文件：2
- 过时测试文件：2

**未覆盖**

- `js/agents/skills/index.js`
- `js/agents/skills/loader.node.js`

**过时/需更新**

- `js/agents/skills/render.js` → 关联测试：`tests/unit/agents/skills/manager.test.js`、`tests/unit/agents/skills/render.test.js`
- `js/agents/skills/sandbox-adapter.js` → 关联测试：`tests/unit/agents/skills/sandbox-adapter.test.js`

### eval

- 未覆盖单元测试文件：3
- 过时测试文件：0

**未覆盖**

- `js/agents/eval/graders/content.js`
- `js/agents/eval/index.js`
- `js/agents/eval/types.js`

### index.js

- 未覆盖单元测试文件：1
- 过时测试文件：0

**未覆盖**

- `js/agents/index.js`

### prompts

- 未覆盖单元测试文件：1
- 过时测试文件：0

**未覆盖**

- `js/agents/prompts/prompt-loader.js`

### storage

- 未覆盖单元测试文件：1
- 过时测试文件：0

**未覆盖**

- `js/agents/storage/run-store-crud.js`

### testing

- 未覆盖单元测试文件：0
- 过时测试文件：0


---

## 三、集成测试：当前进展与应补方向

### 1. 当前进展

当前 `tests/integration/agents` 一共有 **110** 个测试文件，分布如下：

| 分组 | 文件数 | 现状判断 |
|---|---:|---|
| `(root)` | 25 | 很多是横切能力与兼容性校验，价值高但不够聚焦 |
| `runtime` | 19 | 最完整，已经形成系统性回归网 |
| `stages` | 13 | 有基础，但 design / deepsearch 仍存在链路缺口 |
| `core` | 10 | 沙箱、消息总线、webruntime 有一定覆盖 |
| `ingest` | 9 | 适配器链路较完整 |
| `design` | 8 | 有关键链路，但异步/降级/多模型路由仍易回归 |
| `deepsearch` | 6 | 有核心流程，但子代理、写作阶段、恢复链路还不够 |
| `skills` | 4 | 主要覆盖 loader/manager，不等于 skill 资产和 skill 调用体系都完备 |
| `plugins` | 3 | 有事件驱动和服务层，但 persistence/recovery 仍偏薄 |
| `sdk` | 2 | 明显偏少 |
| `vfs` | 2 | 有后端验证，但跨 backend 一致性还可增强 |

### 2. 目前应该新增的集成测试

#### A. runtime 级集成测试（优先级最高）

1. **`tool-registry` × `persisted-output` × `error-boundary` 联动**
   - 目标：验证大输出、持久化失败、hook 失败、quota 决策叠加时行为一致。
2. **`worker-pool` × `worker-rpc` × `worker-factory` 故障恢复**
   - 目标：验证 worker 超时、退出、重建、队列退避、结果回填。
3. **`session-gate` × `sdk/http/*server` 并发约束**
   - 目标：验证 reject/queue 模式下 HTTP 请求级别行为。
4. **`unified-agent-context` × `stage-api-factory` × `orchestrator`**
   - 目标：验证上下文快照、子 stage 注入、runContext 传播。

#### B. design 级集成测试（高风险）

1. **`design/model` timeout + abort + late settle**
   - 这次已经证明是高回归点，应该固化成更细的行为矩阵测试。
2. **`design-system-generator` 动态/回退 双路径**
   - AI 有效输出、AI 无效输出、AI 超时、本地 fallback。
3. **`batch-generator` × `slide-agent` × `visual-subagent`**
   - 验证 slide intents、linked assets、svg/image placeholder 组合路径。
4. **`design/index.js` 对外导出面 smoke-integrated 验证**
   - 防止 aggregate export 再次冲突。

#### C. deepsearch 级集成测试（高价值）

1. **planning → execution → writing 全链路**，覆盖：
   - 正常执行
   - 中途 abort
   - tool error
   - no findings / low confidence
   - write-report fallback
2. **subagents 协作与 backpressure 行为**
3. **todo/task 相关 timeout / cancellation / result compaction**
4. **traceContext / telemetry 在 deepsearch 中的传播完整性**

#### D. sdk / mcp / vfs 集成测试（缺口明显）

1. `sdk/convenience.js` 与真实 `DesignAgentLoop` / `DeepSearchAgentLoop` 对接
2. `mcp` 资源订阅、更新通知、cache invalidation
3. `vfs/index.js` 在 browser/node backend 下接口一致性与 stat/readdir 差异处理

### 3. 集成测试整体进展判断

- **runtime**：进度最好，已接近“系统级回归网”
- **design**：有核心链路，但对竞态和 fallback 的保护还不够厚
- **deepsearch**：流程存在，阶段间/子代理/写作收尾仍可加强
- **sdk / mcp / vfs**：这是目前集成层最明显的薄弱区域

---

## 四、冒烟测试 / E2E：现状与建议

### 1. 当前自动化现状

自动化 smoke / E2E 目前只有：

- `tests/smoke/agents-startup.smoke.test.js`
- `tests/e2e/agents-basic-flow.test.js`

此外还有大量 `tests/e2e/manual/*.html`，但这些**不属于 CI 可执行自动化 E2E**，更适合人工验证和临时诊断。

### 2. 当前判断

当前 smoke / E2E 的问题不是“完全没有”，而是：

- **入口太少**
- **覆盖面太窄**
- **对关键用户路径没有形成最小闭环**

### 3. 建议新增的 smoke 测试

#### P0 smoke

1. **agents startup smoke**（已有，保留）
2. **design stage smoke**
   - 输入最小 contentPackage
   - 输出 deckHtmlDsl 可解析
3. **deepsearch stage smoke**
   - 输入最小 taskGoal
   - 能跑完整个阶段循环并输出 summary/report
4. **sdk smoke**
   - `createAgent` / `AgentBuilder` 最小可运行样例
5. **vfs smoke**
   - browser-memory / node-memory backend 最小读写往返

#### P1 smoke

6. **mcp provider smoke**
7. **tool-executor smoke**
8. **worker-pool smoke**

### 4. 建议新增的自动化 E2E

#### P0 E2E

1. **Design basic flow E2E**
   - 从输入内容到 deck package 产出
2. **DeepSearch basic flow E2E**
   - 从 query/taskGoal 到 findings/report
3. **HTTP API E2E**
   - `sdk/http/node-server` 与 `browser-server` 的最小调用流

#### P1 E2E

4. **Skill loading E2E**
   - repo/user/system 三层 skill 优先级
5. **MCP read/list/subscribe E2E**
6. **Worker sandbox E2E**

### 5. 当前冒烟 / E2E 进展判断

- **自动化 smoke：偏弱**
- **自动化 E2E：偏弱**
- **manual HTML：很多，但不应算自动化回归能力**

建议把后续目标从“多写 manual 页”转成“建立 5~8 个 CI 可跑的 smoke/E2E 关键路径”。

---

## 五、推荐的补测顺序

### 第一阶段：先补高价值单元测试

按优先级：

1. `stages/design/model.js`
2. `runtime/core/tool-registry.js`
3. `runtime/core/worker-rpc.js`
4. `runtime/core/worker-pool.js`
5. `runtime/core/api/stage-api-factory.js`
6. `runtime/core/context/unified-agent-context.js`
7. `stages/deepsearch/deepsearch-agent-loop.js`
8. `stages/deepsearch/phases/{execution-phase,writing-phase}.js`

### 第二阶段：补关键集成链路

1. runtime orchestration 链路
2. design async/fallback 链路
3. deepsearch planning→execution→writing 链路
4. sdk/mcp/vfs 组合链路

### 第三阶段：建立最小 smoke/E2E 闭环

目标不是很多，而是“关键路径最小闭环”先成立：

- startup
- design
- deepsearch
- sdk/http
- vfs

---

## 六、建议的落地方式

如果接下来要实际补测试，我建议按以下工作包切：

### Work Package A — 单元测试补口

- 输出：补齐 `P0` 单测缺口的测试文件
- 目标：减少未覆盖文件数与 stale 文件数

### Work Package B — 集成链路补强

- 输出：runtime / design / deepsearch 三条主链路的回归测试
- 目标：减少“类型过了但行为回归”的风险

### Work Package C — smoke/E2E 最小闭环

- 输出：5~8 个 CI 可运行的 smoke/E2E
- 目标：把 agents 从“代码测试强”提升到“关键路径验证完整”

---

## 七、最终判断

`js/agents` 现在的问题已经不是“能不能跑通”，而是：

- **单元测试覆盖结构不均**
- **一部分旧测试已经落后于实现**
- **高风险异步链路需要更强的行为测试**
- **smoke/E2E 自动化明显不足**

换句话说，当前阶段最值得做的，不是继续追求更多 TSC 修复，而是：

> **把测试从“数量很多”升级为“结构健康、回归有效”。**

