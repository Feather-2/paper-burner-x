# js/agents vs oh-my-opencode 对比分析

> 来源：2025-01 架构对比评审
> 状态：分析完成，待实施

## 概述

**oh-my-opencode (OMO)**: OpenCode 增强插件，提供多模型编排、后台代理、LSP/AST 工具
**js/agents**: 独立微内核 Agent 框架，跨平台 (Browser/Node/Deno/Bun)

---

## 架构对比

| 维度 | js/agents | oh-my-opencode |
|------|-----------|----------------|
| **定位** | 独立微内核框架 | OpenCode 插件 |
| **运行环境** | Browser / Node / Deno / Bun | Bun only (CLI) |
| **语言** | JavaScript + JSDoc | TypeScript |
| **构建依赖** | 无需编译 | bun build + tsc |
| **架构风格** | 微内核 + 四总线 + Plugin | 插件 API + Hooks + Tools |

### 架构分层

```
js/agents (微内核)                    oh-my-opencode (插件)
┌─────────────────┐                   ┌─────────────────┐
│    SDK Layer    │                   │  Plugin Entry   │
├─────────────────┤                   ├─────────────────┤
│     Stages      │ ← 业务阶段        │     Agents      │ ← 10+ 代理
├─────────────────┤                   ├─────────────────┤
│    Runtime      │ ← AgentLoop       │     Hooks       │ ← 22+ 钩子
├─────────────────┤                   ├─────────────────┤
│   Core/Kernel   │ ← 四总线          │     Tools       │ ← LSP/AST
├─────────────────┤                   ├─────────────────┤
│ Infrastructure  │ ← VFS/LLM/MCP     │   Features      │ ← 功能层
└─────────────────┘                   └─────────────────┘
```

---

## 能力矩阵

### js/agents 已有能力

| 能力 | 位置 | 说明 |
|------|------|------|
| **迭代循环** | `sdk/DefaultAgentLoop.js:464-534` | maxIterations 控制 |
| **并行任务图** | `runtime/parallel/task-graph.js` | Kahn 拓扑排序 |
| **上下文压缩** | `runtime/compression/` | Watchdog + Cicada + ProactiveCompressor |
| **命令分类** | `runtime/safety/command-classifier.js` | safe/unknown/dangerous |
| **降级矩阵** | `runtime/resilience/degradation-matrix.js` | Normal/Degraded/Critical/Offline |
| **钩子系统** | `runtime/hooks/` | 6 事件 (PreAgent/PostAgent/Pre+PostToolUse/Pre+PostLLMCall) |
| **溢出恢复** | `llm/overflow-recovery.js` | Anthropic + OpenAI 错误解析 |
| **多模型路由** | `llm/model-router.js` | 按 tag 选模型 |

### js/agents 超越 OMO 的能力

| 能力 | js/agents | OMO |
|------|-----------|-----|
| **主动压缩** | ProactiveCompressor (三级预设 + 质量监控) | 单阶段恢复 |
| **CRDT 共识** | `core/crdt/` 多 Agent 状态同步 | 无 |
| **WASM 沙箱** | `core/sandbox/` 安全技能执行 | 无 |
| **VFS 抽象** | `vfs/` Memory/OPFS/Storage | 无 |
| **文档摄取** | `ingest/` 10+ 格式适配器 | 无 |
| **混合检索** | `retrieval/` BM25 + Vector + MMR | 无 |
| **降级矩阵** | 四级运行状态 | 无 |

### OMO 独有能力 (js/agents 缺失)

| 能力 | OMO 位置 | 说明 |
|------|----------|------|
| **Ralph Loop** | `hooks/ralph-loop/` | 自动继续直到完成 |
| **readonly 模式** | `agents/oracle.ts` | `tools: { include: [] }` |
| **后台代理管理** | `features/background-agent/` | BackgroundManager + ConcurrencyManager |
| **LSP 工具** | `tools/lsp/` | 11 个语义化工具 |
| **AST 搜索** | `tools/ast-grep/` | @ast-grep/napi |
| **请求分类** | `agents/sisyphus.ts` | Trivial/Explicit/Exploratory/Ambiguous |
| **完成标记检测** | `hooks/ralph-loop/` | `<promise>TASK_COMPLETE</promise>` |

