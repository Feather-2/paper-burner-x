/**
 * 轮廓追踪模块 (Marching Squares + VTracer PathWalker)
 * @module vectorizer/contour-tracer
 */

import { polygonArea } from './utils.js';

/**
 * Marching Squares 轮廓追踪 (亚像素精度)
 *
 * 格子配置 (2x2):
 *   TL(8) -- TR(4)
 *     |       |
 *   BL(1) -- BR(2)
 *
 * 边定义: 0=top, 1=right, 2=bottom, 3=left
 */
export function marchingSquaresContour(bitmap, ccResult = null, regionLabel = null, grayscaleData = null) {
    const { data, width, height } = bitmap;
    const contours = [];
    const visitedEdges = new Set();

    // 获取像素值 (支持指定区域)
    const getPixel = (x, y) => {
        if (x < 0 || x >= width || y < 0 || y >= height) return 0;
        if (regionLabel !== null && ccResult) {
            return ccResult.labels[y * width + x] === regionLabel ? 1 : 0;
        }
        return data[y * width + x];
    };

    // 获取灰度值用于插值
    const getGray = (x, y) => {
        if (!grayscaleData) return getPixel(x, y) * 255;
        if (x < 0 || x >= width || y < 0 || y >= height) return 0;
        return grayscaleData[y * width + x];
    };

    // 获取 2x2 格子配置 (0-15)
    const getConfig = (cx, cy) => {
        const tl = getPixel(cx, cy);
        const tr = getPixel(cx + 1, cy);
        const bl = getPixel(cx, cy + 1);
        const br = getPixel(cx + 1, cy + 1);
        return (tl << 3) | (tr << 2) | (br << 1) | bl;
    };

    // 线性插值
    const interpolate = (v1, v2, target) => {
        if (Math.abs(v2 - v1) < 1) return 0.5;
        let t = (target - v1) / (v2 - v1);
        return Math.max(0.1, Math.min(0.9, t));
    };

    const threshold = 128;

    // 计算边上的精确位置 (VTracer 风格亚像素)
    const edgePoint = (cx, cy, edge) => {
        let g1, g2, t;

        switch (edge) {
            case 0: // top edge: TL -> TR
                g1 = getGray(cx, cy);
                g2 = getGray(cx + 1, cy);
                t = interpolate(g1, g2, threshold);
                return { x: cx + t, y: cy };

            case 1: // right edge: TR -> BR
                g1 = getGray(cx + 1, cy);
                g2 = getGray(cx + 1, cy + 1);
                t = interpolate(g1, g2, threshold);
                return { x: cx + 1, y: cy + t };

            case 2: // bottom edge: BL -> BR
                g1 = getGray(cx, cy + 1);
                g2 = getGray(cx + 1, cy + 1);
                t = interpolate(g1, g2, threshold);
                return { x: cx + t, y: cy + 1 };

            case 3: // left edge: TL -> BL
                g1 = getGray(cx, cy);
                g2 = getGray(cx, cy + 1);
                t = interpolate(g1, g2, threshold);
                return { x: cx, y: cy + t };
        }
        return { x: cx + 0.5, y: cy + 0.5 };
    };

    // Marching Squares 转移表
    const edgeTable = {
        1:  [[3, 2]],
        2:  [[2, 1]],
        3:  [[3, 1]],
        4:  [[1, 0]],
        5:  [[1, 0], [3, 2]],
        6:  [[2, 0]],
        7:  [[3, 0]],
        8:  [[0, 3]],
        9:  [[0, 2]],
        10: [[0, 3], [2, 1]],
        11: [[0, 1]],
        12: [[1, 3]],
        13: [[1, 2]],
        14: [[2, 3]],
    };

    const nextCell = {
        0: [0, -1],
        1: [1, 0],
        2: [0, 1],
        3: [-1, 0],
    };

    const enterEdge = { 0: 2, 1: 3, 2: 0, 3: 1 };

    // 追踪单个轮廓
    const traceContour = (startCx, startCy, startInEdge, startOutEdge) => {
        const points = [];
        let cx = startCx, cy = startCy;
        let inEdge = startInEdge, outEdge = startOutEdge;
        const maxSteps = (width + height) * 4;
        let steps = 0;

        do {
            const edgeKey = `${cx},${cy},${outEdge}`;
            if (visitedEdges.has(edgeKey)) break;
            visitedEdges.add(edgeKey);

            const pt = edgePoint(cx, cy, outEdge);
            points.push(pt);

            const [dx, dy] = nextCell[outEdge];
            cx += dx;
            cy += dy;
            inEdge = enterEdge[outEdge];

            const config = getConfig(cx, cy);
            if (config === 0 || config === 15) break;

            const edges = edgeTable[config];
            if (!edges) break;

            let found = false;
            for (const [ein, eout] of edges) {
                if (ein === inEdge) {
                    outEdge = eout;
                    found = true;
                    break;
                }
            }
            if (!found) break;

            steps++;
        } while (steps < maxSteps && !(cx === startCx && cy === startCy && outEdge === startOutEdge));

        return points;
    };

    // 扫描所有格子
    for (let cy = -1; cy < height; cy++) {
        for (let cx = -1; cx < width; cx++) {
            const config = getConfig(cx, cy);
            if (config === 0 || config === 15) continue;

            const edges = edgeTable[config];
            if (!edges) continue;

            for (const [inEdge, outEdge] of edges) {
                const edgeKey = `${cx},${cy},${outEdge}`;
                if (visitedEdges.has(edgeKey)) continue;

                const pts = traceContour(cx, cy, inEdge, outEdge);
                if (pts.length >= 3) {
                    pts.push({ ...pts[0] });

                    const area = polygonArea(pts);
                    contours.push({
                        points: pts,
                        type: area >= 0 ? 'outer' : 'inner',
                        area: area
                    });
                }
            }
        }
    }

    contours.sort((a, b) => Math.abs(b.area) - Math.abs(a.area));

    return contours;
}

