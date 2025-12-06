/**
 * Potrace Core - 路径平滑模块
 * 
 * 实现 VTracer/Visioncortex 的核心平滑算法：
 * - 4-Point Subdivision Scheme（迭代细分）
 * - Staircase Removal（阶梯去除）
 * - Chaikin 角切割
 * - 移动平均
 */

/**
 * VTracer 核心算法：4-Point Subdivision Scheme
 * 
 * 这是产生平滑曲线的关键算法。
 * 每次迭代将点数翻倍，使用 4 点加权公式计算新点位置。
 * 公式: new = (-p0 + 9*p1 + 9*p2 - p3) / 16
 * 
 * 参考: visioncortex/src/path/smooth.rs
 */
export function subdivide4Point(points, iterations = 2) {
    if (points.length < 4) return points;
    
    let result = points.slice();
    
    for (let iter = 0; iter < iterations; iter++) {
        const n = result.length;
        const newPoints = [];
        
        for (let i = 0; i < n; i++) {
            const p0 = result[(i - 1 + n) % n];
            const p1 = result[i];
            const p2 = result[(i + 1) % n];
            const p3 = result[(i + 2) % n];
            
            // 保留原点
            newPoints.push({ x: p1.x, y: p1.y });
            
            // 插入中点（4点细分公式）
            // new = (-p0 + 9*p1 + 9*p2 - p3) / 16
            newPoints.push({
                x: (-p0.x + 9 * p1.x + 9 * p2.x - p3.x) / 16,
                y: (-p0.y + 9 * p1.y + 9 * p2.y - p3.y) / 16
            });
        }
        
        result = newPoints;
    }
    
    return result;
}

/**
 * VTracer 核心算法：Staircase Removal（阶梯去除）
 * 
 * 检测并移除像素级的水平/垂直阶梯模式。
 * 关键：检测交替的水平-垂直-水平模式（锯齿的本质）
 * 
 * 参考: visioncortex/src/path/staircase.rs
 */
export function removeStaircase(points) {
    if (points.length < 4) return points;
    
    const n = points.length;
    const keep = new Array(n).fill(true);
    
    // 检测每个点是否是阶梯模式的一部分
    for (let i = 1; i < n - 1; i++) {
        const prev = points[(i - 1 + n) % n];
        const curr = points[i];
        const next = points[(i + 1) % n];
        
        const dx1 = curr.x - prev.x;
        const dy1 = curr.y - prev.y;
        const dx2 = next.x - curr.x;
        const dy2 = next.y - curr.y;
        
        // 检测交替模式：水平→垂直 或 垂直→水平
        const isHV = Math.abs(dx1) > 0.3 && Math.abs(dy1) < 0.3 &&  // 水平
                     Math.abs(dx2) < 0.3 && Math.abs(dy2) > 0.3;    // 垂直
        const isVH = Math.abs(dy1) > 0.3 && Math.abs(dx1) < 0.3 &&  // 垂直
                     Math.abs(dy2) < 0.3 && Math.abs(dx2) > 0.3;    // 水平
        
        // 阶梯转折点：标记为可删除
        if (isHV || isVH) {
            // 检查移动幅度是否为像素级（<2像素）
            const len1 = Math.sqrt(dx1*dx1 + dy1*dy1);
            const len2 = Math.sqrt(dx2*dx2 + dy2*dy2);
            if (len1 < 2.5 && len2 < 2.5) {
                keep[i] = false;
            }
        }
    }
    
    // 收集保留的点
    const result = [];
    for (let i = 0; i < n; i++) {
        if (keep[i]) {
            result.push(points[i]);
        }
    }
    
    // 如果删除太多，回退
    if (result.length < points.length * 0.3) {
        return points;
    }
    
    return result;
}

/**
 * Ramer-Douglas-Peucker 路径简化
 * 保留关键转折点，去除冗余点
 * 
 * 参考: visioncortex/src/path/simplify.rs
 */
export function simplifyRDP(points, epsilon = 1.0) {
    if (points.length < 3) return points;
    
    // 找到距离首尾连线最远的点
    const first = points[0];
    const last = points[points.length - 1];
    
    let maxDist = 0;
    let maxIndex = 0;
    
    for (let i = 1; i < points.length - 1; i++) {
        const dist = perpendicularDistance(points[i], first, last);
        if (dist > maxDist) {
            maxDist = dist;
            maxIndex = i;
        }
    }
    
    // 如果最大距离大于阈值，递归简化
    if (maxDist > epsilon) {
        const left = simplifyRDP(points.slice(0, maxIndex + 1), epsilon);
        const right = simplifyRDP(points.slice(maxIndex), epsilon);
        return left.slice(0, -1).concat(right);
    } else {
        return [first, last];
    }
}

