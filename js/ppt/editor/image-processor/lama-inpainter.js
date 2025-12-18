/**
 * LaMa Inpainter - 主线程代理
 * 通过 Web Worker 执行实际的模型加载和推理，避免阻塞主线程
 */

class LamaInpainter {
    constructor() {
        this.worker = null;
        this.pendingRequests = new Map();
        this.requestId = 0;
        this.isReady = false;
        this.isLoading = false;
        this.useLocalModel = false;

        this.config = {
            localModelPath: 'models/lama/',
            modelFileName: 'lama_fp32.onnx',
            onlineModelUrl: 'https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx',
        };

        this.onProgress = null;
        this._onFallback = null;
    }

    _normalizeConfig() {
        if (this.config.localModelPath && !this.config.localModelPath.endsWith('/')) {
            this.config.localModelPath += '/';
        }
    }

    _initWorker() {
        if (this.worker) return;

        const workerUrl = new URL('./lama-inpainter-worker.js', import.meta.url);
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

            if (type === 'success') pending.resolve(result);
            else pending.reject(new Error(error));
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

    async init(progressCallback, forceReload = false) {
        this._normalizeConfig();
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

    async inpaint(image, mask) {
        if (!this.isReady) await this.init(this.onProgress);

        const imageData = await this._toImageData(image);
        const normalizedMask = this._normalizeMask(mask, imageData.width, imageData.height);

        const transferables = [imageData.data.buffer];
        if (normalizedMask.data?.buffer) transferables.push(normalizedMask.data.buffer);

        const result = await this._sendMessage('inpaint', {
            imageData,
            mask: normalizedMask,
        }, transferables);

        return result?.imageData || result;
    }

    clearCache() {
        this._sendMessage('clearCache', {}).catch(() => { });
        this.isReady = false;
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

    async _toImageData(image) {
        if (image instanceof ImageData) return image;

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        if (image instanceof HTMLCanvasElement) {
            canvas.width = image.width;
            canvas.height = image.height;
            ctx.drawImage(image, 0, 0);
            return ctx.getImageData(0, 0, canvas.width, canvas.height);
        }

        if (image instanceof HTMLImageElement) {
            canvas.width = image.naturalWidth || image.width;
            canvas.height = image.naturalHeight || image.height;
            ctx.drawImage(image, 0, 0);
            return ctx.getImageData(0, 0, canvas.width, canvas.height);
        }

        throw new Error('不支持的图片类型');
    }

    _normalizeMask(mask, fallbackWidth, fallbackHeight) {
        if (!mask || !mask.data) throw new Error('mask.data 不能为空');

        const width = mask.width || fallbackWidth;
        const height = mask.height || fallbackHeight;
        if (!width || !height) throw new Error('mask.width/mask.height 不能为空');

        let data = mask.data;
        if (Array.isArray(data)) {
            // boolean[] -> Uint8Array(0/255)
            const arr = new Uint8Array(width * height);
            for (let i = 0; i < arr.length; i++) arr[i] = data[i] ? 255 : 0;
            data = arr;
        } else if (data instanceof Uint8ClampedArray) {
            data = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        } else if (!(data instanceof Uint8Array)) {
            // 兜底：尝试构造 Uint8Array 视图
            data = new Uint8Array(data.buffer);
        }

        // 确保长度匹配
        if (data.length !== width * height) {
            // 允许比期望更大（例如带 stride），截断到需要的长度
            if (data.length < width * height) throw new Error('mask.data 长度不足');
            data = data.slice(0, width * height);
        }

        return { data, width, height };
    }
}

// 单例导出
const lamaInpainter = new LamaInpainter();
window.LamaInpainter = LamaInpainter;
window.lamaInpainter = lamaInpainter;

export { LamaInpainter };
export default lamaInpainter;