---

## OMO 核心机制详解

### 1. Ralph Loop 自动继续

**位置**: `src/hooks/ralph-loop/index.ts`

**机制**:
1. 用户启动循环并指定任务
2. 监听 `session.idle` 事件
3. 检测完成标记 `<promise>TASK_COMPLETE</promise>`
4. 未完成则注入继续提示，重复直到完成或达到 max_iterations

**继续提示模板**:
```
[RALPH LOOP - ITERATION {{ITERATION}}/{{MAX}}]

Your previous attempt did not output the completion promise.
Continue working on the task.

IMPORTANT:
- Review your progress so far
- Continue from where you left off
- When FULLY complete, output: <promise>{{PROMISE}}</promise>
- Do not stop until the task is truly done

Original task:
{{PROMPT}}
```

**配置**:
```json
{
  "ralph_loop": {
    "max_iterations": 50,
    "completion_promise": "TASK_COMPLETE"
  }
}
```

### 2. 多模型代理分工

| Agent | 模型 | 职责 | 工具权限 |
|-------|------|------|----------|
| **Sisyphus** | claude-opus-4-5 | 主编排器 | 全部 |
| **oracle** | gpt-5.2 | 只读咨询 | `tools: { include: [] }` |
| **librarian** | claude-sonnet-4-5 | 多仓库分析 | 读取类 |
| **explore** | grok-code | 快速探索 | 读取类 |
| **frontend** | gemini-3-pro | UI 生成 | 全部 |

**关键**: oracle 是**只读咨询角色**，无工具权限，用于第二意见

### 3. Sisyphus 请求分类

**位置**: `src/agents/sisyphus.ts:53-99`

**分类流程**:
```
Step 0: 检查 Skills 匹配 → 立即调用
Step 1: 分类请求类型
  - Skill Match → 调用 skill 工具
  - Trivial → 直接工具
  - Explicit → 直接执行
  - Exploratory → 并行 explore + 工具
  - Open-ended → 先评估代码库
  - Ambiguous → 询问一个问题
Step 2: 检查歧义 (2x+ 工作量差异必须询问)
Step 3: 验证假设再行动
```

**挑战用户**: 发现设计缺陷时主动提出替代方案

### 4. 后台代理管理

**位置**: `src/features/background-agent/manager.ts`

**核心类**:
```typescript
class BackgroundManager {
  async launch(input: LaunchInput): Promise<BackgroundTask>
  async resume(input: ResumeInput): Promise<BackgroundTask>
  getTask(taskId: string): BackgroundTask | undefined
  getNotifications(sessionID: string): BackgroundTask[]
}
```

**并发控制**:
```typescript
class ConcurrencyManager {
  async acquire(key: string): Promise<void>
  release(key: string): void
}
```

**配置**:
```json
{
  "background_tasks": {
    "categories": {
      "research": { "maxConcurrency": 3 },
      "coding": { "maxConcurrency": 2 }
    }
  }
}
```

---

## 建议实施方案

### P0 - 立即实施

#### 1. Ralph Loop 自动继续

**文件**: `sdk/DefaultAgentLoop.js`

```javascript
// 新增选项
constructor(opts) {
  this.autoContinue = opts.autoContinue ?? false;
  this.completionMarker = opts.completionMarker ?? 'TASK_COMPLETE';
  this.maxContinuations = opts.maxContinuations ?? 50;
}

// 检测完成标记
_detectCompletionMarker(content) {
  const pattern = new RegExp(
    `<promise>\\s*${this.completionMarker}\\s*</promise>`,
    'i'
  );
  return pattern.test(content);
}

// 构建继续提示
_buildContinuationPrompt(iteration) {
  return `[AUTO-CONTINUE - ITERATION ${iteration}/${this.maxContinuations}]

