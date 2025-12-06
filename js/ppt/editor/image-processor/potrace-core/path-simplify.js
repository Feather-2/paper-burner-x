/**
 * Potrace Core - 路径简化模块
 * 
 * 提供 Visvalingam-Whyatt 和 Douglas-Peucker 路径简化算法
 */

import { pointLineDistance } from './utils.js';

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
