const PPTGeneratorExport = {
    // 进度显示相关
    _progressOverlay: null,
    
    _showProgress(text, percent = 0) {
        if (!this._progressOverlay) {
            this._progressOverlay = document.createElement('div');
            this._progressOverlay.className = 'export-progress-overlay';
            this._progressOverlay.innerHTML = `
                <div class="export-progress-modal">
                    <div class="export-progress-title">导出中...</div>
                    <div class="export-progress-text"></div>
                    <div class="export-progress-bar-bg">
                        <div class="export-progress-bar"></div>
                    </div>
                    <div class="export-progress-percent">0%</div>
                </div>
            `;
            this._progressOverlay.style.cssText = `
                position: fixed; inset: 0; background: rgba(0,0,0,0.5); 
                display: flex; align-items: center; justify-content: center; z-index: 10000;
            `;
            const modal = this._progressOverlay.querySelector('.export-progress-modal');
            modal.style.cssText = `
                background: white; border-radius: 12px; padding: 24px 32px; min-width: 320px;
                box-shadow: 0 20px 60px rgba(0,0,0,0.3); text-align: center;
            `;
            this._progressOverlay.querySelector('.export-progress-title').style.cssText = `
                font-size: 18px; font-weight: 600; margin-bottom: 12px; color: #1f2937;
            `;
            this._progressOverlay.querySelector('.export-progress-text').style.cssText = `
                font-size: 14px; color: #6b7280; margin-bottom: 16px;
            `;
            this._progressOverlay.querySelector('.export-progress-bar-bg').style.cssText = `
                height: 8px; background: #e5e7eb; border-radius: 4px; overflow: hidden;
            `;
            this._progressOverlay.querySelector('.export-progress-bar').style.cssText = `
                height: 100%; background: linear-gradient(90deg, #3b82f6, #8b5cf6); 
                border-radius: 4px; transition: width 0.3s ease; width: 0%;
            `;
            this._progressOverlay.querySelector('.export-progress-percent').style.cssText = `
                font-size: 14px; color: #3b82f6; margin-top: 8px; font-weight: 500;
            `;
            document.body.appendChild(this._progressOverlay);
        }
        
        this._progressOverlay.querySelector('.export-progress-text').textContent = text;
        this._progressOverlay.querySelector('.export-progress-bar').style.width = `${percent}%`;
        this._progressOverlay.querySelector('.export-progress-percent').textContent = `${Math.round(percent)}%`;
    },
    
    _hideProgress() {
        if (this._progressOverlay) {
            this._progressOverlay.remove();
            this._progressOverlay = null;
        }
    },

    // 导出选项状态
    exportOptions: {
        formula: 'unicode',  // unicode | omml | image
        chart: 'native',     // native | svg
    },

    toggleExportMenu() {
        const dropdown = document.querySelector('.ppt-export-dropdown');
        if (!dropdown) return;

        dropdown.classList.toggle('open');
        if (dropdown.classList.contains('open')) {
            // 初始化选项按钮事件
            this._initExportOptionButtons();
            
            const closeHandler = (e) => {
                if (!dropdown.contains(e.target)) {
                    dropdown.classList.remove('open');
                    document.removeEventListener('click', closeHandler);
                }
            };
            setTimeout(() => document.addEventListener('click', closeHandler), 0);
        }
    },

    _initExportOptionButtons() {
        const menu = document.getElementById('pptExportMenu');
        if (!menu || menu._optionsInitialized) return;
        
        const self = this;  // 保存 this 引用
        console.log('[_initExportOptionButtons] this:', this, 'exportOptions:', this.exportOptions);
        menu.querySelectorAll('.ppt-option-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const option = btn.dataset.option;
                const value = btn.dataset.value;
                
                // 更新状态 - 使用 PPTGeneratorExport 上的共享对象
                PPTGeneratorExport.exportOptions[option] = value;
                console.log('[ExportOptions] Updated:', option, '=', value, PPTGeneratorExport.exportOptions);
                
                // 更新 UI
                btn.parentElement.querySelectorAll('.ppt-option-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });
        
        menu._optionsInitialized = true;
    },

    /**
     * 使用当前选项导出 PPTX
     */
    async exportPPTX() {
        const dropdown = document.querySelector('.ppt-export-dropdown');
        if (dropdown) dropdown.classList.remove('open');

        const btn = document.querySelector('.ppt-export-btn');
        const originalContent = btn?.innerHTML;

        try {
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<iconify-icon icon="carbon:circle-dash" class="animate-spin"></iconify-icon> 导出中...';
            }

            const opts = PPTGeneratorExport.exportOptions;
            console.log('[exportPPTX] options:', opts);
            await this._exportPPTX(opts.formula, opts.chart);

            this._showProgress('导出完成！', 100);
            setTimeout(() => this._hideProgress(), 1500);
        } catch (e) {
            console.error('Export failed:', e);
            this._showProgress(`导出失败: ${e.message}`, 0);
            setTimeout(() => this._hideProgress(), 3000);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = originalContent;
            }
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
                case 'pptx-omml':
                case 'pptx-image': {
                    // 使用当前选项
                    const opts = PPTGeneratorExport.exportOptions;
                    console.log('[exportAs] Using options:', opts);
                    await this._exportPPTX(opts.formula, opts.chart);
                    break;
                }
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

            this._showProgress('导出完成！', 100);
            setTimeout(() => this._hideProgress(), 500);
            
            if (btn) {
                btn.innerHTML = '<iconify-icon icon="carbon:checkmark"></iconify-icon> 导出成功';
                setTimeout(() => {
                    btn.disabled = false;
                    btn.innerHTML = originalContent;
                }, 2000);
            }
        } catch (e) {
            console.error('Export error:', e);
            this._hideProgress();
            alert('导出失败: ' + e.message);
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = originalContent;
            }
        }
    },

    /**
     * 导出 PPTX
     * @param {string} formulaMode - 公式模式：'unicode' | 'omml' | 'image'
     * @param {string} chartMode - 图表模式：'native' | 'svg'
     */
    async _exportPPTX(formulaMode = 'unicode', chartMode = 'native') {
        console.log('[_exportPPTX] Called with formulaMode:', formulaMode, 'chartMode:', chartMode);
        this._showProgress('正在加载依赖...', 5);
        
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
        if (formulaMode === 'image') {
            console.log('[PPTX Export] Using image mode (best quality, not editable)');
            await this._exportPPTXAsImages(filename);
            return;
        }

        this._showProgress('正在处理特效...', 10);
        
        // 如果图表模式是 SVG，需要在 baking 时将图表转为 SVG
        const bakeOptions = { chartMode };
        const slidesForExport = await this._bakeEffectsForPPTX(this.slides, (p, msg) => {
            this._showProgress(msg || '正在烘焙特效...', 10 + p * 0.5); // 10-60%
        }, bakeOptions);
        
        this._showProgress('正在生成幻灯片...', 65);
        const renderer = new PPTXSlideRenderer({ chartMode });
        
        const hasFormulas = slidesForExport.some(slide => 
            slide.elements?.some(el => el.type === 'formula')
        );

        if (formulaMode === 'omml' && hasFormulas && typeof MathConverter !== 'undefined') {
            console.log('[PPTX Export] Using OMML formula mode (editable, may require repair)');
            this._showProgress('正在渲染公式...', 70);
            await renderer.renderWithOMML(slidesForExport, filename, new MathConverter());
        } else {
            console.log('[PPTX Export] Using Unicode formula mode');
            await renderer.render(slidesForExport, filename);
        }
        
        console.log(`[PPTX Export] chartMode: ${chartMode}`);
        this._showProgress('正在保存文件...', 95);
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
        // 快速检查是否有 katex 元素
        const katexElements = container.querySelectorAll('.katex');
        if (katexElements.length === 0) return; // 无公式，直接返回
        
        await new Promise(resolve => setTimeout(resolve, 50)); // 减少等待时间

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

        if (katexElements.length === 0) return;

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

    async _waitForIconsToLoad(container, timeout = 1000) {
        const icons = Array.from(container.querySelectorAll('iconify-icon'));
        if (icons.length === 0) return;

        // 并发处理所有 icons
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

            // 回退：从 shadowRoot 获取
            const svg = icon.shadowRoot?.querySelector('svg');
            if (svg) {
                const clonedSvg = svg.cloneNode(true);
                const computedStyle = window.getComputedStyle(icon);
                clonedSvg.style.cssText = `width:${computedStyle.fontSize || '1em'};height:${computedStyle.fontSize || '1em'};color:${computedStyle.color};fill:currentColor;display:inline-block;vertical-align:middle`;
                icon.replaceWith(clonedSvg);
            }
        }));
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
    async _waitForImagesToLoad(container, timeout = 1500) {
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
                setTimeout(resolve, 50);
            });
        } catch (e) {
            console.warn('[_bakeFilterIntoImage] Failed to apply filter into image:', e);
        }
    },

    /**
     * 将 CSS mask/clip-path 效果烘焙到元素中
     * html2canvas 不支持 mask-image，需要手动处理
     */
    async _bakeMaskIntoElement(el) {
        try {
            const img = el.tagName === 'IMG' ? el : el.querySelector('img');
            if (!img) return;
            
            const style = window.getComputedStyle(el);
            const maskImage = style.maskImage || style.webkitMaskImage;
            const clipPath = style.clipPath;
            
            // 如果没有 mask 或 clip-path，直接返回
            if ((!maskImage || maskImage === 'none') && (!clipPath || clipPath === 'none')) {
                return;
            }
            
            // 等待图片加载（短超时）
            if (!img.complete) {
                await new Promise(r => { img.onload = r; img.onerror = r; setTimeout(r, 500); });
            }
            
            // 检查图片是否可用于 canvas（跨域检测）
            if (img.src && !img.src.startsWith('data:') && !img.src.startsWith('blob:')) {
                // 尝试绘制测试（快速检测是否跨域）
                try {
                    const testCanvas = document.createElement('canvas');
                    testCanvas.width = testCanvas.height = 1;
                    testCanvas.getContext('2d').drawImage(img, 0, 0);
                    testCanvas.toDataURL(); // 如果跨域会抛出异常
                } catch (e) {
                    // 跨域图片，先转换为 base64
                    console.log('[_bakeMaskIntoElement] Converting cross-origin image to base64:', img.src);
                    try {
                        const response = await fetch(img.src);
                        const blob = await response.blob();
                        const base64 = await new Promise((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onload = () => resolve(reader.result);
                            reader.onerror = reject;
                            reader.readAsDataURL(blob);
                        });
                        img.src = base64;
                        await new Promise(r => { img.onload = r; setTimeout(r, 100); });
                    } catch (fetchErr) {
                        console.warn('[_bakeMaskIntoElement] Failed to convert cross-origin image:', fetchErr);
                        return;
                    }
                }
            }
            
            const width = img.naturalWidth || img.width || el.offsetWidth || 200;
            const height = img.naturalHeight || img.height || el.offsetHeight || 150;
            if (width <= 0 || height <= 0) return;
            
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            
            // 处理 clip-path（形状遮罩）
            if (clipPath && clipPath !== 'none') {
                const path = this._parseClipPathToPath2D(clipPath, width, height);
                if (path) {
                    ctx.clip(path);
                }
            }
            
            // 处理 mask-image（渐变遮罩）
            if (maskImage && maskImage !== 'none') {
                // 先绘制图片
                ctx.drawImage(img, 0, 0, width, height);
                
                // 创建遮罩 canvas
                const maskCanvas = document.createElement('canvas');
                maskCanvas.width = width;
                maskCanvas.height = height;
                const maskCtx = maskCanvas.getContext('2d');
                
                // 解析并绘制渐变遮罩
                const gradient = this._parseMaskGradient(maskCtx, maskImage, width, height);
                if (gradient) {
                    maskCtx.fillStyle = gradient;
                    maskCtx.fillRect(0, 0, width, height);
                    
                    // 使用 destination-in 合成模式应用遮罩
                    ctx.globalCompositeOperation = 'destination-in';
                    ctx.drawImage(maskCanvas, 0, 0);
                    ctx.globalCompositeOperation = 'source-over';
                }
            } else {
                // 只有 clip-path，直接绘制
                ctx.drawImage(img, 0, 0, width, height);
            }
            
            // 替换原图片
            img.src = canvas.toDataURL('image/png');
            // 移除 mask/clip-path 样式（已烘焙）
            el.style.maskImage = 'none';
            el.style.webkitMaskImage = 'none';
            el.style.clipPath = 'none';
            
            await new Promise(r => { img.onload = r; setTimeout(r, 50); });
        } catch (e) {
            console.warn('[_bakeMaskIntoElement] Failed:', e);
        }
    },
    
    /**
     * 解析 clip-path 为 Path2D
     */
    _parseClipPathToPath2D(clipPath, width, height) {
        const path = new Path2D();
        
        // circle(50%) 或 circle(50% at center)
        const circleMatch = clipPath.match(/circle\(([^)]+)\)/);
        if (circleMatch) {
            const params = circleMatch[1].split(/\s+at\s+/);
            const radius = parseFloat(params[0]) / 100 * Math.min(width, height);
            let cx = width / 2, cy = height / 2;
            if (params[1]) {
                const pos = params[1].split(/\s+/);
                cx = pos[0] === 'center' ? width / 2 : parseFloat(pos[0]) / 100 * width;
                cy = pos[1] === 'center' ? height / 2 : parseFloat(pos[1] || pos[0]) / 100 * height;
            }
            path.arc(cx, cy, radius, 0, Math.PI * 2);
            return path;
        }
        
        // ellipse(50% 40%)
        const ellipseMatch = clipPath.match(/ellipse\(([^)]+)\)/);
        if (ellipseMatch) {
            const params = ellipseMatch[1].split(/\s+at\s+/);
            const radii = params[0].split(/\s+/);
            const rx = parseFloat(radii[0]) / 100 * width;
            const ry = parseFloat(radii[1] || radii[0]) / 100 * height;
            let cx = width / 2, cy = height / 2;
            path.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
            return path;
        }
        
        // polygon(x1% y1%, x2% y2%, ...)
        const polygonMatch = clipPath.match(/polygon\(([^)]+)\)/);
        if (polygonMatch) {
            const points = polygonMatch[1].split(',').map(p => {
                const [x, y] = p.trim().split(/\s+/);
                return [parseFloat(x) / 100 * width, parseFloat(y) / 100 * height];
            });
            if (points.length > 0) {
                path.moveTo(points[0][0], points[0][1]);
                for (let i = 1; i < points.length; i++) {
                    path.lineTo(points[i][0], points[i][1]);
                }
                path.closePath();
            }
            return path;
        }
        
        // inset(10%)
        const insetMatch = clipPath.match(/inset\(([^)]+)\)/);
        if (insetMatch) {
            const inset = parseFloat(insetMatch[1]) / 100;
            const x = inset * width;
            const y = inset * height;
            path.rect(x, y, width - 2 * x, height - 2 * y);
            return path;
        }
        
        return null;
    },
    
    /**
     * 解析 mask-image 渐变为 CanvasGradient
     * 支持 transparent, black, white, rgb(), rgba() 等颜色格式
     */
    _parseMaskGradient(ctx, maskImage, width, height) {
        // 颜色正则：匹配 transparent, black, white, rgb(...), rgba(...)
        const colorPattern = /(transparent|black|white|rgba?\s*\([^)]+\))/gi;
        
        // linear-gradient(to right, transparent 0%, black 60%)
        const linearMatch = maskImage.match(/linear-gradient\((.+)\)/s);
        if (linearMatch) {
            const params = linearMatch[1];
            let x0 = 0, y0 = 0, x1 = width, y1 = 0;
            
            if (params.includes('to right')) { x0 = 0; y0 = 0; x1 = width; y1 = 0; }
            else if (params.includes('to left')) { x0 = width; y0 = 0; x1 = 0; y1 = 0; }
            else if (params.includes('to bottom')) { x0 = 0; y0 = 0; x1 = 0; y1 = height; }
            else if (params.includes('to top')) { x0 = 0; y0 = height; x1 = 0; y1 = 0; }
            
            const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
            
            // 解析颜色停止点：找到所有 "颜色 位置%" 对
            const stopPattern = /(transparent|black|white|rgba?\s*\([^)]+\))\s*(\d+%)?/gi;
            const stops = [];
            let match;
            while ((match = stopPattern.exec(params)) !== null) {
                const color = this._normalizeColor(match[1]);
                const pos = match[2] ? parseFloat(match[2]) / 100 : null;
                stops.push({ color, pos });
            }
            
            // 填充缺失的位置
            stops.forEach((s, i) => {
                if (s.pos === null) s.pos = i / Math.max(stops.length - 1, 1);
            });
            
            stops.forEach(s => gradient.addColorStop(s.pos, s.color));
            return gradient;
        }
        
        // radial-gradient(...)
        const radialMatch = maskImage.match(/radial-gradient\((.+)\)/s);
        if (radialMatch) {
            const params = radialMatch[1];
            const gradient = ctx.createRadialGradient(width/2, height/2, 0, width/2, height/2, Math.max(width, height) * 0.7);
            
            const stopPattern = /(transparent|black|white|rgba?\s*\([^)]+\))\s*(\d+%)?/gi;
            const stops = [];
            let match;
            while ((match = stopPattern.exec(params)) !== null) {
                const color = this._normalizeColor(match[1]);
                const pos = match[2] ? parseFloat(match[2]) / 100 : null;
                stops.push({ color, pos });
            }
            
            stops.forEach((s, i) => {
                if (s.pos === null) s.pos = i / Math.max(stops.length - 1, 1);
            });
            
            stops.forEach(s => gradient.addColorStop(s.pos, s.color));
            return gradient;
        }
        
        return null;
    },
    
    /**
     * 标准化颜色值
     */
    _normalizeColor(color) {
        if (!color) return 'black';
        const c = color.trim().toLowerCase();
        if (c === 'transparent') return 'rgba(0,0,0,0)';
        if (c === 'black') return 'rgba(0,0,0,1)';
        if (c === 'white') return 'rgba(255,255,255,1)';
        // rgba(0, 0, 0, 0) -> 保持原样
        return color.replace(/\s+/g, '');
    },

    async _captureToCanvas(target, options, fallbackOptions) {
        const attempts = [];
        
        // 尝试顺序根据是否需要 blend 效果调整:
        if (options?.foreignObjectRendering) {
            // blend 效果需要 foreignObject，优先尝试
            attempts.push({
                ...options,
                foreignObjectRendering: true,
                allowTaint: true,
            });
        }
        
        // 回退: 禁用 foreignObject - 最稳定，添加性能优化参数
        attempts.push({
            ...options,
            foreignObjectRendering: false,
            allowTaint: true,
            useCORS: true,
            logging: false,
            imageTimeout: 3000,
            removeContainer: true,
        });
        
        // 3) 显式降级配置
        if (fallbackOptions) {
            attempts.push({ ...options, ...fallbackOptions, foreignObjectRendering: false });
        }

        for (let i = 0; i < attempts.length; i++) {
            try {
                const canvas = await html2canvas(target, attempts[i]);
                if (canvas && canvas.width > 0 && canvas.height > 0) return canvas;
            } catch (err) { /* try next */ }
        }

        // 全部失败时返回空白画布
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
     * 手动实现 blend 效果捕获
     * 分层渲染 + Canvas globalCompositeOperation 合成
     */
    // Canvas blend 模式映射（静态）
    _canvasBlendMap: {
        'screen': 'screen', 'multiply': 'multiply', 'overlay': 'overlay',
        'darken': 'darken', 'lighten': 'lighten', 'color-dodge': 'color-dodge',
        'color-burn': 'color-burn', 'hard-light': 'hard-light', 'soft-light': 'soft-light',
        'difference': 'difference', 'exclusion': 'exclusion', 'hue': 'hue',
        'saturation': 'saturation', 'color': 'color', 'luminosity': 'luminosity',
    },

    async _captureWithBlend(container, elements, backgroundFill, scale = 1.5) {
        const width = 960;
        const height = 540;
        
        const backdropEls = elements.filter(el => !el.blend || el.blend === 'normal');
        const blendEls = elements.filter(el => el.blend && el.blend !== 'normal');
        
        const renderer = new HTMLSlideRenderer();
        
        // 创建最终合成 canvas
        const finalCanvas = document.createElement('canvas');
        finalCanvas.width = width * scale;
        finalCanvas.height = height * scale;
        const ctx = finalCanvas.getContext('2d');
        ctx.scale(scale, scale);
        
        // 1. 填充背景（支持渐变和纯色）
        if (backgroundFill && backgroundFill !== 'transparent') {
            if (backgroundFill.includes('gradient')) {
                container.innerHTML = `<div style="width: ${width}px; height: ${height}px; background: ${backgroundFill};"></div>`;
                const bgCanvas = await this._captureToCanvas(container.firstChild, { scale, backgroundColor: null, foreignObjectRendering: false });
                if (bgCanvas) {
                    ctx.drawImage(bgCanvas, 0, 0, width, height);
                    bgCanvas.width = 0; bgCanvas.height = 0;
                }
            } else {
                ctx.fillStyle = backgroundFill;
                ctx.fillRect(0, 0, width, height);
            }
        }
        
        // 2. 渲染 backdrop 元素
        // 分离带 blur 的元素，使用 canvas filter 手动应用模糊
        // 重要：blur 元素通常是背景光效，需要先渲染（底层），普通元素后渲染（上层）
        const blurEls = backdropEls.filter(el => el.filter && el.filter.includes('blur'));
        const normalEls = backdropEls.filter(el => !el.filter || !el.filter.includes('blur'));
        
        // 2a. 先渲染带 blur 的元素（底层背景光效）
        for (const el of blurEls) {
            // 提取 blur 值
            const blurMatch = el.filter.match(/blur\((\d+)px\)/);
            const blurPx = blurMatch ? parseInt(blurMatch[1]) : 0;
            
            // 渲染元素（不带 blur filter）
            const elWithoutBlur = { ...el, filter: el.filter.replace(/blur\([^)]+\)/g, '').trim() || undefined };
            container.innerHTML = `<div style="width: ${width}px; height: ${height}px; overflow: visible; background: transparent;">${renderer.render({ type: 'freeform', background: 'transparent', elements: [elWithoutBlur] }, 0)}</div>`;
            
            const elCanvas = await this._captureToCanvas(container.firstChild, { scale, backgroundColor: null, foreignObjectRendering: false, allowTaint: true });
            if (elCanvas) {
                // 应用 canvas blur filter
                ctx.save();
                ctx.filter = `blur(${blurPx}px)`;
                ctx.drawImage(elCanvas, 0, 0, width, height);
                ctx.restore();
                elCanvas.width = 0; elCanvas.height = 0;
            }
        }
        
        // 2b. 后渲染普通 backdrop 元素（上层，如卡片、图片）
        if (normalEls.length > 0) {
            container.innerHTML = `<div style="width: ${width}px; height: ${height}px; overflow: visible; background: transparent;">${renderer.render({ type: 'freeform', background: 'transparent', elements: normalEls }, 0)}</div>`;
            await Promise.all([this._waitForIconsToLoad(container), this._waitForImagesToLoad(container)]);
            
            const normalCanvas = await this._captureToCanvas(container.firstChild, { scale, backgroundColor: null, foreignObjectRendering: false, allowTaint: true });
            if (normalCanvas) {
                ctx.drawImage(normalCanvas, 0, 0, width, height);
                normalCanvas.width = 0; normalCanvas.height = 0;
            }
        }
        
        // 3. 并发预渲染所有 blend 元素
        const blendCanvases = await Promise.all(blendEls.map(async (el) => {
            const tempContainer = document.createElement('div');
            tempContainer.style.cssText = 'position: fixed; left: -9999px; top: 0; width: 960px; height: 540px;';
            document.body.appendChild(tempContainer);
            
            try {
                tempContainer.innerHTML = `<div style="width: ${width}px; height: ${height}px; overflow: visible; background: transparent;">${renderer.render({ type: 'freeform', background: 'transparent', elements: [{ ...el, blend: 'normal' }] }, 0)}</div>`;
                await Promise.all([this._waitForIconsToLoad(tempContainer), this._waitForImagesToLoad(tempContainer)]);
                
                const canvas = await this._captureToCanvas(tempContainer.firstChild, { scale, backgroundColor: null, foreignObjectRendering: false, allowTaint: true });
                return { canvas, blend: el.blend };
            } finally {
                document.body.removeChild(tempContainer);
            }
        }));
        
        // 4. 按顺序合成 blend 效果
        for (const { canvas, blend } of blendCanvases) {
            if (canvas) {
                ctx.globalCompositeOperation = this._canvasBlendMap[blend] || 'source-over';
                ctx.drawImage(canvas, 0, 0, width, height);
                ctx.globalCompositeOperation = 'source-over';
                canvas.width = 0; canvas.height = 0;
            }
        }
        
        return finalCanvas;
    },

    /**
     * 智能分层烘焙：将连续的特效元素合并为"智能对象"，保持层叠关系。
     * 使用并发处理提升性能
     * @param {Array} slides - 幻灯片数组
     * @param {Function} onProgress - 进度回调
     * @param {Object} options - 选项 { chartMode: 'native' | 'svg' }
     */
    async _bakeEffectsForPPTX(slides, onProgress, options = {}) {
        // 如果图表模式是 SVG，先转换所有 chart 元素
        console.log('[bakeEffects] chartMode:', options.chartMode);
        if (options.chartMode === 'svg') {
            console.log('[bakeEffects] Converting charts to SVG...');
            slides = this._convertChartsToSvg(slides);
        }
        
        const needsBaking = slides.some(slide => this._slideHasEffects(slide));
        if (!needsBaking) {
            onProgress?.(100, '无需处理特效');
            return slides;
        }
        
        let completed = 0;
        const total = slides.length;

        // 需要 html2canvas 才能烘焙
        if (typeof html2canvas === 'undefined') {
            await this._loadScript('https://gcore.jsdelivr.net/npm/html2canvas-pro@1.5.13/dist/html2canvas-pro.min.js');
        }

        const renderer = new HTMLSlideRenderer();
        const startTime = performance.now();
        
        // 并发限制（根据 CPU 核心数调整）
        const CONCURRENCY = Math.min(navigator.hardwareConcurrency || 4, 8);
        
        // 创建容器池
        const containerPool = [];
        for (let i = 0; i < CONCURRENCY; i++) {
            const container = document.createElement('div');
            container.style.cssText = `position: fixed; left: -9999px; top: ${i * 550}px; width: 960px; height: 540px; z-index: -9999;`;
            document.body.appendChild(container);
            containerPool.push({ container, inUse: false });
        }
        
        // 获取空闲容器
        const getContainer = () => {
            const available = containerPool.find(c => !c.inUse);
            if (available) {
                available.inUse = true;
                return available;
            }
            return null;
        };
        
        // 释放容器
        const releaseContainer = (poolItem) => {
            poolItem.inUse = false;
        };

        // 处理单个 slide
        const processSlide = async (slide, index) => {
            // 非 freeform 或无特效元素，也需要预加载图片转 base64
            if (!this._slideHasEffects(slide)) {
                // 预加载图片并转为 base64
                const processedSlide = await this._preloadSlideImages(slide);
                return { index, slide: processedSlide };
            }

            // 等待获取容器
            let poolItem;
            while (!(poolItem = getContainer())) {
                await new Promise(r => setTimeout(r, 10));
            }
            const container = poolItem.container;

            try {
                const sortedElements = [...(slide.elements || [])]
                    .map((el, i) => ({ ...el, _originalIndex: i }))
                    .sort((a, b) => (a.z || 0) - (b.z || 0) || a._originalIndex - b._originalIndex);

                const blendElements = sortedElements.filter(el => el.blend && el.blend !== 'normal');
                const filterElements = sortedElements.filter(el => el.filter);
                
                let processedElements;
                
                if (blendElements.length > 0) {
                    processedElements = await this._bakeBlendSlide(slide, sortedElements, blendElements, renderer, container);
                } else {
                    processedElements = await this._bakeFilterSlide(slide, sortedElements, renderer, container, index);
                }
                
                return {
                    index,
                    slide: { ...slide, elements: processedElements }
                };
            } finally {
                releaseContainer(poolItem);
            }
        };

        // 并发处理所有 slides，带进度更新
        const results = await Promise.all(
            slides.map(async (slide, index) => {
                const result = await processSlide(slide, index);
                completed++;
                onProgress?.((completed / total) * 100, `处理幻灯片 ${completed}/${total}`);
                return result;
            })
        );
        
        // 按原始顺序排列
        results.sort((a, b) => a.index - b.index);
        const bakedSlides = results.map(r => r.slide);

        // 清理容器
        containerPool.forEach(p => document.body.removeChild(p.container));
        
        const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
        console.log(`[Baking] Completed in ${elapsed}s (${CONCURRENCY} concurrent)`);
        
        return bakedSlides;
    },
    
    /**
     * 烘焙含 blend 效果的 slide
     */
    async _bakeBlendSlide(slide, sortedElements, blendElements, renderer, container) {
        const visualTypes = ['shape', 'image', 'svg', 'line'];
        const maxBlendZ = Math.max(...blendElements.map(el => el.z || 0));
        
        const elementsTosBake = sortedElements.filter(el => 
            (el.z || 0) <= maxBlendZ && visualTypes.includes(el.type)
        );
        const nativeElements = sortedElements.filter(el => 
            (el.z || 0) > maxBlendZ || !visualTypes.includes(el.type)
        );
        
        const effectEls = elementsTosBake.filter(el => this._elementNeedsBaking(el));
        const backdropEls = elementsTosBake.filter(el => !this._elementNeedsBaking(el));
        
        const bakedEl = await this._bakeElementGroupToImage(
            effectEls,
            renderer, 
            container, 
            backdropEls,
            slide.gradient || slide.background
        );
        
        const processedElements = [];
        if (bakedEl) {
            processedElements.push(bakedEl);
        } else {
            processedElements.push(...elementsTosBake);
        }
        processedElements.push(...nativeElements);
        
        return processedElements;
    },
    
    /**
     * 烘焙含 filter/mask 效果的 slide（无 blend）
     * 使用分组逻辑：连续的特效元素合并烘焙，保持文字层级
     */
    async _bakeFilterSlide(slide, sortedElements, renderer, container, slideIndex) {
        const visualTypes = ['shape', 'image', 'svg', 'line'];
        const groups = [];
        let currentGroup = null;
        
        // 按层级分组：连续的需要烘焙的视觉元素合并
        for (const el of sortedElements) {
            const needsBaking = this._elementNeedsBaking(el) && visualTypes.includes(el.type);
            
            if (needsBaking) {
                if (!currentGroup || currentGroup.type !== 'effect') {
                    currentGroup = { type: 'effect', elements: [] };
                    groups.push(currentGroup);
                }
                currentGroup.elements.push(el);
            } else {
                if (!currentGroup || currentGroup.type !== 'normal') {
                    currentGroup = { type: 'normal', elements: [] };
                    groups.push(currentGroup);
                }
                currentGroup.elements.push(el);
            }
        }
        
        // 处理每个分组
        const processedElements = [];
        for (const group of groups) {
            if (group.type === 'normal') {
                processedElements.push(...group.elements);
            } else {
                const minZ = Math.min(...group.elements.map(el => el.z || 0));
                const minOriginalIndex = Math.min(...group.elements.map(el => el._originalIndex ?? Infinity));
                const bakedEl = await this._bakeElementGroupToImage(
                    group.elements, 
                    renderer, 
                    container, 
                    [],
                    'transparent'
                );
                if (bakedEl) {
                    bakedEl.z = minZ;
                    bakedEl._originalIndex = minOriginalIndex;
                    processedElements.push(bakedEl);
                } else {
                    processedElements.push(...group.elements);
                }
            }
        }
        
        return processedElements;
    },
    
    /**
     * 旧版分组烘焙逻辑（已弃用，保留备用）
     */
    async _bakeFilterSlideGrouped(slide, sortedElements, renderer, container, slideIndex) {
        const groups = this._groupElementsForBaking(sortedElements);
        const processedElements = [];
        
        for (const group of groups) {
            if (group.type === 'normal') {
                processedElements.push(...group.elements);
            } else if (group.type === 'effect') {
                const minZ = Math.min(...group.elements.map(el => el.z || 0));
                const bakedEl = await this._bakeElementGroupToImage(
                    group.elements, 
                    renderer, 
                    container, 
                    [],
                    'transparent'
                );
                if (bakedEl) {
                    bakedEl.z = minZ;
                    processedElements.push(bakedEl);
                } else {
                    processedElements.push(...group.elements);
                }
            }
        }
        
        return processedElements;
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
            
            // 检查是否有 mask 元素需要预烘焙（html2canvas 不支持 CSS mask-image）
            // 只检查包含图片的 div（优化：不遍历所有元素）
            const imgDivs = container.querySelectorAll('div > img');
            const maskedElements = [...imgDivs]
                .map(img => img.parentElement)
                .filter(div => {
                    const s = div.getAttribute('style') || '';
                    return s.includes('mask-image') || s.includes('clip-path');
                });
            if (maskedElements.length > 0) {
                console.log(`[_bakeElementGroupToImage] Found ${maskedElements.length} masked elements`);
                await Promise.all(maskedElements.map(el => this._bakeMaskIntoElement(el)));
            }
            
            // 移除隐藏的 SVG defs（它们会导致 foreignObjectRendering 失败）
            container.querySelectorAll('svg[style*="width: 0"], svg[style*="height: 0"]').forEach(svg => svg.remove());

            // 并发等待所有资源加载
            await Promise.all([this._waitForIconsToLoad(container), this._waitForImagesToLoad(container)]);
            
            // 将 SVG data URL 图片转为 PNG（避免 foreignObjectRendering 失败）
            if (hasBlend) {
                const svgImgs = container.querySelectorAll('img[src^="data:image/svg"]');
                await Promise.all([...svgImgs].map(async img => {
                    try {
                        const canvas = document.createElement('canvas');
                        canvas.width = img.naturalWidth || img.width || 100;
                        canvas.height = img.naturalHeight || img.height || 100;
                        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                        img.src = canvas.toDataURL('image/png');
                        await new Promise(r => { img.onload = r; setTimeout(r, 50); });
                    } catch (e) { /* ignore */ }
                }));
            }
            await this._waitForKatexAndInlineStyles(container);

            // 使用 html2canvas 截图
            const scale = 1.2; // 降低 scale 提升性能
            
            let canvas;
            if (hasBlend) {
                // 手动实现 blend 效果，因为 html2canvas 对 mix-blend-mode 支持不佳
                canvas = await this._captureWithBlend(container, combinedElements, backgroundFill, scale);
            } else {
                // 检查是否有 blur 效果，需要 foreignObjectRendering: true
                const hasBlurFilter = elements.some(el => el.filter && el.filter.includes('blur'));
                canvas = await this._captureToCanvas(container.firstChild, {
                    scale,
                    useCORS: true,
                    allowTaint: false,
                    backgroundColor: backgroundFill || null,
                    logging: false,
                    foreignObjectRendering: hasBlurFilter,
                }, {
                    foreignObjectRendering: hasBlurFilter,
                    allowTaint: true,
                });
            }

            let dataUrl = null;
            if (canvas) {
                dataUrl = canvas.toDataURL('image/png');
                // 释放 canvas 内存
                canvas.width = 0;
                canvas.height = 0;
            }
            if (!dataUrl) return null;


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
        // 但含有 <text> 的 SVG 保持可编辑，不烘焙（文字提取在 PPTX 渲染器中处理）
        if (el.type === 'svg' && el.content) {
            const content = el.content.toLowerCase();
            
            // 如果 SVG 包含 text 元素，不烘焙，保持文字可编辑
            if (content.includes('<text')) {
                return false;
            }
            
            const hasComplexFeatures = content.includes('<pattern') || 
                content.includes('<clippath') || content.includes('<mask') ||
                content.includes('marker-end') || content.includes('marker-start');
            // 只有真正复杂的特性才烘焙（渐变可以在 PPTX 中保留）
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

    /**
     * 预加载页面中的所有图片，将 URL 转为 base64
     * 用于没有特效的页面，确保图片能正确嵌入 PPTX
     * 对于 cover 模式，直接用 canvas 裁剪实现正确效果
     */
    async _preloadSlideImages(slide) {
        if (!slide.elements) return slide;
        
        // 幻灯片尺寸（用于计算容器比例）
        const SLIDE_W = 10;    // inches
        const SLIDE_H = 5.625; // inches
        
        const processedElements = await Promise.all(slide.elements.map(async (el) => {
            if (el.type === 'image' && el.src && !el.src.startsWith('data:')) {
                try {
                    const response = await fetch(el.src);
                    const blob = await response.blob();
                    const base64 = await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(reader.result);
                        reader.onerror = reject;
                        reader.readAsDataURL(blob);
                    });
                    
                    // 加载图片获取原始尺寸
                    const img = new Image();
                    await new Promise((resolve, reject) => {
                        img.onload = resolve;
                        img.onerror = reject;
                        img.src = base64;
                    });
                    
                    const fitMode = el.fit || 'cover';
                    
                    // 对于 cover/contain 模式，手动计算实现正确效果
                    if ((fitMode === 'cover' || fitMode === 'contain') && el.w && el.h) {
                        const containerW = parseFloat(el.w) / 100 * SLIDE_W;
                        const containerH = parseFloat(el.h) / 100 * SLIDE_H;
                        const containerRatio = containerW / containerH;
                        const imgRatio = img.naturalWidth / img.naturalHeight;
                        
                        // 如果比例不同，需要处理
                        if (Math.abs(imgRatio - containerRatio) > 0.01) {
                            if (fitMode === 'cover') {
                                // Cover: 用 canvas 裁剪图片
                                const canvas = document.createElement('canvas');
                                const ctx = canvas.getContext('2d');
                                
                                let sx, sy, sw, sh;
                                if (imgRatio > containerRatio) {
                                    // 图片更宽，裁剪左右
                                    sh = img.naturalHeight;
                                    sw = sh * containerRatio;
                                    sx = (img.naturalWidth - sw) / 2;
                                    sy = 0;
                                } else {
                                    // 图片更高，裁剪上下
                                    sw = img.naturalWidth;
                                    sh = sw / containerRatio;
                                    sx = 0;
                                    sy = (img.naturalHeight - sh) / 2;
                                }
                                
                                canvas.width = sw;
                                canvas.height = sh;
                                ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
                                
                                const croppedBase64 = canvas.toDataURL('image/png');
                                canvas.width = 0;
                                canvas.height = 0;
                                
                                return { ...el, src: croppedBase64, fit: 'fill' };
                            } else {
                                // Contain: 调整元素位置和尺寸来居中显示
                                const elX = parseFloat(el.x) / 100 * SLIDE_W;
                                const elY = parseFloat(el.y) / 100 * SLIDE_H;
                                let newW, newH, newX, newY;
                                
                                if (imgRatio > containerRatio) {
                                    // 图片更宽，以宽度为准，高度留白
                                    newW = containerW;
                                    newH = containerW / imgRatio;
                                    newX = elX;
                                    newY = elY + (containerH - newH) / 2;
                                } else {
                                    // 图片更高，以高度为准，宽度留白
                                    newH = containerH;
                                    newW = containerH * imgRatio;
                                    newX = elX + (containerW - newW) / 2;
                                    newY = elY;
                                }
                                
                                // 转换回百分比
                                return { 
                                    ...el, 
                                    src: base64,
                                    x: (newX / SLIDE_W * 100) + '%',
                                    y: (newY / SLIDE_H * 100) + '%',
                                    w: (newW / SLIDE_W * 100) + '%',
                                    h: (newH / SLIDE_H * 100) + '%',
                                    fit: 'fill'  // 已调整尺寸，使用 fill
                                };
                            }
                        }
                    }
                    
                    return { ...el, src: base64 };
                } catch (e) {
                    console.warn('[_preloadSlideImages] Failed to convert image:', el.src, e);
                    return el;
                }
            }
            return el;
        }));
        
        return { ...slide, elements: processedElements };
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

    /**
     * 将所有 chart 元素转换为 svg 元素
     * 使用 HTMLSlideRenderer 生成 SVG 内容
     */
    _convertChartsToSvg(slides) {
        if (!window.HTMLSlideRenderer) {
            console.warn('[convertChartsToSvg] HTMLSlideRenderer not available');
            return slides;
        }
        
        const renderer = new HTMLSlideRenderer();
        
        return slides.map(slide => {
            if (!slide.elements) return slide;
            
            const convertedElements = slide.elements.map(el => {
                if (el.type !== 'chart') return el;
                
                // 使用 HTMLSlideRenderer 生成图表 SVG
                const chartHtml = renderer.renderFreeformChart(el, '');
                
                // 提取 SVG 内容
                const svgMatch = chartHtml.match(/<svg[^>]*>[\s\S]*?<\/svg>/i);
                if (!svgMatch) {
                    console.warn('[convertChartsToSvg] No SVG found in chart HTML');
                    return el;
                }
                
                // 转换为 svg 元素
                return {
                    ...el,
                    type: 'svg',
                    content: svgMatch[0],
                    // 保留原始 chart 数据以便调试
                    _originalType: 'chart',
                    _chartData: el.chartData,
                };
            });
            
            return { ...slide, elements: convertedElements };
        });
    },
};

Object.assign(PPTGenerator.prototype, PPTGeneratorExport);
