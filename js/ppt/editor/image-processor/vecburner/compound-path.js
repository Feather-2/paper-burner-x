/**
 * Vecburner - Compound Path Builder
 *
 * 检测轮廓的空间包含关系，将外轮廓和其内部孔洞组合为 compound path。
 *
 * 约定：
 * - 输入 contour: { points, area, type, pathD, bounds, ... }
 * - points 为闭合多边形点列（允许最后一点与第一点重复）
 * - 支持多层嵌套：只组合“外轮廓(depth 偶数)”的直接子轮廓(depth+1)，
 *   孔洞中的孤岛(depth 偶数)保持为独立元素
 */

const EPS = 1e-9;

let _compoundSeq = 0;

function createId() {
    // 浏览器环境优先使用 randomUUID
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `compound_${crypto.randomUUID()}`;
    }
    _compoundSeq += 1;
    return `compound_${Date.now().toString(36)}_${_compoundSeq.toString(36)}_${Math.random()
        .toString(36)
        .slice(2, 8)}`;
}

function isFiniteNumber(v) {
    return typeof v === 'number' && Number.isFinite(v);
}

function approxEq(a, b, eps = 1e-6) {
    return Math.abs(a - b) <= eps;
}

function approxPointEq(p1, p2, eps = 1e-6) {
    return approxEq(p1.x, p2.x, eps) && approxEq(p1.y, p2.y, eps);
}

function getRingPoints(points) {
    if (!Array.isArray(points) || points.length < 3) return [];
    const n = points.length;
    const first = points[0];
    const last = points[n - 1];
    if (first && last && approxPointEq(first, last)) return points.slice(0, -1);
    return points;
}

function polygonSignedArea(points) {
    const ring = getRingPoints(points);
    const n = ring.length;
    if (n < 3) return 0;
    let area2 = 0;
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        area2 += ring[i].x * ring[j].y - ring[j].x * ring[i].y;
    }
    return area2 / 2;
}

function computeBoundsFromPoints(points) {
    const ring = getRingPoints(points);
    if (ring.length === 0) {
        return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of ring) {
        if (!p) continue;
        const x = p.x;
        const y = p.y;
        if (!isFiniteNumber(x) || !isFiniteNumber(y)) continue;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
    }
    if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    return { minX, minY, maxX, maxY };
}

function boundsContain(outer, inner, eps = 1e-6) {
    if (!outer || !inner) return false;
    return (
        outer.minX <= inner.minX + eps &&
        outer.minY <= inner.minY + eps &&
        outer.maxX >= inner.maxX - eps &&
        outer.maxY >= inner.maxY - eps
    );
}

function isPointOnSegment(point, a, b, eps = 1e-6) {
    // 叉积接近 0 且投影在线段范围内
    const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    if (Math.abs(cross) > eps) return false;
    const dot = (point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y);
    if (dot < -eps) return false;
    const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    if (dot - len2 > eps) return false;
    return true;
}

function isLeft(a, b, p) {
    return (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y);
}

/**
 * 判断点是否在多边形内 (Winding Number 算法)
 * - 点在边界上视为 inside
 * @param {{x:number,y:number}} point
 * @param {Array<{x:number,y:number}>} polygon
 * @returns {boolean}
 */
function pointInPolygon(point, polygon) {
    const ring = getRingPoints(polygon);
    const n = ring.length;
    if (n < 3) return false;

    let windingNumber = 0;
    for (let i = 0; i < n; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % n];
        if (isPointOnSegment(point, a, b)) return true;

        // upward crossing
        if (a.y <= point.y) {
            if (b.y > point.y && isLeft(a, b, point) > 0) windingNumber += 1;
        } else {
            // downward crossing
            if (b.y <= point.y && isLeft(a, b, point) < 0) windingNumber -= 1;
        }
    }
    return windingNumber !== 0;
}

/**
 * 计算多边形质心
 * @param {Array<{x:number,y:number}>} points
 * @returns {{x:number,y:number}}
 */
function getCentroid(points) {
    const ring = getRingPoints(points);
    const n = ring.length;
    if (n === 0) return { x: 0, y: 0 };
    if (n < 3) {
        let sx = 0;
        let sy = 0;
        for (const p of ring) {
            sx += p.x;
            sy += p.y;
        }
        return { x: sx / n, y: sy / n };
    }

    // 面积加权质心（Shoelace）
    let area2 = 0;
    let cx6 = 0;
    let cy6 = 0;
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const cross = ring[i].x * ring[j].y - ring[j].x * ring[i].y;
        area2 += cross;
        cx6 += (ring[i].x + ring[j].x) * cross;
        cy6 += (ring[i].y + ring[j].y) * cross;
    }

    if (Math.abs(area2) < EPS) {
        // 退化多边形：回退到平均点
        let sx = 0;
        let sy = 0;
        for (const p of ring) {
            sx += p.x;
            sy += p.y;
        }
        return { x: sx / n, y: sy / n };
    }

    return { x: cx6 / (3 * area2), y: cy6 / (3 * area2) };
}

function pointsToPathD(points) {
    const ring = getRingPoints(points);
    if (ring.length < 2) return '';
    let d = `M${ring[0].x.toFixed(2)},${ring[0].y.toFixed(2)}`;
    for (let i = 1; i < ring.length; i++) {
        d += `L${ring[i].x.toFixed(2)},${ring[i].y.toFixed(2)}`;
    }
    return d + 'Z';
}

/**
 * 判断轮廓 A 是否包含轮廓 B（先 AABB，再精确判断）
 * @param {Object} outerContour - 外轮廓 {points, area, type, pathD, bounds, ring}
 * @param {Object} innerContour - 内轮廓 {points, ...}
 * @returns {boolean}
 */
