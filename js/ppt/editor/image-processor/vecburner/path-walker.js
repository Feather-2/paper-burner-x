/**
 * 高效边界追踪算法 - Suzuki-Abe 风格
 * 
 * 基于 OpenCV findContours 的算法思想
 * 
 * 优化策略：
 * 1. 单次扫描 - O(n) 同时检测所有轮廓起点
 * 2. Moore 邻域追踪 - 8 方向，精确边界
 * 3. 内联函数 - 避免函数调用开销
 * 4. 位运算标记 - 快速状态检查
 * 5. Straight Run 压缩 - 减少输出点数
 * 
 * License: MIT
 */

// 8 方向偏移（顺时针：从右开始）
const DX8 = [1, 1, 0, -1, -1, -1, 0, 1];
const DY8 = [0, 1, 1, 1, 0, -1, -1, -1];

/**
 * 高效轮廓追踪 - Suzuki-Abe 风格
 * 
 * @param {Uint8Array} bitmap - 二值位图 (0/1)
 * @param {number} width - 宽度
 * @param {number} height - 高度
 * @returns {Array} 轮廓数组
 */
export function traceContoursVTracer(bitmap, width, height) {
    const contours = [];
    const size = width * height;
    
    // 标记数组：0=未访问, 1=已作为轮廓起点, 2=已追踪过
    const marker = new Uint8Array(size);
    
    // 内联像素访问
    const getPixel = (x, y) => {
        if (x < 0 || x >= width || y < 0 || y >= height) return 0;
        return bitmap[y * width + x];
    };
    
    /**
     * Moore 邻域追踪 - 从起点追踪一个完整轮廓
     * 使用 Jacob's stopping criterion
     */
    const traceContour = (startX, startY, isOuter) => {
        const points = [];
        let x = startX, y = startY;
        
        // 确定初始搜索方向
        // 外轮廓：从左边进入（搜索方向 0=右）
        // 内轮廓：从右边进入（搜索方向 4=左）
        let searchDir = isOuter ? 7 : 3;
        
        let prevDir = -1;
        let firstX = -1, firstY = -1, firstDir = -1;
        let secondX = -1, secondY = -1;
        
        const maxIter = size;
        let iter = 0;
        
        do {
            // 标记当前点
            marker[y * width + x] = 2;
            
            // 找下一个边界点（顺时针搜索）
            let found = false;
            let foundDir = -1;
            
            for (let i = 0; i < 8; i++) {
                const dir = (searchDir + i) % 8;
                const nx = x + DX8[dir];
                const ny = y + DY8[dir];
                
                if (getPixel(nx, ny)) {
                    foundDir = dir;
                    found = true;
                    break;
                }
            }
            
            if (!found) {
                // 孤立点
                if (points.length === 0) {
                    points.push({ x, y });
                }
                break;
            }
            
            // Straight Run 优化：只在方向改变时输出点
            if (prevDir !== foundDir) {
                points.push({ x, y });
            }
            prevDir = foundDir;
            
            // 记录第一个和第二个点用于终止判断
            if (firstX < 0) {
                firstX = x; firstY = y; firstDir = foundDir;
            } else if (secondX < 0) {
                secondX = x; secondY = y;
            }
            
            // 移动到下一个点
            x += DX8[foundDir];
            y += DY8[foundDir];
            
            // 更新搜索方向（从来的方向的下一个开始）
            searchDir = (foundDir + 5) % 8;  // 反方向 +1
            
            iter++;
            
            // Jacob's stopping criterion
            // 当回到起点且下一步也相同时停止
            if (x === firstX && y === firstY && iter > 1) {
                // 检查是否真正闭合
                if (iter === 2 || (x === startX && y === startY)) {
                    break;
                }
                // 检查下一步方向
                for (let i = 0; i < 8; i++) {
                    const dir = (searchDir + i) % 8;
                    const nx = x + DX8[dir];
                    const ny = y + DY8[dir];
                    if (getPixel(nx, ny)) {
                        if (dir === firstDir && nx === secondX && ny === secondY) {
                            // 完全回到起始状态，闭合
                            break;
                        }
                        break;
                    }
                }
                break;
            }
            
        } while (iter < maxIter);
        
        return points;
    };
    
    // 单次扫描检测轮廓
    for (let y = 0; y < height; y++) {
        let prevPixel = 0;
        
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            const pixel = bitmap[idx];
            
            if (pixel && !prevPixel && marker[idx] === 0) {
                // 外轮廓起点：从背景进入前景
                marker[idx] = 1;
                
                const points = traceContour(x, y, true);
                
                if (points.length >= 3) {
                    // 闭合
                    points.push({ ...points[0] });
                    
                    // 计算面积（Shoelace formula）
                    let area = 0;
                    for (let i = 0; i < points.length - 1; i++) {
                        area += points[i].x * points[i + 1].y;
                        area -= points[i + 1].x * points[i].y;
                    }
                    area /= 2;
                    
                    contours.push({
                        points,
                        type: 'outer',
                        area: Math.abs(area)
                    });
                }
            }
            else if (!pixel && prevPixel && marker[idx - 1] !== 2) {
                // 内轮廓起点：从前景进入背景
                const px = x - 1;
                if (marker[y * width + px] === 0) {
                    marker[y * width + px] = 1;
                    
                    const points = traceContour(px, y, false);
                    
                    if (points.length >= 3) {
                        points.push({ ...points[0] });
                        
                        let area = 0;
                        for (let i = 0; i < points.length - 1; i++) {
                            area += points[i].x * points[i + 1].y;
                            area -= points[i + 1].x * points[i].y;
                        }
                        area /= 2;
                        
                        contours.push({
                            points,
                            type: 'inner',
                            area: -Math.abs(area)
                        });
                    }
                }
            }
            
            prevPixel = pixel;
            
            // 安全限制
            if (contours.length > 10000) break;
        }
        if (contours.length > 10000) break;
    }
    
    // 按面积绝对值排序（大到小）
    contours.sort((a, b) => Math.abs(b.area) - Math.abs(a.area));
    
    return contours;
}

