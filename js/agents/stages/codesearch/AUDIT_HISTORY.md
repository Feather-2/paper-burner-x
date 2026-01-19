# Audit History - codesearch

Archived issues from security audits.

---

## Archived: 2026-01-19

### [RESOLVED] 浏览器兼容性/Node-only API
*Archived: 2026-01-19T21:03:31.540Z*

- **File**: js/agents/stages/codesearch/code-tools.js:389
- **Description**: read_file/grep/list_dir/tree 依赖 fs.readFile/readdir/stat，未提供 vfs.readText fallback，和 Browser-first 约定不一致；浏览器运行时工具会直接失败。
- **Suggestion**: 为 read_file 等读操作加入 vfs.readText fallback，或在系统提示中禁用这些工具并标注 Node-only。
```
if (!fs?.readFile) {
  throw new Error("fs.readFile not available");
}
```

---

## Archived: 2026-01-19

### [RESOLVED] 测试反模式
*Archived: 2026-01-19T21:03:20.874Z*

- **File**: js/agents/stages/codesearch/test.js:38
- **Description**: tests 仅打印日志无断言，属于伪测试，无法满足覆盖率与边界验证要求。
- **Suggestion**: 添加断言（结构/数量/错误分支），并补充边界与异常输入测试。
```
console.log("--- Test: list_dir ---");
const listResult = await tools.list_dir({ path: "js/agents/stages" });
console.log("list_dir result:", JSON.stringify(listResult, null, 2));
```

---

## Archived: 2026-01-19

### [RESOLVED] 不安全反序列化
*Archived: 2026-01-19T21:03:17.603Z*

- **File**: js/agents/stages/codesearch/phases/planning-phase.js:70
- **Description**: Todo 规划阶段直接对 LLM 输出 JSON.parse，仅做浅层数组/对象判断，缺少 schema 与长度限制，异常输出可能污染 todo 结构或导致流程异常。
- **Suggestion**: 解析前限制文本长度，并对字段进行严格 schema 校验（字段白名单 + 类型约束）；失败时要求模型重试或返回受控错误。
```
const parsed = JSON.parse(jsonMatch[1]);
if (Array.isArray(parsed)) return parsed;
```

---

## Archived: 2026-01-19

### [RESOLVED] 错误处理
*Archived: 2026-01-19T21:02:46.213Z*

- **File**: js/agents/stages/codesearch/code-tools.js:353
- **Description**: grep 工具读文件失败时使用空 catch 吞掉异常，违反“不要吞掉异常”约定，排障困难。
- **Suggestion**: 至少记录 warn（包含 path 和错误摘要），或把失败统计返回给调用方。
```
try {
  const content = await read_file({ path: file });
  if (content.content) {
    chunks.push({ chunkId: file, text: content.content });
  }
} catch {
  // 跳过无法读取的文件
}
```

---

## Archived: 2026-01-19

### [RESOLVED] 不安全反序列化
*Archived: 2026-01-19T21:02:40.004Z*

- **File**: js/agents/stages/codesearch/phases/execution-phase.js:95
- **Description**: 执行阶段对 LLM 响应 JSON.parse 并用正则 fallback 解析 args，缺少 action/args schema 校验，可能导致异常状态更新或工具参数污染。
- **Suggestion**: 为 decision 定义严格 schema（action 枚举、args 白名单、todoId 格式），解析失败时返回可恢复错误并要求模型重试。
```
const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
if (jsonMatch) {
  parsed = JSON.parse(jsonMatch[1]);
}
```

---

## Archived: 2026-01-19

### [RESOLVED] 路径穿越
*Archived: 2026-01-19T21:02:36.476Z*

- **File**: js/agents/stages/codesearch/code-tools.js:235
- **Description**: safePath 允许 basePath 为空或为 '/' 时接受任意绝对路径，且未阻止 Windows 盘符路径；basePath 来自 input?.basePath（可能为 UI/LLM 输入），导致 read_file/write_file/multi_edit/list_dir/tree/index_symbols 可越过项目根目录访问或写入。
- **Suggestion**: 固定可信的 baseRoot，并使用 path.resolve(baseRoot, inputPath) 后校验前缀；拒绝 Windows 盘符/UNC 路径；不要接受用户传入 '/' 或空值作为 basePath。
```
function safePath(inputPath) {
  const path = String(inputPath || "").trim();
  if (path.startsWith("/")) {
    if (!normalizedBasePath || normalizedBasePath === "/") return path;
    if (path === normalizedBasePath || path.startsWith(`${normalizedBasePath}/`)) return path;
    throw new Error(`Invalid path: ${path}`);
  }
  return path;
}
```

---

## Archived: 2026-01-18