function contourContains(outerContour, innerContour) {
    if (!outerContour || !innerContour) return false;
    if (!boundsContain(outerContour.bounds, innerContour.bounds)) return false;

    const center = getCentroid(innerContour.ring);
    if (pointInPolygon(center, outerContour.ring)) return true;

    // 质心在凹多边形/自交等情况下可能落在外部；回退到取一个轮廓点
    const fallback = innerContour.ring && innerContour.ring.length ? innerContour.ring[0] : null;
    if (!fallback) return false;
    return pointInPolygon(fallback, outerContour.ring);
}

function normalizeContour(contour, idx) {
    if (!contour || !Array.isArray(contour.points) || contour.points.length < 3) return null;
    const ring = getRingPoints(contour.points);
    if (ring.length < 3) return null;

    const area = isFiniteNumber(contour.area) ? contour.area : polygonSignedArea(ring);
    const type = contour.type || (area >= 0 ? 'outer' : 'inner');
    const bounds = contour.bounds && isFiniteNumber(contour.bounds.minX)
        ? contour.bounds
        : computeBoundsFromPoints(ring);

    const pathD = typeof contour.pathD === 'string' ? contour.pathD : '';

    return {
        idx,
        source: contour,
        points: contour.points,
        ring,
        area,
        absArea: Math.abs(area),
        type,
        pathD,
        bounds
    };
}

/**
 * 计算多个轮廓的合并边界
 * @param {Array<{bounds:{minX:number,minY:number,maxX:number,maxY:number}}>} contours
 * @returns {{minX:number,minY:number,maxX:number,maxY:number}}
 */
function calculateBounds(contours) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const c of contours) {
        const b = c && c.bounds;
        if (!b) continue;
        if (b.minX < minX) minX = b.minX;
        if (b.minY < minY) minY = b.minY;
        if (b.maxX > maxX) maxX = b.maxX;
        if (b.maxY > maxY) maxY = b.maxY;
    }
    if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    return { minX, minY, maxX, maxY };
}

function toContourInfo(normalized) {
    // 保持原对象字段，同时保证关键字段存在
    return {
        ...normalized.source,
        points: normalized.points,
        area: normalized.area,
        type: normalized.type,
        pathD: normalized.pathD || pointsToPathD(normalized.ring),
        bounds: normalized.bounds
    };
}

/**
 * 从轮廓列表构建复合路径元素
 * @param {Array} contours - 轮廓数组 [{points, area, type, pathD, bounds}, ...]
 * @param {string} color - 颜色
 * @returns {Array} 复合路径元素数组
 */
export function buildCompoundPaths(contours, color) {
    if (!Array.isArray(contours) || contours.length === 0) return [];

    const normalized = contours
        .map((c, i) => normalizeContour(c, i))
        .filter(Boolean);

    if (normalized.length === 0) return [];

    // 1. 按面积绝对值降序排序（大轮廓优先作为父级候选）
    normalized.sort((a, b) => b.absArea - a.absArea);

    // 2. 计算每个轮廓的“最近包含父级”（AABB 快速排除 + 精确算法）
    const parent = new Array(normalized.length).fill(-1);
    for (let i = 0; i < normalized.length; i++) {
        // 逆向扫描：从“最小的更大轮廓”开始找，命中即为最近父级
        for (let j = i - 1; j >= 0; j--) {
            if (!boundsContain(normalized[j].bounds, normalized[i].bounds)) continue;
            if (contourContains(normalized[j], normalized[i])) {
                parent[i] = j;
                break;
            }
        }
    }

    // 3. 深度（嵌套层级）计算：用于“孔洞中的孤岛不处理”
    const depth = new Array(normalized.length).fill(-1);
    const computing = new Array(normalized.length).fill(false);

    const getDepth = (i) => {
        if (depth[i] >= 0) return depth[i];
        if (computing[i]) return 0; // 防止异常循环
        computing[i] = true;
        const p = parent[i];
        depth[i] = p === -1 ? 0 : getDepth(p) + 1;
        computing[i] = false;
        return depth[i];
    };

    for (let i = 0; i < normalized.length; i++) getDepth(i);

    // 4. 建立 children 映射
    const childrenMap = new Map();
    for (let i = 0; i < normalized.length; i++) {
        const p = parent[i];
        if (p === -1) continue;
        if (!childrenMap.has(p)) childrenMap.set(p, []);
        childrenMap.get(p).push(i);
    }

    // 5. 构建 compound path：深度为偶数的轮廓作为“外轮廓”
    const result = [];
    for (let i = 0; i < normalized.length; i++) {
        if (depth[i] % 2 !== 0) continue;

        const directChildren = childrenMap.get(i) || [];
        const holeIdxs = directChildren.filter((ci) => depth[ci] === depth[i] + 1 && depth[ci] % 2 === 1);

        const outer = toContourInfo(normalized[i]);
        const holes = holeIdxs.map((ci) => toContourInfo(normalized[ci]));

        const pathParts = [
            outer.pathD || pointsToPathD(outer.points),
            ...holes.map((h) => h.pathD || pointsToPathD(h.points))
        ].filter(Boolean);

        const compoundContours = [
            { bounds: outer.bounds },
            ...holes.map((h) => ({ bounds: h.bounds }))
        ];

        result.push({
            id: createId(),
            color: typeof color === 'string' ? color : 'rgb(0,0,0)',
            outer,
            holes,
            pathD: pathParts.join(' '),
            bounds: calculateBounds(compoundContours),
            transform: {
                translate: { x: 0, y: 0 },
                scale: { x: 1, y: 1 },
                rotate: 0,
                origin: { x: 0, y: 0 }
            }
        });
    }

    return result;
}

