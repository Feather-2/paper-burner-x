# js/agents 架构问题清单

> 来源：2026-01-19 深度架构评审
> 状态：待处理
> 验证时间：2026-01-19

## 概述

整体架构方向正确：微内核 + 三总线 + 插件系统。但执行层面存在**边界膨胀**问题。

### 实测数据

| 指标 | 当前值 | 健康值 | 差距 |
|------|--------|--------|------|
| Runtime 子目录 | **28** | <10 | -18 |
| Runtime 文件数 | **128** | <50 | -78 |
| runtime/index.js 导出行 | **45** | <15 | -30 |
| "阴影 runtime" 目录 | **2** | 0 | -2 |

---

## Linus 式架构改进路线图

> 原则：Keep it simple, stupid. 一次只改一个边界，每次改完能跑。

### Phase 0: 命名清理 (今天)

**目标**: 消除命名冲突，零破坏性

```bash
# 重命名阴影 runtime 为 internal
mv stages/deepsearch/runtime stages/deepsearch/internal
mv stages/design/runtime stages/design/internal

# 批量替换 import
find js/agents/stages -name "*.js" -exec sed -i 's|/runtime/|/internal/|g' {} \;
```

**验证**: `grep -r "stages/.*/runtime" js/agents` 应返回空

**预估**: 30 分钟

---

### Phase 1: Runtime 瘦身 (本周)

**目标**: Runtime 只保留核心执行能力，其他变为可选

**当前 Runtime 结构** (28 个子目录):
```
runtime/
├── core/           ← 保留 (AgentLoop, ToolRegistry, StatusController)
├── tools/          ← 保留 (ToolExecutor, 内置工具)
├── hooks/          ← 保留 (HookRegistry)
├── events/         ← 保留 (事件类型)
├── compression/    ← 移出 → plugins/compression/
├── telemetry/      ← 移出 → plugins/telemetry/
├── memory/         ← 移出 → plugins/memory/
├── coordination/   ← 移出 → plugins/coordination/
├── analysis/       ← 移出 → plugins/analysis/
├── middleware/     ← 保留或移出
├── di/             ← 保留 (依赖注入是基础)
├── ... (其他 17 个目录，逐一评估)
```

**目标结构**:
```
runtime/                    # 核心执行 (≤50 文件)
├── core/
├── tools/
├── hooks/
├── events/
├── di/
└── index.js               # 只导出核心 API

plugins/                    # 可选能力
├── compression/           # 已存在，整合 runtime/compression
├── telemetry/
├── memory/
├── analysis/
└── coordination/
```

**迁移策略**:
1. 在 plugins/ 创建新插件包装
2. 修改 runtime/index.js 不再导出可选模块
3. 更新依赖方 import 路径
4. 删除 runtime/ 下的旧目录

**验证**: `ls -d runtime/*/ | wc -l` 应 ≤10

**预估**: 2-3 天

---

### Phase 2: 导出精简 (下周)

**目标**: runtime/index.js 导出 ≤20 个符号

**当前导出** (45 行，实际 70+ 符号):
```javascript
// 全部平铺，无层次
export { BaseAgentLoop, checkCancelled, checkPaused } from "./core/agent-loop.js";
export { MemoryStore } from "./memory/memory-store.js";
export { Watchdog } from "./compression/watchdog.js";
// ... 70+ 个
```

**目标导出**:
```javascript
// runtime/index.js - 只导出核心
export { BaseAgentLoop, checkCancelled, checkPaused } from "./core/agent-loop.js";
export { AgentStatus, StepStatus } from "./core/agent-status.js";
export { ToolRegistry, normalizeToolResult } from "./core/tool-registry.js";
export { AgentOrchestrator, SchedulingMode } from "./orchestrator.js";
export { HookRegistry, HookType } from "./hooks/index.js";
export { Container, createContainer } from "./di/index.js";

// 高级 API 通过子路径 (tree-shakeable)
// import { Watchdog } from 'js/agents/plugins/compression';
// import { MemoryStore } from 'js/agents/plugins/memory';
```

