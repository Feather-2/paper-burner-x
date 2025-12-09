/**
 * Potrace Core - 二值化模块
 * 
 * 提供二值化、形态学操作、高斯模糊等图像预处理功能
 */

import { colorDistSq } from './utils.js';

/**
 * 高斯模糊预处理 (VTracer 风格)
 * 减少锯齿，平滑边缘过渡
 */
export function gaussianBlur(grayscale, width, height, sigma = 1.0) {
    if (sigma <= 0) return grayscale;

    // 生成高斯核
    const radius = Math.ceil(sigma * 3);
    const kernelSize = radius * 2 + 1;
    const kernel = new Float32Array(kernelSize);
    let kernelSum = 0;

    for (let i = 0; i < kernelSize; i++) {
        const x = i - radius;
        kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
        kernelSum += kernel[i];
    }

    // 归一化
    for (let i = 0; i < kernelSize; i++) {
        kernel[i] /= kernelSum;
    }

    // 水平方向模糊
    const temp = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let sum = 0;
            for (let k = -radius; k <= radius; k++) {
                const sx = Math.max(0, Math.min(width - 1, x + k));
                sum += grayscale[y * width + sx] * kernel[k + radius];
            }
            temp[y * width + x] = sum;
        }
    }

    // 垂直方向模糊
    const result = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let sum = 0;
            for (let k = -radius; k <= radius; k++) {
                const sy = Math.max(0, Math.min(height - 1, y + k));
                sum += temp[sy * width + x] * kernel[k + radius];
            }
            result[y * width + x] = sum;
        }
    }

    return result;
}

/**
 * 计算自适应亮度阈值 (Otsu's method 简化版)
 */
export function computeOtsuThreshold(imageData) {
    const data = imageData.data;
    const histogram = new Array(256).fill(0);
    let total = 0;
    
    // 构建亮度直方图
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 128) {
            const lum = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
            histogram[lum]++;
            total++;
        }
    }
    
    if (total === 0) return 128;
    
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * histogram[i];
    
    let sumB = 0, wB = 0, wF = 0;
    let maxVariance = 0, threshold = 128;
    
    for (let t = 0; t < 256; t++) {
        wB += histogram[t];
        if (wB === 0) continue;
        wF = total - wB;
        if (wF === 0) break;
        
        sumB += t * histogram[t];
        const mB = sumB / wB;
        const mF = (sum - sumB) / wF;
        const variance = wB * wF * (mB - mF) * (mB - mF);
        
        if (variance > maxVariance) {
            maxVariance = variance;
            threshold = t;
        }
    }
    
    return threshold;
}

/**
 * 形态学膨胀操作
 */
export function dilate(bitmap, width, height) {
    const result = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            if (bitmap[idx] === 1) {
                result[idx] = 1;
                continue;
            }
            // 检查 4 邻域
            let hasNeighbor = false;
            if (x > 0 && bitmap[idx - 1] === 1) hasNeighbor = true;
            if (x < width - 1 && bitmap[idx + 1] === 1) hasNeighbor = true;
            if (y > 0 && bitmap[idx - width] === 1) hasNeighbor = true;
            if (y < height - 1 && bitmap[idx + width] === 1) hasNeighbor = true;
            result[idx] = hasNeighbor ? 1 : 0;
        }
    }
    return result;
}

/**
 * 形态学腐蚀操作
 */
export function erode(bitmap, width, height) {
    const result = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            if (bitmap[idx] === 0) {
                result[idx] = 0;
                continue;
            }
            // 检查 4 邻域是否都是 1
            let allNeighbors = true;
            if (x > 0 && bitmap[idx - 1] !== 1) allNeighbors = false;
            if (x < width - 1 && bitmap[idx + 1] !== 1) allNeighbors = false;
            if (y > 0 && bitmap[idx - width] !== 1) allNeighbors = false;
            if (y < height - 1 && bitmap[idx + width] !== 1) allNeighbors = false;
            result[idx] = allNeighbors ? 1 : 0;
        }
    }
    return result;
}

/**
 * 形态学闭运算 (先膨胀后腐蚀) - 填充小孔洞
 */
export function morphClose(bitmap, width, height) {
    return erode(dilate(bitmap, width, height), width, height);
}

/**
 * 形态学开运算 (先腐蚀后膨胀) - 去除小噪点
 */
export function morphOpen(bitmap, width, height) {
    return dilate(erode(bitmap, width, height), width, height);
}

/**
 * 颜色约束膨胀：只向原始颜色相同或无主区域膨胀
 * @param {Uint8Array} bitmap - 当前二值图
 * @param {number} width - 宽度
 * @param {number} height - 高度
 * @param {Uint8Array} pixelColorMap - 原始颜色分配图
 * @param {number} targetColorIdx - 当前层的颜色索引
 */
