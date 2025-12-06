/**
 * Potrace Core - 主入口
 * 
 * 高质量位图转矢量算法
 * 
 * ============================================================================
 * 版权声明 / Credits
 * ============================================================================
 *
 * 本模块的核心算法参考了以下开源项目的实现：
 *
 * 1. VTracer - https://github.com/visioncortex/vtracer
 *    License: MIT
 *    Copyright (c) 2020 Vision Cortex
 *
 * 2. Visioncortex - https://github.com/visioncortex/visioncortex
 *    License: Apache-2.0, MIT (dual-licensed)
 *    Copyright (c) 2020 Vision Cortex
 *
 * 本实现基于上述项目的算法思想进行了 JavaScript 移植和部分修改，
 * 包括但不限于：4-Point Subdivision Scheme、remove_staircase、
 * find_splice_points、retract_handles 等核心算法。
 *
 * 注意：本实现不保证与原始 VTracer/Visioncortex 的输出完全相同，
 * 可能存在参数差异、精度差异或实现细节上的不同。
 *
 * ============================================================================
 */

// 导入所有模块
import { loadCdnLibs, colorDistSq } from './utils.js';
import { kMeansQuantize, medianCutQuantize } from './color-quantize.js';
import { analyzeImageColors } from './color-analysis.js';
import { 
    computeOtsuThreshold, 
    createBinaryBitmap, 
    createBinaryBitmapFromMap,
    morphClose 
} from './binary-image.js';
import { labelConnectedComponents } from './connected-components.js';
import { marchingSquaresContour } from './contour-tracer.js';
import { simplifyPath } from './path-simplify.js';
import { smoothPathPreservingCorners } from './path-smooth.js';
import { 
    processContourVTracer, 
    detectCornersVTracer 
} from './corner-detect.js';
import { 
    fitBezier, 
    fitBezierWithCorners, 
    fitBezierSmooth,
    generatePolygonPath 
} from './curve-fitter.js';
import { PRESETS } from './presets.js';

/**
 * 单次迭代平滑（5点移动平均）
 * 比3点平滑效果更好，能有效去除像素级锯齿
 */
function smoothPathIteration(points) {
    if (points.length < 5) return points;
    const n = points.length;
    const result = [];
    for (let i = 0; i < n; i++) {
        const p0 = points[(i - 2 + n) % n];
        const p1 = points[(i - 1 + n) % n];
        const p2 = points[i];
        const p3 = points[(i + 1) % n];
        const p4 = points[(i + 2) % n];
        result.push({
            x: (p0.x + p1.x + p2.x + p3.x + p4.x) / 5,
            y: (p0.y + p1.y + p2.y + p3.y + p4.y) / 5
        });
    }
    return result;
}

/**
 * 主矢量化函数
 */
