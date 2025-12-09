/**
 * Potrace Core - 路径简化模块
 * 
 * 类似 Adobe Illustrator 的"简化"功能
 * 对已生成的 SVG 路径进行二次简化/平滑
 */

/**
 * 解析 SVG path 字符串，提取所有子路径的点
 * 每个 M 命令开始一个新的子路径
 * @param {string} pathD - SVG path d 属性
 * @returns {Array<Array<{x: number, y: number}>>} 子路径数组，每个子路径是点数组
 */
export function parsePathToSubpaths(pathD) {
    const subpaths = [];
    let currentSubpath = [];
    
    // 匹配所有命令和坐标
    const commands = pathD.match(/[MLCQAZ][^MLCQAZ]*/gi) || [];
    
    let currentX = 0, currentY = 0;
    let startX = 0, startY = 0; // 子路径起点，用于 Z 命令
    
    for (const cmd of commands) {
        const type = cmd[0].toUpperCase();
        const nums = cmd.slice(1).match(/-?\d+\.?\d*/g)?.map(Number) || [];
        
        switch (type) {
            case 'M':
                // M 命令开始新的子路径
                if (currentSubpath.length > 0) {
                    subpaths.push(currentSubpath);
                }
                currentSubpath = [];
                
                for (let i = 0; i < nums.length; i += 2) {
                    currentX = nums[i];
                    currentY = nums[i + 1];
                    if (i === 0) {
                        startX = currentX;
                        startY = currentY;
                    }
                    currentSubpath.push({ x: currentX, y: currentY });
                }
                break;
                
            case 'L':
                for (let i = 0; i < nums.length; i += 2) {
                    currentX = nums[i];
                    currentY = nums[i + 1];
                    currentSubpath.push({ x: currentX, y: currentY });
                }
                break;
                
            case 'C': // 三次贝塞尔曲线
                for (let i = 0; i < nums.length; i += 6) {
                    const cp1x = nums[i], cp1y = nums[i + 1];
                    const cp2x = nums[i + 2], cp2y = nums[i + 3];
                    const endX = nums[i + 4], endY = nums[i + 5];
                    
                    // 在曲线上采样 4 个点
                    for (let t = 0.25; t <= 1; t += 0.25) {
                        const pt = sampleCubicBezier(currentX, currentY, cp1x, cp1y, cp2x, cp2y, endX, endY, t);
                        currentSubpath.push(pt);
                    }
                    
                    currentX = endX;
                    currentY = endY;
                }
                break;
                
            case 'Q': // 二次贝塞尔曲线
                for (let i = 0; i < nums.length; i += 4) {
                    const cpx = nums[i], cpy = nums[i + 1];
                    const endX = nums[i + 2], endY = nums[i + 3];
                    
                    for (let t = 0.33; t <= 1; t += 0.33) {
                        const pt = sampleQuadBezier(currentX, currentY, cpx, cpy, endX, endY, t);
                        currentSubpath.push(pt);
                    }
                    
                    currentX = endX;
                    currentY = endY;
                }
                break;
                
            case 'Z':
                // 闭合路径，回到起点
                currentX = startX;
                currentY = startY;
                // 保存当前子路径
                if (currentSubpath.length > 0) {
                    subpaths.push(currentSubpath);
                    currentSubpath = [];
                }
                break;
        }
    }
    
    // 保存最后一个子路径
    if (currentSubpath.length > 0) {
        subpaths.push(currentSubpath);
    }
    
    return subpaths;
}

/**
 * 兼容旧接口：返回扁平化的点数组
 */
export function parsePathToPoints(pathD) {
    const subpaths = parsePathToSubpaths(pathD);
    return subpaths.flat();
}

/**
 * 采样三次贝塞尔曲线
 */
function sampleCubicBezier(x0, y0, x1, y1, x2, y2, x3, y3, t) {
    const mt = 1 - t;
    const mt2 = mt * mt;
    const mt3 = mt2 * mt;
    const t2 = t * t;
    const t3 = t2 * t;
    
    return {
        x: mt3 * x0 + 3 * mt2 * t * x1 + 3 * mt * t2 * x2 + t3 * x3,
        y: mt3 * y0 + 3 * mt2 * t * y1 + 3 * mt * t2 * y2 + t3 * y3
    };
}

