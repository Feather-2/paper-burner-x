/**
 * 路径平滑模块
 * 包含 VTracer 核心的 4-Point Subdivision Scheme
 * @module vectorizer/path-smooth
 */

import { distance, subtract, angle, signedAngleDifference, degToRad } from './utils.js';

/**
 * VTracer 核心：检测角点
 * 使用有符号角度差判断
 *
 * @param {Array} points - 输入点数组
 * @param {number} cornerThreshold - 角点阈值 (弧度，默认 π/4 = 45°)
 * @returns {Array<boolean>} 每个点是否是角点
 */
export function findCorners(points, cornerThreshold = Math.PI / 4) {
    const n = points.length;
    if (n < 3) return points.map(() => false);

    const corners = new Array(n).fill(false);

    for (let i = 0; i < n; i++) {
        const prev = points[(i - 1 + n) % n];
        const curr = points[i];
        const next = points[(i + 1) % n];

        const v1 = subtract(prev, curr);
        const v2 = subtract(next, curr);

        const a1 = angle(v1);
        const a2 = angle(v2);

        const diff = Math.abs(signedAngleDifference(a1, a2));

        // 角度差接近 π（直线）不是角点
        // 角度差小于阈值（尖角）是角点
        if (Math.abs(diff - Math.PI) > cornerThreshold) {
            corners[i] = true;
        }
    }

    return corners;
}

/**
 * VTracer 核心：4-Point Subdivision Scheme
 *
 * 对于点序列 p0, p1, p2, p3，生成新点在 p1 和 p2 之间：
 * new_point = (-1/16)*p0 + (9/16)*p1 + (9/16)*p2 + (-1/16)*p3
 *
 * 这个算法的关键特性：
 * 1. 迭代细分使曲线越来越平滑
 * 2. 保持角点不动
 * 3. 收敛到 C² 连续曲线
 *
 * @param {Array} points - 输入点数组 [{x, y}, ...]
 * @param {Array<boolean>} corners - 角点标记
 * @param {number} outsetRatio - 外扩比例
 * @param {number} segmentLength - 目标线段长度
 * @returns {Object} { points, corners, converged }
 */
export function subdivideKeepCorners(points, corners, outsetRatio = 0.2, segmentLength = 4.0) {
    const n = points.length;
    if (n < 3) return { points, corners, converged: true };

    const result = [];
    const resultCorners = [];
    let allShort = true;

    for (let i = 0; i < n; i++) {
        const curr = points[i];
        const next = points[(i + 1) % n];
        const isCorner = corners[i];
        const nextIsCorner = corners[(i + 1) % n];

        // 添加当前点
        result.push({ x: curr.x, y: curr.y });
        resultCorners.push(isCorner);

        // 计算到下一点的距离
        const dist = distance(curr, next);

        // 如果线段够长且两端都不是角点，进行细分
        if (dist >= segmentLength && !isCorner && !nextIsCorner) {
            allShort = false;

            // 获取4个点用于细分
            const p0 = points[(i - 1 + n) % n];
            const p1 = curr;
            const p2 = next;
            const p3 = points[(i + 2) % n];

            // 4-Point Scheme 插值
            const newPoint = findNewPointFrom4PointScheme(p0, p1, p2, p3, outsetRatio);

            result.push(newPoint);
            resultCorners.push(false);
        }
    }

    return {
        points: result,
        corners: resultCorners,
        converged: allShort
    };
}

/**
 * 4-Point Scheme 核心计算 (VTracer 原始实现 - 几何外扩法)
 *
 * VTracer 原始算法 (smooth.rs:200-215):
 * 1. mid_out = (p1 + p2) / 2  // 当前边中点
 * 2. mid_in = (p0 + p3) / 2   // 前后点中点
 * 3. vector = mid_out - mid_in
 * 4. new = mid_out + normalize(vector) * (length(vector) / outsetRatio)
 *
 * @param {Object} p0 - 前一个点
 * @param {Object} p1 - 当前边起点
 * @param {Object} p2 - 当前边终点
 * @param {Object} p3 - 后一个点
 * @param {number} outsetRatio - 外扩比例 (VTracer 默认 8.0)
 */
