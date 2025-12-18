/**
 * LayerEditor 属性面板模块
 * 从 layer-editor.js 拆分出的属性面板方法
 */

import { AVAILABLE_FONTS, loadFontCSS } from './text-overlay.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function identityMatrix() {
    return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

function normalizeMatrix(m) {
    if (!m) return identityMatrix();
    const a = Number(m.a), b = Number(m.b), c = Number(m.c), d = Number(m.d), e = Number(m.e), f = Number(m.f);
    if (![a, b, c, d, e, f].every(Number.isFinite)) return identityMatrix();
    return { a, b, c, d, e, f };
}

// m1 * m2
function multiplyMatrix(m1, m2) {
    return {
        a: m1.a * m2.a + m1.c * m2.b,
        b: m1.b * m2.a + m1.d * m2.b,
        c: m1.a * m2.c + m1.c * m2.d,
        d: m1.b * m2.c + m1.d * m2.d,
        e: m1.a * m2.e + m1.c * m2.f + m1.e,
        f: m1.b * m2.e + m1.d * m2.f + m1.f
    };
}

function matrixFromTranslate(dx, dy) {
    return { a: 1, b: 0, c: 0, d: 1, e: dx, f: dy };
}

function matrixFromScale(sx, sy) {
    return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
}

function matrixFromRotateDeg(deg) {
    const rad = (deg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}

function matrixAboutPoint(baseMatrix, px, py) {
    // T(px,py) * base * T(-px,-py)
    const t1 = matrixFromTranslate(px, py);
    const t2 = matrixFromTranslate(-px, -py);
    return multiplyMatrix(multiplyMatrix(t1, baseMatrix), t2);
}

function matrixToSvgString(m) {
    const fmt = (n) => (Math.abs(n) < 1e-10 ? 0 : Number(n.toFixed(6)));
    const mm = normalizeMatrix(m);
    return `matrix(${fmt(mm.a)} ${fmt(mm.b)} ${fmt(mm.c)} ${fmt(mm.d)} ${fmt(mm.e)} ${fmt(mm.f)})`;
}

function parseSvgMeta(svgString) {
    if (!svgString) return {};
    const widthMatch = svgString.match(/width="([^"]+)"/);
    const heightMatch = svgString.match(/height="([^"]+)"/);
    const viewBoxMatch = svgString.match(/viewBox="([^"]+)"/);
    return {
        width: widthMatch ? widthMatch[1] : '100%',
        height: heightMatch ? heightMatch[1] : '100%',
        viewBox: viewBoxMatch ? viewBoxMatch[1] : null
    };
}

function buildSvgFromElementsWithTransforms(elements, meta) {
    const width = meta?.width || '100%';
    const height = meta?.height || '100%';
    const viewBox = meta?.viewBox || `0 0 ${meta?.viewBoxWidth || 100} ${meta?.viewBoxHeight || 100}`;

    const parts = [];
    for (const el of elements || []) {
        if (!el?.pathD) continue;
        const fill = el.color || '#000';
        const matrix = normalizeMatrix(el?.transform?.matrix);
        const hasMatrix =
            !(matrix.a === 1 && matrix.b === 0 && matrix.c === 0 && matrix.d === 1 && matrix.e === 0 && matrix.f === 0);
        const gOpen = hasMatrix
            ? `<g data-element-id="${el.id || ''}" class="transform-wrapper" transform="${matrixToSvgString(matrix)}">`
            : `<g data-element-id="${el.id || ''}" class="transform-wrapper">`;
        parts.push(`${gOpen}<path d="${el.pathD}" fill="${fill}" fill-rule="evenodd"/></g>`);
    }

    return `<svg xmlns="${SVG_NS}" width="${width}" height="${height}" viewBox="${viewBox}">${parts.join('')}</svg>`;
}

/**
 * 属性面板 mixin
 */