export function dilateWithColorConstraint(bitmap, width, height, pixelColorMap, targetColorIdx) {
    const result = new Uint8Array(bitmap);
    
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            if (bitmap[idx] === 1) continue; // 已经是前景
            
            // 检查是否有前景邻居
            let hasFgNeighbor = false;
            if (x > 0 && bitmap[idx - 1] === 1) hasFgNeighbor = true;
            else if (x < width - 1 && bitmap[idx + 1] === 1) hasFgNeighbor = true;
            else if (y > 0 && bitmap[idx - width] === 1) hasFgNeighbor = true;
            else if (y < height - 1 && bitmap[idx + width] === 1) hasFgNeighbor = true;
            
            if (!hasFgNeighbor) continue;
            
            // 允许膨胀到非透明区域
            // 255 = 透明像素（不膨胀）
            const originalColor = pixelColorMap[idx];
            if (originalColor !== 255) {
                result[idx] = 1;
            }
        }
    }
    
    return result;
}

/**
 * 过滤小连通区域：基于最大区域的比例过滤
 * @param {Uint8Array} bitmap - 二值位图
 * @param {number} width - 宽度
 * @param {number} height - 高度
 * @param {number} minRatio - 相对于最大区域的最小比例（默认 1/40）
 */
export function filterSmallRegions(bitmap, width, height, minRatio = 40) {
    const result = new Uint8Array(width * height);
    const labels = new Int32Array(width * height);
    const parent = [0];
    let nextLabel = 1;
    
    // Union-Find
    const find = (i) => {
        while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
        return i;
    };
    const union = (i, j) => {
        const ri = find(i), rj = find(j);
        if (ri !== rj) parent[Math.max(ri, rj)] = Math.min(ri, rj);
    };
    
    // First pass: 标记连通区域
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            if (bitmap[idx] === 0) continue;
            
            const neighbors = [];
            if (x > 0 && bitmap[idx - 1] === 1) neighbors.push(labels[idx - 1]);
            if (y > 0 && bitmap[idx - width] === 1) neighbors.push(labels[idx - width]);
            
            if (neighbors.length === 0) {
                labels[idx] = nextLabel;
                parent.push(nextLabel);
                nextLabel++;
            } else {
                const minN = Math.min(...neighbors.map(n => find(n)));
                labels[idx] = minN;
                for (const n of neighbors) union(n, minN);
            }
        }
    }
    
    // 统计每个区域的像素数
    const regionSizes = new Map();
    let maxSize = 0;
    for (let i = 0; i < labels.length; i++) {
        if (bitmap[i] === 0) continue;
        const root = find(labels[i]);
        const newSize = (regionSizes.get(root) || 0) + 1;
        regionSizes.set(root, newSize);
        if (newSize > maxSize) maxSize = newSize;
    }
    
    // 计算最小保留阈值：最大区域的 1/minRatio，但至少 4 像素

    const minPixels = Math.max(4, Math.min(50, Math.floor(maxSize / minRatio)));
    
    // Second pass: 只保留足够大的区域
    for (let i = 0; i < labels.length; i++) {
        if (bitmap[i] === 0) continue;
        const root = find(labels[i]);
        if (regionSizes.get(root) >= minPixels) {
            result[i] = 1;
        }
    }
    
    return result;
}

/**
 * 创建二值位图
 * @param {ImageData} imageData
 * @param {Array} targetColor - 目标颜色 [r, g, b]
 * @param {number} tolerance - 颜色容差
 * @param {boolean} useLuminance - 使用亮度模式 (用于 lineart)
 * @param {number} threshold - 亮度阈值 (自动计算时传入)
 * @param {number} blurSigma - 高斯模糊 sigma (0 = 不模糊)
 * @param {boolean} morphology - 是否应用形态学操作
 */
export function createBinaryBitmap(imageData, targetColor, tolerance = 30, useLuminance = false, threshold = null, blurSigma = 0, morphology = true) {
    const { width, height, data } = imageData;
    const bitmap = new Uint8Array(width * height);

    // 使用传入的阈值或默认阈值
    const lumThreshold = threshold !== null ? threshold : 128;

    // 生成灰度图
    let grayscale = new Float32Array(width * height);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            if (data[i + 3] > 128) {
                if (useLuminance) {
                    // 亮度模式
                    grayscale[y * width + x] = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
                } else {
                    // 颜色模式：使用颜色距离作为灰度
                    const dist = Math.sqrt(colorDistSq([data[i], data[i + 1], data[i + 2]], targetColor));
                    // 距离 < tolerance 时视为目标颜色（grayscale < 128）
                    // 使用 tolerance * 2 作为分母，确保 dist < tolerance 时 grayscale < 128
                    grayscale[y * width + x] = Math.min(255, dist * 128 / tolerance);
                }
            } else {
                grayscale[y * width + x] = 255; // 透明像素视为白色
            }
        }
    }

    // 应用高斯模糊（VTracer 风格预处理）
    if (blurSigma > 0) {
        grayscale = gaussianBlur(grayscale, width, height, blurSigma);
    }

    // 二值化
    let darkCount = 0, totalCount = 0;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            if (data[i + 3] > 128) {
                totalCount++;
                const lum = grayscale[y * width + x];
                const isDark = lum < lumThreshold;
                bitmap[y * width + x] = isDark ? 1 : 0;
                if (isDark) darkCount++;
            }
        }
    }

    // 自动检测：如果暗色像素超过 40%，说明背景是暗色，需要反转
    // 降低阈值以更好地检测黑底白线的工程图
    let inverted = false;
    if (useLuminance && darkCount > totalCount * 0.4) {
        console.log(`[PotraceCore] 检测到暗色背景 (${darkCount}/${totalCount})，反转二值图`);
        for (let i = 0; i < bitmap.length; i++) {
            const idx = i * 4;
            if (data[idx + 3] > 128) {
                bitmap[i] = bitmap[i] === 1 ? 0 : 1;
                // 同时反转灰度值
                grayscale[i] = 255 - grayscale[i];
            }
        }
        inverted = true;
    }

    // 形态学预处理：只做闭运算填充小孔洞
    // 注意：不做开运算，因为会腐蚀角点导致不锐利
    let finalBitmap = bitmap;
    if (morphology) {
        finalBitmap = morphClose(bitmap, width, height);
    }

    return { data: finalBitmap, width, height, inverted, grayscale };
}

