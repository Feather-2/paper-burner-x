// ============================================================
// 5. 导出
// ============================================================
window.SlideStyles = SlideStyles;
window.SlideParser = SlideParser;
window.HTMLSlideRenderer = HTMLSlideRenderer;
window.PPTXSlideRenderer = PPTXSlideRenderer;

// 便捷方法
window.SlideSystem = {
    styles: SlideStyles,

    /**
     * 从 HTML 解析并渲染
     */
    parseAndRender(html, targetElement) {
        const slides = SlideParser.parse(html);
        const renderer = new HTMLSlideRenderer();
        targetElement.innerHTML = renderer.renderAll(slides);
        return slides;
    },

    /**
     * 从 HTML 解析并导出 PPTX
     */
    async parseAndExport(html, filename = 'presentation.pptx') {
        const slides = SlideParser.parse(html);
        const renderer = new PPTXSlideRenderer();
        return renderer.render(slides, filename);
    },

    /**
     * 从 Schema 渲染 HTML
     */
    renderHTML(slides) {
        const renderer = new HTMLSlideRenderer();
        return renderer.renderAll(slides);
    },

    /**
     * 从 Schema 导出 PPTX
     */
    async exportPPTX(slides, filename = 'presentation.pptx') {
        const renderer = new PPTXSlideRenderer();
        return renderer.render(slides, filename);
    }
};

console.log('SlideSystem loaded - HTML ↔ PPTX unified rendering');

// ESM 导出
