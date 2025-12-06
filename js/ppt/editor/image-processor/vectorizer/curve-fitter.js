/**
 * 曲线拟合模块
 * 包含 VTracer 风格的 Splice Point Detection 和 retract_handles
 * @module vectorizer/curve-fitter
 */

import { subtract, angle, signedAngleDifference, findIntersection, distance, midpoint, degToRad } from './utils.js';

/**
 * VTracer 核心：寻找曲线分段点 (Splice Points)
 *
 * 两种触发条件：
 * 1. 拐点 (Inflection Point) - 曲率符号改变
 * 2. 累积角度超限 - 累积转角超过 spliceThreshold
 *
 * @param {Array} points - 输入点数组
 * @param {number} spliceThreshold - 分段阈值 (弧度，默认 π/3 = 60°)
 * @returns {Array<boolean>} 每个点是否是分段点
 */
export function findSplicePoints(points, spliceThreshold = Math.PI / 3) {
    const n = points.length;
    if (n < 3) return points.map(() => false);

    const splicePoints = new Array(n).fill(false);

    // 计算每个点的角度差
    const angleDiffs = [];
    for (let i = 0; i < n; i++) {
        const prev = points[(i - 1 + n) % n];
        const curr = points[i];
        const next = points[(i + 1) % n];

        const v1 = subtract(curr, prev);
        const v2 = subtract(next, curr);

        const a1 = angle(v1);
        const a2 = angle(v2);

        angleDiffs.push(signedAngleDifference(a1, a2));
    }

    // 检测拐点和累积角度
    let cumulativeAngle = 0;
    let prevSign = 0;

    for (let i = 0; i < n; i++) {
        const diff = angleDiffs[i];
        const sign = Math.sign(diff);

        // 检测拐点：符号改变
        if (prevSign !== 0 && sign !== 0 && prevSign !== sign) {
            splicePoints[i] = true;
            cumulativeAngle = 0;
        } else {
            // 累积角度
            cumulativeAngle += diff;

            // 累积角度超限
            if (Math.abs(cumulativeAngle) > spliceThreshold) {
                splicePoints[i] = true;
                cumulativeAngle = 0;
            }
        }

        if (sign !== 0) {
            prevSign = sign;
        }
    }

    return splicePoints;
}

/**
 * VTracer 风格：修正贝塞尔控制柄
 * 当控制柄交叉时，将它们收缩到交点
 *
 * @param {Array} bezier - [起点, 控制点1, 控制点2, 终点]
 * @returns {Array} 修正后的贝塞尔曲线
 */
export function retractHandles(bezier) {
    const [a, b, c, d] = bezier;

    const result = findIntersection(a, b, c, d);

    if (result) {
        const { point: intersection, mua, mub } = result;

        // 如果交点在线段内部（两个参数都在 0-1 之间）
        if (!isNaN(mua) && mua > 0 && mua < 1 && mub > 0 && mub < 1) {
            return [a, intersection, intersection, d];
        }
    }

    return [a, b, c, d];
}

/**
 * 按分段点拟合贝塞尔曲线
 *
 * @param {Array} points - 平滑后的点数组
 * @param {number} spliceThreshold - 分段阈值 (弧度)
 * @param {number} maxError - 拟合误差
 * @returns {string} SVG path 字符串
 */
