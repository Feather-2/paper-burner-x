/**
 * 系统级沙箱模块
 *
 * 提供跨平台的进程级隔离：
 * - Linux: Bubblewrap (namespace)
 * - macOS: Seatbelt (sandbox-exec)
 * - 跨平台: Docker
 * - Fallback: Permission-only
 *
 * @module core/sandbox/system
 */

// 常量
export {
  SandboxBackend,
  SandboxPolicy,
  DefaultSandboxConfig,
  Platform,
} from './constants.js';

// 检测
export {
  detectAllBackends,
  detectBestBackend,
  detectBubblewrap,
  detectSeatbelt,
  detectDocker,
  getPlatform,
} from './detect.js';

// 后端实现
export { executeInBubblewrap, createBubblewrapExecutor } from './bubblewrap.js';
export { executeInSeatbelt, createSeatbeltExecutor } from './seatbelt.js';
export { executeInDocker, createDockerExecutor, ensureImage } from './docker.js';
export {
  executeWithPermission,
  createPermissionExecutor,
  createInteractivePermissionHandler,
} from './permission.js';

// 统一执行器
export {
  SystemSandboxExecutor,
  createSystemSandbox,
  execInSandbox,
  shellInSandbox,
} from './executor.js';

// 默认导出
import { createSystemSandbox, execInSandbox, shellInSandbox } from './executor.js';
import { detectBestBackend, detectAllBackends } from './detect.js';
import { SandboxBackend } from './constants.js';

export default {
  createSystemSandbox,
  execInSandbox,
  shellInSandbox,
  detectBestBackend,
  detectAllBackends,
  SandboxBackend,
};
