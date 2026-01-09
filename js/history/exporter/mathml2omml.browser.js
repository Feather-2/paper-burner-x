/**
 * mathml2omml - Browser/Node 加载器（ESM）
 * 将 MathML 转换为 OMML (Office Math Markup Language)
 * 源: https://github.com/fiduswriter/mathml2omml v0.5.0
 *
 * - 提供显式 API：`isMathml2OmmlLoaded()` / `loadMathml2Omml()`
 * - 兼容层：加载完成后写入 `window.mml2omml` 和 `window.MML2OMML`
 */

const DEFAULT_MATHML2OMML_URL = 'https://gcore.jsdelivr.net/npm/mathml2omml@0.5.0/+esm';

function getWindow() {
  return typeof window !== 'undefined' ? window : null;
}

export function isMathml2OmmlLoaded() {
  const win = getWindow();
  return Boolean(
    (win && (typeof win.mml2omml === 'function' || typeof win.MML2OMML === 'function')) ||
      typeof globalThis.mml2omml === 'function' ||
      typeof globalThis.MML2OMML === 'function'
  );
}

export async function loadMathml2Omml(options = {}) {
  const win = options.window ?? getWindow();
  const target = win || globalThis;

  if (typeof target.mml2omml === 'function') {
    return target.mml2omml;
  }

  const url = options.url || DEFAULT_MATHML2OMML_URL;

  const mod = await import(url);
  const mml2omml = mod?.mml2omml || mod?.default;

  if (typeof mml2omml !== 'function') {
    throw new Error('[mathml2omml] 加载失败：模块未导出 mml2omml 函数');
  }

  target.mml2omml = mml2omml;

  // 创建一个类包装，以便与旧代码兼容
  target.MML2OMML = class MML2OMML {
    constructor(mmlString, wrapperOptions = {}) {
      this.mmlString = mmlString;
      this.options = wrapperOptions;
      this.result = null;
    }

    run() {
      this.result = mml2omml(this.mmlString, this.options);
    }

    getResult() {
      return this.result;
    }
  };

  try {
    if (win && typeof win.dispatchEvent === 'function' && typeof Event !== 'undefined') {
      win.dispatchEvent(new Event('mathml2omml-ready'));
    }
  } catch (e) {
    console.warn('[mathml2omml] dispatchEvent failed:', e);
  }

  return mml2omml;
}

export default {
  isMathml2OmmlLoaded,
  loadMathml2Omml
};

