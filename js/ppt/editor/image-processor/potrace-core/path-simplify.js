/**
 * Potrace Core - 路径简化模块
 * 
 * 提供 VTracer 风格锯齿移除、Visvalingam-Whyatt 和 Douglas-Peucker 路径简化算法
 */

import { pointLineDistance } from './utils.js';

/**
 * VTracer 风格锯齿移除 - remove_staircase
 * 移除 1 像素的内凹锯齿点，只保留外凸点
 * 
 * 原理：如果一个点的相邻线段长度为 1（曼哈顿距离），
 * 则用 signed_area 判断它是凸还是凹，只保留凸点
 * 
 * @param {Array} points - 点数组 [{x, y}, ...]
 * @param {boolean} clockwise - 轮廓方向（顺时针为 true）
 * @returns {Array} 简化后的点数组
 */
export function removeStaircase(points, clockwise = true) {
    if (points.length < 4) return points;
    
    const len = points.length;
    const result = [];
    
    // 曼哈顿距离
    const segmentLength = (i, j) => {
        return Math.abs(points[i].x - points[j].x) + Math.abs(points[i].y - points[j].y);
    };
    
    // 有符号面积（正 = 顺时针/左转，负 = 逆时针/右转）
    const signedArea = (a, b, c) => {
        return (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
    };
    
    for (let i = 0; i < len; i++) {
        const h = i > 0 ? i - 1 : len - 1;  // 前一个点
        const j = (i + 1) % len;             // 后一个点
        
        let keep = true;
        
        // 首尾点始终保留（闭合路径时）
        if (i === 0 || i === len - 1) {
            keep = true;
        }
        // 如果相邻线段有 1 像素的，检查是否是内凹锯齿
        else if (segmentLength(i, h) === 1 || segmentLength(i, j) === 1) {
            const area = signedArea(points[h], points[i], points[j]);
            // 只保留外凸点：area 与 clockwise 同号
            keep = area !== 0 && (area > 0) === clockwise;
        }
        
        if (keep) {
            result.push(points[i]);
        }
    }
    
    return result;
}

/**
 * VTracer 风格 limit_penalties 简化
 * 基于三角形面积惩罚的路径简化
 */
export function limitPenalties(points, tolerance = 1.0) {
    if (points.length < 3) return points;
    
    const len = points.length;
    const result = [];
    
    // 计算惩罚值（三角形面积² / 底边长）
    const evaluatePenalty = (a, b, c) => {
        const l1 = Math.hypot(a.x - b.x, a.y - b.y);
        const l2 = Math.hypot(b.x - c.x, b.y - c.y);
        const l3 = Math.hypot(c.x - a.x, c.y - a.y);
        const p = (l1 + l2 + l3) / 2;  // 半周长
        const area = Math.sqrt(Math.max(0, p * (p - l1) * (p - l2) * (p - l3)));  // 海伦公式
        return l3 > 0 ? (area * area) / l3 : 0;
    };
    
    // 计算区间内最大惩罚
    const pastDelta = (from, to) => {
        let maxPenalty = 0;
        for (let i = from + 1; i < to; i++) {
            maxPenalty = Math.max(maxPenalty, evaluatePenalty(points[from], points[i], points[to]));
        }
        return maxPenalty;
    };
    
    let last = 0;
    for (let i = 0; i < len; i++) {
        if (i === 0) {
            result.push(points[i]);
        } else if (i === last + 1) {
            continue;  // 跳过
        } else if (pastDelta(last, i) >= tolerance) {
            last = i - 1;
            result.push(points[i - 1]);
        }
        
        if (i === len - 1) {
            result.push(points[i]);
        }
    }
    
    return result;
}

/**
 * Visvalingam-Whyatt 算法 - 保持拓扑的简化
 * 比 Douglas-Peucker 效果更好
 */
export function visvalingamWhyatt(points, threshold = 1.0) {
    if (points.length <= 3) return points;
    
    // 计算三角形面积
    const triangleArea = (a, b, c) => {
        return Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
    };
    
    // 创建双向链表
    const nodes = points.map((p, i) => ({
        point: p,
        prev: i - 1,
        next: i + 1,
        area: 0,
        removed: false
    }));
    
    // 处理首尾
    nodes[0].prev = points.length - 1;
    nodes[nodes.length - 1].next = 0;
    
    // 计算初始面积
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
    
    // 迭代移除最小面积点
    let remaining = nodes.length;
    const minArea = threshold * threshold;
    
    while (remaining > 3) {
        // 找最小面积
        let minIdx = -1;
        let minVal = Infinity;
        
        for (let i = 0; i < nodes.length; i++) {
            if (!nodes[i].removed && nodes[i].area < minVal) {
                minVal = nodes[i].area;
                minIdx = i;
            }
        }
        
        if (minIdx < 0 || minVal > minArea) break;
        
        // 移除该点
        const node = nodes[minIdx];
        node.removed = true;
        remaining--;
        
        // 更新邻居
        const prev = nodes[node.prev];
        const next = nodes[node.next];
        prev.next = node.next;
        next.prev = node.prev;
        
        updateArea(node.prev);
        updateArea(node.next);
    }
    
    // 收集结果
    return nodes.filter(n => !n.removed).map(n => n.point);
}

/**
 * Douglas-Peucker 简化 (备用)
 */
export function douglasPeucker(points, tolerance) {
    if (points.length < 3) return points;
    
    const first = points[0];
    const last = points[points.length - 1];
    
    let maxDist = 0, maxIdx = 0;
    for (let i = 1; i < points.length - 1; i++) {
        const dist = pointLineDistance(points[i], first, last);
        if (dist > maxDist) { maxDist = dist; maxIdx = i; }
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
 */
export function simplifyPath(points, options = {}) {
    const { tolerance = 1.0, highQuality = true } = typeof options === 'number' ? { tolerance: options } : options;
    if (points.length < 3) return points;
    
    // 优先使用 simplify-js CDN
    if (typeof window !== 'undefined' && typeof window.simplify === 'function') {
        return window.simplify(points, tolerance, highQuality);
    }
    
    // 回退到 Visvalingam-Whyatt
    return visvalingamWhyatt(points, tolerance);
}
