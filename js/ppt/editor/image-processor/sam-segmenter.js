/**
 * SAM Segmenter - 主线程代理
 * 通过 Web Worker 执行实际的模型加载和推理，避免阻塞主线程
 */

class SamSegmenter {
    constructor() {
        this.worker = null;
        this.pendingRequests = new Map();
        this.requestId = 0;

        this.isReady = false;
        this.isLoading = false;
        this.useLocalModel = false;

        // 配置
        this.config = {
            mode: 'auto', // 'auto' | 'local' | 'online'
            localModelPath: 'models/sam3/',
            onlineModelId: 'Xenova/slimsam-77-uniform',

            // 向后兼容：旧代码可能会使用 config.modelId
            modelId: 'Xenova/slimsam-77-uniform',
        };

        // 进度回调
        this.onProgress = null;

        // 降级（fallback）回调：用于 UI 提示（保持可选）
        this._onFallback = null;
    }

    _syncConfigCompat() {
        // 双向同步：modelId <-> onlineModelId
        if (this.config.modelId && this.config.onlineModelId !== this.config.modelId) {
            this.config.onlineModelId = this.config.modelId;
        }
        if (this.config.onlineModelId && this.config.modelId !== this.config.onlineModelId) {
            this.config.modelId = this.config.onlineModelId;
        }

        // 规范化 localModelPath
        if (this.config.localModelPath && !this.config.localModelPath.endsWith('/')) {
            this.config.localModelPath += '/';
        }
    }

    /**
     * 初始化 Worker
     */
    _initWorker() {
        if (this.worker) return;

        const workerUrl = new URL('./sam-segmenter-worker.js', import.meta.url);
        this.worker = new Worker(workerUrl, { type: 'module' });

        this.worker.onmessage = (e) => {
            const { id, type, result, error, message, percent } = e.data || {};

            if (type === 'progress') {
                this.onProgress?.(message, percent);
                return;
            }

            if (type === 'fallback') {
                this.useLocalModel = false;
                this._onFallback?.();
                return;
            }

            const pending = this.pendingRequests.get(id);
            if (!pending) return;

            this.pendingRequests.delete(id);

            if (type === 'success') {
                pending.resolve(result);
            } else {
                pending.reject(new Error(error));
            }
        };

        this.worker.onerror = (err) => {
            for (const pending of this.pendingRequests.values()) {
                pending.reject(err instanceof Error ? err : new Error(String(err)));
            }
            this.pendingRequests.clear();
            this.isReady = false;
            this.isLoading = false;
        };
    }

    _sendMessage(type, payload, transferables = []) {
        this._initWorker();

        const id = ++this.requestId;
        return new Promise((resolve, reject) => {
            this.pendingRequests.set(id, { resolve, reject });
            this.worker.postMessage({ id, type, payload }, transferables);
        });
    }

    /**
     * 初始化模型（懒加载）
     * @param {Function} progressCallback - 进度回调
     * @param {boolean} forceReload - 强制重新加载（切换模型时）
     */
    async init(progressCallback, forceReload = false) {
        this._syncConfigCompat();
        if (this.isReady && !forceReload) return true;
        if (this.isLoading) {
            while (this.isLoading) await new Promise(r => setTimeout(r, 100));
            return this.isReady;
        }

        this.isLoading = true;
        this.onProgress = progressCallback;

        try {
            await this._sendMessage('setConfig', this.config);
            const result = await this._sendMessage('init', { forceReload });
            this.isReady = !!result?.isReady;
            this.useLocalModel = !!result?.useLocalModel;
            return this.isReady;
        } finally {
            this.isLoading = false;
        }
    }

    /**
     * 预计算图片 embedding（可选，用于多次点击同一张图片）
     */
    async precomputeEmbedding(imageSource) {
        if (!this.isReady) await this.init();

        const { imageData, key } = await this._imageToImageDataWithKey(imageSource);
        const result = await this._sendMessage('precomputeEmbedding', { imageData, imageKey: key }, [imageData.data.buffer]);
        return result;
    }

    /**
     * 点击分割
     * @param {Object} imageSource - 图片源（URL/Canvas/HTMLImageElement）
     * @param {Array} points - 点击坐标数组 [[x, y], ...]
     * @param {Array} labels - 点击标签数组 [1, 0, ...]（1=前景，0=背景）
     * @returns {Promise<Object>} { masks, scores, selectedMaskIndex, width, height }
     */
    async segmentByPoints(imageSource, points, labels = null) {
        if (!this.isReady) await this.init();

        const { imageData, key } = await this._imageToImageDataWithKey(imageSource);
        return await this._sendMessage('segmentByPoints', {
            imageData,
            width: imageData.width,
            height: imageData.height,
            imageKey: key,
            points,
            labels,
        }, [imageData.data.buffer]);
    }

