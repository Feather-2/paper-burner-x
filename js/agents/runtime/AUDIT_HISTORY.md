# Audit History - runtime

Archived issues from security audits.

---

## Archived: 2026-01-19

### [RESOLVED] hook-fail-closed
*Archived: 2026-01-19T20:51:32.183Z*

- **File**: js/agents/runtime/hooks/hook-runner.js:517
- **Description**: PreAgent hook 的异常在 blocking 默认 true 时会阻断主流程，与“pre/post hooks 异常不应中断主流程”的要求不一致，导致临时故障即拒绝执行。
- **Suggestion**: 将异常改为 fail-open（记录后继续），或显式要求 blocking=false；如安全场景确需 fail-closed，需在文档注明并加重试/超时保护。
```
try {
  const result = await hook.handler({ sessionId, runId, input, context });
  if (result?.skip && blocking) { ... return { skip: true, ... }; }
} catch (err) {
  if (blocking) {
    const reason = `PreAgent hook error: ${err?.message || String(err)}`;
    return { skip: true, ... };
  }
}
```

---

## Archived: 2026-01-19

### [RESOLVED] path-traversal
*Archived: 2026-01-19T20:47:33.561Z*

- **File**: js/agents/runtime/core/vfs-proxy-host.js:209
- **Description**: VfsProxyHost 仅 stripLeadingSlashes 即直接将 path 传给 VFS；未过滤 `..` 等路径穿越片段。若 VFS 未强制 basePath/realpath 校验，worker 可访问宿主任意路径。
- **Suggestion**: 在 host 侧强制路径规范化并拒绝 `..`/绝对路径；或将 basePath 注入并用 path.relative 校验；若依赖 VFS 自身保护，需在接口约定中强制说明并加断言。
```
const vfsPath = stripLeadingSlashes(path);

if (op === VFS_OPS.READ) {
  const bytes = await vfs.readFile(vfsPath);
  ...
}

if (op === VFS_OPS.WRITE) {
  await vfs.writeFile(vfsPath, data);
}
```

---

## Archived: 2026-01-19

### [RESOLVED] unsafe-deserialization
*Archived: 2026-01-19T20:46:45.941Z*

- **File**: js/agents/runtime/hooks/hooks-config-loader.js:356
- **Description**: HooksConfigLoader 对来自 VFS 的 JSON 配置直接 JSON.parse，仅检查为对象，缺少 schema 与大小限制。按清单属于未验证外部数据反序列化，可能导致异常行为或 DoS 风险。
- **Suggestion**: 为 hooks config 定义 schema 校验（字段、类型、枚举），限制最大大小/深度；拒绝未知字段或类型不匹配的配置。
```
try {
  const parsed = JSON.parse(text);
  if (!isPlainObject(parsed)) {
    logger.warn(...);
    return null;
  }
  return parsed;
} catch (err) { ... }
```

---

## Archived: 2026-01-19

### [RESOLVED] code-injection
*Archived: 2026-01-19T20:46:22.430Z*

- **File**: js/agents/runtime/core/js-adapter.js:435
- **Description**: 主线程 fallback 使用 new Function 动态执行代码。即便标注为 trusted-only，只要策略或上下文被误配置，仍可能导致任意代码执行/沙箱逃逸，违反“禁止 eval/new Function”要求。
- **Suggestion**: 移除主线程 fallback 或强制仅 Worker 沙箱执行；如必须保留，增加强制 allowlist + 来源校验，并确保 trustedOnly 不可被外部输入绕过；补充针对 untrusted 输入的拒绝测试。
```
// SECURITY: Fallback sandbox via new Function/with - TRUSTED-ONLY.
// eslint-disable-next-line no-new-func -- trusted-only fallback
const fn = new Function('sandbox', `
  return (async function () {
    with (sandbox) {
      ${code}
    }
  }).call(sandbox);
`);
```

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
- **Resolution**: 已将所有点分隔事件名统一改为冒号分隔格式。
```
RUN_STARTED: "run:started",
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

