/**
 * JS Runtime Adapter
 *
 * 原有的 JS 执行逻辑封装。
 *
 * ⚠️ 安全警告：当前使用 Function 构造器，等同于 eval()。
 * TODO(AI4Sci): 正式集成时需替换为以下方案之一：
 *   1. quickjs-emscripten (WASM 沙箱)
 *   2. iframe sandbox + postMessage
 *   3. 专用 Worker + 受限 globals
 */

import { RuntimeAdapter, RuntimeType } from './runtime-adapter.js';

// 危险模式检测（基础防护，非完整沙箱）
const DANGEROUS_PATTERNS = [
  /\beval\s*\(/,
  /\bFunction\s*\(/,
  /\bimport\s*\(/,
  /\brequire\s*\(/,
  /\bprocess\b/,
  /\bglobalThis\b/,
  /\bwindow\b/,
  /\bdocument\b/,
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /__proto__/,
  /\bconstructor\s*\[/,
];

function validateCode(code) {
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(code)) {
      return { valid: false, reason: `Blocked pattern: ${pattern.source}` };
    }
  }
  return { valid: true };
}

export class JSRuntimeAdapter extends RuntimeAdapter {
  constructor(options = {}) {
    super({ ...options, type: RuntimeType.JS });
    // 是否跳过安全检查（仅限可信代码源）
    this.skipValidation = options.skipValidation || false;
  }

  async initialize() {
    // JS 运行时通常不需要特殊初始化
    return true;
  }

  async execute(code, context) {
    const startTime = Date.now();

    // 安全检查
    if (!this.skipValidation) {
      const validation = validateCode(code);
      if (!validation.valid) {
        return {
          success: false,
          error: `Security: ${validation.reason}`,
          metrics: { duration: Date.now() - startTime }
        };
      }
    }

    try {
      // ⚠️ 使用 Function 构造器 - 仅限可信代码
      const fn = new Function('context', `
        const { state, vfs, emit } = context;
        return (async () => {
          ${code}
        })();
      `);

      const result = await fn(context);

      return {
        success: true,
        data: result,
        metrics: { duration: Date.now() - startTime }
      };
    } catch (err) {
      return {
        success: false,
        error: err.message,
        metrics: { duration: Date.now() - startTime }
      };
    }
  }
}
