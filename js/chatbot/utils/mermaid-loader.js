(function() {
  if (typeof window.mermaidLoaded === 'undefined') {
    window.mermaidLoaded = false;
    const script = document.createElement('script');
    // 优先加载本地文件，失败再回退到 CDN（如 CSP 限制可仅使用本地）
    const localUrl = '/vendor/mermaid/mermaid.min.js';
    const cdnUrl = 'https://gcore.jsdelivr.net/npm/mermaid@10.9.0/dist/mermaid.min.js';
    script.src = localUrl;
    script.onload = function() {
      window.mermaidLoaded = true;
      if (window.mermaid) {
        window.mermaid.initialize({ startOnLoad: false });
        console.log('Mermaid.js dynamically loaded and initialized.');
      }
    };
    script.onerror = function() {
      console.warn('Failed to load local Mermaid.js, trying CDN...');
      const s2 = document.createElement('script');
      s2.src = cdnUrl;
      s2.onload = script.onload;
      s2.onerror = function(){ console.error('Failed to load Mermaid.js from CDN.'); };
      document.head.appendChild(s2);
    };
    document.head.appendChild(script);
  }
})();