export const PropertyPanelMixin = {
    /**
     * 更新属性面板
     */
    _updatePropertyPanel() {
        const panel = this.container.querySelector('.property-panel');
        if (!panel) return;
        
        // 无选中
        if (this.selectedLayerIndex < 0) {
            panel.innerHTML = '<div class="empty-state">选择一个图层以查看属性</div>';
            return;
        }
        
        const layer = this.processedImage.layers[this.selectedLayerIndex];
        if (!layer) {
            panel.innerHTML = '<div class="empty-state">图层不存在</div>';
            return;
        }
        
        // 检查是否多选
        const selectedChildren = this._getSelectedChildren?.() || [];
        if (selectedChildren.length > 1) {
            // 多选模式：显示批量操作面板
            this._renderMultiSelectPanel(panel, layer, selectedChildren);
            return;
        }
        
        // 如果选中了单个子图层
        if (this.selectedChildIndex >= 0 && layer.children) {
            const childLayer = layer.children[this.selectedChildIndex];
            if (childLayer) {
                this._renderChildLayerPanel(panel, layer, childLayer);
                return;
            }
        }
        
        // 渲染主图层属性
        this._renderMainLayerPanel(panel, layer);
    },

    /**
     * 渲染主图层属性面板
     */
    _renderMainLayerPanel(panel, layer) {
        if (layer.type === 'original') {
            this._renderOriginalLayerPanel(panel, layer);
        } else if (layer.type === 'group') {
            this._renderGroupLayerPanel(panel, layer);
        } else if (layer.type === 'vector') {
            this._renderVectorLayerPanel(panel, layer);
        } else {
            panel.innerHTML = '<div class="empty-state">未知图层类型</div>';
        }
    },

    /**
     * 渲染原始图层面板
     */
    _renderOriginalLayerPanel(panel, layer) {
        panel.innerHTML = `
            <div class="property-group">
                <div class="property-group-title">
                    <iconify-icon icon="carbon:image"></iconify-icon>
                    原始图片
                </div>
                <div class="property-row">
                    <span class="property-label">尺寸</span>
                    <span style="font-size:12px;color:var(--ie-text-secondary)">
                        ${this.canvas.width} × ${this.canvas.height}
                    </span>
                </div>
                <div class="property-row">
                    <span class="property-label">可见</span>
                    <input type="checkbox" ${layer.visible !== false ? 'checked' : ''} data-prop="visible">
                </div>
            </div>
            <div class="property-group">
                <div class="property-group-title">
                    <iconify-icon icon="carbon:magic-wand"></iconify-icon>
                    快速操作
                </div>
                <button class="btn-action" data-action="vectorize-from-panel">
                    <iconify-icon icon="carbon:data-vis-1"></iconify-icon>
                    矢量化
                </button>
                <button class="btn-action" data-action="ocr-from-panel">
                    <iconify-icon icon="carbon:scan-alt"></iconify-icon>
                    识别文字
                </button>
            </div>
        `;
        
        this._bindPropertyEvents(panel, layer);
    },

    /**
     * 渲染组图层面板
     */
    _renderGroupLayerPanel(panel, layer) {
        const isOcrGroup = layer.ocrGroup || layer.textOverlayConfig;
        const childCount = layer.children?.length || 0;
        const hasInpaintedBg = !!(layer.inpaintedBackground?.canvas);
        
        let content = `
            <div class="property-group">
                <div class="property-group-title">
                    <iconify-icon icon="${isOcrGroup ? 'carbon:text-recognition' : 'carbon:folder'}"></iconify-icon>
                    ${isOcrGroup ? '文字识别组' : '矢量组'}
                </div>
                <div class="property-row">
                    <span class="property-label">名称</span>
                    <input class="property-input" type="text" value="${layer.name || ''}" data-prop="name">
                </div>
                <div class="property-row">
                    <span class="property-label">子图层数</span>
                    <span style="font-size:12px;color:var(--ie-text-secondary)">${childCount}</span>
                </div>
                <div class="property-row">
                    <span class="property-label">可见</span>
                    <input type="checkbox" ${layer.visible !== false ? 'checked' : ''} data-prop="visible">
                </div>
            </div>
        `;
        
        // OCR 组特有操作
        if (isOcrGroup) {
            // 获取当前组的全局字体
            const globalFont = layer.globalFont || 'system-ui, sans-serif';
            const globalFontIndex = AVAILABLE_FONTS.findIndex(f => f.value === globalFont);

            // 字号分类（当区域数 >= 6 时启用）
            const textChildren = (layer.children || []).filter(c => c.type === 'text-overlay' && c.visible !== false);
            const fontSizes = textChildren.map(c => c.style?.fontSize || 14);
            const showSizeCategories = textChildren.length >= 6;

            let sizeCategories = null;
            if (showSizeCategories && fontSizes.length > 0) {
                sizeCategories = this._classifyFontSizes(fontSizes, textChildren);
            }

            content += `
                <div class="property-group">
                    <div class="property-group-title">
                        <iconify-icon icon="carbon:text-font"></iconify-icon>
                        全局字体样式
                    </div>
                    <div class="property-row">
                        <span class="property-label">统一字体</span>
                        <select class="property-select" data-group-action="global-font" style="width:120px;">
                            ${AVAILABLE_FONTS.map((f, idx) => `<option value="${idx}" ${idx === globalFontIndex || (globalFontIndex < 0 && idx === 0) ? 'selected' : ''}>${f.name}</option>`).join('')}
                            <option value="local">系统字体...</option>
                            <option value="custom" ${layer.globalFont && globalFontIndex < 0 ? 'selected' : ''}>手动输入...</option>
                        </select>
                    </div>
                    <div class="property-row" id="local-font-row" style="display:none;">
                        <span class="property-label">系统字体</span>
                        <select class="property-select" data-group-action="local-font-select" style="width:120px;">
                            <option value="">加载中...</option>
                        </select>
                    </div>
                    <div class="property-row" id="custom-font-row" style="display:${layer.globalFont && globalFontIndex < 0 ? 'flex' : 'none'};">
                        <span class="property-label">字体名称</span>
                        <input type="text" class="property-input" data-group-action="custom-font-name"
                               placeholder="如: Arial, 微软雅黑" value="${layer.globalFont && globalFontIndex < 0 ? layer.globalFont : ''}" style="width:120px;">
                    </div>
                    <button class="btn-action" data-group-action="apply-global-font" style="margin-top:4px;">
                        <iconify-icon icon="carbon:checkmark"></iconify-icon>
                        应用到所有区域
                    </button>
                </div>
            `;

            // 字号分类管理（当区域数 >= 6 时显示）
            if (showSizeCategories && sizeCategories) {
                content += `
                    <div class="property-group">
                        <div class="property-group-title">
                            <iconify-icon icon="carbon:text-scale"></iconify-icon>
                            字号分类管理
                        </div>
                        <div style="font-size:11px;color:var(--ie-text-secondary);margin-bottom:8px;">
                            共 ${textChildren.length} 个区域，按字号自动分为大/中/小三类
                        </div>
                        ${sizeCategories.large.count > 0 ? `
                        <div class="property-row">
                            <span class="property-label">大字体 (${sizeCategories.large.count}个)</span>
                            <input type="number" class="property-input" value="${sizeCategories.large.avgSize}"
                                   data-size-category="large" style="width:60px;" min="8" max="200">
                        </div>
                        ` : ''}
                        ${sizeCategories.medium.count > 0 ? `
                        <div class="property-row">
                            <span class="property-label">中字体 (${sizeCategories.medium.count}个)</span>
                            <input type="number" class="property-input" value="${sizeCategories.medium.avgSize}"
                                   data-size-category="medium" style="width:60px;" min="8" max="200">
                        </div>
                        ` : ''}
                        ${sizeCategories.small.count > 0 ? `
                        <div class="property-row">
                            <span class="property-label">小字体 (${sizeCategories.small.count}个)</span>
                            <input type="number" class="property-input" value="${sizeCategories.small.avgSize}"
                                   data-size-category="small" style="width:60px;" min="8" max="200">
                        </div>
                        ` : ''}
                        <button class="btn-action" data-group-action="apply-size-categories" style="margin-top:8px;">
                            <iconify-icon icon="carbon:checkmark"></iconify-icon>
                            应用字号分类
                        </button>
                        <button class="btn-action" data-group-action="auto-optimize-sizes" style="margin-top:4px;">
                            <iconify-icon icon="carbon:magic-wand"></iconify-icon>
                            智能优化字号
                        </button>
                    </div>
                `;
            }

            // 遮罩背景控制（如果有 inpainted background）
            if (hasInpaintedBg) {
                content += `
                    <div class="property-group">
                        <div class="property-group-title">
                            <iconify-icon icon="carbon:view"></iconify-icon>
                            遮罩背景
                        </div>
                        <div class="property-row">
                            <span class="property-label">显示去文字底图</span>
                            <input type="checkbox" ${layer.showInpaintedBg !== false ? 'checked' : ''} data-group-action="toggle-inpaint-bg">
                        </div>
                        <div style="font-size:11px;color:var(--ie-text-secondary);margin-top:4px;padding:0 4px;">
                            开启后使用已清除文字的底图，关闭则使用原图
                        </div>
                    </div>
                `;
            }
            
            content += `
                <div class="property-group">
                    <div class="property-group-title">
                        <iconify-icon icon="carbon:translate"></iconify-icon>
                        批量操作
                    </div>
                    <button class="btn-action" data-group-action="translate-all">
                        <iconify-icon icon="carbon:language"></iconify-icon>
                        翻译所有文字
                    </button>
                    <button class="btn-action" data-group-action="inpaint-all">
                        <iconify-icon icon="carbon:erase"></iconify-icon>
                        去除所有原文字
                    </button>
                    <button class="btn-action" data-group-action="export-overlay">
                        <iconify-icon icon="carbon:export"></iconify-icon>
                        导出带文字图片
                    </button>
                    <button class="btn-action" data-group-action="add-region">
                        <iconify-icon icon="carbon:add"></iconify-icon>
                        手动添加区域
                    </button>
                    ${hasInpaintedBg ? `
                    <button class="btn-action" data-group-action="vectorize-clean" style="background:linear-gradient(135deg,#10b981,#059669);color:#fff;">
                        <iconify-icon icon="carbon:chart-venn-diagram"></iconify-icon>
                        使用去文字底图矢量化
                    </button>
                    ` : ''}
                </div>
            `;
        } else {
            // 矢量组操作
            const elementCount = Array.isArray(layer.elements) ? layer.elements.length : 0;
            content += `
                <div class="property-group">
                    <div class="property-group-title">
                        <iconify-icon icon="carbon:settings-adjust"></iconify-icon>
                        矢量操作
                    </div>
                    <div class="property-row block">
                        <span class="property-label">全局简化</span>
                        <div class="range-wrap">
                            <input type="range" class="range-input" min="0" max="100" value="${layer.simplifyLevel || 0}" data-group-action="simplify">
                            <span class="range-value">${layer.simplifyLevel || 0}</span>
                        </div>
                    </div>
                    <button class="btn-action" data-group-action="re-vectorize">
                        <iconify-icon icon="carbon:reset"></iconify-icon>
                        重新矢量化
                    </button>
                </div>

                <div class="property-group">
                    <div class="property-group-title">
                        <iconify-icon icon="carbon:select-01"></iconify-icon>
                        元素选择
                    </div>
                    <button class="btn-action" data-group-action="toggle-element-select" ${elementCount <= 0 ? 'disabled' : ''}>
                        <iconify-icon icon="carbon:touch-1"></iconify-icon>
                        ${this.elementSelectMode ? '退出元素选择' : '元素选择模式'}
                    </button>
                    <small style="font-size:11px;color:var(--ie-text-secondary);margin-top:4px">
                        点击画布上的矢量元素进行选中（支持 Ctrl/Cmd 多选）${elementCount > 0 ? ` · ${elementCount} 个元素` : ''}
                    </small>
                </div>

                <div data-slot="element-property-panel"></div>
            `;
        }
        
        // 删除按钮
        content += `
            <div class="property-group">
                <button class="btn-action danger" data-action="delete-layer">
                    <iconify-icon icon="carbon:trash-can"></iconify-icon>
                    删除此组
                </button>
            </div>
        `;
        
        panel.innerHTML = content;
        this._bindPropertyEvents(panel, layer);
        this._bindGroupPropertyEvents(panel, layer);

        // 元素选择模式下，渲染元素属性（可编辑）
        if (!isOcrGroup && this.elementSelectMode) {
            const selectedEls = this._getSelectedElements?.() || [];
            this._renderElementPropertyPanel(panel, selectedEls);
        }
    },

    /**
     * 渲染元素属性面板（元素选择模式）
     * @param {HTMLElement} panel
     * @param {Array} elements
     */
    _renderElementPropertyPanel(panel, elements) {
        const slot = panel?.querySelector?.('[data-slot="element-property-panel"]');
        if (!slot) return;

        if (!this.elementSelectMode) {
            slot.innerHTML = '';
            return;
        }

        const selected = Array.isArray(elements) ? elements.filter(Boolean) : [];
        if (selected.length === 0) {
            slot.innerHTML = `
                <div class="property-group">
                    <div class="property-group-title">
                        <iconify-icon icon="carbon:cursor-1"></iconify-icon>
                        元素属性
                    </div>
                    <small style="font-size:11px;color:var(--ie-text-secondary);margin-top:4px">
                        未选中元素
                    </small>
                </div>
            `;
            return;
        }

        selected.forEach((el) => this._ensureElementTransform?.(el));

        const common = (getter, equals = (a, b) => a === b) => {
            const first = getter(selected[0]);
            for (let i = 1; i < selected.length; i++) {
                if (!equals(first, getter(selected[i]))) return null;
            }
            return first;
        };
        const numEq = (a, b) => Math.abs(Number(a) - Number(b)) < 1e-6;

        const commonName = common((el) => (el?.name ?? ''), (a, b) => String(a) === String(b));
        const nameValue = commonName === null ? '' : String(commonName || '');

        const firstColor = this._toHexColor?.(selected[0]?.color) || '#000000';
        const commonColor = common((el) => this._toHexColor?.(el?.color) || '', (a, b) => String(a).toLowerCase() === String(b).toLowerCase());
        const colorValue = commonColor === null ? firstColor : (commonColor || firstColor);

        const tx = common((el) => Number(el?.transform?.translate?.x || 0), numEq);
        const ty = common((el) => Number(el?.transform?.translate?.y || 0), numEq);
        const sx = common((el) => Number(el?.transform?.scale?.x || 1), numEq);
        const sy = common((el) => Number(el?.transform?.scale?.y || 1), numEq);
        const rot = common((el) => Number(el?.transform?.rotate || 0), numEq);

        const fmt = (n, fallback = '') => (Number.isFinite(n) ? String(Math.round(n * 100) / 100) : fallback);
        const fmtPct = (n, fallback = '') => (Number.isFinite(n) ? String(Math.round(n * 10000) / 100) : fallback);

        slot.innerHTML = `
            <div class="property-group">
                <div class="property-group-title">
                    <iconify-icon icon="carbon:cursor-1"></iconify-icon>
                    元素属性 ${selected.length > 1 ? `(${selected.length} 个)` : ''}
                </div>
                <div class="property-row">
                    <span class="property-label">名称</span>
                    <input class="property-input" type="text" value="${nameValue.replace(/"/g, '&quot;')}"
                        ${selected.length > 1 ? 'placeholder="（多选）将同时修改"' : ''}
                        data-element-prop="name">
                </div>
                <div class="property-row">
                    <span class="property-label">颜色</span>
                    <input type="color" value="${colorValue}" data-element-prop="color">
                </div>
            </div>

            <div class="property-group">
                <div class="property-group-title">
                    <iconify-icon icon="carbon:transform"></iconify-icon>
                    变换参数
                </div>
                <div class="property-row">
                    <span class="property-label">平移 X</span>
                    <input class="property-input" type="number" step="1" value="${tx === null ? '' : fmt(tx, '0')}" data-transform-prop="translateX">
                </div>
                <div class="property-row">
                    <span class="property-label">平移 Y</span>
                    <input class="property-input" type="number" step="1" value="${ty === null ? '' : fmt(ty, '0')}" data-transform-prop="translateY">
                </div>
                <div class="property-row">
                    <span class="property-label">缩放 X %</span>
                    <input class="property-input" type="number" step="1" min="1" value="${sx === null ? '' : fmtPct(sx * 100, '100')}" data-transform-prop="scaleX">
                </div>
                <div class="property-row">
                    <span class="property-label">缩放 Y %</span>
                    <input class="property-input" type="number" step="1" min="1" value="${sy === null ? '' : fmtPct(sy * 100, '100')}" data-transform-prop="scaleY">
                </div>
                <div class="property-row">
                    <span class="property-label">旋转 °</span>
                    <input class="property-input" type="number" step="1" value="${rot === null ? '' : fmt(rot, '0')}" data-transform-prop="rotate">
                </div>
                ${selected.length > 1 ? `
                <small style="font-size:11px;color:var(--ie-text-secondary);margin-top:4px">
                    多选时输入会批量应用到所有选中元素
                </small>` : ''}
            </div>

            <div class="property-group">
                <div class="property-group-title">
                    <iconify-icon icon="carbon:operations-field"></iconify-icon>
                    操作
                </div>
                <button class="btn-action danger" data-element-action="delete">
                    <iconify-icon icon="carbon:trash-can"></iconify-icon>
                    删除
                </button>
                <button class="btn-action" data-element-action="copy">
                    <iconify-icon icon="carbon:copy"></iconify-icon>
                    复制
                </button>
                <button class="btn-action" data-element-action="reset-transform">
                    <iconify-icon icon="carbon:reset"></iconify-icon>
                    重置变换
                </button>
            </div>
        `;

        this._bindElementPropertyEvents(slot, selected);
    },

    _bindElementPropertyEvents(container, elements) {
        if (!container) return;
        const selected = Array.isArray(elements) ? elements.filter(Boolean) : [];
        if (selected.length === 0) return;

        // 名称
        container.querySelector('[data-element-prop="name"]')?.addEventListener('change', (e) => {
            const value = e.target.value || '';
            selected.forEach((el) => {
                el.name = value;
            });
            this._saveHistory?.();
            this._updatePropertyPanel?.();
        });

        // 颜色
        container.querySelector('[data-element-prop="color"]')?.addEventListener('change', (e) => {
            const newColor = e.target.value;
            selected.forEach((el) => this._onElementColorChange(el, newColor, { saveHistory: false, render: false }));
            this._render?.();
            this._saveHistory?.();
            this._updatePropertyPanel?.();
        });

        // 变换输入（input：实时更新；change：落历史）
        const transformInputs = container.querySelectorAll('[data-transform-prop]');
        let inputTimer = null;
        const applyBatch = (prop, value, saveHistory, refreshPanel) => {
            selected.forEach((el) => this._onTransformInputChange(el, prop, value, { saveHistory: false }));
            if (saveHistory) this._saveHistory?.();
            if (refreshPanel) this._updatePropertyPanel?.();
        };
        transformInputs.forEach((input) => {
            const prop = input.dataset.transformProp;
            input.addEventListener('input', (e) => {
                clearTimeout(inputTimer);
                const value = e.target.value;
                inputTimer = setTimeout(() => applyBatch(prop, value, false, false), 50);
            });
            input.addEventListener('change', (e) => {
                clearTimeout(inputTimer);
                applyBatch(prop, e.target.value, true, true);
            });
        });

        // 删除
        container.querySelector('[data-element-action="delete"]')?.addEventListener('click', () => {
            this._deleteElementsFromPanel?.(selected);
        });

        // 复制
        container.querySelector('[data-element-action="copy"]')?.addEventListener('click', () => {
            this._copyElementsFromPanel?.(selected);
        });

        // 重置变换
        container.querySelector('[data-element-action="reset-transform"]')?.addEventListener('click', () => {
            this._resetElementsTransformFromPanel?.(selected);
        });
    },

    _getElementSelectGroupLayer() {
        const layerId = this._elementSelectLayerId;
        const layer = layerId
            ? this.processedImage?.layers?.find?.((l) => l?.id === layerId)
            : this.processedImage?.layers?.[this.selectedLayerIndex];
        return layer?.type === 'group' ? layer : null;
    },

    _rebuildVectorGroupChildren(groupLayer) {
        if (!groupLayer || groupLayer.type !== 'group') return;
        if (!Array.isArray(groupLayer.elements)) groupLayer.elements = [];
        if (!Array.isArray(groupLayer.children)) groupLayer.children = [];

        const baseSvg = groupLayer.children?.find?.((c) => c?.type === 'vector' && c?.svg)?.svg || groupLayer.elements?.[0]?.svg || '';
        const meta = parseSvgMeta(baseSvg);
        const fallbackW = this.canvas?.width || 100;
        const fallbackH = this.canvas?.height || 100;
        const vb = meta.viewBox || `0 0 ${fallbackW} ${fallbackH}`;
        const rebuildMeta = { ...meta, viewBox: vb, viewBoxWidth: fallbackW, viewBoxHeight: fallbackH };

        const byColor = new Map();
        for (const el of groupLayer.elements) {
            if (!el?.id || !el?.pathD) continue;
            const color = el.color || '#000000';
            if (!byColor.has(color)) byColor.set(color, []);
            byColor.get(color).push(el);
        }

        const existingVectorChildren = (groupLayer.children || []).filter((c) => c?.type === 'vector');
        const otherChildren = (groupLayer.children || []).filter((c) => c?.type !== 'vector');
        const existingByColor = new Map(existingVectorChildren.map((c) => [c.color || '', c]));

        const newVectorChildren = [];
        for (const [color, els] of byColor.entries()) {
            const existing = existingByColor.get(color) || null;
            const child = existing || {
                id: `vec_${groupLayer.id || 'group'}_${Date.now()}_${Math.random().toString(16).slice(2)}`,
                type: 'vector',
                name: `颜色 ${color}`,
                visible: true,
                vectorGroupId: groupLayer.id || null,
                parentId: groupLayer.id || null,
                color
            };
            child.type = 'vector';
            child.color = color;
            child.visible = child.visible !== false;
            child.vectorGroupId = groupLayer.id || child.vectorGroupId || null;
            child.parentId = groupLayer.id || child.parentId || null;
            child.elements = els;
            child.svg = buildSvgFromElementsWithTransforms(els, rebuildMeta);
            child.originalSvg = child.svg;
            child.simplifyLevel = 0;
            newVectorChildren.push(child);
        }

        groupLayer.children = [...newVectorChildren, ...otherChildren];

        // 重建后简化状态失效
        if (typeof groupLayer.simplifyLevel === 'number' && groupLayer.simplifyLevel !== 0) {
            groupLayer.simplifyLevel = 0;
        }
    },

    _syncElementToLayer(element) {
        const groupLayer = this._getElementSelectGroupLayer();
        if (!groupLayer) return;
        if (!Array.isArray(groupLayer.elements)) groupLayer.elements = [];

        const idx = groupLayer.elements.findIndex((el) => el?.id && el.id === element?.id);
        if (idx >= 0) groupLayer.elements[idx] = element;
        else groupLayer.elements.push(element);

        this._rebuildVectorGroupChildren(groupLayer);
        this._updateLayerList?.();
    },

    _onElementColorChange(element, newColor, options = {}) {
        if (!element) return;
        element.color = newColor;

        // 更新 SVG 中的 fill（element.svg 作为缓存）
        if (element.svg) {
            try {
                const parser = new DOMParser();
                const doc = parser.parseFromString(element.svg, 'image/svg+xml');
                const paths = doc.querySelectorAll('path');
                paths.forEach((p) => p.setAttribute('fill', newColor));
                element.svg = new XMLSerializer().serializeToString(doc.documentElement);
            } catch (err) {
                // ignore
            }
        }

        // 同步更新到父图层
        this._syncElementToLayer(element);

        if (options.render !== false) this._render?.();
        if (options.saveHistory !== false) this._saveHistory?.();
    },

    _composeElementTransformMatrix(element) {
        if (!element) return;
        this._ensureElementTransform?.(element);
        const t = element.transform || {};

        const tx = Number(t?.translate?.x || 0);
        const ty = Number(t?.translate?.y || 0);
        const sx = Math.max(0.1, Number(t?.scale?.x || 1));
        const sy = Math.max(0.1, Number(t?.scale?.y || 1));
        const rot = Number(t?.rotate || 0);

        const origin = (() => {
            const ox = Number(t?.origin?.x);
            const oy = Number(t?.origin?.y);
            if (Number.isFinite(ox) && Number.isFinite(oy)) return { x: ox, y: oy };
            const b = element.bounds || (this._getPathBounds ? this._getPathBounds(element.pathD) : null);
            if (b) return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
            return { x: 0, y: 0 };
        })();

        t.origin = { ...origin };
        t.scale = { x: sx, y: sy };
        t.translate = { x: tx, y: ty };
        t.rotate = rot;

        const mScale = matrixAboutPoint(matrixFromScale(sx, sy), origin.x, origin.y);
        const mRotate = matrixAboutPoint(matrixFromRotateDeg(rot), origin.x, origin.y);
        const mTranslate = matrixFromTranslate(tx, ty);
        t.matrix = multiplyMatrix(mTranslate, multiplyMatrix(mRotate, mScale));

        element.transform = t;
    },

    _onTransformInputChange(element, prop, value, options = {}) {
        if (!element) return;
        this._ensureElementTransform?.(element);

        const t = element.transform;
        switch (prop) {
            case 'translateX':
                t.translate.x = parseFloat(value) || 0;
                break;
            case 'translateY':
                t.translate.y = parseFloat(value) || 0;
                break;
            case 'scaleX':
                t.scale.x = Math.max(0.1, (parseFloat(value) || 100) / 100);
                break;
            case 'scaleY':
                t.scale.y = Math.max(0.1, (parseFloat(value) || 100) / 100);
                break;
            case 'rotate':
                t.rotate = parseFloat(value) || 0;
                break;
        }

        this._composeElementTransformMatrix(element);
        this._applyTransformToElement?.(element);
        this._updateSelectionVisual?.();

        if (options.saveHistory !== false) this._saveHistory?.();
    },

    _deleteElementsFromPanel(elements) {
        const groupLayer = this._getElementSelectGroupLayer();
        if (!groupLayer || !Array.isArray(groupLayer.elements)) return;

        const ids = new Set((elements || []).map((e) => e?.id).filter(Boolean));
        if (ids.size === 0) return;

        if (ids.size >= groupLayer.elements.length) {
            this._showToast?.('不能删除全部元素');
            return;
        }

        groupLayer.elements = groupLayer.elements.filter((el) => !ids.has(el?.id));
        ids.forEach((id) => this._selectedElements?.delete?.(id));

        this._rebuildVectorGroupChildren(groupLayer);
        this._saveHistory?.();
        this._render?.();
        this._updateSelectionVisual?.();
        this._updatePropertyPanel?.();
    },

    _copyElementsFromPanel(elements) {
        const groupLayer = this._getElementSelectGroupLayer();
        if (!groupLayer || !Array.isArray(groupLayer.elements)) return;

        const selected = (elements || []).filter((e) => e?.id && e?.pathD);
        if (selected.length === 0) return;

        const newIds = [];
        for (const el of selected) {
            const copy = JSON.parse(JSON.stringify(el));
            copy.id = `el_${Date.now()}_${Math.random().toString(16).slice(2)}`;
            copy.name = el.name ? `${el.name} 副本` : `元素副本`;

            this._ensureElementTransform?.(copy);
            copy.transform.translate.x = Number(copy.transform.translate.x || 0) + 10;
            copy.transform.translate.y = Number(copy.transform.translate.y || 0) + 10;
            this._composeElementTransformMatrix(copy);

            // 同步 element.svg（缓存）
            if (copy.svg) {
                try {
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(copy.svg, 'image/svg+xml');
                    const svg = doc.documentElement;
                    let g = svg.querySelector('g.transform-wrapper');
                    if (!g) {
                        g = document.createElementNS(SVG_NS, 'g');
                        g.classList.add('transform-wrapper');
                        while (svg.firstChild) g.appendChild(svg.firstChild);
                        svg.appendChild(g);
                    }
                    g.setAttribute('transform', matrixToSvgString(normalizeMatrix(copy.transform.matrix)));
                    copy.svg = new XMLSerializer().serializeToString(svg);
                } catch (err) {
                    // ignore
                }
            }

            groupLayer.elements.push(copy);
            newIds.push(copy.id);
        }

        this._rebuildVectorGroupChildren(groupLayer);

        if (this._selectedElements) {
            this._selectedElements.clear();
            newIds.forEach((id) => this._selectedElements.add(id));
        }

        this._saveHistory?.();
        this._render?.();
        this._updateSelectionVisual?.();
        this._updatePropertyPanel?.();
    },

    _resetElementsTransformFromPanel(elements) {
        const groupLayer = this._getElementSelectGroupLayer();
        if (!groupLayer || !Array.isArray(groupLayer.elements)) return;

        const selected = (elements || []).filter((e) => e?.id);
        if (selected.length === 0) return;

        selected.forEach((el) => {
            el.transform = {
                matrix: identityMatrix(),
                translate: { x: 0, y: 0 },
                scale: { x: 1, y: 1 },
                rotate: 0,
                origin: { x: 0, y: 0 }
            };

            // 重置 bounds 为原始 path bounds（避免选框漂移）
            const b = this._getPathBounds ? this._getPathBounds(el.pathD) : null;
            if (b) el.bounds = b;

            // 同步 element.svg（缓存）
            if (el.svg) {
                try {
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(el.svg, 'image/svg+xml');
                    const svg = doc.documentElement;
                    const g = svg.querySelector('g.transform-wrapper');
                    if (g) g.removeAttribute('transform');
                    el.svg = new XMLSerializer().serializeToString(svg);
                } catch (err) {
                    // ignore
                }
            }
        });

        this._rebuildVectorGroupChildren(groupLayer);
        this._saveHistory?.();
        this._render?.();
        this._updateSelectionVisual?.();
        this._updatePropertyPanel?.();
    },

    /**
     * 渲染矢量图层面板
     */
    _renderVectorLayerPanel(panel, layer) {
        const hexColor = this._toHexColor(layer.color);
        
        panel.innerHTML = `
            <div class="property-group">
                <div class="property-group-title">
                    <iconify-icon icon="carbon:shape"></iconify-icon>
                    矢量图层
                </div>
                <div class="property-row">
                    <span class="property-label">名称</span>
                    <input class="property-input" type="text" value="${layer.name || ''}" data-prop="name">
                </div>
                <div class="property-row">
                    <span class="property-label">颜色</span>
                    <input type="color" value="${hexColor}" data-prop="color">
                </div>
                <div class="property-row">
                    <span class="property-label">可见</span>
                    <input type="checkbox" ${layer.visible !== false ? 'checked' : ''} data-prop="visible">
                </div>
            </div>
            <div class="property-group">
                <button class="btn-action danger" data-action="delete-layer">
                    <iconify-icon icon="carbon:trash-can"></iconify-icon>
                    删除图层
                </button>
            </div>
        `;
        
        this._bindPropertyEvents(panel, layer);
    },

    /**
     * 绑定属性面板事件
     */
    _bindPropertyEvents(panel, layer) {
        // 名称
        panel.querySelector('[data-prop="name"]')?.addEventListener('change', (e) => {
            layer.name = e.target.value;
            this._updateLayerList();
            this._saveHistory();
        });
        
        // 可见性
        panel.querySelector('[data-prop="visible"]')?.addEventListener('change', (e) => {
            layer.visible = e.target.checked;
            this._render();
        });
        
        // 颜色
        panel.querySelector('[data-prop="color"]')?.addEventListener('change', (e) => {
            layer.color = e.target.value;
            if (layer.svg) {
                layer.svg = layer.svg.replace(/fill="[^"]*"/g, `fill="${e.target.value}"`);
            }
            this._render();
            this._saveHistory();
        });
        
        // 删除图层
        panel.querySelector('[data-action="delete-layer"]')?.addEventListener('click', () => {
            this._deleteLayer(this.selectedLayerIndex);
        });
        
        // 从面板触发矢量化
        panel.querySelector('[data-action="vectorize-from-panel"]')?.addEventListener('click', () => {
            this._showVectorizePresetDialog();
        });
        
        // 从面板触发 OCR
        panel.querySelector('[data-action="ocr-from-panel"]')?.addEventListener('click', () => {
            this._runOcr();
        });
    },

    /**
     * 绑定组属性事件
     */
    _bindGroupPropertyEvents(panel, layer) {
        // 简化滑块
        const simplifySlider = panel.querySelector('[data-group-action="simplify"]');
        if (simplifySlider) {
            let timeout = null;
            simplifySlider.addEventListener('input', (e) => {
                const level = parseInt(e.target.value);
                e.target.nextElementSibling.textContent = level;
                
                clearTimeout(timeout);
                timeout = setTimeout(() => {
                    layer.simplifyLevel = level;
                    this._applySimplify(layer, level);
                }, 100);
            });
        }
        
        // 重新矢量化
        panel.querySelector('[data-group-action="re-vectorize"]')?.addEventListener('click', () => {
            this._reVectorize(layer);
        });
        
        // OCR 组操作
        panel.querySelector('[data-group-action="translate-all"]')?.addEventListener('click', () => {
            this._translateAllText(layer);
        });
        
        panel.querySelector('[data-group-action="inpaint-all"]')?.addEventListener('click', () => {
            this._inpaintAllRegions(layer);
        });
        
        panel.querySelector('[data-group-action="export-overlay"]')?.addEventListener('click', () => {
            this._exportWithTextOverlay(layer.id);
        });
        
        panel.querySelector('[data-group-action="add-region"]')?.addEventListener('click', () => {
            this._startDrawBbox(layer);
        });

        // 全局字体选择
        panel.querySelector('[data-group-action="global-font"]')?.addEventListener('change', async (e) => {
            const value = e.target.value;
            const customFontRow = panel.querySelector('#custom-font-row');
            const localFontRow = panel.querySelector('#local-font-row');

            // 隐藏所有额外行
            if (customFontRow) customFontRow.style.display = 'none';
            if (localFontRow) localFontRow.style.display = 'none';

            if (value === 'custom') {
                if (customFontRow) customFontRow.style.display = 'flex';
            } else if (value === 'local') {
                if (localFontRow) localFontRow.style.display = 'flex';
                // 加载系统字体
                await this._loadLocalFonts(panel.querySelector('[data-group-action="local-font-select"]'));
            } else {
                const fontIndex = parseInt(value);
                const fontDef = AVAILABLE_FONTS[fontIndex];
                if (fontDef) {
                    layer.globalFont = fontDef.value;
                }
            }
        });

        // 系统字体选择
        panel.querySelector('[data-group-action="local-font-select"]')?.addEventListener('change', (e) => {
            const fontFamily = e.target.value;
            if (fontFamily) {
                layer.globalFont = fontFamily;
            }
        });

        // 应用全局字体到所有区域
        panel.querySelector('[data-group-action="apply-global-font"]')?.addEventListener('click', async () => {
            const fontSelect = panel.querySelector('[data-group-action="global-font"]');
            const value = fontSelect?.value;
            let fontFamily = '';
            let fontName = '';

            if (value === 'custom') {
                // 手动输入字体
                const customInput = panel.querySelector('[data-group-action="custom-font-name"]');
                fontFamily = customInput?.value?.trim();
                if (!fontFamily) {
                    this._showToast('请输入字体名称');
                    return;
                }
                fontName = fontFamily;
            } else if (value === 'local') {
                // 系统字体
                const localSelect = panel.querySelector('[data-group-action="local-font-select"]');
                fontFamily = localSelect?.value;
                if (!fontFamily) {
                    this._showToast('请选择系统字体');
                    return;
                }
                fontName = fontFamily;
            } else {
                // 预设字体
                const fontIndex = parseInt(value || 0);
                const fontDef = AVAILABLE_FONTS[fontIndex];
                if (!fontDef) return;

                fontFamily = fontDef.value;
                fontName = fontDef.name;

                // 加载字体
                if (fontDef.css) {
                    this._showLoading('加载字体...');
                    await loadFontCSS(fontDef.css);
                    this._hideLoading();
                }
            }

            // 应用到所有子区域
            layer.globalFont = fontFamily;
            (layer.children || []).forEach(child => {
                if (child.type === 'text-overlay') {
                    child.style = child.style || {};
                    child.style.fontFamily = fontFamily;
                }
            });

            this._saveHistory();
            this._render();
            this._showToast(`已应用字体: ${fontName}`);
        });

        // 应用字号分类
        panel.querySelector('[data-group-action="apply-size-categories"]')?.addEventListener('click', () => {
            const textChildren = (layer.children || []).filter(c => c.type === 'text-overlay' && c.visible !== false);
            if (textChildren.length < 6) return;

            const sizeCategories = this._classifyFontSizes(
                textChildren.map(c => c.style?.fontSize || 14),
                textChildren
            );

            const largeSize = parseInt(panel.querySelector('[data-size-category="large"]')?.value) || sizeCategories.large.avgSize;
            const mediumSize = parseInt(panel.querySelector('[data-size-category="medium"]')?.value) || sizeCategories.medium.avgSize;
            const smallSize = parseInt(panel.querySelector('[data-size-category="small"]')?.value) || sizeCategories.small.avgSize;

            // 应用新字号
            sizeCategories.large.children.forEach(c => {
                c.style = c.style || {};
                c.style.fontSize = largeSize;
                c.style.customFontSize = true;
            });
            sizeCategories.medium.children.forEach(c => {
                c.style = c.style || {};
                c.style.fontSize = mediumSize;
                c.style.customFontSize = true;
            });
            sizeCategories.small.children.forEach(c => {
                c.style = c.style || {};
                c.style.fontSize = smallSize;
                c.style.customFontSize = true;
            });

            this._saveHistory();
            this._render();
            this._showToast('已应用字号分类');
        });

        // 智能优化字号
        panel.querySelector('[data-group-action="auto-optimize-sizes"]')?.addEventListener('click', () => {
            const textChildren = (layer.children || []).filter(c => c.type === 'text-overlay' && c.visible !== false);
            if (textChildren.length < 6) return;

            const sizeCategories = this._classifyFontSizes(
                textChildren.map(c => c.style?.fontSize || 14),
                textChildren
            );

            // 设计最佳实践：大字号是小字号的 1.5-2 倍，中字号居中
            const baseSize = Math.round(sizeCategories.small.avgSize);
            const optimizedSmall = Math.max(12, baseSize);
            const optimizedLarge = Math.round(optimizedSmall * 1.618); // 黄金比例
            const optimizedMedium = Math.round((optimizedSmall + optimizedLarge) / 2);

            // 应用优化后的字号
            sizeCategories.large.children.forEach(c => {
                c.style = c.style || {};
                c.style.fontSize = optimizedLarge;
                delete c.style.customFontSize;
            });
            sizeCategories.medium.children.forEach(c => {
                c.style = c.style || {};
                c.style.fontSize = optimizedMedium;
                delete c.style.customFontSize;
            });
            sizeCategories.small.children.forEach(c => {
                c.style = c.style || {};
                c.style.fontSize = optimizedSmall;
                delete c.style.customFontSize;
            });

            this._saveHistory();
            this._updatePropertyPanel();
            this._render();
            this._showToast(`已优化: 大${optimizedLarge} / 中${optimizedMedium} / 小${optimizedSmall}`);
        });
        
        // 切换 inpainted background 显示
        panel.querySelector('[data-group-action="toggle-inpaint-bg"]')?.addEventListener('change', (e) => {
            layer.showInpaintedBg = e.target.checked;
            this._render();
        });
        
        // 使用去文字底图矢量化
        panel.querySelector('[data-group-action="vectorize-clean"]')?.addEventListener('click', () => {
            if (layer.inpaintedBackground?.canvas) {
                this._showVectorizePresetDialog();
            } else {
                this._showToast('请先去除文字后再进行矢量化');
            }
        });

        // 元素选择模式
        panel.querySelector('[data-group-action="toggle-element-select"]')?.addEventListener('click', (e) => {
            if (e.target?.disabled) return;
            if (this.elementSelectMode) {
                this._exitElementSelectMode?.();
            } else {
                this._enterElementSelectMode?.(layer);
            }
        });
    },

    /**
     * 渲染子图层属性面板
     */
    _renderChildLayerPanel(panel, parentLayer, childLayer) {
        // 文字覆盖类型子图层
        if (childLayer.type === 'text-overlay') {
            this._renderTextOverlayChildPanel(panel, parentLayer, childLayer);
            return;
        }
        
        const pathCount = this._countPaths(childLayer.svg);
        const simplifyLevel = childLayer.simplifyLevel || 0;
        const hexColor = this._toHexColor(childLayer.color);
        
        let content = `
            <div class="property-group">
                <div class="property-group-title">
                    <iconify-icon icon="carbon:shape"></iconify-icon>
                    子图层属性
                </div>
                <div class="property-row">
                    <span class="property-label">名称</span>
                    <input class="property-input" type="text" value="${childLayer.name || '路径'}" data-child-prop="name">
                </div>
                <div class="property-row">
                    <span class="property-label">颜色</span>
                    <div style="display:flex;align-items:center;gap:8px;">
                        <input type="color" value="${hexColor}" data-child-prop="color" style="width:32px;height:24px;padding:0;border:none;">
                        <span style="font-size:12px;color:var(--ie-text-secondary)">${hexColor}</span>
                    </div>
                </div>
                <div class="property-row">
                    <span class="property-label">路径数量</span>
                    <span style="font-size:12px;color:var(--ie-text-secondary)">${pathCount}</span>
                </div>
                <div class="property-row">
                    <span class="property-label">可见</span>
                    <input type="checkbox" ${childLayer.visible !== false ? 'checked' : ''} data-child-prop="visible">
                </div>
            </div>
            
            <div class="property-group">
                <div class="property-group-title">
                    <iconify-icon icon="carbon:clean"></iconify-icon>
                    单图层路径简化
                </div>
                <div class="property-row block">
                    <span class="property-label">简化程度</span>
                    <div class="range-wrap">
                        <input type="range" class="range-input" min="0" max="100" value="${simplifyLevel}" data-child-action="simplify">
                        <span class="range-value">${simplifyLevel}</span>
                    </div>
                    <small style="font-size:11px;color:var(--ie-text-secondary);margin-top:-4px">值越大曲线越平滑，0=不简化</small>
                </div>
                <button class="btn-action" data-child-action="reset-simplify">
                    <iconify-icon icon="carbon:reset"></iconify-icon>
                    重置简化
                </button>
            </div>
            
            <div class="property-group">
                <div class="property-group-title">
                    <iconify-icon icon="carbon:select-01"></iconify-icon>
                    路径编辑
                </div>
                <button class="btn-action" data-child-action="explode-paths" ${pathCount <= 1 ? 'disabled' : ''}>
                    <iconify-icon icon="carbon:assembly-cluster"></iconify-icon>
                    炸开路径 (${pathCount} 个)
                </button>
                <small style="font-size:11px;color:var(--ie-text-secondary);margin-top:4px">
                    将多个路径拆分为独立图层，方便单独操作
                </small>
                <button class="btn-action" data-child-action="toggle-path-select" style="margin-top:8px">
                    <iconify-icon icon="carbon:touch-1"></iconify-icon>
                    ${this.pathSelectMode ? '退出路径选择' : '点选删除路径'}
                </button>
                <small style="font-size:11px;color:var(--ie-text-secondary);margin-top:4px">
                    点击画布上的路径可以删除单个形状
                </small>
            </div>
            
            <div class="property-group">
                <div class="property-group-title">
                    <iconify-icon icon="carbon:operations-field"></iconify-icon>
                    图层操作
                </div>
                <div style="display:flex;gap:8px;">
                    <button class="btn-action" data-child-action="move-up" style="flex:1" ${this.selectedChildIndex >= parentLayer.children.length - 1 ? 'disabled' : ''}>
                        <iconify-icon icon="carbon:arrow-up"></iconify-icon>
                        上移
                    </button>
                    <button class="btn-action" data-child-action="move-down" style="flex:1" ${this.selectedChildIndex <= 0 ? 'disabled' : ''}>
                        <iconify-icon icon="carbon:arrow-down"></iconify-icon>
                        下移
                    </button>
                </div>
                <button class="btn-action danger" data-child-action="delete" ${parentLayer.children.length <= 1 ? 'disabled' : ''}>
                    <iconify-icon icon="carbon:trash-can"></iconify-icon>
                    删除此图层
                </button>
            </div>
        `;
        
        panel.innerHTML = content;
        this._bindChildPropertyEvents(panel, parentLayer, childLayer);
    },

    /**
     * 绑定子图层属性事件
     */
    _bindChildPropertyEvents(panel, parentLayer, childLayer) {
        // 名称
        panel.querySelector('[data-child-prop="name"]')?.addEventListener('change', (e) => {
            childLayer.name = e.target.value;
            this._updateLayerList();
            this._saveHistory();
        });
        
        // 颜色
        panel.querySelector('[data-child-prop="color"]')?.addEventListener('change', (e) => {
            const newColor = e.target.value;
            childLayer.color = newColor;
            if (childLayer.svg) {
                childLayer.svg = childLayer.svg.replace(/fill="[^"]*"/g, `fill="${newColor}"`);
            }
            this._updateLayerList();
            this._render();
            this._saveHistory();
        });
        
        // 可见性
        panel.querySelector('[data-child-prop="visible"]')?.addEventListener('change', (e) => {
            childLayer.visible = e.target.checked;
            this._updateLayerList();
            this._render();
        });
        
        // 单图层简化滑块
        const simplifySlider = panel.querySelector('[data-child-action="simplify"]');
        if (simplifySlider) {
            let timeout = null;
            simplifySlider.addEventListener('input', (e) => {
                const level = parseInt(e.target.value);
                e.target.nextElementSibling.textContent = level;
                
                clearTimeout(timeout);
                timeout = setTimeout(() => {
                    this._applyChildSimplify(childLayer, level, parentLayer);
                }, 100);
            });
        }
        
        // 重置简化
        panel.querySelector('[data-child-action="reset-simplify"]')?.addEventListener('click', () => {
            if (childLayer.originalSvg) {
                childLayer.svg = childLayer.originalSvg;
                childLayer.simplifyLevel = 0;
                this._render();
                this._updatePropertyPanel();
                this._saveHistory();
            }
        });
        
        // 炸开路径
        const explodeBtn = panel.querySelector('[data-child-action="explode-paths"]');
        if (explodeBtn) {
            explodeBtn.addEventListener('click', (e) => {
                if (!e.target.disabled) {
                    this._explodeChildPaths(parentLayer, childLayer);
                }
            });
        }
        
        // 路径选择模式
        panel.querySelector('[data-child-action="toggle-path-select"]')?.addEventListener('click', () => {
            if (this.elementSelectMode) this._exitElementSelectMode?.();
            this.pathSelectMode = !this.pathSelectMode;
            this._updatePropertyPanel();
            this._setupPathSelection(childLayer);
        });
        
        // 上移/下移/删除
        panel.querySelector('[data-child-action="move-up"]')?.addEventListener('click', () => {
            this._moveChildLayer(this.selectedLayerIndex, this.selectedChildIndex, 1);
            this._updatePropertyPanel();
        });
        
        panel.querySelector('[data-child-action="move-down"]')?.addEventListener('click', () => {
            this._moveChildLayer(this.selectedLayerIndex, this.selectedChildIndex, -1);
            this._updatePropertyPanel();
        });
        
        panel.querySelector('[data-child-action="delete"]')?.addEventListener('click', () => {
            this._deleteChildLayer(this.selectedLayerIndex, this.selectedChildIndex);
        });
    },

    /**
     * 字号分类 - 将字号分为大/中/小三类
     * 使用 K-means 聚类算法（k=3）
     */
    _classifyFontSizes(fontSizes, children) {
        if (!fontSizes.length) {
            return {
                large: { children: [], avgSize: 24, count: 0 },
                medium: { children: [], avgSize: 16, count: 0 },
                small: { children: [], avgSize: 12, count: 0 }
            };
        }

        // 获取字号范围
        const sorted = [...fontSizes].sort((a, b) => a - b);
        const min = sorted[0];
        const max = sorted[sorted.length - 1];
        const range = max - min;

        // 如果所有字号相近（范围 < 6），都归为中等
        if (range < 6) {
            const avgSize = Math.round(fontSizes.reduce((a, b) => a + b, 0) / fontSizes.length);
            return {
                large: { children: [], avgSize: avgSize + 8, count: 0 },
                medium: { children: [...children], avgSize, count: children.length },
                small: { children: [], avgSize: Math.max(12, avgSize - 6), count: 0 }
            };
        }

        // 三分位数分类
        const q1 = sorted[Math.floor(sorted.length * 0.33)];
        const q2 = sorted[Math.floor(sorted.length * 0.67)];

        const result = {
            large: { children: [], sizes: [], avgSize: 0, count: 0 },
            medium: { children: [], sizes: [], avgSize: 0, count: 0 },
            small: { children: [], sizes: [], avgSize: 0, count: 0 }
        };

        fontSizes.forEach((size, idx) => {
            const child = children[idx];
            if (size > q2) {
                result.large.children.push(child);
                result.large.sizes.push(size);
            } else if (size >= q1) {
                result.medium.children.push(child);
                result.medium.sizes.push(size);
            } else {
                result.small.children.push(child);
                result.small.sizes.push(size);
            }
        });

        // 计算平均值
        ['large', 'medium', 'small'].forEach(cat => {
            const sizes = result[cat].sizes;
            result[cat].count = sizes.length;
            result[cat].avgSize = sizes.length > 0
                ? Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length)
                : (cat === 'large' ? 24 : cat === 'medium' ? 16 : 12);
            delete result[cat].sizes;
        });

        return result;
    },

    /**
     * 加载系统本地字体列表
     * 使用 Local Font Access API (需要用户授权)
     */
    async _loadLocalFonts(selectElement) {
        if (!selectElement) return;

        // 检查 API 是否可用
        if (!('queryLocalFonts' in window)) {
            selectElement.innerHTML = '<option value="">浏览器不支持获取系统字体</option>';
            this._showToast('请使用 Chrome/Edge 浏览器，或手动输入字体名');
            return;
        }

        try {
            // 请求字体访问权限
            const fonts = await window.queryLocalFonts();

            // 去重并按字体系列分组
            const fontFamilies = new Map();
            for (const font of fonts) {
                if (!fontFamilies.has(font.family)) {
                    fontFamilies.set(font.family, font.family);
                }
            }

            // 排序
            const sortedFamilies = [...fontFamilies.keys()].sort((a, b) => a.localeCompare(b, 'zh-CN'));

            // 更新下拉列表
            selectElement.innerHTML = '<option value="">请选择字体...</option>' +
                sortedFamilies.map(family => `<option value="${family}">${family}</option>`).join('');

            this._showToast(`已加载 ${sortedFamilies.length} 个系统字体`);
        } catch (err) {
            console.warn('[PropertyPanel] 获取系统字体失败:', err);
            if (err.name === 'NotAllowedError') {
                selectElement.innerHTML = '<option value="">已拒绝字体访问权限</option>';
                this._showToast('需要授权才能访问系统字体');
            } else {
                selectElement.innerHTML = '<option value="">获取字体失败</option>';
            }
        }
    }
};
