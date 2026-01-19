# Audit History - exec

Archived issues from security audits.

---

## Archived: 2026-01-19

### [RESOLVED] 测试覆盖不足
*Archived: 2026-01-19T20:55:31.900Z*

- **File**: tests/integration/agents/exec.test.js:9
- **Description**: 现有集成测试覆盖了主要路径与超时/AbortSignal，但未覆盖清单要求的空值/类型边界、execShell 空字符串、并发/资源边界等。
- **Suggestion**: 补充 null/undefined/空字符串、类型错误、并发调用、超大输出等边界测试，并避免依赖时间顺序。
```
describe("runtime/exec", () => {
  describe("exec", () => {
    it("executes command and returns result", async () => {

```

---

## Archived: 2026-01-19

### [RESOLVED] JSDoc 不完整
*Archived: 2026-01-19T20:55:10.903Z*

- **File**: js/agents/runtime/core/exec/command-executor.browser.js:15
- **Description**: 浏览器 stub 的 public API JSDoc 缺少参数描述，违反 JSDoc 规范。
- **Suggestion**: 为每个 @param 添加简短描述（例如“命令名/参数/执行选项”）。
```
/**
 * @param {string} _command
 * @param {string[]} [_args]
 * @param {ExecOptions} [_options]
 * @returns {Promise<ExecResult>}
 */
export async function exec(_command, _args = [], _options = {}) {
```

---

## Archived: 2026-01-19

### [RESOLVED] 函数过长/复杂度
*Archived: 2026-01-19T20:54:54.584Z*

- **File**: js/agents/runtime/core/exec/command-executor.node.js:57
- **Description**: exec 函数超过 200 行且嵌套回调较深，违反 <=50 行/单一职责约定，维护与测试成本高。
- **Suggestion**: 拆分为独立 helper（spawn、timeout、stdout/stderr 收集、finish/cleanup）以降低复杂度。
```
export async function exec(command, args = [], options = {}) {
  const startTime = Date.now();
  const opts = options && typeof options === 'object' ? options : {};

```

---

## Archived: 2026-01-19

### [RESOLVED] 异常吞掉
*Archived: 2026-01-19T20:54:40.213Z*

- **File**: js/agents/runtime/core/exec/command-executor.node.js:92
- **Description**: 存在多个空 catch 块吞掉异常（cleanup kill、stdout/stderr 回调、commandExists），违反错误处理约定，问题排查困难。
- **Suggestion**: 至少记录日志（如 logger.warn/error）或把异常信息附加到 ExecResult；回调异常可隔离但不要静默丢弃。
```
try {
  child.kill('SIGKILL');
} catch {
  // ignore
}
```

---

## Archived: 2026-01-19

### [RESOLVED] JSDoc 与实现不一致
*Archived: 2026-01-19T20:52:41.800Z*

- **File**: js/agents/runtime/core/exec/command-executor.node.js:274
- **Description**: execShell JSDoc 标注 @throws，但实现对非法 command 仅返回错误结果，不会抛出异常。
- **Suggestion**: 要么改为抛出 Error，要么移除 @throws 并在文档说明返回 error 字段。
```
/**
 * @param {string} command - Shell 命令字符串
 * @param {ExecOptions} [options={}] - 选项
 * @returns {Promise<ExecResult>}
 * @throws {Error} 若 command 为空或非字符串
 */
export async function execShell(command, options = {}) {
```

---

## Archived: 2026-01-19

### [RESOLVED] 命令注入
*Archived: 2026-01-19T20:52:35.384Z*

- **File**: js/agents/runtime/core/exec/command-executor.node.js:280
- **Description**: execShell 直接把 command 交给系统 shell 执行，未做白名单或转义；若任何不可信输入流入将导致命令注入/RCE。
- **Suggestion**: 仅允许受信任的命令来源或使用白名单；对不可信输入强制改用 exec(cmd, args) 并拒绝 shell/命令字符串。
```
export async function execShell(command, options = {}) {
  if (typeof command !== 'string' || command.trim() === '') {
    return {
      success: false,
      exitCode: -1,
      signal: null,
      stdout: '',
      stderr: '',
      duration: 0,
      timedOut: false,
      truncated: false,
      error: 'execShell: command must be a non-empty string',
    };
  }
  const isWindows = process.platform === 'win32';
  const shell = isWindows ? 'cmd.exe' : '/bin/sh';
  const shellArgs = isWindows ? ['/c', command] : ['-c', command];
  return exec(shell, shellArgs, { ...options, shell: false });
}
```

---

## Archived: 2026-01-18

### [RESOLVED] security
*Archived: 2026-01-18T21:22:32.144Z*

- **File**: js/agents/runtime/exec/command-executor.js:264
- **Description**: execShell 直接把 command 交给系统 shell 执行，若由不可信输入拼接将导致命令注入/RCE 风险。
- **Suggestion**: 仅在可信输入下使用 execShell；不可信输入改用 exec(command, args) 或进行严格白名单/转义。
```
const shellArgs = isWindows ? ['/c', command] : ['-c', command];
```

### [RESOLVED] compatibility
*Archived: 2026-01-18T21:22:32.144Z*

- **File**: js/agents/runtime/exec/command-executor.js:8
- **Description**: 模块依赖 Node-only API（child_process/process/Buffer），在浏览器环境下不可用，若被前端打包会直接失败。
- **Suggestion**: 确保该模块仅在 Node 运行时引用，或提供 browser stub/条件导入隔离。
```
import { spawn } from 'node:child_process';
```

### [RESOLVED] jsdoc
*Archived: 2026-01-18T21:22:32.144Z*

- **File**: js/agents/runtime/exec/command-executor.js:283
- **Description**: execSimple 通过 @ts-ignore 扩展 Error 属性，说明缺少明确的 JSDoc 类型定义，影响类型检查与可维护性。
- **Suggestion**: 定义 ExecError typedef/自定义 Error 子类并用 JSDoc 类型断言替代 @ts-ignore。
```
// @ts-ignore - 附加额外信息
```

---