/**
 * 采样二次贝塞尔曲线
 */
function sampleQuadBezier(x0, y0, x1, y1, x2, y2, t) {
    const mt = 1 - t;
    return {
        x: mt * mt * x0 + 2 * mt * t * x1 + t * t * x2,
        y: mt * mt * y0 + 2 * mt * t * y1 + t * t * y2
    };
}

/**
 * Ramer-Douglas-Peucker 路径简化
 */
function simplifyRDP(points, epsilon) {
    if (points.length < 3) return points;
    
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
    
    if (maxDist > epsilon) {
        const left = simplifyRDP(points.slice(0, maxIndex + 1), epsilon);
        const right = simplifyRDP(points.slice(maxIndex), epsilon);
        return left.slice(0, -1).concat(right);
    } else {
        return [first, last];
    }
}

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
 * 从点数组生成平滑的 SVG 路径
 * 使用 fit-curve 或 Catmull-Rom 样条
 */
function pointsToSmoothPath(points, fitError = 2.0) {
    if (points.length < 3) {
        if (points.length === 0) return '';
        if (points.length === 1) return `M${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}Z`;
        return `M${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}L${points[1].x.toFixed(2)},${points[1].y.toFixed(2)}Z`;
    }
    
    const ptsArray = points.map(p => [p.x, p.y]);
    
    // 尝试使用 fit-curve
    if (typeof window !== 'undefined' && typeof window.fitCurve === 'function') {
        try {
            const curves = window.fitCurve(ptsArray, fitError);
            if (curves && curves.length > 0) {
                let path = `M${curves[0][0][0].toFixed(2)},${curves[0][0][1].toFixed(2)}`;
                for (const c of curves) {
                    path += `C${c[1][0].toFixed(2)},${c[1][1].toFixed(2)},${c[2][0].toFixed(2)},${c[2][1].toFixed(2)},${c[3][0].toFixed(2)},${c[3][1].toFixed(2)}`;
                }
                return path + 'Z';
            }
        } catch (e) {
            console.warn('[simplifyPath] fit-curve 失败，回退到 Catmull-Rom');
        }
    }
    
    // 回退：Catmull-Rom 样条
    return catmullRomPath(points);
}

/**
 * Catmull-Rom 样条生成路径
 */