Your previous response did not include the completion marker.
Continue working on the task.

When FULLY complete, output: <promise>${this.completionMarker}</promise>`;
}

// 在 run() 末尾
if (i >= this.maxIterations && this.autoContinue && this._continuationCount < this.maxContinuations) {
  if (!this._detectCompletionMarker(lastContent)) {
    this._continuationCount++;
    this.addMessage({ role: 'user', content: this._buildContinuationPrompt(this._continuationCount) });
    return this._runLoop(context, signal); // 继续循环
  }
}
```

#### 2. readonly 模式

**文件**: `sdk/AgentBuilder.js`

```javascript
class AgentBuilder {
  readOnly() {
    this._permissionLevel = 'readonly';
    this._tools = { include: [] };
    return this;
  }

  // 在 build() 中
  if (this._permissionLevel === 'readonly') {
    config.tools = [];
    config.toolExecutor = null;
  }
}
```

**文件**: `runtime/core/tool-registry.js`

```javascript
// 新增权限检查
filterByPermission(level) {
  if (level === 'readonly') return [];
  if (level === 'elevated') return this._tools;
  // standard: 过滤危险工具
  return this._tools.filter(t => !t.dangerous);
}
```

### P1 - 短期实施

#### 3. 完成标记检测

**文件**: `sdk/DefaultAgentLoop.js`

```javascript
// 增强 parseDecision
function parseDecision(content) {
  // 优先检测完成标记
  if (detectCompletionMarker(content)) {
    return { action: 'complete', final: extractFinalOutput(content) };
  }
  // 现有 JSON 解析逻辑
  // ...
}
```

#### 4. 后台任务事件

**文件**: `runtime/parallel/task-graph.js` (扩展)

```javascript
// 新增任务状态事件
this.eventBus?.emit('task:started', { taskId, description });
this.eventBus?.emit('task:completed', { taskId, result });
this.eventBus?.emit('task:failed', { taskId, error });
```

### P2 - 中期实施

#### 5. 请求分类中间件

**新文件**: `runtime/middleware/request-classifier.js`

```javascript
export const RequestType = {
  TRIVIAL: 'trivial',
  EXPLICIT: 'explicit',
  EXPLORATORY: 'exploratory',
  OPEN_ENDED: 'open_ended',
  AMBIGUOUS: 'ambiguous',
};

export function classifyRequest(prompt, context) {
  // 基于 prompt 特征分类
  if (isSingleFileQuestion(prompt)) return RequestType.TRIVIAL;
  if (hasExplicitTarget(prompt)) return RequestType.EXPLICIT;
  if (isHowQuestion(prompt)) return RequestType.EXPLORATORY;
  if (isOpenEnded(prompt)) return RequestType.OPEN_ENDED;
  return RequestType.AMBIGUOUS;
}

export function createClassifierMiddleware() {
  return {
    name: 'request-classifier',
    before: async (ctx) => {
      ctx.requestType = classifyRequest(ctx.input, ctx);
      if (ctx.requestType === RequestType.AMBIGUOUS) {
        // 可选：自动询问澄清
      }
    },
  };
}
```

#### 6. 后台代理管理器

**新文件**: `runtime/parallel/background-manager.js`

```javascript
export class BackgroundManager {
  constructor(options = {}) {
    this.tasks = new Map();
    this.eventBus = options.eventBus;
    this.limits = options.limits ?? { default: 5 };
  }

  async launch({ agent, prompt, parentId }) {
    const taskId = `bg_${crypto.randomUUID().slice(0, 8)}`;
    const task = {
      id: taskId,
      agent,
      prompt,
      parentId,
      status: 'running',
      startedAt: Date.now(),
    };
    this.tasks.set(taskId, task);
    this.eventBus?.emit('background:started', { taskId });
    // 异步执行
    this._executeAsync(task);
    return taskId;
  }

  getStatus(taskId) {
    return this.tasks.get(taskId)?.status;
  }

  getResult(taskId) {
    const task = this.tasks.get(taskId);
    if (task?.status === 'completed') return task.result;
    return null;
  }
}
```

