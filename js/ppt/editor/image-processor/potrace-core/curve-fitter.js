/**
 * Potrace Core - 曲线拟合模块
 * 
 * 提供贝塞尔曲线拟合功能
 */

import { detectCornersVTracer } from './corner-detect.js';

/**
 * 生成多边形路径
 */
export function generatePolygonPath(points) {
    if (points.length < 2) return '';
    let path = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
    for (let i = 1; i < points.length; i++) {
        path += `L${points[i].x.toFixed(1)},${points[i].y.toFixed(1)}`;
    }
    return path + 'Z';
}

/**
 * VTracer 风格曲线拟合（使用预检测的角点）
 * @param {Array} points - 简化后的点数组
 * @param {number} maxError - 曲线拟合误差
 * @param {Array} originalCorners - 原始轮廓中的角点索引
 * @param {number} originalCount - 原始轮廓点数
 */
export function fitBezierWithCornersVTracer(points, maxError, originalCorners, originalCount) {
    if (!points || points.length < 3) return '';

    const closed = points.length > 2 &&
        Math.abs(points[0].x - points[points.length - 1].x) < 0.5 &&
        Math.abs(points[0].y - points[points.length - 1].y) < 0.5;

    const pts = closed ? points.slice(0, -1) : points;
    const n = pts.length;
    if (n < 3) return generatePolygonPath(points);

    // 将原始角点索引映射到简化后的点
    // 使用比例映射
    const ratio = n / originalCount;
    let corners = originalCorners
        .map(idx => Math.round(idx * ratio))
        .filter(idx => idx >= 0 && idx < n);

    // 去重并排序
    corners = [...new Set(corners)].sort((a, b) => a - b);

    // 如果映射后角点太少，重新在简化后的点上检测
    if (corners.length < 2 && n > 6) {
        corners = detectCornersVTracer(pts, 75, 3);
    }

    // 如果没有角点，使用普通拟合
    if (corners.length === 0) {
        return fitBezierSimple(pts, maxError, closed);
    }

    // 按角点分段拟合
    const segments = [];
    for (let i = 0; i < corners.length; i++) {
        const start = corners[i];
        const end = corners[(i + 1) % corners.length];

        const segment = [];
        if (end > start) {
            for (let j = start; j <= end; j++) {
                segment.push(pts[j]);
            }
        } else {
            // 跨越首尾
            for (let j = start; j < n; j++) segment.push(pts[j]);
            for (let j = 0; j <= end; j++) segment.push(pts[j]);
        }

        if (segment.length >= 2) {
            segments.push(segment);
        }
    }

    // 对每段拟合曲线
    let path = '';
    for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const segPath = fitSegmentBezier(seg, maxError);

        if (i === 0) {
            path = segPath;
        } else {
            // 移除后续段的 M 命令，直接连接
            path += segPath.replace(/^M[^CL]+/, '');
        }
    }

    return path + 'Z';
}

/**
 * 按角点分段拟合曲线
 * @param {Array} points - 点数组（闭合路径）
 * @param {number} maxError - 曲线拟合误差
 * @param {number} cornerAngle - 角点检测阈值
 */
export function fitBezierWithCorners(points, maxError = 2.5, cornerAngle = 60) {
    if (!points || points.length < 3) return '';

    const closed = points.length > 2 &&
        Math.abs(points[0].x - points[points.length - 1].x) < 0.5 &&
        Math.abs(points[0].y - points[points.length - 1].y) < 0.5;

    const pts = closed ? points.slice(0, -1) : points;
    const n = pts.length;
    if (n < 3) return generatePolygonPath(points);

    // 使用 VTracer 风格角点检测
    const corners = detectCornersVTracer(pts, cornerAngle, 3);

    // 如果没有角点，使用普通拟合
    if (corners.length === 0) {
        return fitBezierSimple(pts, maxError, closed);
    }

    // 按角点分段
    const segments = [];

    for (let i = 0; i < corners.length; i++) {
        const start = corners[i];
        const end = corners[(i + 1) % corners.length];

        // 提取这一段的点
        const segment = [];
        if (end > start) {
            for (let j = start; j <= end; j++) {
                segment.push(pts[j]);
            }
        } else {
            // 跨越首尾
            for (let j = start; j < n; j++) segment.push(pts[j]);
            for (let j = 0; j <= end; j++) segment.push(pts[j]);
        }

        if (segment.length >= 2) {
            segments.push(segment);
        }
    }

    // 对每段拟合曲线
    let path = '';
    for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const segPath = fitSegmentBezier(seg, maxError);

        if (i === 0) {
            path = segPath;
        } else {
            // 移除后续段的 M 命令，直接连接
            path += segPath.replace(/^M[^CL]+/, '');
        }
    }

    return path + 'Z';
}

