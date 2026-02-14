/**
 * Error Fingerprint - 错误指纹计算
 *
 * 对错误的 name + 规范化 message + stack 前 3 帧计算稳定哈希，
 * 用于聚合相同根因的错误。
 *
 * @module runtime/errors/error-fingerprint
 */

// 动态部分匹配模式
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const TIMESTAMP_RE = /\b\d{13,}\b/g;
const NUMERIC_ID_RE = /\b\d{8,}\b/g;
const ABS_PATH_RE = /(?:\/[\w.-]+){3,}(?=[:\/])/g;
const WIN_PATH_RE = /[A-Z]:\\(?:[\w.-]+\\){2,}/gi;

/**
 * 去除 message 中的动态部分，保留结构
 * @param {string} msg
 * @returns {string}
 */
function normalizeMessage(msg) {
  if (!msg || typeof msg !== 'string') return '';
  return msg
    .replace(UUID_RE, '<uuid>')
    .replace(TIMESTAMP_RE, '<ts>')
    .replace(ABS_PATH_RE, '<path>')
    .replace(WIN_PATH_RE, '<path>')
    .replace(NUMERIC_ID_RE, '<id>');
}

/**
 * 提取 stack 前 N 帧（去除动态路径）
 * @param {string} stack
 * @param {number} frameCount
 * @returns {string}
 */
function extractTopFrames(stack, frameCount = 3) {
  if (!stack || typeof stack !== 'string') return '';
  const lines = stack.split('\n');
  const frames = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('at ')) {
      frames.push(
        trimmed
          .replace(ABS_PATH_RE, '<path>')
          .replace(WIN_PATH_RE, '<path>')
          .replace(/:\d+:\d+\)?$/, '')
      );
      if (frames.length >= frameCount) break;
    }
  }
  return frames.join('\n');
}

/**
 * FNV-1a 哈希（32-bit）
 * @param {string} str
 * @returns {number}
 */
function fnv1a32(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * 计算错误指纹
 * @param {Error | { name?: string, message?: string, stack?: string }} error
 * @returns {string} 16 字符 hex 指纹
 */
export function computeErrorFingerprint(error) {
  if (!error || typeof error !== 'object') {
    return fnv1a32(String(error)).toString(16).padStart(8, '0').repeat(2).slice(0, 16);
  }

  const name = typeof error.name === 'string' ? error.name : 'Error';
  const msg = normalizeMessage(typeof error.message === 'string' ? error.message : '');
  const frames = extractTopFrames(typeof error.stack === 'string' ? error.stack : '');

  const input = `${name}\n${msg}\n${frames}`;
  // 双哈希拼接得到 16 字符
  const h1 = fnv1a32(input).toString(16).padStart(8, '0');
  const h2 = fnv1a32(input + '\x00').toString(16).padStart(8, '0');
  return h1 + h2;
}

export { normalizeMessage, extractTopFrames };
