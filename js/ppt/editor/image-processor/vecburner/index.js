/**
 * Vecburner - 高质量位图转矢量引擎
 * 
 * A Paper Burner Project
 * https://github.com/Feather-2/paper-burner-x
 * 
 * @version 1.0.0
 * @license MIT
 * 
 * ============================================================================
 * 致谢 / Credits
 * ============================================================================
 *
 * 本模块的部分算法参考了以下开源项目：
 *
 * VTracer & Visioncortex
 *   https://github.com/visioncortex/vtracer
 *   https://github.com/visioncortex/visioncortex
 *   License: MIT / Apache-2.0 (dual-licensed)
 *   Copyright (c) 2020 Vision Cortex
 *
 *   参考的算法：
 *   - 4-Point Subdivision Scheme（路径细分平滑）
 *   - remove_staircase（阶梯锯齿去除）
 *   - retract_handles（贝塞尔控制点回缩）
 *   - 径向距离 + RDP 路径简化
 *   - 角点检测与保护
 *
 * fit-curve
 *   https://github.com/soswow/fit-curve
 *   License: MIT
 *   用于贝塞尔曲线拟合
 *
 * ============================================================================
 * 原创部分
 * ============================================================================
 *
 * - K-Means++ 颜色量化与边缘色过滤
 * - Marching Squares 亚像素轮廓追踪
 * - 自适应小图放大与像素画检测
 * - 多预设智能选择系统
 * - 分块矢量化（实验性）
 *
 * ============================================================================
 */

