/**
 * 矢量化 Web Worker
 * 将 CPU 密集型的矢量化操作移到后台线程
 */

// 获取 Worker 脚本的基础路径
const workerUrl = new URL(import.meta.url);
const basePath = workerUrl.href.substring(0, workerUrl.href.lastIndexOf('/') + 1);

// 动态导入 Vecburner 模块
let Vecburner = null;
let libsLoaded = false;

// 加载 CDN 依赖（使用动态 import 加载 ESM 版本）
async function loadCdnLibs() {
    if (libsLoaded) return;
    
    try {
        // fit-curve 库 - 使用 jsdelivr 的 ESM 版本
        const fitCurveModule = await import('https://cdn.jsdelivr.net/npm/fit-curve@0.2.0/+esm');
        // 挂载到 self 上，让 PotraceCore 可以访问
        self.fitCurve = fitCurveModule.default || fitCurveModule.fitCurve;
        console.log('[VectorizeWorker] fit-curve 已加载 (ESM)');
        libsLoaded = true;
    } catch (e) {
        console.warn('[VectorizeWorker] fit-curve 加载失败，使用内置算法:', e.message);
    }
}

async function loadVecburner() {
    if (Vecburner) return Vecburner;
    
    // 先加载依赖库
    await loadCdnLibs();
    
    try {
        // Worker 中使用绝对路径导入模块
        const moduleUrl = new URL('./vecburner/index.js', basePath).href;
        const module = await import(moduleUrl);
        Vecburner = module.Vecburner || module.PotraceCore || module;
        console.log('[VectorizeWorker] Vecburner 已加载');
        return Vecburner;
    } catch (e) {
        console.error('[VectorizeWorker] 加载 Vecburner 失败:', e);
        throw e;
    }
}

// 处理消息
self.onmessage = async function(e) {
    const { type, id, payload } = e.data;
    
    try {
        switch (type) {
            case 'vectorize': {
                // 发送进度更新
                self.postMessage({ type: 'progress', id, progress: 0, message: '加载引擎...' });
                
                const core = await loadVecburner();
                
                self.postMessage({ type: 'progress', id, progress: 10, message: '开始矢量化...' });
                
                // 从传入的数据重建 ImageData
                const { imageDataBuffer, width, height, preset } = payload;
                const imageData = new ImageData(
                    new Uint8ClampedArray(imageDataBuffer),
                    width,
                    height
                );
                
                self.postMessage({ type: 'progress', id, progress: 20, message: '颜色分析...' });
                
                // 执行矢量化
                const result = await core.vectorizeWithPreset(imageData, preset);
                
                self.postMessage({ type: 'progress', id, progress: 90, message: '生成结果...' });
                
                // 返回结果
                self.postMessage({
                    type: 'result',
                    id,
                    success: true,
                    result: {
                        svg: result.svg,
                        width: result.width,
                        height: result.height,
                        viewBoxWidth: result.viewBoxWidth,
                        viewBoxHeight: result.viewBoxHeight,
                        layers: result.layers,
                        paths: result.paths,
                        colors: result.colors,
                        engine: result.engine
                    }
                });
                break;
            }
            
            default:
                throw new Error(`未知的消息类型: ${type}`);
        }
    } catch (err) {
        self.postMessage({
            type: 'result',
            id,
            success: false,
            error: err.message || String(err)
        });
    }
};

// Worker 就绪
self.postMessage({ type: 'ready' });