/**
 * VTracer 风格 PathWalker
 * 4方向边界行走 + Straight Run 优化
 */
export function pathWalkerTrace(bitmap, startX, startY, clockwise = true) {
    const { data, width, height } = bitmap;
    const points = [];

    const getPixel = (x, y) => {
        if (x < 0 || x >= width || y < 0 || y >= height) return false;
        return data[y * width + x] === 1;
    };

    // 方向: 0=上, 2=右, 4=下, 6=左
    const dirVec = {
        0: { x: 0, y: -1 },
        2: { x: 1, y: 0 },
        4: { x: 0, y: 1 },
        6: { x: -1, y: 0 }
    };

    // 边界检测（检查方向两侧像素值是否不同）
    const sideVecs = {
        0: [{ x: -1, y: -1 }, { x: 0, y: -1 }],
        2: [{ x: 0, y: 0 }, { x: 0, y: -1 }],
        4: [{ x: -1, y: 0 }, { x: 0, y: 0 }],
        6: [{ x: -1, y: 0 }, { x: -1, y: -1 }]
    };

    const range = clockwise ? [0, 2, 4, 6] : [6, 4, 2, 0];

    let curr = { x: startX, y: startY };
    let prev = { ...curr };
    let prevPrev = { ...curr };
    let lastDir = -1;

    const maxSteps = width * height * 2;
    let steps = 0;

    // 输出起点
    points.push({ ...curr });

    while (steps < maxSteps) {
        let go = -1;

        for (const dir of range) {
            const ahead = {
                x: curr.x + dirVec[dir].x,
                y: curr.y + dirVec[dir].y
            };

            // 跳过已访问点
            if ((ahead.x === prev.x && ahead.y === prev.y) ||
                (ahead.x === prevPrev.x && ahead.y === prevPrev.y)) {
                continue;
            }

            // 检查是否在边界上
            const [s1, s2] = sideVecs[dir];
            const p1 = getPixel(curr.x + s1.x, curr.y + s1.y);
            const p2 = getPixel(curr.x + s2.x, curr.y + s2.y);

            if (p1 !== p2) {
                go = dir;
                break;
            }
        }

        if (go === -1) break;

        // Straight Run 优化：方向改变时输出点
        if (lastDir !== -1 && lastDir !== go) {
            points.push({ ...curr });
        }

        lastDir = go;
        prevPrev = { ...prev };
        prev = { ...curr };
        curr = {
            x: curr.x + dirVec[go].x,
            y: curr.y + dirVec[go].y
        };

        // 回到起点
        if (curr.x === startX && curr.y === startY) {
            break;
        }

        steps++;
    }

    // 闭合
    if (points.length > 2) {
        points.push({ ...points[0] });
    }

    return points;
}