function findNewPointFrom4PointScheme(p0, p1, p2, p3, outsetRatio) {
    // 1. 当前边中点
    const midOut = {
        x: (p1.x + p2.x) / 2,
        y: (p1.y + p2.y) / 2
    };

    // 2. 前后点中点
    const midIn = {
        x: (p0.x + p3.x) / 2,
        y: (p0.y + p3.y) / 2
    };

    // 3. 外扩向量
    const vectorX = midOut.x - midIn.x;
    const vectorY = midOut.y - midIn.y;
    const vectorLen = Math.sqrt(vectorX * vectorX + vectorY * vectorY);

    // 如果向量太短，直接返回边中点
    if (vectorLen < 1e-10) {
        return midOut;
    }

    // 4. 归一化并按比例外扩
    const newMagnitude = vectorLen / outsetRatio;
    const normalizedX = vectorX / vectorLen;
    const normalizedY = vectorY / vectorLen;

    // 5. 新点 = 边中点 + 外扩向量
    return {
        x: midOut.x + normalizedX * newMagnitude,
        y: midOut.y + normalizedY * newMagnitude
    };
}

/**
 * VTracer 风格完整平滑流程
 *
 * @param {Array} points - 输入点数组
 * @param {Object} options - 配置选项
 * @returns {Object} { points, corners }
 */
export function smoothPathVTracer(points, options = {}) {
    const {
        cornerThreshold = Math.PI / 4,  // 45度
        outsetRatio = 8.0,              // VTracer 默认值 (几何外扩比例)
        segmentLength = 4.0,            // VTracer 默认值
        maxIterations = 10              // VTracer 默认值
    } = options;

    if (points.length < 4) return { points, corners: [] };

    // 1. 检测角点
    let corners = findCorners(points, cornerThreshold);

    // 2. 迭代细分
    let currentPoints = points.map(p => ({ x: p.x, y: p.y }));
    let currentCorners = corners;

    for (let iter = 0; iter < maxIterations; iter++) {
        const result = subdivideKeepCorners(
            currentPoints,
            currentCorners,
            outsetRatio,
            segmentLength
        );

        currentPoints = result.points;
        currentCorners = result.corners;

        if (result.converged) {
            break;
        }
    }

    return {
        points: currentPoints,
        corners: currentCorners.map((c, i) => c ? i : -1).filter(i => i >= 0)
    };
}

/**
 * Chaikin 角切割平滑
 */
export function chaikinSmooth(points, iterations = 2) {
    if (points.length < 3) return points;

    let result = points;
    for (let iter = 0; iter < iterations; iter++) {
        const smoothed = [];
        const n = result.length;

        for (let i = 0; i < n; i++) {
            const p0 = result[i];
            const p1 = result[(i + 1) % n];

            smoothed.push({
                x: p0.x * 0.75 + p1.x * 0.25,
                y: p0.y * 0.75 + p1.y * 0.25
            });
            smoothed.push({
                x: p0.x * 0.25 + p1.x * 0.75,
                y: p0.y * 0.25 + p1.y * 0.75
            });
        }

        result = smoothed;
    }

    return result;
}

/**
 * 移动平均平滑
 */
export function movingAverageSmooth(points, windowSize = 3) {
    if (points.length < 3) return points;

    const half = Math.floor(windowSize / 2);
    const n = points.length;
    const result = [];

    for (let i = 0; i < n; i++) {
        let sumX = 0, sumY = 0, count = 0;

        for (let j = -half; j <= half; j++) {
            const idx = (i + j + n) % n;
            sumX += points[idx].x;
            sumY += points[idx].y;
            count++;
        }

        result.push({
            x: sumX / count,
            y: sumY / count
        });
    }

    return result;
}

/**
 * 带标记的 Chaikin 平滑（保护角点）
 */
export function chaikinSmoothTagged(points) {
    if (points.length < 3) return points;

    const n = points.length;
    const result = [];

    for (let i = 0; i < n; i++) {
        const p0 = points[i];
        const p1 = points[(i + 1) % n];

        if (p0.isCorner) {
            result.push({ x: p0.x, y: p0.y, isCorner: true });
        } else if (p1.isCorner) {
            result.push({
                x: p0.x * 0.25 + p1.x * 0.75,
                y: p0.y * 0.25 + p1.y * 0.75,
                isCorner: false
            });
        } else {
            result.push({
                x: p0.x * 0.75 + p1.x * 0.25,
                y: p0.y * 0.75 + p1.y * 0.25,
                isCorner: false
            });
            result.push({
                x: p0.x * 0.25 + p1.x * 0.75,
                y: p0.y * 0.25 + p1.y * 0.75,
                isCorner: false
            });
        }
    }

    return result;
}

/**
 * 带标记的移动平均平滑
 */
