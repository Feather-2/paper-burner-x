# js/agents 模块拆分与测试遗漏复查（2026-03-08）

> 这是在以下文档基础上的再复查：
>
> - `docs/tests/js-agents-test-gap-audit-2026-03-08.md`
> - `docs/tests/js-agents-test-backlog-2026-03-08.md`
> - `docs/tests/js-agents-test-architecture-audit-2026-03-08.md`
> - `docs/tests/js-agents-test-gap-supplement-2026-03-08.md`
>
> 本文档专门回答你最新提出的问题：
>
> 1. 还有没有遗漏的细节？
> 2. 有没有模块拆分得不好，导致前面即使做了审计仍然容易漏？
> 3. 哪些地方不只是“缺测试”，而是**测试入口组织方式本身就不合理**？

---

## 1. 复查结论先说

经过这轮复查，可以明确说：

- 前面几轮文档已经覆盖了大部分**显性缺口**；
- 但 `js/agents` 里仍然存在一批**结构性遗漏源**，它们并不是简单的“某个文件没测”，而是：
  1. **聚合入口太多**
  2. **helpers / bridges / handlers 太多**
  3. **某些目录没有自己的测试入口语义**
  4. **个别目录虽然复杂，但没有子层级文档或测试组织锚点**

所以现在最重要的补充结论是：

> `js/agents` 的问题不只是测试覆盖率不足，还是**模块组织方式让测试容易遗漏**。

---

## 2. 这轮复查新增的结构性事实

### 2.1 大目录很多，但“目录级测试锚点”很弱

按 `depth<=2` 统计，以下目录源码很多，但目录本身没有直接近源测试文件：

| 目录 | 源码文件数 | 子目录数 | 说明 |
|---|---:|---:|---|
| `js/agents/runtime/core` | 46 | 9 | 最大的核心执行层之一 |
| `js/agents/shared/utils` | 29 | 0 | 基础工具极多，容易成为隐性耦合中心 |
| `js/agents/plugins/memory` | 23 | 1 | 长状态 / 检索 / L3 存储都在这里 |
| `js/agents/mcp` | 22 | 0 | 资源/传输/代理/内容抽取混在同层 |
| `js/agents/vfs` | 21 | 0 | 后端与协议都聚在一个平面目录 |
| `js/agents/core/sandbox` | 18 | 2 | backend / policy / bridge / pool 混合 |
| `js/agents/ingest/adapters` | 14 | 0 | 适配器多，但测试组织可再细化 |
| `js/agents/stages/deepsearch` | 13 | 7 | 阶段+工具+内部状态共存 |
| `js/agents/sdk` | 13 | 2 | SDK 入口层明显偏薄 |
| `js/agents/runtime/tools` | 13 | 1 | 执行器与平台封装共存 |

这说明一个问题：

- 现在测试更多是放在 `tests/unit/agents/**` / `tests/integration/agents/**`
- 但目录本身没有“就地锚点”，所以当模块膨胀时，很容易失去测试可见性

### 2.2 聚合入口文件异常多

全量扫描发现：

- `index.js`：**52** 个
- `*helper*`：**20** 个
- `*handler*`：**23** 个
- `*bridge*`：**6** 个
- `*adapter*`：**10** 个
- `*constants*`：**10** 个

这类文件本身就是最容易漏测的一类，因为它们常常：

- 不是核心业务实现
- 但承担了重要路由 / 拼装 / 聚合职责
- 既容易被认为“不值得单测”，又容易在重构时偷偷漂移

### 2.3 存在“复杂目录但缺少局部说明文档/锚点”的地方

扫描后发现，以下目录本身不小，但没有局部 `CLAUDE.md` 锚点：

| 目录 | 文件数 | 问题 |
|---|---:|---|
| `js/agents/sdk/http` | 6 | 对外 HTTP 入口很重要，但没有局部文档锚点 |
| `js/agents/plugins/context` | 3 | 不是很大，但上下文折叠/IO 逻辑重要 |

这类目录的风险在于：

- 缺局部文档 → 更不容易形成局部测试策略
- 尤其像 `sdk/http`，它应该天然有自己的 smoke / integration 测试分层

---

## 3. 新增判断：哪些模块“分得不够好”

这里的“分得不好”不是说架构错误，而是说：

> **从测试与维护角度看，模块边界还不够利于建立稳定测试网。**

### 3.1 `runtime/core`：职责切片存在，但“测试入口”还不够显式

#### 现象

- `agent-loop-*`
- `orchestrator-*`
- `errors/*`
- `api/*`
- `context/*`
- `exec/*`
- `constants/*`

这些切片已经做了代码拆分，但测试组织还没有完全跟上。

#### 问题

- 从代码看是切开的
- 从测试看仍然容易被当成“大 runtime”一起看
- 导致：
  - 哪个切片没测不容易一眼看出
  - stale 测试更容易滞后

#### 建议

`runtime/core` 后续补测时必须按以下二级主题分批，而不是按单文件乱补：

1. agent loop slices
2. orchestrator slices
3. worker stack
4. api/context
5. error taxonomy / aggregation

### 3.2 `core/node-compat`：这是一个“超大兼容层域”，不该再被当成单一模块

#### 现象

这里已经被拆成：

- `npm/*`
- `polyfills/*`
- `shims/*`
- `require.js`
- `create-node-env.js`
- `sandbox-tool.js`
- `module-resolver.js`

#### 问题

虽然目录结构存在，但测试视角仍然过于粗糙。  
目前它更像一个“巨型兼容域”，而不是几个清晰测试域。

