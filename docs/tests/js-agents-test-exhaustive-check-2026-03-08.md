# js/agents 第六轮穷举复查（2026-03-08）

> 这是在前 5 轮测试审计文档基础上的“穷举式复查”。  
> 目标不是再做一份泛泛总结，而是尽量压低“还有遗漏”的概率。

前置文档：

- `docs/tests/js-agents-test-gap-audit-2026-03-08.md`
- `docs/tests/js-agents-test-backlog-2026-03-08.md`
- `docs/tests/js-agents-test-architecture-audit-2026-03-08.md`
- `docs/tests/js-agents-test-gap-supplement-2026-03-08.md`
- `docs/tests/js-agents-test-module-structure-check-2026-03-08.md`

---

## 1. 这轮复查的方法

这次不再只依赖单一来源，而是同时使用以下 5 个视角交叉验证：

1. **文件系统穷举**：直接扫描 `js/agents` 的全部源码文件
2. **测试映射**：`.test-map.json`
3. **目录级结构**：子目录、近源测试、局部 `CLAUDE.md`
4. **文件形态**：`index / helper / handler / bridge / adapter / constants`
5. **复杂度代理**：超大文件（高行数文件）

目标是回答：

- 还有没有“根本没被前几轮文档充分点名”的区域？
- 有没有目录结构本身就不利于后续补测试？
- 哪些区域即使不算“未覆盖”，也属于高风险薄弱区？

---

## 2. 最新穷举统计

### 2.1 全量规模

- `js/agents` 源码文件：**692**
- `js/agents` 近源测试文件：**12**
- 外部 agents 测试文件（`tests/unit/integration/smoke/e2e`）：**806**
- `.test-map.json` 可识别源码文件：**482**

### 2.2 关键结论

这次最关键的结论是：

> 即使在补了“映射盲区文档”之后，仍然可以从目录与文件形态上继续识别出一批**高风险但容易被忽略的测试组织问题**。

也就是说，前面 5 轮文档已经很细，但如果你要求“尽可能不漏”，这第 6 轮仍然是有必要的。

---

## 3. 这轮新增确认的高风险区域

### 3.1 `js/agents/core` 仍然是最大盲区源之一

穷举结果：

- `js/agents/core` 全树源码：**150**
- `.test-map` 已映射：**45**
- **未映射：105**

这说明一个非常直接的问题：

- 之前已经知道 `core/node-compat`、`core/sandbox`、`core/webruntime` 有盲区
- 但现在确认：**整个 core 树仍然是最容易低估的根区**

尤其是：

- `core/node-compat`：65 未映射
- `core/sandbox`：17 未映射
- `core/contracts`：7 未映射
- `core/webruntime`：10 未映射

### 3.2 `stages` 不只是大，而是“深”

- `js/agents/stages` 全树源码：**157**
- 已映射：**112**
- 未映射：**45**

其中尤其值得警惕：

- `stages/deepsearch`：26 未映射
- `stages/design`：9 未映射
- `stages/codesearch`：7 未映射

这说明：

> stages 的问题不只是业务复杂，而是**层级深、局部 handler 多、内部子目录多**。  
> 如果测试规划只看 stage 主循环，一定会漏内部阶段和工具处理器。

### 3.3 `runtime` 比之前看起来还要“切片化”，因此也更容易漏

- `js/agents/runtime` 全树源码：**95**
- 已映射：**70**
- 未映射：**25**

其中：

- `runtime/core`：19 未映射
- `runtime/tools`：2 未映射
- `runtime/hooks`：仍有 stale

前面的文档已经指出 runtime/core 要拆成子域测试，这次穷举说明这个判断不是建议，而是**必须**。

### 3.4 `sdk/http` 是目前最典型的“结构性低估区”

穷举结果：

- `js/agents/sdk/http`：6 个源码文件
- 近源测试：0
- `CLAUDE.md`：无
- `.test-map` 已映射：0
- `.test-map` 未映射：6

这意味着它在多个维度上都“隐身”了：

- 没有局部文档锚点
- 没有近源测试锚点
- 没有进入映射体系
- 但它其实是重要入口层

这一点，前面的文档提到了，但这轮确认：

> `sdk/http` 是最应该被单独升级成一级测试域的目录之一。

### 3.5 `mcp` 仍然偏平面化，测试规划必须强拆

穷举结果：

- `js/agents/mcp`：22 个源码文件
- 已映射：20
- 未映射：2
- 但未覆盖：9
- 且目录是平面结构

这类模块不一定“看起来最差”，但**最容易产生假象**：

- 文件多
- 集成测试有一些
- 但 provider / transport / extractor / proxy / resource manager 很容易互相掩盖

### 3.6 `plugins/memory` 比想象中更大，且是高杠杆区

穷举结果：

- `js/agents/plugins/memory`：30 个源码文件
- 近源测试：0
- 已映射：29
- 未映射：1
- 未覆盖：3
- 过时：2

这里说明：

- 映射率不差
- 但规模大、状态复杂、L3 存储和 retrieval 交织
- 这种模块不能只看“覆盖率不低”，仍要列为高杠杆区

---

## 4. 这轮新增发现的“测试组织不合理”信号

### 4.1 近源测试锚点几乎不存在

