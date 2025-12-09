/**
 * Potrace Core - 颜色量化模块
 * 
 * 提供 K-Means++ 和 Median Cut 颜色量化算法
 */

import { colorDistSq } from './utils.js';

/**
 * K-Means++ 颜色聚类 - 比 Median Cut 更准确
 * 类似 VM(基于公开资料) 的色板提取
 */
export function kMeansQuantize(imageData, maxColors = 16, maxIterations = 10) {
    const data = imageData.data;
    const pixels = [];
    const pixelCounts = new Map(); // 统计每个颜色的像素数

    // 采样并统计颜色频率
    // 提高采样量以捕获小面积颜色（从 100k 提升到 500k）
    // 对于 1080p 图片 (200万像素)，这意味着采样 25%，足以捕获大部分细节
    const totalPixels = data.length / 4;
    const MAX_SAMPLES = 500000;
    const sampleRate = totalPixels > MAX_SAMPLES ? Math.ceil(totalPixels / MAX_SAMPLES) : 1;

    for (let i = 0; i < data.length; i += 4 * sampleRate) {
        if (data[i + 3] > 128) {
            // 量化到 7-bit 减少噪点（从 /4 改为 /2，保留更多颜色精度）
            const r = Math.round(data[i] / 2) * 2;
            const g = Math.round(data[i + 1] / 2) * 2;
            const b = Math.round(data[i + 2] / 2) * 2;
            const key = (r << 16) | (g << 8) | b;
            pixelCounts.set(key, (pixelCounts.get(key) || 0) + 1);
        }
    }

    if (pixelCounts.size === 0) return [[128, 128, 128]];

    // 转换为带权重的颜色数组
    const weightedColors = [];
    for (const [key, count] of pixelCounts) {
        weightedColors.push({
            color: [(key >> 16) & 0xff, (key >> 8) & 0xff, key & 0xff],
            weight: count
        });
    }

    // K-Means++ 初始化：选择分散的初始中心
    const centers = [];
    // 第一个中心：选择权重最大的颜色
    weightedColors.sort((a, b) => b.weight - a.weight);
    centers.push([...weightedColors[0].color]);

    // 后续中心：按距离概率选择
    while (centers.length < maxColors && centers.length < weightedColors.length) {
        let totalDist = 0;
        const distances = weightedColors.map(wc => {
            let minDist = Infinity;
            for (const c of centers) {
                const d = colorDistSq(wc.color, c);
                if (d < minDist) minDist = d;
            }
            totalDist += minDist * wc.weight;
            return minDist * wc.weight;
        });

        // 轮盘选择
        let r = Math.random() * totalDist;
        for (let i = 0; i < distances.length; i++) {
            r -= distances[i];
            if (r <= 0) {
                centers.push([...weightedColors[i].color]);
                break;
            }
        }
        if (centers.length === centers.length) {
            // 如果没有选中，选距离最远的
            let maxDist = 0, maxIdx = 0;
            for (let i = 0; i < distances.length; i++) {
                if (distances[i] > maxDist) {
                    maxDist = distances[i];
                    maxIdx = i;
                }
            }
            centers.push([...weightedColors[maxIdx].color]);
        }
    }

    // K-Means 迭代
    for (let iter = 0; iter < maxIterations; iter++) {
        // 分配每个颜色到最近的中心
        const clusters = centers.map(() => ({ sum: [0, 0, 0], weight: 0 }));
        
        for (const wc of weightedColors) {
            let minDist = Infinity, minIdx = 0;
            for (let i = 0; i < centers.length; i++) {
                const d = colorDistSq(wc.color, centers[i]);
                if (d < minDist) {
                    minDist = d;
                    minIdx = i;
                }
            }
            clusters[minIdx].sum[0] += wc.color[0] * wc.weight;
            clusters[minIdx].sum[1] += wc.color[1] * wc.weight;
            clusters[minIdx].sum[2] += wc.color[2] * wc.weight;
            clusters[minIdx].weight += wc.weight;
        }

        // 更新中心
        let changed = false;
        for (let i = 0; i < centers.length; i++) {
            if (clusters[i].weight > 0) {
                const newCenter = [
                    Math.round(clusters[i].sum[0] / clusters[i].weight),
                    Math.round(clusters[i].sum[1] / clusters[i].weight),
                    Math.round(clusters[i].sum[2] / clusters[i].weight)
                ];
                if (colorDistSq(newCenter, centers[i]) > 4) {
                    centers[i] = newCenter;
                    changed = true;
                }
            }
        }
        if (!changed) break;
    }

    // 合并相似颜色（距离 < 20，更保守以避免误合并）
    const mergeThreshold = 400; // 20^2
    const merged = [];
    const used = new Set();

    for (let i = 0; i < centers.length; i++) {
        if (used.has(i)) continue;
        let sum = [...centers[i]];
        let count = 1;

        for (let j = i + 1; j < centers.length; j++) {
            if (!used.has(j) && colorDistSq(centers[i], centers[j]) < mergeThreshold) {
                sum[0] += centers[j][0];
                sum[1] += centers[j][1];
                sum[2] += centers[j][2];
                count++;
                used.add(j);
            }
        }

        merged.push([
            Math.round(sum[0] / count),
            Math.round(sum[1] / count),
            Math.round(sum[2] / count)
        ]);
        used.add(i);
    }

    // 边缘色过滤：识别并移除抗锯齿产生的过渡色
    // 对于多色图像（> 16色），禁用边缘色过滤，因为渐变色会被误判
    const filtered = maxColors <= 16 
        ? filterEdgeColors(merged, weightedColors, maxColors)
        : merged;

    // 按亮度排序
    return filtered.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
}

