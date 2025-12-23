(()=>{
  window.PPTDashboard = window.PPTDashboard || {};
  const NS = window.PPTDashboard;
  NS.designSpec = NS.designSpec || {};
  const designPrefs = typeof globalThis !== 'undefined' && globalThis.PPTDesignPreferences ? globalThis.PPTDesignPreferences : null;
  const DesignVisualMode = designPrefs?.DesignVisualMode || Object.freeze({
      AI_FIRST: 'ai-first',
      SVG_FIRST: 'svg-first',
      BALANCED: 'balanced'
  });
  const DesignDensity = designPrefs?.DesignDensity || Object.freeze({
      COMPACT: 'compact',
      BALANCED: 'balanced',
      SPACIOUS: 'spacious'
  });
  const StyleReferenceStatus = designPrefs?.StyleReferenceStatus || Object.freeze({
      ANALYZING: 'analyzing',
      DONE: 'done',
      ERROR: 'error'
  });
  const normalizeDesignVisualMode = designPrefs?.normalizeDesignVisualMode || ((value, fallback = DesignVisualMode.BALANCED) => {
      const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
      return Object.values(DesignVisualMode).includes(v) ? v : fallback;
  });
  const normalizeDesignDensity = designPrefs?.normalizeDesignDensity || ((value, fallback = DesignDensity.BALANCED) => {
      const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
      return Object.values(DesignDensity).includes(v) ? v : fallback;
  });
  const isValidDesignVisualMode = designPrefs?.isValidDesignVisualMode || ((value) => Object.values(DesignVisualMode).includes(value));
  const isValidDesignDensity = designPrefs?.isValidDesignDensity || ((value) => Object.values(DesignDensity).includes(value));
  Object.assign(NS.designSpec, {
    _ensureDesignSpecInitialized() {
        if (!this.workflowData) this.workflowData = {};
        if (!this.workflowData.designSystem || typeof this.workflowData.designSystem !== 'object') {
            this.workflowData.designSystem = {};
        }

        const ds = this.workflowData.designSystem;

        // === DesignSystem UI v2 userConfig model ===
        // Keep backwards compatibility with legacy {colors,fonts,...} by migrating into designSystemOverrides.
        const legacyColors = ds.colors && typeof ds.colors === 'object' ? ds.colors : null;
        const legacyFonts = ds.fonts && typeof ds.fonts === 'object' ? ds.fonts : null;
        const legacyVisualPref = ds.visualPreference && typeof ds.visualPreference === 'object' ? ds.visualPreference : null;

        if (!ds.designPreferences || typeof ds.designPreferences !== 'object') ds.designPreferences = {};
        const prefs = ds.designPreferences;
        if (!Array.isArray(prefs.styleKeywords)) prefs.styleKeywords = [];
        if (typeof prefs.referenceImageSummary !== 'string') prefs.referenceImageSummary = '';
        if (typeof prefs.industry !== 'string') prefs.industry = '';
        if (typeof prefs.tone !== 'string') prefs.tone = '';

        if (!ds.designSystemOverrides || typeof ds.designSystemOverrides !== 'object') ds.designSystemOverrides = {};
        const overrides = ds.designSystemOverrides;

        if (!overrides.colors || typeof overrides.colors !== 'object') overrides.colors = {};
        if (legacyColors) {
            for (const [k, v] of Object.entries(legacyColors)) {
                if (typeof overrides.colors[k] !== 'string' && typeof v === 'string') overrides.colors[k] = v;
            }
        }
        if (typeof overrides.colors.primary !== 'string') overrides.colors.primary = '#0ea5e9';
        if (typeof overrides.colors.secondary !== 'string') overrides.colors.secondary = '#7c3aed';
        if (typeof overrides.colors.bg !== 'string') overrides.colors.bg = '#ffffff';
        if (typeof overrides.colors.text !== 'string') overrides.colors.text = '#0f172a';
        if (typeof overrides.colors.accent !== 'string') overrides.colors.accent = '#22c55e';

        if (!overrides.typography || typeof overrides.typography !== 'object') overrides.typography = {};
        if (legacyFonts) {
            for (const [k, v] of Object.entries(legacyFonts)) {
                if (typeof overrides.typography[k] === 'undefined') overrides.typography[k] = v;
            }
        }
        if (typeof overrides.typography.titleFont !== 'string') overrides.typography.titleFont = 'Inter';
        if (typeof overrides.typography.bodyFont !== 'string') overrides.typography.bodyFont = 'Inter';
        if (typeof overrides.typography.fontSize !== 'number') overrides.typography.fontSize = 16;

        if (!overrides.spacing || typeof overrides.spacing !== 'object') overrides.spacing = {};
        if (!overrides.effects || typeof overrides.effects !== 'object') overrides.effects = {};

        if (!overrides.visualPreference || typeof overrides.visualPreference !== 'object') overrides.visualPreference = {};
        if (legacyVisualPref && typeof overrides.visualPreference.mode !== 'string' && typeof legacyVisualPref.mode === 'string') {
            overrides.visualPreference.mode = legacyVisualPref.mode;
        }
        overrides.visualPreference.mode = normalizeDesignVisualMode(overrides.visualPreference.mode, DesignVisualMode.BALANCED);

        // Legacy aliases (UI code historically reads ds.colors / ds.fonts)
        ds.colors = overrides.colors;
        ds.fonts = overrides.typography;
        ds.visualPreference = overrides.visualPreference;

        ds.density = normalizeDesignDensity(ds.density, DesignDensity.BALANCED);

        if (typeof ds.model !== 'string') ds.model = 'gemini-1.5-pro';

        // Initialize refiner config (ReAct)
        if (!ds.refine || typeof ds.refine !== 'object') ds.refine = {};
        if (typeof ds.refine.enabled !== 'boolean') ds.refine.enabled = false;
        if (!Number.isFinite(ds.refine.recommendedSteps) || ds.refine.recommendedSteps <= 0) ds.refine.recommendedSteps = 5;
        if (!Number.isFinite(ds.refine.hardLimit) || ds.refine.hardLimit <= 0) ds.refine.hardLimit = 15;

        // Initialize styleReference
        if (!ds.styleReference || typeof ds.styleReference !== 'object') {
            ds.styleReference = {
                images: [],
                extracted: null,
                userNotes: ''
            };
        }

        const allowedBatch = new Set([1, 2, 4]);
        const batchSize = Number(this.workflowData.batchSize);
        if (!allowedBatch.has(batchSize)) this.workflowData.batchSize = 4;

        return ds;
    },


    _coerceHexColor(value, fallback) {
        const v = typeof value === 'string' ? value.trim() : '';
        if (/^#([0-9a-f]{6})$/i.test(v)) return v.toLowerCase();
        if (/^#([0-9a-f]{3})$/i.test(v)) {
            const m = v.toLowerCase().slice(1);
            return `#${m[0]}${m[0]}${m[1]}${m[1]}${m[2]}${m[2]}`;
        }
        return fallback;
    },


    updateDesignSystemColor(key, value) {
        const ds = this._ensureDesignSpecInitialized();
        const k = String(key || '').trim();
        if (!k) return;
        const colors = ds.designSystemOverrides?.colors || ds.colors || {};
        const prev = this._coerceHexColor(colors?.[k], '#000000');
        const next = this._coerceHexColor(value, prev);
        if (ds.designSystemOverrides?.colors) ds.designSystemOverrides.colors[k] = next;
        ds.colors[k] = next;
        this.renderPreviewArea?.();
    },


    updateDesignSystemFont(key, value) {
        const ds = this._ensureDesignSpecInitialized();
        const k = String(key || '').trim();
        if (!k) return;
        const typography = ds.designSystemOverrides?.typography || ds.fonts || {};
        const next = typeof value === 'string' ? value : String(value ?? '');
        if (ds.designSystemOverrides?.typography) ds.designSystemOverrides.typography[k] = next;
        typography[k] = next;
        ds.fonts[k] = next;
        this.renderPreviewArea?.();
    },


    updateDesignSystemFontSize(value) {
        const ds = this._ensureDesignSpecInitialized();
        const n = Number(value);
        if (!Number.isFinite(n)) return;
        const next = Math.max(10, Math.min(60, Math.round(n)));
        if (ds.designSystemOverrides?.typography) ds.designSystemOverrides.typography.fontSize = next;
        ds.fonts.fontSize = next;
        this.renderPreviewArea?.();
    },


    updateVisualPreferenceMode(mode) {
        const ds = this._ensureDesignSpecInitialized();
        const v = String(mode || '').trim();
        if (!isValidDesignVisualMode(v)) return;
        if (ds.designSystemOverrides?.visualPreference) ds.designSystemOverrides.visualPreference.mode = v;
        if (ds.visualPreference) ds.visualPreference.mode = v;
        this.renderPreviewArea?.();
    },


    updateRefineEnabled(enabled) {
        this.workflowData.designSystem = this.workflowData.designSystem || {};
        this.workflowData.designSystem.refine = this.workflowData.designSystem.refine || {};
        this.workflowData.designSystem.refine.enabled = !!enabled;
        this.renderPreviewArea();
    },


    updateDesignSystemDensity(value) {
        const ds = this._ensureDesignSpecInitialized();
        const v = String(value || '').trim();
        if (!isValidDesignDensity(v)) return;
        ds.density = v;
        this.renderPreviewArea?.();
    },


    updateBatchSize(value) {
        if (!this.workflowData) this.workflowData = {};
        const n = Number(value);
        if (![1, 2, 4].includes(n)) return;
        this.workflowData.batchSize = n;
        this.renderPreviewArea?.();
    },


    updateDesignSystemModel(value) {
        const ds = this._ensureDesignSpecInitialized();
        ds.model = String(value || '').trim() || ds.model;
        this.renderPreviewArea?.();
    },

    // Style Reference methods

    async addStyleReference(imageData) {
        const ds = this._ensureDesignSpecInitialized();
        if (!ds.styleReference.images) ds.styleReference.images = [];
        if (ds.styleReference.images.length >= 3) {
            console.warn('Maximum 3 style reference images allowed');
            return { ok: false, error: 'max_images' };
        }

        const id = `ref_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const imageEntry = { id, thumbnail: imageData, original: imageData, status: StyleReferenceStatus.ANALYZING };
        ds.styleReference.images.push(imageEntry);
        this.renderPreviewArea?.();

        // Call VLM to extract style
        try {
            const { analyzeImage } = await import('./vision/layout-from-image.js');
            const context = {
                intentHint: 'style_reference',
                modelRouter: window.modelRouter || this._modelRouter,
                visionApi: window.visionApi || this._visionApi
            };
            const result = await analyzeImage(imageData, context);

            // Merge extracted data
            const prev = ds.styleReference.extracted || {};
            ds.styleReference.extracted = {
                colorTone: result.styleDescription?.colorTone || prev.colorTone || '',
                mood: result.styleDescription?.mood || prev.mood || '',
                layoutStyle: result.styleDescription?.layoutStyle || prev.layoutStyle || '',
                typography: result.styleDescription?.typography || prev.typography || '',
                effects: result.styleDescription?.effects || prev.effects || '',
                palette: [...(prev.palette || []), ...(result.extractedPalette || [])].slice(0, 10)
            };

            // Update status
            const entry = ds.styleReference.images.find(e => e.id === id);
            if (entry) entry.status = StyleReferenceStatus.DONE;

            this.renderPreviewArea?.();
            return { ok: true, id, extracted: ds.styleReference.extracted };
        } catch (err) {
            console.error('Style extraction failed:', err);
            const entry = ds.styleReference.images.find(e => e.id === id);
            if (entry) entry.status = StyleReferenceStatus.ERROR;
            this.renderPreviewArea?.();
            return { ok: false, error: err.message };
        }
    },


    removeStyleReference(id) {
        const ds = this._ensureDesignSpecInitialized();
        if (!ds.styleReference.images) return;
        const idx = ds.styleReference.images.findIndex(e => e.id === id);
        if (idx >= 0) {
            ds.styleReference.images.splice(idx, 1);
            // Clear extracted if no images left
            if (ds.styleReference.images.length === 0) {
                ds.styleReference.extracted = null;
            }
            this.renderPreviewArea?.();
        }
    },


    updateStyleReferenceNotes(notes) {
        const ds = this._ensureDesignSpecInitialized();
        ds.styleReference.userNotes = String(notes || '');
        // No re-render needed for notes
    },


    _handleStyleRefDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        const dt = e.dataTransfer;
        if (!dt?.files?.length) return;
        const file = dt.files[0];
        if (!file.type.startsWith('image/')) return;
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result === 'string') {
                this.addStyleReference(reader.result);
            }
        };
        reader.readAsDataURL(file);
    },


    _handleStyleRefFileSelect(e) {
        const file = e.target?.files?.[0];
        if (!file || !file.type.startsWith('image/')) return;
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result === 'string') {
                this.addStyleReference(reader.result);
            }
        };
        reader.readAsDataURL(file);
    },

    _bindDesignSpecInteractions() {
        const dropzone = document.getElementById('pptStyleRefDropzone');
        if (!dropzone || dropzone.dataset.bound === '1') return;
        dropzone.dataset.bound = '1';

        const onDragOver = (e) => {
            e.preventDefault();
            dropzone.classList.add('dragover');
        };
        const onDragLeave = () => {
            dropzone.classList.remove('dragover');
        };
        const onDrop = (e) => {
            e.preventDefault();
            dropzone.classList.remove('dragover');
            this._handleStyleRefDrop?.(e);
        };
        const onClick = () => {
            document.getElementById('pptStyleRefInput')?.click();
        };

        dropzone.addEventListener('dragover', onDragOver);
        dropzone.addEventListener('dragleave', onDragLeave);
        dropzone.addEventListener('drop', onDrop);
        dropzone.addEventListener('click', onClick);

        const input = document.getElementById('pptStyleRefInput');
        if (input && input.dataset.bound !== '1') {
            input.dataset.bound = '1';
            input.addEventListener('change', (event) => this._handleStyleRefFileSelect?.(event));
        }
    },


    _renderDesignSpecView() {
        const ds = this._ensureDesignSpecInitialized();
        const overrides = ds.designSystemOverrides || {};
        const colors = overrides.colors || ds.colors || {};
        const fonts = overrides.typography || ds.fonts || {};
        const visualMode = typeof overrides?.visualPreference?.mode === 'string' ? overrides.visualPreference.mode : (ds.visualPreference?.mode || 'balanced');
        const refineEnabled = !!ds.refine?.enabled;
        const density = ds.density || 'balanced';
        const batchSize = Number(this.workflowData?.batchSize) || 4;

        const primary = this._coerceHexColor(colors.primary, '#0ea5e9');
        const secondary = this._coerceHexColor(colors.secondary, '#7c3aed');
        const bg = this._coerceHexColor(colors.bg, '#ffffff');
        const text = this._coerceHexColor(colors.text, '#0f172a');
        const accent = this._coerceHexColor(colors.accent, '#22c55e');

        const titleFont = typeof fonts.titleFont === 'string' ? fonts.titleFont : 'Inter';
        const bodyFont = typeof fonts.bodyFont === 'string' ? fonts.bodyFont : 'Inter';
        const fontSize = Number.isFinite(Number(fonts.fontSize)) ? Number(fonts.fontSize) : 16;

        const densityPad = density === 'compact' ? 10 : (density === 'spacious' ? 18 : 14);

        const modelOptions = [
            { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
            { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
            { value: 'gpt-4o-mini', label: 'GPT-4o mini' },
            { value: 'gpt-4o', label: 'GPT-4o' }
        ];
        const selectedModel = typeof ds.model === 'string' && ds.model.trim() ? ds.model.trim() : 'gemini-1.5-pro';

        const colorRow = (key, label, value) => `
            <div class="ppt-design-spec-color-row" data-design-color="${this._escapeAttr(key)}">
                <div class="ppt-design-spec-swatch" style="background: ${this._escapeAttr(value)};"></div>
                <div class="ppt-design-spec-color-meta">
                    <div class="ppt-design-spec-color-label">${this._escapeHtml(label)}</div>
                    <div class="ppt-design-spec-color-value">${this._escapeHtml(value)}</div>
                </div>
                <input id="pptDesignColor-${this._escapeAttr(key)}" class="ppt-design-spec-color-input" type="color" value="${this._escapeAttr(value)}"
                    data-action="updateDesignSystemColor" data-event="input" data-key="${this._escapeAttr(key)}">
            </div>
        `;

        const segBtn = (group, value, label, active) => `
            <button class="ppt-design-spec-seg-btn ${active ? 'active' : ''}" type="button"
                data-action="${group}" data-mode="${this._escapeAttr(value)}">${this._escapeHtml(label)}</button>
        `;

        const segBtnNum = (group, value, label, active) => `
            <button class="ppt-design-spec-seg-btn ${active ? 'active' : ''}" type="button"
                data-action="${group}" data-size="${Number(value)}">${this._escapeHtml(label)}</button>
        `;

        return `
            <div class="ppt-design-spec">
                <div class="ppt-design-spec-header">
                    <div class="ppt-design-spec-title">
                        <iconify-icon icon="carbon:color-palette"></iconify-icon>
                        <span>Design Spec</span>
                    </div>
                    <div class="ppt-design-spec-subtitle">配置色板/字体/密度/批量与模型，并实时预览</div>
                </div>

                <div class="ppt-design-spec-grid">
                    <div class="ppt-design-spec-section">
                        <div class="ppt-design-spec-section-title">Colors</div>
                        <div class="ppt-design-spec-colors">
                            ${colorRow('primary', 'Primary', primary)}
                            ${colorRow('secondary', 'Secondary', secondary)}
                            ${colorRow('bg', 'Background', bg)}
                            ${colorRow('text', 'Text', text)}
                            ${colorRow('accent', 'Accent', accent)}
                        </div>
                    </div>

                    <div class="ppt-design-spec-section">
                        <div class="ppt-design-spec-section-title">Typography</div>
                        <div class="ppt-design-spec-form">
                            <label class="ppt-design-spec-field">
                                <span>Title Font</span>
                                <input id="pptDesignFont-titleFont" class="ppt-input-field" value="${this._escapeAttr(titleFont)}"
                                    data-action="updateDesignSystemFont" data-event="input" data-key="titleFont">
                            </label>
                            <label class="ppt-design-spec-field">
                                <span>Body Font</span>
                                <input id="pptDesignFont-bodyFont" class="ppt-input-field" value="${this._escapeAttr(bodyFont)}"
                                    data-action="updateDesignSystemFont" data-event="input" data-key="bodyFont">
                            </label>
                            <label class="ppt-design-spec-field">
                                <span>Font Size</span>
                                <input id="pptDesignFont-fontSize" class="ppt-input-field" type="number" min="10" max="60" step="1"
                                    value="${this._escapeAttr(String(fontSize))}"
                                    data-action="updateDesignSystemFontSize" data-event="input">
                            </label>
                        </div>
                    </div>

                    <div class="ppt-design-spec-section">
                        <div class="ppt-design-spec-section-title">Visual Preference</div>
                        <div class="ppt-design-spec-seg">
                            ${segBtn('updateVisualPreferenceMode', 'ai-first', 'AI-first', visualMode === 'ai-first')}
                            ${segBtn('updateVisualPreferenceMode', 'svg-first', 'SVG-first', visualMode === 'svg-first')}
                            ${segBtn('updateVisualPreferenceMode', 'balanced', 'Balanced', visualMode === 'balanced')}
                        </div>

                        <div class="ppt-design-spec-row">
                            <label>Refiner (ReAct)</label>
                            <div class="ppt-design-spec-toggle">
                                <button data-action="updateRefineEnabled" data-enabled="false" class="ppt-design-spec-seg-btn ${!refineEnabled ? 'active' : ''}">关闭</button>
                                <button data-action="updateRefineEnabled" data-enabled="true" class="ppt-design-spec-seg-btn ${refineEnabled ? 'active' : ''}">启用</button>
                            </div>
                        </div>
                    </div>

                    <div class="ppt-design-spec-section">
                        <div class="ppt-design-spec-section-title">Density</div>
                        <div class="ppt-design-spec-seg">
                            ${segBtn('updateDesignSystemDensity', 'compact', 'Compact', density === 'compact')}
                            ${segBtn('updateDesignSystemDensity', 'balanced', 'Balanced', density === 'balanced')}
                            ${segBtn('updateDesignSystemDensity', 'spacious', 'Spacious', density === 'spacious')}
                        </div>

                        <div class="ppt-design-spec-section-title" style="margin-top: 14px;">Batch Size</div>
                        <div class="ppt-design-spec-seg">
                            ${segBtnNum('updateBatchSize', 1, '1', batchSize === 1)}
                            ${segBtnNum('updateBatchSize', 2, '2', batchSize === 2)}
                            ${segBtnNum('updateBatchSize', 4, '4', batchSize === 4)}
                        </div>

                        <div class="ppt-design-spec-section-title" style="margin-top: 14px;">Model</div>
                        <select id="pptDesignModel" class="ppt-input-field" data-action="updateDesignSystemModel" data-event="change">
                            ${modelOptions.map(o => `
                                <option value="${this._escapeAttr(o.value)}" ${o.value === selectedModel ? 'selected' : ''}>
                                    ${this._escapeHtml(o.label)}
                                </option>
                            `).join('')}
                        </select>
                    </div>

                    <div class="ppt-design-spec-preview" data-density="${this._escapeAttr(density)}"
                        style="--ds-bg:${this._escapeAttr(bg)}; --ds-text:${this._escapeAttr(text)}; --ds-primary:${this._escapeAttr(primary)}; --ds-secondary:${this._escapeAttr(secondary)}; --ds-accent:${this._escapeAttr(accent)}; padding:${densityPad}px;">
                        <div class="ppt-design-spec-preview-card">
                            <div class="ppt-design-spec-preview-title" style="font-family:${this._escapeAttr(titleFont)}; font-size:${Math.round(fontSize * 1.7)}px;">
                                Preview Title
                            </div>
                            <div class="ppt-design-spec-preview-body" style="font-family:${this._escapeAttr(bodyFont)}; font-size:${this._escapeAttr(String(fontSize))}px;">
                                这是正文预览。Primary/Accent 用于强调信息与按钮。
                            </div>
                            <div class="ppt-design-spec-preview-tags">
                                <span class="ppt-design-spec-tag primary">Primary</span>
                                <span class="ppt-design-spec-tag secondary">Secondary</span>
                                <span class="ppt-design-spec-tag accent">Accent</span>
                            </div>
                        </div>
                    </div>
                </div>

                ${this._renderStyleReferenceSection()}
            </div>
        `;
    },


    _renderStyleReferenceSection() {
        const ds = this._ensureDesignSpecInitialized();
        const sr = ds.styleReference || { images: [], extracted: null, userNotes: '' };
        const images = sr.images || [];
        const extracted = sr.extracted || {};
        const notes = sr.userNotes || '';

        const hasExtracted = extracted.colorTone || extracted.mood || extracted.layoutStyle || extracted.typography || extracted.effects;

        const imageList = images.map(img => `
            <div class="ppt-style-ref-thumb ${img.status === StyleReferenceStatus.ANALYZING ? 'analyzing' : ''}" data-ref-id="${this._escapeAttr(img.id)}">
                <img src="${this._escapeAttr(img.thumbnail)}" alt="参考图">
                ${img.status === StyleReferenceStatus.ANALYZING ? '<div class="ppt-style-ref-loading"><iconify-icon icon="carbon:loading"></iconify-icon></div>' : ''}
                ${img.status === StyleReferenceStatus.ERROR ? '<div class="ppt-style-ref-error"><iconify-icon icon="carbon:warning-alt"></iconify-icon></div>' : ''}
                <button class="ppt-style-ref-remove" data-action="removeStyleReference" data-id="${this._escapeAttr(img.id)}" title="删除">
                    <iconify-icon icon="carbon:close"></iconify-icon>
                </button>
            </div>
        `).join('');

        const extractedFields = hasExtracted ? `
            <div class="ppt-style-ref-extracted">
                ${extracted.colorTone ? `<div class="ppt-style-ref-field"><span class="label">色调</span><span class="value">${this._escapeHtml(extracted.colorTone)}</span></div>` : ''}
                ${extracted.mood ? `<div class="ppt-style-ref-field"><span class="label">氛围</span><span class="value">${this._escapeHtml(extracted.mood)}</span></div>` : ''}
                ${extracted.layoutStyle ? `<div class="ppt-style-ref-field"><span class="label">布局</span><span class="value">${this._escapeHtml(extracted.layoutStyle)}</span></div>` : ''}
                ${extracted.typography ? `<div class="ppt-style-ref-field"><span class="label">字体</span><span class="value">${this._escapeHtml(extracted.typography)}</span></div>` : ''}
                ${extracted.effects ? `<div class="ppt-style-ref-field"><span class="label">效果</span><span class="value">${this._escapeHtml(extracted.effects)}</span></div>` : ''}
                ${extracted.palette?.length ? `
                    <div class="ppt-style-ref-field">
                        <span class="label">色板</span>
                        <div class="ppt-style-ref-palette">
                            ${extracted.palette.map(c => `<div class="ppt-style-ref-swatch" style="background:${this._escapeAttr(c)}" title="${this._escapeAttr(c)}"></div>`).join('')}
                        </div>
                    </div>
                ` : ''}
            </div>
        ` : '';

        return `
            <div class="ppt-style-ref-section">
                <div class="ppt-style-ref-header">
                    <div class="ppt-style-ref-title">
                        <iconify-icon icon="carbon:image-reference"></iconify-icon>
                        <span>风格参考</span>
                    </div>
                    <div class="ppt-style-ref-subtitle">上传参考图，AI 自动提取风格（最多 3 张）</div>
                </div>

                <div class="ppt-style-ref-body">
                    <div class="ppt-style-ref-upload" id="pptStyleRefDropzone">
                        <iconify-icon icon="carbon:cloud-upload"></iconify-icon>
                        <span>拖拽图片到此处，或点击上传</span>
                        <input type="file" id="pptStyleRefInput" accept="image/*" style="display:none">
                    </div>

                    ${images.length > 0 ? `
                        <div class="ppt-style-ref-thumbs">
                            ${imageList}
                        </div>
                    ` : ''}

                    ${extractedFields}

                    <div class="ppt-style-ref-notes">
                        <label>
                            <span>备注（可选）</span>
                            <textarea id="pptStyleRefNotes" class="ppt-input-field" rows="2"
                                placeholder="例如：参考 Apple 发布会风格"
                                data-action="updateStyleReferenceNotes" data-event="change">${this._escapeHtml(notes)}</textarea>
                        </label>
                    </div>
                </div>
            </div>
        `;
    },

  });

})();
