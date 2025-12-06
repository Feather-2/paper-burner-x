/**
 * 路径简化模块
 * 包含 VTracer 风格的 remove_staircase 和 limit_penalties
 * @module vectorizer/path-simplify
 */

import { signedArea, pointLineDistance } from './utils.js';

/**
 * VTracer 风格：移除1像素锯齿
 * 核心算法：根据相邻三角形的有符号面积和路径方向判断是否移除中间点
 *
 * @param {Array} points - 输入点数组
 * @param {boolean} clockwise - 路径方向 (true=顺时针)
 * @returns {Array} 简化后的点数组
 */
export function removeStaircase(points, clockwise = true) {
    if (points.length < 4) return points;

    const n = points.length;
    const keep = new Array(n).fill(true);

    for (let i = 0; i < n; i++) {
        const prev = points[(i - 1 + n) % n];
        const curr = points[i];
        const next = points[(i + 1) % n];

        const area = signedArea(prev, curr, next);

        // 面积很小（接近共线）或方向与路径方向相反时，可以移除
        if (Math.abs(area) < 1.5) {
            // 几乎共线，移除
            keep[i] = false;
        } else if (clockwise && area > 0) {
            // 顺时针路径，正面积（凸点）可以移除
            if (area < 2) keep[i] = false;
        } else if (!clockwise && area < 0) {
            // 逆时针路径，负面积（凸点）可以移除
            if (area > -2) keep[i] = false;
        }
    }

    // 确保至少保留3个点
    const result = points.filter((_, i) => keep[i]);
    return result.length >= 3 ? result : points;
}

/**
 * VTracer 风格：基于惩罚的简化
 * 使用三角形面积作为惩罚值，迭代移除惩罚最小的点
 *
 * @param {Array} points - 输入点数组
 * @param {number} maxPenalty - 最大惩罚值（面积阈值）
 * @returns {Array} 简化后的点数组
 */
export function limitPenalties(points, maxPenalty = 1.0) {
    if (points.length < 4) return points;

    // 创建双向链表
    const nodes = points.map((p, i) => ({
        point: { x: p.x, y: p.y },
        prev: i - 1,
        next: i + 1,
        penalty: 0,
        removed: false
    }));

    const n = nodes.length;
    nodes[0].prev = n - 1;
    nodes[n - 1].next = 0;

    // 计算点的惩罚值（三角形面积）
    const updatePenalty = (i) => {
        const node = nodes[i];
        if (node.removed) return;

        const prev = nodes[node.prev];
        const next = nodes[node.next];

        node.penalty = Math.abs(signedArea(prev.point, node.point, next.point));
    };

    // 初始化所有惩罚值
    for (let i = 0; i < n; i++) {
        updatePenalty(i);
    }

    // 迭代移除惩罚最小的点
    let remaining = n;
    const minPenalty = maxPenalty * maxPenalty;

    while (remaining > 3) {
        let minIdx = -1;
        let minVal = Infinity;

        // 找最小惩罚点
        for (let i = 0; i < n; i++) {
            if (!nodes[i].removed && nodes[i].penalty < minVal) {
                minVal = nodes[i].penalty;
                minIdx = i;
            }
        }

        if (minIdx < 0 || minVal > minPenalty) break;

        // 移除该点
        const node = nodes[minIdx];
        node.removed = true;
        remaining--;

        // 更新邻居链接
        const prev = nodes[node.prev];
        const next = nodes[node.next];
        prev.next = node.next;
        next.prev = node.prev;

        // 重新计算邻居惩罚值
        updatePenalty(node.prev);
        updatePenalty(node.next);
    }

    return nodes.filter(n => !n.removed).map(n => n.point);
}

/**
 * Visvalingam-Whyatt 算法
 * 保持拓扑的简化算法
 */
export function visvalingamWhyatt(points, threshold = 1.0) {
    if (points.length <= 3) return points;

    const triangleArea = (a, b, c) => {
        return Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
    };

    const nodes = points.map((p, i) => ({
        point: p,
        prev: i - 1,
        next: i + 1,
        area: 0,
        removed: false
    }));

    nodes[0].prev = points.length - 1;
    nodes[nodes.length - 1].next = 0;

    const updateArea = (i) => {
        const node = nodes[i];
        if (node.removed) return;
        const prev = nodes[node.prev];
        const next = nodes[node.next];
        node.area = triangleArea(prev.point, node.point, next.point);
    };

    for (let i = 0; i < nodes.length; i++) {
        updateArea(i);
    }

    let remaining = nodes.length;
    const minArea = threshold * threshold;

    while (remaining > 3) {
        let minIdx = -1;
        let minVal = Infinity;

        for (let i = 0; i < nodes.length; i++) {
            if (!nodes[i].removed && nodes[i].area < minVal) {
                minVal = nodes[i].area;
                minIdx = i;
            }
        }

        if (minIdx < 0 || minVal > minArea) break;

        const node = nodes[minIdx];
        node.removed = true;
        remaining--;

        const prev = nodes[node.prev];
        const next = nodes[node.next];
        prev.next = node.next;
        next.prev = node.prev;

        updateArea(node.prev);
        updateArea(node.next);
    }

    return nodes.filter(n => !n.removed).map(n => n.point);
}

/**
 * Douglas-Peucker 简化
 */
export function douglasPeucker(points, tolerance) {
    if (points.length < 3) return points;

    const first = points[0];
    const last = points[points.length - 1];

    let maxDist = 0, maxIdx = 0;
    for (let i = 1; i < points.length - 1; i++) {
        const dist = pointLineDistance(points[i], first, last);
        if (dist > maxDist) {
            maxDist = dist;
            maxIdx = i;
        }
    }

    if (maxDist > tolerance) {
        const left = douglasPeucker(points.slice(0, maxIdx + 1), tolerance);
        const right = douglasPeucker(points.slice(maxIdx), tolerance);
        return left.slice(0, -1).concat(right);
    }

    return [first, last];
}

/**
 * 综合路径简化
 * @param {Array} points - 输入点数组
 * @param {Object|number} options - 配置或容差
 * @returns {Array} 简化后的点数组
 */
export function simplifyPath(points, options = {}) {
    const {
        tolerance = 1.0,
        highQuality = true,
        useStaircase = true
    } = typeof options === 'number' ? { tolerance: options } : options;

    if (points.length < 3) return points;

    let result = points;

    // 1. VTracer 风格：先移除锯齿
    if (useStaircase) {
        const area = Math.abs(polygonAreaSimple(points));
        const clockwise = area >= 0;
        result = removeStaircase(result, clockwise);
    }

    // 2. 尝试使用 simplify-js CDN
    if (typeof window !== 'undefined' && typeof window.simplify === 'function') {
        return window.simplify(result, tolerance, highQuality);
    }

    // 3. 回退到 Visvalingam-Whyatt
    return visvalingamWhyatt(result, tolerance);
}

// 辅助函数
function polygonAreaSimple(points) {
    let area = 0;
    const n = points.length;
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        area += points[i].x * points[j].y;
        area -= points[j].x * points[i].y;
    }
    return area / 2;
}
