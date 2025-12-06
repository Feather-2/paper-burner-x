/**
 * 颜色量化模块
 * @module vectorizer/color-quantize
 */

import { colorDistSq } from './utils.js';

/**
 * Median Cut 颜色量化
 * @param {ImageData} imageData - 图像数据
 * @param {number} maxColors - 最大颜色数
 * @returns {Array} 调色板 [[r,g,b], ...]
 */
export function medianCutQuantize(imageData, maxColors = 16) {
    const data = imageData.data;
    const pixels = [];

    // 采样优化：大图片时采样以避免内存问题
    const totalPixels = data.length / 4;
    const sampleRate = totalPixels > 100000 ? Math.ceil(totalPixels / 100000) : 1;

    for (let i = 0; i < data.length; i += 4 * sampleRate) {
        if (data[i + 3] > 128) {
            pixels.push([data[i], data[i + 1], data[i + 2]]);
        }
    }

    if (pixels.length === 0) return [[128, 128, 128]];

    // 辅助函数：安全获取数组最大最小值（避免栈溢出）
    const getMinMax = (arr, channel) => {
        let min = 255, max = 0;
        for (let i = 0; i < arr.length; i++) {
            const v = arr[i][channel];
            if (v < min) min = v;
            if (v > max) max = v;
        }
        return { min, max, range: max - min };
    };

    const buckets = [pixels];

    while (buckets.length < maxColors) {
        let maxRange = 0, maxIdx = 0, splitCh = 0;

        for (let i = 0; i < buckets.length; i++) {
            const b = buckets[i];
            if (b.length < 2) continue;

            for (let c = 0; c < 3; c++) {
                const { range } = getMinMax(b, c);
                if (range > maxRange) {
                    maxRange = range;
                    maxIdx = i;
                    splitCh = c;
                }
            }
        }

        if (maxRange === 0) break;

        const bucket = buckets[maxIdx];
        bucket.sort((a, b) => a[splitCh] - b[splitCh]);
        const mid = Math.floor(bucket.length / 2);
        buckets.splice(maxIdx, 1, bucket.slice(0, mid), bucket.slice(mid));
    }

    return buckets.filter(b => b.length > 0).map(bucket => {
        const sum = [0, 0, 0];
        for (const p of bucket) {
            sum[0] += p[0];
            sum[1] += p[1];
            sum[2] += p[2];
        }
        return [
            Math.round(sum[0] / bucket.length),
            Math.round(sum[1] / bucket.length),
            Math.round(sum[2] / bucket.length)
        ];
    }).sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
}

/**
 * 找最接近的调色板颜色
 * @param {Array} color - [r, g, b]
 * @param {Array} palette - [[r,g,b], ...]
 * @returns {number} 调色板索引
 */
export function findClosestColor(color, palette) {
    let minDist = Infinity;
    let minIdx = 0;

    for (let i = 0; i < palette.length; i++) {
        const dist = colorDistSq(color, palette[i]);
        if (dist < minDist) {
            minDist = dist;
            minIdx = i;
        }
    }

    return minIdx;
}

/**
 * VTracer 风格颜色相似判断
 * @param {Array} a - [r, g, b]
 * @param {Array} b - [r, g, b]
 * @param {number} shift - 精度位移 (0-7)
 * @param {number} threshold - 阈值
 */
export function colorSame(a, b, shift = 4, threshold = 1) {
    const diff = [
        (a[0] >> shift) - (b[0] >> shift),
        (a[1] >> shift) - (b[1] >> shift),
        (a[2] >> shift) - (b[2] >> shift)
    ];

    return Math.abs(diff[0]) <= threshold &&
           Math.abs(diff[1]) <= threshold &&
           Math.abs(diff[2]) <= threshold;
}

/**
 * 颜色差异 (曼哈顿距离)
 */
export function colorDiff(a, b) {
    return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}
