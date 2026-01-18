/**
 * 沙箱路径工具
 *
 * 提供安全的路径规范化，防止路径穿越攻击。
 *
 * @module core/sandbox/system/path-utils
 */

/**
 * 规范化沙箱路径，防止路径穿越
 *
 * @param {string} inputPath - 输入路径（相对或绝对）
 * @param {string} baseDir - 基准目录
 * @returns {string|null} 规范化后的绝对路径，如果路径穿越则返回 null
 */
export function normalizeSandboxPath(inputPath, baseDir) {
  if (!inputPath || !baseDir) {
    return null;
  }

  // 跨运行时的 path.resolve 实现
  const resolved = resolvePath(baseDir, inputPath);

  // 绝对路径检查：如果输入是绝对路径，直接返回（允许显式白名单）
  if (inputPath.startsWith('/')) {
    // 检查是否含有 .. 组件
    if (containsTraversal(inputPath)) {
      return null;
    }
    return resolved;
  }

  // 相对路径必须在 baseDir 内
  const normalizedBase = normalizePath(baseDir);
  if (!resolved.startsWith(normalizedBase + '/') && resolved !== normalizedBase) {
    return null;
  }

  return resolved;
}

/**
 * 检查路径是否包含遍历组件
 * @param {string} p - 路径
 * @returns {boolean}
 */
function containsTraversal(p) {
  const segments = p.split('/');
  return segments.some((seg) => seg === '..');
}

/**
 * 规范化路径（移除 . 和 .. 组件）
 * @param {string} p - 路径
 * @returns {string}
 */
function normalizePath(p) {
  const segments = p.split('/').filter((s) => s && s !== '.');
  const result = [];

  for (const seg of segments) {
    if (seg === '..') {
      result.pop();
    } else {
      result.push(seg);
    }
  }

  return '/' + result.join('/');
}

/**
 * 解析路径（跨运行时实现 path.resolve）
 * @param {string} base - 基准路径
 * @param {string} target - 目标路径
 * @returns {string}
 */
function resolvePath(base, target) {
  if (target.startsWith('/')) {
    return normalizePath(target);
  }
  return normalizePath(base + '/' + target);
}

/**
 * 验证 SBPL 路径安全性（无控制字符）
 *
 * @param {string} p - 路径
 * @returns {boolean} 路径是否安全
 */
export function isSafeForSBPL(p) {
  if (!p) return false;
  // 拒绝控制字符 (0x00-0x1F, 0x7F)
  // eslint-disable-next-line no-control-regex
  return !/[\x00-\x1f\x7f]/.test(p);
}

export default { normalizeSandboxPath, isSafeForSBPL };
