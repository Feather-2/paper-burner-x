/**
 * Vecburner - 分块矢量化模块
 * 
 * 将图像分割成独立区块，分别矢量化后合并
 * 适合处理包含文字和图形混合的复杂图像
 */

import { labelConnectedComponents } from './connected-components.js';
import { computeOtsuThreshold } from './binary-image.js';
import { PRESETS } from './presets.js';

// 延迟导入 vectorize 避免循环依赖
let vectorizeFn = null;
async function getVectorize() {
    if (!vectorizeFn) {
        const mod = await import('./index.js');
        vectorizeFn = mod.vectorize;
    }
    return vectorizeFn;
}

/**
 * 从 ImageData 创建二值图用于区块检测
 */
function createDetectionBitmap(imageData, threshold = null) {
    const { data, width, height } = imageData;
    const bitmap = {
        data: new Uint8Array(width * height),
        width,
        height
    };
    
    // 自动计算阈值
    if (threshold === null) {
        threshold = computeOtsuThreshold(imageData);
    }
    
    for (let i = 0; i < width * height; i++) {
        const idx = i * 4;
        // 计算亮度
        const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
        const alpha = data[idx + 3];
        // 前景：亮度低于阈值 且 不透明
        bitmap.data[i] = (lum < threshold && alpha > 128) ? 1 : 0;
    }
    
    // 检测是否需要反转（背景是暗色）
    let fgCount = 0;
    for (let i = 0; i < bitmap.data.length; i++) {
        if (bitmap.data[i] === 1) fgCount++;
    }
    
    if (fgCount > width * height * 0.5) {
        // 反转
        for (let i = 0; i < bitmap.data.length; i++) {
            bitmap.data[i] = 1 - bitmap.data[i];
        }
    }
    
    return bitmap;
}

/**
 * 计算区域的边界框
 */
function computeBoundingBox(pixels) {
    if (pixels.length === 0) return null;
    
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;
    
    for (const p of pixels) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }
    
    return {
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
        area: pixels.length
    };
}

/**
 * 合并临近的区块
 * @param {Array} blocks - 区块数组，每个包含 bbox
 * @param {number} gap - 合并距离阈值
 */
function mergeNearbyBlocks(blocks, gap = 20) {
    if (blocks.length <= 1) return blocks;
    
    // 计算两个 bbox 的距离
    const bboxDistance = (a, b) => {
        const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width));
        const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height));
        return Math.sqrt(dx * dx + dy * dy);
    };
    
    // 合并两个 bbox
    const mergeBbox = (a, b) => ({
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        width: Math.max(a.x + a.width, b.x + b.width) - Math.min(a.x, b.x),
        height: Math.max(a.y + a.height, b.y + b.height) - Math.min(a.y, b.y),
        area: a.area + b.area,
        merged: true
    });
    
    // 迭代合并直到没有变化
    let merged = blocks.map(b => ({ ...b }));
    let changed = true;
    
    while (changed) {
        changed = false;
        const newMerged = [];
        const used = new Set();
        
        for (let i = 0; i < merged.length; i++) {
            if (used.has(i)) continue;
            
            let current = merged[i];
            
            for (let j = i + 1; j < merged.length; j++) {
                if (used.has(j)) continue;
                
                if (bboxDistance(current, merged[j]) < gap) {
                    current = mergeBbox(current, merged[j]);
                    used.add(j);
                    changed = true;
                }
            }
            
            newMerged.push(current);
            used.add(i);
        }
        
        merged = newMerged;
    }
    
    return merged;
}

/**
 * 从 ImageData 裁剪指定区域，返回真正的 ImageData 对象
 */
