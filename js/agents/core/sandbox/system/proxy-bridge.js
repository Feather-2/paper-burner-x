/**
 * Proxy Bridge — Unix socket 桥接管理器
 *
 * 在 bwrap --unshare-net 隔离网络命名空间中，
 * 通过 socat Unix socket 桥接实现受控网络访问。
 *
 * 架构：
 *   沙箱内 socat TCP-LISTEN:3128 ←→ Unix socket ←→ 宿主 socat ←→ HTTP proxy
 *
 * 参考 ASRT linux-sandbox-utils.ts initializeLinuxNetworkBridge
 *
 * @module core/sandbox/system/proxy-bridge
 */

import { spawn } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createLogger } from '../../../../shared/index.js';

const logger = createLogger('core/sandbox/system/proxy-bridge');

/**
 * @typedef {Object} BridgeContext
 * @property {string} httpSocketPath
 * @property {import('node:child_process').ChildProcess} httpBridge
 * @property {number} httpProxyPort
 * @property {() => void} cleanup
 */

/**
 * 初始化 Unix socket 桥接
 * @param {number} httpProxyPort - 宿主 HTTP 代理端口
 * @returns {Promise<BridgeContext>}
 */
export async function initBridge(httpProxyPort) {
  const id = randomBytes(8).toString('hex');
  const httpSocketPath = `/tmp/pb-http-${id}.sock`;

  // 清理残留 socket
  try { unlinkSync(httpSocketPath); } catch { /* ok */ }

  // 启动 socat 桥接：Unix socket → TCP proxy
  const httpBridge = spawn('socat', [
    `UNIX-LISTEN:${httpSocketPath},fork,reuseaddr`,
    `TCP:127.0.0.1:${httpProxyPort},keepalive,keepidle=10,keepintvl=5,keepcnt=3`,
  ], { stdio: 'ignore', detached: false });

  httpBridge.on('error', (err) => {
    logger.error(`HTTP bridge spawn failed: ${err.message}`);
  });

  // 等待 socket 就绪
  const maxAttempts = 5;
  for (let i = 1; i <= maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, i * 80));
    if (httpBridge.exitCode !== null) {
      throw new Error(`HTTP bridge exited prematurely (code ${httpBridge.exitCode})`);
    }
    if (existsSync(httpSocketPath)) break;
    if (i === maxAttempts) {
      httpBridge.kill();
      throw new Error('HTTP bridge socket not ready after retries');
    }
  }

  const cleanup = () => {
    try { httpBridge.kill(); } catch { /* ok */ }
    try { unlinkSync(httpSocketPath); } catch { /* ok */ }
  };

  return { httpSocketPath, httpBridge, httpProxyPort, cleanup };
}

/**
 * 生成沙箱内的网络桥接命令前缀。
 * 在沙箱内启动 socat 监听 TCP 端口，连接到 Unix socket。
 * @param {string} httpSocketPath
 * @param {string} userCommand - 用户命令
 * @returns {string} 完整的 shell 命令
 */
export function buildBridgedCommand(httpSocketPath, userCommand) {
  // 沙箱内：socat 监听 3128 端口 → Unix socket → 宿主代理
  return [
    'socat TCP-LISTEN:3128,fork,reuseaddr',
    `UNIX-CONNECT:${httpSocketPath} &`,
    'SOCAT_PID=$!',
    `trap "kill $SOCAT_PID 2>/dev/null" EXIT`,
    // 设置代理环境变量
    'export http_proxy=http://127.0.0.1:3128',
    'export https_proxy=http://127.0.0.1:3128',
    'export HTTP_PROXY=http://127.0.0.1:3128',
    'export HTTPS_PROXY=http://127.0.0.1:3128',
    // 等待 socat 就绪
    'sleep 0.1',
    // 执行用户命令
    userCommand,
  ].join(' && ');
}
