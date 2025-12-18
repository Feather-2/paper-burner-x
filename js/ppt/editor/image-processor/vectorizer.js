/**
 * 图片矢量化模块
 * 优先使用新版 Vectorizer (ES Module)，备选 PotraceCore/ImageTracer
 */

class ImageVectorizer {
    constructor() {
        this.engine = null;
        this.vectortracer = null;
        this.vectorizerModule = null;  // 新版模块化引擎
        this._simplifyPathD = null;    // 路径简化函数（来自 vecburner/path-simplifier.js）
        this._simplifyPathDLoading = null;
        
        // Web Worker 支持
        this.worker = null;
        this.workerReady = false;
        this.workerPending = new Map(); // id -> { resolve, reject, onProgress }
        this.workerId = 0;
        
        // VectorTracer CDN (visioncortex WASM 绑定)
        this.vectortracerCdn = 'https://cdn.jsdelivr.net/npm/vectortracer@0.1.2/pkg/vectortracer.js';
        // Vecburner 本地路径 (旧版，备用)
        this.vecburnerUrl = './js/ppt/editor/image-processor/vecburner.js';
        // ImageTracer CDN (备选)
        this.imagetracerCdn = 'https://cdn.jsdelivr.net/npm/imagetracerjs@1.2.6/imagetracer_v1.2.6.js';
    }
    
    /**
     * 初始化 Web Worker
     */
    async initWorker() {
        if (this.worker) return this.workerReady;
        
        return new Promise((resolve) => {
            try {
                // 使用模块类型的 Worker
                this.worker = new Worker(
                    './js/ppt/editor/image-processor/vectorize-worker.js',
                    { type: 'module' }
                );
                
                this.worker.onmessage = (e) => {
                    const { type, id, ...data } = e.data;
                    
                    if (type === 'ready') {
                        this.workerReady = true;
                        console.log('[ImageVectorizer] ✓ Worker 已就绪');
                        resolve(true);
                        return;
                    }
                    
                    const pending = this.workerPending.get(id);
                    if (!pending) return;
                    
                    if (type === 'progress') {
                        if (pending.onProgress) {
                            pending.onProgress(data.progress, data.message);
                        }
                    } else if (type === 'result') {
                        this.workerPending.delete(id);
                        if (data.success) {
                            pending.resolve(data.result);
                        } else {
                            pending.reject(new Error(data.error));
                        }
                    }
                };
                
                this.worker.onerror = (err) => {
                    console.warn('[ImageVectorizer] Worker 错误:', err);
                    this.workerReady = false;
                    resolve(false);
                };
                
                // 超时检测
                setTimeout(() => {
                    if (!this.workerReady) {
                        console.warn('[ImageVectorizer] Worker 初始化超时');
                        resolve(false);
                    }
                }, 5000);
                
            } catch (e) {
                console.warn('[ImageVectorizer] Worker 创建失败:', e);
                resolve(false);
            }
        });
    }
    
    /**
     * 使用 Worker 进行矢量化
     */
    vectorizeWithWorker(imageObj, preset = 'auto', onProgress = null) {
        return new Promise((resolve, reject) => {
            if (!this.worker || !this.workerReady) {
                reject(new Error('Worker 未就绪'));
                return;
            }
            
            const id = ++this.workerId;
            this.workerPending.set(id, { resolve, reject, onProgress });
            
            // 将 ImageData 转为可传输的 ArrayBuffer
            const imageData = imageObj.imageData;
            const buffer = imageData.data.buffer.slice(0);
            
            this.worker.postMessage({
                type: 'vectorize',
                id,
                payload: {
                    imageDataBuffer: buffer,
                    width: imageData.width,
                    height: imageData.height,
                    preset
                }
            }, [buffer]);
        });
    }

