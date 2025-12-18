/**
 * 变换操作模块
 * 支持移动、缩放、旋转矢量元素（元素选择模式）
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const MIN_SCALE_FACTOR = 0.1;

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function deepClone(obj) {
    return obj ? JSON.parse(JSON.stringify(obj)) : obj;
}

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

function applyMatrixToPoint(m, x, y) {
    return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

function boundsFromPoints(points) {
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    return {
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY: Math.min(...ys),
        maxY: Math.max(...ys)
    };
}

function applyMatrixToBounds(bounds, m) {
    if (!bounds) return null;
    const corners = [
        { x: bounds.minX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.maxY },
        { x: bounds.minX, y: bounds.maxY }
    ].map((p) => applyMatrixToPoint(m, p.x, p.y));
    return boundsFromPoints(corners);
}

function matrixToSvgString(m) {
    // SVG matrix(a b c d e f)
    const fmt = (n) => (Math.abs(n) < 1e-10 ? 0 : Number(n.toFixed(6)));
    return `matrix(${fmt(m.a)} ${fmt(m.b)} ${fmt(m.c)} ${fmt(m.d)} ${fmt(m.e)} ${fmt(m.f)})`;
}

function decomposeMatrix(m) {
    // Best-effort decomposition into translate, rotate, scale (no skew support)
    const translate = { x: m.e, y: m.f };

    const scaleX = Math.hypot(m.a, m.b) || 1;
    const rotation = (Math.atan2(m.b, m.a) * 180) / Math.PI;

    const det = m.a * m.d - m.b * m.c;
    const scaleY = det / scaleX || 1;

    return {
        translate,
        rotate: rotation,
        scale: { x: Math.abs(scaleX), y: Math.abs(scaleY) }
    };
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
        const hasMatrix = !(matrix.a === 1 && matrix.b === 0 && matrix.c === 0 && matrix.d === 1 && matrix.e === 0 && matrix.f === 0);
        const gOpen = hasMatrix
            ? `<g data-element-id="${el.id || ''}" class="transform-wrapper" transform="${matrixToSvgString(matrix)}">`
            : `<g data-element-id="${el.id || ''}" class="transform-wrapper">`;
        parts.push(
            `${gOpen}<path d="${el.pathD}" fill="${fill}" fill-rule="evenodd"/></g>`
        );
    }

    return `<svg xmlns="${SVG_NS}" width="${width}" height="${height}" viewBox="${viewBox}">${parts.join('')}</svg>`;
}

/**
 * 变换操作 Mixin
 * 支持移动、缩放、旋转矢量元素
 */
