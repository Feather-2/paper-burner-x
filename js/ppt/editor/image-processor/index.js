/**
 * 图片智能处理模块 - 入口
 * 
 * 功能：
 * 1. 矢量化并分层 (ImageTracer.js)
 * 2. OCR 识别文字 (MinerU 优先 / VLM 备选)
 * 3. 背景去除
 * 4. 分层编辑
 * 
 * 特点：
 * - 按需加载 CDN 库
 * - 与 SlideEditor 紧密集成
 * - 结果持久化到 IndexedDB
 */

class ImageProcessor {
    constructor() {
        // 模块加载状态
        this.modules = {
            vectorizer: null,
            ocrExtractor: null,
            bgRemover: null,
            layerEditor: null
        };

        // 配置
        this.config = {
            // OCR 优先级：mineru > vlm
            ocrPriority: 'mineru',
            // 矢量化预设
            vectorizePreset: 'logo'
        };

        // 加载用户配置
        this._loadConfig();
    }

    /**
     * 加载用户配置
     */
    _loadConfig() {
        try {
            const settings = typeof loadSettings === 'function' ? loadSettings() : {};
            if (settings.imageProcessor) {
                Object.assign(this.config, settings.imageProcessor);
            }
        } catch (e) {
            console.warn('[ImageProcessor] 加载配置失败:', e);
        }
    }

    /**
     * 保存配置
     */
    saveConfig(newConfig) {
        Object.assign(this.config, newConfig);
        try {
            const settings = typeof loadSettings === 'function' ? loadSettings() : {};
            settings.imageProcessor = this.config;
            if (typeof saveSettings === 'function') {
                saveSettings(settings);
            }
        } catch (e) {
            console.warn('[ImageProcessor] 保存配置失败:', e);
        }
    }

    /**
     * 获取 OCR 可用性
     */
    getOcrAvailability() {
        const settings = typeof loadSettings === 'function' ? loadSettings() : {};
        
        // MinerU 可用性
        const mineruAvailable = !!(
            settings.mineruWorkerUrl && 
            (settings.mineruToken || settings.mineruTokenMode === 'worker')
        );

        // VLM 可用性 (支持视觉的模型)
        const visionModels = ['gpt-4-vision', 'gpt-4o', 'claude-3', 'gemini'];
        const currentModel = settings.translationModel || '';
        const vlmAvailable = visionModels.some(v => currentModel.toLowerCase().includes(v));

        return {
            mineru: mineruAvailable,
            vlm: vlmAvailable,
            preferred: this.config.ocrPriority,
            any: mineruAvailable || vlmAvailable
        };
    }