    /**
     * 加载矢量化引擎
     */
    async load() {
        if (this.engine) return;

        // 1. 优先使用 Vecburner (稳定版)
        try {
            await this._loadScript(this.vecburnerUrl);
            if (window.Vecburner || window.PotraceCore) {
                this.engine = 'vecburner';
                console.log('[ImageVectorizer] ✓ Vecburner 已加载');
                return;
            }
        } catch (e) {
            console.warn('[ImageVectorizer] Vecburner 加载失败:', e.message);
        }

        // 2. 备选 VectorTracer (visioncortex WASM)
        try {
            this.vectortracer = await this._loadVectorTracer();
            this.engine = 'vectortracer';
            console.log('[ImageVectorizer] ✓ VectorTracer (visioncortex WASM) 已加载');
            return;
        } catch (e) {
            console.warn('[ImageVectorizer] VectorTracer 加载失败:', e.message);
        }
        
        // 3. 备选新版 Vectorizer (ES Module) - 待调试
        try {
            this.vectorizerModule = await import('./vectorizer/index.js');
            this.engine = 'vectorizer';
            console.log('[ImageVectorizer] ✓ Vectorizer (新版模块化) 已加载');
            return;
        } catch (e) {
            console.warn('[ImageVectorizer] Vectorizer 加载失败:', e.message);
        }

        // 4. 最后备选 ImageTracer
        try {
            await this._loadScript(this.imagetracerCdn);
            this.engine = 'imagetracer';
            console.log('[ImageVectorizer] ✓ ImageTracer 已加载');
        } catch (e) {
            throw new Error('矢量化引擎加载失败');
        }
    }
    
    /**
     * 加载 VectorTracer WASM 模块
     */
    async _loadVectorTracer() {
        // 动态 import ES Module
        const module = await import(this.vectortracerCdn);
        await module.default(); // init WASM
        return module;
    }
    
    /**
     * 加载 VTracer iframe
     */
    _loadVTracerIframe() {
        return new Promise((resolve, reject) => {
            // 创建隐藏的 iframe
            const iframe = document.createElement('iframe');
            iframe.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;';
            iframe.src = this.vtracerBridgeUrl;
            
            const timeout = setTimeout(() => {
                reject(new Error('VTracer 加载超时'));
            }, 10000);
            
            const messageHandler = (event) => {
                if (event.data.type === 'bridge-ready') {
                    clearTimeout(timeout);
                    window.removeEventListener('message', messageHandler);
                    this.vtracerIframe = iframe;
                    this.vtracerReady = true;
                    resolve();
                }
            };
            
            window.addEventListener('message', messageHandler);
            document.body.appendChild(iframe);
        });
    }

    _loadScript(url) {
        return new Promise((resolve, reject) => {
            // 检查是否已加载
            const existing = document.querySelector(`script[src*="${url.split('/').pop()}"]`);
            if (existing) {
                resolve();
                return;
            }
            const script = document.createElement('script');
            script.src = url;
            script.onload = resolve;
            script.onerror = () => reject(new Error(`加载失败: ${url}`));
            document.head.appendChild(script);
        });
    }

    /**
     * 矢量化图片
     * @param {Object} imageObj - 图片对象 {imageData, width, height}
     * @param {string} preset - 预设名称
     *   - 'auto': 自动分析选择最佳预设
     *   - 'smart': 智能模式，自动选择全图或分块
     *   - 'blocks': 分块模式，适合文字+图形混合内容
     *   - 其他: logo, lineart, illustration, photo, pixel 等
     * @param {Function} onProgress - 进度回调 (progress: 0-100, message: string)
     */
    async vectorize(imageObj, preset = 'auto', onProgress = null) {
        // 尝试使用 Worker（不阻塞 UI）
        if (!this.worker) {
            await this.initWorker();
        }
        
        if (this.workerReady && preset !== 'blocks' && preset !== 'smart') {
            try {
                console.log(`[ImageVectorizer] 使用 Worker, 预设: ${preset}`);
                return await this.vectorizeWithWorker(imageObj, preset, onProgress);
            } catch (e) {
                console.warn('[ImageVectorizer] Worker 执行失败，回退到主线程:', e.message);
            }
        }
        
        // 回退到主线程处理
        await this.load();

        console.log(`[ImageVectorizer] 使用 ${this.engine} (主线程), 预设: ${preset}`);

        // 特殊模式：分块矢量化（适合复杂图像如文字+图形）
        if (preset === 'blocks' || preset === 'smart') {
            const engine = window.Vecburner || window.PotraceCore;
            if (this.engine === 'vecburner' && engine) {
                if (preset === 'smart') {
                    return engine.vectorizeSmart(imageObj.imageData);
                } else {
                    return engine.vectorizeByBlocks(imageObj.imageData);
                }
            }
            // 其他引擎回退到 auto
            console.warn(`[ImageVectorizer] ${this.engine} 不支持 ${preset} 模式，回退到 auto`);
            preset = 'auto';
        }

        // 1. 新版 Vectorizer (ES Module)
        if (this.engine === 'vectorizer') {
            const { Vectorizer } = this.vectorizerModule;
            return Vectorizer.vectorizeWithPreset(imageObj.imageData, preset);
        }
        
        // 2. VectorTracer (visioncortex WASM) - 不支持 auto
        if (this.engine === 'vectortracer') {
            const actualPreset = preset === 'auto' ? 'illustration' : preset;
            return this._vectorizeWithVectorTracer(imageObj, actualPreset);
        }
        
        // 3. Vecburner - 支持 auto 模式
        if (this.engine === 'vecburner') {
            const engine = window.Vecburner || window.PotraceCore;
            return engine.vectorizeWithPreset(imageObj.imageData, preset);
        }
        
        // 4. ImageTracer 备选 - 不支持 auto
        const actualPreset = preset === 'auto' ? 'illustration' : preset;
        const config = this._getImageTracerConfig(actualPreset);
        const svgString = ImageTracer.imagedataToSVG(imageObj.imageData, config);
        return this._parseSvgResult(svgString, imageObj.width, imageObj.height);
    }
    
