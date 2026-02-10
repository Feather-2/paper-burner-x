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

## 8. 多 Agent 协作能力路线图

### 8.1 当前就绪度

**基础设施已就绪（90%）**：
- EventBus + Lamport Clock：跨 Agent 事件因果序 ✅
- MessageBus：request/response RPC + 幂等去重 + 超时 ✅
- Orchestrator：Sequential + Parallel + DAG 调度 ✅
- SubagentRegistry：运行时注册/调用子 Agent ✅
- CRDT SyncManager：LWW/GCounter/PNCounter/ORSet/Document ✅
- SharedContext：子 Agent 继承父级上下文 ✅
- Agent 生命周期：dispose + 子 Agent 清理 ✅

**实际使用薄弱**：
- MessageBus 只在 stage-api-factory 中解析，无 Stage 真正使用 RPC
- CRDT 只有 MemoryTransport，无网络传输
- SubagentRegistry 只有 DeepSearch 的 2 个子 Agent
- DAG 调度未被任何 Stage 组合使用

### 8.2 需要补全的能力

#### 第一层：通信基础（必须）

| 缺口 | 说明 | 涉及模块 |
|------|------|----------|
| **网络 Transport** | CRDT 只有 MemoryTransport，需要 WebSocket/WebRTC Transport 才能跨浏览器/跨进程同步 | `core/crdt/` |
| **Agent 通信协议** | 定义标准消息格式：task-request, task-result, status-update, knowledge-share | `core/contracts/` |
| **消息可靠性** | MessageBus 缺少死信队列、消息确认、持久化投递保证 | `core/message-bus.js` |
| **跨 Agent 背压** | 当前背压只在单 EventBus 内，多 Agent 间没有流控 | `core/message-bus.js` |

#### 第二层：协调机制（重要）

| 缺口 | 说明 | 涉及模块 |
|------|------|----------|
| **任务分配策略** | 当前 SubagentRegistry 只有简单 dispatch，缺少：负载均衡、能力匹配、优先级队列 | `sdk/SubagentRegistry.js` |
| **Agent 身份与发现** | Agent 没有统一的 ID 体系，无法寻址。需要：注册中心、心跳检测、能力广播 | 新建 `core/agent-identity.js` |
| **共享黑板协议** | CRDT Document 存在但没有多 Agent 读写集成。需要：冲突标记、合并策略、变更通知 | `core/crdt/document.js` |
| **协调者模式** | 缺少 Coordinator/Leader 选举。多 Agent 场景需要一个协调者分配任务、汇总结果 | 新建 `runtime/core/coordinator.js` |

#### 第三层：可观测性（重要）

| 缺口 | 说明 | 涉及模块 |
|------|------|----------|
| **Agent 状态可视化** | Orchestrator 没有 getStatus/inspect API，外部无法观察 Agent 群体状态 | `runtime/core/orchestrator.js` |
| **冲突可视化** | CRDT 自动合并了冲突，但用户看不到"Agent A 和 B 有分歧" | `core/crdt/` |
| **跨 Agent 追踪** | TraceContext 在单 Agent 内工作，但跨 Agent 的 trace propagation 未实现 | `plugins/telemetry/` |
| **协作仪表盘** | 无法从外部观察多 Agent 的任务进度、通信拓扑、资源使用 | 新建 |

#### 第四层：容错与弹性（锦上添花）

| 缺口 | 说明 | 涉及模块 |
|------|------|----------|
| **Agent 故障隔离** | 一个子 Agent 崩溃可能影响整个 Orchestrator | `runtime/core/orchestrator.js` |
| **任务重分配** | Agent 失败后任务自动分配给其他 Agent | `sdk/SubagentRegistry.js` |
| **一致性快照** | 多 Agent 系统的全局一致性检查点（跨 Agent 的 Archive） | `core/archive/` |
| **脑裂处理** | 网络分区后多个 Agent 独立运行，恢复后如何合并 | `core/crdt/sync-manager.js` |

### 8.3 推荐实施顺序

