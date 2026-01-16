/**
 * 沙箱后端检测
 * @module core/sandbox/system/detect
 */

import { SandboxBackend, Platform } from './constants.js';

/**
 * 检测结果
 * @typedef {Object} DetectionResult
 * @property {string} backend - 可用的后端类型
 * @property {string} platform - 当前平台
 * @property {boolean} available - 是否可用
 * @property {string} [version] - 版本信息
 * @property {string} [path] - 可执行文件路径
 * @property {string} [error] - 错误信息
 */

/**
 * 检测所有可用的沙箱后端
 * @returns {Promise<DetectionResult[]>}
 */
export async function detectAllBackends() {
  const platform = getPlatform();
  const results = [];

  // 按优先级检测
  if (platform === Platform.LINUX) {
    results.push(await detectBubblewrap());
  }

  if (platform === Platform.DARWIN) {
    results.push(await detectSeatbelt());
  }

  // Docker 跨平台
  results.push(await detectDocker());

  // Permission-only 始终可用
  results.push({
    backend: SandboxBackend.PERMISSION_ONLY,
    platform,
    available: true,
  });

  return results;
}

/**
 * 检测最佳可用后端
 * @returns {Promise<DetectionResult>}
 */
export async function detectBestBackend() {
  const results = await detectAllBackends();
  return results.find((r) => r.available) || results[results.length - 1];
}

/**
 * 获取当前平台
 * @returns {string}
 */
export function getPlatform() {
  // Node.js / Bun / Deno
  if (typeof process !== 'undefined' && process.platform) {
    return process.platform;
  }
  // Deno
  if (typeof Deno !== 'undefined' && Deno.build) {
    return Deno.build.os === 'windows' ? Platform.WIN32 : Deno.build.os;
  }
  // Browser - 无系统级沙箱
  return 'browser';
}

/**
 * 检测 Bubblewrap (Linux)
 * @returns {Promise<DetectionResult>}
 */
export async function detectBubblewrap() {
  const platform = getPlatform();
  if (platform !== Platform.LINUX) {
    return {
      backend: SandboxBackend.BUBBLEWRAP,
      platform,
      available: false,
      error: 'Bubblewrap only available on Linux',
    };
  }

  try {
    const result = await execCommand('which', ['bwrap']);
    if (result.code === 0 && result.stdout.trim()) {
      const versionResult = await execCommand('bwrap', ['--version']);
      return {
        backend: SandboxBackend.BUBBLEWRAP,
        platform,
        available: true,
        path: result.stdout.trim(),
        version: versionResult.stdout.trim(),
      };
    }
  } catch {
    // ignore
  }

  return {
    backend: SandboxBackend.BUBBLEWRAP,
    platform,
    available: false,
    error: 'bwrap not found. Install with: apt install bubblewrap',
  };
}

/**
 * 检测 Seatbelt (macOS)
 * @returns {Promise<DetectionResult>}
 */
export async function detectSeatbelt() {
  const platform = getPlatform();
  if (platform !== Platform.DARWIN) {
    return {
      backend: SandboxBackend.SEATBELT,
      platform,
      available: false,
      error: 'Seatbelt only available on macOS',
    };
  }

  try {
    // sandbox-exec 是 macOS 系统自带
    const result = await execCommand('which', ['sandbox-exec']);
    if (result.code === 0) {
      return {
        backend: SandboxBackend.SEATBELT,
        platform,
        available: true,
        path: result.stdout.trim(),
      };
    }
  } catch {
    // ignore
  }

  return {
    backend: SandboxBackend.SEATBELT,
    platform,
    available: false,
    error: 'sandbox-exec not found (should be built-in on macOS)',
  };
}

/**
 * 检测 Docker
 * @returns {Promise<DetectionResult>}
 */
export async function detectDocker() {
  const platform = getPlatform();

  try {
    const result = await execCommand('docker', ['--version']);
    if (result.code === 0) {
      // 检查 Docker daemon 是否运行
      const pingResult = await execCommand('docker', ['info'], { timeout: 5000 });
      if (pingResult.code === 0) {
        return {
          backend: SandboxBackend.DOCKER,
          platform,
          available: true,
          version: result.stdout.trim(),
        };
      }
      return {
        backend: SandboxBackend.DOCKER,
        platform,
        available: false,
        version: result.stdout.trim(),
        error: 'Docker installed but daemon not running',
      };
    }
  } catch {
    // ignore
  }

  return {
    backend: SandboxBackend.DOCKER,
    platform,
    available: false,
    error: 'Docker not installed',
  };
}

/**
 * 执行命令（跨运行时）
 * @param {string} cmd
 * @param {string[]} args
 * @param {Object} [options]
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
async function execCommand(cmd, args = [], options = {}) {
  const { timeout = 10000 } = options;

  // Node.js / Bun
  if (typeof process !== 'undefined' && process.versions?.node) {
    const { spawn } = await import('child_process');
    return new Promise((resolve) => {
      const proc = spawn(cmd, args, {
        timeout,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (d) => (stdout += d));
      proc.stderr?.on('data', (d) => (stderr += d));

      proc.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
      proc.on('error', () => resolve({ code: 1, stdout, stderr }));
    });
  }

  // Deno
  if (typeof Deno !== 'undefined') {
    try {
      const proc = new Deno.Command(cmd, {
        args,
        stdout: 'piped',
        stderr: 'piped',
      });
      const output = await proc.output();
      return {
        code: output.code,
        stdout: new TextDecoder().decode(output.stdout),
        stderr: new TextDecoder().decode(output.stderr),
      };
    } catch {
      return { code: 1, stdout: '', stderr: '' };
    }
  }

  // Bun (if not detected as Node)
  if (typeof Bun !== 'undefined') {
    try {
      const proc = Bun.spawn([cmd, ...args], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      await proc.exited;
      return { code: proc.exitCode ?? 1, stdout, stderr };
    } catch {
      return { code: 1, stdout: '', stderr: '' };
    }
  }

  // Browser - 不支持
  return { code: 1, stdout: '', stderr: 'exec not supported in browser' };
}

export { execCommand };
export default { detectAllBackends, detectBestBackend, getPlatform };