export function fitBezierWithSplicePoints(points, spliceThreshold = Math.PI / 3, maxError = 1.0) {
    if (!points || points.length < 3) return '';

    const closed = points.length > 2 &&
        Math.abs(points[0].x - points[points.length - 1].x) < 0.5 &&
        Math.abs(points[0].y - points[points.length - 1].y) < 0.5;

    const pts = closed ? points.slice(0, -1) : points;
    const n = pts.length;

    if (n < 3) return generatePolygonPath(points);

    // 1. 找分段点
    const spliceMarks = findSplicePoints(pts, spliceThreshold);

    // 2. 提取分段点索引
    let cutPoints = spliceMarks
        .map((isSplice, i) => isSplice ? i : -1)
        .filter(i => i >= 0);

    // 如果没有分段点，添加起点
    if (cutPoints.length === 0) {
        cutPoints.push(0);
    }

    // 如果只有一个分段点，添加对面的点
    if (cutPoints.length === 1) {
        cutPoints.push((cutPoints[0] + Math.floor(n / 2)) % n);
    }

    // 3. 按分段拟合
    let path = '';
    const numCuts = cutPoints.length;

    for (let i = 0; i < numCuts; i++) {
        const current = cutPoints[i];
        const next = cutPoints[(i + 1) % numCuts];

        // 提取子路径
        const subpath = [];
        if (next > current) {
            for (let j = current; j <= next; j++) {
                subpath.push(pts[j]);
            }
        } else {
            // 跨越首尾
            for (let j = current; j < n; j++) subpath.push(pts[j]);
            for (let j = 0; j <= next; j++) subpath.push(pts[j]);
        }

        // 拟合子路径
        const bezierPoints = fitPointsWithBezier(subpath);

        // 修正控制柄
        const corrected = retractHandles(bezierPoints);

        // 生成路径命令
        if (i === 0) {
            path = `M${corrected[0].x.toFixed(2)},${corrected[0].y.toFixed(2)}`;
        }
        path += `C${corrected[1].x.toFixed(2)},${corrected[1].y.toFixed(2)},${corrected[2].x.toFixed(2)},${corrected[2].y.toFixed(2)},${corrected[3].x.toFixed(2)},${corrected[3].y.toFixed(2)}`;
    }

    return path + (closed ? 'Z' : '');
}

/**
 * 对一段点拟合单条贝塞尔曲线
 * 使用 fit-curve 库或简化算法
 */
export function fitPointsWithBezier(points) {
    if (points.length < 2) {
        const p = points[0] || { x: 0, y: 0 };
        return [p, p, p, p];
    }

    if (points.length === 2) {
        const [p0, p1] = points;
        return [p0, p0, p1, p1];
    }

    // 尝试使用 fit-curve
    if (typeof window !== 'undefined' && typeof window.fitCurve === 'function') {
        try {
            const pts = points.map(p => [p.x, p.y]);
            const curves = window.fitCurve(pts, 1.0);
            if (curves && curves.length > 0) {
                // 只取第一条曲线
                const c = curves[0];
                return [
                    { x: c[0][0], y: c[0][1] },
                    { x: c[1][0], y: c[1][1] },
                    { x: c[2][0], y: c[2][1] },
                    { x: c[3][0], y: c[3][1] }
                ];
            }
        } catch (e) {}
    }

    // 回退：简单的 Catmull-Rom 转贝塞尔
    return catmullRomToBezier(points);
}

/**
 * Catmull-Rom 转贝塞尔
 */
function catmullRomToBezier(points) {
    const n = points.length;
    const p0 = points[0];
    const p1 = points[Math.floor(n / 3)] || points[1] || p0;
    const p2 = points[Math.floor(2 * n / 3)] || points[n - 2] || points[n - 1];
    const p3 = points[n - 1];

    const tension = 0.3;

    const cp1 = {
        x: p0.x + (p1.x - p0.x) * tension,
        y: p0.y + (p1.y - p0.y) * tension
    };

    const cp2 = {
        x: p3.x - (p3.x - p2.x) * tension,
        y: p3.y - (p3.y - p2.y) * tension
    };

    return [p0, cp1, cp2, p3];
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

/**
 * 按角点分段拟合
 */
export function fitBezierWithCorners(points, maxError = 2.5, cornerAngle = 60) {
    if (!points || points.length < 3) return '';

    const closed = points.length > 2 &&
        Math.abs(points[0].x - points[points.length - 1].x) < 0.5 &&
        Math.abs(points[0].y - points[points.length - 1].y) < 0.5;

    const pts = closed ? points.slice(0, -1) : points;
    const n = pts.length;
    if (n < 3) return generatePolygonPath(points);

    // 检测角点
    const corners = detectSimpleCorners(pts, cornerAngle);

    if (corners.length === 0) {
        return fitBezierSimple(pts, maxError, closed);
    }

    // 按角点分段
    const segments = [];
    for (let i = 0; i < corners.length; i++) {
        const start = corners[i];
        const end = corners[(i + 1) % corners.length];

        const segment = [];
        if (end > start) {
            for (let j = start; j <= end; j++) segment.push(pts[j]);
        } else {
            for (let j = start; j < n; j++) segment.push(pts[j]);
            for (let j = 0; j <= end; j++) segment.push(pts[j]);
        }

        if (segment.length >= 2) {
            segments.push(segment);
        }
    }

    // 拟合每段
    let path = '';
    for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const segPath = fitSegmentBezier(seg, maxError);

        if (i === 0) {
            path = segPath;
        } else {
            path += segPath.replace(/^M[^CL]+/, '');
        }
    }

    return path + 'Z';
}

