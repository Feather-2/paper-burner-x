/**
 * Potrace Core - 兼容层
 * 
 * 实际实现已移至 vectorizer/ 目录
 * 此文件仅作为向后兼容使用
 * 
 * @see ./vectorizer/index.js
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

    // ============ 工具函数 ============
    
    function colorDistSq(c1, c2) {
        const dr = c1[0] - c2[0], dg = c1[1] - c2[1], db = c1[2] - c2[2];
        return dr * dr + dg * dg + db * db;
    }

    function colorDistance(c1, c2) { return Math.sqrt(colorDistSq(c1, c2)); }

    function signedArea(p1, p2, p3) {
        return (p2.x - p1.x) * (p3.y - p1.y) - (p3.x - p1.x) * (p2.y - p1.y);
    }

    function polygonArea(points) {
        let area = 0;
        const n = points.length;
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            area += points[i].x * points[j].y;
            area -= points[j].x * points[i].y;
        }
        return area / 2;
    }

    function pointLineDistance(point, lineStart, lineEnd) {
        const dx = lineEnd.x - lineStart.x;
        const dy = lineEnd.y - lineStart.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len === 0) return Math.sqrt((point.x - lineStart.x) ** 2 + (point.y - lineStart.y) ** 2);
        return Math.abs(dy * point.x - dx * point.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x) / len;
    }

    // ============ 颜色量化 (Median Cut) ============

    function medianCutQuantize(imageData, maxColors = 16) {
        const data = imageData.data;
        const pixels = [];

        const totalPixels = data.length / 4;
        const sampleRate = totalPixels > 100000 ? Math.ceil(totalPixels / 100000) : 1;

        for (let i = 0; i < data.length; i += 4 * sampleRate) {
            if (data[i + 3] > 128) {
                pixels.push([data[i], data[i + 1], data[i + 2]]);
            }
        }

        if (pixels.length === 0) return [[128, 128, 128]];

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
     * 高斯模糊预处理 (VTracer 风格)
     * 减少锯齿，平滑边缘过渡
     */
    function gaussianBlur(grayscale, width, height, sigma = 1.0) {
        if (sigma <= 0) return grayscale;

        // 生成高斯核
        const radius = Math.ceil(sigma * 3);
        const kernelSize = radius * 2 + 1;
        const kernel = new Float32Array(kernelSize);
        let kernelSum = 0;

        for (let i = 0; i < kernelSize; i++) {
            const x = i - radius;
            kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
            kernelSum += kernel[i];
        }

        // 归一化
        for (let i = 0; i < kernelSize; i++) {
            kernel[i] /= kernelSum;
        }

        // 水平方向模糊
        const temp = new Float32Array(width * height);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let sum = 0;
                for (let k = -radius; k <= radius; k++) {
                    const sx = Math.max(0, Math.min(width - 1, x + k));
                    sum += grayscale[y * width + sx] * kernel[k + radius];
                }
                temp[y * width + x] = sum;
            }
        }

        // 垂直方向模糊
        const result = new Float32Array(width * height);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let sum = 0;
                for (let k = -radius; k <= radius; k++) {
                    const sy = Math.max(0, Math.min(height - 1, y + k));
                    sum += temp[sy * width + x] * kernel[k + radius];
                }
                result[y * width + x] = sum;
            }
        }

        return result;
    }

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
     * @param {number} blurSigma - 高斯模糊 sigma (0 = 不模糊)
     */
    function createBinaryBitmap(imageData, targetColor, tolerance = 30, useLuminance = false, threshold = null, blurSigma = 0) {
        const { width, height, data } = imageData;
        const bitmap = new Uint8Array(width * height);

        // 使用传入的阈值或默认阈值
        const lumThreshold = threshold !== null ? threshold : 128;

        // 生成灰度图
        let grayscale = new Float32Array(width * height);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = (y * width + x) * 4;
                if (data[i + 3] > 128) {
                    if (useLuminance) {
                        // 亮度模式
                        grayscale[y * width + x] = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
                    } else {
                        // 颜色模式：使用颜色距离作为灰度
                        const distSq = colorDistSq([data[i], data[i + 1], data[i + 2]], targetColor);
                        // 将距离映射到 0-255（距离越小越接近目标色 = 越黑）
                        grayscale[y * width + x] = Math.min(255, Math.sqrt(distSq) * 255 / tolerance);
                    }
                } else {
                    grayscale[y * width + x] = 255; // 透明像素视为白色
                }
            }
        }

        // 应用高斯模糊（VTracer 风格预处理）
        if (blurSigma > 0) {
            grayscale = gaussianBlur(grayscale, width, height, blurSigma);
        }

        // 二值化
        let darkCount = 0, totalCount = 0;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = (y * width + x) * 4;
                if (data[i + 3] > 128) {
                    totalCount++;
                    const lum = grayscale[y * width + x];
                    const isDark = lum < lumThreshold;
                    bitmap[y * width + x] = isDark ? 1 : 0;
                    if (isDark) darkCount++;
                }
            }
        }

        // 自动检测：如果暗色像素超过 50%，说明背景是暗色，需要反转
        let inverted = false;
        if (useLuminance && darkCount > totalCount * 0.5) {
            console.log(`[PotraceCore] 检测到暗色背景 (${darkCount}/${totalCount})，反转二值图`);
            for (let i = 0; i < bitmap.length; i++) {
                const idx = i * 4;
                if (data[idx + 3] > 128) {
                    bitmap[i] = bitmap[i] === 1 ? 0 : 1;
                    // 同时反转灰度值
                    grayscale[i] = 255 - grayscale[i];
                }
            }
            inverted = true;
        }

        return { data: bitmap, width, height, inverted, grayscale };
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
     *
     * VTracer 风格改进：使用灰度值线性插值计算精确边界位置
     */
    function marchingSquaresContour(bitmap, ccResult = null, regionLabel = null, grayscaleData = null) {
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

    // ============ 路径平滑 ============

    /**
     * Chaikin 角切割平滑算法
     * 每次迭代将角切掉，使曲线更平滑
     */
    function chaikinSmooth(points, iterations = 2) {
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
    function movingAverageSmooth(points, windowSize = 3) {
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

    // ============ 角点检测 (VTracer 风格) ============

    /**
     * 计算点的局部曲率（使用更大的邻域）
     * VTracer 风格：考虑更大范围的点来判断角点
     */
    function computeCurvature(points, index, radius = 3) {
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
     * VTracer 风格角点检测
     * 1. 使用更大的邻域计算曲率
     * 2. 非极大值抑制
     * 3. 角度阈值过滤
     */
    function detectCornersVTracer(points, angleThreshold = 90, minDistance = 5) {
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
     * VTracer 风格：只平滑非角点区域
     * 保护角点，只平滑曲线部分
     */
    function smoothPathPreservingCorners(points, corners, windowSize = 3) {
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

    /**
     * VTracer 风格完整处理流程
     * 关键改进：多次迭代平滑，使用标记而非索引跟踪角点
     */
    function processContourVTracer(points, options = {}) {
        const {
            cornerAngle = 75,      // 角点阈值（度）
            smoothWindow = 5,      // 平滑窗口（增大）
            minCornerDist = 5,     // 角点最小距离
            smoothIterations = 2   // Chaikin 迭代次数
        } = options;

        if (points.length < 4) return { points, corners: [] };

        // 1. 先做初步平滑（在角点检测前）
        let smoothed = points.slice();
        for (let i = 0; i < 2; i++) {
            smoothed = movingAverageSmooth(smoothed, 3);
        }

        // 2. 检测角点（在初步平滑后的轮廓上）
        const cornerIndices = detectCornersVTracer(smoothed, cornerAngle, minCornerDist);

        // 3. 给点添加角点标记
        let taggedPoints = smoothed.map((p, i) => ({
            x: p.x,
            y: p.y,
            isCorner: cornerIndices.includes(i)
        }));

        // 4. 多次迭代 Chaikin 平滑（使用标记保护角点）
        for (let i = 0; i < smoothIterations; i++) {
            taggedPoints = chaikinSmoothTagged(taggedPoints);
        }

        // 5. 最后多次移动平均平滑（保护角点）
        for (let i = 0; i < 3; i++) {
            taggedPoints = movingAverageSmoothTagged(taggedPoints, smoothWindow);
        }

        // 6. 提取结果
        const finalPoints = taggedPoints.map(p => ({ x: p.x, y: p.y }));
        const finalCorners = taggedPoints
            .map((p, i) => p.isCorner ? i : -1)
            .filter(i => i >= 0);

        return { points: finalPoints, corners: finalCorners };
    }

    /**
     * Chaikin 平滑（带标记版本）
     */
    function chaikinSmoothTagged(points) {
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
    function movingAverageSmoothTagged(points, windowSize = 5) {
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
     * VTracer 风格曲线拟合（使用预检测的角点）
     * @param {Array} points - 简化后的点数组
     * @param {number} maxError - 曲线拟合误差
     * @param {Array} originalCorners - 原始轮廓中的角点索引
     * @param {number} originalCount - 原始轮廓点数
     */
    function fitBezierWithCornersVTracer(points, maxError, originalCorners, originalCount) {
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
    function fitBezierWithCorners(points, maxError = 2.5, cornerAngle = 60) {
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

    /**
     * 平滑曲线拟合（用于已经充分平滑的点）
     * 使用更精确的拟合，因为输入点已经很平滑
     */
    function fitBezierSmooth(points, maxError = 1.0) {
        if (!points || points.length < 3) return '';

        const closed = points.length > 2 &&
            Math.abs(points[0].x - points[points.length - 1].x) < 1 &&
            Math.abs(points[0].y - points[points.length - 1].y) < 1;

        const pts = closed ? points.slice(0, -1) : points;
        if (pts.length < 3) return generatePolygonPath(points);

        // 优先使用 fit-curve（更精确）
        if (typeof window.fitCurve === 'function') {
            try {
                const inputPts = pts.map(p => [p.x, p.y]);
                // 使用很小的误差阈值以保持平滑度
                const curves = window.fitCurve(inputPts, Math.max(0.1, maxError * 0.5));
                if (curves && curves.length > 0) {
                    let path = `M${curves[0][0][0].toFixed(2)},${curves[0][0][1].toFixed(2)}`;
                    for (const c of curves) {
                        path += `C${c[1][0].toFixed(2)},${c[1][1].toFixed(2)},${c[2][0].toFixed(2)},${c[2][1].toFixed(2)},${c[3][0].toFixed(2)},${c[3][1].toFixed(2)}`;
                    }
                    return path + (closed ? 'Z' : '');
                }
            } catch (e) {
                console.warn('[PotraceCore] fit-curve failed, using Catmull-Rom');
            }
        }

        // 回退到 Catmull-Rom（也能产生平滑曲线）
        return fitBezierCatmullRom(pts, 0.4);
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
            binaryMode = false,  // lineart 使用二值模式
            blurSigma = 0.8      // VTracer 风格高斯模糊 (0 = 关闭)
        } = options;

        const { width, height } = imageData;

        console.log(`[PotraceCore] 矢量化: ${numColors}色, tol=${pathTolerance}, smooth=${smoothness}, binary=${binaryMode}, blur=${blurSigma}`);

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
            // 二值化 (二值模式使用亮度 + Otsu 阈值 + 高斯模糊)
            const useLuminance = binaryMode || numColors <= 2;
            const bitmap = createBinaryBitmap(imageData, color, colorTolerance, useLuminance, otsuThreshold, blurSigma);
            
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
            // 传入灰度数据用于 VTracer 风格亚像素插值
            const contours = marchingSquaresContour(bitmap, null, null, bitmap.grayscale);

            // 所有轮廓合并为一个复合路径（evenodd 规则会自动处理孔洞）
            const pathParts = [];

            for (const contour of contours) {
                if (contour.points.length < 4) continue;
                if (Math.abs(contour.area) < minPathLength) continue;

                const originalCount = contour.points.length;

                // VTracer 参数 - 调整角点检测，只检测真正的直角
                const vtracerOptions = {
                    cornerAngle: 45,           // 降低！只检测 < 45度 的尖角
                    smoothWindow: 7,           // 增大窗口
                    minCornerDist: Math.max(5, Math.floor(originalCount / 30)),
                    smoothIterations: 4        // 增加迭代次数
                };

                // 1. VTracer 风格处理：多次平滑 + 角点保护
                const processed = processContourVTracer(contour.points, vtracerOptions);

                // 2. 对平滑后的点进行采样（而非简化）
                // 平滑后点数很多但已经很平滑，简化会破坏曲线质量
                // 改用均匀采样保持曲线形状
                let finalPoints = processed.points;

                // 只有点数非常多时才采样，保留足够多的点
                const targetPoints = Math.max(200, Math.min(800, Math.floor(finalPoints.length / 4)));
                if (finalPoints.length > targetPoints * 1.5) {
                    // 均匀采样而非简化，保持曲线平滑度
                    const step = finalPoints.length / targetPoints;
                    const sampled = [];
                    for (let i = 0; i < targetPoints; i++) {
                        sampled.push(finalPoints[Math.floor(i * step)]);
                    }
                    finalPoints = sampled;
                }

                if (finalPoints.length < 3) continue;

                console.log(`[PotraceCore] VTracer: ${originalCount} -> 平滑 ${processed.points.length} -> 最终 ${finalPoints.length} 点`);

                // 3. 曲线拟合
                // 由于已经充分平滑，使用更小的拟合误差
                const fitError = Math.min(smoothness, 1.0);
                const pathD = mode === 'spline'
                    ? fitBezierSmooth(finalPoints, fitError)
                    : generatePolygonPath(finalPoints);

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
            pathTolerance: 0.3,
            smoothness: 0.8,       // 更小的拟合误差
            minPathLength: 16,
            mode: 'spline',
            blurSigma: 1.0         // 增强模糊
        },
        illustration: {
            numColors: 32,
            colorTolerance: 25,
            pathTolerance: 0.5,
            smoothness: 1.0,
            minPathLength: 16,
            mode: 'spline',
            blurSigma: 1.0
        },
        lineart: {
            numColors: 2,
            colorTolerance: 60,
            pathTolerance: 0.2,    // 非常低，保留细节
            smoothness: 0.5,       // 非常精确的曲线拟合
            minPathLength: 16,
            mode: 'spline',
            binaryMode: true,
            blurSigma: 1.5         // 更强模糊，消除锯齿
        },
        photo: {
            numColors: 64,
            colorTolerance: 35,
            pathTolerance: 1.0,
            smoothness: 2.0,
            minPathLength: 64,
            mode: 'spline',
            blurSigma: 1.5
        },
        simple: {
            numColors: 8,
            colorTolerance: 40,
            pathTolerance: 2.0,
            smoothness: 4.0,
            minPathLength: 32,
            mode: 'polygon',
            blurSigma: 0
        }
    };
    
    function vectorizeWithPreset(imageData, presetName = 'logo') {
        const preset = PRESETS[presetName] || PRESETS.logo;
        return vectorize(imageData, preset);
    }

    // ============ 导出 ============
    
    /**
     * PotraceCore - 兼容层
     * 
     * 推荐使用新的 ES Module 版本:
     * import { Vectorizer } from './vectorizer/index.js';
     * 
     * 新版本包含:
     * - VTracer 4-Point Subdivision Scheme 平滑算法
     * - Splice Point Detection 曲线分段
     * - remove_staircase 锯齿移除
     * - retract_handles 控制点修正
     */
    const PotraceCore = {
        vectorize,
        vectorizeWithPreset,
        medianCutQuantize,
        labelConnectedComponents,
        marchingSquaresContour,
        simplifyPath,
        fitBezier,
        PRESETS,
        
        // VTracer 新增函数
        processContourVTracer,
        detectCornersVTracer,
        smoothPathPreservingCorners,
        fitBezierWithCorners,
        fitBezierSmooth
    };
    
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = PotraceCore;
    }
    
    global.PotraceCore = PotraceCore;
    
})(typeof window !== 'undefined' ? window : this);
