// Legacy loader: `ppt_generator_agent_dashboard.js` was split into `ppt_dashboard_*.js` modules.
// Keep this file for backward compatibility (tests / older HTML) and load the split modules in order.
(() => {
  window.PPTDashboard = window.PPTDashboard || {};
  const NS = window.PPTDashboard;

  const browserPaths = [
    'js/ppt/ppt_dashboard_utils.js',
    'js/ppt/ppt_dashboard_upload.js',
    'js/ppt/ppt_dashboard_history.js',
    'js/ppt/ppt_dashboard_url_input.js',
    'js/ppt/ppt_dashboard_paste.js',
    'js/ppt/ppt_dashboard_modals.js',
    'js/ppt/ppt_dashboard_deepsearch.js',
    'js/ppt/ppt_dashboard_page_layout.js',
    'js/ppt/ppt_dashboard_design_spec.js',
    'js/ppt/ppt_dashboard_outline.js',
    'js/ppt/ppt_dashboard_core.js',
  ];

  // CommonJS (unit tests): load local files directly.
  if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
    require('./ppt_dashboard_utils.js');
    require('./ppt_dashboard_upload.js');
    require('./ppt_dashboard_history.js');
    require('./ppt_dashboard_url_input.js');
    require('./ppt_dashboard_paste.js');
    require('./ppt_dashboard_modals.js');
    require('./ppt_dashboard_deepsearch.js');
    require('./ppt_dashboard_page_layout.js');
    require('./ppt_dashboard_design_spec.js');
    require('./ppt_dashboard_outline.js');
    require('./ppt_dashboard_core.js');

    // Re-apply mixin for test cases that redefine `PPTGenerator` between requires.
    try {
      if (typeof PPTGenerator !== 'undefined' && NS.PPTGeneratorAgentDashboard) {
        Object.assign(PPTGenerator.prototype, NS.PPTGeneratorAgentDashboard);
      }
    } catch {
      // ignore
    }

    module.exports = NS;
    return;
  }

  // Browser: if split modules are already included by HTML, core will set this.
  if (NS.PPTGeneratorAgentDashboard) return;

  if (typeof document === 'undefined') return;

  const loaded = new Set();
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (loaded.has(src)) return resolve();
      loaded.add(src);
      const script = document.createElement('script');
      script.src = new URL(src, document.baseURI).href;
      script.async = false;
      script.onload = () => resolve();
      script.onerror = (e) => reject(e);
      document.head.appendChild(script);
    });
  }

  browserPaths.reduce((p, src) => p.then(() => loadScript(src)), Promise.resolve()).catch((e) => {
    console.warn('[ppt-dashboard] failed to load split modules:', e);
  });
})();
