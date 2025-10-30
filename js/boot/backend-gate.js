// backend-gate.js — 在“后端模式”未登录时，拦截并跳转到登录页
// 适用范围：主站/落地页/其他静态页面（不影响 /admin 管理台）

(function () {
  try {
    var loc = window.location;
    var path = loc.pathname || '';

    // 纯本地文件访问（file://）时，强制视为前端模式：不做任何后端探测或跳转
    if (loc.protocol === 'file:') return;

    // 排除管理台与登录页自身
    if (path.startsWith('/admin') || path.endsWith('/login.html')) return;

    function q(key) {
      try { return new URLSearchParams(loc.search).get(key); } catch { return null; }
    }

    function normalizeRedirectParam(urlObj) {
      try {
        var red = urlObj.searchParams.get('redirect');
        if (!red) return;
        function deepDecode(s, limit) {
          var i = 0, prev = s;
          while (i++ < (limit || 8)) {
            try {
              var next = decodeURIComponent(prev);
              if (next === prev) break;
              prev = next;
            } catch { break; }
          }
          return prev;
        }
        var decoded = deepDecode(red, 8);
        // 连续嵌套或超长，直接归一为首页
        if (red.length > 512 || decoded.length > 512 || decoded.indexOf('/login.html?redirect=') !== -1) {
          urlObj.searchParams.set('redirect', '/');
          return;
        }
        var target = null;
        try { target = new URL(decoded, urlObj.origin); } catch {}
        if (!target || target.origin !== urlObj.origin || target.pathname.endsWith('/login.html')) {
          urlObj.searchParams.set('redirect', '/');
        }
      } catch {}
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

    function buildSafeRedirectTarget() {
      try {
        var u = new URL(window.location.href);
        // 避免递归嵌套：去除已有的 redirect 参数
        u.searchParams.delete('redirect');
        // 若当前已是登录页，则回首页
        if (u.pathname.endsWith('/login.html')) {
          u.pathname = '/';
          u.search = '';
        }
        // 限制同源
        if (u.origin !== window.location.origin) return '/';
        return u.toString();
      } catch { return '/'; }
    }

    function redirectToLogin() {
      // 如果当前 URL 已包含 redirect 指向 login.html（异常嵌套），则强制回首页
      try {
        var current = new URL(window.location.href);
        normalizeRedirectParam(current);
        // 将标准化后的当前 URL 写回，避免下次读取到异常 redirect
        history.replaceState(null, '', current.toString());
      } catch {}
      var safe = encodeURIComponent(buildSafeRedirectTarget());
      window.location.replace('/login.html?redirect=' + safe);
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