function cropImageData(imageData, bbox, padding = 2) {
    const { data, width } = imageData;
    
    // 添加 padding
    const x = Math.max(0, bbox.x - padding);
    const y = Math.max(0, bbox.y - padding);
    const w = Math.min(imageData.width - x, bbox.width + padding * 2);
    const h = Math.min(imageData.height - y, bbox.height + padding * 2);
    
    // 创建真正的 ImageData 对象
    const canvas = typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(w, h)
        : document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const croppedImageData = ctx.createImageData(w, h);
    const cropped = croppedImageData.data;
    
    for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) {
            const srcIdx = ((y + dy) * width + (x + dx)) * 4;
            const dstIdx = (dy * w + dx) * 4;
            cropped[dstIdx] = data[srcIdx];
            cropped[dstIdx + 1] = data[srcIdx + 1];
            cropped[dstIdx + 2] = data[srcIdx + 2];
            cropped[dstIdx + 3] = data[srcIdx + 3];
        }
    }
    
    // 返回真正的 ImageData，附加偏移信息
    croppedImageData.offsetX = x;
    croppedImageData.offsetY = y;
    return croppedImageData;
}

/**
 * 偏移 SVG 路径坐标
 * 先缩放，再偏移
 * 
 * 改进版：更健壮的坐标解析，不依赖特定的分隔符（逗号/空格）
 * 兼容 M, L, C, Z 等命令的所有坐标对
 */
function offsetSvgPaths(paths, offsetX, offsetY, scaleX = 1, scaleY = 1) {
    return paths.map(path => {
        // 状态：当前是否是 X 坐标（交替变换）
        // Potrace Core 生成的路径只包含 M, L, C，其参数总是成对的 (x, y)
        // 因此我们可以简单地在 X 和 Y 之间切换
        let isX = true;
        
        // 正则匹配：命令字符 OR 数字
        // replace 会保留未匹配的字符（即原有的分隔符：空格、逗号等），只替换数字部分
        const offsetD = path.d.replace(
            /([a-zA-Z])|([-+]?\d*\.?\d+)/g,
            (match, cmd, numStr) => {
                // 1. 如果是命令字符，重置状态（虽然对于成对坐标不需要，但作为保险）并保留原样
                if (cmd) {
                    isX = true; 
                    return cmd;
                }
                
                // 2. 如果是数字，进行变换
                const val = parseFloat(numStr);
                let result;
                
                if (isX) {
                    // X 坐标变换
                    result = (val * scaleX + offsetX).toFixed(2);
                } else {
                    // Y 坐标变换
                    result = (val * scaleY + offsetY).toFixed(2);
                }
                
                // 切换状态
                isX = !isX;
                return result;
            }
        );
        
        return {
            ...path,
            d: offsetD
        };
    });
}

/**
 * 推断区块最佳预设
 */
function detectBlockPreset(bbox, imageArea) {
    const blockArea = bbox.width * bbox.height;
    const areaRatio = blockArea / imageArea;
    const aspectRatio = bbox.width / bbox.height;
    
    // 小区块（可能是图标或小文字）
    if (blockArea < 5000) {
        return 'pixel';
    }
    
    // 扁长区块（可能是文字行）
    if (aspectRatio > 4 || aspectRatio < 0.25) {
        return 'lineart';
    }
    
    // 中等区块
    if (blockArea < 20000) {
        return 'logo';
    }
    
    // 大区块
    return 'illustration';
}

/**
 * 分块矢量化主函数
 * 
 * @param {ImageData} imageData - 输入图像
 * @param {Object} options - 选项
 * @param {number} options.minBlockArea - 最小区块面积，默认 50
 * @param {number} options.mergeGap - 区块合并距离，默认 15
 * @param {number} options.padding - 裁剪 padding，默认 4
 * @param {string} options.preset - 强制使用的预设（可选）
 */