**验证**: `grep -c "^export" runtime/index.js` 应 ≤15

**预估**: 1 天

---

### Phase 3: Stage 解耦 (下个迭代)

**目标**: Stage 通过接口访问 Runtime 能力，不直接 import 内部模块

**当前问题** (deepsearch-agent-loop.js:7-21):
```javascript
import { BaseAgentLoop } from "../../runtime/core/agent-loop.js";          // OK
import { ConvergenceDetector } from "../../runtime/analysis/convergence-detector.js";  // 紧耦合
import { BehaviorFingerprint } from "../../runtime/analysis/behavior-fingerprint.js";  // 紧耦合
```

**目标模式**:
```javascript
// Stage 通过 StageApi 获取能力
class DeepSearchAgentLoop extends BaseAgentLoop {
  async run(input, context) {
    const { stageApi } = context;

    // 通过接口访问，不直接 import
    const convergenceDetector = stageApi.analysis?.createConvergenceDetector();
    const behaviorFingerprint = stageApi.analysis?.createBehaviorFingerprint();
  }
}

// runtime/api/stage-api-factory.js 提供能力注入
createStageApi({
  analysis: analysisPlugin.isLoaded() ? analysisPlugin.api : null,
});
```

**好处**:
- Runtime 内部重构不破坏 Stage
- 能力按需加载
- 测试时易于 mock

**预估**: 2 天

---

### Phase 4: 长期维护 (持续)

1. **Typedef 集中**: 迁移分散的 typedef 到 `core/types.d.ts`, `runtime/types.d.ts`
2. **工具函数整理**: 散落的 `isPromiseLike` 等移到 `shared/utils/`
3. **大文件拆分**: `deepsearch-agent-loop.js` (706行) 拆成 3-4 个文件
4. **Package imports**: 添加 `#agents/core` 等别名，消除深相对导入

---

## 成功标准

| 阶段 | 完成标准 |
|------|---------|
| Phase 0 | `grep "stages/.*/runtime" js/agents` 返回空 |
| Phase 1 | `ls -d runtime/*/ \| wc -l` ≤ 10 |
| Phase 2 | `grep -c "^export" runtime/index.js` ≤ 15 |
| Phase 3 | Stage 文件中无 `../../runtime/` 内部模块 import |

---

## 详细问题清单

### P0.1 "阴影 runtime" 命名冲突

**位置**:
- `stages/deepsearch/runtime/` (7 个 JS 文件)
- `stages/design/runtime/` (8 个 JS 文件)

**实际文件**:
```
stages/deepsearch/runtime/
├── backtrack-manager.js
├── checkpoint.js
├── error-classifier.js
├── logger.js
├── model-response-handler.js
├── shared-context.js
└── writing-phase-handler.js

stages/design/runtime/
├── deck-analyzer.js
├── deck-editor.js
├── deck-planner.js
├── design-blackboard.js
├── design-context.js
├── design-phases.js
├── screenshot-stitcher.js
└── visual-handler.js
```

**问题**: 与顶层 `runtime/` 同名，import 路径易混淆

**修复**: 见 Phase 0

---

### P1.1 Runtime 28 个子目录

**位置**: `runtime/`

**实际子目录**:
```
analysis/     api/          checkpoints/   compression/
constants/    context/      coordination/  core/
deps/         di/           errors/        events/
exec/         hooks/        kernel/        manifest/
memory/       middleware/   parallel/      plan/
policy/       resilience/   routing/       safety/
side-effects/ telemetry/    tools/         transports/
```

**问题**: 职责过多，非核心能力应插件化

**修复**: 见 Phase 1

---

### P1.2 runtime/index.js 导出过多

**位置**: `runtime/index.js`

**实测**: 45 行 export，实际 70+ 符号

**问题**: API 表面积过大，学习曲线陡峭

**修复**: 见 Phase 2

---

### P2.1 Stage 紧耦合 Runtime 内部

