/**
 * Potrace Core - 工具函数模块
 * 
 * 提供基础工具函数和 CDN 依赖加载
 */

// ============ CDN 依赖 ============
const CDN_LIBS = {
    simplify: 'https://cdn.jsdelivr.net/npm/simplify-js@1.2.4/simplify.min.js',
    fitCurve: 'https://cdn.jsdelivr.net/npm/fit-curve@0.2.0/lib/fit-curve.js'
};

let libsLoaded = false;

/**
 * 加载 CDN 依赖库
 */
export async function loadCdnLibs() {
    if (libsLoaded) return;
    const loadScript = (url) => new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${url}"]`)) { resolve(); return; }
        const script = document.createElement('script');
        script.src = url;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`Failed: ${url}`));
        document.head.appendChild(script);
    });

    try {
        await Promise.all(Object.values(CDN_LIBS).map(loadScript));
        libsLoaded = true;
    } catch (e) {
        console.warn('[PotraceCore] CDN 加载失败，使用内置算法');
    }
}

// ============ 颜色工具 ============

/**
 * 颜色距离平方
 */
export function colorDistSq(c1, c2) {
    const dr = c1[0] - c2[0], dg = c1[1] - c2[1], db = c1[2] - c2[2];
    return dr * dr + dg * dg + db * db;
}

/**
 * 颜色距离
 */
export function colorDistance(c1, c2) {
    return Math.sqrt(colorDistSq(c1, c2));
}

// ============ 几何工具 ============

/**
 * 计算三角形有符号面积
 */
export function signedArea(p1, p2, p3) {
    return (p2.x - p1.x) * (p3.y - p1.y) - (p3.x - p1.x) * (p2.y - p1.y);
}

/**
 * 计算多边形面积 (Shoelace formula)
 */
export function polygonArea(points) {
    let area = 0;
    const n = points.length;
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        area += points[i].x * points[j].y;
        area -= points[j].x * points[i].y;
    }
    return area / 2;
}

/**
 * 点到直线距离
 */
export function pointLineDistance(point, lineStart, lineEnd) {
    const dx = lineEnd.x - lineStart.x;
    const dy = lineEnd.y - lineStart.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return Math.sqrt((point.x - lineStart.x) ** 2 + (point.y - lineStart.y) ** 2);
    return Math.abs(dy * point.x - dx * point.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x) / len;
}

/**
 * 计算轮廓面积 (Shoelace formula)
 */
export function calculateArea(points) {
    let area = 0;
    const n = points.length;
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        area += points[i].x * points[j].y;
        area -= points[j].x * points[i].y;
    }
    return area / 2;
}
