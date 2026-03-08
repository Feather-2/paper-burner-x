# js/agents 测试遗漏补编（2026-03-08）

> 这是对以下三份文档的补编：
>
> - `docs/tests/js-agents-test-gap-audit-2026-03-08.md`
> - `docs/tests/js-agents-test-backlog-2026-03-08.md`
> - `docs/tests/js-agents-test-architecture-audit-2026-03-08.md`
>
> 这次补编的原因很简单：
>
> **之前的分析主要依赖 `.test-map.json`，但 `.test-map.json` 本身没有覆盖 `js/agents` 的全部源码文件。**
>
> 所以如果只看前面的文档，确实仍然有可能“看起来已经很细了，但还有遗漏”。

---

## 1. 这次补编解决了什么问题

前面的几份文档，核心统计口径是 `.test-map.json`：

- 可映射源码文件：543
- 已覆盖：370
- 未覆盖：124
- 过时：29

但这次我直接对 `js/agents` 做了全量文件系统扫描，得到：

- `js/agents` 下实际 `.js` 源码文件：**692**
- `.test-map.json` 中能识别到的源码文件：**482**（按路径去重后）
- **未进入 `.test-map.json` 统计口径的源码文件：215**

也就是说：

> 之前的测试缺口审计虽然有效，但它主要覆盖的是“已进入映射体系的文件”。  
> 对于 **根本没被映射到的 215 个文件**，之前的文档是不完整的。

这是这次补编最核心的发现。

---

## 2. 为什么会出现 215 个“未纳入映射”的文件

这些文件并不都等于“完全没有测试价值”，但它们有几个共同特征：

1. **聚合出口文件**很多
   - 如 `index.js`、子模块聚合入口
2. **helper / constants / compatibility / bridge 文件**很多
   - 测试映射不一定能自动识别它们与测试的直接关系
3. **多层子目录文件**很多
   - 尤其是 `core/node-compat`、`stages/deepsearch/tools/*`、`runtime/core/*` 这类深层目录
4. **部分文件可能只被集成测试间接覆盖**
   - 但并没有被映射系统标记为“covered”

因此，这 215 个文件里既包括：

- 真正没有测试保护的文件
- 被间接覆盖但未映射到的文件
- 聚合导出/常量文件（不一定要单独写很多测试）

所以这里不能简单粗暴地说“215 个都没测”。  
更准确的说法是：

> **215 个文件没有被当前测试映射体系有效纳入，需要做第二层人工判断。**

---

## 3. 这次新增发现的高风险遗漏区

以下这些区域，在前面几份文档里**被低估了**，因为它们大量文件根本没进入 `.test-map.json` 统计口径。

### 3.1 `js/agents/core/node-compat`（65 个未映射文件）

这是目前最大的遗漏区。

包含：

- `create-node-env.js`
- `require.js`
- `sandbox-tool.js`
- `module-resolver.js`
- `npm/{index,registry,resolver,tarball}.js`
- `polyfills/*`
- `shims/*`
- `quota.js`
- `observability.js`
- `package-compatibility.js`

#### 为什么高风险

- 它不是单纯的 shim 集合，而是 **Node 兼容执行环境** 的核心能力层
- 与 sandbox、worker、require、npm install、tool execution 都有关
- 一旦这里覆盖不足，很多上层测试只是“碰巧走过”，不能证明兼容层稳定

#### 测试建议

- 拆成单独测试域：**NodeCompat Compatibility Matrix**
- 最少应覆盖：
  - `create-node-env`
  - `require`
  - `sandbox-tool`
  - `npm resolver/registry/tarball`
  - 常用 `shims/*` 的聚合兼容入口

### 3.2 `js/agents/stages/deepsearch`（26 个未映射文件）

未映射文件非常多，尤其是：

- `model.js`
- `states.js`
- `constants.js`
- `index.js`
- `planning-phase-helpers.js`
- 各种 `tools/*/handler.js`

#### 为什么高风险

前一轮我们已经知道 deepsearch 复杂，但这次确认：

> **很多 deepsearch 工具 handler 根本没有进入映射体系。**

这意味着：

