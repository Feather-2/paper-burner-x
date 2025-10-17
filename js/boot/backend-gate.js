// backend-gate.js — 在“后端模式”未登录时，拦截并跳转到登录页
// 适用范围：主站/落地页/其他静态页面（不影响 /admin 管理台）

(function () {
  try {
    var loc = window.location;
    var path = loc.pathname || '';

    // 排除管理台与登录页自身
    if (path.startsWith('/admin') || path.endsWith('/login.html')) return;

    function q(key) {
      try { return new URLSearchParams(loc.search).get(key); } catch { return null; }
    }

    function modeForced() {
      var m = (q('mode') || '').toLowerCase();
      if (m === 'backend') return true;
      var env = (window.ENV_DEPLOYMENT_MODE || '').toLowerCase();
      return env === 'backend';
    }

    function modeFrontendForced() {
      var m = (q('mode') || '').toLowerCase();
      return m === 'frontend';
    }

    function hasToken() {
      try { return !!localStorage.getItem('auth_token'); } catch { return false; }
    }

    function redirectToLogin() {
      var redirect = encodeURIComponent(window.location.href);
      window.location.replace('/login.html?redirect=' + redirect);
    }

    function gateIfBackendKnown() {
      // 若明确为后端模式，且未登录且未显式前端绕过 → 跳转登录
      if (modeFrontendForced()) return; // 允许 ?mode=frontend 绕过
      if (hasToken()) return;
      redirectToLogin();
    }

    async function healthCheck(timeoutMs) {
      try {
        var ctrl = new AbortController();
        var id = setTimeout(function(){ try{ctrl.abort();}catch{} }, timeoutMs);
        var base = window.ENV_API_BASE_URL || '/api';
        var res = await fetch(base + '/health', { signal: ctrl.signal, cache: 'no-store' });
        clearTimeout(id);
        return !!(res && res.ok);
      } catch { return false; }
    }

    // 情况 1：已强制后端 → 立即门禁
    if (modeForced()) {
      gateIfBackendKnown();
      return;
    }

    // 情况 2：依赖 storage-adapter 的自动切换事件（若其已加载）
    if (typeof window !== 'undefined') {
      window.addEventListener('pb:storage-mode-changed', function (evt) {
        if (evt && evt.detail && evt.detail.mode === 'backend') gateIfBackendKnown();
      });
    }

    // 情况 3：页面未加载 storage-adapter（例如落地页）→ 自行做一次短健康检查
    // 仅当未显式前端绕过时执行
    if (!modeFrontendForced()) {
      healthCheck(700).then(function (hasBackend) {
        if (hasBackend) gateIfBackendKnown();
      });
    }
  } catch (e) {
    // 忽略所有门禁过程中的异常，避免影响前端模式体验
  }
})();

