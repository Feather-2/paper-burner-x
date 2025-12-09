/**
 * Vecburner - 工具函数模块
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
 * 在 Web Worker 中会跳过，使用内置算法
 */
export async function loadCdnLibs() {
    if (libsLoaded) return;
    
    // Worker 环境中没有 document，跳过 CDN 加载
    if (typeof document === 'undefined') {
        console.log('[Vecburner] Worker 环境，使用内置算法');
        libsLoaded = true;
        return;
    }
    
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
        console.warn('[Vecburner] CDN 加载失败，使用内置算法');
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

/**
 * 对像素颜色映射进行去噪 (Mode Filter / Majority Vote)
 * 去除孤立像素，将其归并到周围的主色中
 * @param {Uint8Array} pixelColorMap - 像素颜色索引数组
 * @param {number} width - 图像宽度
 * @param {number} height - 图像高度
 * @param {number} iterations - 迭代次数
 */
export function denoisePixelMap(pixelColorMap, width, height, iterations = 1) {
    const len = width * height;
    // 双缓冲
    let currentMap = pixelColorMap;
    let nextMap = new Uint8Array(len);
    
    for (let iter = 0; iter < iterations; iter++) {
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                const color = currentMap[idx];
                
                if (color === 255) {
                    nextMap[idx] = 255; // 透明保持不变
                    continue;
                }
                
                // 统计 3x3 邻域颜色频率
                const counts = {};
                let maxCount = 0;
                let maxColor = color;
                
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        const nx = x + dx;
                        const ny = y + dy;
                        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                            const nColor = currentMap[ny * width + nx];
                            if (nColor !== 255) {
                                counts[nColor] = (counts[nColor] || 0) + 1;
                                if (counts[nColor] > maxCount) {
                                    maxCount = counts[nColor];
                                    maxColor = nColor;
                                }
                            }
                        }
                    }
                }
                
                // 如果中心像素颜色不是众数，且众数出现频率足够高（>4，即超过一半），则替换
                // 或者如果中心像素完全孤立（周围没有同色），则替换为众数
                const centerCount = counts[color] || 0;
                if (centerCount === 1 || (maxColor !== color && maxCount >= 5)) {
                    nextMap[idx] = parseInt(maxColor);
                } else {
                    nextMap[idx] = color;
                }
            }
        }
        
        // 交换缓冲区
        const temp = currentMap;
        currentMap = nextMap;
        nextMap = temp;
    }
    
    // 将结果复制回原数组
    if (currentMap !== pixelColorMap) {
        pixelColorMap.set(currentMap);
    }
    
    return pixelColorMap;
}