/**
 * 计算点到线段的垂直距离
 */
function perpendicularDistance(point, lineStart, lineEnd) {
    const dx = lineEnd.x - lineStart.x;
    const dy = lineEnd.y - lineStart.y;
    const lineLenSq = dx * dx + dy * dy;
    
    if (lineLenSq === 0) {
        return Math.sqrt((point.x - lineStart.x) ** 2 + (point.y - lineStart.y) ** 2);
    }
    
    const t = Math.max(0, Math.min(1, 
        ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lineLenSq
    ));
    
    const projX = lineStart.x + t * dx;
    const projY = lineStart.y + t * dy;
    
    return Math.sqrt((point.x - projX) ** 2 + (point.y - projY) ** 2);
}

/**
 * 闭合路径的 RDP 简化
 */
export function simplifyRDPClosed(points, epsilon = 1.0) {
    if (points.length < 4) return points;
    
    // 对闭合路径，找到最远的两个点作为分割点
    const n = points.length;
    let maxDist = 0;
    let splitIndex = 0;
    
    for (let i = 1; i < n; i++) {
        const dist = Math.sqrt(
            (points[i].x - points[0].x) ** 2 + 
            (points[i].y - points[0].y) ** 2
        );
        if (dist > maxDist) {
            maxDist = dist;
            splitIndex = i;
        }
    }
    
    // 分成两半分别简化
    const part1 = points.slice(0, splitIndex + 1);
    const part2 = points.slice(splitIndex).concat([points[0]]);
    
    const simplified1 = simplifyRDP(part1, epsilon);
    const simplified2 = simplifyRDP(part2, epsilon);
    
    // 合并，去除重复的连接点
    return simplified1.slice(0, -1).concat(simplified2.slice(0, -1));
}

/**
 * VTracer 完整平滑流程（修正版）
 * 重点：多次移动平均 + 细分 = 真正平滑
 */
export function smoothPathVTracer(points, options = {}) {
    const {
        staircaseRemoval = true,
        simplifyEpsilon = 0.8,
        subdivisionIterations = 2,
        smoothIterations = 3
    } = options;
    
    if (points.length < 4) return points;
    
    let result = points;
    
    // 1. 去除阶梯锯齿
    if (staircaseRemoval) {
        result = removeStaircase(result);
    }
    
    // 2. RDP 简化
    if (simplifyEpsilon > 0 && result.length > 30) {
        result = simplifyRDPClosed(result, simplifyEpsilon);
    }
    
    // 3. 多次移动平均平滑（关键！）
    for (let i = 0; i < smoothIterations; i++) {
        result = movingAverageSmooth(result, 5);  // 窗口 5
    }
    
    // 4. 4点细分
    if (subdivisionIterations > 0 && result.length >= 4) {
        result = subdivide4Point(result, subdivisionIterations);
    }
    
    // 5. 最终平滑
    result = movingAverageSmooth(result, 3);
    
    return result;
}

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
 * Chaikin 平滑 - 保护角点版本
 * 角点保持锐利，只平滑曲线部分
 */
export function chaikinSmoothPreserveCorners(points, iterations = 2, cornerIndices = new Set()) {
    if (points.length < 3) return points;
    if (cornerIndices.size === 0) return chaikinSmooth(points, iterations);

    // 记录角点位置
    const corners = [];
    for (const idx of cornerIndices) {
        corners.push({ ...points[idx], originalIdx: idx });
    }

    let result = points.slice();
    
    for (let iter = 0; iter < iterations; iter++) {
        const smoothed = [];
        const n = result.length;
        
        // 每次迭代后角点索引会变化，需要追踪
        const newCornerPositions = new Map();

        for (let i = 0; i < n; i++) {
            const p0 = result[i];
            const p1 = result[(i + 1) % n];
            
            // 检查当前点是否接近某个角点
            const isCorner = corners.some(c => 
                Math.abs(p0.x - c.x) < 0.5 && Math.abs(p0.y - c.y) < 0.5
            );
            
            if (isCorner) {
                // 角点：保持原位，只插入一个点
                smoothed.push({ x: p0.x, y: p0.y });
                smoothed.push({
                    x: p0.x * 0.5 + p1.x * 0.5,
                    y: p0.y * 0.5 + p1.y * 0.5
                });
            } else {
                // 非角点：正常 Chaikin
                smoothed.push({
                    x: p0.x * 0.75 + p1.x * 0.25,
                    y: p0.y * 0.75 + p1.y * 0.25
                });
                smoothed.push({
                    x: p0.x * 0.25 + p1.x * 0.75,
                    y: p0.y * 0.25 + p1.y * 0.75
                });
            }
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
