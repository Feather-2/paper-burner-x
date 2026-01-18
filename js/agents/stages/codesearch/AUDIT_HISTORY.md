# Audit History - codesearch

Archived issues from security audits.

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

