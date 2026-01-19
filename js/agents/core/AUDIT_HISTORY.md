# Audit History - core

Archived issues from security audits.

---

## Archived: 2026-01-19

### [RESOLVED] prototype-pollution
*Archived: 2026-01-19T20:50:47.764Z*

- **File**: js/agents/core/state-bus.js:182
- **Description**: StateBus 的路径写入未过滤危险键名，若 path 来源包含 __proto__/constructor/prototype 等片段，可造成原型污染。
- **Suggestion**: 在 get/set/merge/delete 中拦截危险段（__proto__/constructor/prototype），或使用 Object.create(null) 作为存储并实现安全的路径解析。
```
current[lastKey] = value;
```

---

## Archived: 2026-01-19

### [RESOLVED] ssrf
*Archived: 2026-01-19T20:50:30.393Z*

- **File**: js/agents/core/secure-plugin-loader.js:301
- **Description**: SecurePluginLoader 允许传入任意 URL 并直接 fetch；在 Node 环境且 URL 可被外部控制时，存在 SSRF 风险（未限制私网/内网地址）。
- **Suggestion**: 在 Node 环境增加 allowlist/同源限制或私网地址拦截（如 127.0.0.0/8、169.254.0.0/16、10.0.0.0/8 等），并要求明确配置 baseUrl。
```
const response = await this.fetchImpl(normalizedUrl.url, { method: 'GET' });
```

---

## Archived: 2026-01-19

### [RESOLVED] code-injection
*Archived: 2026-01-19T20:50:22.620Z*

- **File**: js/agents/core/sandbox/skill-executor.js:900
- **Description**: fallback 路径使用 new Function 执行动态代码，若在 WASM 不可用且 fallbackMode=eval 时运行不可信 Skill，将造成代码注入/沙箱逃逸风险。
- **Suggestion**: 在 fallback eval 路径增加强制信任校验（仅允许 system scope 或显式 allowlist），并默认拒绝非可信代码；必要时记录告警并要求显式 opt-in。
```
const fn = new Function('sandbox', wrappedCode);
```

---

## Archived: 2026-01-18

### [RESOLVED] JSDoc Missing Types
*Archived: 2026-01-18T20:46:33.276Z*

- **File**: js/agents/core/presets.js:172
- **Description**: 导出函数缺少 JSDoc 类型注解，例如 mergePresetConfig/listPresets 没有 @param/@returns，不符合 JSDoc 完整性要求。
- **Suggestion**: 为导出函数补充 @param/@returns（含可选参数与默认值说明），保持核心 API 注解完整。
```
 * 合并预设与用户配置
 */
export function mergePresetConfig(presetName, userConfig = {}) {
```

---

## Archived: 2026-01-18

### [RESOLVED] Browser Compatibility
*Archived: 2026-01-18T20:44:18.519Z*

- **File**: js/agents/core/sandbox/index.js:26
- **Description**: sandbox/index.js 静态导出 system sandbox，会把 Node-only API（process/child_process/worker_threads）拉入浏览器构建，违反“无 Node-only API”的兼容性约定。
- **Suggestion**: 将 system sandbox 拆分为 Node-only 入口并用条件导出/动态 import；浏览器入口只暴露 WASM 沙箱或在运行时明确报错。
```
export {
  createSystemSandbox,
  execInSandbox,
  shellInSandbox,
  createBubblewrapExecutor,
  createSeatbeltExecutor,
  createDockerExecutor,
  createPermissionExecutor,
  createInteractivePermissionHandler,
} from './system/index.js';
```

---

## Archived: 2026-01-18

### [RESOLVED] Event Naming Convention
*Archived: 2026-01-18T20:41:36.870Z*

- **File**: js/agents/core/event-bus.js:88
- **Description**: 事件名校验仅允许 '.' 分隔，项目约定是 domain:action，且模块内已有 `crdt:op`、`sandbox:log` 等；因此 EventBus.on/subscribe 与 MessageBus.emit/on/request 会拒绝这些事件名。
- **Suggestion**: 更新 isValidEventName/isValidEventPattern 以支持 `:`（必要时兼容 `.`），并保持 MessageBus 与文档示例一致。
```
return typeof name === 'string' && /^[a-z0-9_]+(\.[a-z0-9_]+)*$/.test(name);
```

---

## Archived: 2026-01-18

### [RESOLVED] Unsafe Dynamic Code Execution
*Archived: 2026-01-18T20:40:27.718Z*

- **File**: js/agents/core/sandbox/skill-executor.js:897
- **Description**: fallbackMode 默认 'eval' 时主线程路径用 `new Function` + `with` 执行 `options.code`；正则过滤可被绕过，QuickJS 不可用时可能执行不可信代码，存在沙箱逃逸/任意代码执行风险。
- **Suggestion**: 默认将 fallbackMode 设为 'none' 或要求显式 allowUnsafeEval；仅对可信 Skill 启用 eval fallback，并增加强警告/遥测，避免将其视为安全边界。
```
// 构建受限执行函数（best-effort；不是强安全边界）
const wrappedCode = `
  return (async function () {
    with (sandbox) {
      ${options.code}
    }
  }).call(sandbox);
`;
const fn = new Function('sandbox', wrappedCode);
```

---

