/**
 * LaMa Inpainter Web Worker
 * 在独立线程中执行模型加载和推理（背景修复）
 */

// Worker 状态
let state = {
    session: null,
    isReady: false,
    isLoading: false,
    useLocalModel: false,
    _ortPromise: null,
    _initPromise: null,
    _loadedModelUrl: null,
    config: {
        localModelPath: 'models/lama/',
        modelFileName: 'lama_fp32.onnx',
        onlineModelUrl: 'https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx',
    }
};

// 消息处理
self.onmessage = async (e) => {
    const { id, type, payload } = e.data;

    try {
        let result;
        let transferables = [];

        switch (type) {
            case 'init': {
                result = await handleInit(payload);
                break;
            }
            case 'inpaint': {
                const out = await handleInpaint(payload);
                result = out.result;
                transferables = out.transferables || [];
                break;
            }
            case 'setConfig': {
                Object.assign(state.config, payload || {});
                _normalizeConfig();
                result = { success: true };
                break;
            }
            case 'clearCache': {
                _clearCache();
                result = { success: true };
                break;
            }
            default:
                throw new Error('未知消息类型: ' + type);
        }

        self.postMessage({ id, type: 'success', result }, transferables);
    } catch (error) {
        self.postMessage({ id, type: 'error', error: error?.message || String(error) });
    }
};

function reportProgress(message, percent) {
    self.postMessage({ type: 'progress', message, percent });
}

function reportFallback() {
    self.postMessage({ type: 'fallback' });
}

function _normalizeConfig() {
    if (state.config.localModelPath && !state.config.localModelPath.endsWith('/')) {
        state.config.localModelPath += '/';
    }
}

function _clearCache() {
    state.session = null;
    state.isReady = false;
    state.useLocalModel = false;
    state._loadedModelUrl = null;
    // 注意：不清除 _ortPromise，避免重复加载 ort
}

function _resolveUrl(urlOrPath) {
    try {
        // eslint-disable-next-line no-new
        new URL(urlOrPath);
        return urlOrPath;
    } catch {
        const normalized = urlOrPath.startsWith('/') ? urlOrPath : `/${urlOrPath}`;
        return new URL(normalized, self.location.origin).toString();
    }
}

async function _loadOnnxRuntime() {
    if (self.ort) return self.ort;
    if (state._ortPromise) return state._ortPromise;

    state._ortPromise = (async () => {
        reportProgress('加载 ONNX Runtime...', 5);
        const mod = await import('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/ort.esm.min.js');
        const ort = mod.default || mod;

        if (ort?.env?.wasm) {
            ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/';
        }

        self.ort = ort;
        return ort;
    })();

    return state._ortPromise;
}

async function _headOrGetOk(url) {
    try {
        const resp = await fetch(url, { method: 'HEAD' });
        if (resp.ok) return true;
        if (resp.status !== 405) return false;
        // 部分静态服务器不支持 HEAD，使用 Range 请求避免下载整个大模型
        const resp2 = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' } });
        return resp2.ok || resp2.status === 206;
    } catch {
        return false;
    }
}

async function _checkLocalModel() {
    _normalizeConfig();
    const localUrl = _resolveUrl(state.config.localModelPath + state.config.modelFileName);
    return await _headOrGetOk(localUrl);
}

async function _fetchArrayBufferWithProgress(url, onProgress) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`模型下载失败: ${resp.status} ${resp.statusText}`);

    const contentLengthHeader = resp.headers.get('content-length');
    const total = contentLengthHeader ? Number(contentLengthHeader) : 0;

    if (!resp.body || !resp.body.getReader) {
        const buf = await resp.arrayBuffer();
        onProgress?.(buf.byteLength, buf.byteLength);
        return buf;
    }

    const reader = resp.body.getReader();
    const chunks = [];
    let received = 0;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.byteLength;
        onProgress?.(received, total || 0);
    }

    const merged = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return merged.buffer;
}