export async function vectorizeByBlocks(imageData, options = {}) {
    const {
        minBlockArea = 50,
        mergeGap = 15,
        padding = 4,
        preset = null  // null 表示自动检测
    } = options;
    
    const { width, height } = imageData;
    const imageArea = width * height;
    
    console.log(`[BlockVectorize] 开始分块矢量化 ${width}x${height}`);
    
    // 1. 创建检测用二值图
    const bitmap = createDetectionBitmap(imageData);
    
    // 2. 连通区域标记
    const { regions, numRegions } = labelConnectedComponents(bitmap);
    console.log(`[BlockVectorize] 检测到 ${numRegions} 个连通区域`);
    
    if (numRegions === 0) {
        // 没有前景，返回空结果
        return {
            svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"></svg>`,
            width,
            height,
            layers: [],
            paths: [],
            blocks: []
        };
    }
    
    // 3. 计算边界框并过滤小区域
    let blocks = [];
    for (let i = 1; i <= numRegions; i++) {
        if (regions[i] && regions[i].length >= minBlockArea) {
            const bbox = computeBoundingBox(regions[i]);
            if (bbox && bbox.area >= minBlockArea) {
                blocks.push({
                    id: i,
                    bbox,
                    pixels: regions[i]
                });
            }
        }
    }
    
    console.log(`[BlockVectorize] 有效区块: ${blocks.length} 个`);
    
    // 调试：显示所有区块的 bbox
    if (blocks.length > 0) {
        const allBboxes = blocks.map(b => b.bbox);
        const minX = Math.min(...allBboxes.map(b => b.x));
        const minY = Math.min(...allBboxes.map(b => b.y));
        const maxX = Math.max(...allBboxes.map(b => b.x + b.width));
        const maxY = Math.max(...allBboxes.map(b => b.y + b.height));
        console.log(`[BlockVectorize] 区块覆盖范围: (${minX},${minY}) - (${maxX},${maxY}), 图像: ${width}x${height}`);
    }
    
    if (blocks.length === 0) {
        // 所有区域都太小，回退到全图矢量化
        console.log(`[BlockVectorize] 无有效区块，回退全图矢量化`);
        const vectorize = await getVectorize();
        return vectorize(imageData, PRESETS.lineart);
    }
    
    // 4. 合并临近区块
    const mergedBlocks = mergeNearbyBlocks(
        blocks.map(b => b.bbox),
        mergeGap
    );
    console.log(`[BlockVectorize] 合并后: ${mergedBlocks.length} 个区块`);
    
    // 5. 如果只有一个大区块覆盖大部分图像，回退全图处理
    if (mergedBlocks.length === 1) {
        const block = mergedBlocks[0];
        const coverage = (block.width * block.height) / imageArea;
        if (coverage > 0.8) {
            console.log(`[BlockVectorize] 单一区块覆盖 ${(coverage * 100).toFixed(0)}%，回退全图矢量化`);
            const autoPreset = detectBlockPreset(block, imageArea);
            const vectorize = await getVectorize();
            return vectorize(imageData, PRESETS[preset || autoPreset] || PRESETS.logo);
        }
    }
    
    // 6. 分别矢量化每个区块
    const blockResults = [];
    const vectorize = await getVectorize();
    
    for (let i = 0; i < mergedBlocks.length; i++) {
        const block = mergedBlocks[i];
        
        // 裁剪图像
        const cropped = cropImageData(imageData, block, padding);
        
        // 选择预设
        const blockPreset = preset || detectBlockPreset(block, imageArea);
        const presetConfig = PRESETS[blockPreset] || PRESETS.logo;
        
        console.log(`[BlockVectorize] 区块 ${i + 1}/${mergedBlocks.length}: ${block.width}x${block.height} → ${blockPreset}`);
        
        try {
            // 矢量化 - cropped 已经是 ImageData 对象
            const result = await vectorize(cropped, presetConfig);
            
            // 计算缩放比例（如果矢量化时有放大，需要缩小回原尺寸）
            // cropped.width 是原始裁剪尺寸，viewBoxWidth 是放大后的尺寸
            const viewBoxW = result.viewBoxWidth || result.width || cropped.width;
            const viewBoxH = result.viewBoxHeight || result.height || cropped.height;
            const scaleX = cropped.width / viewBoxW;
            const scaleY = cropped.height / viewBoxH;
            
            console.log(`[BlockVectorize] 区块 ${i + 1} 变换: crop=${cropped.width}x${cropped.height}, viewBox=${viewBoxW}x${viewBoxH}, scale=${scaleX.toFixed(3)}, offset=(${cropped.offsetX},${cropped.offsetY})`);
            
            // 偏移路径坐标到原始位置
            // 先按 scaleX/Y 缩放（把放大的坐标缩小回原尺寸），再加偏移
            const offsetPaths = offsetSvgPaths(
                result.paths,
                cropped.offsetX,
                cropped.offsetY,
                scaleX,
                scaleY
            );
            
            blockResults.push({
                block,
                preset: blockPreset,
                paths: offsetPaths,
                layers: result.layers,
                colors: result.colors
            });
        } catch (err) {
            console.warn(`[BlockVectorize] 区块 ${i + 1} 矢量化失败:`, err);
        }
    }
    
    // 7. 合并所有路径
    const allPaths = blockResults.flatMap(r => r.paths);
    const allColors = [...new Set(blockResults.flatMap(r => r.colors || []))];
    
    // 调试：检查路径边界
    let pathMinX = Infinity, pathMinY = Infinity, pathMaxX = -Infinity, pathMaxY = -Infinity;
    for (const p of allPaths) {
        const coords = p.d.match(/(-?\d+\.?\d*),(-?\d+\.?\d*)/g) || [];
        for (const c of coords) {
            const [x, y] = c.split(',').map(Number);
            if (x < pathMinX) pathMinX = x;
            if (x > pathMaxX) pathMaxX = x;
            if (y < pathMinY) pathMinY = y;
            if (y > pathMaxY) pathMaxY = y;
        }
    }
    console.log(`[BlockVectorize] 路径边界: (${pathMinX.toFixed(0)},${pathMinY.toFixed(0)}) - (${pathMaxX.toFixed(0)},${pathMaxY.toFixed(0)}), SVG: ${width}x${height}`);
    
    // 8. 生成合并后的 SVG
    const svgContent = allPaths.map(p => {
        const fillRule = p.fillRule ? ` fill-rule="${p.fillRule}"` : '';
        return `<path d="${p.d}" fill="${p.fill}"${fillRule} stroke="${p.stroke}" stroke-width="${p.strokeWidth}"/>`;
    }).join('\n');
    
    // 检测背景色（使用最亮的颜色或白色）
    const bgColor = '#ffffff';
    const bgRect = `<rect x="0" y="0" width="${width}" height="${height}" fill="${bgColor}"/>`;
    
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n${bgRect}\n${svgContent}\n</svg>`;
    
    console.log(`[BlockVectorize] 完成: ${blockResults.length} 个区块, ${allPaths.length} 条路径`);
    
    return {
        svg,
        width,
        height,
        viewBoxWidth: width,
        viewBoxHeight: height,
        layers: blockResults.flatMap(r => r.layers),
        paths: allPaths,
        colors: allColors,
        blocks: blockResults.map(r => ({
            bbox: r.block,
            preset: r.preset,
            pathCount: r.paths.length
        })),
        engine: 'vecburner-blocks'
    };
}

/**
 * 智能矢量化 - 自动选择全图或分块模式
 */
export async function vectorizeSmart(imageData, options = {}) {
    const { width, height } = imageData;
    const vectorize = await getVectorize();
    
    // 检测是否需要分块
    const bitmap = createDetectionBitmap(imageData);
    const { numRegions } = labelConnectedComponents(bitmap);
    
    console.log(`[SmartVectorize] 图像 ${width}x${height}, 检测到 ${numRegions} 个独立区域`);
    
    // 如果有多个独立区域（> 5），使用分块模式
    if (numRegions > 5) {
        console.log(`[SmartVectorize] 区域较多，使用分块模式`);
        return vectorizeByBlocks(imageData, options);
    }
    
    // 否则全图处理，自动选择预设
    const { analyzeImageColors } = await import('./color-analysis.js');
    const analysis = analyzeImageColors(imageData);
    const presetConfig = PRESETS[analysis.recommendedPreset] || PRESETS.logo;
    
    console.log(`[SmartVectorize] 区域较少，使用全图模式 (${analysis.recommendedPreset})`);
    return vectorize(imageData, presetConfig);
}

export default { vectorizeByBlocks, vectorizeSmart };
