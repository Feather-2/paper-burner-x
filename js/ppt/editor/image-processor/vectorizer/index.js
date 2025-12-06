/**
 * VTracer 风格矢量化引擎
 * @module vectorizer
 *
 * 算法参考:
 * - VTracer (visioncortex) - 核心算法框架
 * - 4-Point Subdivision Scheme - 路径平滑
 * - Splice Point Detection - 曲线分段
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

import { medianCutQuantize, colorSame, colorDiff } from './color-quantize.js';
import { createBinaryBitmap, computeOtsuThreshold, gaussianBlur, BinaryImage } from './binary-image.js';
import { labelConnectedComponents, getRegionBounds, filterSmallRegions } from './connected-components.js';
import { marchingSquaresContour, pathWalkerTrace } from './contour-tracer.js';
import { simplifyPath, removeStaircase, limitPenalties, visvalingamWhyatt, douglasPeucker } from './path-simplify.js';
import { smoothPathVTracer, findCorners, subdivideKeepCorners, chaikinSmooth, movingAverageSmooth, processContourVTracer, detectCornersVTracer } from './path-smooth.js';
import { fitBezierWithSplicePoints, fitBezierWithCorners, fitBezierSmooth, fitBezierCatmullRom, findSplicePoints, retractHandles, reversePath } from './curve-fitter.js';
import { polygonArea, colorDistSq, distance } from './utils.js';

// ============ CDN 依赖 ============
const CDN_LIBS = {
    simplify: 'https://cdn.jsdelivr.net/npm/simplify-js@1.2.4/simplify.min.js',
    fitCurve: 'https://cdn.jsdelivr.net/npm/fit-curve@0.2.0/lib/fit-curve.js'
};

let libsLoaded = false;

async function loadCdnLibs() {
    if (libsLoaded) return;
    if (typeof document === 'undefined') return;

    const loadScript = (url) => new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${url}"]`)) {
            resolve();
            return;
        }
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
        console.warn('[Vectorizer] CDN 加载失败，使用内置算法');
    }
}

// ============ 预设 ============
const PRESETS = {
    logo: {
        numColors: 16,
        colorTolerance: 20,
        pathTolerance: 0.3,
        smoothness: 0.8,
        minPathLength: 16,
        mode: 'spline',
        blurSigma: 1.0,
        useVTracer: true
    },
    illustration: {
        numColors: 32,
        colorTolerance: 25,
        pathTolerance: 0.5,
        smoothness: 1.0,
        minPathLength: 16,
        mode: 'spline',
        blurSigma: 1.0,
        useVTracer: true
    },
    lineart: {
        numColors: 2,
        colorTolerance: 60,
        pathTolerance: 0.2,
        smoothness: 0.5,
        minPathLength: 16,
        mode: 'spline',
        binaryMode: true,
        blurSigma: 1.5,
        useVTracer: true
    },
    photo: {
        numColors: 64,
        colorTolerance: 35,
        pathTolerance: 1.0,
        smoothness: 2.0,
        minPathLength: 64,
        mode: 'spline',
        blurSigma: 1.5,
        useVTracer: true
    },
    simple: {
        numColors: 8,
        colorTolerance: 40,
        pathTolerance: 2.0,
        smoothness: 4.0,
        minPathLength: 32,
        mode: 'polygon',
        blurSigma: 0,
        useVTracer: false
    }
};

// ============ 主矢量化函数 ============

/**
 * 矢量化图像
 * @param {ImageData} imageData - 输入图像
 * @param {Object} options - 配置选项
 * @returns {Object} { svg, width, height, layers, paths, colors, engine }
 */