**位置**: `stages/deepsearch/deepsearch-agent-loop.js:7-21`

**问题 import**:
```javascript
import { ConvergenceDetector } from "../../runtime/analysis/convergence-detector.js";
import { BehaviorFingerprint } from "../../runtime/analysis/behavior-fingerprint.js";
```

**问题**: 直接依赖 Runtime 实现细节

**修复**: 见 Phase 3

---

### P2.2 构造函数参数过多

**位置**: `sdk/agent-factory.js:18-30`

```javascript
constructor({
  eventBus, logger, capabilities, toolExecutor,
  mcpConfig, subagentRegistry, compressor,
  backtrackManager, discoveryManager, actor, options,
}) { ... }
```

**问题**: 11 个参数，难以维护

**建议**: 分组为 `{ core, capabilities, managers, options }` 或 Builder 模式

---

### P2.3 typedef 分散

**位置**: `runtime/core/agent-loop.js:17-84` (67 行 typedef)

**问题**: 类型定义与业务代码混合

**建议**: 集中到 `core/types.d.ts`, `runtime/types.d.ts`

---

### P2.4 工具函数散落

**位置**: `runtime/orchestrator.js` 等

**散落函数**: `isPromiseLike`, `maybeAwait`, `normalizeTimeoutMs`

**建议**: 移至 `shared/utils/promise-utils.js`, `shared/utils/normalize-utils.js`

---

### P3.1 深相对导入

**位置**: 约 65 个文件使用 `../../../` 或更深

**建议**: 使用 package imports (`#agents/core` 等别名)

---

### P3.2 大文件

**位置**: `stages/deepsearch/deepsearch-agent-loop.js` (706 行)

**建议**: 拆分为 `deepsearch-guards.js`, `deepsearch-convergence.js` 等

---

## 设计决策记录

### Code Stage 设计边界 (待实现)

**状态**: 设计阶段，尚未开始实现

#### 与主流 CLI Agent 架构对比

##### vs Rust CLI Agent

| 维度 | Rust CLI Agent | PB 微内核 (JS) | 评估 |
|------|----------------|----------------|------|
| 语言性能 | Rust 原生 | JS V8 JIT | ❌ 无实际影响（LLM 调用是瓶颈） |
| 抽象层数 | 2 层 | 5 层 | ❌ 无实际影响（ms 级被 s 级淹没） |
| 多 Agent | ❌ 单 Agent | ✅ Orchestrator | PB 优势 |
| 上下文压缩 | ❌ 无 | ✅ Cicada | PB 优势 |
| Hook 系统 | ❌ 无 | ✅ 4 类 Hook | PB 优势 |

##### vs TypeScript CLI Agent

| 维度 | TS CLI Agent | PB 微内核 (JS) | 评估 |
|------|--------------|----------------|------|
| 语言 | TypeScript | JS + JSDoc | 相当（都是 Node.js） |
| 架构 | 3 层扁平 | 5 层微内核 | 各有取舍 |
| 工具系统 | BaseTool + Registry (25+) | ToolRegistry + Executor | 相当 |
| 沙箱 | OS 级 (Bubblewrap/Seatbelt) | WASM (QuickJS) | TS 更强 |
| Hook 系统 | 11 种事件 | 4 类 Hook | 相当 |
| 上下文压缩 | ContextManager + AI 摘要 | Cicada + Watchdog | PB 更系统化 |
| 多 Agent | 并行执行 + 恢复 | Orchestrator (3 种调度模式) | PB 更完整 |
| 子 Agent | 4 种固定类型 | Stage 模式 (可扩展) | PB 更灵活 |

**TS CLI Agent 优势**:
- OS 级沙箱 (Bubblewrap/Seatbelt)，真正的进程隔离
- 25+ 成熟工具 (Bash/Read/Write/Edit/Glob/Grep/WebFetch 等)
- 生产级成熟度 (完整权限系统、会话持久化、LSP 集成)