- “整体有 deepsearch 集成测试” ≠ “每个 handler 有行为保护”
- `advise-task / ask-user / cross-verify / evaluate-gaps / get-task-result / manage-todos / read-doc / record-finding / refine-planning / search-docs ...` 这批 handler 里，很可能还有大量未被直接保护的分支

#### 测试建议

- 不要只测 `deepsearch-agent-loop`
- 要把 **tools/handlers** 当成独立补测批次
- 最好新增：
  - `tests/unit/agents/stages/deepsearch/tools/*.test.js`
  - 或按功能合并成 `tool-handlers.extended.test.js`

### 3.3 `js/agents/runtime/core`（19 个未映射文件）

典型遗漏：

- `agent-coordination.js`
- `agent-loop-phases.js`
- `agent-loop-status.js`
- `agent-loop-steps.js`
- `agent-loop-user-actions.js`
- `orchestrator-core.js`
- `orchestrator-helpers.js`
- `scheduling-strategies.js`
- `stage-rpc-bridge.js`
- `message-manager-helpers.js`
- `errors/*`

#### 为什么高风险

这批文件不是“边角”，而是：

- AgentLoop 的 mixin / 切片逻辑
- Orchestrator 的内核实现
- 错误分类与调度策略
- Stage RPC 桥接

也就是说，**前面看起来 runtime 测得很多，但 runtime/core 深层切片并没有完全纳入映射**。

#### 测试建议

- 把 runtime/core 进一步拆成：
  - loop lifecycle
  - orchestrator core
  - scheduling strategies
  - stage rpc bridge
  - error taxonomy / fingerprint / aggregator

### 3.4 `js/agents/core/sandbox`（17 个未映射文件）

包括：

- `constants.js`
- `index.js`
- `network-policy-utils.js`
- `resource-lock.js`
- `sandbox-interface.js`
- `skill-executor-*`
- `source-map-support.js`
- `system/network-*`
- `proxy-bridge.js`

#### 为什么高风险

这说明：

- 即使 sandbox 有很多测试，**也不代表沙箱体系内部结构真的测透了**
- 特别是 `network-policy-utils`、`proxy-bridge`、`source-map-support` 这种内部基础件，往往是最容易被漏掉的

### 3.5 `js/agents/core/webruntime`（10 个未映射文件）

包括：

- `dev-server.js`
- `index.js`
- `sandbox-deploy.js`
- `server-bridge.js`
- `sw-handler.js`
- `vfs-events.js`
- `vfs-snapshot.js`
- `worker-comlink*.js`

#### 为什么高风险

- 它们连接 browser runtime、worker、virtual http、snapshot
- 前一轮文档里提到了，但这次确认：**这些文件整体仍没有被系统性纳入测试映射**

### 3.6 `js/agents/stages/design`（9 个未映射文件）

包括：

- `constants.js`
- `index.js`
- `edit-mode/index.js`
- `subagents/index.js`
- `design-state.js`
- `design-checkpoints.js`
- `batch-generator-helpers.js`
- `react-refiner-helpers.js`

#### 为什么高风险

- design 模块我们前面关注了 `model.js`、`agent-loop.js`、generator 主链路
- 但现在看，**很多聚合入口、helper、state/checkpoint 文件仍未纳入映射**
- 这说明 design 仍然有一层“内部协作件”没有单独建立保护网

### 3.7 `js/agents/core/contracts`（7 个未映射文件）

包括：

- `agent-coordinator.js`
- `agent-message.js`
- `agent-registry.js`
- `shared-task-board.js`
- `taskboard-orchestrator-bridge.js`
- `trace-propagator.js`

#### 为什么高风险

这类文件本身就是“契约层”。  
如果契约层没有被系统性测到，就会出现：

- 实现层测试很多
- 但消息/桥接/注册表协议一漂，问题会扩散到多个模块

---

## 4. 新的结构性判断：前面几份文档仍然缺了哪一层？

前面的文档已经有：

- gap audit
- backlog
- architecture audit

但这次补编发现，还差一层：

> **“映射盲区审计”**

也就是说，现在我们至少有四个视角：

1. **缺口视角**：哪些文件未覆盖 / stale
2. **执行视角**：下一步怎么补
3. **架构视角**：系统层级和高级能力怎么拆
4. **映射盲区视角**：哪些文件根本没进入统计口径