/**
 * 根据颜色分配图创建二值位图（最近颜色匹配，无空白）
 * 使用膨胀操作确保相邻颜色层轻微重叠，消除缝隙
    * 
 * **VM(基于公开资料) 风格改进**：利用混色比例计算亚像素边界
 * - 不只是 0/1 二值，而是计算每个像素属于目标颜色的程度
 * - 边缘像素的灰度值反映它在两个颜色之间的位置
 */
export function createBinaryBitmapFromMap(pixelColorMap, targetColorIdx, width, height, blurSigma = 0, dilatePixels = 1, imageData = null, palette = null) {
    const bitmap = new Uint8Array(width * height);
    
    // 直接从颜色分配图创建二值位图
    // 254 = 边缘像素，255 = 透明像素，都不参与
    for (let i = 0; i < pixelColorMap.length; i++) {
        const colorIdx = pixelColorMap[i];
        // 只有明确分配到目标颜色的像素才是前景
        bitmap[i] = (colorIdx === targetColorIdx) ? 1 : 0;
    }
    
    // **关键改进**：生成基于混色比例的灰度图
    let grayscale = new Float32Array(width * height);
    
    if (imageData && palette && palette.length > 1) {
        // VM(基于公开资料) 风格：利用原始像素颜色计算混合比例
        const targetColor = palette[targetColorIdx];
        const data = imageData.data;
        
        for (let i = 0; i < width * height; i++) {
            const idx = i * 4;
            if (data[idx + 3] < 128) {
                grayscale[i] = 255; // 透明像素
                continue;
            }
            
            const pixelColor = [data[idx], data[idx + 1], data[idx + 2]];
            const distToTarget = Math.sqrt(colorDistSq(pixelColor, targetColor));
            
            // 找最近的非目标色
            let minOtherDist = Infinity;
            for (let j = 0; j < palette.length; j++) {
                if (j !== targetColorIdx) {
                    const d = Math.sqrt(colorDistSq(pixelColor, palette[j]));
                    if (d < minOtherDist) minOtherDist = d;
                }
            }
            
            // 计算混合比例：0 = 完全是目标色，255 = 完全是其他色
            // **优化**：使用平方根使边缘过渡更平滑（模拟 gamma 校正）
            const totalDist = distToTarget + minOtherDist;
            if (totalDist < 1) {
                grayscale[i] = bitmap[i] === 1 ? 0 : 255;
            } else {
                // 线性比例
                let t = distToTarget / totalDist;
                
                // 平方根变换：让边缘过渡更平滑
                // 这模拟了抗锯齿的非线性特性
                t = Math.sqrt(t);
                
                // 应用 S 曲线使中间值更明确
                // smoothstep: 3t² - 2t³
                t = t * t * (3 - 2 * t);
                
                grayscale[i] = t * 255;
            }
        }
    } else {
        // 回退：简单的 0/255 灰度
        for (let i = 0; i < bitmap.length; i++) {
            grayscale[i] = bitmap[i] === 1 ? 0 : 255;
        }
    }
    
    // 轻度高斯模糊（平滑噪声，但不破坏混色信息）
    if (blurSigma > 0) {
        grayscale = gaussianBlur(grayscale, width, height, Math.min(1.0, blurSigma));
    }
    
    // 连通区域过滤 - 过滤小于最大区域 1/100 的噪点
    // 注意：已经在 pixelColorMap 层面进行了去噪，这里不再进行强力过滤
    // 只过滤极小的噪点（< 4 像素），避免误删细节
    let finalBitmap = filterSmallRegions(bitmap, width, height, 100000); // 放宽阈值
    
    // 注意：不再做闭运算，因为会让内容变粗
    
    // 膨胀确保层重叠
    for (let i = 0; i < dilatePixels; i++) {
        finalBitmap = dilateWithColorConstraint(finalBitmap, width, height, pixelColorMap, targetColorIdx);
    }

    return { data: finalBitmap, width, height, inverted: false, grayscale };
}
