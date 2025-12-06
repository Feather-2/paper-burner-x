/**
 * 矢量化工具函数
 * @module vectorizer/utils
 */

/**
 * 计算两个颜色的距离平方
 */
export function colorDistSq(c1, c2) {
    const dr = c1[0] - c2[0], dg = c1[1] - c2[1], db = c1[2] - c2[2];
    return dr * dr + dg * dg + db * db;
}

/**
 * 计算两个颜色的距离
 */
export function colorDistance(c1, c2) {
    return Math.sqrt(colorDistSq(c1, c2));
}

/**
 * 计算两点距离
 */
export function distance(p1, p2) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * 计算两点距离平方
 */
export function distanceSq(p1, p2) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    return dx * dx + dy * dy;
}

/**
 * 向量归一化
 */
export function normalize(v) {
    const len = Math.sqrt(v.x * v.x + v.y * v.y);
    if (len < 1e-10) return { x: 0, y: 0 };
    return { x: v.x / len, y: v.y / len };
}

/**
 * 向量模长
 */
export function norm(v) {
    return Math.sqrt(v.x * v.x + v.y * v.y);
}

/**
 * 向量减法
 */
export function subtract(p1, p2) {
    return { x: p1.x - p2.x, y: p1.y - p2.y };
}

/**
 * 向量加法
 */
export function add(p1, p2) {
    return { x: p1.x + p2.x, y: p1.y + p2.y };
}

/**
 * 向量缩放
 */
export function scale(v, s) {
    return { x: v.x * s, y: v.y * s };
}

/**
 * 计算两点中点
 */
export function midpoint(p1, p2) {
    return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
}

/**
 * 计算向量角度 (弧度，-π 到 π)
 */
export function angle(v) {
    return Math.atan2(v.y, v.x);
}

/**
 * 计算有符号角度差 (VTracer 风格)
 * @param {number} from - 起始角度 (弧度)
 * @param {number} to - 目标角度 (弧度)
 * @returns {number} 有符号角度差 (-π 到 π)
 */
export function signedAngleDifference(from, to) {
    let v2 = to;
    if (from > to) {
        v2 += 2 * Math.PI;
    }
    const diff = v2 - from;
    if (diff > Math.PI) {
        return diff - 2 * Math.PI;
    }
    return diff;
}

/**
 * 计算三角形有符号面积 (Shoelace)
 * 正值 = 顺时针，负值 = 逆时针
 */
export function signedArea(p1, p2, p3) {
    return (p2.x - p1.x) * (p3.y - p1.y) - (p3.x - p1.x) * (p2.y - p1.y);
}

/**
 * 计算多边形面积 (Shoelace formula)
 */
export function polygonArea(points) {
    let area = 0;
    const n = points.length;
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        area += points[i].x * points[j].y;
        area -= points[j].x * points[i].y;
    }
    return area / 2;
}

/**
 * 点到线段的距离
 */
export function pointLineDistance(point, lineStart, lineEnd) {
    const dx = lineEnd.x - lineStart.x;
    const dy = lineEnd.y - lineStart.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return distance(point, lineStart);
    return Math.abs(dy * point.x - dx * point.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x) / len;
}

/**
 * 找两条线段的交点
 * @returns {Object|null} { point, mua, mub } 或 null
 */
export function findIntersection(p1, p2, p3, p4) {
    const denom = (p4.y - p3.y) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.y - p1.y);
    const numera = (p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x);
    const numerb = (p2.x - p1.x) * (p1.y - p3.y) - (p2.y - p1.y) * (p1.x - p3.x);

    const EPSILON = 1e-7;
    const negligible = (v) => Math.abs(v) < EPSILON;

    // 两线重合
    if (negligible(denom) && negligible(numera) && negligible(numerb)) {
        return { point: midpoint(p1, p2), mua: NaN, mub: NaN };
    }

    // 两线平行
    if (negligible(denom)) {
        return null;
    }

    const mua = numera / denom;
    const mub = numerb / denom;

    return {
        point: {
            x: p1.x + mua * (p2.x - p1.x),
            y: p1.y + mua * (p2.y - p1.y)
        },
        mua,
        mub
    };
}

/**
 * 角度转弧度
 */
export function degToRad(deg) {
    return deg * Math.PI / 180;
}

/**
 * 弧度转角度
 */
export function radToDeg(rad) {
    return rad * 180 / Math.PI;
}

/**
 * 限制数值范围
 */
export function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
