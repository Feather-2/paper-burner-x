/**
 * Potrace Core - 颜色分析模块
 * 
 * 分析图片颜色特征，自动决定最佳参数
 */

/**
 * 分析图片颜色特征，自动决定最佳参数
 */
export function analyzeImageColors(imageData, clusterThreshold = 25) {
    const { data, width, height } = imageData;
    const colorMap = new Map(); // 颜色 -> 像素数量
    const totalPixels = width * height;
    
    // 1. 统计所有颜色（量化到 5-bit 减少噪点）
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 128) continue; // 跳过透明
        // 量化颜色 (32 级)
        const r = Math.round(data[i] / 8) * 8;
        const g = Math.round(data[i + 1] / 8) * 8;
        const b = Math.round(data[i + 2] / 8) * 8;
        const key = (r << 16) | (g << 8) | b;
        colorMap.set(key, (colorMap.get(key) || 0) + 1);
    }
    
    // 2. 转换为颜色数组
    const colors = [];
    for (const [key, count] of colorMap) {
        if (count < 10) continue; // 过滤噪点
        colors.push({
            r: (key >> 16) & 0xff,
            g: (key >> 8) & 0xff,
            b: key & 0xff,
            count
        });
    }
    
    // 3. 颜色聚类 (简单的贪婪聚类)
    const clusters = [];
    const sorted = colors.sort((a, b) => b.count - a.count); // 按数量排序
    
    for (const color of sorted) {
        let merged = false;
        for (const cluster of clusters) {
            const dist = Math.sqrt(
                Math.pow(color.r - cluster.r, 2) +
                Math.pow(color.g - cluster.g, 2) +
                Math.pow(color.b - cluster.b, 2)
            );
            if (dist < clusterThreshold) {
                // 合并到现有聚类（加权平均）
                const total = cluster.count + color.count;
                cluster.r = Math.round((cluster.r * cluster.count + color.r * color.count) / total);
                cluster.g = Math.round((cluster.g * cluster.count + color.g * color.count) / total);
                cluster.b = Math.round((cluster.b * cluster.count + color.b * color.count) / total);
                cluster.count = total;
                merged = true;
                break;
            }
        }
        if (!merged) {
            clusters.push({ ...color });
        }
    }
    
    // 4. 计算特征
    const uniqueColors = colorMap.size;
    const clusterCount = clusters.length;
    const dominantColors = clusters.slice(0, 10); // 前10主色
    
    // 判断是否是二值图（黑白/线稿）- 允许抗锯齿带来的额外颜色
    const isBinary = clusterCount <= 4;
    
    // 判断是否是像素画（颜色数量中等，边界清晰）
    const isPixelArt = uniqueColors > 10 && uniqueColors < 500 && clusterCount < 32;
    
    // 判断是否是照片（颜色数量很多）
    const isPhoto = uniqueColors > 1000 || clusterCount > 50;
    
    // 5. 自动选择预设
    let recommendedPreset = 'logo';
    let recommendedNumColors = Math.min(64, Math.max(8, clusterCount));
    
    if (isBinary) {
        recommendedPreset = 'lineart';
        recommendedNumColors = 2;
    } else if (isPixelArt) {
        recommendedPreset = 'pixel';
        recommendedNumColors = Math.min(32, clusterCount + 4);
    } else if (isPhoto) {
        recommendedPreset = 'photo';
        recommendedNumColors = 64;
    } else if (clusterCount <= 8) {
        recommendedPreset = 'simple';
        recommendedNumColors = clusterCount;
    } else if (clusterCount <= 24) {
        recommendedPreset = 'logo';
        recommendedNumColors = clusterCount + 2;
    } else {
        recommendedPreset = 'illustration';
        recommendedNumColors = Math.min(48, clusterCount);
    }
    
    console.log(`[ColorAnalysis] 独特颜色: ${uniqueColors}, 聚类后: ${clusterCount}, 推荐: ${recommendedPreset} (${recommendedNumColors}色)`);
    
    return {
        uniqueColors,
        clusterCount,
        clusters: dominantColors.map(c => [c.r, c.g, c.b]),
        isBinary,
        isPixelArt,
        isPhoto,
        recommendedPreset,
        recommendedNumColors
    };
}