/**
 * 简单角点检测
 */
function detectSimpleCorners(points, angleThreshold = 60) {
    const n = points.length;
    const corners = [];
    const threshold = degToRad(angleThreshold);

    for (let i = 0; i < n; i++) {
        const prev = points[(i - 1 + n) % n];
        const curr = points[i];
        const next = points[(i + 1) % n];

        const v1 = subtract(curr, prev);
        const v2 = subtract(next, curr);

        const len1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
        const len2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);

        if (len1 < 0.01 || len2 < 0.01) continue;

        const dot = v1.x * v2.x + v1.y * v2.y;
        const cos = dot / (len1 * len2);
        const ang = Math.acos(Math.max(-1, Math.min(1, cos)));

        if (ang < threshold) {
            corners.push(i);
        }
    }

    return corners;
}

/**
 * 单段贝塞尔拟合
 */
function fitSegmentBezier(points, maxError) {
    if (points.length < 2) return '';
    if (points.length === 2) {
        return `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}L${points[1].x.toFixed(1)},${points[1].y.toFixed(1)}`;
    }

    const pts = points.map(p => [p.x, p.y]);

    if (typeof window !== 'undefined' && typeof window.fitCurve === 'function') {
        try {
            const curves = window.fitCurve(pts, Math.max(0.1, maxError));
            if (curves && curves.length > 0) {
                let path = `M${curves[0][0][0].toFixed(1)},${curves[0][0][1].toFixed(1)}`;
                for (const c of curves) {
                    path += `C${c[1][0].toFixed(1)},${c[1][1].toFixed(1)},${c[2][0].toFixed(1)},${c[2][1].toFixed(1)},${c[3][0].toFixed(1)},${c[3][1].toFixed(1)}`;
                }
                return path;
            }
        } catch (e) {}
    }

    // 回退
    let path = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
    for (let i = 1; i < points.length; i++) {
        path += `L${points[i].x.toFixed(1)},${points[i].y.toFixed(1)}`;
    }
    return path;
}

/**
 * 简单贝塞尔拟合
 */
function fitBezierSimple(points, maxError, closed = true) {
    const pts = points.map(p => [p.x, p.y]);

    if (typeof window !== 'undefined' && typeof window.fitCurve === 'function') {
        try {
            const curves = window.fitCurve(pts, Math.max(0.1, maxError));
            if (curves && curves.length > 0) {
                let path = `M${curves[0][0][0].toFixed(1)},${curves[0][0][1].toFixed(1)}`;
                for (const c of curves) {
                    path += `C${c[1][0].toFixed(1)},${c[1][1].toFixed(1)},${c[2][0].toFixed(1)},${c[2][1].toFixed(1)},${c[3][0].toFixed(1)},${c[3][1].toFixed(1)}`;
                }
                return path + (closed ? 'Z' : '');
            }
        } catch (e) {}
    }

    return fitBezierCatmullRom(points, 0.3) + (closed ? 'Z' : '');
}

/**
 * Catmull-Rom 曲线拟合
 */