- 692 个源码文件
- 只有 12 个近源测试文件

这不是说一定要把测试搬到源码旁边，而是说明：

> 当前测试体系几乎完全依赖 `tests/**` 外置目录。  
> 对大型、深层、helper-heavy 模块来说，这会降低“测试可见性”。

### 4.2 大量复杂目录本身没有“局部测试语义”

以下目录文件很多，但目录内部没有近源测试，目录级也没有局部锚点：

- `runtime/core`
- `shared/utils`
- `plugins/memory`
- `mcp`
- `vfs`
- `core/sandbox`
- `stages/deepsearch`
- `sdk`
- `runtime/tools`
- `llm`

这说明：

- 目录级补测时，不能只按文件随机开刀
- 需要先为目录建立**测试主题**，否则补测仍会发散

### 4.3 `index.js` / `helper` / `handler` / `bridge` 文件太多，必须单独设规则

统计结果：

- `index.js`：52
- `helpers`：20
- `handlers`：23
- `bridges`：6
- `adapters`：10
- `constants`：10

这类文件如果没有专门规则，永远容易遗漏。

建议在测试规划里增加一个明确规则：

- `index.js` → 至少要有 export surface 测试
- `helpers.js` → 至少要有 focused unit/regression 测试
- `handler.js` → 至少要有 handler contract 测试
- `bridge.js` → 至少要有 protocol/integration 测试
- `adapter.js` → 至少要有 input/output compatibility 测试

---

## 5. 这轮新增发现的“超大文件风险”

行数 > 400 的文件非常多，而且里面不少都是关键模块：

### 5.1 超高风险（>800 行）

- `core/node-compat/shims/fs.js` — 1346
- `mcp/resource-manager.js` — 1100
- `ingest/ingest-stage.js` — 1059
- `plugins/memory/l3-storage.js` — 1006
- `core/event-bus.js` — 909
- `plugins/memory/memory-store.impl.core.js` — 893
- `runtime/core/message-manager.js` — 852
- `stages/codesearch/indexing/symbol-indexer.js` — 850
- `runtime/core/tool-registry.js` — 840
- `core/state-bus.js` — 836
- `runtime/tools/tool-executor.js` — 832
- `stages/deepsearch/deepsearch-agent-loop.js` — 823
- `stages/deepsearch/internal/shared-context.js` — 819
- `vfs/operations.js` — 811
- `stages/codesearch/code-tools.js` — 801

### 5.2 为什么这对测试规划重要

这些大文件不一定说明设计差，但至少说明：

- 它们天然更难被一个测试文件完整保护
- 必须按“子域 / 子行为”拆 case
- 否则会出现：测试很多，但都在摸同一块表面

所以，超大文件应自动列入“**需要子域化测试设计**”名单。

---

## 6. 这轮复查后的最终新增清单

### 6.1 需要新增“单独测试主题”的目录

这些目录不应再只是文件级 backlog，而应提升为测试主题：

1. `js/agents/core/node-compat`
2. `js/agents/core/sandbox`
3. `js/agents/core/webruntime`
4. `js/agents/runtime/core`
5. `js/agents/runtime/tools`
6. `js/agents/stages/deepsearch`
7. `js/agents/stages/design`
8. `js/agents/mcp`
9. `js/agents/vfs`
10. `js/agents/sdk/http`
11. `js/agents/plugins/memory`
12. `js/agents/shared/utils`

### 6.2 需要新增“结构规则”的文件类型

后续 backlog 应明确增加以下规则：

- `index.js` 必须有 export surface 测试
- `handler.js` 必须有 contract 测试
- `bridge.js` 必须有 protocol/integration 测试
- `helper(s).js` 必须有 focused regression 测试
- `adapter.js` 必须有 input/output compatibility 测试
- 超大文件（>800 行）必须按子域拆测试

### 6.3 这轮新增确认的重点遗漏源

按“遗漏概率 + 风险”排序：

1. `core/node-compat`
2. `runtime/core`
3. `stages/deepsearch/tools/*`
4. `core/sandbox`
5. `core/webruntime`
6. `sdk/http`
7. `mcp`
8. `vfs`
9. `plugins/memory`
10. `shared/utils`

---

## 7. 最终判断

如果你坚持问：

> 到这一轮为止，还有没有可能遗漏？

我的回答会更诚实一些：

- **逻辑上永远不能证明“绝对没有任何遗漏”**
- 但就目前信息来源来说，这一轮已经同时覆盖了：
  - 文件系统穷举
  - 测试映射
  - 目录结构
  - 文件形态
  - 超大文件
  - 模块拆分质量
- 所以从工程上说，**这已经非常接近“把明显和系统性遗漏都找出来了”**

也就是说：

> 再继续做第七轮纯分析，边际收益已经明显下降。  
> 现在更合理的事情，是把这轮新增发现并入 master backlog，然后开始真正补测试。

---

## 8. 建议下一步

建议后续不再新增纯审计文档，而是做一件更有价值的事：

### 把现有 6 轮结果合并成一个 master test backlog

这个 master backlog 应该新增两类字段：

- `test_domain`：所属高级能力域
- `structure_risk`：是否属于 index/helper/handler/bridge/adapter/超大文件

这样后面补测试时，才算真正吸收了这 6 轮分析结果。