/**
 * 对单段点集拟合贝塞尔曲线（不闭合）
 */
export function fitSegmentBezier(points, maxError) {
    if (points.length < 2) return '';
    if (points.length === 2) {
        return `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}L${points[1].x.toFixed(1)},${points[1].y.toFixed(1)}`;
    }

    const pts = points.map(p => [p.x, p.y]);

    // 使用 fit-curve
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

    // 回退：直线连接
    let path = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
    for (let i = 1; i < points.length; i++) {
        path += `L${points[i].x.toFixed(1)},${points[i].y.toFixed(1)}`;
    }
    return path;
}

/**
 * 简单贝塞尔拟合（无角点检测）
 */
export function fitBezierSimple(points, maxError, closed = true) {
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

    return fitBezierCatmullRom(points.map(p => ({ x: p[0] || p.x, y: p[1] || p.y })), 0.3);
}

/**
 * 检测线段是否接近直线（水平、垂直或斜线）
 * @returns {boolean} true 如果是直线段
 */
export function isLinearSegment(points, tolerance = 1.5) {
    if (points.length < 2) return true;
    if (points.length === 2) return true;

    const start = points[0];
    const end = points[points.length - 1];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.sqrt(dx * dx + dy * dy);

    if (len < 2) return true;

    // 检查所有中间点到直线的距离
    for (let i = 1; i < points.length - 1; i++) {
        const dist = Math.abs(dy * points[i].x - dx * points[i].y + end.x * start.y - end.y * start.x) / len;
        if (dist > tolerance) return false;
    }

    return true;
}

/**
 * 平滑曲线拟合（用于已经充分平滑的点）
 * 直线段使用 L 命令，曲线段使用 C 命令
 */
export function fitBezierSmooth(points, maxError = 1.0) {
    if (!points || points.length < 3) return '';

    const closed = points.length > 2 &&
        Math.abs(points[0].x - points[points.length - 1].x) < 1 &&
        Math.abs(points[0].y - points[points.length - 1].y) < 1;

    const pts = closed ? points.slice(0, -1) : points;
    if (pts.length < 3) return generatePolygonPath(points);

    // 先检测角点，将路径分成多个段
    const corners = detectCornersVTracer(pts, 120, 3);
    
    // 如果没有角点，整体拟合
    if (corners.length === 0) {
        return fitSegmentWithLineDetection(pts, maxError) + (closed ? 'Z' : '');
    }

    // 按角点分段
    const n = pts.length;
    let path = `M${pts[corners[0]].x.toFixed(2)},${pts[corners[0]].y.toFixed(2)}`;

    for (let i = 0; i < corners.length; i++) {
        const start = corners[i];
        const end = corners[(i + 1) % corners.length];

        // 提取这一段的点
        const segment = [];
        if (end > start) {
            for (let j = start; j <= end; j++) segment.push(pts[j]);
        } else {
            for (let j = start; j < n; j++) segment.push(pts[j]);
            for (let j = 0; j <= end; j++) segment.push(pts[j]);
        }

        if (segment.length < 2) continue;

        // 检查是否是直线段
        if (isLinearSegment(segment, 1.5)) {
            // 直线段：只用 L 命令
            path += `L${segment[segment.length - 1].x.toFixed(2)},${segment[segment.length - 1].y.toFixed(2)}`;
        } else {
            // 曲线段：使用贝塞尔拟合
            const segPath = fitSegmentCurve(segment, maxError);
            path += segPath;
        }
    }

    return path + 'Z';
}

/**
 * 对单段进行曲线拟合（返回不含 M 的路径）
 */