    /**
     * 使用 VectorTracer (visioncortex WASM) 矢量化
     */
    async _vectorizeWithVectorTracer(imageObj, preset) {
        const { trace } = this.vectortracer;
        
        // VectorTracer 配置 (参考 visioncortex 参数)
        const configs = {
            logo: {
                colorPrecision: 6,
                layerDifference: 16,
                filterSpeckle: 4,
                cornerThreshold: 60,
                lengthThreshold: 4.0,
                spliceThreshold: 45,
                mode: 'spline'
            },
            illustration: {
                colorPrecision: 6,
                layerDifference: 25,
                filterSpeckle: 4,
                cornerThreshold: 60,
                lengthThreshold: 4.0,
                spliceThreshold: 45,
                mode: 'spline'
            },
            lineart: {
                colorPrecision: 6,
                layerDifference: 16,
                filterSpeckle: 2,
                cornerThreshold: 60,
                lengthThreshold: 4.0,
                spliceThreshold: 45,
                mode: 'spline'
            },
            pixel: {
                colorPrecision: 8,       // 更多颜色层
                layerDifference: 8,      // 更小的层差异，捕捉更多颜色
                filterSpeckle: 1,        // 保留小区域
                cornerThreshold: 90,     // 更锐利的角
                lengthThreshold: 2.0,    // 更短的线段
                spliceThreshold: 60,
                mode: 'spline'
            },
            photo: {
                colorPrecision: 8,
                layerDifference: 28,
                filterSpeckle: 4,
                cornerThreshold: 60,
                lengthThreshold: 4.0,
                spliceThreshold: 45,
                mode: 'spline'
            },
            simple: {
                colorPrecision: 4,
                layerDifference: 32,
                filterSpeckle: 8,
                cornerThreshold: 60,
                lengthThreshold: 4.0,
                spliceThreshold: 45,
                mode: 'polygon'
            }
        };
        
        const config = configs[preset] || configs.logo;
        const { width, height, imageData } = imageObj;
        
        // 调用 visioncortex WASM
        const svgString = trace(imageData, config);
        
        return this._parseSvgResult(svgString, width, height);
    }
    