    /**
     * 懒加载模块
     */
    async loadModule(name) {
        if (this.modules[name]) {
            return this.modules[name];
        }

        const scriptMap = {
            vectorizer: 'js/ppt/editor/image-processor/vectorizer.js',
            ocrExtractor: 'js/ppt/editor/image-processor/ocr-extractor.js',
            bgRemover: 'js/ppt/editor/image-processor/background-remover.js',
            layerEditor: 'js/ppt/editor/image-processor/layer-editor.js'
        };

        const globalMap = {
            vectorizer: 'imageVectorizer',
            ocrExtractor: 'ocrExtractor',
            bgRemover: 'backgroundRemover',
            layerEditor: 'LayerEditor'
        };

        if (!scriptMap[name]) {
            throw new Error(`未知模块: ${name}`);
        }

        // 检查是否已在全局
        if (window[globalMap[name]]) {
            this.modules[name] = window[globalMap[name]];
            return this.modules[name];
        }

        // 动态加载脚本
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = scriptMap[name];
            script.onload = async () => {
                // 特殊处理：layerEditor 使用动态 import，需要等待 Ready Promise
                if (name === 'layerEditor' && window.LayerEditorReady) {
                    await window.LayerEditorReady;
                }
                this.modules[name] = window[globalMap[name]];
                console.log(`[ImageProcessor] 模块 ${name} 加载完成`);
                resolve(this.modules[name]);
            };
            script.onerror = () => {
                console.error(`[ImageProcessor] 模块 ${name} 加载失败`);
                reject(new Error(`模块加载失败: ${name}`));
            };
            document.head.appendChild(script);
        });
    }

    /**
     * 处理图片 - 完整流程
     * @param {string|Blob|HTMLImageElement} imageSource - 图片源
     * @param {Object} options - 处理选项
     * @returns {Promise<ProcessedImage>} 处理结果
     */
    async processImage(imageSource, options = {}) {
        const result = {
            id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            original: null,
            layers: [],
            textRegions: [],
            meta: {}
        };

        // 1. 加载原始图片
        result.original = await this._loadImage(imageSource);
        result.meta = {
            width: result.original.width,
            height: result.original.height,
            processedAt: Date.now()
        };

        // 2. 矢量化（如果启用）
        if (options.vectorize !== false) {
            try {
                const vectorizer = await this.loadModule('vectorizer');
                const vectorResult = await vectorizer.vectorize(result.original, options.vectorizePreset || this.config.vectorizePreset);
                result.layers.push({
                    id: `layer_vector_${Date.now()}`,
                    type: 'vector',
                    name: '矢量图层',
                    svg: vectorResult.svg,
                    paths: vectorResult.paths,
                    visible: true
                });
            } catch (e) {
                console.warn('[ImageProcessor] 矢量化失败:', e);
            }
        }

        // 3. OCR 识别（如果启用）
        if (options.ocr !== false) {
            try {
                const ocrExtractor = await this.loadModule('ocrExtractor');
                const ocrResult = await ocrExtractor.extract(result.original, {
                    priority: this.config.ocrPriority
                });
                result.textRegions = ocrResult.regions;
                
                // 为每个文字区域创建图层
                ocrResult.regions.forEach((region, idx) => {
                    result.layers.push({
                        id: `layer_text_${idx}_${Date.now()}`,
                        type: 'text',
                        name: `文字 ${idx + 1}`,
                        bbox: region.bbox,
                        content: region.text,
                        style: region.style,
                        visible: true
                    });
                });
            } catch (e) {
                console.warn('[ImageProcessor] OCR 识别失败:', e);
            }
        }

        // 4. 背景去除（如果启用）
        if (options.removeBackground) {
            try {
                const bgRemover = await this.loadModule('bgRemover');
                const bgResult = await bgRemover.remove(result.original);
                result.layers.push({
                    id: `layer_bg_${Date.now()}`,
                    type: 'background',
                    name: '背景',
                    mask: bgResult.mask,
                    removed: true,
                    visible: false
                });
                result.layers.push({
                    id: `layer_fg_${Date.now()}`,
                    type: 'foreground',
                    name: '前景',
                    imageData: bgResult.foreground,
                    visible: true
                });
            } catch (e) {
                console.warn('[ImageProcessor] 背景去除失败:', e);
            }
        }

        return result;
    }

    /**
     * 加载图片为 ImageData
     */
    async _loadImage(source) {
        let img;

        if (source instanceof HTMLImageElement) {
            img = source;
        } else if (source instanceof Blob) {
            img = await this._blobToImage(source);
        } else if (typeof source === 'string') {
            img = await this._urlToImage(source);
        } else {
            throw new Error('不支持的图片源类型');
        }

        // 转换为 Canvas 以获取 ImageData
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        return {
            element: img,
            canvas: canvas,
            ctx: ctx,
            width: canvas.width,
            height: canvas.height,
            imageData: ctx.getImageData(0, 0, canvas.width, canvas.height),
            dataUrl: canvas.toDataURL('image/png')
        };
    }

    _blobToImage(blob) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                URL.revokeObjectURL(img.src);
                resolve(img);
            };
            img.onerror = reject;
            img.src = URL.createObjectURL(blob);
        });
    }

    _urlToImage(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = url;
        });
    }

    /**
     * 打开图片编辑页面
     * @param {Object} slideElement - PPT 中的图片元素
     * @param {Function} onUpdate - 更新回调
     */
    async openEditor(slideElement, onUpdate) {
        // 懒加载编辑器模块
        const LayerEditor = await this.loadModule('layerEditor');
        
        // 创建编辑器实例
        const editor = new LayerEditor({
            element: slideElement,
            processor: this,
            onSave: async (result) => {
                // 保存到 IndexedDB
                await this.saveProcessedImage(result);
                // 回调更新 PPT
                onUpdate?.(result);
            }
        });

        // 打开编辑页面
        editor.open();
        
        return editor;
    }

    /**
     * 保存处理后的图片到 IndexedDB
     * 注：pptStorage 目前不支持 saveResource，此功能暂时跳过
     */
    async saveProcessedImage(processedImage) {
        // pptStorage 目前只支持项目级别的存储
        // 图片处理结果暂时不持久化
        console.log('[ImageProcessor] 图片处理完成 (未持久化):', processedImage.id);
    }

    /**
     * 加载处理后的图片
     * 注：pptStorage 目前不支持 getResource，此功能暂时返回 null
     */
    async loadProcessedImage(imageId) {
        // pptStorage 目前只支持项目级别的存储
        return null;
    }
}

// 单例 & 导出到全局
const imageProcessor = new ImageProcessor();
window.ImageProcessor = ImageProcessor;
window.imageProcessor = imageProcessor;
