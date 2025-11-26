/**
 * PPT Generation Controller
 * Manages the 3-column interface for generating slides from documents.
 */

class PPTGenerator {
    constructor() {
        this.overlayId = 'pptGeneratorOverlay';
        this.isVisible = false;
        this.currentSlideIndex = 0;
        this.slides = []; // Array of slide objects { title, content, image, notes }
        this.materials = [];
        this.selectedLanguageModel = '';
        this.selectedImageModel = '';
        
        // DOM Elements references
        this.elements = {
            overlay: null,
            closeBtn: null,
            materialList: null,
            outlineContainer: null,
            slideCanvas: null,
            thumbnailsContainer: null,
            logConsole: null,
            generateBtn: null,
            exportBtn: null
        };
    }

    init() {
        // Inject HTML if not present (or assume it's in index.html)
        // For now, we assume the HTML structure is added to index.html or loaded dynamically.
        // This init method should be called after DOM is ready.
        
        this.elements.overlay = document.getElementById(this.overlayId);
        if (!this.elements.overlay) {
            console.warn('PPT Generator overlay element not found. Make sure HTML is injected.');
            return;
        }

        this._bindEvents();
        this._bindLaunchers();
        this.populateModelSelects();
        console.log('PPT Generator initialized.');
    }

    _bindEvents() {
        // Close button
        const closeBtn = document.getElementById('pptCloseBtn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.hide());
        }

        // Thumbnail clicks (delegation)
        const thumbContainer = document.getElementById('pptThumbnails');
        if (thumbContainer) {
            thumbContainer.addEventListener('click', (e) => {
                const thumb = e.target.closest('.ppt-thumbnail');
                if (thumb) {
                    const index = parseInt(thumb.dataset.index, 10);
                    this.switchToSlide(index);
                }
            });
        }

        // Generate Outline Button
        const genOutlineBtn = document.getElementById('pptGenOutlineBtn');
        if (genOutlineBtn) {
            genOutlineBtn.addEventListener('click', () => this.generateOutline());
        }

        // Export Button
        const exportBtn = document.getElementById('pptExportBtn');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => this.exportToPPTX());
        }

        const saveBtn = document.getElementById('pptSaveBtn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.saveDraft());
        }

        // Material click -> add slide
        const matList = document.getElementById('pptMaterialList');
        if (matList) {
            matList.addEventListener('click', (e) => {
                const card = e.target.closest('.material-source-item');
                if (!card) return;
                const idx = parseInt(card.dataset.index, 10);
                this.addSlideFromMaterial(idx);
            });
        }

        const langSelect = document.getElementById('pptLanguageModelSelect');
        if (langSelect) {
            langSelect.addEventListener('change', () => {
                this.selectedLanguageModel = langSelect.value;
                this.log(`文字模型已切换为: ${this.selectedLanguageModel || '默认'}`);
            });
        }
        const imgSelect = document.getElementById('pptImageModelSelect');
        if (imgSelect) {
            imgSelect.addEventListener('change', () => {
                this.selectedImageModel = imgSelect.value;
                this.log(`配图模型已切换为: ${this.selectedImageModel || '默认'}`);
                this.updateModelHints();
            });
        }

        const modelConfigBtn = document.getElementById('pptModelConfigBtn');
        if (modelConfigBtn) {
            modelConfigBtn.addEventListener('click', () => {
                if (window.PPTModelConfigModal && typeof window.PPTModelConfigModal.openModal === 'function') {
                    window.PPTModelConfigModal.openModal();
                } else {
                    this.log('模型配置弹窗未加载');
                }
            });
        }
    }

    _bindLaunchers() {
        const launchBtns = [
            document.getElementById('openPptGeneratorBtn'),
            document.getElementById('sidebarPptBtn')
        ].filter(Boolean);
        launchBtns.forEach(btn => btn.addEventListener('click', () => this.show()));
    }

    show() {
        if (this.elements.overlay) {
            this.elements.overlay.classList.remove('hidden');
            this.isVisible = true;
            // Load initial state if empty
            if (this.slides.length === 0) {
                if (!this.loadDraft()) {
                    this.createNewProject();
                }
            }
            this.populateModelSelects(); // ensure synced with homepage model selectors
            this.hydrateMaterials();
        }
    }

    hide() {
        if (this.elements.overlay) {
            this.elements.overlay.classList.add('hidden');
            this.isVisible = false;
        }
    }

    createNewProject() {
        this.slides = [
            { title: '封面标题', content: '副标题 / 演讲人', image: null, notes: '开场白...' },
            { title: '目录', content: '1. 背景介绍\n2. 核心观点\n3. 总结', image: null, notes: '' }
        ];
        this.currentSlideIndex = 0;
        this.renderThumbnails();
        this.renderCurrentSlide();
        this.log('Created new project.');
    }

    hydrateMaterials() {
        // 尝试从当前会话的 allResults 提取素材
        try {
            if (Array.isArray(window.allResults) && window.allResults.length > 0) {
                const usable = window.allResults.filter(r => r && !r.error);
                this.materials = usable.map(item => ({
                    title: item.file ? item.file.name || item.file : '文档',
                    summary: (item.summary || item.translatedText || item.markdown || '').slice(0, 500)
                })).slice(0, 5);
                this.renderMaterials();
                this.log(`Loaded ${this.materials.length} materials from current session.`);
            }
        } catch (e) {
            console.warn('[PPT] hydrate materials failed', e);
        }
    }

    loadDraft() {
        try {
            const raw = localStorage.getItem('pptGeneratorDraft');
            if (!raw) return false;
            const draft = JSON.parse(raw);
            if (draft && Array.isArray(draft.slides)) {
                this.slides = draft.slides;
                this.materials = Array.isArray(draft.materials) ? draft.materials : [];
                this.currentSlideIndex = 0;
                this.renderThumbnails();
                this.renderCurrentSlide();
                this.renderMaterials();
                this.log('草稿已加载。');
                return true;
            }
        } catch (e) {
            console.warn('[PPT] load draft failed', e);
        }
        return false;
    }

    addSlideFromMaterial(idx) {
        if (!this.materials || !this.materials[idx]) return;
        const m = this.materials[idx];
        const newSlide = {
            title: m.title || `素材 ${idx + 1}`,
            content: (m.summary || '').split(/\n+/).slice(0, 6).join('\n'),
            image: null,
            notes: ''
        };
        this.slides.push(newSlide);
        this.currentSlideIndex = this.slides.length - 1;
        this.renderThumbnails();
        this.renderCurrentSlide();
        this.updateActiveThumbnail();
        this.log(`已从素材创建幻灯片：${newSlide.title}`);
    }

    populateModelSelects() {
        const langSelect = document.getElementById('pptLanguageModelSelect');
        const imgSelect = document.getElementById('pptImageModelSelect');
        const langCfg = window.PPTModelConfigModal && typeof window.PPTModelConfigModal.loadConfig === 'function'
            ? window.PPTModelConfigModal.loadConfig('lang')
            : null;
        const imgCfg = window.PPTModelConfigModal && typeof window.PPTModelConfigModal.loadConfig === 'function'
            ? window.PPTModelConfigModal.loadConfig('img')
            : null;

        const models = Array.isArray(window.supportedModelsForKeyManager) ? window.supportedModelsForKeyManager : [];
        const languageModels = models.filter(
            m => m.group !== 'image' && m.group !== 'ocr' && m.group !== 'embedding' && m.key !== 'deeplx'
        );
        const imageModels = models.filter(m => m.group === 'image');

        if (langSelect) {
            if (languageModels.length === 0) {
                langSelect.innerHTML = `<option value="">未发现文字模型</option>`;
            } else {
                langSelect.innerHTML = languageModels.map(m => `<option value="${m.key}">${m.name || m.key}</option>`).join('');
                this.selectedLanguageModel = langCfg?.modelKey || languageModels[0].key;
                langSelect.value = this.selectedLanguageModel;
            }
        }

        if (imgSelect) {
            const defaults = [
                { key: 'image', name: '通用生图' },
                { key: 'gemini-image', name: 'Gemini 生图' }
            ];
            defaults.forEach(d => {
                if (!imageModels.some(m => m.key === d.key)) imageModels.push(d);
            });
            imgSelect.innerHTML = imageModels.map(m => `<option value="${m.key}">${m.name || m.key}</option>`).join('');
            this.selectedImageModel = imgCfg?.modelKey || imageModels[0]?.key || 'image';
            imgSelect.value = this.selectedImageModel;
        }

        this.updateModelHints();
    }

    updateModelHints() {
        const langHint = document.getElementById('pptLanguageModelHint');
        const imgHint = document.getElementById('pptImageModelHint');
        const checker = (key) => {
            try {
                if (window.modelManager && typeof window.modelManager.checkModelHasValidKey === 'function') {
                    return window.modelManager.checkModelHasValidKey(key);
                }
            } catch (_) {}
            return true; // default to true if unknown
        };
        if (langHint) {
            const ok = this.selectedLanguageModel ? checker(this.selectedLanguageModel) : false;
            langHint.textContent = ok ? 'Key 可用' : 'Key 未配置或不可用';
            langHint.style.color = ok ? '#10b981' : '#f97316';
        }
        if (imgHint) {
            const ok = this.selectedImageModel ? checker(this.selectedImageModel) : false;
            imgHint.textContent = ok ? 'Key 可用' : 'Key 未配置或不可用';
            imgHint.style.color = ok ? '#10b981' : '#f97316';
        }
    }

    renderMaterials() {
        const list = document.getElementById('pptMaterialList');
        if (!list) return;
        if (!this.materials.length) {
            list.innerHTML = `<div class="text-sm text-slate-400 italic text-center py-4 border border-dashed border-slate-200 rounded-md">
                暂无素材，请导入或输入
            </div>`;
            return;
        }
        list.innerHTML = this.materials.map((m, idx) => `
            <div class="material-source-item ${idx === 0 ? 'active' : ''}" data-index="${idx}">
                <div class="font-semibold text-slate-800 text-sm">${m.title || '未命名'}</div>
                <div class="text-xs text-slate-500 mt-1 line-clamp-2">${(m.summary || '').replace(/\n/g, ' ').slice(0,120)}</div>
            </div>
        `).join('');
    }

    loadMaterialsFromHistory(historyItem) {
        // TODO: Load content from a specific history item (PDF/Doc analysis result)
        this.log(`Loading materials from: ${historyItem.title}`);
        // Populate left column
    }

    generateOutline() {
        this.log('Generating outline via Agent...');
        // TODO: Call LLM Agent to generate outline based on selected materials
        // Mockup:
        setTimeout(() => {
            this.log('Outline generated.');
            // Update slides array
            this.renderThumbnails();
        }, 1000);
    }

    switchToSlide(index) {
        if (index >= 0 && index < this.slides.length) {
            this.currentSlideIndex = index;
            this.renderCurrentSlide();
            this.updateActiveThumbnail();
        }
    }

    renderCurrentSlide() {
        const slide = this.slides[this.currentSlideIndex];
        const canvas = document.getElementById('pptSlideCanvas');
        if (!canvas) return;

        // Simple render for prototype
        canvas.innerHTML = `
            <div class="ppt-slide-card">
                <div class="slide-title-edit" id="pptSlideTitle" contenteditable="true">${slide.title}</div>
                <div class="slide-content-edit">
                    <div class="slide-text-area" id="pptSlideContent" contenteditable="true">
                        ${(slide.content || '').replace(/\n/g, '<br>')}
                    </div>
                    <div class="slide-image-placeholder" onclick="window.PPTGenerator.triggerImageGen(${this.currentSlideIndex})">
                        ${slide.image ? `<img src="${slide.image}" style="max-width:100%;max-height:100%">` : '<span>点击生成配图</span>'}
                    </div>
                </div>
                <div class="ppt-thumbnail-number" style="bottom: 10px; left: 10px; font-size: 12px; color: #999;">
                    Page ${this.currentSlideIndex + 1}
                </div>
            </div>
        `;

        const titleEl = document.getElementById('pptSlideTitle');
        const contentEl = document.getElementById('pptSlideContent');
        if (titleEl) {
            titleEl.addEventListener('input', () => {
                this.slides[this.currentSlideIndex].title = titleEl.innerText.trim();
                this.renderThumbnails();
                this.updateActiveThumbnail();
            });
        }
        if (contentEl) {
            contentEl.addEventListener('input', () => {
                this.slides[this.currentSlideIndex].content = contentEl.innerText;
            });
        }
    }

    renderThumbnails() {
        const container = document.getElementById('pptThumbnails');
        if (!container) return;

        container.innerHTML = this.slides.map((slide, idx) => `
            <div class="ppt-thumbnail ${idx === this.currentSlideIndex ? 'active' : ''}" data-index="${idx}">
                <div class="flex items-center justify-center h-full text-xs text-gray-400">
                    ${slide.title || 'Untitled'}
                </div>
                <div class="ppt-thumbnail-number">${idx + 1}</div>
            </div>
        `).join('');
    }

    updateActiveThumbnail() {
        const thumbs = document.querySelectorAll('.ppt-thumbnail');
        thumbs.forEach((t, idx) => {
            if (idx === this.currentSlideIndex) t.classList.add('active');
            else t.classList.remove('active');
        });
    }

    triggerImageGen(slideIndex) {
        this.log(`开始为第 ${slideIndex + 1} 页生成配图...`);
        const slide = this.slides[slideIndex];
        const prompt = `${slide.title || '幻灯片'}\n${slide.content || ''}`.slice(0, 500);

        if (!window.ImageGeneration || typeof window.ImageGeneration.generateImage !== 'function') {
            this.log('配图模块未加载，无法生成图片。');
            return;
        }

        const provider = this.selectedImageModel || 'image';
        const imgCfg = window.PPTModelConfigModal && typeof window.PPTModelConfigModal.loadConfig === 'function'
            ? window.PPTModelConfigModal.loadConfig('img')
            : null;
        const isChat = provider === 'image'
            ? (typeof loadModelConfig === 'function' && (loadModelConfig('image') || {}).chatImageMode)
            : false;

        window.ImageGeneration.generateImage({
            provider,
            model: imgCfg?.modelId || (typeof loadModelConfig === 'function' ? (loadModelConfig(provider) || {}).modelId : undefined),
            prompt,
            width: 1280,
            height: 720,
            chatStream: isChat,
            onStreamMessage: (msg) => this.log(`[流式] ${msg}`),
            onStreamImages: (imgs) => {
                if (imgs && imgs.length) {
                    this.slides[slideIndex].image = imgs[0].url || imgs[0].base64;
                    this.renderCurrentSlide();
                    this.updateActiveThumbnail();
                    this.log(`第 ${slideIndex + 1} 页配图已返回（流式多图）。`);
                }
            }
        }).then(res => {
            const imgSrc = res?.url || res?.base64;
            if (imgSrc) {
                this.slides[slideIndex].image = imgSrc;
                this.renderCurrentSlide();
                this.updateActiveThumbnail();
                this.log(`第 ${slideIndex + 1} 页配图生成完成。`);
            } else {
                this.log('未获取到图片内容。');
            }
        }).catch(err => {
            console.error(err);
            this.log(`配图生成失败: ${err.message || err}`);
        });
    }

    async exportToPPTX() {
        if (typeof PptxGenJS === 'undefined') {
            this.log('Error: PptxGenJS library not loaded.');
            alert('导出组件未加载，请刷新页面重试。');
            return;
        }

        this.log('Starting PPTX export...');
        const pptx = new PptxGenJS();
        pptx.layout = 'LAYOUT_16x9';

        // Add slides
        this.slides.forEach((slideData, index) => {
            const slide = pptx.addSlide();
            
            // Title
            slide.addText(slideData.title, {
                x: 0.5, y: 0.5, w: '90%', h: 1,
                fontSize: 32, bold: true, color: '363636'
            });

            // Content
            slide.addText(slideData.content, {
                x: 0.5, y: 1.8, w: '45%', h: 4,
                fontSize: 18, color: '666666',
                bullet: true
            });

            // Image (Placeholder or Real)
            if (slideData.image) {
                slide.addImage({ path: slideData.image, x: 5.5, y: 1.8, w: 4, h: 3 });
            } else {
                slide.addText('(配图占位)', {
                    x: 5.5, y: 1.8, w: 4, h: 3,
                    fontSize: 14, color: 'CCCCCC', align: 'center',
                    shape: pptx.ShapeType.rect, fill: { color: 'F1F1F1' }, line: { color: 'CCCCCC', dashType: 'dash' }
                });
            }

            // Notes
            if (slideData.notes) {
                slide.addNotes(slideData.notes);
            }
        });

        try {
            await pptx.writeFile({ fileName: `Presentation_${new Date().getTime()}.pptx` });
            this.log('Export successful!');
        } catch (error) {
            console.error(error);
            this.log('Export failed: ' + error.message);
        }
    }

    log(msg) {
        const consoleEl = document.getElementById('pptLogConsole');
        if (consoleEl) {
            const time = new Date().toLocaleTimeString();
            consoleEl.innerHTML += `<div><span style="color:#64748b">[${time}]</span> ${msg}</div>`;
            consoleEl.scrollTop = consoleEl.scrollHeight;
        }
        console.log(`[PPT] ${msg}`);
    }

    saveDraft() {
        // 简易草稿保存到 localStorage
        try {
            const payload = { slides: this.slides, materials: this.materials, ts: Date.now() };
            localStorage.setItem('pptGeneratorDraft', JSON.stringify(payload));
            this.log('草稿已保存到本地浏览器。');
        } catch (e) {
            this.log('草稿保存失败：' + e.message);
        }
    }
}

// Expose global instance
window.PPTGenerator = new PPTGenerator();
// Auto-initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    if (window.PPTGenerator) {
        window.PPTGenerator.init();
    }
});
