(function() {
  if (typeof window.mermaidLoaded === 'undefined') {
    window.mermaidLoaded = false;
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/mermaid@10.9.0/dist/mermaid.min.js';
    script.onload = function() {
      window.mermaidLoaded = true;
      if (window.mermaid) {
        window.mermaid.initialize({ startOnLoad: false });
        console.log('Mermaid.js dynamically loaded and initialized.');
      }
    };
    script.onerror = function() {
      console.error('Failed to load Mermaid.js dynamically.');
    };
    document.head.appendChild(script);
  }
})();