# Audit History - sandbox

Archived issues from security audits.

---

## Archived: 2026-01-19

### [RESOLVED] console usage in production code
*Archived: 2026-01-19T20:45:13.048Z*

- **File**: js/agents/core/sandbox/system/executor.js:76
- **Description**: SystemSandboxExecutor 使用 console.warn 输出后端回退信息，违背日志规范。
- **Suggestion**: 改用项目 logger（createLogger）或注入 logger，保持日志一致性。
```
console.warn(
  `[SystemSandbox] Preferred backend '${this.config.preferredBackend}' not available, falling back...`
);
```

---

## Archived: 2026-01-19

### [RESOLVED] missing JSDoc for public API
*Archived: 2026-01-19T20:45:04.786Z*

- **File**: js/agents/core/sandbox/skill-executor.js:973
- **Description**: createSkillExecutor 缺少 @param/@returns JSDoc。
- **Suggestion**: 补充 JSDoc：说明 options 结构与返回 SkillExecutor。
```
/**
 * 创建执行器
 */
export function createSkillExecutor(options = {}) {
  return new SkillExecutor(options);
}
```

---

## Archived: 2026-01-19

### [RESOLVED] console usage in production code
*Archived: 2026-01-19T20:44:55.568Z*

- **File**: js/agents/core/sandbox/skill-executor.js:319
- **Description**: SkillExecutor 使用 console.warn 输出能力告警，违背日志规范。
- **Suggestion**: 改用 createLogger('core/sandbox/skill-executor') 记录告警，避免生产环境 console 残留。
```
// eslint-disable-next-line no-console
console.warn?.('[SkillExecutor] Unknown capability declared by skill', {
  skill: skill?.metadata?.name,
  capability: cap,
});
```

---

## Archived: 2026-01-19

### [RESOLVED] path traversal / host mount escape
*Archived: 2026-01-19T20:44:52.302Z*

- **File**: js/agents/core/sandbox/system/docker.js:125
- **Description**: Docker allowedWritePaths 对相对路径直接拼接 workDir，未规范化/校验 ..，可挂载到工作目录之外的宿主路径。
- **Suggestion**: 使用 normalizeSandboxPath 或 realpath 规范化并验证路径；拒绝包含 .. 的相对路径；确保允许写入路径必须位于 workDir 内或使用明确白名单。
```
const absPath = p.startsWith('/') ? p : `${workDir}/${p}`;
if (absPath.startsWith(workDir + '/') && !p.startsWith('/')) continue;
const containerPath = p.startsWith('/') ? `/mnt${p}` : `/workspace/${p}`;
args.push('-v', `${absPath}:${containerPath}`);
```

---

## Archived: 2026-01-19

### [RESOLVED] missing JSDoc for public API
*Archived: 2026-01-19T20:44:34.182Z*

- **File**: js/agents/core/sandbox/wasm-sandbox.js:392
- **Description**: createSandbox 缺少 @param/@returns JSDoc，不符合公共 API 文档规范。
- **Suggestion**: 补充 JSDoc：说明 options 结构与返回 Promise<WasmSandbox>。
```
/**
 * 快速创建沙箱
 */
export async function createSandbox(options = {}) {
  const sandbox = new WasmSandbox(options);
  await sandbox.init();
  return sandbox;
}
```

---

## Archived: 2026-01-19

### [RESOLVED] code injection / sandbox escape
*Archived: 2026-01-19T20:44:31.069Z*

- **File**: js/agents/core/sandbox/skill-executor.js:900
- **Description**: fallback 主线程路径使用 new Function + with 执行 Skill body，仅靠正则拦截；在 WASM/Worker 不可用且 fallbackMode="eval" 时，非可信代码可能绕过限制执行宿主代码。
- **Suggestion**: 默认禁用 eval fallback 或仅对通过 trustChecker 的 Skill 启用；优先 Worker/QuickJS 路径；如必须保留主线程 fallback，增加更强隔离（如 SES/Realms）并显式记录风险。
```
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

## Archived: 2026-01-18

### [RESOLVED] jsdoc
*Archived: 2026-01-18T20:51:10.445Z*

- **File**: js/agents/core/sandbox/plugin.js:16
- **Description**: 导出函数 createSandboxPlugin 缺少 @param/@returns 类型注解，不符合项目的 JSDoc 规范。
- **Suggestion**: 补充 options 结构和返回类型的 JSDoc 注解，至少包含 @param 与 @returns。
```
export function createSandboxPlugin(options = {}) {
```

---

## Archived: 2026-01-18

### [RESOLVED] security
*Archived: 2026-01-18T20:50:44.289Z*

- **File**: js/agents/core/sandbox/system/permission.js:37
- **Description**: Permission-only 模式默认权限处理器自动允许执行；若在生产环境使用，等同于跳过用户审批。
- **Suggestion**: 默认改为 deny 或在非开发环境强制要求显式传入 permissionHandler。
```
const defaultPermissionHandler = async () => 'allow-once';
```

---

## Archived: 2026-01-18

### [RESOLVED] convention
*Archived: 2026-01-18T20:50:13.356Z*

- **File**: js/agents/core/sandbox/plugin.js:56
- **Description**: 事件名使用 sandbox:emit:${name} 的动态拼接，可能产生多级冒号，违反 domain:action 命名约定并让事件名受外部输入影响。
- **Suggestion**: 固定事件名为 sandbox:emit，并将 name 放入 payload 或在 emit 前规范化为 domain:action。
```
ctx.events.emit(`sandbox:emit:${name}`, payload);
```

---

## Archived: 2026-01-18

### [RESOLVED] logic
*Archived: 2026-01-18T20:49:59.020Z*

- **File**: js/agents/core/sandbox/system/executor.js:131
- **Description**: _tryBackend 始终返回 true，preferredBackend 不可用时不会触发降级，可能导致执行器绑定到不可用后端。
- **Suggestion**: 在 _tryBackend 内部结合 detectAllBackends/detect* 校验可用性，不可用时返回 false 并触发回退。
```
return true;
```

---

## Archived: 2026-01-18

### [RESOLVED] security
*Archived: 2026-01-18T20:39:21.381Z*

- **File**: js/agents/core/sandbox/skill-executor.js:897
- **Description**: 主线程 fallback 通过 new Function + with 执行代码，仅靠正则过滤；当 WASM 不可用时，非可信 Skill 可能绕过限制并获得宿主执行权限。
- **Suggestion**: 将 fallbackMode 默认改为 'none'（需显式 opt-in 才允许 eval），或强制仅 Worker/worker_threads 模式并加更严格的隔离策略。
```
const fn = new Function('sandbox', wrappedCode);
```

---

