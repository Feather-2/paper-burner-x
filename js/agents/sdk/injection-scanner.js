/**
 * Prompt Injection Scanner - SubAgent 输出检疫
 *
 * P3.4: 检测 SubAgent 输出中的潜在 Prompt Injection 攻击
 *
 * 检测策略：
 * 1. 高熵文本检测（可能是 Base64/编码注入）
 * 2. 常见注入模式匹配
 * 3. 角色劫持尝试检测
 *
 * 浏览器友好，无 Node.js 依赖。
 */

import { getGlobalContainer } from "../runtime/di/global-container.js";

/**
 * 扫描结果类型
 */
export const ScanResultCode = Object.freeze({
  CLEAN: "CLEAN",
  HIGH_ENTROPY: "HIGH_ENTROPY",
  INJECTION_PATTERN: "INJECTION_PATTERN",
  ROLE_HIJACK: "ROLE_HIJACK",
  SUSPICIOUS_ENCODING: "SUSPICIOUS_ENCODING",
});

/**
 * 计算 Shannon 熵
 * @param {string} text
 * @returns {number}
 */
function calculateEntropy(text) {
  if (!text || typeof text !== "string" || text.length === 0) return 0;

  const freq = new Map();
  for (const char of text) {
    freq.set(char, (freq.get(char) || 0) + 1);
  }

  let entropy = 0;
  const len = text.length;
  for (const count of freq.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }

  return entropy;
}

/**
 * 常见 Prompt Injection 模式
 */