---

## LSP/AST 能力扩展方案

js/agents 已有 tree-sitter WASM 基础设施 (`shared/parser/tree-sitter-wasm.js`)，可进一步扩展：

### 现有能力

| 能力 | 位置 | 状态 |
|------|------|------|
| **tree-sitter WASM** | `shared/parser/tree-sitter-wasm.js` | ✅ 已实现 |
| **符号索引** | `stages/codesearch/indexing/symbol-indexer.js` | ✅ 已实现 |
| **语言支持** | JS/TS/TSX/JSON | ✅ 已实现 |

### 跨平台扩展方案

| 能力 | Browser | Node.js | 方案 |
|------|---------|---------|------|
| **AST 解析** | ✅ tree-sitter WASM | ✅ tree-sitter WASM / native | 已有 |
| **结构化搜索** | ✅ 自实现 pattern match | ✅ @ast-grep/napi | 可扩展 |
| **符号提取** | ✅ SymbolIndexer | ✅ SymbolIndexer | 已有 |
| **LSP 客户端** | ❌ 不可用 | ✅ 可实现 | 新增 Node 专用 |
| **跳转定义** | ⚠️ 基于索引模拟 | ✅ LSP | 分层实现 |
| **查找引用** | ⚠️ 基于索引模拟 | ✅ LSP | 分层实现 |
| **重命名** | ⚠️ 基于 AST 替换 | ✅ LSP | 分层实现 |

### P2 - 建议扩展

#### 1. AST 结构化搜索 (跨平台)

**新文件**: `shared/parser/ast-query.js`

```javascript
import { initTreeSitter, loadTreeSitterLanguage } from './tree-sitter-wasm.js';

/**
 * 跨平台 AST 结构化搜索
 * Browser: tree-sitter WASM
 * Node: 优先 @ast-grep/napi，回退 tree-sitter
 */
export async function astQuery(code, pattern, lang) {
  // Node 端优先使用 ast-grep
  if (isNodeLike() && await hasAstGrep()) {
    return astGrepQuery(code, pattern, lang);
  }
  // 通用 tree-sitter 实现
  return treeSitterQuery(code, pattern, lang);
}

// 模式匹配示例
// pattern: "function $NAME($ARGS) { $BODY }"
// pattern: "console.log($$$)"
```

#### 2. LSP 工具层 (Node 专用)

**新文件**: `tools/lsp/index.js` (Node only)

```javascript
import { isNodeLike } from '../../shared/platform.js';

// 仅 Node 端导出
export const lspTools = isNodeLike() ? {
  lsp_hover: createLspHoverTool(),
  lsp_goto_definition: createLspGotoDefinitionTool(),
  lsp_find_references: createLspFindReferencesTool(),
  lsp_rename: createLspRenameTool(),
} : {};

// 浏览器端提供降级实现
export const lspFallbackTools = {
  // 基于 SymbolIndexer 的模拟实现
  goto_definition_fallback: async ({ filePath, line, character }) => {
    const symbols = await indexer.getByFile(filePath);
    return findDefinitionFromIndex(symbols, line, character);
  },
};
```

#### 3. 语言支持扩展

详见 **`docs/tree-sitter-languages.md`**

**支持矩阵**:

| Tier | 语言 | 优先级 |
|------|------|--------|
| **Tier 1** | Python, Markdown, HTML, CSS, YAML, TOML | P1 |
| **Tier 2** | Go, Rust, C, C++, Java, Kotlin | P2 |
| **Tier 3** | Ruby, PHP, Swift, Bash, SQL, Lua, Zig | P3 |

