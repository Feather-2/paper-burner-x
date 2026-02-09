# SDK 架构设计文档

**日期**: 2026-02-09
**分支**: feat-pptgen1
**状态**: 设计确认，待实施

## 1. 背景与定位

js/agents 未来将作为独立核心库发布，与 Paper-Burner 应用解耦。SDK 入口需要反映这一定位：**只导出框架能力，不预设任何业务 Stage**。

## 2. 业界最佳实践

### 2.1 主流框架分层模式

| 框架 | 核心包 | 扩展/集成 | 业务/Stage |
|------|--------|----------|------------|
| **Vercel AI SDK** | `ai`（generateText, tool, stream） | `@ai-sdk/openai`, `@ai-sdk/anthropic` | `@ai-sdk/react`（UI） |
| **LangChain.js** | `@langchain/core`（接口+LCEL） | `@langchain/openai`, `@langchain/community` | `@langchain/langgraph`（状态机） |
| **AutoGen v0.4** | `autogen-core`（Actor 消息总线） | `autogen-ext`（模型客户端+工具） | `autogen-agentchat`（预构建 Agent） |
| **CrewAI** | `crewai`（Agent+Flow 编排） | `crewai-tools`（独立工具包） | — |

### 2.2 共同规律

1. **核心包零业务依赖** — 只含抽象接口、编排引擎、事件/消息系统
2. **模型/工具是独立包** — 按需安装，不捆绑在核心
3. **预构建 Agent/Stage 是高层包** — 依赖核心，但核心不依赖它们
4. **MCP 是独立集成** — Vercel 用 `@ai-sdk/mcp`，CrewAI 用 `MCPToolAdapter`

## 3. js/agents SDK 分层设计

### 3.1 目标包结构

```
@paper-burner/agents-core     <- Kernel, EventBus, Plugin, DI, Builder, Tools
@paper-burner/agents-llm      <- ModelRouter, Provider adapters
@paper-burner/agents-mcp      <- MCP client/provider
@paper-burner/agents-stages   <- DeepSearch, Design, CodeSearch, TextPrep（应用层）
```

当前代码已在目录级别实现了这个分离（`core/`, `llm/`, `mcp/`, `stages/`），目前阶段通过 `sdk/index.js` 的导出控制来实现包级隔离，暂不拆分物理包。

### 3.2 SDK 三层 API

| 层级 | 用途 | 导出来源 |
|------|------|----------|
| **L0** | 一行调用 | `stages/` 目录下各 Stage 自行提供 convenience 函数 |
| **L1** | 配置式构建 | `sdk/index.js` — createAgent, AgentBuilder, DefaultAgentLoop |
| **L2** | 完全控制 | `sdk/index.js` — SubagentRegistry, Tools, MCP, DI |

### 3.3 SDK 入口导出规则

**应该在 `sdk/index.js` 中导出（框架核心）**：

```javascript
// L1 - Primary SDK API
createAgent, AgentBuilder, AgentInstance    // Builder 模式
DefaultAgentLoop                            // 通用 Agent Loop
EventBus                                    // 事件总线
AgentStatus, StepStatus, isAgentActive, isAgentTerminal  // 状态枚举
StagePausedError, StageCancelledError       // 错误类型

// L2 - Advanced integrations
SubagentRegistry, globalSubagentRegistry    // 多 Agent 编排
BacktrackManager, SoftBacktrackManager      // 回溯管理
createTaskTool, createRecallTool, etc.      // 通用工具创建
createMcpClient, McpClient, McpProvider     // MCP 集成
createLogger, createBudgetManager           // 共享工具
loadAgentConfig, mergeConfigs               // 配置加载
VERSION                                     // 版本号
```

**不应在 `sdk/index.js` 中导出（应用层）**：

```javascript
DeepSearchAgentLoop     // 业务 Stage，从 stages/deepsearch/ 按需导入
DesignAgentLoop         // 业务 Stage，从 stages/design/ 按需导入
CodeSearchStage         // 业务 Stage，从 stages/codesearch/ 按需导入
runDeepSearch           // 依赖特定 Stage，从 stages/ 按需导入
runDesign               // 依赖特定 Stage，从 stages/ 按需导入
BaseAgentLoop           // 内部基类
CicadaCompressor        // 压缩实现细节
CompressionLayer        // 压缩实现细节
Watchdog                // 压缩实现细节
AlertMonitor            // 内部监控组件
```

### 3.4 使用者导入方式

```javascript
// L1: 框架核心
import { createAgent, EventBus } from "js/agents/sdk";

// L0: 业务便捷函数（从 convenience 按需导入）
import { runDeepSearch } from "js/agents/sdk/convenience.js";
// 或从 stages 入口
import { runDeepSearchAgent } from "js/agents/stages/deepsearch";

// L2: 直接使用 Stage 类（高级用户）
import { DeepSearchAgentLoop } from "js/agents/stages/deepsearch/deepsearch-agent-loop.js";
import { DesignAgentLoop } from "js/agents/stages/design/agent-loop.js";
```

## 4. 已完成的架构优化

### 4.1 800 行硬标准（16 个文件拆分）

