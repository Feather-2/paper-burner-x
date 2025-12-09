/**
 * Potrace Core - 角点检测模块
 * 
 * VTracer 风格角点检测算法
 */

/**
 * 计算点的局部曲率（使用更大的邻域）
 * VTracer 风格：考虑更大范围的点来判断角点
 */
export function computeCurvature(points, index, radius = 3) {
    const n = points.length;
    if (n < 3) return Math.PI;

    // 取前后 radius 个点
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
 * 角点检测（平衡版本）
 * 只使用较大尺度，避免检测到噪点
 */
export function detectCornersVTracerStrict(points, angleThreshold = 130, minDistance = 3) {
    if (points.length < 6) return [];

    const n = points.length;
    const corners = new Set();

    // 只使用较大尺度，避免检测到像素级噪点
    const radii = [4, 6];
    const threshold = angleThreshold * Math.PI / 180;

    for (const radius of radii) {
        if (n < radius * 2 + 1) continue;

        // 计算每个点在当前尺度的曲率
        for (let i = 0; i < n; i++) {
            const angle = computeCurvature(points, i, radius);

            // 角度小于阈值就是角点
            if (angle < threshold) {
                // 检查是否是局部最小（只检查相邻1-2个点）
                const checkRange = Math.min(2, minDistance);
                let isLocalMin = true;
                for (let j = 1; j <= checkRange; j++) {
                    const prevAngle = computeCurvature(points, (i - j + n) % n, radius);
                    const nextAngle = computeCurvature(points, (i + j) % n, radius);
                    if (angle > prevAngle + 0.01 || angle > nextAngle + 0.01) {
                        isLocalMin = false;
                        break;
                    }
                }
                if (isLocalMin) {
                    corners.add(i);
                }
            }
        }
    }

    return Array.from(corners).sort((a, b) => a - b);
}

/**
 * VTracer 风格角点检测（原版本，保留兼容）
 */
export function detectCornersVTracer(points, angleThreshold = 90, minDistance = 5) {
    if (points.length < 6) return [];

    const n = points.length;
    const curvatures = [];

    // 1. 计算每个点的曲率
    for (let i = 0; i < n; i++) {
        const angle = computeCurvature(points, i, 3);
        curvatures.push({ index: i, angle });
    }

    // 2. 找局部最小值（曲率最大的点 = 角度最小的点）
    const threshold = angleThreshold * Math.PI / 180;
    const candidates = [];

    for (let i = 0; i < n; i++) {
        const curr = curvatures[i].angle;
        if (curr >= threshold) continue; // 角度太大，不是角点

        // 非极大值抑制：检查是否是局部最小
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

    // 3. 按角度排序，取最显著的角点
    candidates.sort((a, b) => a.angle - b.angle);

    // 4. 去除距离太近的角点
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
 * VTracer 风格完整处理流程
 * 极致锐利版本 - 角点完全保持原始位置
 */
export function processContourVTracer(points, options = {}) {
    const {
        cornerAngle = 110,      // 角点阈值（度）- 更敏感
        minCornerDist = 2,      // 角点最小距离 - 更小
        cornerProtectRadius = 3 // 角点保护半径 - 更大
    } = options;

    if (points.length < 4) return { points, corners: [] };

    // 1. 检测角点（使用更敏感的参数）
    const cornerIndices = detectCornersVTracerStrict(points, cornerAngle, minCornerDist);
    const cornerSet = new Set(cornerIndices);
    const n = points.length;

    // 保存原始角点位置
    const originalCorners = new Map();
    for (const ci of cornerIndices) {
        originalCorners.set(ci, { x: points[ci].x, y: points[ci].y });
    }

    // 2. 标记所有点
    const smoothed = points.map((p, i) => {
        const isCorner = cornerSet.has(i);
        let isNearCorner = false;
        let distToCorner = Infinity;

        if (!isCorner) {
            for (const ci of cornerIndices) {
                const dist = Math.min(Math.abs(i - ci), n - Math.abs(i - ci));
                if (dist <= cornerProtectRadius && dist < distToCorner) {
                    isNearCorner = true;
                    distToCorner = dist;
                }
            }
        }

        // 角点：完全保持原始位置
        if (isCorner) {
            return { x: p.x, y: p.y, isCorner: true, isNearCorner: false };
        }

        // 近角点：根据距离渐变平滑（距离越近平滑越少）
        if (isNearCorner) {
            const weight = distToCorner / (cornerProtectRadius + 1); // 0~1
            const prev = points[(i - 1 + n) % n];
            const next = points[(i + 1) % n];
            const smoothX = (prev.x + p.x + next.x) / 3;
            const smoothY = (prev.y + p.y + next.y) / 3;
            return {
                x: p.x * (1 - weight) + smoothX * weight,
                y: p.y * (1 - weight) + smoothY * weight,
                isCorner: false,
                isNearCorner: true
            };
        }

        // 非角点区域：正常平滑
        const prev = points[(i - 1 + n) % n];
        const next = points[(i + 1) % n];
        return {
            x: (prev.x + p.x + next.x) / 3,
            y: (prev.y + p.y + next.y) / 3,
            isCorner: false,
            isNearCorner: false
        };
    });

    // 3. 提取结果
    const finalPoints = smoothed.map(p => ({ x: p.x, y: p.y }));
    const finalCorners = smoothed
        .map((p, i) => p.isCorner ? i : -1)
        .filter(i => i >= 0);

    return { points: finalPoints, corners: finalCorners };
}