export const TransformMixin = {
    // 变换状态（实例构造函数中会覆盖，避免共享引用）
    _transformState: null,

    _ensureElementTransform(element) {
        if (!element) return;
        if (!element.transform) element.transform = {};
        const t = element.transform;
        if (!t.matrix) t.matrix = identityMatrix();
        t.matrix = normalizeMatrix(t.matrix);

        const decomposed = decomposeMatrix(t.matrix);

        if (!t.translate || !Number.isFinite(t.translate.x) || !Number.isFinite(t.translate.y)) {
            t.translate = decomposed.translate;
        }
        if (!t.scale || !Number.isFinite(t.scale.x) || !Number.isFinite(t.scale.y)) {
            t.scale = decomposed.scale;
        }
        if (typeof t.rotate !== 'number' || !Number.isFinite(t.rotate)) {
            t.rotate = decomposed.rotate;
        }
        if (!t.origin) t.origin = { x: 0, y: 0 };
    },

    // 开始变换
    _startTransform(element, type, e) {
        if (!element || !type) return;
        e.preventDefault();
        e.stopPropagation();

        this._ensureElementTransform(element);

        const bounds = element.bounds || (this._getPathBounds ? this._getPathBounds(element.pathD) : null);
        if (!bounds) return;

        const center = {
            x: (bounds.minX + bounds.maxX) / 2,
            y: (bounds.minY + bounds.maxY) / 2
        };

        if (!this._boundTransformDrag) this._boundTransformDrag = this._onTransformDrag.bind(this);
        if (!this._boundTransformEnd) this._boundTransformEnd = this._endTransform.bind(this);

        this._transformState = {
            element,
            type, // 'move' | 'scale-nw' | ... | 'rotate'
            startMousePos: this._getCanvasCoords(e),
            startBounds: { ...bounds },
            startTransform: deepClone(element.transform),
            center,
            didChange: false
        };

        document.addEventListener('mousemove', this._boundTransformDrag);
        document.addEventListener('mouseup', this._boundTransformEnd);
    },

    // 处理变换拖拽
    _onTransformDrag(e) {
        if (!this._transformState) return;

        const { element, type, startMousePos, startBounds, startTransform, center } = this._transformState;
        const currentPos = this._getCanvasCoords(e);
        const dx = currentPos.x - startMousePos.x;
        const dy = currentPos.y - startMousePos.y;

        const startMatrix = normalizeMatrix(startTransform?.matrix);
        let deltaMatrix = identityMatrix();

        if (type === 'move') {
            if (dx !== 0 || dy !== 0) this._transformState.didChange = true;
            deltaMatrix = matrixFromTranslate(dx, dy);
        } else if (type === 'rotate') {
            const startAngle = Math.atan2(startMousePos.y - center.y, startMousePos.x - center.x);
            const currentAngle = Math.atan2(currentPos.y - center.y, currentPos.x - center.x);
            const deltaAngle = ((currentAngle - startAngle) * 180) / Math.PI;
            if (Math.abs(deltaAngle) > 1e-6) this._transformState.didChange = true;
            deltaMatrix = matrixAboutPoint(matrixFromRotateDeg(deltaAngle), center.x, center.y);
            element.transform.origin = { ...center };
        } else if (type.startsWith('scale-')) {
            const scaleInfo = this._calculateScale(dx, dy, type, startBounds);
            if (!scaleInfo) return;
            const { sx, sy, origin } = scaleInfo;
            if (Math.abs(sx - 1) > 1e-6 || Math.abs(sy - 1) > 1e-6) this._transformState.didChange = true;
            deltaMatrix = matrixAboutPoint(matrixFromScale(sx, sy), origin.x, origin.y);
            element.transform.origin = { ...origin };
        }

        const newMatrix = multiplyMatrix(deltaMatrix, startMatrix);
        element.transform.matrix = newMatrix;

        const decomposed = decomposeMatrix(newMatrix);
        element.transform.translate = decomposed.translate;
        element.transform.rotate = decomposed.rotate;
        element.transform.scale = {
            x: Math.max(MIN_SCALE_FACTOR, decomposed.scale.x),
            y: Math.max(MIN_SCALE_FACTOR, decomposed.scale.y)
        };

        // 更新 bounds（近似：对开始 bounds 做增量变换）
        const newBounds = applyMatrixToBounds(startBounds, deltaMatrix);
        if (newBounds) element.bounds = newBounds;

        this._applyTransformToElement(element);
        this._updateSelectionVisual?.();
    },

    // 结束变换
    _endTransform() {
        if (!this._transformState) return;

        document.removeEventListener('mousemove', this._boundTransformDrag);
        document.removeEventListener('mouseup', this._boundTransformEnd);

        const didChange = !!this._transformState.didChange;
        this._transformState = null;
        if (didChange) this._saveHistory?.();
        this._updatePropertyPanel?.();
    },

    // 应用变换到 SVG
    _applyTransformToElement(element) {
        if (!element) return;
        this._ensureElementTransform(element);

        // 1) 更新 element.svg（单元素 svg）
        if (element.svg) {
            try {
                const parser = new DOMParser();
                const doc = parser.parseFromString(element.svg, 'image/svg+xml');
                const svg = doc.documentElement;

                let g = svg.querySelector('g.transform-wrapper');
                if (!g) {
                    g = document.createElementNS(SVG_NS, 'g');
                    g.classList.add('transform-wrapper');
                    while (svg.firstChild) {
                        g.appendChild(svg.firstChild);
                    }
                    svg.appendChild(g);
                }

                g.setAttribute('transform', matrixToSvgString(normalizeMatrix(element.transform.matrix)));
                element.svg = new XMLSerializer().serializeToString(svg);
            } catch (err) {
                // ignore: element.svg 仅作为缓存，不影响主渲染
            }
        }

        // 2) 同步到所属 vector 子图层 svg（用于真实渲染/导出）
        const groupLayer = this._elementSelectLayerId
            ? this.processedImage?.layers?.find?.((l) => l?.id === this._elementSelectLayerId)
            : null;
        if (groupLayer?.type === 'group' && Array.isArray(groupLayer.children)) {
            const affectedChildren = groupLayer.children.filter(
                (c) => c?.type === 'vector' && Array.isArray(c.elements) && c.elements.some((el) => el?.id === element.id)
            );

            for (const child of affectedChildren) {
                const meta = parseSvgMeta(child.svg || '');
                const rebuilt = buildSvgFromElementsWithTransforms(child.elements || [], meta);
                child.svg = rebuilt;
                child.originalSvg = rebuilt;
                child.simplifyLevel = 0;
            }

            // 重建后，组级简化状态失效，避免 UI 显示与实际不一致
            if (typeof groupLayer.simplifyLevel === 'number' && groupLayer.simplifyLevel !== 0) {
                groupLayer.simplifyLevel = 0;
            }
        }

        this._render?.();
    },

    // 辅助方法：事件坐标 -> canvas 坐标
    _getCanvasCoords(e) {
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    },

    // 计算缩放（返回 scale 因子与缩放原点）
    _calculateScale(dx, dy, type, startBounds) {
        if (!startBounds) return null;

        const w = startBounds.maxX - startBounds.minX;
        const h = startBounds.maxY - startBounds.minY;
        if (w === 0 || h === 0) return null;

        const centerX = (startBounds.minX + startBounds.maxX) / 2;
        const centerY = (startBounds.minY + startBounds.maxY) / 2;

        const handle = type.replace('scale-', '');
        let newW = w;
        let newH = h;
        let origin = { x: centerX, y: centerY };

        switch (handle) {
            case 'se':
                newW = w + dx;
                newH = h + dy;
                origin = { x: startBounds.minX, y: startBounds.minY };
                break;
            case 'nw':
                newW = w - dx;
                newH = h - dy;
                origin = { x: startBounds.maxX, y: startBounds.maxY };
                break;
            case 'ne':
                newW = w + dx;
                newH = h - dy;
                origin = { x: startBounds.minX, y: startBounds.maxY };
                break;
            case 'sw':
                newW = w - dx;
                newH = h + dy;
                origin = { x: startBounds.maxX, y: startBounds.minY };
                break;
            case 'e':
                newW = w + dx;
                origin = { x: startBounds.minX, y: centerY };
                break;
            case 'w':
                newW = w - dx;
                origin = { x: startBounds.maxX, y: centerY };
                break;
            case 's':
                newH = h + dy;
                origin = { x: centerX, y: startBounds.minY };
                break;
            case 'n':
                newH = h - dy;
                origin = { x: centerX, y: startBounds.maxY };
                break;
            default:
                return null;
        }

        const minW = w * MIN_SCALE_FACTOR;
        const minH = h * MIN_SCALE_FACTOR;
        newW = Math.max(minW, newW);
        newH = Math.max(minH, newH);

        const sx = clamp(newW / w, MIN_SCALE_FACTOR, 1000);
        const sy = clamp(newH / h, MIN_SCALE_FACTOR, 1000);

        return { sx: handle === 'n' || handle === 's' ? 1 : sx, sy: handle === 'e' || handle === 'w' ? 1 : sy, origin };
    },

    // 计算旋转角（度）
    _calculateRotation(e, origin) {
        const p = this._getCanvasCoords(e);
        return (Math.atan2(p.y - origin.y, p.x - origin.x) * 180) / Math.PI;
    },

    // 供其他模块复用：返回 element 的 SVG transform 属性字符串（matrix）
    _getElementTransformAttr(element) {
        const m = normalizeMatrix(element?.transform?.matrix);
        const isIdentity = m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.e === 0 && m.f === 0;
        return isIdentity ? '' : matrixToSvgString(m);
    }
};