    /**
     * 框选分割
     * @param {Object} imageSource - 图片源
     * @param {Object} box - 框选区域 { x1, y1, x2, y2 }
     * @returns {Promise<Object>} 分割结果
     */
    async segmentByBox(imageSource, box) {
        if (!this.isReady) await this.init();

        const { imageData, key } = await this._imageToImageDataWithKey(imageSource);
        return await this._sendMessage('segmentByBox', {
            imageData,
            width: imageData.width,
            height: imageData.height,
            imageKey: key,
            box,
        }, [imageData.data.buffer]);
    }

    /**
     * 将图片源转换为 ImageData，并返回可用于缓存的 key（URL/img.src 等）
     */
    async _imageToImageDataWithKey(imageSource) {
        if (imageSource instanceof ImageData) {
            return { imageData: imageSource, key: null };
        }

        let key = null;
        if (typeof imageSource === 'string') key = imageSource;
        if (imageSource instanceof HTMLImageElement) key = imageSource.currentSrc || imageSource.src || null;

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        if (imageSource instanceof HTMLCanvasElement) {
            canvas.width = imageSource.width;
            canvas.height = imageSource.height;
            ctx.drawImage(imageSource, 0, 0);
            return { imageData: ctx.getImageData(0, 0, canvas.width, canvas.height), key };
        }

        if (imageSource instanceof HTMLImageElement) {
            canvas.width = imageSource.naturalWidth || imageSource.width;
            canvas.height = imageSource.naturalHeight || imageSource.height;
            ctx.drawImage(imageSource, 0, 0);
            return { imageData: ctx.getImageData(0, 0, canvas.width, canvas.height), key };
        }

        if (typeof imageSource === 'string') {
            const img = await this._loadImage(imageSource);
            canvas.width = img.naturalWidth || img.width;
            canvas.height = img.naturalHeight || img.height;
            ctx.drawImage(img, 0, 0);
            return { imageData: ctx.getImageData(0, 0, canvas.width, canvas.height), key };
        }

        throw new Error('不支持的图片源类型');
    }

    _loadImage(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('图片加载失败: ' + url));
            img.src = url;
        });
    }

    /**
     * 将 mask 转换为 ImageData
     * @param {Object} mask - mask（至少包含 data: Uint8Array|Array<boolean>）
     * @param {number} width - 图片宽度
     * @param {number} height - 图片高度
     * @returns {ImageData}
     */
    maskToImageData(mask, width, height) {
        const maskData = mask.data;
        const imageData = new ImageData(width, height);
        const data = imageData.data;

        for (let i = 0; i < maskData.length; i++) {
            const idx = i * 4;
            const val = maskData[i] ? 255 : 0;
            data[idx] = val;     // R
            data[idx + 1] = val; // G
            data[idx + 2] = val; // B
            data[idx + 3] = val; // A
        }

        return imageData;
    }

    /**
     * 将 mask 应用到图片，生成前景图层
     * @param {HTMLCanvasElement|HTMLImageElement} image - 原始图片
     * @param {Object} mask - 分割 mask（至少包含 data）
     * @returns {ImageData} 带透明通道的前景
     */
    applyMaskToImage(image, mask) {
        const canvas = document.createElement('canvas');
        const width = image.naturalWidth || image.width;
        const height = image.naturalHeight || image.height;
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0);

        const imageData = ctx.getImageData(0, 0, width, height);
        const maskData = mask.data;

        for (let i = 0; i < maskData.length; i++) {
            const idx = i * 4;
            // 如果不在 mask 内，设置透明
            if (!maskData[i]) {
                imageData.data[idx + 3] = 0;
            }
        }

        return imageData;
    }

    /**
     * 检查是否是同一张图片
     */
    clearCache() {
        this._sendMessage('clearCache', {}).catch(() => { });
    }

    terminate() {
        if (!this.worker) return;
        this.worker.terminate();
        this.worker = null;

        for (const pending of this.pendingRequests.values()) {
            pending.reject(new Error('Worker terminated'));
        }
        this.pendingRequests.clear();

        this.isReady = false;
        this.isLoading = false;
        this.useLocalModel = false;
    }
}

// 单例 & 导出到全局
const samSegmenter = new SamSegmenter();
window.SamSegmenter = SamSegmenter;
window.samSegmenter = samSegmenter;

export { SamSegmenter };
export default samSegmenter;
