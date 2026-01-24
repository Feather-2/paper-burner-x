# exec - 命令执行器

Node.js 子进程命令执行封装，支持超时、流式输出、输出截断和安全控制。
浏览器环境导出 stub：`exec/execShell` 返回 `success:false` 的结果，`execSimple` 抛出不支持错误。

## 核心文件

| 文件 | 职责 |
|------|------|
| `command-executor.node.js` | Node.js 实现：exec, execShell, execSimple, commandExists |
| `command-executor.browser.js` | Browser stub：不支持命令执行（返回失败结果或抛错） |
| `index.js` | 入口导出（构建工具应通过 package.json exports/browser 或 browser field 选择正确版本） |

## API

### exec(command, args, options)

执行命令（默认不启用 shell），返回详细结果。

```javascript
import { exec } from 'js/agents/runtime/core/exec';

const result = await exec('git', ['status'], {
  cwd: '/path/to/repo',
  timeout: 30_000,
  onStdout: (chunk) => console.log(chunk),
});

if (result.success) {
  console.log(result.stdout);
} else {
  console.error(result.error || result.stderr);
}
```

### execShell(command, options)

使用系统 shell 执行命令字符串（高风险）。仅用于**可信**的命令字符串；调用时需显式开启 `trusted:true`。

```javascript
import { execShell } from 'js/agents/runtime/core/exec';

const result = await execShell('ls -la | grep .js', {
  cwd: '/path/to/dir',
  trusted: true,
});
```

### execSimple(command, args, options)

简单执行：成功返回 stdout；失败抛出包含 stderr/stdout/exitCode 的错误。

```javascript
import { execSimple } from 'js/agents/runtime/core/exec';

try {
  const output = await execSimple('node', ['--version']);
  console.log(output); // 'v20.x.x\n'
} catch (err) {
  console.error(err.exitCode, err.stderr);
}
```

### commandExists(command)

检查命令是否存在。

```javascript
import { commandExists } from 'js/agents/runtime/core/exec';

if (await commandExists('git')) {
  // git is available
}
```

## ExecOptions / ExecResult

```js
/**
 * @typedef {object} ExecOptions
 * @property {string} [cwd] - 工作目录
 * @property {Record<string, string>} [env] - 环境变量（合并到 process.env）
 * @property {number} [timeout=60000] - 超时 (ms)，0 表示无限制
 * @property {number} [maxOutputBytes=10485760] - 最大输出字节数 (默认 10MB)
 * @property {AbortSignal} [signal] - 取消信号
 * @property {(chunk: string) => void} [onStdout] - stdout 流式回调
 * @property {(chunk: string) => void} [onStderr] - stderr 流式回调
 * @property {string} [stdin] - 写入 stdin 的内容
 * @property {boolean} [shell=false] - 是否使用 shell 执行（不推荐）
 * @property {boolean} [trusted=false] - 是否允许执行高风险模式（如 execShell）
 */

/**
 * @typedef {object} ExecResult
 * @property {boolean} success - 是否成功 (exitCode === 0)
 * @property {number} exitCode - 退出码
 * @property {string|null} signal - 终止信号
 * @property {string} stdout - 标准输出
 * @property {string} stderr - 标准错误
 * @property {number} duration - 执行时间 (ms)
 * @property {boolean} timedOut - 是否超时
 * @property {boolean} truncated - 输出是否被截断
 * @property {string} [error] - 错误信息
 */
```

## 浏览器环境行为

- `exec(...)` / `execShell(...)`：返回 `success:false` 的 `ExecResult`，`error` 为不支持提示。
- `execSimple(...)`：直接抛错（用于强制失败路径）。
- `commandExists(...)`：始终返回 `false`。