```
阶段 1：单进程多 Agent（当前可立即推进）
  ├── 定义 Agent 通信协议（contracts/agent-message.js）
  ├── 让现有 Stage 使用 MessageBus RPC
  ├── Orchestrator 暴露 getStatus() API
  └── 验证场景：DeepSearch + CodeSearch 协作研究

阶段 2：跨进程多 Agent
  ├── 实现 WebSocket Transport for CRDT
  ├── Agent 身份注册与发现
  ├── 跨 Agent TraceContext propagation
  └── 验证场景：浏览器 Agent + Node 服务端 Agent 协作

阶段 3：弹性多 Agent 系统
  ├── Coordinator 模式 + Leader 选举
  ├── 任务重分配 + 故障隔离
  ├── 全局一致性检查点
  └── 验证场景：5+ Agent 长时间运行科研任务
```

### 8.4 框架独特优势（vs 竞品多 Agent 方案）

| 维度 | LangGraph | AutoGen | CrewAI | Paper-Burner |
|------|-----------|---------|--------|-------------|
| 状态同步 | 共享 state dict | 消息传递 | 无 | **CRDT 无冲突合并** |
| 调度模式 | 图遍历 | 轮询/选择 | 顺序 | **Sequential + Parallel + DAG** |
| 通信模式 | 边传递 | 消息 | 委托 | **EventBus + MessageBus RPC** |
| 容错 | checkpoint | 无 | 无 | **WAL + DegradationMatrix + CircuitBreaker** |
| 运行时替换 | 无 | 无 | 无 | **Plugin 热插拔 + ServiceBus 中间件** |
| 浏览器支持 | 无 | 无 | 无 | **完整支持** |

### 8.5 Claude Code Agent Teams 对比分析

> 2026-02-10 分析，基于 Claude Code CLI v2.1.32+ Agent Teams (Research Preview)

#### 8.5.1 Claude Code Agent Teams 架构摘要

Claude Code Agent Teams 采用 **Lead + Teammates 星型拓扑**：

- **Lead Agent**: 永久角色，负责任务编排和协调，不可转移
- **Teammates**: 独立 Claude Session，各有自己的 context window，不继承 Lead 对话历史
- **Shared Task List**: 文件持久化（`~/.claude/tasks/{team-name}/`），DAG 依赖感知
- **Mailbox**: Lead 可 `message`（点对点）或 `broadcast`（一对多）给 Teammates
- **空闲通知**: Teammate 完成后自动 notify Lead
- **成本模型**: 每个 Teammate 是完整 session，成本线性增长

#### 8.5.2 架构维度对比

| 维度 | Claude Code Agent Teams | Paper-Burner |
|------|------------------------|-------------|
| **拓扑** | Lead + Teammates（星型，Lead 不可转移） | Orchestrator + AgentLoop（可嵌套，Sequential/Parallel） |
| **通信** | Mailbox（文件系统），message/broadcast | MessageBus（EventBus + RPC），内存级，channel 路由 |
| **任务管理** | SharedTaskList（文件持久化，DAG 依赖） | TaskGraph（内存 DAG）+ TaskTool（三种 ContextMode） |
| **上下文传递** | 每个 Teammate 独立 context window | ContextMode: isolated/shared/handoff + SubagentBudget |
| **安全** | Tool permissions per teammate | InjectionScanner + quarantineOutput + ToolPermissions |
| **状态共享** | 文件系统 + Git worktree | SharedMemory（SAB 零拷贝）+ StateBus 响应式 |
| **数据传输** | 序列化（文件） | SAB 零拷贝 / MessagePort 256KB 分块回退 |
| **回溯** | 无 | DMailTool 软回溯（Steins;Gate D-Mail） |
| **持久化** | 文件系统原生 | Archive + Checkpoint Schema |
| **可观测性** | 基础 CLI 输出 | Telemetry + EventBus hooks |

#### 8.5.3 我们已有的优势

1. **通信层更强** — MessageBus 是内存级 RPC + pub/sub，支持 channel 路由、request/response 语义、幂等去重。Claude 用文件系统 Mailbox，延迟高且无类型安全。`agent-message.js` 协议（4 种消息类型 + 验证器 + 工厂函数）进一步强化了这一点。

2. **上下文管理更精细** — `ContextMode` 三级（isolated/shared/handoff）+ `SubagentBudgetManager` 按模式分配 token 比例（15%/25%/35%）。Claude Teammates 只有"独立 context window"一种模式。

3. **安全层更深** — `InjectionScanner` + `quarantineOutput` 检疫机制：子代理输出经过 schema 验证 + Prompt Injection 扫描后才能回传父代理。Claude 仅有 tool permissions。

