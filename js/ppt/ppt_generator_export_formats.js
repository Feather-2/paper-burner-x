/**
 * PPTGenerator 导出模块 - 格式导出
 * 包含: PDF、HTML、图片导出
 * 
 * 依赖: ppt_generator_export_image.js, ppt_generator_export_baking.js
 */

const PPTGeneratorExportFormats = {
    // ═══════════════════════════════════════════════════════════════
    // PDF 导出
    // ═══════════════════════════════════════════════════════════════
    
    async _exportPDF() {
        this._showProgress?.('正在加载依赖...', 5);
        
        if (typeof html2canvas === 'undefined' || typeof window.jspdf === 'undefined') {
            await this._loadScript('https://gcore.jsdelivr.net/npm/html2canvas-pro@1.5.13/dist/html2canvas-pro.min.js');
            await this._loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
        }

        const EXPORT_WIDTH = 1920;
        const EXPORT_HEIGHT = 1080;
        const EXPORT_SCALE = 2;  //  提高清晰度
        const CONCURRENCY = 3;  // 并发数

        const { jsPDF } = window.jspdf;
        const total = this.slides.length;
        
        // 并发渲染所有幻灯片
        this._showProgress?.('正在并发渲染幻灯片...', 10);
        const imageDataArray = new Array(total);
        let completed = 0;
        
        const renderSlide = async (index) => {
            const slide = this.slides[index];
            const container = document.createElement('div');
            container.style.cssText = 'position: fixed; left: -9999px; top: 0; width: 960px; height: 540px; z-index: -9999; -webkit-font-smoothing: subpixel-antialiased; text-rendering: optimizeLegibility;';
            document.body.appendChild(container);
            
            try {
                const renderer = new HTMLSlideRenderer();
                const bgFill = this._getSlideBackground(slide);
                const bgStyle = bgFill ? `background: ${bgFill};` : 'background: #ffffff;';
                container.innerHTML = `<div style="width: 960px; height: 540px; overflow: hidden; ${bgStyle}">${renderer.render(slide, index)}</div>`;

                // 确保所有 span 保持 inline 显示（避免 html2canvas 错误处理）
                container.querySelectorAll('span').forEach(span => {
                    if (!span.style.display) {
                        span.style.display = 'inline';
                    }
                });

                // 处理半透明渐变形状：裁剪顶部边缘避免黑线（类似 PPTX 导出的处理）
                container.querySelectorAll('div').forEach(div => {
                    const bg = div.style.background || '';
                    // 检测向上渐变且顶部透明的情况
                    if (bg.includes('gradient') && bg.includes('to top') && 
                        (bg.includes('transparent') || bg.includes('rgba(') || bg.includes(', 0)'))) {
                        // 使用 clip-path 裁剪顶部 2% 去掉黑线伪影
                        div.style.clipPath = 'inset(2% 0 0 0)';
                    }
                });

                // 处理 mask 元素
                const maskedElements = [...container.querySelectorAll('div > img')]
                    .map(img => img.parentElement)
                    .filter(div => {
                        const s = div.getAttribute('style') || '';
                        return s.includes('mask-image') || s.includes('clip-path');
                    });
                if (maskedElements.length > 0) {
                    await Promise.all(maskedElements.map(el => this._bakeMaskIntoElement(el)));
                }

                container.querySelectorAll('svg[style*="width: 0"], svg[style*="height: 0"]').forEach(svg => svg.remove());

                await Promise.all([
                    this._waitForIconsToLoad(container),
                    this._waitForImagesToLoad(container),
                    this._waitForKatexAndInlineStyles(container),
                ]);

                const hasBlend = slide.elements?.some(el => el.blend && el.blend !== 'normal');
                const hasBlurFilter = slide.elements?.some(el => el.filter && el.filter.includes('blur'));
                
                let canvas;
                if (hasBlend && slide.elements) {
                    canvas = await this._captureWithBlend(container, slide.elements, bgFill, EXPORT_SCALE);
                } else {
                    canvas = await this._captureToCanvas(container.firstChild, {
                        scale: EXPORT_SCALE,
                        useCORS: true,
                        allowTaint: false,
                        backgroundColor: null,
                        logging: false,
                        foreignObjectRendering: hasBlurFilter,
                    }, {
                        foreignObjectRendering: false,
                        allowTaint: true,
                    });
                }

                const imgData = canvas.toDataURL('image/jpeg', 0.92);
                canvas.width = 0;
                canvas.height = 0;
                
                imageDataArray[index] = imgData;
                completed++;
                this._showProgress?.(`正在渲染 ${completed}/${total}...`, 10 + (completed / total) * 80);
            } finally {
                document.body.removeChild(container);
            }
        };
        
        // 并发控制
        const queue = [...Array(total).keys()];
        const workers = [];
        for (let i = 0; i < Math.min(CONCURRENCY, total); i++) {
            workers.push((async () => {
                while (queue.length > 0) {
                    const idx = queue.shift();
                    if (idx !== undefined) await renderSlide(idx);
                }
            })());
        }
        await Promise.all(workers);
        
        // 按顺序生成 PDF
        this._showProgress?.('正在生成 PDF...', 92);
        const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [EXPORT_WIDTH, EXPORT_HEIGHT] });
        
        for (let i = 0; i < total; i++) {
            if (i > 0) pdf.addPage([EXPORT_WIDTH, EXPORT_HEIGHT], 'landscape');
            pdf.addImage(imageDataArray[i], 'JPEG', 0, 0, EXPORT_WIDTH, EXPORT_HEIGHT);
        }

        pdf.save(`${this.currentProject?.title || 'presentation'}.pdf`);
    },
    
    /**
     * 获取幻灯片背景样式
     */
    _getSlideBackground(slide) {
        if (!slide) return '#ffffff';
        if (slide.backgroundGradient) return slide.backgroundGradient;
        if (slide.backgroundImage) return `url('${slide.backgroundImage}') center/cover`;
        if (slide.gradient) return slide.gradient;
        if (slide.background && slide.background !== 'transparent') return slide.background;
        return '#ffffff';
    },

    // ═══════════════════════════════════════════════════════════════
    // KaTeX 样式处理
    // ═══════════════════════════════════════════════════════════════

    async _waitForKatexAndInlineStyles(container) {
        const katexElements = container.querySelectorAll('.katex');
        if (katexElements.length === 0) return;
        
        await new Promise(resolve => setTimeout(resolve, 50));

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
    },

    // ═══════════════════════════════════════════════════════════════
    // 图标加载
    // ═══════════════════════════════════════════════════════════════

    async _waitForIconsToLoad(container, timeout = 1000) {
        const icons = Array.from(container.querySelectorAll('iconify-icon'));
        if (icons.length === 0) return;

        await Promise.all(icons.map(async (icon) => {
            const iconName = icon.getAttribute('icon');
            if (!iconName) return;

            try {
                const computedStyle = window.getComputedStyle(icon);
                const size = computedStyle.fontSize || '24px';
                const color = computedStyle.color || 'currentColor';
                const [prefix, name] = iconName.includes(':') ? iconName.split(':') : ['carbon', iconName];
                const apiUrl = `https://api.iconify.design/${prefix}/${name}.svg?color=${encodeURIComponent(color)}`;

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), timeout);
                
                const response = await fetch(apiUrl, { signal: controller.signal });
                clearTimeout(timeoutId);
                
                if (response.ok) {
                    const svgText = await response.text();
                    const wrapper = document.createElement('span');
                    wrapper.innerHTML = svgText;
                    const svg = wrapper.querySelector('svg');
                    if (svg) {
                        svg.style.cssText = `width:${size};height:${size};display:inline-block;vertical-align:middle;flex-shrink:0`;
                        icon.replaceWith(svg);
                        return;
                    }
                }
            } catch (e) { /* ignore timeout/abort */ }

            const svg = icon.shadowRoot?.querySelector('svg');
            if (svg) {
                const clonedSvg = svg.cloneNode(true);
                const computedStyle = window.getComputedStyle(icon);
                clonedSvg.style.cssText = `width:${computedStyle.fontSize || '1em'};height:${computedStyle.fontSize || '1em'};color:${computedStyle.color};fill:currentColor;display:inline-block;vertical-align:middle`;
                icon.replaceWith(clonedSvg);
            }
        }));
    },

    // ═══════════════════════════════════════════════════════════════
    // HTML 导出
    // ═══════════════════════════════════════════════════════════════

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

    // ═══════════════════════════════════════════════════════════════
    // 图片导出 (ZIP)
    // ═══════════════════════════════════════════════════════════════

    async _exportImages() {
        this._showProgress?.('正在加载依赖...', 5);
        
        if (typeof html2canvas === 'undefined') {
            await this._loadScript('https://gcore.jsdelivr.net/npm/html2canvas-pro@1.5.13/dist/html2canvas-pro.min.js');
        }
        if (typeof JSZip === 'undefined') {
            await this._loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
        }

        const zip = new JSZip();
        const EXPORT_SCALE = 2;
        const CONCURRENCY = 3;
        const total = this.slides.length;
        
        this._showProgress?.('正在并发渲染图片...', 10);
        const imageResults = new Array(total);
        let completed = 0;
        
        const renderSlide = async (index) => {
            const slide = this.slides[index];
            const container = document.createElement('div');
            container.style.cssText = 'position: fixed; left: -9999px; width: 960px; height: 540px; z-index: -9999;';
            document.body.appendChild(container);
            
            try {
                const renderer = new HTMLSlideRenderer();
                const bgFill = this._getSlideBackground(slide);
                const bgStyle = bgFill ? `background: ${bgFill};` : 'background: #ffffff;';
                container.innerHTML = `<div style="width: 960px; height: 540px; overflow: hidden; ${bgStyle}">${renderer.render(slide, index)}</div>`;

                // 确保所有 span 保持 inline 显示（避免 html2canvas 错误处理）
                container.querySelectorAll('span').forEach(span => {
                    if (!span.style.display) {
                        span.style.display = 'inline';
                    }
                });

                // 处理半透明渐变形状：裁剪顶部边缘避免黑线
                container.querySelectorAll('div').forEach(div => {
                    const bg = div.style.background || '';
                    if (bg.includes('gradient') && bg.includes('to top') && 
                        (bg.includes('transparent') || bg.includes('rgba(') || bg.includes(', 0)'))) {
                        div.style.clipPath = 'inset(2% 0 0 0)';
                    }
                });

                const maskedElements = [...container.querySelectorAll('div > img')]
                    .map(img => img.parentElement)
                    .filter(div => {
                        const s = div.getAttribute('style') || '';
                        return s.includes('mask-image') || s.includes('clip-path');
                    });
                if (maskedElements.length > 0) {
                    await Promise.all(maskedElements.map(el => this._bakeMaskIntoElement(el)));
                }

                container.querySelectorAll('svg[style*="width: 0"], svg[style*="height: 0"]').forEach(svg => svg.remove());

                await Promise.all([
                    this._waitForIconsToLoad(container),
                    this._waitForImagesToLoad(container),
                    this._waitForKatexAndInlineStyles(container),
                ]);

                const hasBlend = slide.elements?.some(el => el.blend && el.blend !== 'normal');
                const hasBlurFilter = slide.elements?.some(el => el.filter && el.filter.includes('blur'));
                
                let canvas;
                if (hasBlend && slide.elements) {
                    canvas = await this._captureWithBlend(container, slide.elements, bgFill, EXPORT_SCALE);
                } else {
                    canvas = await this._captureToCanvas(container.firstChild, {
                        scale: EXPORT_SCALE,
                        useCORS: true,
                        allowTaint: false,
                        backgroundColor: null,
                        foreignObjectRendering: hasBlurFilter,
                    }, {
                        foreignObjectRendering: false,
                        allowTaint: true,
                    });
                }

                const imgData = canvas.toDataURL('image/png').split(',')[1];
                canvas.width = 0;
                canvas.height = 0;
                
                imageResults[index] = imgData;
                completed++;
                this._showProgress?.(`正在渲染 ${completed}/${total}...`, 10 + (completed / total) * 80);
            } finally {
                document.body.removeChild(container);
            }
        };
        
        // 并发控制
        const queue = [...Array(total).keys()];
        const workers = [];
        for (let i = 0; i < Math.min(CONCURRENCY, total); i++) {
            workers.push((async () => {
                while (queue.length > 0) {
                    const idx = queue.shift();
                    if (idx !== undefined) await renderSlide(idx);
                }
            })());
        }
        await Promise.all(workers);
        
        // 打包 ZIP
        this._showProgress?.('正在打包 ZIP...', 92);
        for (let i = 0; i < total; i++) {
            zip.file(`slide-${String(i + 1).padStart(2, '0')}.png`, imageResults[i], { base64: true });
        }

        const content = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(content);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${this.currentProject?.title || 'presentation'}-images.zip`;
        a.click();
        URL.revokeObjectURL(url);
    },
};

Object.assign(PPTGenerator.prototype, PPTGeneratorExportFormats);
