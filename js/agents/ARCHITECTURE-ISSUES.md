# js/agents 架构问题清单

> 来源：2025-01 架构评审
> 状态：待处理

## 概述

整体架构设计合格，微内核 + 三总线 + 插件系统方向正确。以下是需要关注的改进点。

---

## P1 - 应优先处理

### 1. Kernel 兼容层过重

**位置**: `core/kernel.js:260-353`

**问题**: Kernel 内 100+ 行是旧 API 兼容代码（`register`, `getService`, `emit`, `on`, `eventBus`, `container`），污染内核。

**建议**:
- 迁移完成后删除
- 或拆分到 `core/kernel-compat.js`，Kernel 只导入必要部分

---

### 2. Runtime 层过重

**位置**: `runtime/` (20+ 子目录)

**问题**: compression/memory/telemetry/hooks/di/parallel 全部塞在 runtime，职责过多。

**建议**:
- `compression/` → 考虑作为独立层或可选插件
- `memory/` → 同上
- `telemetry/` → 同上
- 保留 `core/`、`tools/`、`hooks/` 作为 runtime 核心

---

### 3. 构造函数参数过多

**位置**: `sdk/agent-factory.js:18-30`

```javascript
constructor({
  eventBus, logger, capabilities, toolExecutor,
  mcpConfig, subagentRegistry, compressor,
  backtrackManager, discoveryManager, actor, options,
}) { ... }
```

**问题**: 11 个参数，难以维护和测试。

**建议**:
- 分组为 `{ core, capabilities, managers, options }`
- 或使用 Builder 模式逐步构建

---

## P2 - 应逐步改进

### 4. typedef 分散

**位置**: `runtime/core/agent-loop.js:17-84` (67 行 typedef)

**问题**: 类型定义散落在业务文件开头，阅读体验差。

**建议**:
- 集中到 `types.d.ts` 或 `types.js`
- 业务文件使用 `@import {Type} from './types.js'`

---

### 5. 工具函数散落

**位置**: `runtime/orchestrator.js` 等

**问题**: `isPromiseLike`, `maybeAwait`, `normalizeTimeoutMs` 等工具函数散落在业务代码中。

**建议**:
- 移至 `shared/utils/`
- 按功能分类：`promise-utils.js`, `normalize-utils.js`

---

### 6. shared/ 职责不纯

**位置**: `shared/`

**问题**: utils/embeddings/contracts/archive/tokenizers 混在一起，缺乏清晰边界。

**建议**:
- `embeddings/` → 考虑归入 `retrieval/`
- `contracts/` → 考虑归入 `runtime/`
- `archive/` → 考虑归入 `storage/`

---

### 7. Stages 内嵌 runtime 子目录

**位置**: `stages/deepsearch/runtime/`, `stages/design/runtime/`

**问题**: Stage 内有自己的 runtime 子目录，与顶层 runtime 边界模糊。

**建议**:
- 重命名为 `stages/*/internal/` 或 `stages/*/helpers/`
- 明确这是 Stage 私有实现，非运行时组件

---

## P3 - 可选改进

### 8. 状态机硬编码

**位置**: `runtime/core/agent-loop.js:171-177`

```javascript
const DEFAULT_LOOP_STATUS_TRANSITIONS = Object.freeze({
  [AgentStatus.IDLE]: [AgentStatus.RUNNING, ...],
  ...
});
```

**问题**: 状态转换规则硬编码在代码中。

**建议**:
- 考虑配置化
- 或使用轻量状态机库

---

### 9. API 表面积大

**位置**: `index.js`

**问题**: 入口导出 50+ 符号，用户需要了解太多模块。

**建议**:
- 提供 `js/agents/prebuilt` 导出预组装 Agent
- 分层导出：`js/agents/core`, `js/agents/runtime`, `js/agents/stages`

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
