/**
 * Potrace Core - 高质量位图转矢量算法 (VTracer 风格重构)
 * 
 * 算法参考:
 * - VTracer (visioncortex) - 核心算法框架
 * - Marching Squares - 亚像素精度轮廓追踪
 * - Connected Component Labeling - 连通区域分析
 * - Visvalingam-Whyatt - 路径简化
 * 
 * 核心流程:
 * 1. 颜色量化 (Median Cut)
 * 2. 连通区域标记 (CCL)
 * 3. Marching Squares 轮廓追踪
 * 4. 路径简化 (Visvalingam-Whyatt)
 * 5. 曲线拟合 (Schneider Algorithm)
 */

(function(global) {
    'use strict';
    
    // ============ CDN 依赖 ============
    const CDN_LIBS = {
        simplify: 'https://cdn.jsdelivr.net/npm/simplify-js@1.2.4/simplify.min.js',
        fitCurve: 'https://cdn.jsdelivr.net/npm/fit-curve@0.2.0/lib/fit-curve.js'
    };
    
    let libsLoaded = false;
    
    async function loadCdnLibs() {
        if (libsLoaded) return;
        const loadScript = (url) => new Promise((resolve, reject) => {
            if (document.querySelector(`script[src="${url}"]`)) { resolve(); return; }
            const script = document.createElement('script');
            script.src = url;
            script.onload = resolve;
            script.onerror = () => reject(new Error(`Failed: ${url}`));
            document.head.appendChild(script);
        });
        
        try {
            await Promise.all(Object.values(CDN_LIBS).map(loadScript));
            libsLoaded = true;
        } catch (e) {
            console.warn('[PotraceCore] CDN 加载失败，使用内置算法');
        }
    }

    // ============ 颜色量化 (Median Cut) ============
    
    function medianCutQuantize(imageData, maxColors = 16) {
        const data = imageData.data;
        const pixels = [];
        
        // 采样优化：大图片时采样以避免内存问题
        const totalPixels = data.length / 4;
        const sampleRate = totalPixels > 100000 ? Math.ceil(totalPixels / 100000) : 1;
        
        for (let i = 0; i < data.length; i += 4 * sampleRate) {
            if (data[i + 3] > 128) {
                pixels.push([data[i], data[i + 1], data[i + 2]]);
            }
        }
        
        if (pixels.length === 0) return [[128, 128, 128]];
        
        // 辅助函数：安全获取数组最大最小值（避免栈溢出）
        const getMinMax = (arr, channel) => {
            let min = 255, max = 0;
            for (let i = 0; i < arr.length; i++) {
                const v = arr[i][channel];
                if (v < min) min = v;
                if (v > max) max = v;
            }
            return { min, max, range: max - min };
        };
        
        const buckets = [pixels];
        
        while (buckets.length < maxColors) {
            let maxRange = 0, maxIdx = 0, splitCh = 0;
            
            for (let i = 0; i < buckets.length; i++) {
                const b = buckets[i];
                if (b.length < 2) continue;
                
                for (let c = 0; c < 3; c++) {
                    const { range } = getMinMax(b, c);
                    if (range > maxRange) {
                        maxRange = range;
                        maxIdx = i;
                        splitCh = c;
                    }
                }
            }
            
            if (maxRange === 0) break;
            
            const bucket = buckets[maxIdx];
            bucket.sort((a, b) => a[splitCh] - b[splitCh]);
            const mid = Math.floor(bucket.length / 2);
            buckets.splice(maxIdx, 1, bucket.slice(0, mid), bucket.slice(mid));
        }
        
        return buckets.filter(b => b.length > 0).map(bucket => {
            const sum = [0, 0, 0];
            for (const p of bucket) { sum[0] += p[0]; sum[1] += p[1]; sum[2] += p[2]; }
            return [Math.round(sum[0] / bucket.length), Math.round(sum[1] / bucket.length), Math.round(sum[2] / bucket.length)];
        }).sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
    }

    function colorDistSq(c1, c2) {
        const dr = c1[0] - c2[0], dg = c1[1] - c2[1], db = c1[2] - c2[2];
        return dr * dr + dg * dg + db * db;
    }
    
    function colorDistance(c1, c2) { return Math.sqrt(colorDistSq(c1, c2)); }

    // ============ 二值化 ============
    
    /**
     * 计算自适应亮度阈值 (Otsu's method 简化版)
     */
    function computeOtsuThreshold(imageData) {
        const data = imageData.data;
        const histogram = new Array(256).fill(0);
        let total = 0;
        
        // 构建亮度直方图
        for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] > 128) {
                const lum = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
                histogram[lum]++;
                total++;
            }
        }
        
        if (total === 0) return 128;
        
        let sum = 0;
        for (let i = 0; i < 256; i++) sum += i * histogram[i];
        
        let sumB = 0, wB = 0, wF = 0;
        let maxVariance = 0, threshold = 128;
        
        for (let t = 0; t < 256; t++) {
            wB += histogram[t];
            if (wB === 0) continue;
            wF = total - wB;
            if (wF === 0) break;
            
            sumB += t * histogram[t];
            const mB = sumB / wB;
            const mF = (sum - sumB) / wF;
            const variance = wB * wF * (mB - mF) * (mB - mF);
            
            if (variance > maxVariance) {
                maxVariance = variance;
                threshold = t;
            }
        }
        
        return threshold;
    }
    
    /**
     * 创建二值位图
     * @param {ImageData} imageData 
     * @param {Array} targetColor - 目标颜色 [r, g, b]
     * @param {number} tolerance - 颜色容差
     * @param {boolean} useLuminance - 使用亮度模式 (用于 lineart)
     * @param {number} threshold - 亮度阈值 (自动计算时传入)
     */
    function createBinaryBitmap(imageData, targetColor, tolerance = 30, useLuminance = false, threshold = null) {
        const { width, height, data } = imageData;
        const bitmap = new Uint8Array(width * height);
        const tolSq = tolerance * tolerance;
        
        // 使用传入的阈值或默认阈值
        const lumThreshold = threshold !== null ? threshold : 128;
        
        let darkCount = 0, totalCount = 0;
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = (y * width + x) * 4;
                if (data[i + 3] > 128) {
                    totalCount++;
                    if (useLuminance) {
                        // 亮度模式：按亮度阈值分类
                        const lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
                        const isDark = lum < lumThreshold;
                        bitmap[y * width + x] = isDark ? 1 : 0;
                        if (isDark) darkCount++;
                    } else {
                        // 颜色模式：按颜色距离分类
                        const distSq = colorDistSq([data[i], data[i + 1], data[i + 2]], targetColor);
                        bitmap[y * width + x] = distSq < tolSq ? 1 : 0;
                    }
                }
            }
        }
        
        // 自动检测：如果暗色像素超过 50%，说明背景是暗色，需要反转
        let inverted = false;
        if (useLuminance && darkCount > totalCount * 0.5) {
            console.log(`[PotraceCore] 检测到暗色背景 (${darkCount}/${totalCount})，反转二值图`);
            for (let i = 0; i < bitmap.length; i++) {
                bitmap[i] = bitmap[i] === 1 ? 0 : (data[i * 4 + 3] > 128 ? 1 : 0);
            }
            inverted = true;
        }
        
        return { data: bitmap, width, height, inverted };
    }

    // ============ 连通区域标记 (Two-Pass CCL) ============
    
    function labelConnectedComponents(bitmap) {
        const { data, width, height } = bitmap;
        const labels = new Int32Array(width * height);
        const parent = [0];
        let nextLabel = 1;
        
        const find = (i) => {
            while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
            return i;
        };
        
        const union = (i, j) => {
            const ri = find(i), rj = find(j);
            if (ri !== rj) parent[Math.max(ri, rj)] = Math.min(ri, rj);
        };
        
        // First pass
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                if (data[idx] === 0) continue;
                
                const neighbors = [];
                if (x > 0 && data[idx - 1] === 1) neighbors.push(labels[idx - 1]);
                if (y > 0 && data[idx - width] === 1) neighbors.push(labels[idx - width]);
                
                if (neighbors.length === 0) {
                    labels[idx] = nextLabel;
                    parent.push(nextLabel);
                    nextLabel++;
                } else {
                    const minN = Math.min(...neighbors.map(n => find(n)));
                    labels[idx] = minN;
                    for (const n of neighbors) union(n, minN);
                }
            }
        }
        
        // Second pass
        const labelMap = new Map();
        let finalLabel = 0;
        
        for (let i = 0; i < labels.length; i++) {
            if (data[i] === 0) continue;
            const root = find(labels[i]);
            if (!labelMap.has(root)) labelMap.set(root, ++finalLabel);
            labels[i] = labelMap.get(root);
        }
        
        const regions = Array.from({ length: finalLabel + 1 }, () => []);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const l = labels[y * width + x];
                if (l > 0) regions[l].push({ x, y });
            }
        }
        
        return { labels, numRegions: finalLabel, regions, width, height };
    }

    // ============ Marching Squares 轮廓追踪 ============
    
    /**
     * Marching Squares - 亚像素精度轮廓追踪
     * 
     * 格子配置 (2x2):
     *   TL(8) -- TR(4)
     *     |       |
     *   BL(1) -- BR(2)
     * 
     * 边定义: 0=top, 1=right, 2=bottom, 3=left
     */
    function marchingSquaresContour(bitmap, ccResult = null, regionLabel = null) {
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
        
        // 获取 2x2 格子配置 (0-15)
        // 格子 (cx, cy) 的四个角是像素 (cx,cy), (cx+1,cy), (cx,cy+1), (cx+1,cy+1)
        const getConfig = (cx, cy) => {
            const tl = getPixel(cx, cy);
            const tr = getPixel(cx + 1, cy);
            const bl = getPixel(cx, cy + 1);
            const br = getPixel(cx + 1, cy + 1);
            return (tl << 3) | (tr << 2) | (br << 1) | bl;
        };
        
        // 边缘点坐标 (亚像素)
        const edgePoint = (cx, cy, edge) => {
            switch (edge) {
                case 0: return { x: cx + 0.5, y: cy };       // top edge
                case 1: return { x: cx + 1, y: cy + 0.5 };   // right edge
                case 2: return { x: cx + 0.5, y: cy + 1 };   // bottom edge
                case 3: return { x: cx, y: cy + 0.5 };       // left edge
            }
            return { x: cx + 0.5, y: cy + 0.5 };
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
    
    // 计算轮廓面积 (Shoelace formula)
    function calculateArea(points) {
        let area = 0;
        const n = points.length;
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            area += points[i].x * points[j].y;
            area -= points[j].x * points[i].y;
        }
        return area / 2;
    }
    
    // ============ 路径简化 (Visvalingam-Whyatt) ============
    
    /**
     * Visvalingam-Whyatt 算法 - 保持拓扑的简化
     * 比 Douglas-Peucker 效果更好
     */
    function visvalingamWhyatt(points, threshold = 1.0) {
        if (points.length <= 3) return points;
        
        // 计算三角形面积
        const triangleArea = (a, b, c) => {
            return Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
        };
        
        // 创建双向链表
        const nodes = points.map((p, i) => ({
            point: p,
            prev: i - 1,
            next: i + 1,
            area: 0,
            removed: false
        }));
        
        // 处理首尾
        nodes[0].prev = points.length - 1;
        nodes[nodes.length - 1].next = 0;
        
        // 计算初始面积
        const updateArea = (i) => {
            const node = nodes[i];
            if (node.removed) return;
            const prev = nodes[node.prev];
            const next = nodes[node.next];
            node.area = triangleArea(prev.point, node.point, next.point);
        };
        
        for (let i = 0; i < nodes.length; i++) {
            updateArea(i);
        }
        
        // 迭代移除最小面积点
        let remaining = nodes.length;
        const minArea = threshold * threshold;
        
        while (remaining > 3) {
            // 找最小面积
            let minIdx = -1;
            let minVal = Infinity;
            
            for (let i = 0; i < nodes.length; i++) {
                if (!nodes[i].removed && nodes[i].area < minVal) {
                    minVal = nodes[i].area;
                    minIdx = i;
                }
            }
            
            if (minIdx < 0 || minVal > minArea) break;
            
            // 移除该点
            const node = nodes[minIdx];
            node.removed = true;
            remaining--;
            
            // 更新邻居
            const prev = nodes[node.prev];
            const next = nodes[node.next];
            prev.next = node.next;
            next.prev = node.prev;
            
            updateArea(node.prev);
            updateArea(node.next);
        }
        
        // 收集结果
        return nodes.filter(n => !n.removed).map(n => n.point);
    }
    
    /**
     * Douglas-Peucker 简化 (备用)
     */
    function douglasPeucker(points, tolerance) {
        if (points.length < 3) return points;
        
        const first = points[0];
        const last = points[points.length - 1];
        
        let maxDist = 0, maxIdx = 0;
        for (let i = 1; i < points.length - 1; i++) {
            const dist = pointLineDistance(points[i], first, last);
            if (dist > maxDist) { maxDist = dist; maxIdx = i; }
        }
        
        if (maxDist > tolerance) {
            const left = douglasPeucker(points.slice(0, maxIdx + 1), tolerance);
            const right = douglasPeucker(points.slice(maxIdx), tolerance);
            return left.slice(0, -1).concat(right);
        }
        
        return [first, last];
    }
    
    function pointLineDistance(point, lineStart, lineEnd) {
        const dx = lineEnd.x - lineStart.x;
        const dy = lineEnd.y - lineStart.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len === 0) return Math.sqrt((point.x - lineStart.x) ** 2 + (point.y - lineStart.y) ** 2);
        return Math.abs(dy * point.x - dx * point.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x) / len;
    }
    
    /**
     * 综合路径简化
     */
    function simplifyPath(points, options = {}) {
        const { tolerance = 1.0, highQuality = true } = typeof options === 'number' ? { tolerance: options } : options;
        if (points.length < 3) return points;
        
        // 优先使用 simplify-js CDN
        if (typeof window.simplify === 'function') {
            return window.simplify(points, tolerance, highQuality);
        }
        
        // 回退到 Visvalingam-Whyatt
        return visvalingamWhyatt(points, tolerance);
    }

    // ============ 角点检测 ============

    /**
     * 检测路径上的角点（尖角）
     * @param {Array} points - 点数组
     * @param {number} angleThreshold - 角度阈值（度），小于此角度视为角点
     * @returns {Array} 角点索引数组
     */
    function detectCorners(points, angleThreshold = 60) {
        if (points.length < 3) return [];

        const corners = [];
        const n = points.length;
        const threshold = angleThreshold * Math.PI / 180;

        for (let i = 0; i < n; i++) {
            const prev = points[(i - 1 + n) % n];
            const curr = points[i];
            const next = points[(i + 1) % n];

            // 计算两个向量
            const v1x = curr.x - prev.x;
            const v1y = curr.y - prev.y;
            const v2x = next.x - curr.x;
            const v2y = next.y - curr.y;

            // 计算向量长度
            const len1 = Math.sqrt(v1x * v1x + v1y * v1y);
            const len2 = Math.sqrt(v2x * v2x + v2y * v2y);

            if (len1 < 0.5 || len2 < 0.5) continue;

            // 计算夹角（使用点积）
            const dot = v1x * v2x + v1y * v2y;
            const cosAngle = dot / (len1 * len2);
            const angle = Math.acos(Math.max(-1, Math.min(1, cosAngle)));

            // 如果角度小于阈值，认为是角点
            if (angle < threshold) {
                corners.push(i);
            }
        }

        return corners;
    }

    /**
     * 按角点分段拟合曲线
     * @param {Array} points - 点数组（闭合路径）
     * @param {number} maxError - 曲线拟合误差
     * @param {number} cornerAngle - 角点检测阈值
     */
    function fitBezierWithCorners(points, maxError = 2.5, cornerAngle = 60) {
        if (!points || points.length < 3) return '';

        const closed = points.length > 2 &&
            Math.abs(points[0].x - points[points.length - 1].x) < 0.5 &&
            Math.abs(points[0].y - points[points.length - 1].y) < 0.5;

        const pts = closed ? points.slice(0, -1) : points;
        const n = pts.length;
        if (n < 3) return generatePolygonPath(points);

        // 检测角点
        const corners = detectCorners(pts, cornerAngle);

        // 如果没有角点，使用普通拟合
        if (corners.length === 0) {
            return fitBezierSimple(pts, maxError, closed);
        }

        // 按角点分段
        const segments = [];
        corners.sort((a, b) => a - b);

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
    function fitSegmentBezier(points, maxError) {
        if (points.length < 2) return '';
        if (points.length === 2) {
            return `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}L${points[1].x.toFixed(1)},${points[1].y.toFixed(1)}`;
        }

        const pts = points.map(p => [p.x, p.y]);

        // 使用 fit-curve
        if (typeof window.fitCurve === 'function') {
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
    function fitBezierSimple(points, maxError, closed = true) {
        const pts = points.map(p => [p.x, p.y]);

        if (typeof window.fitCurve === 'function') {
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

    // ============ 曲线拟合 ============

    /**
     * 贝塞尔曲线拟合（带角点检测）
     */
    function fitBezier(points, maxError = 2.5, cornerAngle = 60) {
        if (!points || points.length < 2) return '';
        if (points.length === 2) {
            return `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}L${points[1].x.toFixed(1)},${points[1].y.toFixed(1)}Z`;
        }

        // 使用带角点检测的拟合
        return fitBezierWithCorners(points, maxError, cornerAngle);
    }

    function fitBezierCatmullRom(points, tension = 0.3) {
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
    
    function generatePolygonPath(points) {
        if (points.length < 2) return '';
        let path = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
        for (let i = 1; i < points.length; i++) {
            path += `L${points[i].x.toFixed(1)},${points[i].y.toFixed(1)}`;
        }
        return path + 'Z';
    }
    
    /**
     * 反转 SVG 路径方向（用于孔洞）
     */
    function reversePath(pathD) {
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

    // ============ 主矢量化函数 ============
    
    async function vectorize(imageData, options = {}) {
        await loadCdnLibs();
        
        const {
            numColors = 16,
            colorTolerance = 25,
            pathTolerance = 1.0,
            smoothness = 2.5,
            minPathLength = 16,
            mode = 'spline',
            binaryMode = false  // lineart 使用二值模式
        } = options;
        
        const { width, height } = imageData;
        
        console.log(`[PotraceCore] 矢量化: ${numColors}色, tol=${pathTolerance}, smooth=${smoothness}, binary=${binaryMode}`);
        
        // 1. 颜色量化 (lineart 使用亮度二值化)
        let palette;
        let otsuThreshold = null;
        
        if (binaryMode || numColors <= 2) {
            // 二值模式：计算 Otsu 阈值，只提取前景色
            otsuThreshold = computeOtsuThreshold(imageData);
            console.log(`[PotraceCore] Otsu 阈值: ${otsuThreshold}`);
            // 只生成前景（暗色）层，背景不需要矢量化
            palette = [[0, 0, 0]];
        } else {
            palette = medianCutQuantize(imageData, numColors);
        }
        console.log(`[PotraceCore] 提取 ${palette.length} 种主色`);
        
        const layers = [];
        
        // 2. 每种颜色生成矢量层
        for (const color of palette) {
            // 二值化 (二值模式使用亮度 + Otsu 阈值)
            const useLuminance = binaryMode || numColors <= 2;
            const bitmap = createBinaryBitmap(imageData, color, colorTolerance, useLuminance, otsuThreshold);
            
            // 如果反转了，计算前景的实际颜色
            let actualColor = color;
            if (bitmap.inverted && useLuminance) {
                // 计算亮色区域的平均颜色
                const sum = [0, 0, 0];
                let count = 0;
                const data = imageData.data;
                for (let i = 0; i < bitmap.data.length; i++) {
                    if (bitmap.data[i] === 1) {
                        const idx = i * 4;
                        sum[0] += data[idx];
                        sum[1] += data[idx + 1];
                        sum[2] += data[idx + 2];
                        count++;
                    }
                }
                if (count > 0) {
                    actualColor = [
                        Math.round(sum[0] / count),
                        Math.round(sum[1] / count),
                        Math.round(sum[2] / count)
                    ];
                }
            }
            
            const colorStr = `rgb(${actualColor[0]},${actualColor[1]},${actualColor[2]})`;
            
            // 统计二值化结果
            let fgCount = 0;
            for (let i = 0; i < bitmap.data.length; i++) {
                if (bitmap.data[i] === 1) fgCount++;
            }
            
            if (fgCount < minPathLength) continue;
            
            // 直接对整个二值图追踪所有轮廓（包括孔洞）
            const contours = marchingSquaresContour(bitmap, null, null);
            
            // 所有轮廓合并为一个复合路径（evenodd 规则会自动处理孔洞）
            const pathParts = [];
            
            for (const contour of contours) {
                if (contour.points.length < 4) continue;
                if (Math.abs(contour.area) < minPathLength) continue;

                // DEBUG: 输出原始轮廓点数
                const originalCount = contour.points.length;

                // 简化路径
                const simplified = simplifyPath(contour.points, { tolerance: pathTolerance * 0.5 });
                if (simplified.length < 3) continue;

                // DEBUG: 检查简化后的点数
                console.log(`[PotraceCore] 轮廓简化: ${originalCount} -> ${simplified.length} 点 (保留 ${(simplified.length/originalCount*100).toFixed(1)}%)`);

                // 曲线拟合
                const pathD = mode === 'spline'
                    ? fitBezier(simplified, smoothness)
                    : generatePolygonPath(simplified);

                if (pathD) {
                    pathParts.push(pathD);
                }
            }
            
            const paths = [];
            if (pathParts.length > 0) {
                // 合并所有轮廓为复合路径
                const combinedD = pathParts.join(' ');
                paths.push({
                    d: combinedD,
                    fill: colorStr,
                    fillRule: 'evenodd',
                    stroke: 'none',
                    strokeWidth: 0
                });
            }
            
            if (paths.length > 0) {
                layers.push({ color: colorStr, colorRgb: actualColor, paths });
            }
        }
        
        console.log(`[PotraceCore] 生成 ${layers.length} 个颜色层`);
        
        // 3. 生成 SVG
        const allPaths = layers.flatMap(l => l.paths);
        const svgContent = allPaths.map(p => {
            const fillRule = p.fillRule ? ` fill-rule="${p.fillRule}"` : '';
            return `<path d="${p.d}" fill="${p.fill}"${fillRule} stroke="${p.stroke}" stroke-width="${p.strokeWidth}"/>`;
        }).join('\n');
        
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n${svgContent}\n</svg>`;
        
        return {
            svg,
            width,
            height,
            layers,
            paths: allPaths,
            colors: palette.map(c => `rgb(${c[0]},${c[1]},${c[2]})`),
            engine: 'potrace-core-v2'
        };
    }

    // ============ 预设 ============
    
    const PRESETS = {
        logo: {
            numColors: 16,
            colorTolerance: 20,
            pathTolerance: 0.5,
            smoothness: 2.0,
            minPathLength: 16,
            mode: 'spline'
        },
        illustration: {
            numColors: 32,
            colorTolerance: 25,
            pathTolerance: 0.8,
            smoothness: 2.5,
            minPathLength: 16,
            mode: 'spline'
        },
        lineart: {
            numColors: 2,
            colorTolerance: 60,
            pathTolerance: 0.1,   // 更小以保持细节
            smoothness: 0.3,      // 更小的误差容忍
            minPathLength: 4,     // 保留小孔洞
            mode: 'spline',       // 改成 'polygon' 测试原始轮廓
            binaryMode: true
        },
        photo: {
            numColors: 64,
            colorTolerance: 35,
            pathTolerance: 1.5,
            smoothness: 3.5,
            minPathLength: 64,
            mode: 'spline'
        },
        simple: {
            numColors: 8,
            colorTolerance: 40,
            pathTolerance: 2.0,
            smoothness: 4.0,
            minPathLength: 32,
            mode: 'polygon'
        }
    };
    
    function vectorizeWithPreset(imageData, presetName = 'logo') {
        const preset = PRESETS[presetName] || PRESETS.logo;
        return vectorize(imageData, preset);
    }

    // ============ 导出 ============
    
    const PotraceCore = {
        vectorize,
        vectorizeWithPreset,
        medianCutQuantize,
        labelConnectedComponents,
        marchingSquaresContour,
        simplifyPath,
        fitBezier,
        PRESETS
    };
    
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = PotraceCore;
    }
    
    global.PotraceCore = PotraceCore;
    
})(typeof window !== 'undefined' ? window : this);