function catmullRomPath(points, tension = 0.3) {
    const n = points.length;
    if (n < 3) return '';
    
    let path = `M${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`;
    
    for (let i = 0; i < n; i++) {
        const p0 = points[(i - 1 + n) % n];
        const p1 = points[i];
        const p2 = points[(i + 1) % n];
        const p3 = points[(i + 2) % n];
        
        const cp1x = p1.x + (p2.x - p0.x) * tension / 3;
        const cp1y = p1.y + (p2.y - p0.y) * tension / 3;
        const cp2x = p2.x - (p3.x - p1.x) * tension / 3;
        const cp2y = p2.y - (p3.y - p1.y) * tension / 3;
        
        path += `C${cp1x.toFixed(2)},${cp1y.toFixed(2)},${cp2x.toFixed(2)},${cp2y.toFixed(2)},${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
    }
    
    return path + 'Z';
}

/**
 * 简化单个 SVG 路径
 * 正确处理包含多个子路径的 path
 * 
 * 策略：不激进删点，而是通过 fit-curve 的误差阈值控制平滑度
 * - level 低：保留更多细节（fit-curve 误差小，曲线段多）
 * - level 高：更平滑简洁（fit-curve 误差大，曲线段少）
 * 
 * @param {string} pathD - 原始 SVG path d 属性
 * @param {number} level - 简化级别 (0-100)，值越大越平滑/简化
 * @param {Object} options - 可选参数
 * @param {boolean} options.preserveStroke - 保持笔画宽度模式（适合文字/Logo）
 * @returns {string} 简化后的 path d
 */
export function simplifyPathD(pathD, level = 50, options = {}) {
    if (!pathD || level <= 0) return pathD;
    
    const { preserveStroke = false } = options;
    
    // 文字/Logo 模式：更保守的参数，防止笔画变形
    // 普通模式：标准参数
    let fitError, rdpEpsilon;
    
    if (preserveStroke) {
        // 保持笔画模式：
        // - fitError 更小，保留更多形状细节
        // - RDP 几乎不用，避免笔画收缩
        // - 有效 level 上限降低（100 -> ~60 的效果）
        const effectiveLevel = level * 0.6;
        fitError = 0.3 + (effectiveLevel / 100) * 4;  // 0.3 ~ 2.7
        rdpEpsilon = effectiveLevel > 50 ? 0.2 + (effectiveLevel - 50) / 100 * 0.5 : 0;  // 0 ~ 0.45
    } else {
        // 标准模式
        fitError = 0.5 + (level / 100) * 8;  // 0.5 ~ 8.5
        rdpEpsilon = level > 30 ? 0.3 + (level - 30) / 100 * 1.5 : 0;  // 0 ~ 1.35
    }
    
    // 解析路径为多个子路径
    const subpaths = parsePathToSubpaths(pathD);
    if (subpaths.length === 0) return pathD;
    
    // 分别简化每个子路径
    const simplifiedPaths = [];
    
    for (let points of subpaths) {
        if (points.length < 3) {
            // 点太少，保持原样
            if (points.length === 1) {
                simplifiedPaths.push(`M${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}Z`);
            } else if (points.length === 2) {
                simplifiedPaths.push(`M${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}L${points[1].x.toFixed(2)},${points[1].y.toFixed(2)}Z`);
            }
            continue;
        }
        
        // 只在高 level 时轻微简化，去除微小抖动
        if (rdpEpsilon > 0 && points.length > 10) {
            const simplified = simplifyRDP(points, rdpEpsilon);
            // 只有当简化后点数仍然足够时才使用
            if (simplified.length >= Math.max(4, points.length * 0.3)) {
                points = simplified;
            }
        }
        
        // 用 fit-curve 重新拟合为平滑曲线
        // fitError 越大 → 曲线段越少 → 越平滑简洁
        simplifiedPaths.push(pointsToSmoothPath(points, fitError));
    }
    
    // 合并所有子路径
    return simplifiedPaths.join('');
}

/**
 * 简化整个矢量化结果
 * 
 * @param {Object} vectorResult - vectorize() 返回的结果
 * @param {number} level - 简化级别 (0-100)
 * @returns {Object} 简化后的结果（新对象，不修改原始）
 */
export function simplifyVectorResult(vectorResult, level = 50) {
    if (!vectorResult || !vectorResult.layers) return vectorResult;
    
    const newLayers = vectorResult.layers.map(layer => ({
        ...layer,
        paths: layer.paths.map(path => ({
            ...path,
            d: simplifyPathD(path.d, level)
        }))
    }));
    
    // 重新生成 SVG
    const allPaths = newLayers.flatMap(l => l.paths);
    const svgContent = allPaths.map(p => {
        const fillRule = p.fillRule ? ` fill-rule="${p.fillRule}"` : '';
        return `<path d="${p.d}" fill="${p.fill}"${fillRule} stroke="${p.stroke || 'none'}" stroke-width="${p.strokeWidth || 0}"/>`;
    }).join('\n');
    
    const { width, height, viewBoxWidth, viewBoxHeight } = vectorResult;
    const bgColor = vectorResult.colors?.[vectorResult.colors.length - 1] || '#ffffff';
    const bgRect = `<rect x="0" y="0" width="${viewBoxWidth}" height="${viewBoxHeight}" fill="${bgColor}"/>`;
    
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${viewBoxWidth} ${viewBoxHeight}">\n${bgRect}\n${svgContent}\n</svg>`;
    
    return {
        ...vectorResult,
        svg,
        layers: newLayers,
        paths: allPaths,
        simplified: true,
        simplifyLevel: level
    };
}

/**
 * 获取简化预览（不生成完整 SVG，只返回简化后的路径）
 * 用于滑块实时预览，性能更好
 */
export function getSimplifyPreview(pathD, level) {
    return simplifyPathD(pathD, level);
}
