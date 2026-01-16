/**
 * Docker 沙箱执行器 (跨平台)
 *
 * 使用 Docker 容器提供跨平台的进程隔离。
 * 适用于 Linux/macOS/Windows (需安装 Docker Desktop)。
 *
 * @module core/sandbox/system/docker
 */

import { SandboxBackend, DefaultSandboxConfig } from './constants.js';
import { execCommand } from './detect.js';

/**
 * Docker 执行选项
 * @typedef {Object} DockerOptions
 * @property {string} workDir - 工作目录 (会挂载到容器)
 * @property {string} [image] - Docker 镜像
 * @property {string[]} [allowedReadPaths] - 额外挂载的只读路径
 * @property {string[]} [allowedWritePaths] - 额外挂载的可写路径
 * @property {boolean} [allowNetwork] - 是否允许网络
 * @property {number} [timeoutMs] - 超时
 * @property {number} [memoryLimit] - 内存限制 (bytes)
 * @property {Object.<string, string>} [env] - 环境变量
 */

/** 默认镜像 - Alpine (轻量级) */
const DEFAULT_IMAGE = 'alpine:latest';

/**
 * 在 Docker 容器中执行命令
 * @param {string} command - 要执行的命令
 * @param {string[]} args - 命令参数
 * @param {DockerOptions} options - 执行选项
 * @returns {Promise<import('./bubblewrap.js').ExecutionResult>}
 */
export async function executeInDocker(command, args, options) {
  const {
    workDir = process.cwd(),
    image = DEFAULT_IMAGE,
    allowedReadPaths = [],
    allowedWritePaths = [],
    allowNetwork = DefaultSandboxConfig.allowNetwork,
    timeoutMs = DefaultSandboxConfig.timeoutMs,
    memoryLimit = DefaultSandboxConfig.memoryLimit,
    env = {},
  } = options;

  const dockerArgs = buildDockerArgs({
    workDir,
    image,
    allowedReadPaths,
    allowedWritePaths,
    allowNetwork,
    memoryLimit,
    env,
    command,
    commandArgs: args,
  });

  const result = await execCommand('docker', dockerArgs, { timeout: timeoutMs });

  return {
    ...result,
    killed: result.code === 137 || result.code === 124,
    backend: SandboxBackend.DOCKER,
  };
}

/**
 * 构建 Docker 运行参数
 * @param {Object} options
 * @returns {string[]}
 */
function buildDockerArgs(options) {
  const {
    workDir,
    image,
    allowedReadPaths,
    allowedWritePaths,
    allowNetwork,
    memoryLimit,
    env,
    command,
    commandArgs,
  } = options;

  const args = [
    'run',
    '--rm', // 执行后删除容器
    '-i', // 交互模式 (保持 stdin)
  ];

  // 网络隔离
  if (!allowNetwork) {
    args.push('--network', 'none');
  }

  // 内存限制
  if (memoryLimit) {
    args.push('--memory', `${memoryLimit}`);
    args.push('--memory-swap', `${memoryLimit}`); // 禁用 swap
  }

  // 安全选项
  args.push('--security-opt', 'no-new-privileges');
  args.push('--cap-drop', 'ALL'); // 移除所有 capabilities

  // 工作目录挂载
  args.push('-v', `${workDir}:/workspace`);
  args.push('-w', '/workspace');

  // 只读挂载
  for (const p of allowedReadPaths) {
    if (p.startsWith('/')) {
      const containerPath = `/mnt${p}`;
      args.push('-v', `${p}:${containerPath}:ro`);
    }
  }

  // 可写挂载 (跳过工作目录本身，已挂载)
  for (const p of allowedWritePaths) {
    // 跳过 '.' 和工作目录本身
    if (p === '.' || p === workDir) continue;

    const absPath = p.startsWith('/') ? p : `${workDir}/${p}`;
    // 跳过已被工作目录覆盖的子路径
    if (absPath.startsWith(workDir + '/') && !p.startsWith('/')) continue;

    const containerPath = p.startsWith('/') ? `/mnt${p}` : `/workspace/${p}`;
    args.push('-v', `${absPath}:${containerPath}`);
  }

  // 环境变量
  for (const [key, value] of Object.entries(env)) {
    args.push('-e', `${key}=${value}`);
  }

  // 镜像和命令
  args.push(image);
  args.push(command);
  args.push(...commandArgs);

  return args;
}

/**
 * 确保镜像存在
 * @param {string} image
 * @returns {Promise<boolean>}
 */
export async function ensureImage(image = DEFAULT_IMAGE) {
  // 检查镜像是否存在
  const inspectResult = await execCommand('docker', ['image', 'inspect', image]);
  if (inspectResult.code === 0) {
    return true;
  }

  // 拉取镜像
  const pullResult = await execCommand('docker', ['pull', image], { timeout: 120000 });
  return pullResult.code === 0;
}

/**
 * 创建 Docker 执行器实例
 * @param {DockerOptions} defaultOptions
 * @returns {Object}
 */
export function createDockerExecutor(defaultOptions = {}) {
  let imageReady = false;

  return {
    backend: SandboxBackend.DOCKER,

    async execute(command, args = [], options = {}) {
      const merged = { ...defaultOptions, ...options };

      // 确保镜像存在 (首次执行时)
      if (!imageReady) {
        imageReady = await ensureImage(merged.image || DEFAULT_IMAGE);
      }

      return executeInDocker(command, args, merged);
    },

    async shell(shellCommand, options = {}) {
      return this.execute('/bin/sh', ['-c', shellCommand], options);
    },
  };
}

export default { executeInDocker, createDockerExecutor, ensureImage };