4. **零拷贝数据传输** — `SharedMemory` 支持 SharedArrayBuffer 零拷贝，处理大科研数据集时无需序列化。Claude 完全没有等价能力。

5. **DMailTool 软回溯** — 标记历史 turns 为 superseded 而不删除，支持 minor/major/critical 严重级别。Claude 没有等价物。

6. **CRDT 无冲突合并** — LWW/GCounter/PNCounter/ORSet/Document 全套 CRDT 原语，支持多 Agent 并发写入自动合并。Claude 依赖文件系统锁，建议"assign teammates to separate directories"来避免冲突。

7. **Plugin 热插拔** — ServiceBus 中间件 + Plugin 系统支持运行时扩展。Claude Agent Teams 是封闭系统。

#### 8.5.4 Claude Code 值得学习的点

1. **共享任务列表（Shared Task List）的持久化与跨 Agent 可见性**
   - Claude 的 DAG 依赖感知任务列表是文件持久化的，所有 Agent 可以认领（claim）和更新任务状态
   - 我们的 `TaskGraph` 有 DAG 能力，但缺少持久化和跨 Agent 可见性
   - **建议**: 在 StateBus 上构建 `SharedTaskBoard`，支持任务持久化、claim 语义、依赖阻塞

2. **Broadcast 语义的显式化**
   - Claude 的 broadcast 虽然简单，但"一对多"广播在协作场景中非常实用
   - 我们的 MessageBus 有 `emit`（pub/sub），但缺少显式的 `broadcast` API 和 `agent:*` 通配订阅
   - **建议**: 在 `agent-message.js` 上加一层 `AgentBroadcaster`

3. **Teammate 自动空闲通知**
   - Teammate 完成后自动 notify Lead，Lead 不需要轮询
   - 我们的 Orchestrator 通过回调知道 Stage 结束，但 MessageBus 层没有标准化的生命周期事件
   - **建议**: 用 `createStatusUpdate(agentId, 'stopped')` 作为标准退出信号，Orchestrator 自动订阅

4. **成本感知与汇总**
   - Claude 明确指出"每个 Teammate 是完整 session，成本线性增长"
   - 我们有 `SubagentBudgetManager` 管理 token 预算，但缺少跨 Agent 成本汇总报告
   - **建议**: 添加 `CostAggregator` 插件

5. **文件级任务隔离**
   - Claude 建议"assign teammates to separate directories"避免文件冲突
   - 这是一个简单但有效的策略，适合无 CRDT 的场景
   - 我们的 CRDT 已经解决了并发冲突，但可以在任务分配时加入目录亲和性提示

#### 8.5.5 实施状态更新

阶段 1 进展（2026-02-10）：

| 子任务 | 状态 | 说明 |
|--------|------|------|
| 定义 Agent 通信协议 | ✅ 完成 | `contracts/agent-message.js` — 4 种消息 + 验证器 + 工厂 |
| 单元测试 | ✅ 完成 | 41 个测试全通过 |
| MessageBus 集成测试 | ✅ 完成 | 5 个集成测试（RPC roundtrip, broadcast, channel routing, delegation chain, timeout） |
| contracts/index.js 导出 | ✅ 完成 | 14 个新导出 |
| core/index.js 导出 | ✅ 完成 | 上层可直接 import |
| Stage 使用 MessageBus RPC | ⏳ 待做 | |
| Orchestrator.getStatus() | ⏳ 待做 | |
| SharedTaskBoard | ⏳ 待做 | 受 Claude Agent Teams 启发新增 |
| AgentLifecycleEvents | ⏳ 待做 | 受 Claude Agent Teams 启发新增 |

### 8.6 阶段 1 修订后的实施计划

基于 Claude Code Agent Teams 分析，阶段 1 新增 3 个子任务：

```
阶段 1：单进程多 Agent（修订版）
  ├── [✅] 定义 Agent 通信协议（contracts/agent-message.js）
  ├── [⏳] 让现有 Stage 使用 MessageBus RPC
  ├── [⏳] Orchestrator 暴露 getStatus() API
  ├── [⏳] SharedTaskBoard — 持久化共享任务列表 + claim 语义（新增，受 Claude 启发）
  ├── [⏳] AgentLifecycleEvents — 标准化 idle/busy/stopped 广播（新增，受 Claude 启发）
  ├── [⏳] CostAggregator — 跨 Agent token 使用汇总（新增）
  └── 验证场景：DeepSearch + CodeSearch 协作研究
```
