# Audit History - runtime

Archived issues from security audits.

---

## Archived: 2026-01-18

### [RESOLVED] code-exec
*Archived: 2026-01-18T21:17:22.104Z*

- **File**: js/agents/runtime/core/js-adapter.js:437
- **Description**: JS 运行时通过 new Function 执行代码，且 Python worker 的 legacy loadScript 使用 AsyncFunction；若输入未严格信任/校验，存在代码执行或沙箱逃逸风险。另见 js/agents/runtime/tools/python-runtime-worker.js:620。
- **Suggestion**: 仅对可信代码启用并强化 allowlist/校验；默认禁用 legacy loadScript；在 Worker 中严格隔离并记录审计。
```
// eslint-disable-next-line no-new-func
const fn = new Function('sandbox', `
  return (async function () {
    with (sandbox) {
      ${code}
    }
  }).call(sandbox);
`);
```

### [RESOLVED] browser-compat
*Archived: 2026-01-18T21:17:22.104Z*

- **File**: js/agents/runtime/exec/command-executor.js:8
- **Description**: Node-only API 在非 .node.js 文件中直接导入（如 exec/command-executor 与 tools/tool-executor-worker）；若被浏览器打包会直接崩溃。
- **Suggestion**: 将 Node 实现移至 .node.js 并通过 index.browser.js stub/动态 import 保护，或确保构建时排除这些模块。
```
import { spawn } from 'node:child_process';
```

### [RESOLVED] jsdoc
*Archived: 2026-01-18T21:17:22.104Z*

- **File**: js/agents/runtime/core/lifecycle.js:48
- **Description**: 导出函数缺少 @param/@returns 或完整 JSDoc；扫描到 20 个文件、56 个导出受影响（如 lifecycle、middleware、todo-normalize、loop-runtime-state、tool-executor 等）。
- **Suggestion**: 为导出函数补齐 @param/@returns（或 @returns {void}），确保类型注解完整。
```
/**
 * 标准事件 payload 格式
 */
export function createEventPayload(actor, status, data = {}) {
```

### [RESOLVED] event-naming
*Archived: 2026-01-18T21:17:22.104Z*

- **File**: js/agents/runtime/events/events.js:22
- **Description**: 事件常量使用 domain.action 点号格式，与约定的 domain:action 不一致，可能影响事件路由/过滤。
- **Suggestion**: 统一改为 run:started 风格或在 EventBus 层提供兼容映射。
```
RUN_STARTED: "run.started",
```

### [RESOLVED] logging
*Archived: 2026-01-18T21:17:22.104Z*

- **File**: js/agents/runtime/hooks/hooks-config-loader.js:137
- **Description**: 运行时路径中存在 console.warn（hooks-config-loader/orchestrator/l3-storage），与日志规范不一致且可能产生噪声。
- **Suggestion**: 改用 createLogger 或按 debug 级别输出，并返回结构化错误给调用方。
```
console.warn(`[HooksConfigLoader] Failed to read hooks config: ${this._configPath}`, err);
```

### [RESOLVED] todo
*Archived: 2026-01-18T21:17:22.104Z*

- **File**: js/agents/runtime/core/js-adapter.js:10
- **Description**: 核心适配器保留 TODO（quickjs-emscripten 沙箱），属于未完成技术债。
- **Suggestion**: 补充 Issue/计划并在实现后清理 TODO，避免长期悬挂。
```
* TODO(AI4Sci): 添加 quickjs-emscripten WASM 沙箱作为第三层
```

---