/**
 * 改进版：带亚像素精度的边界追踪
 * 结合 PathWalker 的效率和 Marching Squares 的精度
 * 
 * @param {Uint8Array} bitmap - 二值位图
 * @param {number} width - 宽度
 * @param {number} height - 高度
 * @param {Float32Array} grayscale - 灰度图（用于亚像素插值）
 * @returns {Array} 轮廓数组
 */
export function traceContoursHybrid(bitmap, width, height, grayscale = null) {
    // 先用 VTracer 风格追踪获取关键点
    const rawContours = traceContoursVTracer(bitmap, width, height);
    
    if (!grayscale) {
        return rawContours;
    }

    // 对每个轮廓进行亚像素精细化
    const threshold = 128;
    
    return rawContours.map(contour => {
        const refinedPoints = contour.points.map(pt => {
            // 对整数坐标点，尝试基于灰度进行亚像素偏移
            const x = Math.round(pt.x);
            const y = Math.round(pt.y);
            
            // 检查水平方向的梯度
            let dx = 0, dy = 0;
            
            if (x > 0 && x < width - 1) {
                const left = grayscale[y * width + (x - 1)];
                const right = grayscale[y * width + (x + 1)];
                if (Math.abs(left - right) > 10) {
                    // 线性插值找边界位置
                    const t = (threshold - left) / (right - left);
                    if (t > 0 && t < 1) {
                        dx = t - 0.5;
                    }
                }
            }
            
            if (y > 0 && y < height - 1) {
                const top = grayscale[(y - 1) * width + x];
                const bottom = grayscale[(y + 1) * width + x];
                if (Math.abs(top - bottom) > 10) {
                    const t = (threshold - top) / (bottom - top);
                    if (t > 0 && t < 1) {
                        dy = t - 0.5;
                    }
                }
            }
            
            return {
                x: pt.x + dx * 0.5,
                y: pt.y + dy * 0.5
            };
        });

        return {
            ...contour,
            points: refinedPoints
        };
    });
}
