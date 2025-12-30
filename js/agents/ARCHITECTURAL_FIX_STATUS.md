# 架构修复状态报告 (ARCHITECTURAL_FIX_STATUS.md)

本报告总结了对 `ARCHITECTURAL_REVIEW.md` 中确定的问题和建议的验证情况。

## 执行摘要

当前架构状态显示出明显的硬化（Hardening）。在识别出的 18 个工程瓶颈中，**13 个已完全解决**，**3 个已部分解决或缓解**，**2 个仍作为设计选择或留待未来优化**。

| 状态 | 数量 | 描述 |
| :--- | :--- | :--- |
| ✅ **已修复** | 13 | 已成功解决，并有明确的代码证据。 |
| ⚠️ **部分修复** | 3 | 通过特定模式或部分实现进行了处理。 |
| 📝 **已确认** | 2 | 设计符合预期，或需要极高成本的重构。 |

---

## 3. 系统性工程瓶颈验证

### 3.1 状态碎片化 (Dual-Sync Overhead)
- **状态**: ⚠️ **部分解决**
- **发现**: 引入了 `UnifiedAgentContext` 作为门面（Facade）。然而，`DeepSearchState` 中仍存在手动同步逻辑 (`_syncToShared`)。系统正在向基于 Proxy 或自动化同步转型，但仍保留了部分手动同步代码。
- **参考**: `js/agents/stages/deepsearch/state.js:210`

### 3.2 递归快照导致的性能塌缩
- **状态**: ✅ **已修复 (通过策略)**
- **发现**: 在 `DeepSearchState.saveCheckpoint` 中引入了 `CheckpointMode`，支持 `MINIMAL`（最小化）和 `LITE`（轻量级）快照策略。这避免了每次检查点都必须进行的 O(N) 全量递归克隆。
- **参考**: `js/agents/stages/deepsearch/state.js:336`

### 3.3 压缩竞态 (Race Condition in Compression)
- **状态**: ✅ **已修复**
- **发现**: `BaseAgentLoop` 现在包含 `flushCompression()` 方法，作为模型调用前的同步屏障，确保在发起请求前完成上下文剪枝。
- **参考**: `js/agents/runtime/core/agent-loop.js:637`, `js/agents/stages/deepsearch/deepsearch-agent-loop.js:482`

### 3.4 共享内存并发冲突
- **状态**: 📝 **已确认**
- **发现**: 在共享上下文运行时中未发现显式的互斥锁（Mutex）或锁定机制。目前通过 `Design` 等阶段的串行执行或逻辑隔离来管理并发修改。对于真正的并行执行，架构风险依然存在。

### 3.5 错误恢复的“预算黑洞”
- **状态**: ✅ **已修复**
- **发现**: `ModelResponseHandler` 现在管理空响应或无法解析响应的重试逻辑，并设有硬上限（默认为 5 次）。重试耗尽时会触发用户干预 (`waitForUserInput`)。
- **参考**: `js/agents/stages/deepsearch/runtime/model-response-handler.js:57`, `js/agents/stages/deepsearch/runtime/model-response-handler.js:83`

### 3.6 Skill 系统的线性扩展瓶颈
- **状态**: ✅ **已修复**
- **发现**: `SkillInjection` 现在使用 `byToken` 索引（Map of Sets）来预过滤候选技能。这取代了对所有技能的 O(N) 扫描， lookup 效率显著提高。
- **参考**: `js/agents/skills/injection.js:126`

### 3.7 ToolExecutor 的“伪超时”保护
- **状态**: ✅ **已修复**
- **发现**: `ToolExecutor` 现在支持 `isolationMode: "worker"`，利用 `node:worker_threads` 实现真正的隔离和超时保护，即使 Handler 内部出现同步死锁也能正常工作。
- **参考**: `js/agents/runtime/tools/tool-executor.js:226`

### 3.8 MCP 提取器的环境泄漏
- **状态**: ✅ **已修复**
- **发现**: `smart-content-extractor.js` 和 `local-mcp-provider.js` 现在都包含回退线性扫描器 (`extractPlainTextFromHtml`)，不依赖浏览器的 DOM API。
- **参考**: `js/agents/mcp/smart-content-extractor.js:152`, `js/agents/mcp/local-mcp-provider.js:91`

