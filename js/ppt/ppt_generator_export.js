const PPTGeneratorExport = {
    toggleExportMenu() {
        const dropdown = document.querySelector('.ppt-export-dropdown');
        if (!dropdown) return;

        dropdown.classList.toggle('open');
        if (dropdown.classList.contains('open')) {
            const closeHandler = (e) => {
                if (!dropdown.contains(e.target)) {
                    dropdown.classList.remove('open');
                    document.removeEventListener('click', closeHandler);
                }
            };
            setTimeout(() => document.addEventListener('click', closeHandler), 0);
        }
    },

    async exportAs(format) {
        const dropdown = document.querySelector('.ppt-export-dropdown');
        if (dropdown) dropdown.classList.remove('open');

        const btn = document.querySelector('.ppt-export-btn');
        const originalContent = btn?.innerHTML;

        try {
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<iconify-icon icon="carbon:circle-dash" class="animate-spin"></iconify-icon> 导出中...';
            }

            switch (format) {
                case 'pptx':
                    await this._exportPPTX('unicode');
                    break;
                case 'pptx-omml':
                    await this._exportPPTX('omml');
                    break;
                case 'pptx-image':
                    await this._exportPPTX('image');
                    break;
                case 'pdf':
                    await this._exportPDF();
                    break;
                case 'html-raw':
                    this._exportHTMLRaw();
                    break;
                case 'html-rendered':
                    this._exportHTMLRendered();
                    break;
                case 'images':
                    await this._exportImages();
                    break;
                default:
                    throw new Error('不支持的导出格式');
            }

            if (btn) {
                btn.innerHTML = '<iconify-icon icon="carbon:checkmark"></iconify-icon> 导出成功';
                setTimeout(() => {
                    btn.disabled = false;
                    btn.innerHTML = originalContent;
                }, 2000);
            }
        } catch (e) {
            console.error('Export error:', e);
            alert('导出失败: ' + e.message);
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = originalContent;
            }
        }
    },

    /**
     * 导出 PPTX
     * @param {string} mode - 导出模式：'unicode' | 'omml' | 'image'
     */
    async _exportPPTX(mode = 'unicode') {
        if (typeof PptxGenJS === 'undefined') {
            await this._loadScript('https://cdn.jsdelivr.net/gh/gitbrent/PptxGenJS@3.12.0/dist/pptxgen.bundle.js');
        }

        if (typeof PPTXSlideRenderer === 'undefined') {
            throw new Error('PPTX 渲染器未加载');
        }

        // 加载 JSZip 用于后处理
        if (typeof JSZip === 'undefined') {
            await this._loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
        }

        const filename = `${this.currentProject?.title || 'presentation'}.pptx`;

        // 图片模式：每页幻灯片都渲染成图片
        if (mode === 'image') {
            console.log('[PPTX Export] Using image mode (best quality, not editable)');
            await this._exportPPTXAsImages(filename);
            return;
        }

        const slidesForExport = await this._bakeEffectsForPPTX(this.slides);
        const renderer = new PPTXSlideRenderer();
        
        const hasFormulas = slidesForExport.some(slide => 
            slide.elements?.some(el => el.type === 'formula')
        );

        if (mode === 'omml' && hasFormulas && typeof MathConverter !== 'undefined') {
            // 使用原生 OMML 公式：生成 PPTX 后用 DOM 操作替换
            console.log('[PPTX Export] Using OMML formula mode (editable, may require repair)');
            await renderer.renderWithOMML(slidesForExport, filename, new MathConverter());
        } else {
            // 标准导出（使用 Unicode 公式）
            console.log('[PPTX Export] Using Unicode formula mode');
            await renderer.render(slidesForExport, filename);
        }
    },

    /**
     * 图片模式导出 PPTX：复用 _renderSlidesToImages 公共方法
     */
    async _exportPPTXAsImages(filename) {
        if (typeof html2canvas === 'undefined') {
            await this._loadScript('https://gcore.jsdelivr.net/npm/html2canvas-pro@1.5.13/dist/html2canvas-pro.min.js');
        }

        const pres = new PptxGenJS();
        pres.layout = 'LAYOUT_16x9';
        pres.title = filename.replace('.pptx', '');

        // 复用公共截图方法
        const images = await this._renderSlidesToImages({ scale: 2, format: 'png' });

        for (const imgData of images) {
            const slide = pres.addSlide();
            slide.addImage({
                data: imgData,
                x: 0,
                y: 0,
                w: '100%',
                h: '100%',
            });
        }

        await pres.writeFile({ fileName: filename });
        console.log('[PPTX Image] Export complete');
    },

    /**
     * 公共方法：将所有幻灯片渲染为图片
     * @param {object} options - { scale, format: 'png'|'jpeg', quality }
     * @returns {Promise<string[]>} - Base64 图片数组
     */
    async _renderSlidesToImages(options = {}) {
        const { scale = 2, format = 'png', quality = 0.95 } = options;

        const slideContainer = document.createElement('div');
        slideContainer.style.cssText = 'position: fixed; left: -9999px; top: 0; width: 960px; height: 540px; z-index: -9999;';
        document.body.appendChild(slideContainer);

        const renderer = new HTMLSlideRenderer();
        const slidesForExport = await this._bakeEffectsForPPTX(this.slides);
        const images = [];

        try {
            for (let i = 0; i < slidesForExport.length; i++) {
                console.log(`[RenderImages] Slide ${i + 1}/${slidesForExport.length}`);

                // 渲染 HTML
                slideContainer.innerHTML = `<div style="width: 960px; height: 540px; overflow: hidden;">${renderer.render(slidesForExport[i], i)}</div>`;

                // 等待资源加载
                await this._waitForIconsToLoad(slideContainer);
                await this._waitForImagesToLoad(slideContainer);
                await this._waitForKatexAndInlineStyles(slideContainer);

                // 修复行高
                const innerContent = slideContainer.firstChild;
                if (innerContent) {
                    innerContent.style.lineHeight = 'initial';
                    innerContent.querySelectorAll('*').forEach(el => {
                        el.style.lineHeight = 'initial';
                        if (el.tagName === 'IMG') el.style.display = 'inline-block';
                    });
                }

                // 截图（带回退）
                const hasEffects = this._slideHasEffects(slidesForExport[i]);
                const canvas = await this._captureToCanvas(slideContainer.firstChild, {
                    scale,
                    useCORS: true,
                    allowTaint: false,
                    backgroundColor: '#ffffff',
                    logging: false,
                    foreignObjectRendering: hasEffects,
                    removeContainer: true,
                }, {
                    foreignObjectRendering: false,
                    logging: false,
                });

                const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
                images.push(canvas.toDataURL(mimeType, quality));
            }
        } finally {
            document.body.removeChild(slideContainer);
        }

        return images;
    },

    async _exportPDF() {
        if (typeof html2canvas === 'undefined' || typeof window.jspdf === 'undefined') {
            await this._loadScript('https://gcore.jsdelivr.net/npm/html2canvas-pro@1.5.13/dist/html2canvas-pro.min.js');
            await this._loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
        }

        // Target 1920x1080 exports (double the preview base) to improve fidelity.
        const EXPORT_WIDTH = 1920;
        const EXPORT_HEIGHT = 1080;
        const EXPORT_SCALE = 3; // higher scale to improve sharpness in final PDF

        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [EXPORT_WIDTH, EXPORT_HEIGHT] });

        const slideContainer = document.createElement('div');
        slideContainer.style.cssText = 'position: fixed; left: -9999px; top: 0; width: 960px; height: 540px; z-index: -9999;';
        document.body.appendChild(slideContainer);

        const renderer = new HTMLSlideRenderer();
        const slidesForExport = await this._bakeEffectsForPPTX(this.slides);

        for (let i = 0; i < slidesForExport.length; i++) {
            if (i > 0) pdf.addPage([EXPORT_WIDTH, EXPORT_HEIGHT], 'landscape');

            slideContainer.innerHTML = `<div style="width: 960px; height: 540px; overflow: hidden;">${renderer.render(slidesForExport[i], i)}</div>`;

            await this._waitForIconsToLoad(slideContainer);
            await this._waitForImagesToLoad(slideContainer);
            await this._waitForKatexAndInlineStyles(slideContainer);

            const innerContent = slideContainer.firstChild;
            if (innerContent) {
                innerContent.style.lineHeight = 'initial';
                innerContent.querySelectorAll('*').forEach(el => {
                    el.style.lineHeight = 'initial';
                    if (el.tagName === 'IMG') {
                        el.style.display = 'inline-block';
                    }
                });
            }

            const hasEffects = this._slideHasEffects(slidesForExport[i]);
            const canvas = await this._captureToCanvas(slideContainer.firstChild, {
                scale: EXPORT_SCALE,
                useCORS: true,
                allowTaint: false,
                backgroundColor: '#ffffff',
                logging: hasEffects,  // 仅在有特效时打印日志
                scrollX: 0,
                scrollY: 0,
                x: 0,
                y: 0,
                foreignObjectRendering: hasEffects,  // 特效场景启用 foreignObject 以保留 filter/blend
                removeContainer: true,
            }, {
                // 回退：禁用 foreignObject 以避免某些浏览器崩溃
                foreignObjectRendering: false,
                logging: false,
            });

            const imgData = canvas.toDataURL('image/jpeg', 0.95);
            pdf.addImage(imgData, 'JPEG', 0, 0, EXPORT_WIDTH, EXPORT_HEIGHT);
        }

        document.body.removeChild(slideContainer);
        pdf.save(`${this.currentProject?.title || 'presentation'}.pdf`);
    },

    async _waitForKatexAndInlineStyles(container) {
        await new Promise(resolve => setTimeout(resolve, 200));

        container.querySelectorAll('.katex').forEach(katex => {
            katex.style.margin = '0';
            katex.style.padding = '0';
            katex.style.lineHeight = '1';
        });
        container.querySelectorAll('.katex-html').forEach(el => {
            el.style.margin = '0';
            el.style.padding = '0';
        });
        container.querySelectorAll('.formula-wrapper').forEach(el => {
            el.style.margin = '0';
            el.style.padding = '0';
            el.style.lineHeight = '1';
        });

        const katexElements = container.querySelectorAll('.katex');
        if (katexElements.length === 0) {
            await new Promise(resolve => setTimeout(resolve, 50));
            return;
        }

        container.querySelectorAll('[data-el="formula"]').forEach(el => {
            el.style.overflow = 'visible';
        });

        const inlineStyles = (el) => {
            if (el.nodeType !== 1) return;

            const computed = window.getComputedStyle(el);
            const styles = [];
            const props = [
                'display', 'position', 'top', 'left', 'right', 'bottom',
                'width', 'height', 'min-width', 'min-height',
                'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
                'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
                'font-family', 'font-size', 'font-weight', 'font-style',
                'line-height', 'text-align',
                'color', 'background-color',
                'border', 'border-top', 'border-bottom', 'border-left', 'border-right',
                'border-width', 'border-style', 'border-color',
                'transform', 'opacity', 'box-sizing',
            ];

            props.forEach(prop => {
                const value = computed.getPropertyValue(prop);
                if (value && value !== 'none' && value !== 'auto' && value !== 'normal' &&
                    value !== '0px' && value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent') {
                    styles.push(`${prop}: ${value}`);
                }
            });

            styles.push('overflow: visible');

            const va = computed.getPropertyValue('vertical-align');
            if (va && va !== 'baseline') {
                if (va.endsWith('em')) {
                    const emVal = parseFloat(va);
                    const fontSizePx = parseFloat(computed.getPropertyValue('font-size'));
                    const pxVal = emVal * fontSizePx;
                    styles.push(`vertical-align: ${pxVal}px`);
                } else {
                    styles.push(`vertical-align: ${va}`);
                }
            }

            if (styles.length > 0) {
                el.style.cssText = styles.join('; ') + ';';
            }

            Array.from(el.children).forEach(inlineStyles);
        };

        katexElements.forEach(katex => {
            let parent = katex.parentElement;
            while (parent && parent !== container) {
                parent.style.overflow = 'visible';
                parent = parent.parentElement;
            }
            inlineStyles(katex);
        });

        container.querySelectorAll('.frac-line').forEach(el => {
            const computed = window.getComputedStyle(el);
            el.style.borderBottomWidth = computed.borderBottomWidth || '0.04em';
            el.style.borderBottomStyle = 'solid';
            el.style.borderBottomColor = computed.color || 'currentColor';
        });

        container.querySelectorAll('.sqrt-line').forEach(el => {
            el.style.borderTopWidth = '1px';
            el.style.borderTopStyle = 'solid';
        });

        container.querySelectorAll('.strut').forEach(el => {
            const computed = window.getComputedStyle(el);
            el.style.height = computed.height;
            el.style.display = 'inline-block';
            el.style.verticalAlign = 'baseline';
        });

        container.querySelectorAll('.katex-html').forEach(el => {
            el.style.overflow = 'visible';
        });

        await new Promise(resolve => setTimeout(resolve, 50));
    },

    async _waitForIconsToLoad(container, timeout = 5000) {
        const icons = Array.from(container.querySelectorAll('iconify-icon'));
        if (icons.length === 0) return;

        for (const icon of icons) {
            const iconName = icon.getAttribute('icon');
            if (!iconName) continue;

            try {
                const computedStyle = window.getComputedStyle(icon);
                const size = computedStyle.fontSize || '24px';
                const color = computedStyle.color || 'currentColor';
                const [prefix, name] = iconName.includes(':') ? iconName.split(':') : ['carbon', iconName];
                const apiUrl = `https://api.iconify.design/${prefix}/${name}.svg?color=${encodeURIComponent(color)}`;

                const response = await fetch(apiUrl);
                if (response.ok) {
                    const svgText = await response.text();
                    const wrapper = document.createElement('span');
                    wrapper.innerHTML = svgText;
                    const svg = wrapper.querySelector('svg');
                    if (svg) {
                        svg.style.width = size;
                        svg.style.height = size;
                        svg.style.display = 'inline-block';
                        svg.style.verticalAlign = 'middle';
                        svg.style.flexShrink = '0';
                        icon.replaceWith(svg);
                        continue;
                    }
                }
            } catch (e) {
                console.warn('Failed to fetch icon from API:', e);
            }

            const startTime = Date.now();
            while (Date.now() - startTime < timeout) {
                const svg = icon.shadowRoot?.querySelector('svg');
                if (svg) {
                    const clonedSvg = svg.cloneNode(true);
                    const computedStyle = window.getComputedStyle(icon);
                    clonedSvg.style.width = computedStyle.fontSize || '1em';
                    clonedSvg.style.height = computedStyle.fontSize || '1em';
                    clonedSvg.style.color = computedStyle.color;
                    clonedSvg.style.fill = 'currentColor';
                    clonedSvg.style.display = 'inline-block';
                    clonedSvg.style.verticalAlign = 'middle';
                    icon.replaceWith(clonedSvg);
                    break;
                }
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        await new Promise(resolve => setTimeout(resolve, 100));
    },

    _exportHTMLRaw() {
        const htmlContent = this.sampleHTML || '';

        const fullHTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${this.currentProject?.title || 'Presentation'} - 原始 HTML</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: "Source Han Sans SC", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif;
            background: #f5f5f5;
            padding: 20px;
        }
        .info-banner {
            background: #fef3c7;
            border: 1px solid #f59e0b;
            color: #92400e;
            padding: 12px 20px;
            border-radius: 8px;
            margin-bottom: 20px;
            max-width: 960px;
            margin-left: auto;
            margin-right: auto;
        }
        section {
            width: 960px;
            height: 540px;
            margin: 20px auto;
            box-shadow: 0 4px 20px rgba(0,0,0,0.1);
            overflow: hidden;
            position: relative;
            background: #fff;
        }
        [data-el] {
            position: absolute;
            border: 2px dashed #ccc;
            background: rgba(200,200,200,0.1);
            font-size: 12px;
            color: #666;
            padding: 4px;
            overflow: hidden;
        }
        [data-el]::before {
            content: attr(data-el) " | " attr(data-x) "," attr(data-y);
            font-family: monospace;
            font-size: 10px;
            color: #999;
        }
    </style>
    <script src="https://code.iconify.design/iconify-icon/1.0.7/iconify-icon.min.js"></script>
</head>
<body>
<div class="info-banner">
    <strong>⚠️ 原始 HTML 格式</strong><br>
    这是 AI 输出的 data-* 属性格式，尚未经过样式渲染。元素显示为占位框，标注了类型和位置信息。
</div>
${htmlContent}
</body>
</html>`;

        this._downloadHTML(fullHTML, 'raw');
    },

    _exportHTMLRendered() {
        const renderer = new HTMLSlideRenderer();
        const slides = this.slides || [];

        const renderedSlides = slides.map((slide, i) => {
            const content = renderer.render(slide, i);
            let bgStyle = 'background: #ffffff;';
            if (slide.background) {
                if (slide.background.gradient) {
                    bgStyle = 'background: ' + slide.background.gradient + ';';
                } else if (slide.background.color) {
                    bgStyle = 'background-color: ' + slide.background.color + ';';
                } else if (slide.background.image) {
                    bgStyle = "background-image: url('" + slide.background.image + "'); background-size: cover; background-position: center;";
                }
            }
            return '<section style="width: 960px; height: 540px; position: relative; overflow: hidden; ' + bgStyle + '">' + content + '</section>';
        }).join('\n\n');

        const title = (this.currentProject?.title || 'Presentation') + ' - 渲染后';
        const fullHTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: "Source Han Sans SC", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif;
            background: #1a1a2e;
            padding: 40px 20px;
        }
        .info-banner {
            background: #d1fae5;
            border: 1px solid #10b981;
            color: #065f46;
            padding: 12px 20px;
            border-radius: 8px;
            margin-bottom: 20px;
            max-width: 960px;
            margin-left: auto;
            margin-right: auto;
        }
        section {
            margin: 20px auto;
            box-shadow: 0 8px 32px rgba(0,0,0,0.3);
            border-radius: 4px;
        }
    </style>
    <script src="https://code.iconify.design/iconify-icon/1.0.7/iconify-icon.min.js"></script>
</head>
<body>
<div class="info-banner">
    <strong>✅ 渲染后 HTML</strong><br>
    这是经过 HTMLSlideRenderer 处理后的结果，所有 data-* 属性已转换为内联样式。
</div>
${renderedSlides}
</body>
</html>`;

        this._downloadHTML(fullHTML, 'rendered');
    },

    _downloadHTML(content, suffix) {
        const blob = new Blob([content], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const filename = (this.currentProject?.title || 'presentation') + '-' + suffix + '.html';
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    },

    _generateHTMLFromSlides() {
        const renderer = new HTMLSlideRenderer();
        return this.slides.map((slide, i) => {
            const content = renderer.render(slide, i);
            return `<section data-type="${slide.type}" id="slide-${i}">\n${content}\n</section>`;
        }).join('\n\n');
    },

    async _exportImages() {
        if (typeof html2canvas === 'undefined') {
            await this._loadScript('https://gcore.jsdelivr.net/npm/html2canvas-pro@1.5.13/dist/html2canvas-pro.min.js');
        }
        if (typeof JSZip === 'undefined') {
            await this._loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
        }

        const zip = new JSZip();
        const slideContainer = document.createElement('div');
        slideContainer.style.cssText = 'position: fixed; left: -9999px; width: 960px; height: 540px;';
        document.body.appendChild(slideContainer);

        const renderer = new HTMLSlideRenderer();
        const slidesForExport = await this._bakeEffectsForPPTX(this.slides);

        const EXPORT_SCALE = 3; // capture at higher scale for sharper images

        for (let i = 0; i < slidesForExport.length; i++) {
            slideContainer.innerHTML = `<div style="width: 960px; height: 540px; overflow: hidden;">${renderer.render(slidesForExport[i], i)}</div>`;

            await this._waitForIconsToLoad(slideContainer);
            await this._waitForImagesToLoad(slideContainer);
            await this._waitForKatexAndInlineStyles(slideContainer);

            const hasEffects = this._slideHasEffects(slidesForExport[i]);
            const canvas = await this._captureToCanvas(slideContainer.firstChild, {
                scale: EXPORT_SCALE,
                useCORS: true,
                allowTaint: false,
                backgroundColor: '#ffffff',
                foreignObjectRendering: hasEffects,
            }, {
                foreignObjectRendering: false,
            });

            const imgData = canvas.toDataURL('image/png').split(',')[1];
            zip.file(`slide-${String(i + 1).padStart(2, '0')}.png`, imgData, { base64: true });
        }

        document.body.removeChild(slideContainer);

        const content = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(content);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${this.currentProject?.title || 'presentation'}-images.zip`;
        a.click();
        URL.revokeObjectURL(url);
    },

    _loadScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    },

    /**
     * 等待容器内所有图片加载完成，并将跨域图片转为 base64。
     * 同时将 CSS filter (如 blur) 烘焙到图片像素，避免 html2canvas 丢失效果。
     */
    async _waitForImagesToLoad(container, timeout = 10000) {
        const images = Array.from(container.querySelectorAll('img'));
        if (images.length === 0) return;

        const loadPromises = images.map(async (img) => {
            try {
                if (img.dataset.filterBaked === 'true') return;

                // 提前设置跨域策略，方便 html2canvas 重新拉取资源
                if (!img.crossOrigin) {
                    img.crossOrigin = 'anonymous';
                }
                if (!img.referrerPolicy) {
                    img.referrerPolicy = 'no-referrer';
                }

                // 等待图片加载
                if (!img.complete || img.naturalHeight === 0) {
                    await new Promise((resolve) => {
                        img.onload = resolve;
                        img.onerror = resolve;
                        setTimeout(resolve, timeout);
                    });
                }

                // 尝试将跨域图片转为 base64
                try {
                    const src = img.src;
                    // 跳过已经是 base64 或 blob 的图片
                    if (src.startsWith('data:') || src.startsWith('blob:')) return;

                    // 跳过同源图片
                    const imgUrl = new URL(src, window.location.href);
                    if (imgUrl.origin === window.location.origin) return;

                    // 使用 fetch + canvas 转换为 base64
                    const response = await fetch(src, { mode: 'cors' });
                    const blob = await response.blob();
                    const base64 = await new Promise((resolve) => {
                        const reader = new FileReader();
                        reader.onloadend = () => resolve(reader.result);
                        reader.readAsDataURL(blob);
                    });

                    // 替换为 base64
                    img.src = base64;
                    // 等待新图片加载
                    await new Promise(resolve => {
                        if (img.complete) resolve();
                        else img.onload = resolve;
                    });
                } catch (e) {
                    console.warn('[_waitForImagesToLoad] Failed to convert image to base64:', img.src, e);
                }

                const { filter, sourceEl } = this._getImageFilterForExport(img);
                if (filter && filter !== 'none') {
                    await this._bakeFilterIntoImage(img, filter);
                    if (sourceEl) {
                        sourceEl.style.filter = 'none';
                    }
                    img.dataset.filterBaked = 'true';
                }
            } catch (err) {
                console.warn('[_waitForImagesToLoad] image handling skipped due to error:', err);
            }
        });

        await Promise.all(loadPromises);
        // 额外等待确保渲染完成
        await new Promise(resolve => setTimeout(resolve, 100));
    },

    _getImageFilterForExport(img) {
        const readFilter = (el) => {
            if (!el) return null;
            const inline = (el.style?.filter || '').trim();
            if (inline && inline !== 'none') return inline;
            const computed = window.getComputedStyle(el).filter;
            if (computed && computed !== 'none') return computed;
            return null;
        };

        let sourceEl = img;
        let filter = readFilter(img);

        if (!filter) {
            filter = readFilter(img.parentElement);
            if (filter) {
                sourceEl = img.parentElement;
            }
        }

        return { filter, sourceEl: filter ? sourceEl : null };
    },

    async _bakeFilterIntoImage(img, filter) {
        if (!filter || filter === 'none') return;

        try {
            const width = Math.max(img.naturalWidth || img.width || 0, 1);
            const height = Math.max(img.naturalHeight || img.height || 0, 1);
            if (!width || !height) return;

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            ctx.filter = filter;
            ctx.drawImage(img, 0, 0, width, height);

            img.src = canvas.toDataURL('image/png');

            await new Promise(resolve => {
                if (img.complete) resolve();
                else img.onload = resolve;
                setTimeout(resolve, 200);
            });
        } catch (e) {
            console.warn('[_bakeFilterIntoImage] Failed to apply filter into image:', e);
        }
    },

    async _captureToCanvas(target, options, fallbackOptions) {
        const attempts = [];
        
        // 尝试顺序（从最可能成功到最兼容）:
        // 1) 禁用 foreignObject - 最稳定，适用于大多数场景
        attempts.push({
            ...options,
            foreignObjectRendering: false,
            allowTaint: true,
            useCORS: true,
        });
        
        // 2) 如果需要 blend 效果，再尝试 foreignObject 模式
        if (options?.foreignObjectRendering) {
            attempts.push({
                ...options,
                foreignObjectRendering: true,
                allowTaint: true,
            });
        }
        
        // 3) 显式降级配置
        if (fallbackOptions) {
            attempts.push({ ...options, ...fallbackOptions, foreignObjectRendering: false });
        }

        for (let i = 0; i < attempts.length; i++) {
            const attempt = attempts[i];
            try {
                const canvas = await html2canvas(target, attempt);
                // 验证画布不是空的
                if (canvas && canvas.width > 0 && canvas.height > 0) {
                    return canvas;
                }
            } catch (err) {
                const hint = err?.target?.src?.substring?.(0, 100) || err?.message || err;
                console.warn(`[html2canvas] capture attempt ${i + 1}/${attempts.length} failed:`, hint);
            }
        }

        // 全部失败时返回空白画布，保证流程不中断
        console.error('[html2canvas] All capture attempts failed, returning blank canvas');
        const rect = target?.getBoundingClientRect?.();
        const width = Math.max(Math.round(rect?.width || options?.width || 1), 1);
        const height = Math.max(Math.round(rect?.height || options?.height || 1), 1);
        const blank = document.createElement('canvas');
        blank.width = width;
        blank.height = height;
        const ctx = blank.getContext('2d');
        if (ctx && options?.backgroundColor) {
            ctx.fillStyle = options.backgroundColor;
            ctx.fillRect(0, 0, width, height);
        }
        return blank;
    },

    /**
     * 智能分层烘焙：将连续的特效元素合并为"智能对象"，保持层叠关系。
     * 类似 Photoshop 的智能对象概念：
     * - 连续的特效层合并烘焙为一张图片
     * - 普通元素（文字、图表）保持原生可编辑
     * - 层叠顺序不变
     */
    async _bakeEffectsForPPTX(slides) {
        const needsBaking = slides.some(slide => this._slideHasEffects(slide));
        console.log('[_bakeEffectsForPPTX] Checking if baking needed:', needsBaking);
        if (!needsBaking) return slides;

        // 需要 html2canvas 才能烘焙
        if (typeof html2canvas === 'undefined') {
            await this._loadScript('https://gcore.jsdelivr.net/npm/html2canvas-pro@1.5.13/dist/html2canvas-pro.min.js');
        }

        const renderer = new HTMLSlideRenderer();
        const bakedSlides = [];

        // 隐藏容器用于截图
        const container = document.createElement('div');
        container.style.cssText = 'position: fixed; left: -9999px; top: 0; width: 960px; height: 540px; z-index: -9999;';
        document.body.appendChild(container);

        for (let i = 0; i < slides.length; i++) {
            const slide = slides[i];

            // 非 freeform 或无特效元素，直接保留
            if (!this._slideHasEffects(slide)) {
                bakedSlides.push(slide);
                continue;
            }

            // 按 z-index 排序元素（稳定排序：z 相同时保持原始顺序）
            const sortedElements = [...(slide.elements || [])]
                .map((el, i) => ({ ...el, _originalIndex: i }))
                .sort((a, b) => (a.z || 0) - (b.z || 0) || a._originalIndex - b._originalIndex);

            // 区分 blend 效果和 filter/mask 效果
            // blend 需要和背景一起烘焙；filter/mask 可以单独烘焙
            const blendElements = sortedElements.filter(el => el.blend && el.blend !== 'normal');
            const filterElements = sortedElements.filter(el => el.filter);
            console.log(`[_bakeEffectsForPPTX] Slide ${i + 1}: ${blendElements.length} blend, ${filterElements.length} filter elements`);
            
            if (blendElements.length > 0) {
                // 有 blend 效果：找到最高 blend 元素的 z-index
                const maxBlendZ = Math.max(...blendElements.map(el => el.z || 0));
                
                // backdrop = blend 元素及其下方所有元素（需要一起烘焙以正确混合）
                const elementsTosBake = sortedElements.filter(el => (el.z || 0) <= maxBlendZ);
                // foreground = blend 元素之上的元素（保持原生）
                const foregroundElements = sortedElements.filter(el => (el.z || 0) > maxBlendZ);
                
                // 烘焙 backdrop + blend 元素
                const bakedEl = await this._bakeElementGroupToImage(
                    elementsTosBake.filter(el => this._elementNeedsBaking(el)), // blend 元素
                    renderer, 
                    container, 
                    elementsTosBake.filter(el => !this._elementNeedsBaking(el)), // backdrop
                    slide.background
                );
                
                const processedElements = [];
                if (bakedEl) {
                    processedElements.push(bakedEl);
                } else {
                    // 烘焙失败，保留原始元素
                    processedElements.push(...elementsTosBake);
                }
                // 前景元素保持原生
                processedElements.push(...foregroundElements);
                
                bakedSlides.push({
                    ...slide,
                    elements: processedElements,
                });
            } else {
                // 无 blend 效果，使用原来的分组逻辑处理 filter/mask
                const groups = this._groupElementsForBaking(sortedElements);
                console.log(`[_bakeEffectsForPPTX] Slide ${i + 1}: ${groups.length} groups, effect groups: ${groups.filter(g => g.type === 'effect').length}`);
                const processedElements = [];
                
                for (const group of groups) {
                    if (group.type === 'normal') {
                        processedElements.push(...group.elements);
                    } else if (group.type === 'effect') {
                        // filter/mask 效果不需要与背景混合，直接烘焙特效元素
                        const minZ = Math.min(...group.elements.map(el => el.z || 0));
                        console.log(`[_bakeEffectsForPPTX] Baking effect group with ${group.elements.length} elements`);
                        const bakedEl = await this._bakeElementGroupToImage(
                            group.elements, 
                            renderer, 
                            container, 
                            [], // 无需 backdrop
                            'transparent'
                        );
                        console.log(`[_bakeEffectsForPPTX] Bake result:`, bakedEl ? 'success' : 'failed');
                        if (bakedEl) {
                            bakedEl.z = minZ; // 保持层叠顺序
                            processedElements.push(bakedEl);
                        } else {
                            processedElements.push(...group.elements);
                        }
                    }
                }
                
                bakedSlides.push({
                    ...slide,
                    elements: processedElements,
                });
            }
        }

        document.body.removeChild(container);
        return bakedSlides;
    },

    /**
     * 将元素按层叠顺序分组：
     * - 连续的特效元素合并为一组（effect）
     * - 普通元素各自独立或连续合并为一组（normal）
     *
     * 例如：[text, shape+blend, circle+filter, text, image+mask]
     * 分组为：[{normal: [text]}, {effect: [shape, circle]}, {normal: [text]}, {effect: [image]}]
     */
    _groupElementsForBaking(sortedElements) {
        const groups = [];
        let currentGroup = null;

        for (const el of sortedElements) {
            const needsBaking = this._elementNeedsBaking(el);
            const groupType = needsBaking ? 'effect' : 'normal';

            if (!currentGroup || currentGroup.type !== groupType) {
                // 开始新分组
                currentGroup = { type: groupType, elements: [] };
                groups.push(currentGroup);
            }

            currentGroup.elements.push(el);
        }

        return groups;
    },

    /**
     * 将一组元素烘焙为单张图片（智能对象）
     * 关键改进：对于有 blend 效果的元素，必须在完整的 DOM 上下文中渲染，
     * 然后截图，而不是分层合成。这样 CSS 的 mix-blend-mode 才能正确工作。
     */
    async _bakeElementGroupToImage(elements, renderer, container, backdropElements = [], backgroundFill = 'transparent') {
        if (!elements || elements.length === 0) return null;

        try {
            const minZ = Math.min(...elements.map(el => el.z || 0));
            const hasBlend = elements.some(el => el.blend && el.blend !== 'normal');

            // 合并所有元素（背景 + 特效元素），按 z-index 排序
            const combinedElements = [...backdropElements, ...elements].sort((a, b) => (a.z || 0) - (b.z || 0));

            // 重要：对于有 blend 效果的场景，必须让浏览器完成 CSS 混合模式的渲染，
            // 然后用 html2canvas 截取最终结果。不要尝试分层合成。
            const tempSlide = {
                type: 'freeform',
                background: backgroundFill || 'transparent',
                elements: combinedElements,
            };

            // 渲染完整的幻灯片到容器
            const bgStyle = backgroundFill ? `background: ${backgroundFill};` : 'background: transparent;';
            container.innerHTML = `<div style="width: 960px; height: 540px; overflow: visible; ${bgStyle}">${renderer.render(tempSlide, 0)}</div>`;

            // 等待所有资源加载
            await this._waitForIconsToLoad(container);
            await this._waitForImagesToLoad(container);
            await this._waitForKatexAndInlineStyles(container);

            // 额外等待确保 CSS 动画和过渡完成
            await new Promise(resolve => setTimeout(resolve, 100));

            // 使用 html2canvas 截图，foreignObjectRendering 模式更好地支持 CSS 效果
            const scale = 2; // 平衡清晰度和内存使用
            const canvas = await this._captureToCanvas(container.firstChild, {
                scale,
                useCORS: true,
                allowTaint: false,
                backgroundColor: backgroundFill || null,
                logging: false,
                foreignObjectRendering: false,  // 禁用以提高稳定性
            }, {
                // 回退配置
                foreignObjectRendering: false,
                allowTaint: true,
            });

            let dataUrl = null;
            if (canvas) {
                dataUrl = canvas.toDataURL('image/png');
                // 释放 canvas 内存
                canvas.width = 0;
                canvas.height = 0;
            }
            if (!dataUrl) return null;

            if (hasBlend) {
                console.info('[_bakeElementGroupToImage] blend effects captured:', 
                    elements.filter(e => e.blend && e.blend !== 'normal').map(e => `${e.type}:${e.blend}`).join(', '));
            }

            return {
                type: 'baked_element',
                image: dataUrl,
                // 全屏放置，因为元素位置已经在截图中
                x: '0%',
                y: '0%',
                w: '100%',
                h: '100%',
                z: minZ,
                originalElements: elements.length,
                originalTypes: elements.map(el => el.type).join(','),
            };
        } catch (e) {
            console.warn('[_bakeElementGroupToImage] Failed to bake element group:', e);
            return null;
        }
    },

    async _renderElementsToCanvas(elements, renderer, container, opts = {}) {
        if (!elements) return null;
        const sanitized = opts.disableBlend ? this._cloneElementsWithoutBlend(elements) : elements;
        const tempSlide = {
            type: 'freeform',
            background: opts.backgroundColor ?? 'transparent',
            elements: sanitized || [],
        };

        const bgStyle = opts.backgroundColor ? `background: ${opts.backgroundColor};` : 'background: transparent;';
        container.innerHTML = `<div style="width: 960px; height: 540px; overflow: visible; ${bgStyle}">${renderer.render(tempSlide, 0)}</div>`;
        await this._waitForIconsToLoad(container);
        await this._waitForImagesToLoad(container);
        await this._waitForKatexAndInlineStyles(container);

        const scale = opts.scale ?? 3;
        const canvas = await this._captureToCanvas(container.firstChild, {
            scale,
            useCORS: true,
            allowTaint: opts.allowTaint ?? false,
            backgroundColor: opts.backgroundColor ?? null,
            logging: false,
            foreignObjectRendering: opts.foreignObjectRendering ?? true,
        }, {
            foreignObjectRendering: false,
            allowTaint: true,
        });

        return canvas;
    },

    _cloneElementsWithoutBlend(elements) {
        return (elements || []).map(el => {
            const cloned = { ...el };
            if (cloned.blend && cloned.blend !== 'normal') {
                cloned._origBlend = cloned.blend;
                cloned.blend = 'normal';
            }
            if (cloned.children) {
                cloned.children = this._cloneElementsWithoutBlend(cloned.children);
            }
            return cloned;
        });
    },

    _mapBlendToComposite(blend) {
        if (!blend || blend === 'normal') return 'source-over';
        const map = {
            multiply: 'multiply',
            screen: 'screen',
            overlay: 'overlay',
            darken: 'darken',
            lighten: 'lighten',
            color_dodge: 'color-dodge',
            'color-dodge': 'color-dodge',
            color_burn: 'color-burn',
            'color-burn': 'color-burn',
            hard_light: 'hard-light',
            'hard-light': 'hard-light',
            soft_light: 'soft-light',
            'soft-light': 'soft-light',
            difference: 'difference',
            exclusion: 'exclusion',
        };
        return map[blend] || 'source-over';
    },

    async _manualBlendComposite(elements, backdropElements, renderer, container, scale = 3, backgroundFill = 'transparent') {
        try {
            const width = Math.round(960 * scale);
            const height = Math.round(540 * scale);
            const baseCanvas = document.createElement('canvas');
            baseCanvas.width = width;
            baseCanvas.height = height;
            const ctx = baseCanvas.getContext('2d');
            if (!ctx) return null;

            if (backgroundFill && backgroundFill !== 'transparent') {
                ctx.globalCompositeOperation = 'source-over';
                ctx.fillStyle = backgroundFill;
                ctx.fillRect(0, 0, width, height);
            }

            // 背景
            const backdropCanvas = await this._renderElementsToCanvas(backdropElements, renderer, container, {
                scale,
                backgroundColor: backgroundFill || 'transparent',
                foreignObjectRendering: true,
                allowTaint: false,
            });
            if (backdropCanvas) {
                ctx.globalCompositeOperation = 'source-over';
                ctx.drawImage(backdropCanvas, 0, 0);
            }

            // 按 z 顺序叠加特效元素，使用 canvas 的合成模式
            const sorted = [...elements].sort((a, b) => (a.z || 0) - (b.z || 0));
            for (const el of sorted) {
                const elCanvas = await this._renderElementsToCanvas([el], renderer, container, {
                    scale,
                    backgroundColor: null,
                    foreignObjectRendering: true,
                    allowTaint: false,
                    disableBlend: true, // 手动处理 blend，避免 html2canvas 先混一次
                });
                if (!elCanvas) continue;
                ctx.globalCompositeOperation = this._mapBlendToComposite(el.blend);
                ctx.drawImage(elCanvas, 0, 0);
            }

            ctx.globalCompositeOperation = 'source-over';
            return baseCanvas.toDataURL('image/png');
        } catch (e) {
            console.warn('[_manualBlendComposite] fallback failed:', e);
            return null;
        }
    },

    /**
     * 计算一组元素的边界框
     */
    _calculateGroupBounds(elements) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        for (const el of elements) {
            const x = this._parsePercent(el.x) || 0;
            const y = this._parsePercent(el.y) || 0;
            const w = this._parsePercent(el.w) || 10;
            const h = this._parsePercent(el.h) || 10;

            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x + w);
            maxY = Math.max(maxY, y + h);
        }

        return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    },

    _parsePercent(value) {
        if (typeof value === 'number') return value;
        const str = String(value).trim();
        if (str.endsWith('%')) return parseFloat(str);
        return parseFloat(str) || 0;
    },

    _slideHasEffects(slide) {
        if (!slide) return false;
        // freeform: 只检查需要烘焙的效果（blend 模式）
        // filter 和 mask 在 PPTX 中不支持，但不需要烘焙，直接跳过即可
        if (slide.elements && slide.elements.some(el => this._elementNeedsBaking(el))) return true;
        return false;
    },

    /**
     * 检查元素是否需要烘焙
     * - blend: 需要和背景混合，必须一起烘焙
     * - filter: blur 等效果需要单独烘焙成图片
     * - mask: 遮罩效果需要烘焙
     * - 复杂 SVG: 含 pattern、defs、linearGradient 等无法直接转换的
     */
    _elementNeedsBaking(el) {
        if (!el) return false;
        // blend 效果需要和背景一起烘焙
        if (el.blend && el.blend !== 'normal') return true;
        // filter 效果（如 blur）需要单独烘焙
        if (el.filter) return true;
        // mask 效果需要烘焙
        if (el.mask) return true;
        // 复杂 SVG 需要烘焙（pattern、defs 等在直接转换时可能丢失）
        // 但含有 <text> 的 SVG 保持可编辑，不烘焙
        if (el.type === 'svg' && el.content) {
            const content = el.content.toLowerCase();
            const hasComplexFeatures = content.includes('<pattern') || content.includes('<defs') || 
                content.includes('<lineargradient') || content.includes('<radialgradient') ||
                content.includes('<clippath') || content.includes('<mask') ||
                content.includes('marker-end') || content.includes('marker-start');
            // 含复杂特性的 SVG 都烘焙，确保 pattern/marker 等效果不丢失
            if (hasComplexFeatures) {
                return true;
            }
        }
        if (el.children && el.children.some(child => this._elementNeedsBaking(child))) return true;
        return false;
    },

    /**
     * 检查元素是否有任何视觉效果（用于其他场景）
     */
    _elementHasEffects(el) {
        if (!el) return false;
        if ((el.blend && el.blend !== 'normal') || el.mask || el.filter) return true;
        if (el.children && el.children.some(child => this._elementHasEffects(child))) return true;
        return false;
    },

    exportPPTX() {
        return this.exportAs('pptx');
    },

    async _exportWithSlideSystem() {
        const btn = document.querySelector('.ppt-export-btn');
        const originalContent = btn?.innerHTML;

        btn.disabled = true;
        btn.innerHTML = '<iconify-icon icon="carbon:circle-dash" class="animate-spin"></iconify-icon> 正在打包...';

        try {
            const renderer = new PPTXSlideRenderer();
            const filename = `${this.currentProject?.title || 'presentation'}.pptx`;

            await renderer.render(this.slides, filename);

            btn.innerHTML = '<iconify-icon icon="carbon:checkmark"></iconify-icon> 导出成功';
            btn.style.backgroundColor = 'var(--ppt-success)';
            setTimeout(() => {
                btn.disabled = false;
                btn.innerHTML = originalContent;
                btn.style.backgroundColor = '';
            }, 2000);
        } catch (e) {
            console.error('SlideSystem export error:', e);
            alert('导出失败: ' + e.message);
            btn.disabled = false;
            btn.innerHTML = originalContent;
        }
    },

    _exportLegacy() {
        if (typeof PptxGenJS === 'undefined') {
            alert('PPTX 生成库未加载，请检查网络连接。');
            return;
        }

        const btn = document.querySelector('.ppt-header-right .ppt-btn-primary');
        const originalContent = btn.innerHTML;

        btn.disabled = true;
        btn.innerHTML = '<iconify-icon icon="carbon:circle-dash" class="animate-spin"></iconify-icon> 正在打包...';

        try {
            const pres = new PptxGenJS();
            pres.layout = 'LAYOUT_16x9';
            pres.title = this.currentProject.title || 'Presentation';

            const SLIDE_W = 10;
            const SLIDE_H = 5.625;

            const COLORS = {
                primary: '4f46e5',
                primaryLight: 'e0e7ff',
                textMain: '0f172a',
                textSecondary: '475569',
                textMuted: '94a3b8',
                success: '16a34a',
                successBg: 'dcfce7',
                danger: 'dc2626',
                dangerBg: 'fee2e2',
                border: 'e2e8f0',
                bgSubtle: 'f8fafc',
                purple: 'faf5ff'
            };

            this.slides.forEach(slideData => {
                const slide = pres.addSlide();
                slide.background = { color: 'FFFFFF' };

                const padding = 0.7;
                const contentWidth = SLIDE_W - padding * 2;

                if (slideData.type === 'cover') {
                    const coverPadding = 0.93;
                    slide.background = { color: COLORS.primary };

                    slide.addShape('rect', {
                        x: 0, y: 0, w: '100%', h: '100%',
                        fill: { type: 'solid', color: '3b82f6', transparency: 50 },
                        line: { transparency: 100 }
                    });

                    slide.addShape('ellipse', {
                        x: SLIDE_W - 3.5, y: -1.4, w: 4.6, h: 4.6,
                        fill: { type: 'solid', color: 'FFFFFF', transparency: 90 },
                        line: { transparency: 100 }
                    });

                    const startY = SLIDE_H * 0.35;
                    slide.addText(slideData.title, {
                        x: coverPadding, y: startY, w: SLIDE_W - coverPadding * 2, h: 0.8,
                        fontSize: 44, color: 'FFFFFF', bold: true, align: 'left'
                    });
                    slide.addText(slideData.subtitle || '', {
                        x: coverPadding, y: startY + 0.9, w: SLIDE_W - coverPadding * 2, h: 0.5,
                        fontSize: 22, color: 'FFFFFF', transparency: 20, align: 'left'
                    });
                    slide.addText('Generated by Paper Burner X', {
                        x: coverPadding, y: SLIDE_H - 0.6, w: SLIDE_W - coverPadding * 2, h: 0.3,
                        fontSize: 11, color: 'FFFFFF', transparency: 50, align: 'left'
                    });

                } else if (slideData.type === 'toc') {
                    slide.addText(slideData.title, {
                        x: padding, y: padding, w: contentWidth, h: 0.6,
                        fontSize: 32, color: COLORS.textMain, bold: true
                    });

                    const items = slideData.items || [];
                    const startY = padding + 0.9;
                    const itemHeight = 0.55;

                    items.forEach((item, i) => {
                        const y = startY + i * itemHeight;
                        slide.addShape('ellipse', {
                            x: padding, y: y, w: 0.4, h: 0.4,
                            fill: { color: COLORS.primary },
                            line: { transparency: 100 }
                        });
                        slide.addText(String(i + 1), {
                            x: padding, y: y, w: 0.4, h: 0.4,
                            fontSize: 14, color: 'FFFFFF', bold: true, align: 'center', valign: 'middle'
                        });
                        slide.addText(item, {
                            x: padding + 0.55, y: y, w: contentWidth - 0.55, h: 0.4,
                            fontSize: 20, color: COLORS.textSecondary, valign: 'middle'
                        });
                    });

                } else if (slideData.type === 'stats') {
                    slide.addText(slideData.title, {
                        x: padding, y: padding, w: contentWidth, h: 0.6,
                        fontSize: 32, color: COLORS.textMain, bold: true
                    });

                    const stats = slideData.stats || [];
                    const cols = Math.min(stats.length, 4);
                    const cardW = (contentWidth - 0.3 * (cols - 1)) / cols;
                    const cardH = 1.8;
                    const startY = (SLIDE_H - cardH) / 2;

                    stats.forEach((stat, i) => {
                        const x = padding + i * (cardW + 0.3);
                        slide.addText(stat.value, {
                            x: x, y: startY, w: cardW, h: 1,
                            fontSize: 48, color: COLORS.primary, bold: true, align: 'center', valign: 'bottom'
                        });
                        slide.addText(stat.label, {
                            x: x, y: startY + 1.1, w: cardW, h: 0.5,
                            fontSize: 14, color: COLORS.textSecondary, align: 'center', valign: 'top'
                        });
                    });

                } else if (slideData.type === 'comparison') {
                    slide.addText(slideData.title, {
                        x: padding, y: padding, w: contentWidth, h: 0.6,
                        fontSize: 32, color: COLORS.textMain, bold: true
                    });

                    const boxW = (contentWidth - 0.4) / 2;
                    const boxH = SLIDE_H - padding * 2 - 1;
                    const boxY = padding + 0.8;

                    slide.addShape('roundRect', {
                        x: padding, y: boxY, w: boxW, h: boxH,
                        fill: { color: COLORS.dangerBg },
                        line: { transparency: 100 },
                        rectRadius: 0.15
                    });
                    slide.addText(slideData.left?.title || '', {
                        x: padding + 0.3, y: boxY + 0.25, w: boxW - 0.6, h: 0.4,
                        fontSize: 20, color: COLORS.danger, bold: true
                    });
                    const leftItems = (slideData.left?.items || []).map(item => ({
                        text: '✕  ' + item,
                        options: { fontSize: 16, color: '991b1b', breakLine: true }
                    }));
                    slide.addText(leftItems, {
                        x: padding + 0.3, y: boxY + 0.75, w: boxW - 0.6, h: boxH - 1,
                        lineSpacing: 32, valign: 'top'
                    });

                    const rightX = padding + boxW + 0.4;
                    slide.addShape('roundRect', {
                        x: rightX, y: boxY, w: boxW, h: boxH,
                        fill: { color: COLORS.successBg },
                        line: { transparency: 100 },
                        rectRadius: 0.15
                    });
                    slide.addText(slideData.right?.title || '', {
                        x: rightX + 0.3, y: boxY + 0.25, w: boxW - 0.6, h: 0.4,
                        fontSize: 20, color: COLORS.success, bold: true
                    });
                    const rightItems = (slideData.right?.items || []).map(item => ({
                        text: '✓  ' + item,
                        options: { fontSize: 16, color: '166534', breakLine: true }
                    }));
                    slide.addText(rightItems, {
                        x: rightX + 0.3, y: boxY + 0.75, w: boxW - 0.6, h: boxH - 1,
                        lineSpacing: 32, valign: 'top'
                    });

                } else if (slideData.type === 'image_text') {
                    const halfW = (contentWidth - 0.5) / 2;
                    const centerY = SLIDE_H / 2;

                    slide.addText(slideData.title, {
                        x: padding, y: centerY - 1.2, w: halfW, h: 0.6,
                        fontSize: 32, color: COLORS.textMain, bold: true
                    });
                    slide.addText(slideData.content || '', {
                        x: padding, y: centerY - 0.4, w: halfW, h: 1.5,
                        fontSize: 18, color: COLORS.textSecondary, lineSpacing: 28
                    });

                    const imgX = padding + halfW + 0.5;
                    const imgH = 2.8;
                    const imgY = (SLIDE_H - imgH) / 2;
                    slide.addShape('roundRect', {
                        x: imgX, y: imgY, w: halfW, h: imgH,
                        fill: { color: COLORS.primaryLight },
                        line: { transparency: 100 },
                        rectRadius: 0.15
                    });
                    slide.addText(slideData.imagePlaceholder || '图片', {
                        x: imgX, y: imgY, w: halfW, h: imgH,
                        fontSize: 16, color: COLORS.primary, align: 'center', valign: 'middle'
                    });

                } else if (slideData.type === 'icon_grid') {
                    slide.addText(slideData.title, {
                        x: padding, y: padding, w: contentWidth, h: 0.6,
                        fontSize: 32, color: COLORS.textMain, bold: true
                    });

                    const items = slideData.items || [];
                    const cols = Math.min(items.length, 4);
                    const cardW = (contentWidth - 0.3 * (cols - 1)) / cols;
                    const cardH = 2;
                    const startY = padding + 1;

                    items.forEach((item, i) => {
                        const x = padding + i * (cardW + 0.3);
                        slide.addShape('roundRect', {
                            x: x, y: startY, w: cardW, h: cardH,
                            fill: { color: COLORS.bgSubtle },
                            line: { transparency: 100 },
                            rectRadius: 0.15
                        });
                        const iconSize = 0.6;
                        const iconX = x + (cardW - iconSize) / 2;
                        slide.addShape('roundRect', {
                            x: iconX, y: startY + 0.3, w: iconSize, h: iconSize,
                            fill: { color: COLORS.primaryLight },
                            line: { transparency: 100 },
                            rectRadius: 0.1
                        });
                        slide.addText(item.title, {
                            x: x, y: startY + 1.1, w: cardW, h: 0.35,
                            fontSize: 16, color: COLORS.textMain, bold: true, align: 'center'
                        });
                        slide.addText(item.desc, {
                            x: x + 0.1, y: startY + 1.45, w: cardW - 0.2, h: 0.4,
                            fontSize: 12, color: COLORS.textSecondary, align: 'center'
                        });
                    });

                } else if (slideData.type === 'quote') {
                    slide.background = { color: COLORS.purple };

                    slide.addText('"', {
                        x: padding, y: 0.8, w: 1, h: 1,
                        fontSize: 72, color: COLORS.primary, transparency: 70
                    });

                    const quote = slideData.quote || '';
                    slide.addText(`"${quote}"`, {
                        x: padding + 0.5, y: (SLIDE_H - 1.5) / 2, w: contentWidth - 1, h: 1.5,
                        fontSize: 26, color: COLORS.textMain, align: 'center', valign: 'middle', italic: true
                    });

                    slide.addText(slideData.author || '', {
                        x: padding, y: SLIDE_H - 1.2, w: contentWidth, h: 0.35,
                        fontSize: 18, color: COLORS.textMain, bold: true, align: 'center'
                    });
                    slide.addText(slideData.company || '', {
                        x: padding, y: SLIDE_H - 0.8, w: contentWidth, h: 0.3,
                        fontSize: 14, color: COLORS.textSecondary, align: 'center'
                    });

                } else if (slideData.type === 'timeline') {
                    slide.addText(slideData.title, {
                        x: padding, y: padding, w: contentWidth, h: 0.6,
                        fontSize: 32, color: COLORS.textMain, bold: true
                    });

                    const items = slideData.items || [];
                    const cols = items.length;
                    const nodeW = contentWidth / cols;
                    const lineY = SLIDE_H / 2;

                    slide.addShape('rect', {
                        x: padding, y: lineY - 0.02, w: contentWidth, h: 0.04,
                        fill: { color: COLORS.border },
                        line: { transparency: 100 }
                    });

                    items.forEach((item, i) => {
                        const centerX = padding + nodeW * i + nodeW / 2;
                        const circleR = 0.28;
                        slide.addShape('ellipse', {
                            x: centerX - circleR, y: lineY - circleR, w: circleR * 2, h: circleR * 2,
                            fill: { color: COLORS.primary },
                            line: { transparency: 100 }
                        });
                        slide.addText(item.phase, {
                            x: centerX - circleR, y: lineY - circleR, w: circleR * 2, h: circleR * 2,
                            fontSize: 12, color: 'FFFFFF', bold: true, align: 'center', valign: 'middle'
                        });
                        slide.addText(item.title, {
                            x: centerX - nodeW / 2 + 0.1, y: lineY + 0.4, w: nodeW - 0.2, h: 0.35,
                            fontSize: 16, color: COLORS.textMain, bold: true, align: 'center'
                        });
                        slide.addText(item.desc, {
                            x: centerX - nodeW / 2 + 0.1, y: lineY + 0.75, w: nodeW - 0.2, h: 0.4,
                            fontSize: 12, color: COLORS.textSecondary, align: 'center'
                        });
                    });

                } else if (slideData.type === 'end') {
                    slide.background = { color: '0f172a' };

                    slide.addShape('rect', {
                        x: 0, y: 0, w: '100%', h: '100%',
                        fill: { type: 'solid', color: '1e293b', transparency: 50 },
                        line: { transparency: 100 }
                    });

                    slide.addShape('ellipse', {
                        x: SLIDE_W - 3.5, y: -1.4, w: 4.6, h: 4.6,
                        fill: { type: 'solid', color: 'FFFFFF', transparency: 95 },
                        line: { transparency: 100 }
                    });

                    const centerY = SLIDE_H * 0.4;
                    slide.addText(slideData.title, {
                        x: padding, y: centerY, w: contentWidth, h: 0.8,
                        fontSize: 44, color: 'FFFFFF', bold: true, align: 'left'
                    });
                    slide.addText(slideData.subtitle || '', {
                        x: padding, y: centerY + 0.9, w: contentWidth, h: 0.5,
                        fontSize: 22, color: 'FFFFFF', transparency: 30, align: 'left'
                    });
                    if (slideData.email) {
                        slide.addText(slideData.email, {
                            x: padding, y: centerY + 1.6, w: contentWidth, h: 0.4,
                            fontSize: 16, color: 'FFFFFF', transparency: 50, align: 'left'
                        });
                    }
                    slide.addText('Generated by Paper Burner X', {
                        x: padding, y: SLIDE_H - 0.6, w: contentWidth, h: 0.3,
                        fontSize: 11, color: 'FFFFFF', transparency: 60, align: 'left'
                    });

                } else if (slideData.type === 'list') {
                    slide.addText(slideData.title, {
                        x: padding, y: padding, w: contentWidth, h: 0.6,
                        fontSize: 32, color: COLORS.textMain, bold: true
                    });

                    if (slideData.items && slideData.items.length > 0) {
                        const listY = padding + 0.9;
                        const items = slideData.items.map(item => ({
                            text: item,
                            options: { fontSize: 20, color: COLORS.textSecondary, breakLine: true }
                        }));
                        slide.addText(items, {
                            x: padding, y: listY, w: contentWidth, h: SLIDE_H - listY - padding,
                            bullet: { type: 'bullet', code: '2022' },
                            lineSpacing: 40, valign: 'top'
                        });
                    }

                } else {
                    const titleH = 0.6;
                    const contentH = 1.5;
                    const totalH = titleH + 0.3 + contentH;
                    const startY = (SLIDE_H - totalH) / 2;

                    slide.addText(slideData.title, {
                        x: padding, y: startY, w: contentWidth, h: titleH,
                        fontSize: 32, color: COLORS.textMain, bold: true
                    });
                    slide.addText(slideData.content || '', {
                        x: padding, y: startY + titleH + 0.3, w: contentWidth, h: contentH,
                        fontSize: 20, color: COLORS.textSecondary, lineSpacing: 32
                    });
                }
            });

            pres.writeFile({ fileName: `${this.currentProject.title || 'presentation'}.pptx` })
                .then(() => {
                    btn.innerHTML = '<iconify-icon icon="carbon:checkmark"></iconify-icon> 导出成功';
                    btn.style.backgroundColor = 'var(--ppt-success)';
                    setTimeout(() => {
                        btn.disabled = false;
                        btn.innerHTML = originalContent;
                        btn.style.backgroundColor = '';
                    }, 2000);
                })
                .catch(err => {
                    console.error(err);
                    alert('导出失败: ' + err.message);
                    btn.disabled = false;
                    btn.innerHTML = originalContent;
                });

        } catch (e) {
            console.error(e);
            alert('生成 PPTX 时发生错误');
            btn.disabled = false;
            btn.innerHTML = originalContent;
        }
    },
};

Object.assign(PPTGenerator.prototype, PPTGeneratorExport);
