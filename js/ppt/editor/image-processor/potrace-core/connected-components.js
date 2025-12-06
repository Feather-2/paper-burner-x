/**
 * Potrace Core - 连通区域标记模块
 * 
 * Two-Pass Connected Component Labeling 算法
 */

/**
 * 连通区域标记 (Two-Pass CCL)
 */
export function labelConnectedComponents(bitmap) {
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