### 3.9 MCP 搜索的“UI 依赖”脆弱性
- **状态**: ✅ **已修复**
- **发现**: `LocalMcpProvider` 现在在浏览器端使用原生 `DOMParser`，在 Node 端自动回退到 `linkedom` 的 `DOMParser`，并内置“不依赖 DuckDuckGo CSS 类”的 Anchor 扫描回退，显著降低了对特定 UI 结构的耦合。
- **参考**: `js/agents/mcp/local-mcp-provider.js:287`

### 3.10 数据安全：CORS 代理的泄露风险
- **状态**: ✅ **已修复**
- **发现**: 从 `LocalMcpProvider` 中移除了公共 CORS 代理。系统现在优先使用私有的 `workerEndpoint` 或 `proxyEndpoint`，并在日志中对敏感查询参数进行脱敏处理。
- **参考**: `js/agents/mcp/local-mcp-provider.js:422`, `js/agents/mcp/local-mcp-provider.js:63`

### 3.11 大规模 HTML 提取的内存压力
- **状态**: ✅ **已修复**
- **发现**: 在 `extractTextFromHtml` 中，用单次线性状态机扫描器取代了多次全文本正则替换。
- **参考**: `js/agents/mcp/local-mcp-provider.js:91`

### 3.12 DSL 启发式修复的局限性
- **状态**: ✅ **已修复**
- **发现**: `BatchGenerator` 现在使用基于 LLM 的反思机制 (`repairSlideHtmlWithModel`) 来修复格式错误的 DSL，而不是依赖简单的启发式规则。
- **参考**: `js/agents/stages/design/generators/batch-generator.js:159`

### 3.13 Telemetry 遥测系统的内存膨胀
- **状态**: ✅ **已修复**
- **发现**: `state-logic.js` 中的 `addTimeline` 现在强制执行 `maxTimeline` 长度（并显式使用 `Deque` 进行高效修建），防止内存无限增长。
- **参考**: `js/agents/stages/deepsearch/state-logic.js:314`

### 3.14 EventBus 的同步错误“雪崩”
- **状态**: ✅ **已修复**
- **发现**: `EventBus._dispatch` 现在将监听器的执行包装在 `try-catch` 块中，确保单个监听器的失败不会导致整个系统崩溃。
- **参考**: `js/agents/runtime/events/event-bus.js:388`

### 3.15 Cicada 压缩的“语义漂移”
- **状态**: 📝 **已确认**
- **发现**: 分层记忆系统已存在，但递归摘要仍是主要的压缩模式。架构支持更好的策略，但“语义漂移”是 LLM 摘要模式固有的挑战。

### 3.16 静态 Token 估算的偏差
- **状态**: ⚠️ **部分修复**
- **发现**: `estimateTokenCount` 已升级，能够区分 CJK 字符和字母数字字符，并应用不同的比例（1.6 vs 0.25 tokens/char），相比之前的静态比例显著提高了准确性。
- **参考**: `js/agents/shared/utils/value-utils.js:123`

### 3.17 浏览器单线程架构下的“主线程霸占”
- **状态**: ⚠️ **部分修复**
- **发现**: 在工具执行和部分内容提取中已实现 Web Workers 的使用，但核心 Agent Loop 和状态管理仍运行在主线程上。

### 3.18 MCP Gateway 的凭证管理漏洞
- **状态**: ✅ **已修复 (客户端)**
- **发现**: `McpNexusProvider` 现在支持标准的 Bearer 认证。Gateway 安全性已由 `pb-mcpgateway` 服务统一管理，实现了凭证的中心化处理。
- **参考**: `js/agents/mcp/mcp-nexus-provider.js:141`

---

## 结论

自 `ARCHITECTURAL_REVIEW.md` 发布以来，架构演进显著。大多数“致命缺陷”已通过 Workers、线性扫描器及改进的重试/压缩逻辑得到缓解。

> [!TIP]
> **下一阶段建议**: 将所有状态修改转换为通过 Proxy 实现的单一事实来源 (SSoT)，以彻底解决“状态碎片化”问题。