// 导入所有模块
import { loadCdnLibs, colorDistSq, denoisePixelMap } from './utils.js';
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
import { traceContoursVTracer, traceContoursHybrid } from './path-walker.js';
import { simplifyPath, removeStaircase, limitPenalties } from './path-simplify.js';
import { chaikinSmooth, chaikinSmoothPreserveCorners, simplifyRDPClosed as simplifyPathRDP, reduceVTracer } from './path-smooth.js';
import { 
    processContourVTracer, 
    detectCornersVTracer 
} from './corner-detect.js';
import { 
    fitBezier, 
    fitBezierWithCorners, 
    fitBezierSmooth,
    fitBezierCatmullRom,
    generatePolygonPath,
    retractHandles
} from './curve-fitter.js';
import { PRESETS } from './presets.js';
import { simplifyPathD, simplifyVectorResult, getSimplifyPreview } from './path-simplifier.js';

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
        morphology = true,   // 形态学预处理（只做闭运算）
        contourMethod = 'marching'  // 轮廓追踪方法: 'marching' | 'vtracer' | 'hybrid'
    } = options;

    const originalWidth = imageData.width;
    const originalHeight = imageData.height;
    let { width, height } = imageData;
    let workingData = imageData;
    let scale = 1;

    // 小图预处理：放大后矢量化效果更好
    const MIN_SIZE = 256;
    const maxDim = Math.max(width, height);
    
    // 定义有效模糊系数（提升作用域，防止 ReferenceError）
    let effectiveBlurSigma = blurSigma;
    
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
        
        // 智能选择插值算法
        // 像素画：关闭平滑，保持锐利边缘
        // 照片、插画、Logo、线稿：开启平滑，避免引入阶梯锯齿
        const isPixelArtPreset = (options && options.preset === 'pixel');
        const isBinary = binaryMode || (options && options.preset === 'lineart');
        
        // 仅在明确是像素画预设时才视为像素画模式
        // 注意：Logo (低颜色) 和 Lineart (二值) 需要曲线拟合，不能视为像素画
        const isPixelArt = isPixelArtPreset;
        
        // 放大时的平滑策略：
        // 像素画：必须关闭平滑
        // 二值图/Logo/照片：开启平滑，利用插值获得更平滑的边缘
        ctx.imageSmoothingEnabled = !isPixelArt;
        
        // 如果是像素画，强制禁用高斯模糊，保留锐利边缘
        effectiveBlurSigma = isPixelArt ? 0 : blurSigma;
        
        // 先把 imageData 画到临时 canvas(width, height)
        const tempCanvas = typeof OffscreenCanvas !== 'undefined'
            ? new OffscreenCanvas(width, height)
            : document.createElement('canvas');
        tempCanvas.width = width;
        tempCanvas.height = height;
        tempCanvas.getContext('2d').putImageData(imageData, 0, 0);
        
        // 放大绘制
        ctx.drawImage(tempCanvas, 0, 0, newWidth, newHeight);
        workingData = ctx.getImageData(0, 0, newWidth, newHeight);
        
        console.log(`[Vecburner] 小图放大: ${width}x${height} → ${newWidth}x${newHeight} (${scale}x), 平滑: ${!isPixelArt}`);
        width = newWidth;
        height = newHeight;
    }

    console.log(`[Vecburner] 矢量化: ${numColors}色, tol=${pathTolerance}, smooth=${smoothness}, binary=${binaryMode}, blur=${blurSigma}`);

    // 1. 颜色量化 (lineart 使用亮度二值化)
    let palette;
    let otsuThreshold = null;

    if (binaryMode || numColors <= 2) {
        // 二值模式：计算 Otsu 阈值，只提取前景色
        otsuThreshold = computeOtsuThreshold(workingData);
        console.log(`[Vecburner] Otsu 阈值: ${otsuThreshold}`);
        // 只生成前景（暗色）层，背景不需要矢量化
        palette = [[0, 0, 0]];
    } else {
        // 使用 K-Means++ 聚类生成调色板（比 Median Cut 更准确）
        palette = kMeansQuantize(workingData, numColors);
        
        // 智能合并相近颜色 (Post-Quantization Merge)
        // 对于 Logo/插画模式，合并距离过近的颜色，减少无意义的过渡层
        if (options && options.preset !== 'photo' && options.preset !== 'pixel' && palette.length > 2) {
            const mergedPalette = [];
            const mergedIndices = new Set();
            
            // 根据预设调整合并阈值
            // Logo 模式更激进 (90)，合并阴影和抗锯齿色
            // 插画模式较保守 (35)，保留细节
            const thresholdVal = (options.preset === 'logo' || options.preset === 'simple') ? 45 : 35;
            const mergeThreshold = thresholdVal * thresholdVal;
            
            // 灰度/低饱和度颜色的额外容差系数
            // 允许黑、深灰、浅灰在更大范围内合并
            // 提升到 4.0 (即距离翻倍)，强力合并所有灰色到黑色
            const neutralThresholdMult = 16.0; 
            
            // 迭代合并直到收敛
            let changed = true;
            let currentPalette = palette;
            
            while (changed && currentPalette.length > 2) {
                changed = false;
                const nextPalette = [];
                const merged = new Set();
                
                // 按亮度排序，有助于合并相邻色
                currentPalette.sort((a, b) => (a[0]+a[1]+a[2]) - (b[0]+b[1]+b[2]));
                
                // 背景色修正：如果最亮的颜色接近白色 (>230)，强制设为纯白
                // 解决“提取背景比原始深”的问题
                const lastIdx = currentPalette.length - 1;
                const brightest = currentPalette[lastIdx];
                if (brightest[0] > 230 && brightest[1] > 230 && brightest[2] > 230) {
                    currentPalette[lastIdx] = [255, 255, 255];
                }
                
                for (let i = 0; i < currentPalette.length; i++) {
                    if (merged.has(i)) continue;
                    
                    let baseColor = currentPalette[i];
                    let count = 1;
                    
                    // 判断基准色是否为中性色（R,G,B 差异小）
                    // 放宽中性色判定 (20 -> 30)，覆盖略带色偏的灰
                    const isBaseNeutral = Math.max(baseColor[0], baseColor[1], baseColor[2]) - Math.min(baseColor[0], baseColor[1], baseColor[2]) < 30;
                    const baseLum = (baseColor[0] + baseColor[1] + baseColor[2]) / 3;
                    
                    // 寻找最近的一个颜色进行合并 (贪婪策略：只合并不合并群组)
                    // 修改策略：一次遍历合并所有近邻
                    for (let j = i + 1; j < currentPalette.length; j++) {
                        if (merged.has(j)) continue;
                        
                        const targetLum = (currentPalette[j][0] + currentPalette[j][1] + currentPalette[j][2]) / 3;
                        
                        // 特殊规则：极亮颜色强力合并 (去除背景杂色/边缘光晕)
                        // 如果两个颜色都很亮 (>210)，且差异较小，强制合并
                        if (baseLum > 210 && targetLum > 210) {
                             if (colorDistSq(baseColor, currentPalette[j]) < 2500) { // 50^2
                                // 合并到更亮的一方（通常是背景）
                                baseColor = targetLum > baseLum ? currentPalette[j] : baseColor;
                                count++; // 这里不再平均，直接吞噬
                                merged.add(j);
                                changed = true;
                                continue;
                             }
                        }
                        
                        // 判断目标色是否为中性色
                        const isTargetNeutral = Math.max(currentPalette[j][0], currentPalette[j][1], currentPalette[j][2]) - Math.min(currentPalette[j][0], currentPalette[j][1], currentPalette[j][2]) < 30;
                        
                        // 如果两个都是中性色（都是灰度系），放宽阈值
                        const currentThreshold = (isBaseNeutral && isTargetNeutral) 
                            ? mergeThreshold * neutralThresholdMult 
                            : mergeThreshold;
                        
                        if (colorDistSq(baseColor, currentPalette[j]) < currentThreshold) {
                            baseColor = [
                                (baseColor[0] * count + currentPalette[j][0]) / (count + 1),
                                (baseColor[1] * count + currentPalette[j][1]) / (count + 1),
                                (baseColor[2] * count + currentPalette[j][2]) / (count + 1)
                            ];
                            count++;
                            merged.add(j);
                            changed = true;
                        }
                    }
                    nextPalette.push(baseColor.map(Math.round));
                }
                currentPalette = nextPalette;
            }
            
            if (currentPalette.length < palette.length) {
                console.log(`[Vecburner] 智能合并颜色 (${options.preset}): ${palette.length} → ${currentPalette.length}`);
                palette = currentPalette;
            }
        }
    }
    console.log(`[Vecburner] 提取 ${palette.length} 种主色`);

    // 2. 为每个像素分配最近的调色板颜色
    const pixelColorMap = new Uint8Array(width * height);
    const data = workingData.data;
    const useLuminance = binaryMode || numColors <= 2;
    
    // 这里的 isPixelArt 需要重新定义，因为上面是在 if 块里的
    const isPixelArt = (options && options.preset === 'pixel');

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
        
        // 去噪：消除孤立像素，防止产生微小空洞
        // 像素画模式下禁用去噪，因为单个像素可能是重要细节（如眼睛）
        if (!isPixelArt) {
            // 迭代 2 次以获得更好的平滑效果
            denoisePixelMap(pixelColorMap, width, height, 2);
        }
    }

    const layers = [];

    // 找出背景色（最亮的颜色）的索引，背景色不需要膨胀
    const backgroundColorIdx = palette.length - 1; // palette 按亮度排序，最后一个最亮

    // 3. 每种颜色生成一个图层（简单高效）
    for (let colorIdx = 0; colorIdx < palette.length; colorIdx++) {
        const color = palette[colorIdx];

        // 轻度膨胀确保层重叠
        // 膨胀量：改为 0，完全不膨胀，避免内容变粗
        // 缝隙问题由 Marching Squares 亚像素追踪解决
        const dilatePixels = 0;

        // 使用最近颜色分配（非二值模式）或容差匹配（二值模式）
        // **VM(基于公开资料) 风格**：传入原始图像和调色板，利用混色信息做亚像素定位
        const bitmap = useLuminance
            ? createBinaryBitmap(workingData, color, colorTolerance, useLuminance, otsuThreshold, effectiveBlurSigma, morphology)
            : createBinaryBitmapFromMap(pixelColorMap, colorIdx, width, height, effectiveBlurSigma, dilatePixels, workingData, palette);
        
        // 二值模式（lineart）：强制使用黑色作为前景色
        // 不再根据反转状态计算实际颜色，始终输出标准的白底黑线
        let actualColor = color;
        if (useLuminance) {
            // 强制黑色前景，无论原图是什么颜色
            actualColor = [0, 0, 0];
        }

        const colorStr = `rgb(${actualColor[0]},${actualColor[1]},${actualColor[2]})`;
        
        // 统计前景像素
        let fgCount = 0;
        for (let i = 0; i < bitmap.data.length; i++) {
            if (bitmap.data[i] === 1) fgCount++;
        }
        
        // 像素画允许更小的路径
        if (fgCount < (isPixelArt ? 1 : minPathLength)) continue;

        // 追踪轮廓 - 支持不同算法
        let contours;
        if (contourMethod === 'vtracer') {
            // VTracer 风格：4方向追踪，输出点少，无锯齿
            contours = traceContoursVTracer(bitmap.data, width, height);
        } else if (contourMethod === 'hybrid') {
            // 混合模式：VTracer + 亚像素精细化
            contours = traceContoursHybrid(bitmap.data, width, height, bitmap.grayscale);
        } else {
            // 默认：Marching Squares，亚像素精度高
            contours = marchingSquaresContour(bitmap, null, null, bitmap.grayscale);
        }
        
        // 检测碎片图层（边缘抗锯齿色）：很多小轮廓，没有大轮廓
        // 对于高颜色数（photo模式），禁用碎片过滤，因为颜色分布分散是正常的
        const imageArea = width * height;
        
        // Logo 模式也启用碎片过滤，防止出现全是噪点的图层
        const shouldCheckFragmented = (!isPixelArt && numColors <= 8) || (options && options.preset === 'logo');
        
        if (shouldCheckFragmented) {
            // 只在极低颜色数模式下启用碎片过滤（logo/lineart）
            const contourAreas = contours.map(c => Math.abs(c.area));
            const maxContourArea = Math.max(...contourAreas, 0);
            const totalContourArea = contourAreas.reduce((a, b) => a + b, 0);
            
            // 碎片图层检测：总面积占图像 < 0.5% 且没有大轮廓（最大 < 300）且轮廓数量 > 10
            // 更严格的条件，避免误删有意义的小图形
            const isFragmented = 
                totalContourArea < imageArea * 0.005 && 
                maxContourArea < 300 && 
                contours.length > 10;
            
            if (isFragmented) {
                console.log(`[Vecburner] 跳过碎片图层: ${contours.length} 个轮廓, 最大 ${maxContourArea.toFixed(0)}, 总 ${totalContourArea.toFixed(0)}`);
                continue;
            }
        }
        
        const pathParts = [];

        // 动态面积阈值：基于图像尺寸，过滤孤立小噪点
        // 最小噪点面积 = 图像面积的 0.01%，但至少 4 像素，最多 50 像素
        const totalArea = width * height;
        
        let minNoiseArea;
        if (isPixelArt) {
            minNoiseArea = 1;
        } else if (options && options.preset === 'logo') {
            // Logo 模式：更激进地过滤噪点 (0.1% 或至少 25px)，去除“奇怪的点”
            minNoiseArea = Math.max(25, Math.min(200, totalArea * 0.001));
        } else {
            minNoiseArea = Math.max(4, Math.min(50, totalArea * 0.0001));
        }
        
        // 中等轮廓阈值（用于决定是否曲线拟合）
        const mediumContourArea = Math.max(30, minNoiseArea * 3);

        for (const contour of contours) {
            if (contour.points.length < 3) continue;
            
            const contourArea = Math.abs(contour.area);
            const isHole = contour.type === 'inner' || contour.area < 0;
            
            // 过滤噪点逻辑优化：
            if (isPixelArt) {
                // 像素画：保留几乎所有细节，只过滤 0 面积
                if (contourArea < 0.5) continue;
            } else {
                // 非像素画（Logo, Lineart, Photo）：
                // 1. 过滤微小的外轮廓噪点 (杂点)
                if (!isHole && contourArea < minNoiseArea) continue;
                
                // 2. 过滤极微小的孔洞 (内部噪点)，但要比外轮廓更保守以防堵死字母
                // 阈值设为 minNoiseArea 的一半，且至少 2 像素
                const minHoleArea = Math.max(2, minNoiseArea * 0.5);
                if (isHole && contourArea < minHoleArea) continue;
            }
            
            // 像素画特殊处理：保持像素边缘，不做平滑和曲线拟合
            if (isPixelArt) {
                // 使用 RDP 算法简化路径
                // 阈值 0.75: 能有效抹平 1px 的微小抖动/锯齿，将其拉直为斜线或直线
                // 既保留了像素画的硬朗风格，又消除了过多的细碎阶梯（抖动）
                const simplifiedPts = simplifyPathRDP(contour.points, 0.75);
                const pathD = generatePolygonPath(simplifiedPts);
                if (pathD) pathParts.push(pathD);
                continue;
            }
            
            // 中等轮廓直接用多边形（不值得曲线拟合）
            if (contourArea < mediumContourArea || contour.points.length < 12) {
                const pathD = generatePolygonPath(contour.points);
                if (pathD) pathParts.push(pathD);
                continue;
            }

            // 动态处理策略
            let pts = contour.points;
            const perimeter = pts.length;
            const area = Math.abs(contour.area);
            
            // 小轮廓：先放大坐标处理，再缩回（提高精度）
            const isSmall = area < 500 || perimeter < 40;
            const upscale = isSmall ? 3 : 1;
            
            if (upscale > 1) {
                pts = pts.map(p => ({ x: p.x * upscale, y: p.y * upscale }));
            }
            
            // RDP 容差
            const dynamicEpsilon = (perimeter < 50 ? 0.4 : 
                                    perimeter < 100 ? 0.5 : 0.6) * upscale;
            
            // 1. VTracer 风格简化（径向预处理 + RDP）
            pts = reduceVTracer(pts, dynamicEpsilon);
            
            // 2. 检测角点
            const cornerIndices = new Set();
            for (let i = 0; i < pts.length; i++) {
                const prev = pts[(i - 1 + pts.length) % pts.length];
                const curr = pts[i];
                const next = pts[(i + 1) % pts.length];
                
                const v1x = prev.x - curr.x, v1y = prev.y - curr.y;
                const v2x = next.x - curr.x, v2y = next.y - curr.y;
                const dot = v1x * v2x + v1y * v2y;
                const len1 = Math.sqrt(v1x * v1x + v1y * v1y);
                const len2 = Math.sqrt(v2x * v2x + v2y * v2y);
                
                if (len1 > 0 && len2 > 0) {
                    const cos = dot / (len1 * len2);
                    const angle = Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
                    // 放宽角点阈值 (120 -> 140)，更积极地保留角点，防止直角/钝角被平滑掉
                    if (angle < 140) cornerIndices.add(i);
                }
            }
            
            // 3. Chaikin 平滑
            // 使用预设的 smoothness 控制迭代次数 (0-3)
            // 像素画模式下 smoothness 通常为 0，即不平滑
            const smoothIter = Math.max(0, Math.round(smoothness));
            if (smoothIter > 0) {
                pts = chaikinSmoothPreserveCorners(pts, smoothIter, cornerIndices);
            }
            
            // 缩回原始尺寸
            if (upscale > 1) {
                pts = pts.map(p => ({ x: p.x / upscale, y: p.y / upscale }));
            }
            
            if (pts.length < 3) continue;

            // 4. 曲线拟合 - 优先使用 fit-curve（节点更少更优化）
            let pathD;
            const ptsArray = pts.map(p => [p.x, p.y]);
            
            // 检查 fitCurve 是否可用（支持主线程 window 和 Worker self）
            const globalObj = typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : null);
            const fitCurveFn = globalObj && typeof globalObj.fitCurve === 'function' ? globalObj.fitCurve : null;
            
            if (fitCurveFn) {
                try {
                    // fit-curve - 智能容差
                    // 容差越大 = 曲线越平滑（抹平锯齿）
                    // 容差越小 = 越贴合原始点（保留锯齿）
                    const baseError = Math.max(0.8, pathTolerance);
                    const sizeBonus = perimeter > 100 ? Math.min(0.5, (perimeter - 100) / 500) : 0;
                    const fitError = baseError + sizeBonus;  // 范围约 0.8 ~ 1.5
                    
                    let curves = fitCurveFn(ptsArray, fitError);
                    
                    if (curves && curves.length > 0) {
                        // 应用 retractHandles 防止过冲
                        // 注意：孔洞（内轮廓）不回缩，避免孔洞缩小
                        if (!isHole) {
                            curves = curves.map(c => retractHandles(c, {
                                maxRatio: 0.6,   // 略高于半圆理论值 0.552，获得更平滑的弧线
                                minRatio: 0.7,   // 小曲线更宽松
                                smallThreshold: 25
                            }));
                        }
                        
                        pathD = `M${curves[0][0][0].toFixed(2)},${curves[0][0][1].toFixed(2)}`;
                        for (const c of curves) {
                            pathD += `C${c[1][0].toFixed(2)},${c[1][1].toFixed(2)},${c[2][0].toFixed(2)},${c[2][1].toFixed(2)},${c[3][0].toFixed(2)},${c[3][1].toFixed(2)}`;
                        }
                        pathD += 'Z';
                    }
                } catch (e) {
                    console.warn('[Vecburner] fit-curve 失败，回退到 Catmull-Rom');
                }
            }
            
            // 回退：Catmull-Rom
            if (!pathD) {
                pathD = fitBezierCatmullRom(pts, 0.2);
            }

            if (pathD) pathParts.push(pathD);
        }
        // 5. 缝隙修补 (Gap Fixing)
        // 平滑算法(Chaikin/CurveFit)会使路径略微向内收缩，导致色块间出现细微缝隙(Conflation Artifacts)
        // 解决方案：添加同色描边，利用描边向外扩张填补缝隙
        // 像素画(Pixel Art)：通常不对齐会导致形状改变，且网格本身是严丝合缝的，故不加粗
        // 其他模式(Photo/Logo)：添加 1px 描边，使用 round join 获得平滑连接
        const useStroke = !isPixelArt;
        const strokeColor = useStroke ? colorStr : 'none';
        // 放大比例较大时，描边宽度相对变小，这里固定为 1px (工作空间坐标系)
        // 如果是在小图上处理，1px 可能会太粗，但由于我们在开头做了放大处理 (scale)，这里的 1px 是相对安全的
        const strokeWidth = useStroke ? 1 : 0;
        const strokeLineJoin = useStroke ? 'round' : 'miter';

        if (pathParts.length > 0) {
            const fillRule = useLuminance ? 'evenodd' : 'nonzero';
            layers.push({
                color: colorStr,
                colorRgb: actualColor,
                paths: [{
                    d: pathParts.join(' '),
                    fill: colorStr,
                    fillRule,
                    stroke: strokeColor,
                    strokeWidth: strokeWidth,
                    strokeLineJoin: strokeLineJoin
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
    // 增加上限：最大阈值不超过 100 像素，防止大图中误删有效的小图层
    // 像素画模式下完全禁用过滤，保留所有像素
    const minLayerArea = isPixelArt ? 0 : Math.max(4, Math.min(100, globalMaxArea / 500));
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
    
    console.log(`[Vecburner] 生成 ${layers.length} 个颜色图层，过滤后 ${filteredLayers.length} 个`);

    // 4. 生成 SVG（反转顺序：亮色在底，暗色在上）
    // layers 按亮度从暗到亮排序，SVG 需要先绘制亮色（底层），后绘制暗色（顶层）
    const reversedLayers = filteredLayers.slice().reverse();
    const allPaths = reversedLayers.flatMap(l => l.paths);
    
    // 添加背景矩形填充孔洞（用最亮的颜色）
    const bgColor = palette.length > 0 
        ? `rgb(${palette[palette.length - 1][0]},${palette[palette.length - 1][1]},${palette[palette.length - 1][2]})`
        : '#ffffff';
    const bgRect = `<rect x="0" y="0" width="${width}" height="${height}" fill="${bgColor}"/>`;
    
    const svgContent = allPaths.map(p => {
        const fillRule = p.fillRule ? ` fill-rule="${p.fillRule}"` : '';
        return `<path d="${p.d}" fill="${p.fill}"${fillRule} stroke="${p.stroke}" stroke-width="${p.strokeWidth}"/>`;
    }).join('\n');
    
    // SVG 使用原始尺寸，viewBox 使用工作尺寸（放大后），浏览器会自动缩放
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${originalWidth}" height="${originalHeight}" viewBox="0 0 ${width} ${height}">\n${bgRect}\n${svgContent}\n</svg>`;
    
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
        engine: 'vecburner'
    };
}

/**
 * 使用预设进行矢量化
 */
export async function vectorizeWithPreset(imageData, presetName = 'auto') {
    // smart/blocks 模式 - 手动选择（实验性功能）
    if (presetName === 'smart') {
        console.log(`[Vecburner] 智能分块模式 (实验性)`);
        return vectorizeSmart(imageData);
    }
    if (presetName === 'blocks') {
        console.log(`[Vecburner] 强制分块模式 (实验性)`);
        return vectorizeByBlocks(imageData);
    }
    
    // 自动模式：分析颜色选择最佳预设（全图处理）
    if (presetName === 'auto') {
        const analysis = analyzeImageColors(imageData);
        const basePreset = PRESETS[analysis.recommendedPreset] || PRESETS.logo;
        console.log(`[Vecburner] 自动模式: ${analysis.recommendedPreset}, ${basePreset.numColors}色`);
        return vectorize(imageData, basePreset);
    }
    
    const preset = PRESETS[presetName] || PRESETS.logo;
    return vectorize(imageData, preset);
}

// ============ 导出 ============

/**
 * Vecburner - 高质量位图转矢量引擎
 * 
 * @example
 * // 基础用法
 * const result = await Vecburner.vectorize(imageData, { preset: 'logo' });
 * console.log(result.svg);
 * 
 * // 使用预设
 * const result = await Vecburner.vectorizeWithPreset(imageData, 'lineart');
 * 
 * // 路径简化
 * const simplified = Vecburner.simplify(pathD, 2);
 */

// 版本号
const VERSION = '1.0.0';

// 导入分块矢量化模块（延迟加载）
let blockVectorizeModule = null;
async function loadBlockVectorize() {
    if (!blockVectorizeModule) {
        blockVectorizeModule = await import('./block-vectorize.js');
    }
    return blockVectorizeModule;
}

/**
 * 分块矢量化 - 将图像分割成独立区块分别处理
 * 适合包含文字和图形混合的复杂图像
 */
export async function vectorizeByBlocks(imageData, options = {}) {
    const mod = await loadBlockVectorize();
    return mod.vectorizeByBlocks(imageData, options);
}

/**
 * 智能矢量化 - 自动选择全图或分块模式
 */
export async function vectorizeSmart(imageData, options = {}) {
    const mod = await loadBlockVectorize();
    return mod.vectorizeSmart(imageData, options);
}

// ============ 高级 API（进阶用户） ============

/**
 * 高级 API - 提供底层算法访问
 * 适合需要精细控制的进阶用户
 */
const advanced = {
    // 颜色量化
    quantize: kMeansQuantize,
    quantizeMedianCut: medianCutQuantize,
    
    // 图像分析
    analyzeColors: analyzeImageColors,
    computeOtsuThreshold,
    
    // 二值化与形态学
    createBinaryBitmap,
    createBinaryBitmapFromMap,
    morphClose,
    
    // 连通区域
    labelConnectedComponents,
    
    // 轮廓追踪
    traceContours: marchingSquaresContour,
    traceContoursVTracer,
    traceContoursHybrid,
    
    // 路径简化
    simplifyPath,
    removeStaircase,
    reduceVTracer,
    
    // 路径平滑
    chaikinSmooth,
    chaikinSmoothPreserveCorners,
    
    // 角点检测
    detectCorners: detectCornersVTracer,
    processContour: processContourVTracer,
    
    // 曲线拟合
    fitBezier,
    fitBezierWithCorners,
    fitBezierSmooth,
    fitBezierCatmullRom,
    generatePolygonPath,
    retractHandles
};

// ============ 主 API ============

/**
 * Vecburner 主对象
 * 
 * @property {string} version - 版本号
 * @property {Object} presets - 预设配置
 * @property {Object} advanced - 高级 API
 */
export const Vecburner = {
    // 元信息
    version: VERSION,
    
    // -------- 核心方法 --------
    
    /**
     * 矢量化图像
     * @param {ImageData} imageData - 图像数据
     * @param {Object} options - 配置选项
     * @returns {Promise<Object>} 矢量化结果 { svg, layers, paths, colors, width, height }
     */
    vectorize,
    
    /**
     * 使用预设矢量化
     * @param {ImageData} imageData - 图像数据
     * @param {string} preset - 预设名称: 'auto'|'logo'|'lineart'|'illustration'|'photo'|'pixel'|'simple'
     * @returns {Promise<Object>} 矢量化结果
     */
    vectorizeWithPreset,
    
    /**
     * 简化 SVG 路径
     * @param {string} pathD - SVG path d 属性
     * @param {number} level - 简化级别 (0-5)
     * @returns {string} 简化后的路径
     */
    simplify: simplifyPathD,
    
    /**
     * 分析图像特征
     * @param {ImageData} imageData - 图像数据
     * @returns {Object} 分析结果 { colorCount, isPhoto, isLineart, recommendedPreset }
     */
    analyzeImage: analyzeImageColors,
    
    // -------- 预设配置 --------
    presets: PRESETS,
    
    // -------- 实验性功能 --------
    
    /**
     * 分块矢量化（实验性）
     * 将图像分割成独立区块分别处理
     */
    vectorizeByBlocks,
    
    /**
     * 智能矢量化（实验性）
     * 自动选择全图或分块模式
     */
    vectorizeSmart,
    
    // -------- 高级 API --------
    advanced,
    
    // -------- 向后兼容 --------
    // 以下属性保持向后兼容，新代码请使用上述标准 API
    
    /** @deprecated 使用 Vecburner.advanced.quantize */
    kMeansQuantize,
    /** @deprecated 使用 Vecburner.advanced.quantizeMedianCut */
    medianCutQuantize,
    /** @deprecated 使用 Vecburner.advanced.analyzeColors */
    analyzeImageColors,
    /** @deprecated 使用 Vecburner.advanced.labelConnectedComponents */
    labelConnectedComponents,
    /** @deprecated 使用 Vecburner.advanced.traceContours */
    marchingSquaresContour,
    /** @deprecated 使用 Vecburner.simplify */
    simplifyPathD,
    /** @deprecated 使用 Vecburner.advanced.simplifyPath */
    simplifyPath,
    /** @deprecated 使用 Vecburner.advanced.fitBezier */
    fitBezier,
    
    // 路径简化工具（保留，常用）
    simplifyVectorResult,
    getSimplifyPreview,
    
    // VTracer 风格函数（保留，高级用户可能需要）
    processContourVTracer,
    detectCornersVTracer,
    chaikinSmooth,
    fitBezierWithCorners,
    fitBezierSmooth,
    fitBezierCatmullRom,
    retractHandles,
    
    // 兼容别名
    get PotraceCore() { return Vecburner; }
};

// 向后兼容别名
export const PotraceCore = Vecburner;

// 默认导出
export default Vecburner;

// ============ 按需导入支持 ============
// 支持 tree-shaking，按需导入底层模块
// import { kMeansQuantize } from 'vecburner/color-quantize';

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
export * from './path-simplifier.js';
export { PRESETS } from './presets.js';