async function vectorize(imageData, options = {}) {
    await loadCdnLibs();

    const {
        numColors = 16,
        colorTolerance = 25,
        pathTolerance = 1.0,
        smoothness = 2.5,
        minPathLength = 16,
        mode = 'spline',
        binaryMode = false,
        blurSigma = 0.8,
        useVTracer = true,
        spliceThreshold = Math.PI / 3,  // VTracer 分段阈值
        cornerAngle = 45,               // 角点检测阈值
        smoothIterations = 10           // VTracer 平滑迭代次数
    } = options;

    const { width, height } = imageData;

    console.log(`[Vectorizer] 矢量化: ${numColors}色, VTracer=${useVTracer}, blur=${blurSigma}`);

    // 1. 颜色量化
    let palette;
    let otsuThreshold = null;

    if (binaryMode || numColors <= 2) {
        otsuThreshold = computeOtsuThreshold(imageData);
        console.log(`[Vectorizer] Otsu 阈值: ${otsuThreshold}`);
        palette = [[0, 0, 0]];
    } else {
        palette = medianCutQuantize(imageData, numColors);
    }
    console.log(`[Vectorizer] 提取 ${palette.length} 种主色`);

    const layers = [];

    // 2. 每种颜色生成矢量层
    for (const color of palette) {
        const useLuminance = binaryMode || numColors <= 2;
        const bitmap = createBinaryBitmap(imageData, color, colorTolerance, useLuminance, otsuThreshold, blurSigma);

        let actualColor = color;
        if (bitmap.inverted && useLuminance) {
            const sum = [0, 0, 0];
            let count = 0;
            const data = imageData.data;
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

        let fgCount = 0;
        for (let i = 0; i < bitmap.data.length; i++) {
            if (bitmap.data[i] === 1) fgCount++;
        }

        if (fgCount < minPathLength) continue;

        // 轮廓追踪
        const contours = marchingSquaresContour(bitmap, null, null, bitmap.grayscale);

        const pathParts = [];

        for (const contour of contours) {
            if (contour.points.length < 4) continue;
            if (Math.abs(contour.area) < minPathLength) continue;

            const originalCount = contour.points.length;
            let finalPoints;
            let pathD;

            if (useVTracer) {
                // VTracer 流程
                // 1. 移除锯齿
                const clockwise = contour.area >= 0;
                let simplified = removeStaircase(contour.points, clockwise);

                // 2. 4-Point Subdivision 平滑
                const smoothResult = smoothPathVTracer(simplified, {
                    cornerThreshold: Math.PI * (180 - cornerAngle) / 180,
                    outsetRatio: 8.0,       // VTracer 默认值，控制平滑强度
                    segmentLength: 4.0,
                    maxIterations: smoothIterations
                });

                finalPoints = smoothResult.points;

                // 3. Splice Point 曲线拟合
                if (mode === 'spline') {
                    pathD = fitBezierWithSplicePoints(finalPoints, spliceThreshold, smoothness);
                } else {
                    pathD = generatePolygonPath(finalPoints);
                }

                console.log(`[Vectorizer] VTracer: ${originalCount} -> 简化 ${simplified.length} -> 平滑 ${finalPoints.length} 点`);

            } else {
                // 旧流程
                const processed = processContourVTracer(contour.points, {
                    cornerAngle,
                    smoothWindow: 7,
                    minCornerDist: Math.max(5, Math.floor(originalCount / 30)),
                    smoothIterations: 4,
                    useVTracerSmooth: false
                });

                finalPoints = processed.points;

                if (finalPoints.length > 500) {
                    finalPoints = simplifyPath(finalPoints, { tolerance: pathTolerance, useStaircase: false });
                }

                if (mode === 'spline') {
                    pathD = fitBezierSmooth(finalPoints, smoothness);
                } else {
                    pathD = generatePolygonPath(finalPoints);
                }
            }

            if (pathD) {
                pathParts.push(pathD);
            }
        }

        const paths = [];
        if (pathParts.length > 0) {
            const combinedD = pathParts.join(' ');
            paths.push({
                d: combinedD,
                fill: colorStr,
                fillRule: 'evenodd',
                stroke: 'none',
                strokeWidth: 0
            });
        }

        if (paths.length > 0) {
            layers.push({ color: colorStr, colorRgb: actualColor, paths });
        }
    }

    console.log(`[Vectorizer] 生成 ${layers.length} 个颜色层`);

    // 3. 生成 SVG
    const allPaths = layers.flatMap(l => l.paths);
    const svgContent = allPaths.map(p => {
        const fillRule = p.fillRule ? ` fill-rule="${p.fillRule}"` : '';
        return `<path d="${p.d}" fill="${p.fill}"${fillRule} stroke="${p.stroke}" stroke-width="${p.strokeWidth}"/>`;
    }).join('\n');

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n${svgContent}\n</svg>`;

    return {
        svg,
        width,
        height,
        layers,
        paths: allPaths,
        colors: palette.map(c => `rgb(${c[0]},${c[1]},${c[2]})`),
        engine: useVTracer ? 'vtracer-js' : 'potrace-core-v2'
    };
}

/**
 * 使用预设矢量化
 */
function vectorizeWithPreset(imageData, presetName = 'logo') {
    const preset = PRESETS[presetName] || PRESETS.logo;
    return vectorize(imageData, preset);
}

/**
 * 生成多边形路径
 */
function generatePolygonPath(points) {
    if (points.length < 2) return '';
    let path = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
    for (let i = 1; i < points.length; i++) {
        path += `L${points[i].x.toFixed(1)},${points[i].y.toFixed(1)}`;
    }
    return path + 'Z';
}

// ============ 导出 ============

const Vectorizer = {
    // 主函数
    vectorize,
    vectorizeWithPreset,
    PRESETS,

    // 颜色量化
    medianCutQuantize,
    colorSame,
    colorDiff,

    // 二值化
    createBinaryBitmap,
    computeOtsuThreshold,
    gaussianBlur,
    BinaryImage,

    // 连通区域
    labelConnectedComponents,
    getRegionBounds,
    filterSmallRegions,

    // 轮廓追踪
    marchingSquaresContour,
    pathWalkerTrace,

    // 路径简化
    simplifyPath,
    removeStaircase,
    limitPenalties,
    visvalingamWhyatt,
    douglasPeucker,

    // 路径平滑
    smoothPathVTracer,
    findCorners,
    subdivideKeepCorners,
    chaikinSmooth,
    movingAverageSmooth,
    processContourVTracer,
    detectCornersVTracer,

    // 曲线拟合
    fitBezierWithSplicePoints,
    fitBezierWithCorners,
    fitBezierSmooth,
    fitBezierCatmullRom,
    findSplicePoints,
    retractHandles,
    reversePath,

    // 工具
    polygonArea,
    colorDistSq,
    distance
};

// 兼容旧 API
const PotraceCore = Vectorizer;

// 导出
export default Vectorizer;
export {
    Vectorizer,
    PotraceCore,
    vectorize,
    vectorizeWithPreset,
    PRESETS
};

// 全局导出（兼容非模块环境）
if (typeof window !== 'undefined') {
    window.Vectorizer = Vectorizer;
    window.PotraceCore = PotraceCore;
}