### [RESOLVED] browser-compatibility
*Archived: 2026-01-18T21:25:28.283Z*

- **File**: `js/agents/stages/codesearch/codesearch-stage.js`:499
- **Description**: 在浏览器环境中仍尝试动态导入 node:fs/promises；即使 try/catch 包裹，打包器/运行时可能报错或导致功能不可用，违反“无 Node-only API”约定。
- **Suggestion**: 仅通过依赖注入提供 fs（或拆分 Node 适配层），浏览器构建中移除/替换该导入。
```
  async _getDefaultFs() {
    try {
      const { readFile, readdir, stat } = await import("node:fs/promises");
      return { readFile, readdir, stat };
    } catch {
      return null;
    }
  }
```

### [RESOLVED] error-handling
*Archived: 2026-01-18T21:25:28.283Z*

- **File**: `js/agents/stages/codesearch/phases/execution-phase.js`:119
- **Description**: 对 LLM 输出的 args 进行 JSON.parse 时未捕获异常，格式不合法会直接抛错并中断执行阶段。
- **Suggestion**: 用 try/catch 包裹 JSON.parse，失败时回退到空对象并记录告警。
```
    const argsMatch = text.match(/"args"\s*:\s*(\{[^}]+\})/);

    if (actionMatch || toolMatch) {
      parsed = {
        action: actionMatch?.[1] || toolMatch?.[1],
        args: argsMatch ? JSON.parse(argsMatch[1]) : {},
      };
    }
```

### [RESOLVED] error-handling
*Archived: 2026-01-18T21:25:28.283Z*

- **File**: `js/agents/stages/codesearch/phases/summarizing-phase.js`:115
- **Description**: catch 分支直接访问 err.message，若抛出值为 null/undefined 会导致 catch 本身抛错，影响总结阶段稳定性。
- **Suggestion**: 使用 `err instanceof Error ? err.message : String(err)` 或 `err?.message` 进行安全归一化。
```
  } catch (err) {
    logger.error("Summary generation failed", { error: err.message });
    summary = state.finalThought || `分析完成，共 ${state.steps.length} 步`;
  }
```

### [RESOLVED] convention
*Archived: 2026-01-18T21:25:28.283Z*

- **File**: `js/agents/stages/codesearch/codesearch-stage.js`:120
- **Description**: 事件名使用点分隔，未遵循 domain:action 约定，可能与事件订阅规范不一致。
- **Suggestion**: 统一改为冒号格式（例如 `codesearch:agent.status.changed`），并同步更新 emit/listener。
```
    this.initLoopStatus({
      status: AgentStatus.IDLE,
      eventName: "codesearch.agent.status.changed",
    });
```

### [RESOLVED] jsdoc
*Archived: 2026-01-18T21:25:28.283Z*

- **File**: `js/agents/stages/codesearch/phases/execution-phase.js`:198
- **Description**: 导出的 runExecutionStep 缺少 @param/@returns 类型注解，JSDoc 覆盖不完整。
- **Suggestion**: 为入参/返回值补充 JSDoc（可复用已有 typedef）。
```
/**
 * 运行执行阶段（单步）
 */
export async function runExecutionStep({
  state,
  step,
  maxSteps,
  systemPrompt,
  callModel,
  tools,
  budgetManager,
  emit,
  signal,
}) {
```

### [RESOLVED] jsdoc
*Archived: 2026-01-18T21:25:28.283Z*

- **File**: `js/agents/stages/codesearch/codesearch-stage.js`:510
- **Description**: 导出的 runCodeSearchStage/registerCodeSearchStages 未提供 @param/@returns 类型注解。
- **Suggestion**: 补充 JSDoc 参数和返回类型以满足 JS+JSDoc 规范。
```
/**
 * 便捷函数
 */
export async function runCodeSearchStage(runContext, input, stageApi = {}) {
  const stage = new CodeSearchStage(input?.options);
  return stage.execute(runContext, input, stageApi);
}

/**
 * 注册到 Orchestrator
 */
export function registerCodeSearchStages(orchestrator, { timeoutMs = 120_000 } = {}) {
  orchestrator.registerStage("codesearch.pipeline", runCodeSearchStage, {
    actor: "codesearch",
    timeoutMs,
  });
}
```

### [RESOLVED] jsdoc
*Archived: 2026-01-18T21:25:28.283Z*

- **File**: `js/agents/stages/codesearch/code-tools.js`:795
- **Description**: 导出的 formatToolDefinitionsForLLM 缺少 @returns 类型注解。
- **Suggestion**: 补充 `@returns {string}` 等类型注解。
```
/**
 * 格式化工具定义为 LLM 可读格式
 */
export function formatToolDefinitionsForLLM() {
  return TOOL_DEFINITIONS.map(tool => {
```

---