async function _createSessionFromUrl(url) {
    const ort = await _loadOnnxRuntime();

    reportProgress('下载 LaMa 模型...', 15);
    const buf = await _fetchArrayBufferWithProgress(url, (received, total) => {
        if (total > 0) {
            const percent = 15 + Math.min(80, Math.round((received / total) * 70));
            reportProgress(`下载 LaMa 模型... ${Math.round((received / total) * 100)}%`, percent);
        } else {
            reportProgress('下载 LaMa 模型...', 40);
        }
    });

    reportProgress('初始化推理会话...', 90);
    const preferredProviders = ['webgpu', 'wasm'];
    try {
        return await ort.InferenceSession.create(buf, { executionProviders: preferredProviders });
    } catch {
        return await ort.InferenceSession.create(buf, { executionProviders: ['wasm'] });
    }
}

async function _ensureSession(forceReload = false) {
    _normalizeConfig();

    if (state.session && state.isReady && !forceReload) return state.session;

    const localUrl = _resolveUrl(state.config.localModelPath + state.config.modelFileName);
    const onlineUrl = state.config.onlineModelUrl;

    reportProgress('检测本地模型...', 8);
    const hasLocal = await _checkLocalModel();
    const targetUrl = hasLocal ? localUrl : onlineUrl;

    if (state._loadedModelUrl === targetUrl && state.session && !forceReload) {
        state.isReady = true;
        state.useLocalModel = hasLocal;
        return state.session;
    }

    // 清理旧 session（释放引用）
    state.session = null;
    state.isReady = false;

    if (hasLocal) {
        reportProgress('使用本地模型加载...', 12);
        try {
            state.session = await _createSessionFromUrl(targetUrl);
            state.useLocalModel = true;
        } catch (err) {
            // 本地模型存在但加载失败，降级到在线模型
            reportFallback();
            reportProgress('本地模型加载失败，切换到在线模型...', 20);
            state.session = await _createSessionFromUrl(onlineUrl);
            state.useLocalModel = false;
        }
    } else {
        // 本地不存在，降级到在线模型
        reportFallback();
        state.session = await _createSessionFromUrl(onlineUrl);
        state.useLocalModel = false;
    }

    state._loadedModelUrl = state.useLocalModel ? localUrl : onlineUrl;
    state.isReady = true;
    reportProgress('LaMa 模型就绪', 100);
    return state.session;
}

async function handleInit(payload = {}) {
    if (state.isReady && !payload.forceReload) {
        return { isReady: true, useLocalModel: state.useLocalModel };
    }
    if (state._initPromise) return await state._initPromise;

    state._initPromise = (async () => {
        if (state.isLoading) return { isReady: state.isReady, useLocalModel: state.useLocalModel };
        state.isLoading = true;
        try {
            await _ensureSession(!!payload.forceReload);
            return { isReady: true, useLocalModel: state.useLocalModel };
        } finally {
            state.isLoading = false;
            state._initPromise = null;
        }
    })();

    return await state._initPromise;
}

function _maskToImageData(mask, width, height) {
    const img = new ImageData(width, height);
    const dst = img.data;
    const src = mask?.data;

    if (!src) throw new Error('mask.data 不能为空');
    if (src.length < width * height) throw new Error('mask.data 长度不足');

    for (let i = 0; i < width * height; i++) {
        const v = src[i] > 127 ? 255 : (src[i] ? 255 : 0);
        const idx = i * 4;
        dst[idx] = v;
        dst[idx + 1] = v;
        dst[idx + 2] = v;
        dst[idx + 3] = 255;
    }
    return img;
}

function _resizeImageData(imageData, width, height, smoothing = true) {
    const srcCanvas = new OffscreenCanvas(imageData.width, imageData.height);
    const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
    srcCtx.putImageData(imageData, 0, 0);

    const dstCanvas = new OffscreenCanvas(width, height);
    const dstCtx = dstCanvas.getContext('2d', { willReadFrequently: true });
    dstCtx.imageSmoothingEnabled = !!smoothing;
    dstCtx.drawImage(srcCanvas, 0, 0, width, height);
    return dstCtx.getImageData(0, 0, width, height);
}