export async function vectorize(imageData, options = {}) {
    await loadCdnLibs();

    const {
        numColors = 16,
        colorTolerance = 25,
        pathTolerance = 1.0,
        smoothness = 2.5,
        minPathLength = 16,
        mode = 'spline',
        binaryMode = false,  // lineart 使用二值模式
        blurSigma = 0.5,     // 高斯模糊 - 极小，最大程度保护角点
        morphology = true    // 形态学预处理（只做闭运算）
    } = options;

    const originalWidth = imageData.width;
    const originalHeight = imageData.height;
    let { width, height } = imageData;
    let workingData = imageData;
    let scale = 1;

    // 小图预处理：放大后矢量化效果更好
    const MIN_SIZE = 256;
    const maxDim = Math.max(width, height);
    if (maxDim < MIN_SIZE) {
        scale = Math.ceil(MIN_SIZE / maxDim);
        const newWidth = width * scale;
        const newHeight = height * scale;
        
        // 使用 OffscreenCanvas 或临时 Canvas 放大
        const canvas = typeof OffscreenCanvas !== 'undefined' 
            ? new OffscreenCanvas(newWidth, newHeight)
            : document.createElement('canvas');
        canvas.width = newWidth;
        canvas.height = newHeight;
        const ctx = canvas.getContext('2d');
        
        // 关闭平滑，保持像素边缘（适合 logo/pixel art）
        ctx.imageSmoothingEnabled = false;
        
        // 先把 imageData 画到临时 canvas
        const tempCanvas = typeof OffscreenCanvas !== 'undefined'
            ? new OffscreenCanvas(width, height)
            : document.createElement('canvas');
        tempCanvas.width = width;
        tempCanvas.height = height;
        tempCanvas.getContext('2d').putImageData(imageData, 0, 0);
        
        // 放大绘制
        ctx.drawImage(tempCanvas, 0, 0, newWidth, newHeight);
        workingData = ctx.getImageData(0, 0, newWidth, newHeight);
        
        console.log(`[PotraceCore] 小图放大: ${width}x${height} → ${newWidth}x${newHeight} (${scale}x)`);
        width = newWidth;
        height = newHeight;
    }

    console.log(`[PotraceCore] 矢量化: ${numColors}色, tol=${pathTolerance}, smooth=${smoothness}, binary=${binaryMode}, blur=${blurSigma}`);

    // 1. 颜色量化 (lineart 使用亮度二值化)
    let palette;
    let otsuThreshold = null;

    if (binaryMode || numColors <= 2) {
        // 二值模式：计算 Otsu 阈值，只提取前景色
        otsuThreshold = computeOtsuThreshold(workingData);
        console.log(`[PotraceCore] Otsu 阈值: ${otsuThreshold}`);
        // 只生成前景（暗色）层，背景不需要矢量化
        palette = [[0, 0, 0]];
    } else {
        // 使用 K-Means++ 聚类生成调色板（比 Median Cut 更准确）
        palette = kMeansQuantize(workingData, numColors);
    }
    console.log(`[PotraceCore] 提取 ${palette.length} 种主色`);

    // 2. 为每个像素分配最近的调色板颜色（确保无空白无重叠）
    const pixelColorMap = new Uint8Array(width * height);
    const data = workingData.data;
    const useLuminance = binaryMode || numColors <= 2;
    
    if (!useLuminance) {
        for (let i = 0; i < width * height; i++) {
            const idx = i * 4;
            if (data[idx + 3] > 128) {
                const pixelColor = [data[idx], data[idx + 1], data[idx + 2]];
                let minDist = Infinity;
                let nearestIdx = 0;
                for (let j = 0; j < palette.length; j++) {
                    const dist = colorDistSq(pixelColor, palette[j]);
                    if (dist < minDist) {
                        minDist = dist;
                        nearestIdx = j;
                    }
                }
                pixelColorMap[i] = nearestIdx;
            } else {
                pixelColorMap[i] = 255; // 透明像素标记
            }
        }
    }

    const layers = [];

    // 找出背景色（最亮的颜色）的索引，背景色不需要膨胀
    const backgroundColorIdx = palette.length - 1; // palette 按亮度排序，最后一个最亮

    // 3. 每种颜色生成一个图层（简单高效）
    for (let colorIdx = 0; colorIdx < palette.length; colorIdx++) {
        const color = palette[colorIdx];

        // 背景色不膨胀，前景色膨胀1像素确保无缝隙
        const isBackground = (colorIdx === backgroundColorIdx);
        const dilatePixels = isBackground ? 0 : 1;

        // 使用最近颜色分配（非二值模式）或容差匹配（二值模式）
        const bitmap = useLuminance
            ? createBinaryBitmap(workingData, color, colorTolerance, useLuminance, otsuThreshold, blurSigma, morphology)
            : createBinaryBitmapFromMap(pixelColorMap, colorIdx, width, height, blurSigma, dilatePixels);
        
        // 如果反转了，计算前景的实际颜色
        let actualColor = color;
        if (bitmap.inverted && useLuminance) {
            const sum = [0, 0, 0];
            let count = 0;
            const data = workingData.data;
            for (let i = 0; i < bitmap.data.length; i++) {
                if (bitmap.data[i] === 1) {
                    const idx = i * 4;
                    sum[0] += data[idx];
                    sum[1] += data[idx + 1];
                    sum[2] += data[idx + 2];
                    count++;
                }
            }
            if (count > 0) {
                actualColor = [
                    Math.round(sum[0] / count),
                    Math.round(sum[1] / count),
                    Math.round(sum[2] / count)
                ];
            }
        }
        
        const colorStr = `rgb(${actualColor[0]},${actualColor[1]},${actualColor[2]})`;
        
        // 统计前景像素
        let fgCount = 0;
        for (let i = 0; i < bitmap.data.length; i++) {
            if (bitmap.data[i] === 1) fgCount++;
        }
        if (fgCount < minPathLength) continue;

        // 追踪轮廓
        const contours = marchingSquaresContour(bitmap, null, null, bitmap.grayscale);
        const pathParts = [];

        // 动态面积阈值：基于图像尺寸，过滤孤立小噪点
        // 最小噪点面积 = 图像面积的 0.01%，但至少 4 像素，最多 50 像素
        const totalArea = width * height;
        const minNoiseArea = Math.max(4, Math.min(50, totalArea * 0.0001));
        // 中等轮廓阈值（用于决定是否曲线拟合）
        const mediumContourArea = Math.max(30, minNoiseArea * 3);

        for (const contour of contours) {
            if (contour.points.length < 3) continue;
            
            const contourArea = Math.abs(contour.area);
            const isHole = contour.type === 'inner' || contour.area < 0;
            
            // 只过滤非常小的外轮廓噪点，孔洞保留
            if (!isHole && contourArea < minNoiseArea) {
                continue;
            }
            
            // 中等轮廓直接用多边形（不值得曲线拟合）
            if (contourArea < mediumContourArea || contour.points.length < 12) {
                const pathD = generatePolygonPath(contour.points);
                if (pathD) pathParts.push(pathD);
                continue;
            }

            // VTracer 处理（角点检测 + 局部平滑）
            const processed = processContourVTracer(contour.points, {
                cornerAngle: 110,
                minCornerDist: 2,
                cornerProtectRadius: 3
            });
            let finalPoints = processed.points;

            // 3. 大轮廓采样（限制点数提升性能）
            if (finalPoints.length > 500) {
                const step = finalPoints.length / 500;
                const sampled = [];
                for (let i = 0; i < 500; i++) {
                    sampled.push(finalPoints[Math.floor(i * step)]);
                }
                finalPoints = sampled;
            }

            if (finalPoints.length < 3) continue;

            // 4. 曲线拟合（误差基于 pathTolerance）
            const fitError = Math.max(0.5, pathTolerance * 2);
            const pathD = mode === 'spline'
                ? fitBezierSmooth(finalPoints, fitError)
                : generatePolygonPath(finalPoints);

            if (pathD) pathParts.push(pathD);
        }
        
        if (pathParts.length > 0) {
            const fillRule = useLuminance ? 'evenodd' : 'nonzero';
            layers.push({
                color: colorStr,
                colorRgb: actualColor,
                paths: [{
                    d: pathParts.join(' '),
                    fill: colorStr,
                    fillRule,
                    stroke: 'none',
                    strokeWidth: 0
                }]
            });
        }
    }
    
    // 全局后处理：基于所有图层中最大轮廓面积过滤小碎片图层
    // 找到全局最大轮廓面积
    let globalMaxArea = 0;
    for (const layer of layers) {
        for (const path of layer.paths) {
            // 从 path.d 估算面积（用边界框近似）
            const matches = path.d.match(/[-+]?\d*\.?\d+/g);
            if (matches && matches.length >= 4) {
                const nums = matches.map(Number);
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                for (let i = 0; i < nums.length - 1; i += 2) {
                    minX = Math.min(minX, nums[i]);
                    maxX = Math.max(maxX, nums[i]);
                    minY = Math.min(minY, nums[i + 1]);
                    maxY = Math.max(maxY, nums[i + 1]);
                }
                const area = (maxX - minX) * (maxY - minY);
                if (area > globalMaxArea) globalMaxArea = area;
            }
        }
    }
    
    // 过滤掉面积远小于全局最大（1:500 比例）的图层，更宽松避免误删
    const minLayerArea = Math.max(4, globalMaxArea / 500);
    const filteredLayers = layers.filter(layer => {
        // 计算该图层的总面积
        let layerArea = 0;
        for (const path of layer.paths) {
            const matches = path.d.match(/[-+]?\d*\.?\d+/g);
            if (matches && matches.length >= 4) {
                const nums = matches.map(Number);
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                for (let i = 0; i < nums.length - 1; i += 2) {
                    minX = Math.min(minX, nums[i]);
                    maxX = Math.max(maxX, nums[i]);
                    minY = Math.min(minY, nums[i + 1]);
                    maxY = Math.max(maxY, nums[i + 1]);
                }
                layerArea += (maxX - minX) * (maxY - minY);
            }
        }
        return layerArea >= minLayerArea;
    });
    
    console.log(`[PotraceCore] 生成 ${layers.length} 个颜色图层，过滤后 ${filteredLayers.length} 个`);

    // 4. 生成 SVG（反转顺序：亮色在底，暗色在上）
    // layers 按亮度从暗到亮排序，SVG 需要先绘制亮色（底层），后绘制暗色（顶层）
    const reversedLayers = filteredLayers.slice().reverse();
    const allPaths = reversedLayers.flatMap(l => l.paths);
    const svgContent = allPaths.map(p => {
        const fillRule = p.fillRule ? ` fill-rule="${p.fillRule}"` : '';
        return `<path d="${p.d}" fill="${p.fill}"${fillRule} stroke="${p.stroke}" stroke-width="${p.strokeWidth}"/>`;
    }).join('\n');
    
    // SVG 使用原始尺寸，viewBox 使用工作尺寸（放大后），浏览器会自动缩放
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${originalWidth}" height="${originalHeight}" viewBox="0 0 ${width} ${height}">\n${svgContent}\n</svg>`;
    
    return {
        svg,
        width: originalWidth,
        height: originalHeight,
        // 路径坐标的实际范围（放大后的工作尺寸），用于生成单层 SVG 的 viewBox
        viewBoxWidth: width,
        viewBoxHeight: height,
        layers: filteredLayers,
        paths: allPaths,
        colors: palette.map(c => `rgb(${c[0]},${c[1]},${c[2]})`),
        engine: 'potrace-core-v2'
    };
}

