/**
 * 元素选择模式模块
 * 支持点击画布选中矢量元素，多选，选中状态视觉反馈
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

function parseSvgMeta(svgString) {
    if (!svgString) return null;

    const widthMatch = svgString.match(/width="([^"]+)"/);
    const heightMatch = svgString.match(/height="([^"]+)"/);
    const viewBoxMatch = svgString.match(/viewBox="([^"]+)"/);

    const width = widthMatch ? widthMatch[1] : null;
    const height = heightMatch ? heightMatch[1] : null;
    const viewBox = viewBoxMatch ? viewBoxMatch[1] : null;

    return { width, height, viewBox };
}

function parseViewBox(viewBox, fallbackWidth = 100, fallbackHeight = 100) {
    let minX = 0;
    let minY = 0;
    let vbWidth = fallbackWidth;
    let vbHeight = fallbackHeight;

    if (viewBox) {
        const parts = viewBox.split(/[\s,]+/).map(parseFloat);
        if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
            [minX, minY, vbWidth, vbHeight] = parts;
        }
    }

    return { minX, minY, width: vbWidth, height: vbHeight };
}

function buildSvgFromElements(elements, meta) {
    const width = meta?.width || '100%';
    const height = meta?.height || '100%';
    const viewBox = meta?.viewBox || `0 0 ${meta?.viewBoxWidth || 100} ${meta?.viewBoxHeight || 100}`;

    const paths = (elements || [])
        .map((el) => `<path d="${el.pathD}" fill="${el.color || '#000'}" fill-rule="evenodd"/>`)
        .join('');

    return `<svg xmlns="${SVG_NS}" width="${width}" height="${height}" viewBox="${viewBox}">${paths}</svg>`;
}

/**
 * 元素选择模式 Mixin
 * 支持点击画布选中矢量元素，多选，选中状态视觉反馈
 */