| 文件 | 前 | 后 | Helper |
|------|-----|-----|--------|
| `mcp/mcp-nexus-provider.js` | 1068 | 743 | `mcp-nexus-helpers.js` (345) |
| `stages/design/generators/batch-generator.js` | 1061 | 518 | `batch-generator-helpers.js` (557) |
| `core/sandbox/skill-executor.js` | 1039 | 791 | `skill-executor-helpers.js` (262) |
| `stages/codesearch/code-tools.js` | 1003 | 720 | `code-tools-helpers.js` (333) |
| `runtime/core/api/stage-api-factory.js` | 985 | 439 | `stage-api-helpers.js` (559) |
| `prompts/prompt-loader.js` | 971 | 603 | `prompt-loader-helpers.js` (408) |
| `mcp/smart-content-extractor.js` | 946 | 565 | `smart-content-helpers.js` (391) |
| `testing/mock-suite.js` | 901 | 764 | `mock-suite-helpers.js` (159) |
| `runtime/tools/tool-executor.js` | 896 | 746 | `tool-executor-helpers.js` (158) |
| `stages/deepsearch/phases/planning-phase.js` | 885 | 376 | `planning-phase-helpers.js` (524) |
| `runtime/core/message-manager.js` | 854 | 768 | `message-manager-helpers.js` (146) |
| `core/event-bus.js` | 838 | 661 | `event-bus-helpers.js` (366) |
| `stages/design/refiner/react-refiner-tools.js` | 819 | 529 | `react-refiner-helpers.js` (311) |
| `runtime/core/orchestrator.js` | 808 | 768 | appended to `orchestrator-helpers.js` |
| `stages/deepsearch/tools/write-report/handler.js` | 807 | 723 | `handler-helpers.js` (83) |
| `plugins/side-effects/side-effect-journal.js` | 804 | 768 | appended to `side-effect-journal-helpers.js` |

### 4.2 跨层违规修复

| 违规 | 修复 |
|------|------|
| `llm/` -> `runtime/core/retry-strategy.js` | RetryStrategy 下移到 `shared/` |
| `llm/` -> `runtime/routing/performance-router.js` | PerformanceRouter 下移到 `llm/` |
| `stages/deepsearch/subagents.js` -> `core/event-bus.js` | 改为通过 `runtime/index.js` barrel |

### 4.3 架构微调

| 项目 | 结果 |
|------|------|
| textprep/index.js (552 行) | 拆分为 `textprep-stage.js` + `textprep-helpers.js`，index.js 变为 1 行纯 barrel |
| 5 个 re-export shim | 全部清理，消费者更新为真实路径 |
| deepsearch/tools/index.js (270 行) | 拆分为 `tool-executor-ds.js` + `tool-catalog.js`，index.js 变为 48 行 |

### 4.4 架构审计结论

| 审计项 | 结论 |
|--------|------|
| C2 ToolPermissions vs PolicyEngine | 不需合并 — 互补分层，已通过 `setPolicyEngine()` 集成 |
| C3 DeltaSync vs SyncManager | 不需合并 — 不同层级（VFS 文件级 vs CRDT 操作级） |
| E4 Ingest 适配器 DI | 不需全量 DI — 现有 injectedAdapters 足够；已修复 PdfAdapter 全局缓存 |
| C7 pluginRegistry manifest | 不需实现 — `registerPluginsFromManifest()` 已存在 |
| H1 空 catch | 零残留 |
| P1 JSON.parse reviver | 已修复 storage-crypto.js bug + response-limits.js 缺失 |

### 4.5 Helper 拆分质量审计

- 无循环 import
- 仅 1 处合理 re-export（code-tools.js）
- 所有 helpers 只被对应主文件引用，封装边界干净
- 2 例 helpers > main（planning-phase, batch-generator）— 内容为独立纯函数/模板，合理

## 5. 当前代码库健康度

| 指标 | 数值 |
|------|------|
| 文件数 | 567 |
| 总行数 | 151,010 |
| 平均行数 | 267 |
| 最大文件 | 791 行 |
| 测试文件 | 750 |
| DI 注册 | 40 个服务 |
| 跨层违规 | 0 |
| 空 catch | 0 |
| >800 行文件 | 0 |
| Re-export shim | 0 |
| 真实 TODO/FIXME | 0 |

## 6. 待实施

1. **从 `sdk/index.js` 移除 Stage 和 convenience re-export**（本文档确认后执行）
2. `convenience.js` 保留在 `sdk/` 目录，但不从 `sdk/index.js` 导出；使用者可直接 `import from "sdk/convenience.js"`
3. 未来考虑 `package.json` exports map 或物理包拆分

## 7. 设计决策记录

| 决策 | 理由 |
|------|------|
| `-helpers.js` 命名约定 | 统一模式，易发现，与主文件 1:1 配对 |
| 只提取纯函数/常量 | 避免拆分类方法，保持 OOP 内聚性 |
| 不创建 re-export 门面 | 外部调用者继续 import 主文件，helpers 是内部实现细节 |
| SDK 不导出 Stage 类 | 核心框架零业务依赖，对齐 Vercel AI SDK / LangChain.js 最佳实践 |
| L0 convenience 不从 SDK barrel 导出 | 使用者按需 import 具体路径，避免隐式捆绑 |
