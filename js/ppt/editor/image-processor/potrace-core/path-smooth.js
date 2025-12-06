/**
 * Potrace Core - 路径平滑模块
 * 
 * 提供 Chaikin 角切割和移动平均等平滑算法
 */

/**
 * Chaikin 角切割平滑算法
 * 每次迭代将角切掉，使曲线更平滑
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

            // 在每条边的 1/4 和 3/4 处插入新点
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
 * @param {Array} points - 点数组
 * @param {number} windowSize - 窗口大小（奇数）
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
 * Chaikin 平滑（最大锐利度版本）
 * 角点和近角点都完全保持原位
 */
export function chaikinSmoothTaggedSharp(points) {
    if (points.length < 3) return points;

    const n = points.length;
    const result = [];

    for (let i = 0; i < n; i++) {
        const p0 = points[i];
        const p1 = points[(i + 1) % n];

        if (p0.isCorner || p0.nearCorner) {
            // 角点或近角点：完全保持原样
            result.push({ ...p0 });
        } else if (p1.isCorner || p1.nearCorner) {
            // 下一个是角点/近角点：保持当前点，不添加中间点
            result.push({ ...p0 });
        } else {
            // 正常 Chaikin：添加 1/4 和 3/4 位置的点
            result.push({
                x: p0.x * 0.75 + p1.x * 0.25,
                y: p0.y * 0.75 + p1.y * 0.25,
                isCorner: false,
                nearCorner: false,
                distToCorner: Infinity
            });
            result.push({
                x: p0.x * 0.25 + p1.x * 0.75,
                y: p0.y * 0.25 + p1.y * 0.75,
                isCorner: false,
                nearCorner: false,
                distToCorner: Infinity
            });
        }
    }

    return result;
}

/**
 * 移动平均平滑（最大锐利度版本）
 * 角点和近角点都完全保持原位
 */
export function movingAverageSmoothTaggedSharp(points, windowSize = 3) {
    if (points.length < 3) return points;

    const half = Math.floor(windowSize / 2);
    const n = points.length;
    const result = [];

    for (let i = 0; i < n; i++) {
        if (points[i].isCorner || points[i].nearCorner) {
            // 角点或近角点：完全保持原样
            result.push({ ...points[i] });
        } else {
            // 非角点：正常平滑处理
            let sumX = 0, sumY = 0, count = 0;
            for (let j = -half; j <= half; j++) {
                const idx = (i + j + n) % n;
                // 跳过角点和近角点，不让它们影响平滑结果
                if (!points[idx].isCorner && !points[idx].nearCorner) {
                    sumX += points[idx].x;
                    sumY += points[idx].y;
                    count++;
                }
            }
            if (count > 0) {
                result.push({
                    x: sumX / count,
                    y: sumY / count,
                    isCorner: false,
                    nearCorner: false,
                    distToCorner: Infinity
                });
            } else {
                // 如果周围都是角点，保持原样
                result.push({ ...points[i] });
            }
        }
    }

    return result;
}

/**
 * Chaikin 平滑（带标记版本）
 */
export function chaikinSmoothTagged(points) {
    if (points.length < 3) return points;

    const n = points.length;
    const result = [];

    for (let i = 0; i < n; i++) {
        const p0 = points[i];
        const p1 = points[(i + 1) % n];

        if (p0.isCorner) {
            // 角点：保持原样
            result.push({ x: p0.x, y: p0.y, isCorner: true });
        } else if (p1.isCorner) {
            // 下一个是角点：只添加 3/4 位置点
            result.push({
                x: p0.x * 0.25 + p1.x * 0.75,
                y: p0.y * 0.25 + p1.y * 0.75,
                isCorner: false
            });
        } else {
            // 正常 Chaikin：添加 1/4 和 3/4 位置的点
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
 * 移动平均平滑（带标记版本）
 */
export function movingAverageSmoothTagged(points, windowSize = 5) {
    if (points.length < 3) return points;

    const half = Math.floor(windowSize / 2);
    const n = points.length;
    const result = [];

    for (let i = 0; i < n; i++) {
        if (points[i].isCorner) {
            // 角点：保持原样
            result.push({ ...points[i] });
        } else {
            // 非角点：平滑处理
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
 * VTracer 风格：只平滑非角点区域
 * 保护角点，只平滑曲线部分
 */
export function smoothPathPreservingCorners(points, corners, windowSize = 3) {
    if (points.length < 3 || corners.length === 0) {
        return movingAverageSmooth(points, windowSize);
    }

    const n = points.length;
    const half = Math.floor(windowSize / 2);
    const result = [];

    // 创建角点集合（包括角点附近的点也要保护）
    const protectedIndices = new Set();
    for (const c of corners) {
        for (let d = -2; d <= 2; d++) {
            protectedIndices.add((c + d + n) % n);
        }
    }

    for (let i = 0; i < n; i++) {
        if (protectedIndices.has(i)) {
            // 角点及附近：保持原样
            result.push({ ...points[i] });
        } else {
            // 非角点：平滑处理
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
    }

    return result;
}
