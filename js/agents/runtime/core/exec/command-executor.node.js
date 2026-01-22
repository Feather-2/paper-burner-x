/**
 * Command Executor - Node.js 子进程命令执行
 *
 * 提供简单的命令执行接口，支持超时、流式输出和安全控制。
 * 设计用于 Agent 工具调用场景。
 *
 * @module runtime/exec/command-executor
 * @environment node - 此模块依赖 Node.js child_process API，
 *   浏览器环境应使用 command-executor.browser.js stub。
 *   构建工具通过 package.json exports/browser field 自动选择。
 */

import { spawn } from 'node:child_process';
import { createLogger } from '../../../shared/index.js';

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
 * @property {boolean} [trusted=false] - execShell 是否允许执行 shell 命令
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
 * @typedef {Error & { exitCode: number; stderr: string; stdout: string }} ExecError
 * 命令执行失败时抛出的错误类型，包含额外的执行信息。
 */

const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

function normalizeExecOptions(options = {}) {
  const opts = options && typeof options === 'object' ? options : {};
  return {
    cwd: opts.cwd || process.cwd(),
    env: { ...process.env, ...opts.env },
    timeout: typeof opts.timeout === 'number' && Number.isFinite(opts.timeout) ? opts.timeout : DEFAULT_TIMEOUT_MS,
    maxOutputBytes: typeof opts.maxOutputBytes === 'number' && Number.isFinite(opts.maxOutputBytes) ? opts.maxOutputBytes : DEFAULT_MAX_OUTPUT_BYTES,
    shell: opts.shell === true,
    signal: opts.signal,
    onStdout: opts.onStdout,
    onStderr: opts.onStderr,
    stdin: opts.stdin,
    trusted: opts.trusted === true,
  };
}

function safeInvoke(callback, label, chunk) {
  if (typeof callback !== 'function') return;
  try {
    callback(chunk);
  } catch (err) {
    logger.warn(`[exec] ${label} callback failed`, { error: err?.message || String(err) });
  }
}

function createOutputCollector(maxOutputBytes, onStdout, onStderr) {
  let stdout = '';
  let stderr = '';
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let truncated = false;

  const append = (kind, chunk, handler) => {
    const str = chunk.toString();
    const bytes = Buffer.byteLength(str);

    if (kind === 'stdout') {
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
    } else {
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
    }

    safeInvoke(handler, kind, str);
  };

  return {
    appendStdout: (chunk) => append('stdout', chunk, onStdout),
    appendStderr: (chunk) => append('stderr', chunk, onStderr),
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
    get truncated() {
      return truncated;
    },
  };
}

function safeKill(child, signal) {
  try {
    child.kill(signal);
  } catch (err) {
    logger.warn('[exec] Failed to terminate child process', { signal, error: err?.message || String(err) });
  }
}

function buildExecResult(output, startTime, data) {
  const result = {
    success: data.success,
    exitCode: data.exitCode,
    signal: data.signal,
    stdout: output.stdout,
    stderr: output.stderr,
    duration: Date.now() - startTime,
    timedOut: data.timedOut,
    truncated: output.truncated,
  };

  if (data.error) {
    result.error = data.error;
  }

  return result;
}

function startTimeout(timeoutMs, onTimeout) {
  if (timeoutMs <= 0) return null;
  return setTimeout(onTimeout, timeoutMs);
}

function attachAbort(signal, onAbort) {
  if (!signal) return;
  signal.addEventListener('abort', onAbort, { once: true });
}

function writeStdin(child, stdin) {
  if (!child.stdin) return;
  if (stdin) {
    child.stdin.write(stdin);
  }
  child.stdin.end();
}

