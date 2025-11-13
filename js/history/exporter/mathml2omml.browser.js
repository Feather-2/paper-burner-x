/**
 * mathml2omml - Browser 加载器
 * 将 MathML 转换为 OMML (Office Math Markup Language)
 * 源: https://github.com/fiduswriter/mathml2omml v0.5.0
 *
 * 使用 ES6 module 动态导入，兼容现代浏览器
 * 导出到 window.mml2omml 和 window.MML2OMML
 */

(function(window) {
'use strict';

// 创建加载器
function loadMathml2Omml() {
  // 使用 type=module 动态加载
  const script = document.createElement('script');
  script.type = 'module';
  script.textContent = `
    import { mml2omml } from 'https://gcore.jsdelivr.net/npm/mathml2omml@0.5.0/+esm';

    // 导出到全局
    window.mml2omml = mml2omml;

    // 也创建一个类包装，以便与现有代码兼容
    window.MML2OMML = class {
      constructor(mmlString, options = {}) {
        this.mmlString = mmlString;
        this.options = options;
        this.result = null;
      }

      run() {
        this.result = mml2omml(this.mmlString, this.options);
      }

      getResult() {
        return this.result;
      }
    };

    // 触发ready事件
    window.dispatchEvent(new Event('mathml2omml-ready'));
    console.log('%c[mathml2omml] ✅ 已加载（v0.5.0）', 'color: #10b981; font-weight: bold');
    console.log('可用方法: window.mml2omml(mathmlString) 或 new window.MML2OMML(mathmlString)');
  `;

  document.head.appendChild(script);
}

// 立即加载
loadMathml2Omml();

})(window);
