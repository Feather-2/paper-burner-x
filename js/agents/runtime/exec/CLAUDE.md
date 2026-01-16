# exec - 命令执行器

Node.js 子进程命令执行封装，支持超时、流式输出和安全控制。

## 核心文件

| 文件 | 职责 |
|------|------|
| `command-executor.js` | exec, execShell, execSimple, commandExists |
| `index.js` | 入口导出 |

## API

### exec(command, args, options)

执行命令，返回详细结果。

```javascript
import { exec } from 'js/agents/runtime/exec';

const result = await exec('git', ['status'], {
  cwd: '/path/to/repo',
  timeout: 30000,
  onStdout: (chunk) => console.log(chunk),
});

if (result.success) {
  console.log(result.stdout);
} else {
  console.error(result.stderr);
}
```

### execShell(command, options)

使用系统 shell 执行命令字符串。

```javascript
import { execShell } from 'js/agents/runtime/exec';

const result = await execShell('ls -la | grep .js', {
  cwd: '/path/to/dir',
});
```

### execSimple(command, args, options)

简单执行，成功返回 stdout，失败抛出错误。

```javascript
import { execSimple } from 'js/agents/runtime/exec';

try {
  const output = await execSimple('node', ['--version']);
  console.log(output); // 'v20.x.x\n'
} catch (err) {
  console.error(err.stderr);
}
```

### commandExists(command)

检查命令是否存在。

```javascript
import { commandExists } from 'js/agents/runtime/exec';

if (await commandExists('git')) {
  // git is available
}
```

## ExecResult

```typescript
interface ExecResult {
  success: boolean;      // exitCode === 0
  exitCode: number;      // 退出码
  signal: string | null; // 终止信号
  stdout: string;        // 标准输出
  stderr: string;        // 标准错误
  duration: number;      // 执行时间 (ms)
  timedOut: boolean;     // 是否超时
  truncated: boolean;    // 输出是否被截断
  error?: string;        // 错误信息
}
```

## ExecOptions

```typescript
interface ExecOptions {
  cwd?: string;                    // 工作目录
  env?: Record<string, string>;    // 环境变量
  timeout?: number;                // 超时 (ms)，默认 60000
  maxOutputBytes?: number;         // 最大输出字节，默认 10MB
  signal?: AbortSignal;            // 取消信号
  onStdout?: (chunk: string) => void;  // stdout 流式回调
  onStderr?: (chunk: string) => void;  // stderr 流式回调
  stdin?: string;                  // 写入 stdin
  shell?: boolean;                 // 使用 shell 执行
}
```

## 安全考虑

- 超时保护：默认 60s，防止命令挂起
- 输出限制：默认 10MB，防止内存溢出
- 取消支持：可通过 AbortSignal 取消
- 分离参数：推荐使用 exec(cmd, args) 而非 execShell 防止注入
