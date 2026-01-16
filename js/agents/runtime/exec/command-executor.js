/**
 * Command Executor - Node.js 子进程命令执行
 *
 * 提供简单的命令执行接口，支持超时、流式输出和安全控制。
 * 设计用于 Agent 工具调用场景。
 */

import { spawn } from 'node:child_process';
import { createLogger } from '../../shared/utils/logger.js';

const logger = createLogger('runtime/exec');

/**
 * @typedef {object} ExecOptions
 * @property {string} [cwd] - 工作目录
 * @property {Record<string, string>} [env] - 环境变量 (合并到 process.env)
 * @property {number} [timeout=60000] - 超时 (ms)，0 表示无限制
 * @property {number} [maxOutputBytes=10485760] - 最大输出字节数 (默认 10MB)
 * @property {AbortSignal} [signal] - 取消信号
 * @property {(chunk: string) => void} [onStdout] - stdout 流式回调
 * @property {(chunk: string) => void} [onStderr] - stderr 流式回调
 * @property {string} [stdin] - 写入 stdin 的内容
 * @property {boolean} [shell=false] - 是否使用 shell 执行
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

/**
 * 执行命令
 *
 * @param {string} command - 命令
 * @param {string[]} [args=[]] - 参数
 * @param {ExecOptions} [options={}] - 选项
 * @returns {Promise<ExecResult>}
 */
export async function exec(command, args = [], options = {}) {
  const startTime = Date.now();
  const opts = options && typeof options === 'object' ? options : {};

  const cwd = opts.cwd || process.cwd();
  const env = { ...process.env, ...opts.env };
  const timeout = typeof opts.timeout === 'number' && Number.isFinite(opts.timeout) ? opts.timeout : 60000;
  const maxOutputBytes = typeof opts.maxOutputBytes === 'number' && Number.isFinite(opts.maxOutputBytes) ? opts.maxOutputBytes : 10 * 1024 * 1024;
  const shell = opts.shell === true;

  let stdout = '';
  let stderr = '';
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let truncated = false;
  let timedOut = false;

  return new Promise((resolve) => {
    /** @type {import('node:child_process').ChildProcess | null} */
    let child = null;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let timeoutId = null;

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (child && !child.killed) {
        try {
          child.kill('SIGTERM');
          // Force kill after grace period
          setTimeout(() => {
            if (child && !child.killed) {
              try {
                child.kill('SIGKILL');
              } catch {
                // ignore
              }
            }
          }, 1000);
        } catch {
          // ignore
        }
      }
    };

    const finish = (result) => {
      cleanup();
      resolve(result);
    };

    try {
      child = spawn(command, args, {
        cwd,
        env,
        shell,
        stdio: ['pipe', 'pipe', 'pipe'],
        signal: opts.signal,
      });

      // Timeout handling
      if (timeout > 0) {
        timeoutId = setTimeout(() => {
          timedOut = true;
          cleanup();
          finish({
            success: false,
            exitCode: -1,
            signal: 'SIGTERM',
            stdout,
            stderr,
            duration: Date.now() - startTime,
            timedOut: true,
            truncated,
            error: `Command timed out after ${timeout}ms`,
          });
        }, timeout);
      }

      // Abort signal handling
      if (opts.signal) {
        opts.signal.addEventListener('abort', () => {
          cleanup();
          finish({
            success: false,
            exitCode: -1,
            signal: 'SIGTERM',
            stdout,
            stderr,
            duration: Date.now() - startTime,
            timedOut: false,
            truncated,
            error: 'Command aborted',
          });
        }, { once: true });
      }

      // Write to stdin if provided
      if (opts.stdin && child.stdin) {
        child.stdin.write(opts.stdin);
        child.stdin.end();
      } else if (child.stdin) {
        child.stdin.end();
      }

      // Collect stdout
      child.stdout?.on('data', (chunk) => {
        const str = chunk.toString();
        const bytes = Buffer.byteLength(str);

        if (stdoutBytes + bytes <= maxOutputBytes) {
          stdout += str;
          stdoutBytes += bytes;
        } else if (!truncated) {
          const remaining = maxOutputBytes - stdoutBytes;
          if (remaining > 0) {
            stdout += str.slice(0, remaining);
          }
          truncated = true;
        }

        if (opts.onStdout) {
          try {
            opts.onStdout(str);
          } catch {
            // ignore
          }
        }
      });

      // Collect stderr
      child.stderr?.on('data', (chunk) => {
        const str = chunk.toString();
        const bytes = Buffer.byteLength(str);

        if (stderrBytes + bytes <= maxOutputBytes) {
          stderr += str;
          stderrBytes += bytes;
        } else if (!truncated) {
          const remaining = maxOutputBytes - stderrBytes;
          if (remaining > 0) {
            stderr += str.slice(0, remaining);
          }
          truncated = true;
        }

        if (opts.onStderr) {
          try {
            opts.onStderr(str);
          } catch {
            // ignore
          }
        }
      });

      // Handle process exit
      child.on('close', (code, signal) => {
        if (timedOut) return; // Already handled

        const exitCode = code ?? -1;
        const success = exitCode === 0;

        finish({
          success,
          exitCode,
          signal,
          stdout,
          stderr,
          duration: Date.now() - startTime,
          timedOut: false,
          truncated,
        });
      });

      // Handle spawn error
      child.on('error', (err) => {
        if (timedOut) return;

        finish({
          success: false,
          exitCode: -1,
          signal: null,
          stdout,
          stderr,
          duration: Date.now() - startTime,
          timedOut: false,
          truncated,
          error: err.message,
        });
      });
    } catch (err) {
      finish({
        success: false,
        exitCode: -1,
        signal: null,
        stdout: '',
        stderr: '',
        duration: Date.now() - startTime,
        timedOut: false,
        truncated: false,
        error: err.message,
      });
    }
  });
}

/**
 * 执行 shell 命令 (使用系统 shell)
 *
 * @param {string} command - Shell 命令字符串
 * @param {ExecOptions} [options={}] - 选项
 * @returns {Promise<ExecResult>}
 */
export async function execShell(command, options = {}) {
  const isWindows = process.platform === 'win32';
  const shell = isWindows ? 'cmd.exe' : '/bin/sh';
  const shellArgs = isWindows ? ['/c', command] : ['-c', command];

  return exec(shell, shellArgs, { ...options, shell: false });
}

/**
 * 简单命令执行 (返回 stdout 或抛出错误)
 *
 * @param {string} command - 命令
 * @param {string[]} [args=[]] - 参数
 * @param {ExecOptions} [options={}] - 选项
 * @returns {Promise<string>} stdout
 * @throws {Error} 如果命令失败
 */
export async function execSimple(command, args = [], options = {}) {
  const result = await exec(command, args, options);

  if (!result.success) {
    const error = new Error(result.error || `Command failed: ${command} (exit code: ${result.exitCode})`);
    // @ts-ignore - 附加额外信息
    error.exitCode = result.exitCode;
    // @ts-ignore
    error.stderr = result.stderr;
    // @ts-ignore
    error.stdout = result.stdout;
    throw error;
  }

  return result.stdout;
}

/**
 * 检查命令是否存在
 *
 * @param {string} command - 命令名
 * @returns {Promise<boolean>}
 */
export async function commandExists(command) {
  try {
    const isWindows = process.platform === 'win32';
    const checkCmd = isWindows ? 'where' : 'which';

    const result = await exec(checkCmd, [command], { timeout: 5000 });
    return result.success;
  } catch {
    return false;
  }
}

export default { exec, execShell, execSimple, commandExists };
