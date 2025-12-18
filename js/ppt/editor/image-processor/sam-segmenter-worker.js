/**
 * SAM Segmenter Web Worker
 * 在独立线程中执行模型加载和推理
 */

// Worker 内部状态
let segmenterState = {
    // 在线（Transformers.js）
    model: null,
    processor: null,

    // 本地（SAM3 ONNX）
    sam3Encoder: null,
    sam3Decoder: null,
    useLocalModel: false,
    _disableLocalModel: false,
    _ortPromise: null,
    _loadedMode: null, // 'local' | 'online'
    _loadedModelId: null,
    isReady: false,
    isLoading: false,
    _initPromise: null,

    config: {
        mode: 'auto',
        localModelPath: 'models/sam3/',
        onlineModelId: 'Xenova/slimsam-77-uniform',
        modelId: 'Xenova/slimsam-77-uniform', // 向后兼容
    },

    // 缓存（在线/本地分别缓存）
    cachedEmbedding: null,
    cachedImageKey: null,
    cachedLocalEmbedding: null,
    cachedLocalImageKey: null,
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
            case 'precomputeEmbedding': {
                const out = await handlePrecomputeEmbedding(payload);
                result = out.result;
                transferables = out.transferables || [];
                break;
            }
            case 'segmentByPoints': {
                const out = await handleSegmentByPoints(payload);
                result = out.result;
                transferables = out.transferables || [];
                break;
            }
            case 'segmentByBox': {
                const out = await handleSegmentByBox(payload);
                result = out.result;
                transferables = out.transferables || [];
                break;
            }
            case 'setConfig': {
                Object.assign(segmenterState.config, payload || {});
                _syncConfigCompat();
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

// 发送进度
function reportProgress(message, percent) {
    self.postMessage({ type: 'progress', message, percent });
}

// 发送降级通知
function reportFallback() {
    self.postMessage({ type: 'fallback' });
}

function _syncConfigCompat() {
    // 双向同步：modelId <-> onlineModelId
    if (segmenterState.config.modelId && segmenterState.config.onlineModelId !== segmenterState.config.modelId) {
        segmenterState.config.onlineModelId = segmenterState.config.modelId;
    }
    if (segmenterState.config.onlineModelId && segmenterState.config.modelId !== segmenterState.config.onlineModelId) {
        segmenterState.config.modelId = segmenterState.config.onlineModelId;
    }

    // 规范化 localModelPath
    if (segmenterState.config.localModelPath && !segmenterState.config.localModelPath.endsWith('/')) {
        segmenterState.config.localModelPath += '/';
    }
}

function _clearCache() {
    segmenterState.cachedEmbedding = null;
    segmenterState.cachedImageKey = null;
    segmenterState.cachedLocalEmbedding = null;
    segmenterState.cachedLocalImageKey = null;
}

function _serializeTensor(tensor) {
    if (!tensor) return null;

    const dims = Array.isArray(tensor.dims) ? tensor.dims.slice() : (tensor.dims ? Array.from(tensor.dims) : null);
    const type = tensor.type || tensor.dtype || null;
    const data = tensor.data;
    const cloned = data && data.buffer ? new data.constructor(data) : null;

    return { type, dims, data: cloned };
}

function _resolveUrl(urlOrPath) {
    try {
        // 绝对 URL
        // eslint-disable-next-line no-new
        new URL(urlOrPath);
        return urlOrPath;
    } catch {
        // 相对路径：按站点根路径解析，避免相对 Worker URL 走偏
        const normalized = urlOrPath.startsWith('/') ? urlOrPath : `/${urlOrPath}`;
        return new URL(normalized, self.location.origin).toString();
    }
}

/**
 * 加载 Transformers.js 库（CDN）
 */
async function _loadTransformersJS() {
    if (self.transformers) return self.transformers;

    const transformers = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3');
    self.transformers = transformers;
    return transformers;
}

async function _checkLocalModels() {
    _syncConfigCompat();
    const basePath = segmenterState.config.localModelPath;
    const requiredFiles = ['sam3_image_encoder.onnx', 'sam3_decoder.onnx'];

    for (const file of requiredFiles) {
        const url = _resolveUrl(basePath + file);
        try {
            const resp = await fetch(url, { method: 'HEAD' });
            if (resp.ok) continue;

            if (resp.status === 405) {
                const resp2 = await fetch(url, { method: 'GET' });
                if (!resp2.ok) return false;
                continue;
            }
            return false;
        } catch {
            return false;
        }
    }
    return true;
}

async function _loadOnnxRuntime() {
    if (self.ort) return self.ort;
    if (segmenterState._ortPromise) return segmenterState._ortPromise;

    segmenterState._ortPromise = (async () => {
        // 优先 ESM 版本（module worker 不支持 importScripts）
        const mod = await import('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/ort.esm.min.js');
        const ort = mod.default || mod;

        // 确保 WASM 资源路径可用
        if (ort?.env?.wasm) {
            ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/';
        }

        self.ort = ort;
        return ort;
    })();

    return segmenterState._ortPromise;
}

async function _initLocalSam3() {
    const ort = await _loadOnnxRuntime();

    reportProgress('加载本地 SAM3 模型...', 10);

    const encoderUrl = _resolveUrl(segmenterState.config.localModelPath + 'sam3_image_encoder.onnx');
    const decoderUrl = _resolveUrl(segmenterState.config.localModelPath + 'sam3_decoder.onnx');
    const preferredProviders = ['webgpu', 'wasm'];

    const createSession = async (url) => {
        try {
            return await ort.InferenceSession.create(url, { executionProviders: preferredProviders });
        } catch {
            return await ort.InferenceSession.create(url, { executionProviders: ['wasm'] });
        }
    };

    segmenterState.sam3Encoder = await createSession(encoderUrl);
    reportProgress('加载解码器...', 60);
    segmenterState.sam3Decoder = await createSession(decoderUrl);

    reportProgress('SAM3 准备就绪', 100);
}

async function _initOnlineSam() {
    _syncConfigCompat();
    const modelId = segmenterState.config.onlineModelId;

    reportProgress('加载 AI 库...', 0);
    const transformers = await _loadTransformersJS();
    const { SamModel, AutoProcessor, env } = transformers;

    env.cacheDir = '.transformers-cache';
    env.allowLocalModels = false;

    // 在 Worker 中也保持兼容配置
    if (env.backends?.onnx?.wasm) {
        env.backends.onnx.wasm.proxy = true;
    }

    const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;
    const device = hasWebGPU ? 'webgpu' : 'wasm';

    reportProgress('下载分割模型...', 10);
    segmenterState.model = await SamModel.from_pretrained(modelId, {
        device,
        progress_callback: (progress) => {
            if (progress?.status === 'progress') {
                const pct = Math.round(10 + (progress.progress || 0) * 0.7);
                reportProgress(`下载模型 ${progress.file || ''}...`, pct);
            }
        },
    });

    reportProgress('加载处理器...', 80);
    segmenterState.processor = await AutoProcessor.from_pretrained(modelId);

    reportProgress('准备就绪', 100);
    segmenterState.isReady = true;
    segmenterState._loadedModelId = modelId;
    segmenterState._loadedMode = 'online';
    segmenterState.useLocalModel = false;
}

async function handleInit(payload = {}) {
    const forceReload = !!payload.forceReload;
    _syncConfigCompat();

    if (forceReload) {
        segmenterState._disableLocalModel = false;
        segmenterState.model = null;
        segmenterState.processor = null;
        segmenterState.sam3Encoder = null;
        segmenterState.sam3Decoder = null;
        segmenterState._loadedMode = null;
        segmenterState._loadedModelId = null;
        segmenterState.isReady = false;
        _clearCache();
    }

    const desiredMode = segmenterState.config.mode || 'auto';
    const expectedMode = desiredMode === 'online' ? 'online' : (segmenterState._disableLocalModel ? 'online' : null);
    const expectedId = segmenterState.config.onlineModelId;

    if (
        segmenterState.isReady &&
        !forceReload &&
        segmenterState._loadedMode &&
        (expectedMode ? segmenterState._loadedMode === expectedMode : true) &&
        (segmenterState._loadedMode === 'online' ? segmenterState._loadedModelId === expectedId : true)
    ) {
        return { isReady: true, useLocalModel: segmenterState.useLocalModel };
    }

    if (segmenterState.isLoading && segmenterState._initPromise) {
        await segmenterState._initPromise;
        return { isReady: segmenterState.isReady, useLocalModel: segmenterState.useLocalModel };
    }

    segmenterState.isLoading = true;
    segmenterState._initPromise = (async () => {
        try {
            // 1) 优先尝试本地 SAM3（auto/local）
            if (desiredMode !== 'online' && !segmenterState._disableLocalModel) {
                reportProgress('检测本地 SAM3 模型...', 0);
                const hasLocal = await _checkLocalModels();

                if (hasLocal) {
                    try {
                        segmenterState.useLocalModel = true;
                        await _initLocalSam3();
                        segmenterState.isReady = true;
                        segmenterState._loadedMode = 'local';
                        return { isReady: true, useLocalModel: true };
                    } catch (e) {
                        // 本地失败：禁用并降级
                        segmenterState._disableLocalModel = true;
                        segmenterState.useLocalModel = false;
                        reportFallback();
                    }
                } else {
                    // 本地不可用：auto/local 都算降级
                    segmenterState.useLocalModel = false;
                    reportFallback();
                }
            } else {
                segmenterState.useLocalModel = false;
            }

            // 2) 在线 Transformers.js（默认/降级）
            await _initOnlineSam();
            return { isReady: true, useLocalModel: false };
        } finally {
            segmenterState.isLoading = false;
            segmenterState._initPromise = null;
        }
    })();

    return await segmenterState._initPromise;
}

function _pickName(names, candidates) {
    for (const c of candidates) {
        const hit = names.find(n => n === c);
        if (hit) return hit;
    }
    for (const c of candidates) {
        const hit = names.find(n => n.toLowerCase().includes(c.toLowerCase()));
        if (hit) return hit;
    }
    return null;
}

async function _imageDataToCanvas(imageData) {
    if (typeof OffscreenCanvas === 'undefined') {
        throw new Error('当前环境不支持 OffscreenCanvas，无法在 Worker 中处理图片');
    }

    const canvas = new OffscreenCanvas(imageData.width, imageData.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.putImageData(imageData, 0, 0);
    return canvas;
}

async function _preprocessSam3(imageData) {
    const ort = await _loadOnnxRuntime();

    const modelWidth = 1024;
    const modelHeight = 1024;

    const origWidth = imageData.width;
    const origHeight = imageData.height;
    const scaleX = modelWidth / origWidth;
    const scaleY = modelHeight / origHeight;

    const resized = new OffscreenCanvas(modelWidth, modelHeight);
    const rctx = resized.getContext('2d', { willReadFrequently: true });

    const bitmap = await createImageBitmap(imageData);
    try {
        rctx.drawImage(bitmap, 0, 0, modelWidth, modelHeight);
    } finally {
        bitmap.close?.();
    }

    const { data } = rctx.getImageData(0, 0, modelWidth, modelHeight);

    const mean = [123.675, 116.28, 103.53];
    const std = [58.395, 57.12, 57.375];

    const chw = new Float32Array(1 * 3 * modelWidth * modelHeight);
    const planeSize = modelWidth * modelHeight;

    for (let i = 0; i < planeSize; i++) {
        const base = i * 4;
        const r = data[base];
        const g = data[base + 1];
        const b = data[base + 2];

        chw[i] = (r - mean[0]) / std[0];
        chw[planeSize + i] = (g - mean[1]) / std[1];
        chw[2 * planeSize + i] = (b - mean[2]) / std[2];
    }

    const tensor = new ort.Tensor('float32', chw, [1, 3, modelHeight, modelWidth]);
    return { tensor, modelWidth, modelHeight, origWidth, origHeight, scaleX, scaleY };
}

async function _runSam3Encoder(imageTensor) {
    if (!segmenterState.sam3Encoder) throw new Error('SAM3 encoder 未初始化');
    const inputName = _pickName(segmenterState.sam3Encoder.inputNames, ['input_image', 'image', 'pixel_values']) || segmenterState.sam3Encoder.inputNames[0];
    const outputs = await segmenterState.sam3Encoder.run({ [inputName]: imageTensor });
    const outName =
        _pickName(Object.keys(outputs), ['image_embeddings', 'embeddings', 'output']) ||
        Object.keys(outputs)[0];
    return outputs[outName];
}

function _tensorTypeForInput(inputMeta, fallbackType) {
    const t = inputMeta?.type;
    if (t === 'float32' || t === 'float16') return 'float32';
    if (t === 'int64') return 'int64';
    if (t === 'int32') return 'int32';
    if (t === 'bool') return 'bool';
    return fallbackType;
}

function _makeScalarLike(type, value) {
    if (type === 'int64') return new BigInt64Array([BigInt(value)]);
    if (type === 'int32') return new Int32Array([value]);
    if (type === 'bool') return new Uint8Array([value ? 1 : 0]);
    return new Float32Array([value]);
}

function _makeLabelsLike(type, values) {
    if (type === 'int64') return new BigInt64Array(values.map(v => BigInt(v)));
    if (type === 'int32') return new Int32Array(values);
    if (type === 'bool') return new Uint8Array(values.map(v => (v ? 1 : 0)));
    return new Float32Array(values);
}

function _zerosLike(type, size) {
    if (type === 'int64') return new BigInt64Array(size);
    if (type === 'int32') return new Int32Array(size);
    if (type === 'bool') return new Uint8Array(size);
    return new Float32Array(size);
}

async function _runSam3Decoder({ embedding, pointCoords, pointLabels, boxes, origSize }) {
    if (!segmenterState.sam3Decoder) throw new Error('SAM3 decoder 未初始化');

    const ort = await _loadOnnxRuntime();
    const inputNames = segmenterState.sam3Decoder.inputNames;
    const meta = segmenterState.sam3Decoder.inputMetadata || {};
    const feeds = {};

    const embedName = _pickName(inputNames, ['image_embeddings', 'image_embedding', 'embeddings']) || inputNames[0];
    feeds[embedName] = embedding;

    const pointCoordsName = _pickName(inputNames, ['point_coords', 'input_points', 'points']);
    const pointLabelsName = _pickName(inputNames, ['point_labels', 'input_labels', 'labels']);
    const boxesName = _pickName(inputNames, ['boxes', 'input_boxes', 'box']);
    const maskInputName = _pickName(inputNames, ['mask_input']);
    const hasMaskName = _pickName(inputNames, ['has_mask_input']);
    const origSizeName = _pickName(inputNames, ['orig_im_size', 'original_size', 'orig_size']);
    const multimaskName = _pickName(inputNames, ['multimask_output', 'return_multimask', 'multi_mask']);

    if (boxesName && boxes) feeds[boxesName] = boxes;
    if (pointCoordsName && pointCoords) feeds[pointCoordsName] = pointCoords;
    if (pointLabelsName && pointLabels) feeds[pointLabelsName] = pointLabels;

    if (maskInputName) {
        const t = _tensorTypeForInput(meta[maskInputName], 'float32');
        const dims = meta[maskInputName]?.dimensions;
        const finalDims = (Array.isArray(dims) && dims.length === 4 && dims.every(d => typeof d === 'number')) ? dims : [1, 1, 256, 256];
        const size = finalDims.reduce((a, b) => a * b, 1);
        feeds[maskInputName] = new ort.Tensor(t, _zerosLike(t, size), finalDims);
    }

    if (hasMaskName) {
        const t = _tensorTypeForInput(meta[hasMaskName], 'float32');
        const dims = meta[hasMaskName]?.dimensions;
        const finalDims = (Array.isArray(dims) && dims.every(d => typeof d === 'number')) ? dims : [1];
        feeds[hasMaskName] = new ort.Tensor(t, _makeScalarLike(t, 0), finalDims);
    }

    if (origSizeName && origSize) {
        const t = _tensorTypeForInput(meta[origSizeName], 'float32');
        const dims = meta[origSizeName]?.dimensions;
        const finalDims = Array.isArray(dims) && dims.length === 1 ? [2] : [1, 2];
        feeds[origSizeName] = new ort.Tensor(t, _makeLabelsLike(t, [origSize[0], origSize[1]]), finalDims);
    }

    if (multimaskName) {
        const t = _tensorTypeForInput(meta[multimaskName], 'int64');
        const dims = meta[multimaskName]?.dimensions;
        const finalDims = (Array.isArray(dims) && dims.every(d => typeof d === 'number')) ? dims : [1];
        feeds[multimaskName] = new ort.Tensor(t, _makeScalarLike(t, 1), finalDims);
    }

    return await segmenterState.sam3Decoder.run(feeds);
}

function _scalePoints(points, scaleX, scaleY) {
    return points.map(([x, y]) => [x * scaleX, y * scaleY]);
}

function _resizeMaskNearest(src, srcW, srcH, dstW, dstH) {
    const out = new Uint8Array(dstW * dstH);
    for (let y = 0; y < dstH; y++) {
        const sy = Math.min(srcH - 1, Math.floor((y * srcH) / dstH));
        for (let x = 0; x < dstW; x++) {
            const sx = Math.min(srcW - 1, Math.floor((x * srcW) / dstW));
            out[y * dstW + x] = src[sy * srcW + sx];
        }
    }
    return out;
}

function _extractMasksAndScores(decoderOutputs) {
    const keys = Object.keys(decoderOutputs);
    const maskKey =
        _pickName(keys, ['masks', 'mask', 'pred_masks']) ||
        keys.find(k => decoderOutputs[k]?.dims?.length >= 3) ||
        keys[0];
    const scoreKey = _pickName(keys, ['iou', 'scores', 'score']);

    return {
        maskTensor: decoderOutputs[maskKey],
        scoreTensor: scoreKey ? decoderOutputs[scoreKey] : null,
    };
}

function _toMaskObjects(maskTensor, targetW, targetH) {
    const dims = maskTensor.dims || [];
    let n = 1;
    let h, w;
    let offsetPerMask;

    if (dims.length === 4) {
        n = dims[1];
        h = dims[2];
        w = dims[3];
        offsetPerMask = h * w;
    } else if (dims.length === 3) {
        n = dims[0];
        h = dims[1];
        w = dims[2];
        offsetPerMask = h * w;
    } else {
        throw new Error('无法识别 mask 输出维度: ' + JSON.stringify(dims));
    }

    const raw = maskTensor.data;
    const masks = [];
    for (let mi = 0; mi < n; mi++) {
        const start = mi * offsetPerMask;
        const bin = new Uint8Array(offsetPerMask);
        for (let i = 0; i < offsetPerMask; i++) {
            bin[i] = raw[start + i] > 0 ? 1 : 0;
        }

        const resized = (w === targetW && h === targetH) ? bin : _resizeMaskNearest(bin, w, h, targetW, targetH);
        masks.push({ data: resized, width: targetW, height: targetH });
    }
    return masks;
}

function _toScores(scoreTensor, numMasks) {
    if (!scoreTensor?.data) {
        return Array.from({ length: numMasks }, () => 1);
    }
    const arr = Array.from(scoreTensor.data).map(Number);
    if (arr.length === numMasks) return arr;
    if (arr.length >= numMasks) return arr.slice(0, numMasks);
    return arr.concat(Array.from({ length: numMasks - arr.length }, () => arr[arr.length - 1] ?? 1));
}

function _convertOnlineMasks(masksTensor, width, height) {
    const masks = [];

    const dims = masksTensor.dims || [];
    let numMasks = 1;
    let h = height;
    let w = width;

    if (dims.length === 3) {
        numMasks = dims[0];
        h = dims[1];
        w = dims[2];
    } else if (dims.length === 2) {
        h = dims[0];
        w = dims[1];
    }

    const data = masksTensor.data;
    const planeSize = h * w;

    for (let i = 0; i < numMasks; i++) {
        const start = i * planeSize;
        const maskData = new Uint8Array(planeSize);

        for (let j = 0; j < planeSize; j++) {
            maskData[j] = data[start + j] ? 1 : 0;
        }

        const finalData = (w === width && h === height)
            ? maskData
            : _resizeMaskNearest(maskData, w, h, width, height);

        masks.push({ data: finalData, width, height });
    }

    return masks;
}

function _isSameImageKey(imageKey) {
    if (!segmenterState.cachedEmbedding) return false;
    if (!imageKey) return false;
    return imageKey === segmenterState.cachedImageKey;
}

async function _imageDataToRawImage(imageData) {
    const { RawImage } = self.transformers;

    if (typeof RawImage.fromImageData === 'function') {
        return await RawImage.fromImageData(imageData);
    }

    const canvas = await _imageDataToCanvas(imageData);
    return await RawImage.fromCanvas(canvas);
}

async function handlePrecomputeEmbedding(payload) {
    if (!segmenterState.isReady) await handleInit({ forceReload: false });

    const imageData = payload.imageData;
    const imageKey = payload.imageKey || null;

    if (segmenterState.useLocalModel) {
        const pre = await _preprocessSam3(imageData);
        const embedding = await _runSam3Encoder(pre.tensor);

        segmenterState.cachedLocalEmbedding = embedding;
        segmenterState.cachedLocalImageKey = imageKey;

        const serialized = _serializeTensor(embedding);
        const transferables = serialized?.data?.buffer ? [serialized.data.buffer] : [];

        return {
            result: {
                embedding: serialized,
                width: imageData.width,
                height: imageData.height,
                resizedWidth: pre.modelWidth,
                resizedHeight: pre.modelHeight,
                scaleX: pre.scaleX,
                scaleY: pre.scaleY,
            },
            transferables,
        };
    }

    await _loadTransformersJS();

    const rawImage = await _imageDataToRawImage(imageData);
    const inputs = await segmenterState.processor(rawImage);
    const embedding = await segmenterState.model.get_image_embeddings(inputs);

    segmenterState.cachedEmbedding = {
        embedding,
        inputs,
        rawImage,
        width: rawImage.width,
        height: rawImage.height,
    };
    segmenterState.cachedImageKey = imageKey;

    const serialized = _serializeTensor(embedding);
    const transferables = serialized?.data?.buffer ? [serialized.data.buffer] : [];

    return {
        result: {
            embedding: serialized,
            inputs: null,
            rawImage: null,
            width: rawImage.width,
            height: rawImage.height,
        },
        transferables,
    };
}

async function _segmentLocalByPoints(imageData, imageKey, points, labels = null) {
    const pre = await _preprocessSam3(imageData);

    let embedding;
    if (segmenterState.cachedLocalEmbedding && imageKey && segmenterState.cachedLocalImageKey === imageKey) {
        embedding = segmenterState.cachedLocalEmbedding;
    } else {
        embedding = await _runSam3Encoder(pre.tensor);
        if (imageKey) {
            segmenterState.cachedLocalEmbedding = embedding;
            segmenterState.cachedLocalImageKey = imageKey;
        }
    }

    const scaledPoints = _scalePoints(points, pre.scaleX, pre.scaleY);
    const ort = await _loadOnnxRuntime();
    const pointCoords = new ort.Tensor('float32', new Float32Array(scaledPoints.flat()), [1, scaledPoints.length, 2]);

    const finalLabels = labels || points.map(() => 1);
    const labelName = _pickName(segmenterState.sam3Decoder.inputNames, ['point_labels', 'input_labels', 'labels']);
    const labelType = _tensorTypeForInput(labelName ? segmenterState.sam3Decoder.inputMetadata?.[labelName] : null, 'int64');
    const pointLabels = new ort.Tensor(labelType, _makeLabelsLike(labelType, finalLabels), [1, finalLabels.length]);

    const outputs = await _runSam3Decoder({
        embedding,
        pointCoords,
        pointLabels,
        boxes: null,
        origSize: [imageData.height, imageData.width],
    });

    const { maskTensor, scoreTensor } = _extractMasksAndScores(outputs);
    const masks = _toMaskObjects(maskTensor, imageData.width, imageData.height);
    const scores = _toScores(scoreTensor, masks.length);

    let bestIdx = 0;
    for (let i = 1; i < scores.length; i++) {
        if (scores[i] > scores[bestIdx]) bestIdx = i;
    }

    return { masks, scores, selectedMaskIndex: bestIdx, width: imageData.width, height: imageData.height };
}

async function _segmentLocalByBox(imageData, imageKey, box) {
    const pre = await _preprocessSam3(imageData);

    let embedding;
    if (segmenterState.cachedLocalEmbedding && imageKey && segmenterState.cachedLocalImageKey === imageKey) {
        embedding = segmenterState.cachedLocalEmbedding;
    } else {
        embedding = await _runSam3Encoder(pre.tensor);
        if (imageKey) {
            segmenterState.cachedLocalEmbedding = embedding;
            segmenterState.cachedLocalImageKey = imageKey;
        }
    }

    const ort = await _loadOnnxRuntime();
    const boxesName = _pickName(segmenterState.sam3Decoder.inputNames, ['boxes', 'input_boxes', 'box']);
    const hasPointCoords = !!_pickName(segmenterState.sam3Decoder.inputNames, ['point_coords', 'input_points', 'points']);
    const hasPointLabels = !!_pickName(segmenterState.sam3Decoder.inputNames, ['point_labels', 'input_labels', 'labels']);

    let pointCoords = null;
    let pointLabels = null;
    let boxesTensor = null;

    const x1 = box.x1 * pre.scaleX;
    const y1 = box.y1 * pre.scaleY;
    const x2 = box.x2 * pre.scaleX;
    const y2 = box.y2 * pre.scaleY;

    if (boxesName) {
        boxesTensor = new ort.Tensor('float32', new Float32Array([x1, y1, x2, y2]), [1, 1, 4]);
    }

    if (hasPointCoords) {
        pointCoords = new ort.Tensor('float32', new Float32Array([x1, y1, x2, y2]), [1, 2, 2]);
    }
    if (hasPointLabels) {
        const labelName = _pickName(segmenterState.sam3Decoder.inputNames, ['point_labels', 'input_labels', 'labels']);
        const labelType = _tensorTypeForInput(labelName ? segmenterState.sam3Decoder.inputMetadata?.[labelName] : null, 'int64');
        pointLabels = new ort.Tensor(labelType, _makeLabelsLike(labelType, [2, 3]), [1, 2]);
    }

    const outputs = await _runSam3Decoder({
        embedding,
        pointCoords,
        pointLabels,
        boxes: boxesTensor,
        origSize: [imageData.height, imageData.width],
    });

    const { maskTensor, scoreTensor } = _extractMasksAndScores(outputs);
    const masks = _toMaskObjects(maskTensor, imageData.width, imageData.height);
    const scores = _toScores(scoreTensor, masks.length);

    let bestIdx = 0;
    for (let i = 1; i < scores.length; i++) {
        if (scores[i] > scores[bestIdx]) bestIdx = i;
    }

    return { masks, scores, selectedMaskIndex: bestIdx, width: imageData.width, height: imageData.height };
}

async function _segmentOnlineByPoints(imageData, imageKey, points, labels = null) {
    await _loadTransformersJS();

    let rawImage, inputs;
    if (segmenterState.cachedEmbedding && _isSameImageKey(imageKey)) {
        rawImage = segmenterState.cachedEmbedding.rawImage;
        inputs = segmenterState.cachedEmbedding.inputs;
    } else {
        rawImage = await _imageDataToRawImage(imageData);
    }

    const inputPoints = [points];
    const inputLabels = labels ? [labels] : [points.map(() => 1)];

    inputs = await segmenterState.processor(rawImage, {
        input_points: inputPoints,
        input_labels: inputLabels,
    });

    const outputs = await segmenterState.model(inputs);

    const rawMasks = await segmenterState.processor.post_process_masks(
        outputs.pred_masks,
        inputs.original_sizes,
        inputs.reshaped_input_sizes
    );

    const scores = outputs.iou_scores.data;

    let bestIdx = 0;
    let bestScore = scores[0];
    for (let i = 1; i < scores.length; i++) {
        if (scores[i] > bestScore) {
            bestScore = scores[i];
            bestIdx = i;
        }
    }

    const masks = _convertOnlineMasks(rawMasks[0], rawImage.width, rawImage.height);

    return {
        masks,
        scores: Array.from(scores),
        selectedMaskIndex: bestIdx,
        width: rawImage.width,
        height: rawImage.height,
    };
}

async function _segmentOnlineByBox(imageData, box) {
    await _loadTransformersJS();

    const rawImage = await _imageDataToRawImage(imageData);
    const inputBoxes = [[[box.x1, box.y1, box.x2, box.y2]]];

    const inputs = await segmenterState.processor(rawImage, { input_boxes: inputBoxes });
    const outputs = await segmenterState.model(inputs);

    const rawMasks = await segmenterState.processor.post_process_masks(
        outputs.pred_masks,
        inputs.original_sizes,
        inputs.reshaped_input_sizes
    );

    const scores = outputs.iou_scores.data;
    const masks = _convertOnlineMasks(rawMasks[0], rawImage.width, rawImage.height);

    return {
        masks,
        scores: Array.from(scores),
        selectedMaskIndex: 0,
        width: rawImage.width,
        height: rawImage.height,
    };
}

function _collectMaskTransferables(result) {
    const transferables = [];
    if (!result?.masks) return transferables;
    for (const m of result.masks) {
        if (m?.data?.buffer) transferables.push(m.data.buffer);
    }
    return transferables;
}

async function handleSegmentByPoints(payload) {
    if (!segmenterState.isReady) await handleInit({ forceReload: false });

    const imageData = payload.imageData;
    const imageKey = payload.imageKey || null;
    const points = payload.points || [];
    const labels = payload.labels || null;

    if (segmenterState.useLocalModel) {
        try {
            const result = await _segmentLocalByPoints(imageData, imageKey, points, labels);
            return { result, transferables: _collectMaskTransferables(result) };
        } catch (e) {
            segmenterState._disableLocalModel = true;
            segmenterState.useLocalModel = false;
            reportFallback();

            segmenterState.isReady = false;
            await handleInit({ forceReload: false });
        }
    }

    const result = await _segmentOnlineByPoints(imageData, imageKey, points, labels);
    return { result, transferables: _collectMaskTransferables(result) };
}

async function handleSegmentByBox(payload) {
    if (!segmenterState.isReady) await handleInit({ forceReload: false });

    const imageData = payload.imageData;
    const imageKey = payload.imageKey || null;
    const box = payload.box;

    if (segmenterState.useLocalModel) {
        try {
            const result = await _segmentLocalByBox(imageData, imageKey, box);
            return { result, transferables: _collectMaskTransferables(result) };
        } catch (e) {
            segmenterState._disableLocalModel = true;
            segmenterState.useLocalModel = false;
            reportFallback();

            segmenterState.isReady = false;
            await handleInit({ forceReload: false });
        }
    }

    const result = await _segmentOnlineByBox(imageData, box);
    return { result, transferables: _collectMaskTransferables(result) };
}