export function movingAverageSmoothTagged(points, windowSize = 5) {
    if (points.length < 3) return points;

    const half = Math.floor(windowSize / 2);
    const n = points.length;
    const result = [];

    for (let i = 0; i < n; i++) {
        if (points[i].isCorner) {
            result.push({ ...points[i] });
        } else {
            let sumX = 0, sumY = 0, count = 0;
            for (let j = -half; j <= half; j++) {
                const idx = (i + j + n) % n;
                sumX += points[idx].x;
                sumY += points[idx].y;
                count++;
            }
            result.push({
                x: sumX / count,
                y: sumY / count,
                isCorner: false
            });
        }
    }

    return result;
}

/**
 * 检测角点 (旧版本兼容)
 */
export function detectCornersVTracer(points, angleThreshold = 90, minDistance = 5) {
    if (points.length < 6) return [];

    const n = points.length;
    const curvatures = [];

    // 计算每个点的曲率
    for (let i = 0; i < n; i++) {
        const angle = computeCurvature(points, i, 3);
        curvatures.push({ index: i, angle });
    }

    const threshold = degToRad(angleThreshold);
    const candidates = [];

    for (let i = 0; i < n; i++) {
        const curr = curvatures[i].angle;
        if (curr >= threshold) continue;

        let isLocalMin = true;
        for (let j = 1; j <= minDistance && isLocalMin; j++) {
            const prevAngle = curvatures[(i - j + n) % n].angle;
            const nextAngle = curvatures[(i + j) % n].angle;
            if (curr > prevAngle || curr > nextAngle) {
                isLocalMin = false;
            }
        }

        if (isLocalMin) {
            candidates.push({ index: i, angle: curr });
        }
    }

    candidates.sort((a, b) => a.angle - b.angle);

    const corners = [];
    for (const c of candidates) {
        let tooClose = false;
        for (const existing of corners) {
            const dist = Math.min(
                Math.abs(c.index - existing),
                n - Math.abs(c.index - existing)
            );
            if (dist < minDistance) {
                tooClose = true;
                break;
            }
        }
        if (!tooClose) {
            corners.push(c.index);
        }
    }

    return corners.sort((a, b) => a - b);
}

/**
 * 计算局部曲率
 */
function computeCurvature(points, index, radius = 3) {
    const n = points.length;
    if (n < 3) return Math.PI;

    const prevIdx = (index - radius + n) % n;
    const nextIdx = (index + radius) % n;
    const curr = points[index];
    const prev = points[prevIdx];
    const next = points[nextIdx];

    const v1x = curr.x - prev.x;
    const v1y = curr.y - prev.y;
    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;

    const len1 = Math.sqrt(v1x * v1x + v1y * v1y);
    const len2 = Math.sqrt(v2x * v2x + v2y * v2y);

    if (len1 < 0.01 || len2 < 0.01) return Math.PI;

    const dot = v1x * v2x + v1y * v2y;
    const cosAngle = Math.max(-1, Math.min(1, dot / (len1 * len2)));
    return Math.acos(cosAngle);
}

/**
 * 综合处理轮廓 (VTracer 风格)
 */
export function processContourVTracer(points, options = {}) {
    const {
        cornerAngle = 45,
        smoothWindow = 5,
        minCornerDist = 5,
        smoothIterations = 2,
        useVTracerSmooth = true
    } = options;

    if (points.length < 4) return { points, corners: [] };

    // 使用 VTracer 4-Point Subdivision
    if (useVTracerSmooth) {
        const cornerThreshold = degToRad(180 - cornerAngle);

        const result = smoothPathVTracer(points, {
            cornerThreshold,
            outsetRatio: 0.2,
            segmentLength: 4.0,
            maxIterations: smoothIterations * 5
        });

        return result;
    }

    // 旧版本流程
    let smoothed = points.slice();
    for (let i = 0; i < 2; i++) {
        smoothed = movingAverageSmooth(smoothed, 3);
    }

    const cornerIndices = detectCornersVTracer(smoothed, cornerAngle, minCornerDist);

    let taggedPoints = smoothed.map((p, i) => ({
        x: p.x,
        y: p.y,
        isCorner: cornerIndices.includes(i)
    }));

    for (let i = 0; i < smoothIterations; i++) {
        taggedPoints = chaikinSmoothTagged(taggedPoints);
    }

    for (let i = 0; i < 3; i++) {
        taggedPoints = movingAverageSmoothTagged(taggedPoints, smoothWindow);
    }

    const finalPoints = taggedPoints.map(p => ({ x: p.x, y: p.y }));
    const finalCorners = taggedPoints
        .map((p, i) => p.isCorner ? i : -1)
        .filter(i => i >= 0);

    return { points: finalPoints, corners: finalCorners };
}