export function fitBezierCatmullRom(points, tension = 0.3) {
    const closed = points.length > 2 &&
        Math.abs(points[0].x - points[points.length - 1].x) < 0.5 &&
        Math.abs(points[0].y - points[points.length - 1].y) < 0.5;

    const pts = closed ? points.slice(0, -1) : points;
    const n = pts.length;
    if (n < 3) return `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}L${pts[n - 1].x.toFixed(1)},${pts[n - 1].y.toFixed(1)}Z`;

    let path = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;

    for (let i = 0; i < n; i++) {
        const p0 = pts[(i - 1 + n) % n];
        const p1 = pts[i];
        const p2 = pts[(i + 1) % n];
        const p3 = pts[(i + 2) % n];

        const cp1x = p1.x + (p2.x - p0.x) * tension / 3;
        const cp1y = p1.y + (p2.y - p0.y) * tension / 3;
        const cp2x = p2.x - (p3.x - p1.x) * tension / 3;
        const cp2y = p2.y - (p3.y - p1.y) * tension / 3;

        if (i === 0 && !closed) {
            path += `L${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
        } else if (i < n - 1 || closed) {
            path += `C${cp1x.toFixed(1)},${cp1y.toFixed(1)},${cp2x.toFixed(1)},${cp2y.toFixed(1)},${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
        }
    }

    return path + 'Z';
}

/**
 * 平滑曲线拟合（用于已经充分平滑的点）
 */
export function fitBezierSmooth(points, maxError = 1.0) {
    if (!points || points.length < 3) return '';

    const closed = points.length > 2 &&
        Math.abs(points[0].x - points[points.length - 1].x) < 1 &&
        Math.abs(points[0].y - points[points.length - 1].y) < 1;

    const pts = closed ? points.slice(0, -1) : points;
    if (pts.length < 3) return generatePolygonPath(points);

    if (typeof window !== 'undefined' && typeof window.fitCurve === 'function') {
        try {
            const inputPts = pts.map(p => [p.x, p.y]);
            const curves = window.fitCurve(inputPts, Math.max(0.1, maxError * 0.5));
            if (curves && curves.length > 0) {
                let path = `M${curves[0][0][0].toFixed(2)},${curves[0][0][1].toFixed(2)}`;
                for (const c of curves) {
                    path += `C${c[1][0].toFixed(2)},${c[1][1].toFixed(2)},${c[2][0].toFixed(2)},${c[2][1].toFixed(2)},${c[3][0].toFixed(2)},${c[3][1].toFixed(2)}`;
                }
                return path + (closed ? 'Z' : '');
            }
        } catch (e) {}
    }

    return fitBezierCatmullRom(pts, 0.4);
}

/**
 * 反转 SVG 路径方向（用于孔洞）
 */
export function reversePath(pathD) {
    const points = [];
    const regex = /([ML])([^MLCZml]+)/g;
    let match;

    while ((match = regex.exec(pathD)) !== null) {
        const coords = match[2].split(',').map(s => parseFloat(s.trim()));
        if (coords.length >= 2) {
            points.push({ x: coords[0], y: coords[1] });
        }
    }

    const bezierRegex = /C([^MLCZ]+)/g;
    const beziers = [];
    while ((match = bezierRegex.exec(pathD)) !== null) {
        const nums = match[1].split(/[,\s]+/).map(parseFloat).filter(n => !isNaN(n));
        if (nums.length >= 6) {
            beziers.push({
                cp1: { x: nums[0], y: nums[1] },
                cp2: { x: nums[2], y: nums[3] },
                end: { x: nums[4], y: nums[5] }
            });
        }
    }

    if (beziers.length > 0) {
        beziers.reverse();
        let reversed = `M${beziers[0].end.x.toFixed(1)},${beziers[0].end.y.toFixed(1)}`;
        for (let i = 0; i < beziers.length; i++) {
            const b = beziers[i];
            const nextEnd = i < beziers.length - 1 ? beziers[i + 1].end : points[0] || beziers[beziers.length - 1].end;
            reversed += `C${b.cp2.x.toFixed(1)},${b.cp2.y.toFixed(1)},${b.cp1.x.toFixed(1)},${b.cp1.y.toFixed(1)},${nextEnd.x.toFixed(1)},${nextEnd.y.toFixed(1)}`;
        }
        return reversed + 'Z';
    }

    if (points.length < 2) return pathD;
    points.reverse();
    let reversed = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
    for (let i = 1; i < points.length; i++) {
        reversed += `L${points[i].x.toFixed(1)},${points[i].y.toFixed(1)}`;
    }
    return reversed + 'Z';
}