如果没有第四层，就会出现一种错觉：

- 文档已经很细了
- 但还是漏了很多东西

你这次提醒“似乎还不全”，本质上就是把第四层问题指出来了。

---

## 5. 对后续测试规划的修正

这次补编之后，后续测试规划必须从“三层文档”升级为“四层文档”理解：

### 5.1 原有 backlog 仍然保留

`docs/tests/js-agents-test-backlog-2026-03-08.md` 仍然是可以执行的。

### 5.2 但后续执行必须额外补两类批次

#### 新批次 X：映射盲区清扫批

目标：把未进入 `.test-map.json` 的高风险文件，先建立最小测试锚点。

优先模块：

1. `core/node-compat`
2. `stages/deepsearch`
3. `runtime/core`
4. `core/sandbox`
5. `core/webruntime`
6. `stages/design`
7. `core/contracts`

#### 新批次 Y：聚合入口 / helper / index 文件补锚点

很多 `index.js` / helper 文件不需要很多测试，但需要**最小锚点测试**，否则它们会永远掉出映射体系。

典型目标：

- `stages/index.js`
- `design/index.js`
- `codesearch/index.js`
- `runtime/index.js`
- `core/index.js`
- `sdk/index.js`
- `plugins/index.js`
- `skills/index.js`
- `ingest/index.js`
- `mcp/index.js`

---

## 6. 现在最值得补充到 backlog 的新任务

### 6.1 Core / Compat / Sandbox 新任务

- `core/node-compat/create-node-env.js`
- `core/node-compat/require.js`
- `core/node-compat/sandbox-tool.js`
- `core/node-compat/npm/{resolver,registry,tarball}.js`
- `core/sandbox/network-policy-utils.js`
- `core/sandbox/resource-lock.js`
- `core/sandbox/proxy-bridge.js`
- `core/webruntime/worker-comlink.js`
- `core/webruntime/worker-comlink-node.js`
- `core/contracts/agent-message.js`
- `core/contracts/trace-propagator.js`

### 6.2 Runtime 深层切片新任务

- `runtime/core/agent-loop-phases.js`
- `runtime/core/agent-loop-steps.js`
- `runtime/core/agent-loop-user-actions.js`
- `runtime/core/orchestrator-core.js`
- `runtime/core/scheduling-strategies.js`
- `runtime/core/stage-rpc-bridge.js`
- `runtime/core/errors/{error-taxonomy,error-fingerprint,error-aggregator}.js`

### 6.3 DeepSearch Handler 新任务

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

### 6.4 Design 内部协作件新任务

- `stages/design/internal/design-state.js`
- `stages/design/internal/design-checkpoints.js`
- `stages/design/generators/batch-generator-helpers.js`
- `stages/design/refiner/react-refiner-helpers.js`
- `stages/design/subagents/index.js`

### 6.5 SDK / MCP 入口新任务

- `sdk/http/{index,request-handler,sse-writer,stream-events}.js`
- `sdk/index.js`
- `sdk/examples/*`
- `mcp/{index,http-mcp-transport,sse-mcp-transport,stdio-mcp-transport,http-proxy,resource-manager}.js`

---

## 7. 最终补充结论

你这次提醒是对的。  
如果只看之前的文档，会低估以下事实：

- 不是只有“未覆盖 / stale 文件”值得关注
- 还有大量文件根本**没进入测试映射统计口径**
- 这些文件很多恰恰位于：
  - `core/node-compat`
  - `runtime/core`
  - `core/sandbox`
  - `core/webruntime`
  - `stages/deepsearch/tools/*`

所以，**前面的分析并不是错，而是不够完整**。  
这次补编之后，测试规划才更接近“把 `js/agents` 真正看透”。

---

## 8. 建议下一步

如果接下来继续行动，我建议：

1. 不再继续泛化分析
2. 先把这份补编里的“映射盲区高风险模块”补入 backlog
3. 然后从 `core/node-compat` 和 `stages/deepsearch/tools/*` 两个最大盲区先开工

这会比继续只盯着原先的 P0 文件更完整，也更符合你这次提出的要求。