**PB 微内核优势**:
- 多 Agent 编排 (Orchestrator 支持 Serial/Parallel/Priority)
- 上下文压缩更系统化 (Cicada + Watchdog + ProactiveCompressor)
- 跨平台 (浏览器/Node.js/Deno/Bun 通用)
- 插件系统 (预设 + 可组合)

**场景适配**:

| 场景 | 更适合 |
|------|--------|
| 纯 CLI 代码编辑 | TS CLI Agent（工具链成熟） |
| 多 Agent 协作 | PB（Orchestrator） |
| 长会话 | PB（压缩更系统） |
| 浏览器可用 | PB（唯一选择） |

**结论**: PB 缺少 OS 级沙箱和成熟工具链，但架构层面（多 Agent、压缩、跨平台）更强。

#### 浏览器端能力边界

| 能力 | 浏览器可用 | 方案 |
|------|------------|------|
| **代码生成** | ✅ | LLM 生成 |
| **apply-patch** | ✅ | 纯 JS 实现 (diff-match-patch) |
| **语法检查** | ✅ | tree-sitter WASM |
| **file-search** | ✅ | VFS 内存搜索 |
| **Python 执行** | ✅ | Pyodide (已集成) |
| **JS 执行** | ✅ | 原生 / WebContainer |
| **Go/Rust 语法检查** | ✅ | tree-sitter WASM |
| **Go/Rust 编译** | ❌ | 需后端服务 |
| **Go/Rust 运行** | ❌ | 需后端服务 |

**边界决策**:
- 浏览器端：生成 + patch + tree-sitter 语法检查（轻量）
- 后端服务：编译 + 运行 + 完整 lint（重计算）

#### 待实现基础设施

| 组件 | 优先级 | 说明 |
|------|--------|------|
| `apply-patch` | P1 | 增量补丁引擎，比全量覆盖更安全 |
| `exec` 封装 | P1 | 子进程管理、超时、流式输出 (Node.js 端) |
| `tree-sitter` 集成 | P2 | WASM 语法检查，支持多语言 |
| `sandbox` (Node.js) | P2 | vm2 / isolated-vm 隔离 |

#### 参考模块设计

```
典型 Rust CLI Agent 结构:
├── apply-patch/     # 增量补丁 (可用 JS 实现)
├── exec/            # 命令执行 (Node.js child_process 封装)
├── file-search/     # 文件搜索 (VFS 内已有)
└── sandbox/         # 沙箱 (Node.js 用 vm2/isolated-vm)
```

#### 子 Agent 机制参考 (来自 TS CLI Agent)

##### 四种内置 Agent 类型

| Agent | 职责 | 权限级别 | 工具限制 |
|-------|------|----------|----------|
| **Explore** | 快速代码探索 | readonly | Bash 限制只读命令 (ls/cat/git log) |
| **Plan** | 软件架构设计 | elevated (但禁写) | 禁止 Write/Edit/MultiEdit |
| **Bash** | 命令执行专家 | standard | 无限制 |
| **general-purpose** | 通用多步骤 | standard | 全部工具 |

##### Explore Agent 设计

- 三种查询类型：`pattern`(glob) / `code`(内容搜索) / `semantic`(语义)
- 三种彻底程度：`quick`(20结果) / `medium`(50) / `very thorough`(200)
- 内置 ripgrep，回退到 grep
- 自动提取 exports/imports/classes/functions
- 输出：files + codeSnippets + summary + suggestions

##### Plan Agent 设计

- **只读模式**：严格禁止文件修改
- 输出结构化：
  - RequirementsAnalysis (功能/非功能需求)
  - ArchitecturalDecision (决策 + 权衡)
  - PlanStep (步骤 + 依赖 + 复杂度)
  - Risk (分类 + 级别 + 缓解)
  - CriticalFiles (3-5 个关键文件)
- 禁止工具：Write/Edit/MultiEdit/NotebookEdit/ExitPlanMode

##### 工具过滤机制