/**
 * 边缘色过滤 - 识别并移除抗锯齿产生的过渡色
 *
 * 边缘色特征：
 * 1. 像素权重较小（占比低于动态阈值）
 * 2. 颜色值介于两个主色之间（在色彩空间中位于连线上）
 * 3. 与最近主色的距离适中（太远说明是独立颜色）
 * 
 * @param {Array} colors - 聚类后的颜色数组
 * @param {Array} weightedColors - 带权重的原始颜色数据
 * @param {number} maxColors - 目标颜色数，用于动态调整阈值
 */
export function filterEdgeColors(colors, weightedColors, maxColors = 16) {
    if (colors.length <= 2) return colors;

    // 1. 计算每个颜色的总权重
    const colorWeights = colors.map(color => {
        let totalWeight = 0;
        for (const wc of weightedColors) {
            // 找最近的聚类中心
            let minDist = Infinity;
            let nearestIdx = 0;
            for (let i = 0; i < colors.length; i++) {
                const d = colorDistSq(wc.color, colors[i]);
                if (d < minDist) {
                    minDist = d;
                    nearestIdx = i;
                }
            }
            if (colors[nearestIdx] === color) {
                totalWeight += wc.weight;
            }
        }
        return totalWeight;
    });

    const totalPixels = colorWeights.reduce((a, b) => a + b, 0);
    if (totalPixels === 0) return colors;

    // 2. 识别主色 - 根据目标颜色数动态调整阈值
    // 颜色数越多，阈值越低，避免误删
    // 2色: 5%, 4色: 2.5%, 8色: 1.25%, 16色: 0.6%
    const mainColorThreshold = Math.max(0.005, 0.1 / maxColors);
    const mainColors = [];
    const edgeCandidates = [];

    for (let i = 0; i < colors.length; i++) {
        const ratio = colorWeights[i] / totalPixels;
        if (ratio >= mainColorThreshold) {
            mainColors.push({ color: colors[i], weight: colorWeights[i], index: i });
        } else {
            edgeCandidates.push({ color: colors[i], weight: colorWeights[i], index: i, ratio });
        }
    }

    // 如果主色太少，放宽阈值
    if (mainColors.length < 2) {
        // 按权重排序，取前2个作为主色
        const sorted = colors.map((c, i) => ({ color: c, weight: colorWeights[i], index: i }))
            .sort((a, b) => b.weight - a.weight);
        mainColors.length = 0;
        edgeCandidates.length = 0;
        for (let i = 0; i < sorted.length; i++) {
            if (i < 2) {
                mainColors.push(sorted[i]);
            } else {
                edgeCandidates.push({ ...sorted[i], ratio: sorted[i].weight / totalPixels });
            }
        }
    }

    console.log(`[EdgeFilter] 主色 ${mainColors.length} 个, 候选边缘色 ${edgeCandidates.length} 个 (阈值 ${(mainColorThreshold * 100).toFixed(1)}%)`);

    // 3. 判断候选色是否为边缘色
    const result = mainColors.map(mc => mc.color);
    const mainColorArray = mainColors.map(mc => mc.color);

    for (const candidate of edgeCandidates) {
        // 保护：如果与所有主色距离都很远（> 60），说明是独立颜色，直接保留
        let minDistToMain = Infinity;
        for (const mc of mainColorArray) {
            const d = Math.sqrt(colorDistSq(candidate.color, mc));
            if (d < minDistToMain) minDistToMain = d;
        }
        
        if (minDistToMain > 60) {
            // 独立颜色，不是边缘色
            console.log(`[EdgeFilter] 保留独立色 rgb(${candidate.color.join(',')}) (距主色 ${minDistToMain.toFixed(0)})`);
            result.push(candidate.color);
            continue;
        }
        
        const isEdge = isEdgeColor(candidate.color, mainColorArray);

        if (isEdge) {
            console.log(`[EdgeFilter] 过滤边缘色 rgb(${candidate.color.join(',')}) (${(candidate.ratio * 100).toFixed(1)}%)`);
            // 边缘色不加入结果，其像素会被分配到最近的主色
        } else {
            // 不是边缘色，保留
            result.push(candidate.color);
        }
    }

    return result;
}

