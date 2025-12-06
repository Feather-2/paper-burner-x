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
    // 阈值 150 度 = 只检测真正的尖角，平滑曲线不分段
    const corners = detectCornersVTracer(pts, 150, 5);
    
    // 如果角点很少，整体拟合（产生更平滑的曲线）
    if (corners.length < 2) {
        return fitSegmentWithLineDetection(pts, maxError * 2) + (closed ? 'Z' : '');
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
 * 最小二乘三次贝塞尔拟合
 * 
 * 使用正确的数学方法：求解线性方程组找最优控制点
 * 参考: "An Algorithm for Automatically Fitting Digitized Curves" - Philip J. Schneider
 */
export function fitSegmentCurve(points, maxError) {
    if (points.length < 2) return '';
    if (points.length === 2) {
        return `L${points[1].x.toFixed(2)},${points[1].y.toFixed(2)}`;
    }
    
    const n = points.length;
    const p0 = points[0];
    const p3 = points[n - 1];
    
    // 计算每个点的参数 t（弧长参数化）
    const t = [0];
    let totalLen = 0;
    for (let i = 1; i < n; i++) {
        const dx = points[i].x - points[i-1].x;
        const dy = points[i].y - points[i-1].y;
        totalLen += Math.sqrt(dx*dx + dy*dy);
        t.push(totalLen);
    }
    for (let i = 1; i < n; i++) {
        t[i] /= totalLen || 1;
    }
    
    // 计算切线方向（使用多点平均，更稳定）
    const lookAhead = Math.min(4, Math.floor(n / 3));
    let dx1 = 0, dy1 = 0, dx2 = 0, dy2 = 0;
    for (let i = 1; i <= lookAhead; i++) {
        dx1 += points[i].x - p0.x;
        dy1 += points[i].y - p0.y;
        dx2 += p3.x - points[n - 1 - i].x;
        dy2 += p3.y - points[n - 1 - i].y;
    }
    const tan1 = normalize({ x: dx1, y: dy1 });
    const tan2 = normalize({ x: dx2, y: dy2 });
    
    // 最小二乘求解控制点距离 alpha1, alpha2
    // B(t) = (1-t)³P0 + 3(1-t)²t·P1 + 3(1-t)t²·P2 + t³·P3
    // P1 = P0 + alpha1 * tan1
    // P2 = P3 - alpha2 * tan2
    
    let c00 = 0, c01 = 0, c11 = 0;
    let x0 = 0, x1 = 0;
    
    for (let i = 0; i < n; i++) {
        const ti = t[i];
        const b0 = (1-ti) * (1-ti) * (1-ti);
        const b1 = 3 * (1-ti) * (1-ti) * ti;
        const b2 = 3 * (1-ti) * ti * ti;
        const b3 = ti * ti * ti;
        
        // A1 = b1 * tan1, A2 = b2 * tan2
        const a1x = b1 * tan1.x, a1y = b1 * tan1.y;
        const a2x = b2 * tan2.x, a2y = b2 * tan2.y;
        
        c00 += a1x*a1x + a1y*a1y;
        c01 += a1x*a2x + a1y*a2y;
        c11 += a2x*a2x + a2y*a2y;
        
        // 目标：点 - 基础曲线
        const baseX = b0*p0.x + b3*p3.x;
        const baseY = b0*p0.y + b3*p3.y;
        const diffX = points[i].x - baseX;
        const diffY = points[i].y - baseY;
        
        x0 += a1x*diffX + a1y*diffY;
        x1 += a2x*diffX + a2y*diffY;
    }
    
    // 求解 2x2 线性方程组
    const det = c00*c11 - c01*c01;
    let alpha1, alpha2;
    
    if (Math.abs(det) > 1e-6) {
        alpha1 = (c11*x0 - c01*x1) / det;
        alpha2 = (c00*x1 - c01*x0) / det;
    } else {
        // 退化情况：使用弦长的 1/3
        const chordLen = Math.sqrt((p3.x-p0.x)**2 + (p3.y-p0.y)**2);
        alpha1 = alpha2 = chordLen / 3;
    }
    
    // 确保 alpha 为正且合理
    const chordLen = Math.sqrt((p3.x-p0.x)**2 + (p3.y-p0.y)**2);
    alpha1 = Math.max(chordLen * 0.1, Math.min(chordLen * 0.6, Math.abs(alpha1)));
    alpha2 = Math.max(chordLen * 0.1, Math.min(chordLen * 0.6, Math.abs(alpha2)));
    
    const cp1 = { x: p0.x + alpha1 * tan1.x, y: p0.y + alpha1 * tan1.y };
    const cp2 = { x: p3.x - alpha2 * tan2.x, y: p3.y - alpha2 * tan2.y };
    
    return `C${cp1.x.toFixed(2)},${cp1.y.toFixed(2)},${cp2.x.toFixed(2)},${cp2.y.toFixed(2)},${p3.x.toFixed(2)},${p3.y.toFixed(2)}`;
}

function normalize(v) {
    const len = Math.sqrt(v.x*v.x + v.y*v.y);
    if (len < 1e-6) return { x: 1, y: 0 };
    return { x: v.x/len, y: v.y/len };
}

/**
 * VTracer 风格控制点回缩 (retract_handles)
 * 
 * 修复贝塞尔曲线控制点过长导致的过冲问题
 * 自适应设计：小曲线（孔洞）使用更宽松的限制，避免变形
 * 
 * @param {Array} curve - [p0, cp1, cp2, p3] 贝塞尔曲线（坐标为数组 [x, y]）
 * @param {Object} options - 配置选项
 * @returns {Array} 修正后的曲线
 */
export function retractHandles(curve, options = {}) {
    const {
        maxRatio = 0.4,      // 大曲线的控制点最大比例
        minRatio = 0.6,      // 小曲线（孔洞）的控制点最大比例
        smallThreshold = 20, // 小曲线阈值（弦长 < 此值视为小曲线）
        minHandleLen = 2     // 控制柄最小长度（保护细节）
    } = options;
    
    const [p0, cp1, cp2, p3] = curve;
    
    // 计算端点距离（弦长）
    const dx = p3[0] - p0[0];
    const dy = p3[1] - p0[1];
    const chordLen = Math.sqrt(dx * dx + dy * dy);
    
    // 弦长太小，不处理
    if (chordLen < 2) return curve;
    
    // 自适应比例：小曲线使用更宽松的限制
    // 这保护了孔洞等小区域的曲线质量
    const ratio = chordLen < smallThreshold 
        ? minRatio  // 小曲线：允许更长的控制柄
        : maxRatio; // 大曲线：严格限制
    
    const maxLen = Math.max(minHandleLen, chordLen * ratio);
    
    // 计算控制柄向量和长度
    const l1x = cp1[0] - p0[0];
    const l1y = cp1[1] - p0[1];
    const l1 = Math.sqrt(l1x * l1x + l1y * l1y);
    
    const l2x = cp2[0] - p3[0];
    const l2y = cp2[1] - p3[1];
    const l2 = Math.sqrt(l2x * l2x + l2y * l2y);
    
    let newCp1 = cp1;
    let newCp2 = cp2;
    
    // 回缩过长的控制柄
    if (l1 > maxLen && l1 > 0.01) {
        const scale = maxLen / l1;
        newCp1 = [p0[0] + l1x * scale, p0[1] + l1y * scale];
    }
    
    if (l2 > maxLen && l2 > 0.01) {
        const scale = maxLen / l2;
        newCp2 = [p3[0] + l2x * scale, p3[1] + l2y * scale];
    }
    
    return [p0, newCp1, newCp2, p3];
}

/**
 * 对 fit-curve 输出的曲线数组应用 retractHandles
 * @param {Array} curves - fit-curve 返回的曲线数组
 * @param {Object} options - retractHandles 选项
 * @returns {Array} 处理后的曲线数组
 */
export function retractHandlesAll(curves, options = {}) {
    return curves.map(c => retractHandles(c, options));
}

/**
 * 整体拟合 - 使用 Catmull-Rom 样条（最稳定）
 */
export function fitSegmentWithLineDetection(pts, maxError) {
    return fitBezierCatmullRom(pts, 0.4);  // 低张力 = 更平滑
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