export const ElementSelectMixin = {
    // 状态（实例构造函数中会覆盖，避免共享引用）
    elementSelectMode: false,
    _selectedElements: new Set(), // 存储选中元素 ID
    _elementOverlay: null,
    _elementSelectLayerId: null,
    _marqueeState: null, // { startX, startY, currentX, currentY }
    _marqueeBox: null, // DOM 元素
    _suppressEmptyClickOnce: false,

    // 进入/退出元素选择模式
    _enterElementSelectMode(layer) {
        if (!layer) return;

        // 与路径点选删除互斥
        if (this.pathSelectMode) {
            this.pathSelectMode = false;
            this._setupPathSelection?.(null);
        }

        this.elementSelectMode = true;
        this._elementSelectLayerId = layer.id || null;
        if (!this._selectedElements) this._selectedElements = new Set();
        this._selectedElements.clear();

        this._createElementOverlay(layer);
        this._updatePropertyPanel?.();
    },

    _exitElementSelectMode() {
        // 避免退出模式时遗留全局拖拽监听
        this._endTransform?.();

        this.elementSelectMode = false;
        this._elementSelectLayerId = null;
        this._clearElementSelection();
        this._cleanupMarquee?.();

        if (this._elementOverlay) {
            if (this._elementOverlay._cleanup) this._elementOverlay._cleanup();
            this._elementOverlay.remove();
        }
        this._elementOverlay = null;

        this._updatePropertyPanel?.();
    },

    // 创建可点击的元素覆盖层
    _createElementOverlay(layer) {
        const svgContainer = this.container?.querySelector('.image-editor-svg-container');
        if (!svgContainer) return;

        if (this._elementOverlay) {
            if (this._elementOverlay._cleanup) this._elementOverlay._cleanup();
            this._elementOverlay.remove();
            this._elementOverlay = null;
        }
        this._cleanupMarquee?.();

        const elements = Array.isArray(layer?.elements) ? layer.elements : [];
        if (elements.length === 0) return;

        // 优先从子图层 svg 读取 meta（更贴近实际渲染）
        const anyChildSvg = layer.children?.find?.((c) => c?.svg)?.svg || elements[0]?.svg || '';
        const meta = parseSvgMeta(anyChildSvg) || {};
        const fallbackW = this.canvas?.width || 100;
        const fallbackH = this.canvas?.height || 100;
        const vb = parseViewBox(meta.viewBox, fallbackW, fallbackH);

        const overlay = document.createElement('div');
        overlay.className = 'element-select-overlay';
        overlay.style.cssText =
            'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:all;z-index:200;';

        const svgWrapper = document.createElement('div');
        svgWrapper.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;';
        overlay.appendChild(svgWrapper);

        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('xmlns', SVG_NS);
        svg.setAttribute('width', meta.width || '100%');
        svg.setAttribute('height', meta.height || '100%');
        svg.setAttribute('viewBox', meta.viewBox || `0 0 ${vb.width} ${vb.height}`);
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        svg.style.cssText = 'width:100%;height:100%;display:block;';
        svgWrapper.appendChild(svg);

        const elementMap = new Map();
        const hitPathMap = new Map();

        elements.forEach((element) => {
            if (!element?.id || !element?.pathD) return;
            elementMap.set(element.id, element);

            const hitPath = document.createElementNS(SVG_NS, 'path');
            hitPath.setAttribute('d', element.pathD);
            const tf = this._getElementTransformAttr?.(element);
            if (tf) hitPath.setAttribute('transform', tf);
            hitPath.setAttribute('fill', 'rgba(0,0,0,0.01)'); // 几乎透明但可点击
            hitPath.setAttribute('stroke', 'transparent');
            hitPath.setAttribute('stroke-width', '10'); // 增大点击区域
            hitPath.style.pointerEvents = 'all';
            hitPath.style.cursor = 'pointer';
            hitPath.dataset.elementId = element.id;

            hitPath.addEventListener('click', (e) => {
                e.stopPropagation();
                this._onElementClick(e, element);
            });
            hitPath.addEventListener('mousedown', (e) => e.stopPropagation());
            hitPath.addEventListener('mouseenter', () => this._onElementHover(element, true));
            hitPath.addEventListener('mouseleave', () => this._onElementHover(element, false));

            svg.appendChild(hitPath);
            hitPathMap.set(element.id, hitPath);
        });

        // 点击空白处清空选择（不支持 Ctrl/Cmd 保留）
        svg.addEventListener('click', (e) => {
            if (this._suppressEmptyClickOnce) {
                this._suppressEmptyClickOnce = false;
                return;
            }
            if (e.target !== svg) return;
            this._clearElementSelection();
            this._updateSelectionVisual();
            this._updatePropertyPanel?.();
        });

        // 提供坐标映射：viewBox -> wrapper px（用于选框绘制）
        const getViewportTransform = () => {
            const wrapperWidth = svgWrapper.offsetWidth || 1;
            const wrapperHeight = svgWrapper.offsetHeight || 1;
            const svgRatio = vb.width / vb.height;
            const wrapperRatio = wrapperWidth / wrapperHeight;

            let renderWidth, renderHeight, offsetX, offsetY;
            if (wrapperRatio > svgRatio) {
                renderHeight = wrapperHeight;
                renderWidth = renderHeight * svgRatio;
                offsetX = (wrapperWidth - renderWidth) / 2;
                offsetY = 0;
            } else {
                renderWidth = wrapperWidth;
                renderHeight = renderWidth / svgRatio;
                offsetX = 0;
                offsetY = (wrapperHeight - renderHeight) / 2;
            }

            return { renderWidth, renderHeight, offsetX, offsetY };
        };

        overlay._toPxRect = (bounds) => {
            if (!bounds) return null;
            const { renderWidth, renderHeight, offsetX, offsetY } = getViewportTransform();
            const toPxX = (x) => ((x - vb.minX) / vb.width) * renderWidth + offsetX;
            const toPxY = (y) => ((y - vb.minY) / vb.height) * renderHeight + offsetY;
            const left = toPxX(bounds.minX);
            const top = toPxY(bounds.minY);
            const right = toPxX(bounds.maxX);
            const bottom = toPxY(bounds.maxY);
            return {
                left: Math.min(left, right),
                top: Math.min(top, bottom),
                width: Math.abs(right - left),
                height: Math.abs(bottom - top)
            };
        };

        overlay._elementMap = elementMap;
        overlay._hitPathMap = hitPathMap;
        overlay._svgWrapper = svgWrapper;
        overlay._viewBox = vb;
        overlay._getViewportTransform = getViewportTransform;

        // 变换事件委托（handles / selection box）
        const onOverlayMouseDown = (e) => {
            if (!this.elementSelectMode) return;
            if (!this._elementOverlay || this._elementOverlay !== overlay) return;
            if (!this._startTransform) return;

            const target = e.target;
            if (!(target instanceof HTMLElement)) return;

            const elementId = target.dataset?.elementId;
            if (!elementId) return;

            const element = overlay._elementMap?.get(elementId);
            if (!element) return;

            if (target.classList.contains('element-transform-handle')) {
                const handle = target.dataset.handle;
                if (handle) this._startTransform(element, `scale-${handle}`, e);
                return;
            }

            if (target.classList.contains('element-rotate-handle')) {
                this._startTransform(element, 'rotate', e);
                return;
            }

            if (target.classList.contains('element-selection-box')) {
                this._startTransform(element, 'move', e);
            }
        };

        // 框选（点击空白处拖拽）
        const onMarqueeMouseDown = (e) => {
            if (!this.elementSelectMode) return;
            if (!this._elementOverlay || this._elementOverlay !== overlay) return;
            if (e.button !== 0) return;
            if (e.target !== svg) return;
            this._startMarquee?.(e);
        };

        overlay.addEventListener('mousedown', onOverlayMouseDown);
        overlay.addEventListener('mousedown', onMarqueeMouseDown);

        // 清理函数
        overlay._cleanup = () => {
            overlay.removeEventListener('mousedown', onOverlayMouseDown);
            overlay.removeEventListener('mousedown', onMarqueeMouseDown);
            this._cleanupMarquee?.();
        };

        svgContainer.appendChild(overlay);
        this._elementOverlay = overlay;

        // 初始渲染选框
        this._updateSelectionVisual();
    },

    // 元素点击处理
    _onElementClick(e, element) {
        if (!element?.id) return;

        if (e.ctrlKey || e.metaKey) {
            this._toggleElementSelection(element);
        } else {
            this._selectElement(element);
        }

        this._updateSelectionVisual();
        this._updatePropertyPanel?.();
    },

    // 元素悬停处理
    _onElementHover(element, isEnter) {
        if (!element?.id) return;
        if (!this._elementOverlay?._hitPathMap) return;

        if (this._selectedElements?.has?.(element.id)) return;

        const hitPath = this._elementOverlay._hitPathMap.get(element.id);
        if (!hitPath) return;

        if (isEnter) {
            hitPath.style.fill = 'rgba(79,70,229,0.08)';
            hitPath.style.stroke = '#4f46e5';
            hitPath.style.strokeWidth = '2';
        } else {
            hitPath.style.fill = 'rgba(0,0,0,0.01)';
            hitPath.style.stroke = 'transparent';
            hitPath.style.strokeWidth = '10';
        }
    },

    // 选择操作
    _selectElement(element) {
        if (!element?.id) return;
        if (!this._selectedElements) this._selectedElements = new Set();
        this._selectedElements.clear();
        this._selectedElements.add(element.id);
    },

    _toggleElementSelection(element) {
        if (!element?.id) return;
        if (!this._selectedElements) this._selectedElements = new Set();

        if (this._selectedElements.has(element.id)) {
            this._selectedElements.delete(element.id);
        } else {
            this._selectedElements.add(element.id);
        }
    },

    _clearElementSelection() {
        if (!this._selectedElements) this._selectedElements = new Set();
        this._selectedElements.clear();
        this._removeSelectionBoxes();
    },

    // 选中状态视觉
    _updateSelectionVisual() {
        if (!this._elementOverlay) return;

        this._removeSelectionBoxes();

        const ids = Array.from(this._selectedElements || []);
        for (const id of ids) {
            const element = this._elementOverlay?._elementMap?.get(id);
            if (element) this._drawSelectionBox(element);
        }
    },

    _drawSelectionBox(element) {
        if (!this._elementOverlay?._toPxRect) return;

        const bounds =
            element.bounds ||
            (this._getPathBounds ? this._getPathBounds(element.pathD) : null);
        const rect = this._elementOverlay._toPxRect(bounds);
        if (!rect) return;

        const box = document.createElement('div');
        box.className = 'element-selection-box';
        box.dataset.elementId = element.id;
        box.style.cssText = `
            position:absolute;
            left:${rect.left}px;
            top:${rect.top}px;
            width:${rect.width}px;
            height:${rect.height}px;
            border:2px solid #4f46e5;
            box-sizing:border-box;
            pointer-events:all;
            background:transparent;
            cursor:move;
            z-index:260;
        `;

        const handles = [
            { position: 'nw', cursor: 'nw-resize', x: 0, y: 0 },
            { position: 'n', cursor: 'n-resize', x: 0.5, y: 0 },
            { position: 'ne', cursor: 'ne-resize', x: 1, y: 0 },
            { position: 'e', cursor: 'e-resize', x: 1, y: 0.5 },
            { position: 'se', cursor: 'se-resize', x: 1, y: 1 },
            { position: 's', cursor: 's-resize', x: 0.5, y: 1 },
            { position: 'sw', cursor: 'sw-resize', x: 0, y: 1 },
            { position: 'w', cursor: 'w-resize', x: 0, y: 0.5 }
        ];

        handles.forEach((h) => {
            const handle = document.createElement('div');
            handle.className = 'element-transform-handle';
            handle.dataset.handle = h.position;
            handle.dataset.elementId = element.id;
            handle.style.cssText = `
                position:absolute;
                width:8px;
                height:8px;
                background:#ffffff;
                border:1px solid #4f46e5;
                border-radius:2px;
                left:${h.x * 100}%;
                top:${h.y * 100}%;
                transform:translate(-50%,-50%);
                pointer-events:all;
                cursor:${h.cursor};
                z-index:261;
            `;
            box.appendChild(handle);
        });

        // 旋转手柄（顶部中心上方 20px）
        const rotateHandle = document.createElement('div');
        rotateHandle.className = 'element-rotate-handle';
        rotateHandle.dataset.handle = 'rotate';
        rotateHandle.dataset.elementId = element.id;
        rotateHandle.style.cssText = `
            position:absolute;
            width:8px;
            height:8px;
            background:#ffffff;
            border:1px solid #4f46e5;
            border-radius:2px;
            left:50%;
            top:-20px;
            transform:translate(-50%,-50%);
            pointer-events:all;
            cursor:grab;
            z-index:261;
        `;
        box.appendChild(rotateHandle);

        this._elementOverlay.appendChild(box);
    },

    _removeSelectionBoxes() {
        if (!this._elementOverlay) return;
        this._elementOverlay.querySelectorAll('.element-selection-box').forEach((el) => el.remove());
    },

    _cleanupMarquee() {
        if (this._marqueeBox) {
            this._marqueeBox.remove();
            this._marqueeBox = null;
        }
        if (this._marqueeState?._onMove) {
            window.removeEventListener('mousemove', this._marqueeState._onMove);
        }
        if (this._marqueeState?._onUp) {
            window.removeEventListener('mouseup', this._marqueeState._onUp);
        }
        this._marqueeState = null;
    },

    _startMarquee(e) {
        if (!this._elementOverlay) return;
        if (this._marqueeState) return;

        e.preventDefault();

        this._marqueeState = {
            startX: e.clientX,
            startY: e.clientY,
            currentX: e.clientX,
            currentY: e.clientY,
            _onMove: (ev) => this._updateMarquee(ev),
            _onUp: (ev) => this._endMarquee(ev)
        };

        const box = document.createElement('div');
        box.className = 'element-marquee-box';
        box.style.cssText = `
            border: 1px dashed #4f46e5;
            background: rgba(79, 70, 229, 0.1);
            pointer-events: none;
            position: absolute;
            left: 0;
            top: 0;
            width: 0;
            height: 0;
            z-index: 255;
        `;
        this._elementOverlay.appendChild(box);
        this._marqueeBox = box;

        window.addEventListener('mousemove', this._marqueeState._onMove);
        window.addEventListener('mouseup', this._marqueeState._onUp);

        this._updateMarquee(e);
    },

    _updateMarquee(e) {
        if (!this._marqueeState || !this._marqueeBox || !this._elementOverlay) return;

        e.preventDefault();

        this._marqueeState.currentX = e.clientX;
        this._marqueeState.currentY = e.clientY;

        const overlayRect = this._elementOverlay.getBoundingClientRect();
        const x1 = this._marqueeState.startX - overlayRect.left;
        const y1 = this._marqueeState.startY - overlayRect.top;
        const x2 = this._marqueeState.currentX - overlayRect.left;
        const y2 = this._marqueeState.currentY - overlayRect.top;

        const left = Math.min(x1, x2);
        const top = Math.min(y1, y2);
        const width = Math.abs(x2 - x1);
        const height = Math.abs(y2 - y1);

        this._marqueeBox.style.left = `${left}px`;
        this._marqueeBox.style.top = `${top}px`;
        this._marqueeBox.style.width = `${width}px`;
        this._marqueeBox.style.height = `${height}px`;
    },

    _endMarquee(e) {
        if (!this._marqueeState || !this._elementOverlay) return;

        e.preventDefault();

        const { startX, startY, currentX, currentY, _onMove, _onUp } = this._marqueeState;
        window.removeEventListener('mousemove', _onMove);
        window.removeEventListener('mouseup', _onUp);

        const p1 = this._screenToViewBox(startX, startY);
        const p2 = this._screenToViewBox(currentX, currentY);
        const rect = {
            left: Math.min(p1.x, p2.x),
            right: Math.max(p1.x, p2.x),
            top: Math.min(p1.y, p2.y),
            bottom: Math.max(p1.y, p2.y)
        };

        const overlayElements = this._elementOverlay?._elementMap
            ? Array.from(this._elementOverlay._elementMap.values())
            : [];

        const idsInRect = overlayElements
            .filter((el) => this._elementIntersectsRect(el, rect))
            .map((el) => el.id)
            .filter(Boolean);

        if (!(e.ctrlKey || e.metaKey)) {
            this._clearElementSelection();
        }

        if (!this._selectedElements) this._selectedElements = new Set();
        idsInRect.forEach((id) => this._selectedElements.add(id));

        if (this._marqueeBox) this._marqueeBox.remove();
        this._marqueeBox = null;
        this._marqueeState = null;

        // 避免 mouseup 后触发空白 click 清空选择
        this._suppressEmptyClickOnce = true;
        setTimeout(() => {
            this._suppressEmptyClickOnce = false;
        }, 0);

        this._updateSelectionVisual();
        this._updatePropertyPanel?.();
    },

    _screenToViewBox(screenX, screenY) {
        const overlay = this._elementOverlay;
        const svgWrapper = overlay?._svgWrapper;
        const vb = overlay?._viewBox;
        const getViewportTransform = overlay?._getViewportTransform;

        if (!overlay || !svgWrapper || !vb || !getViewportTransform) return { x: 0, y: 0 };

        const wrapperRect = svgWrapper.getBoundingClientRect();
        const pxX = screenX - wrapperRect.left;
        const pxY = screenY - wrapperRect.top;

        const { renderWidth, renderHeight, offsetX, offsetY } = getViewportTransform();
        if (!renderWidth || !renderHeight) return { x: vb.minX, y: vb.minY };

        const xInRender = pxX - offsetX;
        const yInRender = pxY - offsetY;

        return {
            x: vb.minX + (xInRender / renderWidth) * vb.width,
            y: vb.minY + (yInRender / renderHeight) * vb.height
        };
    },

    _elementIntersectsRect(element, rect) {
        const bounds =
            element?.bounds ||
            (element?.pathD && this._getPathBounds ? this._getPathBounds(element.pathD) : null);
        if (!bounds) return false;
        return !(
            bounds.maxX < rect.left ||
            bounds.minX > rect.right ||
            bounds.maxY < rect.top ||
            bounds.minY > rect.bottom
        );
    },

    // 获取选中的元素
    _getSelectedElements() {
        const layerId = this._elementSelectLayerId;
        const layer = layerId
            ? this.processedImage?.layers?.find?.((l) => l.id === layerId)
            : null;
        const elements = Array.isArray(layer?.elements) ? layer.elements : [];
        const selectedIds = new Set(this._selectedElements || []);
        return elements.filter((e) => selectedIds.has(e.id));
    },

    // 键盘 Delete：删除选中元素（更新 group.elements 和子图层 svg）
    _deleteSelectedElements() {
        if (!this.elementSelectMode) return;
        const layerId = this._elementSelectLayerId;
        const layer = layerId
            ? this.processedImage?.layers?.find?.((l) => l.id === layerId)
            : null;
        if (!layer || !Array.isArray(layer.elements) || layer.elements.length === 0) return;

        const selected = new Set(this._selectedElements || []);
        if (selected.size === 0) return;

        if (selected.size >= layer.elements.length) {
            this._showToast?.('不能删除全部元素');
            return;
        }

        const remaining = layer.elements.filter((el) => !selected.has(el.id));
        layer.elements = remaining;

        // 更新子图层的 elements & svg（按颜色）
        const childSvgSource = layer.children?.find?.((c) => c?.svg)?.svg || '';
        const baseMeta = parseSvgMeta(childSvgSource) || {};
        const vb = parseViewBox(baseMeta.viewBox, this.canvas?.width || 100, this.canvas?.height || 100);
        const rebuildMeta = {
            width: baseMeta.width || '100%',
            height: baseMeta.height || '100%',
            viewBox: baseMeta.viewBox || `0 0 ${vb.width} ${vb.height}`,
            viewBoxWidth: vb.width,
            viewBoxHeight: vb.height
        };

        if (Array.isArray(layer.children)) {
            layer.children = layer.children
                .map((child) => {
                    if (child?.type !== 'vector') return child;
                    const color = child.color;
                    const childElements = remaining.filter((e) => (e.color || '') === (color || ''));
                    child.elements = childElements;
                    if (childElements.length === 0) return null;
                    const newSvg = buildSvgFromElements(childElements, rebuildMeta);
                    child.svg = newSvg;
                    child.originalSvg = newSvg;
                    return child;
                })
                .filter(Boolean);
        }

        // 删除后清空选择，避免 render 时绘制旧选框
        this._selectedElements?.clear?.();

        this._saveHistory?.();
        this._render?.();
        this._updatePropertyPanel?.();
    }
};
