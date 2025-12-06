/**
 * 二值化模块
 * @module vectorizer/binary-image
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
 * 计算自适应亮度阈值 (Otsu's method)
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
 * 创建二值位图
 * @param {ImageData} imageData
 * @param {Array} targetColor - 目标颜色 [r, g, b]
 * @param {number} tolerance - 颜色容差
 * @param {boolean} useLuminance - 使用亮度模式 (用于 lineart)
 * @param {number} threshold - 亮度阈值 (自动计算时传入)
 * @param {number} blurSigma - 高斯模糊 sigma (0 = 不模糊)
 * @returns {Object} { data, width, height, inverted, grayscale }
 */
export function createBinaryBitmap(imageData, targetColor, tolerance = 30, useLuminance = false, threshold = null, blurSigma = 0) {
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
                    const distSq = colorDistSq([data[i], data[i + 1], data[i + 2]], targetColor);
                    grayscale[y * width + x] = Math.min(255, Math.sqrt(distSq) * 255 / tolerance);
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

    // 自动检测：如果暗色像素超过 50%，说明背景是暗色，需要反转
    let inverted = false;
    if (useLuminance && darkCount > totalCount * 0.5) {
        for (let i = 0; i < bitmap.length; i++) {
            const idx = i * 4;
            if (data[idx + 3] > 128) {
                bitmap[i] = bitmap[i] === 1 ? 0 : 1;
                grayscale[i] = 255 - grayscale[i];
            }
        }
        inverted = true;
    }

    return { data: bitmap, width, height, inverted, grayscale };
}

/**
 * BinaryImage 类 (VTracer 风格)
 */
export class BinaryImage {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.data = new Uint8Array(width * height);
    }

    getPixel(x, y) {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
        return this.data[y * this.width + x] === 1;
    }

    setPixel(x, y, value) {
        if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
            this.data[y * this.width + x] = value ? 1 : 0;
        }
    }

    /**
     * 从 bitmap 对象创建
     */
    static fromBitmap(bitmap) {
        const img = new BinaryImage(bitmap.width, bitmap.height);
        img.data = bitmap.data.slice();
        return img;
    }
}
