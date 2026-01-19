/**
 * EventBus utilities: event names, patterns, and ids.
 */

/**
 * @param {unknown} name
 * @returns {boolean}
 */
export function isValidEventName(name) {
  if (name === '*') return true;
  // 支持 domain:action 和 domain.action 两种格式
  return typeof name === 'string' && /^[a-z0-9_]+([.:][a-z0-9_]+)*$/.test(name);
}

/**
 * @param {unknown} pattern
 * @returns {boolean}
 */
export function isValidEventPattern(pattern) {
  if (pattern === '*') return true;
  if (typeof pattern !== 'string') return false;
  // 支持 domain:action 和 domain.action 两种格式，允许通配符
  return /^[a-z0-9_*?]+([.:][a-z0-9_*?]+)*$/.test(pattern);
}

export function assertValidEventName(name) {
  if (!isValidEventName(name)) {
    throw new TypeError(`Invalid event name: ${String(name)}`);
  }
}

export function assertValidEventPattern(pattern) {
  if (!isValidEventPattern(pattern)) {
    throw new TypeError(`Invalid event pattern: ${String(pattern)}`);
  }
}

/**
 * @param {string | null | undefined} runId
 * @param {number} seq
 * @returns {string}
 */
export function createEventId(runId, seq) {
  const base = runId && typeof runId === 'string' ? runId : 'run';
  return `evt_${base}_${seq}`;
}

/**
 * 双指针通配符匹配 - O(m*n) 最坏情况，无指数回溯（防 ReDoS）
 * @param {string} pattern
 * @param {string} text
 * @returns {boolean}
 */
function wildcardMatch(pattern, text) {
  let pi = 0, ti = 0;
  let starIdx = -1, matchIdx = -1;
  const pLen = pattern.length, tLen = text.length;

  while (ti < tLen) {
    if (pi < pLen && (pattern[pi] === text[ti] || pattern[pi] === '?')) {
      pi++;
      ti++;
    } else if (pi < pLen && pattern[pi] === '*') {
      starIdx = pi;
      matchIdx = ti;
      pi++;
    } else if (starIdx !== -1) {
      pi = starIdx + 1;
      matchIdx++;
      ti = matchIdx;
    } else {
      return false;
    }
  }

  while (pi < pLen && pattern[pi] === '*') pi++;
  return pi === pLen;
}

/**
 * 匹配事件模式（安全实现，防 ReDoS）
 * @param {string} pattern
 * @param {string} eventName
 * @returns {boolean}
 */
export function matchPattern(pattern, eventName) {
  if (typeof pattern !== 'string' || typeof eventName !== 'string') return false;
  if (pattern === '*') return true;
  if (pattern === eventName) return true;
  if (!pattern.includes('*')) return false;

  // 快速路径: "prefix.*" 模式
  if (pattern.endsWith('.*') && !pattern.slice(0, -2).includes('*')) {
    const prefix = pattern.slice(0, -2);
    return eventName === prefix || eventName.startsWith(prefix + '.');
  }

  // 通用通配符匹配
  return wildcardMatch(pattern, eventName);
}
