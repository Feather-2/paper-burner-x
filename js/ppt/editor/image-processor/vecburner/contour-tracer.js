/**
 * Potrace Core - 轮廓追踪模块
 * 
 * Marching Squares 亚像素精度轮廓追踪
 */

import { calculateArea } from './utils.js';

/**
 * Marching Squares - 亚像素精度轮廓追踪
 *
 * 格子配置 (2x2):
 *   TL(8) -- TR(4)
 *     |       |
 *   BL(1) -- BR(2)
 *
 * 边定义: 0=top, 1=right, 2=bottom, 3=left
 *
 * VTracer 风格改进：使用灰度值线性插值计算精确边界位置
 */
export function marchingSquaresContour(bitmap, ccResult = null, regionLabel = null, grayscaleData = null) {
    const { data, width, height } = bitmap;
    const contours = [];
    const visitedEdges = new Set(); // 用 "x,y,edge" 作为 key

    // 获取像素值 (支持指定区域)
    const getPixel = (x, y) => {
        if (x < 0 || x >= width || y < 0 || y >= height) return 0;
        if (regionLabel !== null && ccResult) {
            return ccResult.labels[y * width + x] === regionLabel ? 1 : 0;
        }
        return data[y * width + x];
    };

    // 获取灰度值用于插值 (0-255)
    const getGray = (x, y) => {
        if (!grayscaleData) return getPixel(x, y) * 255;
        if (x < 0 || x >= width || y < 0 || y >= height) return 0;
        return grayscaleData[y * width + x];
    };

    // 获取 2x2 格子配置 (0-15)
    // 格子 (cx, cy) 的四个角是像素 (cx,cy), (cx+1,cy), (cx,cy+1), (cx+1,cy+1)
    const getConfig = (cx, cy) => {
        const tl = getPixel(cx, cy);
        const tr = getPixel(cx + 1, cy);
        const bl = getPixel(cx, cy + 1);
        const br = getPixel(cx + 1, cy + 1);
        return (tl << 3) | (tr << 2) | (br << 1) | bl;
    };

    /**
     * VTracer 风格：亚像素线性插值
     * 根据相邻像素的灰度值计算精确边界位置
     *
     * 原理：假设边界在灰度值 = threshold (128) 处
     * 如果 p1 灰度 = 50, p2 灰度 = 200
     * 则边界位置 t = (128 - 50) / (200 - 50) = 0.52
     */
    const threshold = 128;

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

    // 线性插值：计算边界位置 (0-1)
    const interpolate = (v1, v2, target) => {
        // 避免除零
        if (Math.abs(v2 - v1) < 1) return 0.5;

        // 计算插值位置
        let t = (target - v1) / (v2 - v1);

        // 限制在合理范围内
        return Math.max(0.1, Math.min(0.9, t));
    };
    
    // Marching Squares 标准转移表
    // 每个配置定义了边界穿过的边
    // [进入边, 退出边, 下一个格子的dx, dy]
    // 边: 0=top, 1=right, 2=bottom, 3=left
    const edgeTable = {
        //  config: [[入边, 出边]]  - 描述边界线经过的边
        1:  [[3, 2]],           // BL only: left -> bottom
        2:  [[2, 1]],           // BR only: bottom -> right
        3:  [[3, 1]],           // BL+BR: left -> right
        4:  [[1, 0]],           // TR only: right -> top
        5:  [[1, 0], [3, 2]],   // TR+BL (saddle): right->top, left->bottom
        6:  [[2, 0]],           // TR+BR: bottom -> top
        7:  [[3, 0]],           // TR+BR+BL: left -> top
        8:  [[0, 3]],           // TL only: top -> left
        9:  [[0, 2]],           // TL+BL: top -> bottom
        10: [[0, 3], [2, 1]],   // TL+BR (saddle): top->left, bottom->right
        11: [[0, 1]],           // TL+BL+BR: top -> right
        12: [[1, 3]],           // TL+TR: right -> left
        13: [[1, 2]],           // TL+TR+BL: right -> bottom
        14: [[2, 3]],           // TL+TR+BR: bottom -> left
    };
    
    // 下一个格子的偏移 (根据退出边)
    const nextCell = {
        0: [0, -1],  // 从 top 退出 -> 上方格子
        1: [1, 0],   // 从 right 退出 -> 右方格子
        2: [0, 1],   // 从 bottom 退出 -> 下方格子
        3: [-1, 0],  // 从 left 退出 -> 左方格子
    };
    
    // 进入新格子后的入边 (退出边的对面)
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
            
            // 添加出边的点
            const pt = edgePoint(cx, cy, outEdge);
            points.push(pt);
            
            // 移动到下一个格子
            const [dx, dy] = nextCell[outEdge];
            cx += dx;
            cy += dy;
            inEdge = enterEdge[outEdge];
            
            // 获取新格子的配置
            const config = getConfig(cx, cy);
            if (config === 0 || config === 15) break;
            
            // 找匹配的转移 (入边 -> 出边)
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
    
    // 扫描所有格子 (从 -1 开始，因为格子可以跨越边界)
    for (let cy = -1; cy < height; cy++) {
        for (let cx = -1; cx < width; cx++) {
            const config = getConfig(cx, cy);
            if (config === 0 || config === 15) continue;
            
            const edges = edgeTable[config];
            if (!edges) continue;
            
            // 对每条边界线追踪
            for (const [inEdge, outEdge] of edges) {
                const edgeKey = `${cx},${cy},${outEdge}`;
                if (visitedEdges.has(edgeKey)) continue;
                
                const pts = traceContour(cx, cy, inEdge, outEdge);
                if (pts.length >= 3) {
                    // 闭合路径
                    pts.push({ ...pts[0] });
                    
                    const area = calculateArea(pts);
                    contours.push({
                        points: pts,
                        type: area >= 0 ? 'outer' : 'inner',
                        area: area
                    });
                }
            }
        }
    }
    
    // 按面积排序（大到小）
    contours.sort((a, b) => Math.abs(b.area) - Math.abs(a.area));
    
    return contours;
}
