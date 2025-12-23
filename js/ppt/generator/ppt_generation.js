(() => {
    if (typeof PPTGenerator === 'undefined') {
        console.error('PPTGenerator class is not loaded.');
        return;
    }

    const generator = new PPTGenerator();
    window.PPTGenerator = generator;

    document.addEventListener('DOMContentLoaded', () => {
        if (window.PPTGenerator) window.PPTGenerator.init();
    });
})();