/**
 * 判断一个颜色是否是边缘色（介于两个主色之间）
 *
 * 算法：检查颜色 C 是否位于任意两个主色 A、B 连线的附近
 * - 计算 C 到 AB 线段的距离
 * - 计算 C 在 AB 上的投影位置 t (0~1 表示在线段内)
 * - 如果距离小且 t 在 (0.05, 0.95) 范围内，则是边缘色
 */
export function isEdgeColor(color, mainColors) {
    if (mainColors.length < 2) return false;

    const maxLineDistance = 50; // 到连线的最大距离 - 更严格，避免误删独立颜色
    const minT = 0.1;   // 投影位置下限（必须明显在中间）
    const maxT = 0.9;   // 投影位置上限

    // 检查所有主色对
    for (let i = 0; i < mainColors.length; i++) {
        for (let j = i + 1; j < mainColors.length; j++) {
            const A = mainColors[i];
            const B = mainColors[j];

            // AB 向量
            const ABx = B[0] - A[0];
            const ABy = B[1] - A[1];
            const ABz = B[2] - A[2];
            const AB_len_sq = ABx * ABx + ABy * ABy + ABz * ABz;

            if (AB_len_sq < 100) continue; // A 和 B 太近，跳过

            // AC 向量
            const ACx = color[0] - A[0];
            const ACy = color[1] - A[1];
            const ACz = color[2] - A[2];

            // 投影 t = (AC · AB) / |AB|²
            const dot = ACx * ABx + ACy * ABy + ACz * ABz;
            const t = dot / AB_len_sq;

            // 检查 t 是否在有效范围内
            if (t < minT || t > maxT) continue;

            // 计算 C 到 AB 线段的距离
            // 投影点 P = A + t * AB
            const Px = A[0] + t * ABx;
            const Py = A[1] + t * ABy;
            const Pz = A[2] + t * ABz;

            // CP 距离
            const dist = Math.sqrt(
                (color[0] - Px) ** 2 +
                (color[1] - Py) ** 2 +
                (color[2] - Pz) ** 2
            );

            if (dist < maxLineDistance) {
                // 这个颜色位于 A-B 连线附近，是边缘色
                return true;
            }
        }
    }

    return false;
}

/**
 * Median Cut 颜色量化（备用，更快）
 */
export function medianCutQuantize(imageData, maxColors = 16) {
    const data = imageData.data;
    const pixels = [];

    const totalPixels = data.length / 4;
    const MAX_SAMPLES = 500000;
    const sampleRate = totalPixels > MAX_SAMPLES ? Math.ceil(totalPixels / MAX_SAMPLES) : 1;

    for (let i = 0; i < data.length; i += 4 * sampleRate) {
        if (data[i + 3] > 128) {
            pixels.push([data[i], data[i + 1], data[i + 2]]);
        }
    }

    if (pixels.length === 0) return [[128, 128, 128]];

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
        for (const p of bucket) { sum[0] += p[0]; sum[1] += p[1]; sum[2] += p[2]; }
        return [Math.round(sum[0] / bucket.length), Math.round(sum[1] / bucket.length), Math.round(sum[2] / bucket.length)];
    }).sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
}