function cleanupProcess(child, timeoutId) {
  if (timeoutId) {
    clearTimeout(timeoutId);
  }
  if (child && !child.killed && child.exitCode === null && child.signalCode === null) {
    safeKill(child, 'SIGTERM');
    setTimeout(() => {
      if (child && !child.killed && child.exitCode === null && child.signalCode === null) {
        safeKill(child, 'SIGKILL');
      }
    }, 1000);
  }
}

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
  const opts = normalizeExecOptions(options);
  const output = createOutputCollector(opts.maxOutputBytes, opts.onStdout, opts.onStderr);

  return new Promise((resolve) => {
    /** @type {import('node:child_process').ChildProcess | null} */
    let child = null;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let timeoutId = null;
    let timedOut = false;

    const finish = (data) => {
      cleanupProcess(child, timeoutId);
      timeoutId = null;
      resolve(buildExecResult(output, startTime, data));
    };

    try {
      child = spawn(command, args, {
        cwd: opts.cwd,
        env: opts.env,
        shell: opts.shell,
        stdio: ['pipe', 'pipe', 'pipe'],
        signal: opts.signal,
      });

      timeoutId = startTimeout(opts.timeout, () => {
        timedOut = true;
        finish({
          success: false,
          exitCode: -1,
          signal: 'SIGTERM',
          timedOut: true,
          error: `Command timed out after ${opts.timeout}ms`,
        });
      });

      attachAbort(opts.signal, () => {
        finish({
          success: false,
          exitCode: -1,
          signal: 'SIGTERM',
          timedOut: false,
          error: 'Command aborted',
        });
      });

      writeStdin(child, opts.stdin);

      child.stdout?.on('data', output.appendStdout);
      child.stderr?.on('data', output.appendStderr);

      child.on('close', (code, signal) => {
        if (timedOut) return;

        const exitCode = code ?? -1;
        finish({
          success: exitCode === 0,
          exitCode,
          signal,
          timedOut: false,
        });
      });

      child.on('error', (err) => {
        if (timedOut) return;

        finish({
          success: false,
          exitCode: -1,
          signal: null,
          timedOut: false,
          error: err.message,
        });
      });
    } catch (err) {
      const message = err?.message || String(err);
      finish({
        success: false,
        exitCode: -1,
        signal: null,
        timedOut: false,
        error: message,
      });
    }
  });
}

/**
 * 执行 shell 命令 (使用系统 shell)
 *
 * **安全警告**: 此函数将 command 直接传递给系统 shell 执行，
 * 若 command 由不可信输入拼接，将导致命令注入/RCE 风险。
 * 建议：
 * - 仅在可信输入下使用此函数
 * - 不可信输入应改用 exec(command, args) 分离参数
 * - 必须使用用户输入时，应进行严格白名单校验或转义
 *
 * @param {string} command - Shell 命令字符串
 * @param {ExecOptions} [options={}] - 选项 (需显式设置 trusted=true)
 * @returns {Promise<ExecResult>}
 * @security 命令注入风险 - 仅接受可信输入
 */
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
  const opts = options && typeof options === 'object' ? options : {};
  if (!opts.trusted) {
    return {
      success: false,
      exitCode: -1,
      signal: null,
      stdout: '',
      stderr: '',
      duration: 0,
      timedOut: false,
      truncated: false,
      error: 'execShell: trusted option required',
    };
  }
  const isWindows = process.platform === 'win32';
  const shell = isWindows ? 'cmd.exe' : '/bin/sh';
  const shellArgs = isWindows ? ['/c', command] : ['-c', command];

  return exec(shell, shellArgs, { ...opts, shell: false });
}

/**
 * 简单命令执行 (返回 stdout 或抛出错误)
 *
 * @param {string} command - 命令
 * @param {string[]} [args=[]] - 参数
 * @param {ExecOptions} [options={}] - 选项
 * @returns {Promise<string>} stdout
 * @throws {ExecError} 如果命令失败，错误对象包含 exitCode, stderr, stdout 属性
 */
export async function execSimple(command, args = [], options = {}) {
  const result = await exec(command, args, options);

  if (!result.success) {
    /** @type {ExecError} */
    const error = /** @type {ExecError} */ (
      new Error(result.error || `Command failed: ${command} (exit code: ${result.exitCode})`)
    );
    error.exitCode = result.exitCode;
    error.stderr = result.stderr;
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
  } catch (err) {
    logger.warn('[exec] commandExists failed', { command, error: err?.message || String(err) });
    return false;
  }
}

export default { exec, execShell, execSimple, commandExists };