**文件大小**: Tier 1 ~1.2MB, 全部 ~3.5MB (gzip)

**优化**: 懒加载 + CDN + 可选预加载

### OMO AST-Grep 对比

| 维度 | OMO (@ast-grep/napi) | js/agents (tree-sitter WASM) |
|------|---------------------|------------------------------|
| **运行环境** | Node only | Browser + Node |
| **语言数量** | 25+ (CLI) / 5 (NAPI) | 可扩展 (需加 WASM) |
| **模式语法** | ast-grep DSL | 可自定义 |
| **依赖** | native binding | 纯 WASM |
| **安装** | 需编译 | 零编译 |

### 优先级

| 优先级 | 能力 | 工作量 | 价值 |
|--------|------|--------|------|
| **P2** | AST 结构化搜索 | 中 | 高 (代码理解) |
| **P2** | 更多语言 WASM | 低 | 中 (语言覆盖) |
| **P3** | LSP 工具 (Node) | 高 | 中 (可通过 MCP 替代) |
| **P3** | 浏览器 LSP 降级 | 中 | 低 (索引已够用) |

---

## 不采纳的 OMO 特性

| 特性 | 原因 |
|------|------|
| **@ast-grep/napi 直接依赖** | native binding 破坏跨平台，用 tree-sitter WASM 替代 |
| **TypeScript** | js/agents 坚持 JS + JSDoc 零构建 |
| **OpenCode 插件 API** | js/agents 是独立框架 |

---

## 与 ARCHITECTURE-ISSUES.md 的关系

| ARCHITECTURE-ISSUES 问题 | OMO 是否解决 | 说明 |
|--------------------------|-------------|------|
| **readonly 模式** (P1) | ✅ 解决 | oracle 代理模式 |
| **Checkpoint 持久化** (P1) | ⚠️ 部分 | ralph-loop 有 storage，非通用 |
| **工具白名单/黑名单** (P2) | ✅ 解决 | tools.include/exclude |
| **结构化 Plan 输出** (P2) | ⚠️ 部分 | 有分类无 schema |
| **Agent 类型分离** (P2) | ✅ 解决 | 10+ 代理明确分工 |

**互补关系**:
- OMO 解决运行时能力 (Ralph Loop, readonly, 多模型分工)
- ARCHITECTURE-ISSUES 解决基础设施 (Checkpoint, apply-patch, Mock Server)

---

## 优先级汇总

| 优先级 | 能力 | 来源 | 工作量 | 价值 |
|--------|------|------|--------|------|
| **P0** | Ralph Loop 自动继续 | OMO | 低 | 高 |
| **P0** | readonly 模式 | OMO + ARCH | 低 | 高 |
| **P1** | 完成标记检测 | OMO | 低 | 中 |
| **P1** | Checkpoint 持久化 | ARCH | 中 | 高 |
| **P1** | Mock Server | ARCH | 中 | 高 |
| **P2** | 后台任务管理器 | OMO | 中 | 中 |
| **P2** | 请求分类中间件 | OMO | 中 | 中 |
| **P2** | 并发隔离测试 | ARCH | 中 | 中 |

---

## 参考资料

- OMO 仓库: `ref/oh-my-opencode-dev/`
- OMO AGENTS.md: `ref/oh-my-opencode-dev/AGENTS.md`
- OMO Ralph Loop: `ref/oh-my-opencode-dev/src/hooks/ralph-loop/`
- OMO Sisyphus: `ref/oh-my-opencode-dev/src/agents/sisyphus.ts`
- OMO Background Agent: `ref/oh-my-opencode-dev/src/features/background-agent/`

---

## 更新日志

| 日期 | 更新 |
|------|------|
| 2025-01-16 | 初始版本，OMO vs js/agents 完整对比 |
