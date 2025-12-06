/**
 * 连通区域标记模块 (Two-Pass CCL)
 * @module vectorizer/connected-components
 */

/**
 * 标记连通区域
 * @param {Object} bitmap - { data, width, height }
 * @returns {Object} { labels, numRegions, regions, width, height }
 */
export function labelConnectedComponents(bitmap) {
    const { data, width, height } = bitmap;
    const labels = new Int32Array(width * height);
    const parent = [0];
    let nextLabel = 1;

    // 并查集 Find 操作（带路径压缩）
    const find = (i) => {
        while (parent[i] !== i) {
            parent[i] = parent[parent[i]];
            i = parent[i];
        }
        return i;
    };

    // 并查集 Union 操作
    const union = (i, j) => {
        const ri = find(i), rj = find(j);
        if (ri !== rj) parent[Math.max(ri, rj)] = Math.min(ri, rj);
    };

    // First pass: 分配标签
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

    // Second pass: 统一标签
    const labelMap = new Map();
    let finalLabel = 0;

    for (let i = 0; i < labels.length; i++) {
        if (data[i] === 0) continue;
        const root = find(labels[i]);
        if (!labelMap.has(root)) labelMap.set(root, ++finalLabel);
        labels[i] = labelMap.get(root);
    }

    // 收集每个区域的像素
    const regions = Array.from({ length: finalLabel + 1 }, () => []);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const l = labels[y * width + x];
            if (l > 0) regions[l].push({ x, y });
        }
    }

    return { labels, numRegions: finalLabel, regions, width, height };
}

/**
 * 获取区域的边界框
 */
export function getRegionBounds(region) {
    if (region.length === 0) return null;

    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    for (const p of region) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }

    return {
        left: minX,
        top: minY,
        right: maxX + 1,
        bottom: maxY + 1,
        width: maxX - minX + 1,
        height: maxY - minY + 1
    };
}

/**
 * 计算区域面积
 */
export function getRegionArea(region) {
    return region.length;
}

/**
 * 过滤小区域
 */
export function filterSmallRegions(ccResult, minArea = 16) {
    const filteredRegions = ccResult.regions.filter(r => r.length >= minArea);
    return {
        ...ccResult,
        regions: filteredRegions,
        numRegions: filteredRegions.length - 1 // 减去空的第一个
    };
}
