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
 * @param {{
 *   allowAbsolute?: boolean,
 *   resolveSymlinks?: boolean,
 *   realpath?: (path: string) => string
 * }} [options]
 * @returns {string|null} 规范化后的绝对路径，如果路径穿越则返回 null
 */
export function normalizeSandboxPath(inputPath, baseDir, options = {}) {
  if (!inputPath || !baseDir) {
    return null;
  }
  if (typeof inputPath !== 'string' || typeof baseDir !== 'string') {
    throw new TypeError('normalizeSandboxPath: inputPath/baseDir must be strings');
  }

  const allowAbsolute = options?.allowAbsolute === true;
  const resolveSymlinks = options?.resolveSymlinks === true;
  const realpath = typeof options?.realpath === 'function' ? options.realpath : null;

  // 跨运行时的 path.resolve 实现
  const resolved = resolvePath(baseDir, inputPath);
  const canonicalBase = resolveSymlinks ? resolveCanonicalPath(normalizePath(baseDir), realpath) : normalizePath(baseDir);
  const canonicalResolved = resolveSymlinks ? resolveCanonicalPath(resolved, realpath) : resolved;

  // 绝对路径检查：默认拒绝，调用方需显式 allowAbsolute=true
  if (inputPath.startsWith('/')) {
    if (containsTraversal(inputPath)) {
      return null;
    }
    return allowAbsolute ? canonicalResolved : null;
  }

  // 相对路径必须在 baseDir 内
  if (!canonicalResolved.startsWith(canonicalBase + '/') && canonicalResolved !== canonicalBase) {
    return null;
  }

  return canonicalResolved;
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
 * Resolve path through canonical realpath (best-effort).
 * For non-existing target, resolve existing parent then append suffix.
 * @param {string} path
 * @param {((path: string) => string) | null} realpath
 * @returns {string}
 */
function resolveCanonicalPath(path, realpath) {
  if (typeof realpath !== 'function') return path;
  try {
    return normalizePath(realpath(path));
  } catch {
    // fall through to parent-based canonicalization
  }

  const normalized = normalizePath(path);
  const segments = normalized.split('/').filter(Boolean);
  for (let i = segments.length; i >= 1; i -= 1) {
    const parent = `/${segments.slice(0, i).join('/')}`;
    try {
      const canonicalParent = normalizePath(realpath(parent));
      const suffix = segments.slice(i).join('/');
      return suffix ? normalizePath(`${canonicalParent}/${suffix}`) : canonicalParent;
    } catch {
      // keep searching upper parent
    }
  }

  return normalized;
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
