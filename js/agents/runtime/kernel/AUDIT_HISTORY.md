# Audit History - kernel

Archived issues from security audits.

---

## Archived: 2026-01-18

### [RESOLVED] input-validation
*Archived: 2026-01-18T21:22:57.584Z*

- **File**: js/agents/runtime/kernel/micro-kernel.js:194
- **Description**: schedule() 将 task 的 runtimeType/code 直接传入 scheduler.dispatch，缺少允许列表或长度/格式校验；若 task 来自外部输入，可能演化为代码执行或资源滥用风险。
- **Suggestion**: 在 MicroKernel 或 scheduler.dispatch 中引入 schema 校验与 runtimeType allowlist，并限制 code 长度/字符集。
```
const runtimeType = String(task.runtimeType || task.type || "");
const code = String(task.code || "");
const inputState = task.inputState && typeof task.inputState === "object" ? task.inputState : {};
const options = task.options && typeof task.options === "object" ? task.options : {};
return await this.scheduler.dispatch(runtimeType, code, inputState, {
```

### [RESOLVED] jsdoc
*Archived: 2026-01-18T21:22:57.584Z*

- **File**: js/agents/runtime/kernel/micro-kernel.js:21
- **Description**: 公开 API 的 JSDoc 缺少参数/返回值描述且使用 `any`，不符合项目 JSDoc 规范（禁用 any、必须描述）；应补齐 typedef 并为接口补 @returns/@throws。
- **Suggestion**: 为 options、provider、scheduler 定义 @typedef，替换 any；补齐参数/返回值描述与 @throws。
```
/**
 * @param {{ scheduler?: any, providers?: any[] }} [options]
 */
constructor(options = {}) {
```

### [RESOLVED] error-handling
*Archived: 2026-01-18T21:22:57.584Z*

- **File**: js/agents/runtime/kernel/micro-kernel.js:186
- **Description**: 错误类型使用通用 Error/TypeError，难以区分错误来源；与“使用自定义 Error 类区分错误类型”规范不符。
- **Suggestion**: 引入 MicroKernelError/MicroKernelConfigError 等自定义错误类型并统一抛出。
```
if (!task || typeof task !== "object") {
  throw new TypeError("MicroKernel.schedule(task): task must be a function or dispatch object");
}
```

### [RESOLVED] magic-number
*Archived: 2026-01-18T21:22:57.584Z*

- **File**: js/agents/runtime/kernel/micro-kernel.js:150
- **Description**: 默认超时使用硬编码 30_000，违反“避免魔法数字”规范。
- **Suggestion**: 提取为具名常量（例如 DEFAULT_REQUEST_TIMEOUT_MS）并集中管理。
```
const timeoutMs = toFiniteTimeoutMs(options?.timeoutMs ?? options?.timeout, 30_000);
```

---