```javascript
// 权限级别
permissionLevel: 'readonly' | 'standard' | 'elevated'

// 自定义限制示例
customRestrictions: [{
  toolName: 'Bash',
  type: 'scope',
  rule: {
    allowedCommands: [/^git\s+(status|diff|log)/, /^ls/, /^cat/]
  }
}]

// 限制类型
type: 'parameter' | 'rate' | 'scope'
```

##### 并行执行机制

- 依赖图 + 拓扑排序
- 最大并发数控制 (默认 5)
- 失败重试 + 超时 (默认 5 分钟)
- 进度跟踪：pending/waiting/running/completed/failed/cancelled

##### 恢复机制 (Checkpoint)

- 状态持久化到 `~/.claude/agents/{agentId}.json`
- Checkpoint 包含：messages + toolCalls + results + metadata
- 恢复选项：`last` / `checkpoint` / 指定 step
- 支持错误重置 + 附加上下文

##### PB 可借鉴的点

| 机制 | 价值 | PB 现状 | 优先级 |
|------|------|---------|--------|
| **Agent 类型分离** | 不同任务用不同权限 | Stage 模式可扩展 | P2 |
| **readonly 模式** | 探索/规划不修改代码 | 无，需新增 | P1 |
| **工具白名单/黑名单** | 精细权限控制 | Hook 可做但未封装 | P2 |
| **Bash 命令正则限制** | 防止误操作 | command-classifier 已有 | ✅ |
| **Checkpoint 持久化** | 长任务断点续传 | 无，需新增 | P1 |
| **并行 + 依赖图** | 复杂任务编排 | Orchestrator 有 Parallel | ✅ |
| **TaskGraph.fromTasks** | 从数组自动构建依赖图 | 无，需手动 addTask | P3 |
| **结构化 Plan 输出** | 可解析的规划结果 | 无，需新增 | P2 |

---

### JSDoc 类型策略 (已确认合理)

**决策**: 使用 JS + JSDoc 模拟 TypeScript 类型系统

**原因**:
1. 纯浏览器可用，零编译依赖
2. 393 个文件的系统需要类型安全
3. 最大化跨端兼容 (Browser/Node/Deno/Bun)

**权衡**: 接受 typedef 较多的代价，换取零构建步骤。

---

## 架构优点 (保持)

1. **微内核设计**: Kernel + 三总线解耦彻底
2. **插件拓扑排序**: 依赖顺序处理正确
3. **ReDoS 防护**: wildcardMatch 用双指针
4. **PluginContext 自动清理**: dispose() 防内存泄漏
5. **惰性加载**: 插件按需加载，解耦编译依赖
6. **跨平台抽象**: VFS + Platform 检测干净
7. **预设系统**: minimal/standard/production 分级组合

---

### 测试方法参考 (来自 TS/Go CLI Agent)

**状态**: 可借鉴，逐步采纳

#### TS CLI Agent 测试模式

##### 测试结构

```
tests/
├── tools/        # 工具单元测试 (bash.test.ts 671行)
├── core/         # 核心循环测试 (loop.test.ts)
├── e2e/          # 端到端 CLI 测试 + Mock Server
├── integration/  # 集成测试 + fixtures
├── hooks/        # Hooks 测试
├── mcp/          # MCP 协议测试
└── session/      # 会话管理测试
```

##### 关键模式

| 模式 | 说明 | 示例 |
|------|------|------|
| **Mock Server** | API 模拟，设置预期响应 | `mockServer.setTextResponse('Hello')` |
| **安全测试** | 验证危险命令拦截 | `rm -rf /`, fork bomb `:(){ :\|:& };:` |
| **后台进程生命周期** | start → running → completed | `run_in_background: true` + `BashOutputTool` |
| **审计日志验证** | 检查命令记录 | `getAuditLogs()` 验证 command/duration/outputSize |
| **E2E 测试框架** | CLI 运行器 + 断言 | `runCLI(['--version'], { timeout: 5000 })` |
| **Setup/Teardown** | 测试环境管理 | `setupE2ETest()` / `teardownE2ETest()` |

