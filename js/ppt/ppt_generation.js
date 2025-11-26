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
        this.historyCache = [];
        this.manualDraftEdited = false;
        this.outlineItems = [];
        this.outlineQuestions = [];
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
            exportBtn: null,
            draftEditor: null
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
        const submitAnswersBtn = document.getElementById('pptSubmitAnswersBtn');
        if (submitAnswersBtn) {
            submitAnswersBtn.addEventListener('click', () => this.applyAnswersToDraft());
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

        const importBtn = document.getElementById('pptImportBtn');
        if (importBtn) {
            importBtn.addEventListener('click', () => this.openImportModal());
        }

        const draftEditor = document.getElementById('pptDraftEditor');
        if (draftEditor) {
            this.elements.draftEditor = draftEditor;
            draftEditor.addEventListener('input', () => {
                this.manualDraftEdited = true;
            });
        }

        const syncDraftBtn = document.getElementById('pptSyncDraftBtn');
        if (syncDraftBtn) {
            syncDraftBtn.addEventListener('click', () => this.updateDraftFromMaterials(true));
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
                this.updateDraftFromMaterials();
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
                this.updateDraftFromMaterials();
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

    updateDraftFromMaterials(force = false) {
        const editor = this.elements.draftEditor || document.getElementById('pptDraftEditor');
        if (!editor) return;
        if (this.manualDraftEdited && !force) return;
        const merged = this.materials
            .map(m => (m.summary || m.content || '').trim())
            .filter(Boolean)
            .join('\n\n');
        editor.value = merged || editor.value || '';
        if (merged) this.manualDraftEdited = false;
    }

    // ===== 导入素材与文案草稿 =====
    ensureImportModal() {
        if (document.getElementById('pptImportModal')) return;
        const wrapper = document.createElement('div');
        wrapper.id = 'pptImportModal';
        wrapper.style.cssText = 'position:fixed;inset:0;z-index:80;display:none;align-items:center;justify-content:center;';
        wrapper.innerHTML = `
          <div style="position:absolute;inset:0;background:rgba(0,0,0,0.4);" data-close="1"></div>
          <div style="position:relative;z-index:1;width:92vw;max-width:960px;max-height:90vh;background:#fff;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,0.2);display:flex;flex-direction:column;overflow:hidden;">
            <div style="padding:14px 18px;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;justify-content:space-between;">
              <div>
                <div style="font-weight:700;color:#0f172a;">导入素材</div>
                <div style="font-size:12px;color:#6b7280;">可从历史记录、文件或粘贴的文本生成初步文案</div>
              </div>
              <button data-close="1" style="border:none;background:transparent;font-size:18px;color:#94a3b8;cursor:pointer;">×</button>
            </div>
            <div style="padding:16px;overflow:auto;flex:1;display:grid;grid-template-columns:1fr 1fr;gap:16px;">
              <div>
                <div style="font-weight:600;color:#0f172a;margin-bottom:6px;">历史记录</div>
                <div id="pptImportHistoryList" style="border:1px solid #e5e7eb;border-radius:10px;padding:10px;height:340px;overflow:auto;font-size:13px;color:#475569;">
                  <div style="text-align:center;color:#94a3b8;">加载中...</div>
                </div>
              </div>
              <div style="display:flex;flex-direction:column;gap:10px;">
                <div style="font-weight:600;color:#0f172a;">粘贴/文件</div>
                <textarea id="pptImportText" style="flex:1;border:1px solid #e5e7eb;border-radius:10px;padding:10px;font-size:13px;min-height:160px;" placeholder="在此粘贴文本，将作为一条素材"></textarea>
                <input id="pptImportFileInput" type="file" accept=".txt,.md,.doc,.docx,.pdf" style="font-size:13px;">
                <div style="display:flex;gap:8px;justify-content:flex-end;">
                  <button id="pptImportAddText" class="ppt-model-refresh-btn" style="padding:8px 12px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;cursor:pointer;">添加粘贴内容</button>
                </div>
              </div>
            </div>
            <div style="padding:12px 16px;border-top:1px solid #e5e7eb;display:flex;justify-content:flex-end;gap:10px;">
              <button data-close="1" style="padding:8px 12px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;cursor:pointer;">取消</button>
              <button id="pptImportConfirm" style="padding:8px 14px;border:none;border-radius:8px;background:linear-gradient(90deg,#6366f1,#8b5cf6);color:#fff;font-weight:600;cursor:pointer;">加入素材</button>
            </div>
          </div>
        `;
        document.body.appendChild(wrapper);

        wrapper.addEventListener('click', (e) => {
            if (e.target && e.target.dataset && e.target.dataset.close) {
                this.closeImportModal();
            }
        });

        const addTextBtn = wrapper.querySelector('#pptImportAddText');
        if (addTextBtn) {
            addTextBtn.addEventListener('click', () => {
                const text = (wrapper.querySelector('#pptImportText')?.value || '').trim();
                if (!text) return;
                this.addMaterials([{ title: '粘贴内容', summary: text.slice(0, 800) }]);
                wrapper.querySelector('#pptImportText').value = '';
                this.renderMaterials();
                this.updateDraftFromMaterials();
                this.log('已添加粘贴内容为素材。');
            });
        }

        const fileInput = wrapper.querySelector('#pptImportFileInput');
        if (fileInput) {
            fileInput.addEventListener('change', async (e) => {
                const file = e.target.files && e.target.files[0];
                if (!file) return;
                try {
                    const text = await file.text();
                    this.addMaterials([{ title: file.name, summary: text.slice(0, 1200) }]);
                    this.renderMaterials();
                    this.updateDraftFromMaterials();
                    this.log(`已从文件导入素材：${file.name}`);
                } catch (err) {
                    console.warn('[PPT] 读取文件失败', err);
                    alert('读取文件失败，请重试');
                }
                e.target.value = '';
            });
        }

        const confirmBtn = wrapper.querySelector('#pptImportConfirm');
        if (confirmBtn) {
            confirmBtn.addEventListener('click', () => {
                const selected = Array.from(wrapper.querySelectorAll('input[data-history-id]:checked'));
                if (selected.length > 0) {
                    const items = selected.map((el) => {
                        const rec = this.historyCache.find(r => r.id === el.dataset.historyId);
                        return this.materialFromHistory(rec);
                    }).filter(Boolean);
                    this.addMaterials(items);
                    this.renderMaterials();
                    this.updateDraftFromMaterials();
                    this.log(`已从历史记录添加 ${items.length} 条素材。`);
                }
                this.closeImportModal();
            });
        }
    }

    openImportModal() {
        this.ensureImportModal();
        this.loadHistoryIntoModal();
        const modal = document.getElementById('pptImportModal');
        if (modal) modal.style.display = 'flex';
    }

    closeImportModal() {
        const modal = document.getElementById('pptImportModal');
        if (modal) modal.style.display = 'none';
    }

    async loadHistoryIntoModal() {
        const listEl = document.getElementById('pptImportHistoryList');
        if (!listEl) return;
        listEl.innerHTML = `<div style="text-align:center;color:#94a3b8;">加载中...</div>`;
        try {
            const loader = (typeof window.getAllResultsFromDB === 'function') ? window.getAllResultsFromDB : null;
            if (!loader) {
                listEl.innerHTML = `<div style="text-align:center;color:#94a3b8;">未能加载历史：缺少存储模块</div>`;
                return;
            }
            const records = await loader();
            this.historyCache = (Array.isArray(records) ? records : []).sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0)).slice(0, 30);
            if (!this.historyCache.length) {
                listEl.innerHTML = `<div style="text-align:center;color:#94a3b8;">暂无历史记录</div>`;
                return;
            }
            listEl.innerHTML = this.historyCache.map(rec => {
                const title = rec.name || (rec.file && rec.file.name) || '未命名文件';
                const time = rec.time ? new Date(rec.time).toLocaleString() : '';
                const preview = (rec.translation || rec.ocr || '').replace(/\s+/g, ' ').slice(0, 80);
                return `
                  <label style="display:block;padding:8px;border-bottom:1px solid #e5e7eb;cursor:pointer;">
                    <input type="checkbox" data-history-id="${rec.id}" style="margin-right:8px;">
                    <span style="font-weight:600;color:#0f172a;">${title}</span>
                    <span style="font-size:12px;color:#94a3b8;margin-left:6px;">${time}</span>
                    <div style="font-size:12px;color:#475569;margin-top:4px;">${preview || '无摘要'}</div>
                  </label>
                `;
            }).join('');
        } catch (e) {
            console.warn('[PPT] 加载历史记录失败', e);
            listEl.innerHTML = `<div style="text-align:center;color:#f97316;">加载历史记录失败，请检查浏览器存储权限</div>`;
        }
    }

    materialFromHistory(rec) {
        if (!rec) return null;
        const text = (rec.translation || rec.ocr || rec.markdown || rec.originalContent || '').toString();
        const clean = text.replace(/<[^>]+>/g, '').trim();
        return {
            title: rec.name || '历史记录素材',
            summary: clean.slice(0, 1200)
        };
    }

    addMaterials(items) {
        if (!Array.isArray(items)) return;
        items.forEach(it => {
            if (it && (it.summary || it.content)) {
                this.materials.push({
                    title: it.title || `素材 ${this.materials.length + 1}`,
                    summary: it.summary || it.content
                });
            }
        });
        this.renderMaterials();
        this.updateDraftFromMaterials();
    }

    generateOutline() {
        const themeInput = document.getElementById('pptThemeInput');
        const theme = themeInput ? themeInput.value.trim() : '';
        if (!theme) {
            alert('请先填写主题/目标，再生成提纲');
            return;
        }

        // 简易 Agent 逻辑：根据主题 + 素材摘要生成 5 段提纲和提问
        const materialHints = this.materials.map(m => m.summary || '').filter(Boolean).slice(0, 3);
        const baseOutline = [
            '目标与受众',
            '核心卖点 / 关键结论',
            '证据与案例',
            '方案 / 行动路径',
            '收尾与号召'
        ];
        this.outlineItems = baseOutline.map((title, idx) => ({
            id: `outline-${idx + 1}`,
            title: `${idx + 1}. ${title}`,
            hint: materialHints[idx] || ''
        }));

        this.outlineQuestions = this.outlineItems.map(item => ({
            id: `${item.id}-q1`,
            outlineId: item.id,
            title: item.title,
            question: `请填写「${item.title.replace(/^\d+\.?\s*/, '')}」需要呈现的要点、数据或例子：`,
            value: ''
        }));

        this.renderOutline();
        this.renderOutlineQuestions();
        this.log('已生成提纲草稿，请回答问题以生成文案。');
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

    renderOutline() {
        const tree = document.getElementById('pptOutlineTree');
        if (!tree) return;
        if (!this.outlineItems.length) {
            tree.innerHTML = `<div class="text-sm p-2 bg-slate-50 rounded border border-slate-200 text-slate-600">请先填写主题并点击生成提纲。</div>`;
            return;
        }
        tree.innerHTML = this.outlineItems.map(item => `
            <div class="text-sm p-2 bg-slate-50 rounded border border-slate-200 text-slate-700">
                ${item.title}
                ${item.hint ? `<div class="text-xs text-slate-400 mt-1">素材提示：${item.hint.slice(0,120)}</div>` : ''}
            </div>
        `).join('');
    }

    renderOutlineQuestions() {
        const wrap = document.getElementById('pptOutlineQuestions');
        const submitBtn = document.getElementById('pptSubmitAnswersBtn');
        if (!wrap || !submitBtn) return;
        if (!this.outlineQuestions.length) {
            wrap.classList.add('hidden');
            submitBtn.classList.add('hidden');
            return;
        }
        wrap.classList.remove('hidden');
        submitBtn.classList.remove('hidden');
        wrap.innerHTML = this.outlineQuestions.map(q => `
            <div>
                <div class="text-sm font-semibold text-slate-700 mb-1">${q.title}</div>
                <label class="text-xs text-slate-500">${q.question}</label>
                <textarea data-qid="${q.id}" class="w-full mt-1 text-sm border border-slate-200 rounded-md p-2" rows="3" placeholder="请输入要点、数字、案例">${q.value || ''}</textarea>
            </div>
        `).join('');
    }

    applyAnswersToDraft() {
        const wrap = document.getElementById('pptOutlineQuestions');
        if (wrap) {
            const inputs = wrap.querySelectorAll('textarea[data-qid]');
            inputs.forEach((ta) => {
                const qid = ta.dataset.qid;
                const val = ta.value.trim();
                const target = this.outlineQuestions.find(q => q.id === qid);
                if (target) target.value = val;
            });
        }
        const merged = this.outlineQuestions
            .map(q => q.value ? `${q.title}\n${q.value}` : '')
            .filter(Boolean)
            .join('\n\n');
        const editor = this.elements.draftEditor || document.getElementById('pptDraftEditor');
        if (editor) {
            editor.value = merged || editor.value || '';
            this.manualDraftEdited = false;
        }
        this.log('已根据回答更新文案草稿，可继续编辑或生成幻灯片。');
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
