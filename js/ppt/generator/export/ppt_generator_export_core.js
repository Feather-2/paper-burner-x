// ESM 导入核心类以确保 mixin 安装时类已存在
import PPTGeneratorCtor from '../ppt_generator_core.js';

/**
 * PPTGenerator 导出模块 - 核心入口
 * 包含: UI、进度、选项、PPTX 核心导出、图表转换
 * 
 * 依赖顺序:
 * 1. ppt_generator_export_image.js   (基础图片处理)
 * 2. ppt_generator_export_baking.js  (特效烘焙)
 * 3. ppt_generator_export_formats.js (PDF/HTML/Images)
 * 4. ppt_generator_export_core.js    (本文件 - 入口)
 */

const PPTGeneratorExport = {
    // ═══════════════════════════════════════════════════════════════
    // UI & 进度显示
    // ═══════════════════════════════════════════════════════════════
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

    // ═══════════════════════════════════════════════════════════════
    // 导出选项 & 入口
    // ═══════════════════════════════════════════════════════════════
    exportOptions: {
        formula: 'unicode',  // unicode | omml | image
        chart: 'native',     // native | svg
    },

    toggleExportMenu() {
        const dropdown = document.querySelector('.ppt-export-dropdown');
        if (!dropdown) return;

        dropdown.classList.toggle('open');
        if (dropdown.classList.contains('open')) {
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
        
        menu.querySelectorAll('.ppt-option-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const option = btn.dataset.option;
                const value = btn.dataset.value;
                
                PPTGeneratorExport.exportOptions[option] = value;
                console.log('[ExportOptions] Updated:', option, '=', value);
                
                btn.parentElement.querySelectorAll('.ppt-option-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });
        
        menu._optionsInitialized = true;
    },

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
                    const opts = PPTGeneratorExport.exportOptions;
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

    // ═══════════════════════════════════════════════════════════════
    // PPTX 核心导出
    // ═══════════════════════════════════════════════════════════════
    
    async _exportPPTX(formulaMode = 'unicode', chartMode = 'native') {
        console.log('[_exportPPTX] formulaMode:', formulaMode, 'chartMode:', chartMode);
        this._showProgress('正在加载依赖...', 5);
        
        if (typeof PptxGenJS === 'undefined') {
            await this._loadScript('https://cdn.jsdelivr.net/gh/gitbrent/PptxGenJS@3.12.0/dist/pptxgen.bundle.js');
        }

        if (typeof PPTXSlideRenderer === 'undefined') {
            throw new Error('PPTX 渲染器未加载');
        }

        if (typeof JSZip === 'undefined') {
            await this._loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
        }

        const filename = `${this.currentProject?.title || 'presentation'}.pptx`;

        if (formulaMode === 'image') {
            console.log('[PPTX Export] Using image mode');
            await this._exportPPTXAsImages(filename);
            return;
        }

        this._showProgress('正在处理特效...', 10);
        
        const bakeOptions = { chartMode };
        const slidesForExport = await this._bakeEffectsForPPTX(this.slides, (p, msg) => {
            this._showProgress(msg || '正在烘焙特效...', 10 + p * 0.5);
        }, bakeOptions);
        
        this._showProgress('正在生成幻灯片...', 65);
        const renderer = new PPTXSlideRenderer({ chartMode });
        
        const hasFormulas = slidesForExport.some(slide => 
            slide.elements?.some(el => el.type === 'formula')
        );

        if (formulaMode === 'omml' && hasFormulas && typeof MathConverter !== 'undefined') {
            console.log('[PPTX Export] Using OMML formula mode');
            this._showProgress('正在渲染公式...', 70);
            await renderer.renderWithOMML(slidesForExport, filename, new MathConverter());
        } else {
            console.log('[PPTX Export] Using Unicode formula mode');
            await renderer.render(slidesForExport, filename);
        }
        
        this._showProgress('正在保存文件...', 95);
    },

    async _exportPPTXAsImages(filename) {
        if (typeof html2canvas === 'undefined') {
            await this._loadScript('https://gcore.jsdelivr.net/npm/html2canvas-pro@1.5.13/dist/html2canvas-pro.min.js');
        }

        const pres = new PptxGenJS();
        pres.layout = 'LAYOUT_16x9';
        pres.title = filename.replace('.pptx', '');

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

        // 使用 blob 方式下载，确保文件名正确
        const blob = await pres.write({ outputType: 'blob' });
        this._downloadBlob(blob, filename);
        console.log('[PPTX Image] Export complete');
    },
    
    _downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    },

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
                slideContainer.innerHTML = `<div style="width: 960px; height: 540px; overflow: hidden;">${renderer.render(slidesForExport[i], i)}</div>`;

                await this._waitForIconsToLoad(slideContainer);
                await this._waitForImagesToLoad(slideContainer);
                await this._waitForKatexAndInlineStyles(slideContainer);

                const innerContent = slideContainer.firstChild;
                if (innerContent) {
                    innerContent.style.lineHeight = 'initial';
                    innerContent.querySelectorAll('*').forEach(el => {
                        el.style.lineHeight = 'initial';
                        if (el.tagName === 'IMG') el.style.display = 'inline-block';
                    });
                }

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

    // ═══════════════════════════════════════════════════════════════
    // 图表转换
    // ═══════════════════════════════════════════════════════════════
    
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
                
                const chartHtml = renderer.renderFreeformChart(el, '');
                const svgMatch = chartHtml.match(/<svg[^>]*>[\s\S]*?<\/svg>/i);
                if (!svgMatch) {
                    console.warn('[convertChartsToSvg] No SVG found in chart HTML');
                    return el;
                }
                
                return {
                    ...el,
                    type: 'svg',
                    content: svgMatch[0],
                    _originalType: 'chart',
                    _chartData: el.chartData,
                };
            });
            
            return { ...slide, elements: convertedElements };
        });
    },
};

// Mixin install (legacy scripts + ESM entrypoints).
(() => {
    try {
        const g = (typeof globalThis !== 'undefined') ? globalThis : null;
        const w = (typeof window !== 'undefined') ? window : null;
        const ctor =
            (g && g.PPTGenerator?.prototype) ? g.PPTGenerator :
            (w && w.PPTGenerator?.prototype) ? w.PPTGenerator :
            (g && g.PPTGeneratorCtor?.prototype) ? g.PPTGeneratorCtor :
            (w && w.PPTGeneratorCtor?.prototype) ? w.PPTGeneratorCtor :
            (PPTGeneratorCtor?.prototype) ? PPTGeneratorCtor :
            null;

        if (!ctor?.prototype) return;
        Object.assign(ctor.prototype, PPTGeneratorExport);
    } catch {
        // ignore
    }
})();