/**
 * 使用预设进行矢量化
 */
export function vectorizeWithPreset(imageData, presetName = 'auto') {
    // 自动模式：分析图片颜色，自动选择最佳参数
    if (presetName === 'auto') {
        const analysis = analyzeImageColors(imageData);
        const basePreset = PRESETS[analysis.recommendedPreset] || PRESETS.logo;
        
        // 使用预设的默认 numColors，不根据聚类数量调整
        // 这样确保有足够的颜色槽位提取小面积颜色
        const autoOptions = { ...basePreset };
        
        console.log(`[PotraceCore] 自动模式: ${analysis.recommendedPreset}, ${autoOptions.numColors}色`);
        return vectorize(imageData, autoOptions);
    }
    
    const preset = PRESETS[presetName] || PRESETS.logo;
    return vectorize(imageData, preset);
}

// ============ 导出 ============

/**
 * PotraceCore - 兼容层
 * 
 * 推荐使用新的 ES Module 版本:
 * import { Vectorizer } from './vectorizer/index.js';
 * 
 * 新版本包含:
 * - VTracer 4-Point Subdivision Scheme 平滑算法
 * - Splice Point Detection 曲线分段
 * - remove_staircase 锯齿移除
 * - retract_handles 控制点修正
 */
export const PotraceCore = {
    vectorize,
    vectorizeWithPreset,
    analyzeImageColors,
    kMeansQuantize,      // K-Means++ 聚类（推荐）
    medianCutQuantize,   // Median Cut（备用）
    labelConnectedComponents,
    marchingSquaresContour,
    simplifyPath,
    fitBezier,
    PRESETS,
    
    // VTracer 新增函数
    processContourVTracer,
    detectCornersVTracer,
    smoothPathPreservingCorners,
    fitBezierWithCorners,
    fitBezierSmooth
};

// 默认导出
export default PotraceCore;

// 重新导出所有子模块供按需导入
export * from './utils.js';
export * from './color-quantize.js';
export * from './color-analysis.js';
export * from './binary-image.js';
export * from './connected-components.js';
export * from './contour-tracer.js';
export * from './path-simplify.js';
export * from './path-smooth.js';
export * from './corner-detect.js';
export * from './curve-fitter.js';
export { PRESETS } from './presets.js';