##### 安全测试用例

```javascript
// 阻止危险命令
it('should block dangerous rm -rf / command', async () => {
  const result = await bashTool.execute({ command: 'rm -rf /' });
  expect(result.success).toBe(false);
  expect(result.error).toContain('security');
});

// 阻止 fork bomb
it('should block fork bomb', async () => {
  const result = await bashTool.execute({ command: ':(){ :|:& };:' });
  expect(result.success).toBe(false);
});
```

#### Go SDK 测试模式

##### 测试结构

```
test/
├── benchmarks/   # 性能基准测试
├── demos/        # 演示测试
├── integration/  # 集成测试 (build tags)
├── runtime/      # 运行时组件测试
│   ├── commands/
│   ├── skills/
│   └── subagents/
└── security/     # 权限测试
```

##### 关键模式

| 模式 | 说明 | 示例 |
|------|------|------|
| **Build Tags** | 分离集成测试 | `//go:build integration` |
| **Scripted Model** | 确定性 LLM 响应 | `scriptedModel{responses: [...]}` |
| **并发隔离测试** | 验证多任务隔离 | `atomic.Int32` + `sync.Mutex` |
| **Context 取消测试** | 正确处理取消 | `ctx.Done()` + `context.Canceled` |
| **t.TempDir()** | 隔离文件系统 | 每个测试独立目录 |
| **t.Cleanup()** | 自动清理 | `t.Cleanup(func() { _ = rt.Close() })` |

##### 并发隔离测试

```go
func TestConcurrentIsolation(t *testing.T) {
  var (
    mu   sync.Mutex
    seen = map[string]string{}
  )
  const workers = 6
  var wg sync.WaitGroup
  wg.Add(workers)
  for i := 0; i < workers; i++ {
    go func() {
      defer wg.Done()
      // 并发执行，验证隔离性
    }()
  }
  wg.Wait()
  // 验证每个 worker 保持独立 session
}
```

##### Context 取消测试

```go
t.Run("cancellation", func(t *testing.T) {
  ctx, cancel := context.WithCancel(context.Background())
  go func() {
    <-started
    cancel()
  }()
  _, err := task.Execute(ctx, params)
  if !errors.Is(err, context.Canceled) {
    t.Fatalf("expected context cancellation")
  }
})
```

#### PB 可借鉴的测试模式

| 模式 | 价值 | PB 现状 | 优先级 |
|------|------|---------|--------|
| **Mock Server** | E2E 测试无需真实 API | 无 | P1 |
| **安全命令测试** | 验证危险命令拦截 | command-classifier 有，测试不全 | P1 |
| **Scripted Model** | 确定性 LLM 响应模拟 | MockProvider 已有 | ✅ |
| **并发隔离测试** | 多 Agent 隔离验证 | 无 | P2 |
| **Context 取消测试** | 正确处理中断 | 部分有 | P2 |
| **Build Tags 分离** | 快速单元/慢集成分离 | vitest.config.js 部分实现 | P3 |
| **后台进程生命周期** | 完整生命周期验证 | 无 | P2 |
| **审计日志验证** | 安全合规 | 无 | P3 |

---

## 更新日志

| 日期 | 更新 |
|------|------|
| 2025-01-16 | 初始版本，来自架构评审 |
| 2025-01-16 | 新增 Code Stage 设计边界，与主流 CLI Agent (Rust/TS) 对比分析 |
| 2025-01-16 | 新增子 Agent 机制参考 (Explore/Plan/Bash/general-purpose)，可借鉴点分析 |
| 2025-01-16 | 新增测试方法参考 (TS/Go CLI Agent)，Mock Server、安全测试、并发隔离等模式 |
| 2026-01-19 | **深度架构评审**: 实测数据验证，新增 Linus 式改进路线图 (Phase 0-4) |
| 2026-01-19 | 问题清单重组: P0 (命名冲突) → P1 (Runtime 瘦身) → P2 (解耦) → P3 (优化) |