const INJECTION_PATTERNS = [
  // 指令覆盖
  { pattern: /ignore\s+(all\s+)?previous\s+instructions?/i, name: "ignore_previous" },
  { pattern: /disregard\s+(all\s+)?prior\s+(instructions?|context)/i, name: "disregard_prior" },
  { pattern: /forget\s+(everything|all)\s+(above|before)/i, name: "forget_above" },

  // 角色切换
  { pattern: /you\s+are\s+now\s+(a|an|the)\s+/i, name: "role_switch" },
  { pattern: /act\s+as\s+(a|an|the)?\s*(new|different)/i, name: "act_as" },
  { pattern: /pretend\s+(you\s+are|to\s+be)/i, name: "pretend" },

  // 系统提示注入
  { pattern: /system\s*:\s*/i, name: "system_colon" },
  { pattern: /<\|im_start\|>/i, name: "im_start" },
  { pattern: /<\|im_end\|>/i, name: "im_end" },
  { pattern: /<\|endoftext\|>/i, name: "end_of_text" },
  { pattern: /\[INST\]/i, name: "inst_tag" },
  { pattern: /\[\/INST\]/i, name: "inst_end_tag" },
  { pattern: /<<SYS>>/i, name: "sys_tag" },
  { pattern: /<\/SYS>/i, name: "sys_end_tag" },

  // 越狱尝试
  { pattern: /jailbreak/i, name: "jailbreak" },
  { pattern: /DAN\s*mode/i, name: "dan_mode" },
  { pattern: /developer\s*mode/i, name: "developer_mode" },

  // 隐藏指令
  { pattern: /\[hidden\s*instruction/i, name: "hidden_instruction" },
  { pattern: /<!-- *inject/i, name: "html_inject" },
  { pattern: /\/\*\s*inject/i, name: "css_inject" },

  // 提示泄露
  { pattern: /reveal\s+(your\s+)?(system\s+)?prompt/i, name: "reveal_prompt" },
  { pattern: /show\s+(me\s+)?(your\s+)?instructions/i, name: "show_instructions" },
  { pattern: /print\s+(your\s+)?initial\s+prompt/i, name: "print_prompt" },
];

/**
 * 可疑编码模式
 */
const ENCODING_PATTERNS = [
  // Base64 长字符串（可能是编码注入）
  { pattern: /[A-Za-z0-9+/=]{100,}/, name: "long_base64" },

  // Unicode 转义序列大量出现
  { pattern: /(\\u[0-9a-fA-F]{4}){10,}/, name: "unicode_escape" },

  // Hex 编码
  { pattern: /(\\x[0-9a-fA-F]{2}){20,}/, name: "hex_escape" },

  // URL 编码
  { pattern: /(%[0-9a-fA-F]{2}){15,}/, name: "url_encoded" },
];

/**
 * 扫描配置
 * @typedef {Object} ScannerOptions
 * @property {number} [entropyThreshold=5.5] - 熵阈值，超过则标记为高熵
 * @property {number} [minEntropyLength=50] - 最小检测长度
 * @property {boolean} [checkPatterns=true] - 是否检查注入模式
 * @property {boolean} [checkEntropy=true] - 是否检查熵
 * @property {boolean} [checkEncoding=true] - 是否检查可疑编码
 * @property {function} [onDetection] - 检测到注入时的回调
 */

/**
 * Prompt Injection 扫描器
 */
export class InjectionScanner {
  /**
   * @param {ScannerOptions} options
   */
  constructor({
    entropyThreshold = 5.5,
    minEntropyLength = 50,
    checkPatterns = true,
    checkEntropy = true,
    checkEncoding = true,
    onDetection = null,
  } = {}) {
    this.entropyThreshold = entropyThreshold;
    this.minEntropyLength = minEntropyLength;
    this.checkPatterns = checkPatterns;
    this.checkEntropy = checkEntropy;
    this.checkEncoding = checkEncoding;
    this.onDetection = typeof onDetection === "function" ? onDetection : null;

    // 统计
    this._totalScans = 0;
    this._totalDetections = 0;
    this._detectionsByType = new Map();
  }

  /**
   * 扫描文本
   * @param {string} text
   * @param {object} [context] - 上下文信息（用于审计日志）
   * @returns {{ clean: boolean, code: string, detections: Array<{ type: string, pattern?: string, detail?: string }> }}
   */
  scan(text, context = {}) {
    this._totalScans++;
    const detections = [];

    if (!text || typeof text !== "string") {
      return { clean: true, code: ScanResultCode.CLEAN, detections };
    }

    // 1. 检查注入模式
    if (this.checkPatterns) {
      for (const { pattern, name } of INJECTION_PATTERNS) {
        const match = text.match(pattern);
        if (match) {
          detections.push({
            type: ScanResultCode.INJECTION_PATTERN,
            pattern: name,
            match: match[0],
            index: match.index,
          });
        }
      }
    }

    // 2. 检查可疑编码
    if (this.checkEncoding) {
      for (const { pattern, name } of ENCODING_PATTERNS) {
        const match = text.match(pattern);
        if (match) {
          detections.push({
            type: ScanResultCode.SUSPICIOUS_ENCODING,
            pattern: name,
            length: match[0].length,
            index: match.index,
          });
        }
      }
    }

    // 3. 检查高熵
    if (this.checkEntropy && text.length >= this.minEntropyLength) {
      // 对较长文本进行分段检测
      const segmentSize = 200;
      for (let i = 0; i < text.length; i += segmentSize) {
        const segment = text.slice(i, i + segmentSize);
        if (segment.length >= this.minEntropyLength) {
          const entropy = calculateEntropy(segment);
          if (entropy > this.entropyThreshold) {
            detections.push({
              type: ScanResultCode.HIGH_ENTROPY,
              entropy: entropy.toFixed(2),
              segmentStart: i,
              segmentLength: segment.length,
            });
            break; // 只报告第一个高熵段
          }
        }
      }
    }

    // 4. 检查角色劫持
    const roleHijackPatterns = [
      /^(assistant|system|user)\s*:/im,
      /^\[?(assistant|system|user)\]?\s*$/im,
    ];
    for (const pattern of roleHijackPatterns) {
      const match = text.match(pattern);
      if (match) {
        detections.push({
          type: ScanResultCode.ROLE_HIJACK,
          match: match[0],
          index: match.index,
        });
      }
    }

    // 记录统计
    if (detections.length > 0) {
      this._totalDetections++;
      for (const d of detections) {
        const count = this._detectionsByType.get(d.type) || 0;
        this._detectionsByType.set(d.type, count + 1);
      }

      // 触发回调
      if (this.onDetection) {
        this.onDetection({
          text: text.slice(0, 500), // 截断以避免日志过大
          detections,
          context,
          timestamp: Date.now(),
        });
      }
    }

    const code = detections.length > 0 ? detections[0].type : ScanResultCode.CLEAN;
    return {
      clean: detections.length === 0,
      code,
      detections,
    };
  }

  /**
   * 清理危险内容
   * @param {string} text
   * @returns {string}
   */
  sanitize(text) {
    if (!text || typeof text !== "string") return text;

    let sanitized = text;

    // 移除常见的控制标记
    sanitized = sanitized.replace(/<\|im_start\|>/gi, "");
    sanitized = sanitized.replace(/<\|im_end\|>/gi, "");
    sanitized = sanitized.replace(/<\|endoftext\|>/gi, "");
    sanitized = sanitized.replace(/\[INST\]/gi, "");
    sanitized = sanitized.replace(/\[\/INST\]/gi, "");
    sanitized = sanitized.replace(/<<SYS>>/gi, "");
    sanitized = sanitized.replace(/<\/SYS>/gi, "");

    // 移除角色前缀
    sanitized = sanitized.replace(/^(system|assistant|user)\s*:\s*/gim, "");

    return sanitized;
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      totalScans: this._totalScans,
      totalDetections: this._totalDetections,
      detectionsByType: Object.fromEntries(this._detectionsByType),
      detectionRate: this._totalScans > 0 ? this._totalDetections / this._totalScans : 0,
    };
  }

  /**
   * 重置统计
   */
  resetStats() {
    this._totalScans = 0;
    this._totalDetections = 0;
    this._detectionsByType.clear();
  }
}

const INJECTION_SCANNER_SERVICE_ID = "injectionScanner";

/**
 * Global scanner singleton (compatibility layer).
 *
 * @deprecated Prefer resolving via DI container (`ServiceId.INJECTION_SCANNER`) or passing an explicit instance.
 */
export function getGlobalInjectionScanner() {
  const container = getGlobalContainer();
  if (!container.has(INJECTION_SCANNER_SERVICE_ID)) {
    container.register(INJECTION_SCANNER_SERVICE_ID, () => new InjectionScanner());
  }
  return container.get(INJECTION_SCANNER_SERVICE_ID);
}

/**
 * 便捷函数：扫描文本
 */
export function scanForInjection(text, context = {}) {
  return getGlobalInjectionScanner().scan(text, context);
}

/**
 * 便捷函数：清理文本
 */
export function sanitizeOutput(text) {
  return getGlobalInjectionScanner().sanitize(text);
}

/**
 * 便捷函数：检查是否干净
 */
export function isCleanOutput(text) {
  return getGlobalInjectionScanner().scan(text).clean;
}

export default {
  ScanResultCode,
  InjectionScanner,
  getGlobalInjectionScanner,
  scanForInjection,
  sanitizeOutput,
  isCleanOutput,
  calculateEntropy,
};
