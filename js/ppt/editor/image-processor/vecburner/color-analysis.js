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
    const sorted = colors.sort((a, b) => b.count - a.count); // 按数量排序
    const clusters = performGreedyClustering(sorted, clusterThreshold);
    
    // 4. 计算特征
    const uniqueColors = colorMap.size;
    const clusterCount = clusters.length;
    const dominantColors = clusters.slice(0, 10); // 前10主色
    
    // 判断是否是二值图（黑白/线稿）- 允许抗锯齿带来的额外颜色
    const isBinary = clusterCount <= 4;
    
    // 计算颜色变异率：每个主色平均对应的独特颜色数量
    // 真正的像素画变异率低（< 3），边缘锐利
    // 抗锯齿的 Logo/图标变异率高（> 3），有很多过渡色
    const variationRatio = uniqueColors / (clusterCount || 1);
    
    // 判断是否是像素画（颜色数量中等，边界清晰）
    // 必须同时满足：
    // 1. 聚类数适中 (< 64)
    // 2. 变异率低 (< 3)：说明没有大量的抗锯齿过渡色
    const isPixelArt = uniqueColors < 256 && clusterCount < 64 && variationRatio < 3.0;
    
    // 判断是否是照片（颜色数量很多）- 提高阈值，不轻易判定为照片
    const isPhoto = uniqueColors > 5000 && clusterCount > 100;
    
    // 5. 自动选择预设
    let recommendedPreset = 'logo';
    let recommendedNumColors = Math.min(64, Math.max(8, clusterCount));
    
    // 二次聚类优化：
    // 如果初步判断是 Logo 或简单的插画，尝试用更大的阈值重新聚类
    // 这样能更准确地通过抗锯齿噪点看到真正的“主色”数量
    if (!isPhoto && !isBinary && !isPixelArt && clusterCount > 4 && clusterCount < 64) {
        const aggressiveThreshold = 90; // 更大的合并半径 (60 -> 90)
        // 使用原始颜色列表（sorted）进行二次聚类，而不是用已经聚类过的 clusters
        const reClusters = performGreedyClustering(sorted, aggressiveThreshold);
        const reClusterCount = reClusters.length;
        
        console.log(`[ColorAnalysis] Logo模式二次聚类: ${clusterCount} -> ${reClusterCount}`);
        
        if (reClusterCount < clusterCount) {
            // 使用二次聚类的结果作为推荐
            if (reClusterCount <= 8) {
                recommendedPreset = 'simple';
                recommendedNumColors = reClusterCount;
            } else if (reClusterCount <= 24) {
                recommendedPreset = 'logo';
                recommendedNumColors = reClusterCount + 2; // 略微冗余防止欠拟合
            } else {
                recommendedPreset = 'illustration';
                recommendedNumColors = Math.min(32, reClusterCount + 4);
            }
        }
    } else {
        // 原有逻辑保持不变
        if (isBinary) {
            recommendedPreset = 'lineart';
            recommendedNumColors = 2;
        } else if (isPixelArt) {
            recommendedPreset = 'pixel';
            recommendedNumColors = Math.min(32, clusterCount + 4);
        } else if (isPhoto) {
            // 即使是照片也优先用 illustration，photo 预设只在手动选择时使用
            recommendedPreset = 'illustration';
            recommendedNumColors = 48;
        } else if (clusterCount <= 8) {
            recommendedPreset = 'simple';
            recommendedNumColors = clusterCount;
        } else if (clusterCount <= 32) {
            // 提高 Logo 的阈值覆盖 Weibo 这种（23色）
            recommendedPreset = 'logo';
            // Logo 并不需要那么多颜色，强制限制在 16 色以内，迫使 K-Means 合并相似色
            recommendedNumColors = Math.min(16, clusterCount + 2);
        } else {
            recommendedPreset = 'illustration';
            recommendedNumColors = Math.min(48, clusterCount);
        }
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

/**
 * 执行贪婪聚类
 */
function performGreedyClustering(colors, threshold) {
    const clusters = [];
    // 深拷贝颜色对象，以免修改原数组
    const sortedColors = colors.map(c => ({ ...c }));
    
    for (const color of sortedColors) {
        let merged = false;
        for (const cluster of clusters) {
            const dist = Math.sqrt(
                Math.pow(color.r - cluster.r, 2) +
                Math.pow(color.g - cluster.g, 2) +
                Math.pow(color.b - cluster.b, 2)
            );
            if (dist < threshold) {
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
    return clusters;
}
