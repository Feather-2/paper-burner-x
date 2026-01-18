# Audit History - sandbox

Archived issues from security audits.

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