export function fitSegmentCurve(points, maxError) {
    if (points.length < 2) return '';
    if (points.length === 2) {
        return `L${points[1].x.toFixed(2)},${points[1].y.toFixed(2)}`;
    }

    const pts = points.map(p => [p.x, p.y]);

    if (typeof window !== 'undefined' && typeof window.fitCurve === 'function') {
        try {
            const curves = window.fitCurve(pts, Math.max(0.1, maxError));
            if (curves && curves.length > 0) {
                let path = '';
                for (const c of curves) {
                    path += `C${c[1][0].toFixed(2)},${c[1][1].toFixed(2)},${c[2][0].toFixed(2)},${c[2][1].toFixed(2)},${c[3][0].toFixed(2)},${c[3][1].toFixed(2)}`;
                }
                return path;
            }
        } catch (e) {}
    }

    // 回退：直线
    return `L${points[points.length - 1].x.toFixed(2)},${points[points.length - 1].y.toFixed(2)}`;
}

/**
 * 带直线检测的整体拟合
 */
export function fitSegmentWithLineDetection(pts, maxError) {
    // 优先使用 fit-curve
    if (typeof window !== 'undefined' && typeof window.fitCurve === 'function') {
        try {
            const inputPts = pts.map(p => [p.x, p.y]);
            const curves = window.fitCurve(inputPts, Math.max(0.1, maxError * 0.5));
            if (curves && curves.length > 0) {
                let path = `M${curves[0][0][0].toFixed(2)},${curves[0][0][1].toFixed(2)}`;
                for (const c of curves) {
                    path += `C${c[1][0].toFixed(2)},${c[1][1].toFixed(2)},${c[2][0].toFixed(2)},${c[2][1].toFixed(2)},${c[3][0].toFixed(2)},${c[3][1].toFixed(2)}`;
                }
                return path;
            }
        } catch (e) {
            console.warn('[PotraceCore] fit-curve failed, using Catmull-Rom');
        }
    }

    // 回退到 Catmull-Rom（也能产生平滑曲线）
    return fitBezierCatmullRom(pts, 0.4);
}

/**
 * 贝塞尔曲线拟合（带角点检测）
 */
export function fitBezier(points, maxError = 2.5, cornerAngle = 60) {
    if (!points || points.length < 2) return '';
    if (points.length === 2) {
        return `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}L${points[1].x.toFixed(1)},${points[1].y.toFixed(1)}Z`;
    }

    // 使用带角点检测的拟合
    return fitBezierWithCorners(points, maxError, cornerAngle);
}

/**
 * Catmull-Rom 样条曲线拟合
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
 * 反转 SVG 路径方向（用于孔洞）
 */
export function reversePath(pathD) {
    // 简单方法：解析点并反转顺序
    const points = [];
    const regex = /([ML])([^MLCZml]+)/g;
    let match;
    
    while ((match = regex.exec(pathD)) !== null) {
        const coords = match[2].split(',').map(s => parseFloat(s.trim()));
        if (coords.length >= 2) {
            points.push({ x: coords[0], y: coords[1] });
        }
    }
    
    // 处理贝塞尔曲线
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
        // 反转贝塞尔曲线
        beziers.reverse();
        let reversed = `M${beziers[0].end.x.toFixed(1)},${beziers[0].end.y.toFixed(1)}`;
        for (let i = 0; i < beziers.length; i++) {
            const b = beziers[i];
            const nextEnd = i < beziers.length - 1 ? beziers[i + 1].end : points[0] || beziers[beziers.length - 1].end;
            reversed += `C${b.cp2.x.toFixed(1)},${b.cp2.y.toFixed(1)},${b.cp1.x.toFixed(1)},${b.cp1.y.toFixed(1)},${nextEnd.x.toFixed(1)},${nextEnd.y.toFixed(1)}`;
        }
        return reversed + 'Z';
    }
    
    // 反转简单路径
    if (points.length < 2) return pathD;
    points.reverse();
    let reversed = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
    for (let i = 1; i < points.length; i++) {
        reversed += `L${points[i].x.toFixed(1)},${points[i].y.toFixed(1)}`;
    }
    return reversed + 'Z';
}
