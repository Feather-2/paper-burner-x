/**
 * 背景去除模块
 * 基于边缘检测 + 颜色分析
 */

class BackgroundRemover {
    constructor() {
        this.config = {
            edgeThreshold: 30,
            colorTolerance: 25,
            smoothRadius: 2
        };
    }

    /**
     * 去除背景
     * @param {Object} imageObj - 图片对象
     * @param {Object} options - 选项
     * @returns {Promise<Object>} { foreground, mask, backgroundColor }
     */
    async remove(imageObj, options = {}) {
        const { imageData, width, height } = imageObj;
        const config = { ...this.config, ...options };

        // 1. 检测边缘
        const edges = this._detectEdges(imageData, config.edgeThreshold);

        // 2. 采样背景色（从四角）
        const bgColor = this._detectBackgroundColor(imageData, width, height);

        // 3. 基于背景色创建蒙版
        const mask = this._createMask(imageData, bgColor, config.colorTolerance, edges);

        // 4. 平滑蒙版边缘
        const smoothedMask = this._smoothMask(mask, width, height, config.smoothRadius);

        // 5. 应用蒙版生成前景
        const foreground = this._applyMask(imageData, smoothedMask);

        return {
            foreground,
            mask: smoothedMask,
            backgroundColor: bgColor,
            width,
            height
        };
    }

    /**
     * 简单边缘检测 (Sobel)
     */
    _detectEdges(imageData, threshold) {
        const { data, width, height } = imageData;
        const edges = new Uint8Array(width * height);

        const getGray = (x, y) => {
            if (x < 0 || x >= width || y < 0 || y >= height) return 0;
            const idx = (y * width + x) * 4;
            return (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
        };

        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                // Sobel kernels
                const gx = (
                    -getGray(x - 1, y - 1) + getGray(x + 1, y - 1) +
                    -2 * getGray(x - 1, y) + 2 * getGray(x + 1, y) +
                    -getGray(x - 1, y + 1) + getGray(x + 1, y + 1)
                );
                const gy = (
                    -getGray(x - 1, y - 1) - 2 * getGray(x, y - 1) - getGray(x + 1, y - 1) +
                    getGray(x - 1, y + 1) + 2 * getGray(x, y + 1) + getGray(x + 1, y + 1)
                );
                const magnitude = Math.sqrt(gx * gx + gy * gy);
                edges[y * width + x] = magnitude > threshold ? 255 : 0;
            }
        }

        return edges;
    }

    /**
     * 检测背景色
     */
    _detectBackgroundColor(imageData, width, height) {
        const { data } = imageData;
        const samples = [];
        const corners = [
            [0, 0], [width - 1, 0],
            [0, height - 1], [width - 1, height - 1]
        ];

        // 从四角采样
        corners.forEach(([cx, cy]) => {
            for (let dy = 0; dy < 5; dy++) {
                for (let dx = 0; dx < 5; dx++) {
                    const x = Math.min(Math.max(cx + dx, 0), width - 1);
                    const y = Math.min(Math.max(cy + dy, 0), height - 1);
                    const idx = (y * width + x) * 4;
                    samples.push({ r: data[idx], g: data[idx + 1], b: data[idx + 2] });
                }
            }
        });

        // 取中位数
        const median = (arr) => {
            const sorted = [...arr].sort((a, b) => a - b);
            return sorted[Math.floor(sorted.length / 2)];
        };

        return {
            r: median(samples.map(s => s.r)),
            g: median(samples.map(s => s.g)),
            b: median(samples.map(s => s.b))
        };
    }

    /**
     * 创建蒙版
     */
    _createMask(imageData, bgColor, tolerance, edges) {
        const { data, width, height } = imageData;
        const mask = new Uint8Array(width * height);

        const colorDist = (r, g, b) => {
            return Math.sqrt(
                Math.pow(r - bgColor.r, 2) +
                Math.pow(g - bgColor.g, 2) +
                Math.pow(b - bgColor.b, 2)
            );
        };

        for (let i = 0; i < width * height; i++) {
            const idx = i * 4;
            const dist = colorDist(data[idx], data[idx + 1], data[idx + 2]);
            
            // 如果颜色接近背景且不在边缘上，标记为背景
            if (dist < tolerance && edges[i] === 0) {
                mask[i] = 0; // 背景
            } else {
                mask[i] = 255; // 前景
            }
        }

        // Flood fill 从边缘向内
        this._floodFillFromEdges(mask, width, height);

        return mask;
    }

    /**
     * 从边缘 flood fill
     */
    _floodFillFromEdges(mask, width, height) {
        const visited = new Uint8Array(width * height);
        const queue = [];

        // 添加边缘像素到队列
        for (let x = 0; x < width; x++) {
            if (mask[x] === 0) queue.push([x, 0]);
            if (mask[(height - 1) * width + x] === 0) queue.push([x, height - 1]);
        }
        for (let y = 0; y < height; y++) {
            if (mask[y * width] === 0) queue.push([0, y]);
            if (mask[y * width + width - 1] === 0) queue.push([width - 1, y]);
        }

        // BFS
        while (queue.length > 0) {
            const [x, y] = queue.shift();
            const idx = y * width + x;

            if (visited[idx]) continue;
            visited[idx] = 1;

            if (mask[idx] !== 0) continue;

            // 标记为确定的背景
            mask[idx] = 0;

            // 添加相邻像素
            const neighbors = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
            for (const [nx, ny] of neighbors) {
                if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                    const nidx = ny * width + nx;
                    if (!visited[nidx] && mask[nidx] === 0) {
                        queue.push([nx, ny]);
                    }
                }
            }
        }

        // 未访问的背景色像素转为前景（内部区域）
        for (let i = 0; i < width * height; i++) {
            if (!visited[i] && mask[i] === 0) {
                mask[i] = 255;
            }
        }
    }

    /**
     * 平滑蒙版边缘
     */
    _smoothMask(mask, width, height, radius) {
        const smoothed = new Uint8Array(width * height);
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let sum = 0, count = 0;
                
                for (let dy = -radius; dy <= radius; dy++) {
                    for (let dx = -radius; dx <= radius; dx++) {
                        const nx = x + dx, ny = y + dy;
                        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                            sum += mask[ny * width + nx];
                            count++;
                        }
                    }
                }
                
                smoothed[y * width + x] = Math.round(sum / count);
            }
        }

        return smoothed;
    }

    /**
     * 应用蒙版
     */
    _applyMask(imageData, mask) {
        const { data, width, height } = imageData;
        const result = new ImageData(width, height);

        for (let i = 0; i < width * height; i++) {
            const srcIdx = i * 4;
            const alpha = mask[i];

            result.data[srcIdx] = data[srcIdx];
            result.data[srcIdx + 1] = data[srcIdx + 1];
            result.data[srcIdx + 2] = data[srcIdx + 2];
            result.data[srcIdx + 3] = alpha;
        }

        return result;
    }

    /**
     * 导出为透明 PNG
     */
    async exportAsPng(foregroundData) {
        const canvas = document.createElement('canvas');
        canvas.width = foregroundData.width;
        canvas.height = foregroundData.height;
        const ctx = canvas.getContext('2d');
        ctx.putImageData(foregroundData, 0, 0);
        return canvas.toDataURL('image/png');
    }
}

// 单例 & 导出到全局
const backgroundRemover = new BackgroundRemover();
window.BackgroundRemover = BackgroundRemover;
window.backgroundRemover = backgroundRemover;

// ESM 导出
export { BackgroundRemover };