#### 建议

后续在测试 backlog 里，必须把它再拆成：

1. `node-compat/shims`
2. `node-compat/npm`
3. `node-compat/env+require`
4. `node-compat/sandbox-tool`

否则会继续遗漏。

### 3.3 `stages/deepsearch`：工具 handler 太多，业务职责被“工具目录树”冲淡

#### 现象

`stages/deepsearch/tools/*/handler.js` 数量很多，且功能分散。

#### 问题

- 目录层次看起来清楚
- 但测试层次并没有同步映射到这些 handler
- 结果就是：主流程有测试，局部 handler 很容易漏

#### 建议

后续应把 deepsearch 的测试结构也分层：

1. loop / state
2. phases
3. tools handlers
4. report generation
5. source / artifact / task management

### 3.4 `mcp`：平面目录过重，测试入口不够自然

#### 现象

`js/agents/mcp` 基本是平面目录，里面有：

- transport
- proxy
- provider
- resource manager
- content extractor/sanitizer/helpers

#### 问题

从测试角度不够友好：

- transport 与 provider 与 content logic 都在同层
- 容易导致“测了一个 integration test 就感觉都测了”

#### 建议

如果不改代码结构，至少测试结构要强制拆成：

- provider tests
- transport tests
- resource tests
- content extraction/sanitization tests

### 3.5 `vfs`：单目录承载过多后端与协议

#### 现象

`js/agents/vfs` 同层放了：

- backend（memory/opfs/storage/node）
- protocol（sync/delta/checkpoints）
- path/glob/file-lock 等基础件

#### 问题

- 对使用者很方便
- 对测试规划不友好
- 因为 backend 与 protocol 的测试维度完全不同

#### 建议

测试上必须强制区分两类：

1. **backend consistency**
2. **protocol correctness**

### 3.6 `sdk`：入口层职责清晰，但“示例/便利封装”被低估

#### 现象

- `sdk/http`
- `sdk/examples`
- `AgentBuilder`
- `agent-factory`
- `convenience`

#### 问题

SDK 层通常被误认为“只是薄封装”，但它是**用户真实接触面**。  
这里的任何漂移，都会直接影响使用体验。

#### 建议

SDK 测试不该只做功能测试，还要做：

- export surface 测试
- parameter shape compatibility 测试
- example smoke 测试

---

## 4. 新增遗漏细节：哪些东西前面文档没强调够

### 4.1 不是所有遗漏都应归到“单元测试缺口”

有一批文件其实更适合：

- export surface 测试
- contract 测试
- smoke 测试
- fixture-based regression 测试

典型包括：

- `index.js` 聚合出口
- `constants.js`
- `helpers.js`
- `bridge.js`
- `adapter.js`

也就是说，前面如果把这些都粗暴归成“单元测试缺失”，其实是不够精确的。

### 4.2 `sdk/http` 是一个明显被低估的测试域

这个目录：

- 没有局部 `CLAUDE.md`
- 文件数 6
- 是真实入口层

前面的文档提到 HTTP API，但还不够强调：

> 这里应该被单独视为一个**一级测试域**。

它至少需要：

- request parsing unit tests
- browser server integration
- node server integration
- stream route smoke/E2E

### 4.3 `plugins/context` 被低估

文件不多，但它承载：

- fold
- io
- index aggregation

这类上下文聚合逻辑很容易出现“看似小，但一错就污染全局”的问题。  
前面文档提到它，但没有足够强调其“高杠杆性”。

---

## 5. 这轮复查后的修正建议

### 5.1 文档层面的修正

后续文档不应只保持三类（gap/backlog/architecture），而应明确形成下面五类：

1. **Gap Audit** — 缺什么
2. **Backlog** — 怎么补
3. **Architecture Audit** — 系统怎么分层
4. **Gap Supplement** — 映射盲区补编
5. **Module Structure Check** — 模块拆分与测试入口质量复查（本文）

### 5.2 执行层面的修正

后续补测试时，应增加一个新过滤条件：

> 不只问“这个文件有没有测试”，还要问“这个文件该由哪种测试来测”。

比如：

- `index.js` → export surface
- `helpers.js` → unit + focused regression
- `handler.js` → unit + integration chain
- `bridge.js` → integration + protocol
- `sdk/http/*` → integration + smoke

### 5.3 优先级修正

在原先 P0/P1/P2 之外，再加一个维度：

- **S0（结构性遗漏）**：映射盲区 + 模块拆分不利于测试的区域

S0 目标包括：

- `core/node-compat`
- `runtime/core`
- `stages/deepsearch/tools/*`
- `mcp`
- `sdk/http`
- `vfs`

---

## 6. 最终结论

你这次担心“是不是还有遗漏的细节、是不是有模块分得不好”，这个担心是成立的。  
我这轮复查之后，新的结论是：

1. **前面的分析不是错，但确实还不够全**
2. **现在最容易继续漏的，不是某一个业务文件，而是：**
   - 未进入映射口径的文件
   - 聚合入口文件
   - helper / bridge / handler 类型文件
   - 目录结构本身不利于测试规划的模块
3. **后续测试补齐不能只看 coverage 和 gap，要同时看“模块拆分质量”**

也就是说，现在我们对 `js/agents` 的测试规划，已经不仅仅是“补测试”，而是：

> **重新建立一套能覆盖分层、能力域、入口面、映射盲区的测试组织方式。**

这才算真正把 `js/agents` 看透。
