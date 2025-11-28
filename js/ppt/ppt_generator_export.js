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
                    await this._exportPPTX();
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

    async _exportPPTX() {
        if (typeof PptxGenJS === 'undefined') {
            await this._loadScript('https://cdn.jsdelivr.net/gh/gitbrent/PptxGenJS@3.12.0/dist/pptxgen.bundle.js');
        }

        if (typeof PPTXSlideRenderer === 'undefined') {
            throw new Error('PPTX 渲染器未加载');
        }

        const renderer = new PPTXSlideRenderer();
        const filename = `${this.currentProject?.title || 'presentation'}.pptx`;
        await renderer.render(this.slides, filename);
    },

    async _exportPDF() {
        if (typeof html2canvas === 'undefined' || typeof window.jspdf === 'undefined') {
            await this._loadScript('https://gcore.jsdelivr.net/npm/html2canvas-pro@1.5.13/dist/html2canvas-pro.min.js');
            await this._loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
        }

        // Target 1920x1080 exports (double the preview base) to improve fidelity.
        const EXPORT_WIDTH = 1920;
        const EXPORT_HEIGHT = 1080;

        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [EXPORT_WIDTH, EXPORT_HEIGHT] });

        const slideContainer = document.createElement('div');
        slideContainer.style.cssText = 'position: fixed; left: -9999px; top: 0; width: 960px; height: 540px; z-index: -9999;';
        document.body.appendChild(slideContainer);

        const renderer = new HTMLSlideRenderer();

        for (let i = 0; i < this.slides.length; i++) {
            if (i > 0) pdf.addPage([EXPORT_WIDTH, EXPORT_HEIGHT], 'landscape');

            slideContainer.innerHTML = `<div style="width: 960px; height: 540px; overflow: hidden;">${renderer.render(this.slides[i], i)}</div>`;

            await this._waitForIconsToLoad(slideContainer);
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

            const canvas = await html2canvas(slideContainer.firstChild, {
                scale: 2,
                useCORS: true,
                allowTaint: true,
                backgroundColor: '#ffffff',
                logging: false,
                scrollX: 0,
                scrollY: 0,
                x: 0,
                y: 0,
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

        for (let i = 0; i < this.slides.length; i++) {
            slideContainer.innerHTML = `<div style="width: 960px; height: 540px; overflow: hidden;">${renderer.render(this.slides[i], i)}</div>`;

            await this._waitForIconsToLoad(slideContainer);

            const canvas = await html2canvas(slideContainer.firstChild, {
                scale: 2,
                useCORS: true,
                allowTaint: true,
                backgroundColor: '#ffffff'
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