    /**
     * 使用 VTracer iframe 矢量化
     */
    async _vectorizeWithVTracer(imageObj, preset) {
        // 将 ImageData 转为 DataURL
        const canvas = document.createElement('canvas');
        canvas.width = imageObj.width;
        canvas.height = imageObj.height;
        const ctx = canvas.getContext('2d');
        ctx.putImageData(imageObj.imageData, 0, 0);
        const dataUrl = canvas.toDataURL('image/png');
        
        // VTracer 配置
        const vtracerConfigs = {
            logo: { color_precision: 6, layer_difference: 16, filter_speckle: 4 },
            illustration: { color_precision: 6, layer_difference: 25, filter_speckle: 4 },
            lineart: { color_precision: 6, layer_difference: 16, filter_speckle: 2 },
            pixel: { color_precision: 8, layer_difference: 8, filter_speckle: 1 },
            photo: { color_precision: 8, layer_difference: 28, filter_speckle: 4 },
            simple: { color_precision: 4, layer_difference: 32, filter_speckle: 8 }
        };
        const config = vtracerConfigs[preset] || vtracerConfigs.logo;
        
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('VTracer 处理超时'));
            }, 30000);
            
            const messageHandler = (event) => {
                if (event.data.type === 'vectorize-result') {
                    clearTimeout(timeout);
                    window.removeEventListener('message', messageHandler);
                    
                    if (event.data.success) {
                        const result = this._parseSvgResult(event.data.svg, imageObj.width, imageObj.height);
                        resolve(result);
                    } else {
                        reject(new Error(event.data.error));
                    }
                }
            };
            
            window.addEventListener('message', messageHandler);
            this.vtracerIframe.contentWindow.postMessage({
                type: 'vectorize',
                data: dataUrl,
                config: config
            }, '*');
        });
    }
    
    _getImageTracerConfig(preset) {
        const configs = {
            logo: { colorsampling: 0, numberofcolors: 24, ltres: 0.5, qtres: 0.5, pathomit: 2 },
            illustration: { colorsampling: 1, numberofcolors: 48, ltres: 0.3, qtres: 0.3, pathomit: 1 },
            lineart: { colorsampling: 0, numberofcolors: 2, ltres: 0.2, qtres: 0.2, strokewidth: 1 },
            photo: { colorsampling: 2, numberofcolors: 128, ltres: 0.2, qtres: 0.2, blurradius: 1 },
            simple: { colorsampling: 0, numberofcolors: 8, pathomit: 8, ltres: 2, qtres: 2 }
        };
        return configs[preset] || configs.logo;
    }

    /**
     * 解析 SVG 结果
     */
    _parseSvgResult(svgString, width, height) {
        const parser = new DOMParser();
        const svgDoc = parser.parseFromString(svgString, 'image/svg+xml');
        const svgElement = svgDoc.querySelector('svg');

        const paths = [];
        const colors = new Set();

        svgElement.querySelectorAll('path').forEach((path, idx) => {
            const fill = path.getAttribute('fill') || 'none';
            const stroke = path.getAttribute('stroke') || 'none';
            const d = path.getAttribute('d') || '';

            if (fill !== 'none') colors.add(fill);
            if (stroke !== 'none') colors.add(stroke);

            paths.push({
                id: `path_${idx}`,
                d: d,
                fill: fill,
                stroke: stroke,
                strokeWidth: path.getAttribute('stroke-width') || 0
            });
        });

        console.log(`[ImageVectorizer] 生成 ${paths.length} 条路径, ${colors.size} 种颜色`);

        return {
            svg: svgString,
            svgElement: svgElement,
            paths: paths,
            colors: Array.from(colors),
            width: width,
            height: height,
            engine: this.engine
        };
    }

    /**
     * 按颜色分层
     * @param {Object} vectorResult - vectorize 的返回结果
     * @returns {Array} 按颜色分组的图层
     */
    splitByColor(vectorResult) {
        // 获取尺寸：viewBox 使用路径坐标范围，width/height 使用显示尺寸
        const displayWidth = vectorResult.width;
        const displayHeight = vectorResult.height;
        const viewBoxWidth = vectorResult.viewBoxWidth || displayWidth;
        const viewBoxHeight = vectorResult.viewBoxHeight || displayHeight;
        
        // Vecburner 已经返回 layers 结构
        if (vectorResult.layers && vectorResult.layers.length > 0) {
            return vectorResult.layers.map((layer, idx) => ({
                id: `color_layer_${idx}_${Date.now()}`,
                name: `颜色 ${layer.color}`,
                color: layer.color,
                paths: layer.paths,
                visible: true,
                svg: this._generateColorSvg(layer.paths, displayWidth, displayHeight, viewBoxWidth, viewBoxHeight)
            }));
        }
        
        // ImageTracer 需要手动分组
        const colorGroups = {};
        if (!vectorResult.paths) return [];

        vectorResult.paths.forEach(path => {
            const color = path.fill !== 'none' ? path.fill : path.stroke;
            if (!color || color === 'none') return;
            
            if (!colorGroups[color]) {
                colorGroups[color] = {
                    color: color,
                    paths: []
                };
            }
            colorGroups[color].paths.push(path);
        });

        return Object.values(colorGroups).map((group, idx) => ({
            id: `color_layer_${idx}_${Date.now()}`,
            name: `颜色 ${group.color}`,
            color: group.color,
            paths: group.paths,
            visible: true,
            svg: this._generateColorSvg(group.paths, displayWidth, displayHeight, viewBoxWidth, viewBoxHeight)
        }));
    }

    /**
     * 为一组路径生成 SVG
     * @param {Array} paths - 路径数组
     * @param {number} displayWidth - 显示宽度
     * @param {number} displayHeight - 显示高度
     * @param {number} viewBoxWidth - viewBox 宽度（路径坐标范围）
     * @param {number} viewBoxHeight - viewBox 高度
     */
    _generateColorSvg(paths, displayWidth, displayHeight, viewBoxWidth, viewBoxHeight) {
        const pathsStr = paths.map(p => {
            const fillRule = p.fillRule ? ` fill-rule="${p.fillRule}"` : '';
            return `<path d="${p.d}" fill="${p.fill}"${fillRule} stroke="${p.stroke}" stroke-width="${p.strokeWidth || 0}"/>`;
        }).join('\n');

        // width/height 控制显示尺寸，viewBox 控制路径坐标映射
        return `<svg xmlns="http://www.w3.org/2000/svg" width="${displayWidth}" height="${displayHeight}" viewBox="0 0 ${viewBoxWidth} ${viewBoxHeight}">
${pathsStr}
</svg>`;
    }

    /**
     * 简化路径（减少点数）
     * @param {string} pathD - SVG path d 属性
     * @param {number} tolerance - 简化容差
     */
    _ensureSimplifyPathD() {
        if (this._simplifyPathD) return;
        if (this._simplifyPathDLoading) return;

        this._simplifyPathDLoading = import('./vecburner/path-simplifier.js')
            .then(({ simplifyPathD }) => {
                this._simplifyPathD = simplifyPathD;
            })
            .catch((e) => {
                console.warn('[ImageVectorizer] path-simplifier 懒加载失败:', e.message);
            })
            .finally(() => {
                this._simplifyPathDLoading = null;
            });
    }

    simplifyPath(pathD, tolerance = 1) {
        // 复用已有的路径简化实现（支持多子路径/曲线采样）
        if (!this._simplifyPathD) {
            // 懒加载：允许用户直接调用 simplifyPath()，无需先 load()
            this._ensureSimplifyPathD();
            return pathD;
        }

        const level = Number.isFinite(tolerance) ? tolerance : 1;
        const clampedLevel = Math.max(0, Math.min(100, level));

        try {
            return this._simplifyPathD(pathD, clampedLevel);
        } catch (e) {
            console.warn('[ImageVectorizer] simplifyPath 失败:', e.message);
            return pathD;
        }
    }

    /**
     * 合并相近颜色
     */
    mergeColors(vectorResult, threshold = 30) {
        // 颜色距离计算
        const colorDistance = (c1, c2) => {
            const rgb1 = this._parseColor(c1);
            const rgb2 = this._parseColor(c2);
            if (!rgb1 || !rgb2) return Infinity;
            return Math.sqrt(
                Math.pow(rgb1.r - rgb2.r, 2) +
                Math.pow(rgb1.g - rgb2.g, 2) +
                Math.pow(rgb1.b - rgb2.b, 2)
            );
        };

        // 找出需要合并的颜色
        const colors = [...vectorResult.colors];
        const mergeMap = {};

        for (let i = 0; i < colors.length; i++) {
            for (let j = i + 1; j < colors.length; j++) {
                if (colorDistance(colors[i], colors[j]) < threshold) {
                    mergeMap[colors[j]] = colors[i];
                }
            }
        }

        // 应用合并
        const mergedPaths = vectorResult.paths.map(path => ({
            ...path,
            fill: mergeMap[path.fill] || path.fill,
            stroke: mergeMap[path.stroke] || path.stroke
        }));

        return {
            ...vectorResult,
            paths: mergedPaths,
            colors: colors.filter(c => !mergeMap[c])
        };
    }

    _parseColor(colorStr) {
        if (!colorStr || colorStr === 'none') return null;

        // 处理 rgb() 格式
        const rgbMatch = colorStr.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        if (rgbMatch) {
            return { r: parseInt(rgbMatch[1]), g: parseInt(rgbMatch[2]), b: parseInt(rgbMatch[3]) };
        }

        // 处理 #hex 格式
        const hexMatch = colorStr.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
        if (hexMatch) {
            return { 
                r: parseInt(hexMatch[1], 16), 
                g: parseInt(hexMatch[2], 16), 
                b: parseInt(hexMatch[3], 16) 
            };
        }

        return null;
    }
}

// 单例 & 导出到全局
const imageVectorizer = new ImageVectorizer();
window.ImageVectorizer = ImageVectorizer;
window.imageVectorizer = imageVectorizer;