function _prepareInputTensorRGBA(imageData512, maskImageData512) {
    const H = 512;
    const W = 512;
    const imageData = imageData512.data;
    const maskData = maskImageData512.data;
    const inputTensor = new Float32Array(1 * 4 * H * W);

    const HW = H * W;
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const srcIdx = (y * W + x) * 4;
            const dstIdx = y * W + x;

            inputTensor[0 * HW + dstIdx] = imageData[srcIdx] / 255;
            inputTensor[1 * HW + dstIdx] = imageData[srcIdx + 1] / 255;
            inputTensor[2 * HW + dstIdx] = imageData[srcIdx + 2] / 255;

            const mv = maskData[srcIdx] > 127 ? 1 : 0;
            inputTensor[3 * HW + dstIdx] = mv;
        }
    }
    return inputTensor;
}

function _outputToImageData(outputData, width = 512, height = 512) {
    const H = height;
    const W = width;
    const HW = H * W;

    // 输出可能是 0-255 或 0-1，做一次自动归一化
    let scale = 1;
    let sampleMax = 0;
    const sampleCount = Math.min(outputData.length, 1024);
    for (let i = 0; i < sampleCount; i++) {
        if (outputData[i] > sampleMax) sampleMax = outputData[i];
    }
    if (sampleMax <= 1.5) scale = 255;

    const out = new ImageData(W, H);
    const dst = out.data;

    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const srcIdx = y * W + x;
            const dstIdx = (y * W + x) * 4;

            const r = Math.max(0, Math.min(255, outputData[0 * HW + srcIdx] * scale));
            const g = Math.max(0, Math.min(255, outputData[1 * HW + srcIdx] * scale));
            const b = Math.max(0, Math.min(255, outputData[2 * HW + srcIdx] * scale));

            dst[dstIdx] = r;
            dst[dstIdx + 1] = g;
            dst[dstIdx + 2] = b;
            dst[dstIdx + 3] = 255;
        }
    }

    return out;
}

async function handleInpaint(payload) {
    if (!payload?.imageData) throw new Error('缺少 imageData');
    if (!payload?.mask) throw new Error('缺少 mask');

    const session = await _ensureSession(false);
    const ort = await _loadOnnxRuntime();

    const imageData = payload.imageData;
    const origW = imageData.width;
    const origH = imageData.height;

    // mask 可能与 image 尺寸不同，先对齐
    const maskWidth = payload.mask.width;
    const maskHeight = payload.mask.height;
    if (!maskWidth || !maskHeight) throw new Error('mask.width/mask.height 不能为空');

    let maskImageData = _maskToImageData(payload.mask, maskWidth, maskHeight);
    if (maskWidth !== origW || maskHeight !== origH) {
        maskImageData = _resizeImageData(maskImageData, origW, origH, false);
    }

    // Resize to 512x512
    const image512 = _resizeImageData(imageData, 512, 512, true);
    const mask512 = _resizeImageData(maskImageData, 512, 512, false);

    const inputData = _prepareInputTensorRGBA(image512, mask512);
    const inputName = session.inputNames?.[0] || 'input';
    const tensor = new ort.Tensor('float32', inputData, [1, 4, 512, 512]);

    const outputMap = await session.run({ [inputName]: tensor });
    const outputName = session.outputNames?.[0] || Object.keys(outputMap)[0];
    const outputTensor = outputMap[outputName];
    const outputData = outputTensor?.data;
    if (!outputData) throw new Error('模型输出为空');

    // 输出 512x512 -> ImageData
    const result512 = _outputToImageData(outputData, 512, 512);

    // Resize back
    const resultOrig = _resizeImageData(result512, origW, origH, true);

    return {
        result: { imageData: resultOrig, width: origW, height: origH },
        transferables: [resultOrig.data.buffer],
    };
}
