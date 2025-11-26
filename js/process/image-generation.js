/**
 * @file js/process/image-generation.js
 * 轻量级前端生图适配器：
 *  - 支持 Gemini 文生图 (v1beta generateContent)。
 *  - 支持 OpenAI 兼容 /v1/images/generations 接口。
 *  - 统一返回结构，内置简单的轮询取 Key 与可选压缩。
 *  - 纯前端，无额外依赖，可直接挂载到 window.ImageGeneration。
 */
(function(global) {
  'use strict';

  const DEFAULT_SIZE = { width: 1280, height: 720 };
  const DEFAULT_MAX_KB = 900; // 约 0.9MB，PPT 嵌入较友好
  const KEY_ROUND_ROBIN = {};

  const PROVIDER_ADAPTERS = {
    'gemini-image': geminiImageAdapter,
    'gemini': geminiImageAdapter, // 允许与翻译同名模型复用 Key
    'image': openaiCompatibleImageAdapter,
    'openai-image': openaiCompatibleImageAdapter,
    'openai': openaiCompatibleImageAdapter,
    'sora-image': openaiCompatibleImageAdapter,
    'jimeng-image': openaiCompatibleImageAdapter
  };

  /**
   * 主入口：生成图片。
   * @param {Object} request
   * @returns {Promise<Object>} { provider, model, mimeType, width, height, base64?, url?, source }
   */
  async function generateImage(request) {
    const normalized = normalizeImageRequest(request);
    const providerKey = normalized.provider;
    const adapter = PROVIDER_ADAPTERS[providerKey];
    if (!adapter) {
      throw new Error(`当前未支持的生图 provider: ${providerKey}`);
    }

    const keys = normalized.apiKey
      ? [{ id: '__override__', value: normalized.apiKey, remark: 'override', status: 'untested' }]
      : getRotatedKeysForModel(providerKey);
    if (!keys.length) {
      throw new Error(`未找到 ${providerKey} 的可用 API Key，请在模型管理中添加。`);
    }

    const modelConfig = typeof loadModelConfig === 'function' ? (loadModelConfig(providerKey) || null) : null;

    let lastError = null;
    for (const keyObj of keys) {
      try {
        const rawResult = await adapter(normalized, keyObj.value, modelConfig);
        const result = await maybeCompress(rawResult, normalized);
        // 记录成功的 Key，供 UI 高亮（不改变 status，避免误伤）
        if (keyObj.id !== '__override__') {
          try {
            const records = JSON.parse(localStorage.getItem('paperBurnerLastSuccessfulKeys') || '{}');
            if (keyObj.id) {
              records[providerKey] = keyObj.id;
              localStorage.setItem('paperBurnerLastSuccessfulKeys', JSON.stringify(records));
            }
          } catch (_) {}
        }
        return result;
      } catch (err) {
        lastError = err;
        // 401/403 标记 key 为 invalid，进入下一个
        if (keyObj.id !== '__override__' && (err && err.status && (err.status === 401 || err.status === 403)) && typeof saveModelKeys === 'function') {
          markKeyInvalid(providerKey, keyObj.id);
        }
        console.warn(`[ImageGeneration] provider=${providerKey} key(${keyObj.remark || keyObj.id || 'unknown'}) 失败:`, err);
      }
    }

    throw lastError || new Error(`所有 Key 均尝试失败 (provider=${providerKey})`);
  }

  /**
   * Gemini 文生图适配器 (generateContent)
   */
  async function geminiImageAdapter(req, apiKey, modelConfig) {
    const modelId = req.model || modelConfig?.modelId || 'gemini-2.5-flash-image';
    const baseUrl = sanitizeBaseUrl(modelConfig?.apiBaseUrl || 'https://generativelanguage.googleapis.com');
    const endpoint = `${baseUrl}/v1beta/models/${modelId}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const body = {
      contents: [{ role: 'user', parts: [{ text: buildPromptWithSize(req) }]}]
    };

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!resp.ok) {
      const err = await buildHttpError(resp, 'Gemini 文生图请求失败');
      err.status = resp.status;
      throw err;
    }
    const data = await resp.json();
    const parts =
      data?.candidates?.[0]?.content?.parts ||
      data?.candidates?.[0]?.parts ||
      data?.contents?.[0]?.parts ||
      [];
    const imgPart = parts.find(p => p.inlineData);
    const inline = imgPart?.inlineData;
    if (!inline?.data) {
      const blockReason = data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason || '';
      const textFallback = (parts.find(p => p.text)?.text) || '';
      const detail = blockReason || textFallback || '未返回图片数据';
      const err = new Error(`Gemini 未返回图片: ${detail}`);
      err.data = data;
      throw err;
    }
    const mimeType = inline.mimeType || 'image/png';
    const base64 = `data:${mimeType};base64,${inline.data}`;
    return {
      provider: 'gemini-image',
      model: modelId,
      mimeType,
      base64,
      width: req.width,
      height: req.height,
      source: 'gemini'
    };
  }

  /**
   * OpenAI 兼容 /v1/images/generations 适配器
   */
  async function openaiCompatibleImageAdapter(req, apiKey, modelConfig) {
    const modelId = req.model || modelConfig?.modelId || 'gpt-image-1';
    const baseUrl = sanitizeBaseUrl(modelConfig?.apiBaseUrl || 'https://api.openai.com');
    const responseFormat = req.responseFormat || modelConfig?.responseFormat || 'b64_json';
    const size = `${req.width}x${req.height}`;

    const isChatMode = req.chatMode || modelConfig?.chatImageMode || req.provider === 'sora-image';
    const endpointImages = modelConfig?.apiEndpoint || joinUrl(baseUrl, 'v1/images/generations');
    const endpointChat = modelConfig?.apiEndpointChat || joinUrl(baseUrl, 'v1/chat/completions');

    // 构造请求负载
    const payloadImage = {
      model: modelId,
      prompt: buildPromptWithSize(req),
      size,
      n: 1,
      response_format: responseFormat
    };
    if (req.style) payloadImage.style = req.style;
    if (req.negativePrompt) payloadImage.prompt += `\nNegative: ${req.negativePrompt}`;

    const payloadChat = {
      model: modelId,
      messages: [{ role: 'user', content: req.prompt }],
      temperature: 0.8,
      n: 1
    };

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    };

    // 选择调用模式
    if (!isChatMode) {
      const resp = await fetch(endpointImages, { method: 'POST', headers, body: JSON.stringify(payloadImage) });
      if (!resp.ok) {
        const err = await buildHttpError(resp, 'OpenAI 兼容生图请求失败');
        err.status = resp.status;
        throw err;
      }
      const data = await resp.json();
      const parsed = extractOpenAIImageData(data, responseFormat);
      if (!parsed) throw new Error('OpenAI 兼容接口未返回有效的图片数据');
      return {
        provider: req.provider || 'openai-image',
        model: modelId,
        mimeType: parsed.mimeType || 'image/png',
        base64: parsed.base64 || null,
        url: parsed.url || null,
        width: req.width,
        height: req.height,
        source: 'openai-compatible'
      };
    }

    // Chat 模式 (用于 sora-image 或只有 chat/completions 的供应商)
    if (req.chatStream) {
      return await streamChatImage(endpointChat, headers, payloadChat, req);
    }

    const respChat = await fetch(endpointChat, { method: 'POST', headers, body: JSON.stringify(payloadChat) });
    if (!respChat.ok) {
      const err = await buildHttpError(respChat, 'OpenAI Chat 模式生图请求失败');
      err.status = respChat.status;
      throw err;
    }
    const dataChat = await respChat.json();
    const parsedChat = extractImageFromChatResponse(dataChat);
    if (!parsedChat) {
      const err = new Error('Chat 接口未返回可识别的图片字段');
      err.data = dataChat;
      throw err;
    }
    return {
      provider: req.provider || 'openai-image',
      model: modelId,
      mimeType: parsedChat.mimeType || 'image/png',
      base64: parsedChat.base64 || null,
      url: parsedChat.url || null,
      width: req.width,
      height: req.height,
      source: 'openai-chat-image'
    };
  }

  /**
   * 将尺寸约束注入 prompt，便于不支持显式尺寸的模型对齐输出。
   */
  function buildPromptWithSize(req) {
    const hint = `(目标尺寸: ${req.width}x${req.height})`;
    return req.prompt.includes(hint) ? req.prompt : `${req.prompt}\n${hint}`;
  }

  /**
   * 若 base64 过大，则压缩。
   */
  async function maybeCompress(result, req) {
    if (!result || !result.base64) return result;
    const kb = estimateBase64KB(result.base64);
    const maxKB = req.maxKB || DEFAULT_MAX_KB;
    if (kb <= maxKB) return result;

    try {
      const compressed = await compressImageBase64(result.base64, {
        maxKB,
        maxWidth: req.width,
        maxHeight: req.height,
        mimeType: result.mimeType || 'image/jpeg'
      });
      return { ...result, ...compressed };
    } catch (e) {
      console.warn('[ImageGeneration] 压缩失败，返回原图：', e);
      return result;
    }
  }

  function normalizeImageRequest(request = {}) {
    const width = clampInt(request.width, DEFAULT_SIZE.width);
    const height = clampInt(request.height, DEFAULT_SIZE.height);
    const provider = (request.provider || 'gemini-image').toLowerCase();
    return {
      provider,
      model: request.model,
      prompt: String(request.prompt || '').trim(),
      negativePrompt: request.negativePrompt ? String(request.negativePrompt).trim() : '',
      width,
      height,
      responseFormat: request.responseFormat,
      style: request.style,
      maxKB: request.maxKB || DEFAULT_MAX_KB,
      apiKey: request.apiKey,
      chatMode: request.chatMode,
      chatStream: request.chatStream,
      onStreamMessage: request.onStreamMessage
    };
  }

  function clampInt(value, fallback) {
    const n = parseInt(value, 10);
    if (Number.isFinite(n) && n > 0) return n;
    return fallback;
  }

  function sanitizeBaseUrl(url) {
    return String(url || '').replace(/\/+$/, '');
  }

  function joinUrl(base, segment) {
    if (!base) return segment;
    if (!segment) return base;
    const b = base.endsWith('/') ? base.slice(0, -1) : base;
    const s = segment.startsWith('/') ? segment.slice(1) : segment;
    return `${b}/${s}`;
  }

  function estimateBase64KB(dataUrl) {
    if (!dataUrl) return 0;
    const idx = dataUrl.indexOf('base64,');
    const raw = idx >= 0 ? dataUrl.slice(idx + 7) : dataUrl;
    return Math.ceil((raw.length * 3) / 4 / 1024);
  }

  function extractOpenAIImageData(data, responseFormat) {
    const first = data?.data?.[0] || {};
    const mimeType = first.mimeType || 'image/png';
    let base64 = null;
    let url = null;
    if (first.b64_json) {
      base64 = `data:${mimeType};base64,${first.b64_json}`;
    } else if (first.url) {
      url = first.url;
    } else if (responseFormat === 'b64_json' && typeof first === 'string') {
      base64 = `data:${mimeType};base64,${first}`;
    }
    if (!base64 && !url) return null;
    return { base64, url, mimeType };
  }

  function extractImageFromChatResponse(data) {
    const choices = data?.choices || [];
    for (const choice of choices) {
      const msg = choice?.message || {};
      const content = msg.content;
      // content 可能是字符串或数组
      if (typeof content === 'string') {
        const parsed = extractFromText(content);
        if (parsed) return parsed;
      } else if (Array.isArray(content)) {
        for (const part of content) {
          // OpenAI 多模态格式: {type: 'image_url', image_url: {url}}
          if (part?.image_url?.url) {
            return { url: part.image_url.url, mimeType: 'image/png' };
          }
          if (part?.text && typeof part.text === 'string') {
            const parsed = extractFromText(part.text);
            if (parsed) return parsed;
          }
        }
      }
    }
    // 回退检查 data.data 结构
    const parsedDataField = extractOpenAIImageData(data, 'url');
    if (parsedDataField) return parsedDataField;
    return null;
  }

  function extractFromText(text) {
    if (!text) return null;
    // 查找 data URL
    const dataUrlMatch = text.match(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/);
    if (dataUrlMatch) {
      return { base64: dataUrlMatch[0], mimeType: 'image/png' };
    }
    // 查找 http(s) 图片 URL
    const urlMatch = text.match(/https?:\/\/[^\s)'"<>]+/);
    if (urlMatch) {
      return { url: urlMatch[0], mimeType: 'image/png' };
    }
    return null;
  }

  async function streamChatImage(endpoint, headers, payloadChat, req) {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...payloadChat, stream: true })
    });
    if (!resp.ok) {
      const err = await buildHttpError(resp, 'Chat 流式生图请求失败');
      err.status = resp.status;
      throw err;
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let aggregatedText = '';
    let imageCandidates = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep last incomplete
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        const dataStr = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
        try {
          const json = JSON.parse(dataStr);
          const delta = json?.choices?.[0]?.delta || {};
          const reasoning = delta.reasoning_content;
          if (reasoning) {
            aggregatedText += reasoning;
            if (typeof req.onStreamMessage === 'function') req.onStreamMessage(reasoning);
          }
          const deltaParts = delta.content || [];
          for (const part of deltaParts) {
            if (part?.type === 'text' && part?.text) {
              aggregatedText += part.text;
              if (typeof req.onStreamMessage === 'function') req.onStreamMessage(part.text);
            }
            if (part?.image_url?.url) {
              imageCandidates.push({ url: part.image_url.url, mimeType: 'image/png' });
            }
            if (typeof part === 'string') {
              const parsed = extractFromText(part);
              if (parsed) imageCandidates.push(parsed);
            }
          }
          if (typeof delta === 'object' && typeof delta.content === 'string') {
            const parsed = extractFromText(delta.content);
            if (parsed) imageCandidates.push(parsed);
          }
        } catch (_) {
          // 非 JSON，忽略
        }
      }
    }
    if (!imageCandidates.length) {
      const parsed = extractFromText(aggregatedText);
      if (parsed) imageCandidates.push(parsed);
    }
    if (!imageCandidates.length) {
      const err = new Error('Chat 流式未返回图片');
      err.data = aggregatedText;
      throw err;
    }
    const first = imageCandidates[0];
    if (typeof req.onStreamImages === 'function') {
      req.onStreamImages(imageCandidates);
    }
    return {
      provider: req.provider || 'openai-image',
      model: req.model,
      mimeType: first.mimeType || 'image/png',
      base64: first.base64 || null,
      url: first.url || null,
      width: req.width,
      height: req.height,
      source: 'openai-chat-image-stream'
    };
  }

  function getRotatedKeysForModel(modelKey) {
    const raw = typeof loadModelKeys === 'function' ? (loadModelKeys(modelKey) || []) : [];
    const usable = raw.filter(k => k && k.value && k.value.trim() && k.status !== 'invalid');
    if (!usable.length) return [];
    const idx = KEY_ROUND_ROBIN[modelKey] || 0;
    KEY_ROUND_ROBIN[modelKey] = (idx + 1) % usable.length;
    return usable.slice(idx).concat(usable.slice(0, idx));
  }

  function markKeyInvalid(modelKey, keyId) {
    if (!keyId) return;
    try {
      const allKeys = loadModelKeys(modelKey) || [];
      const changed = allKeys.map(k => k.id === keyId ? { ...k, status: 'invalid' } : k);
      if (typeof saveModelKeys === 'function') {
        saveModelKeys(modelKey, changed);
      }
    } catch (e) {
      console.warn(`[ImageGeneration] 标记 Key 失败 (${modelKey}):`, e);
    }
  }

  async function buildHttpError(resp, defaultMsg) {
    try {
      if (typeof getApiError === 'function') {
        const msg = await getApiError(resp, defaultMsg);
        return new Error(msg);
      }
      const text = await resp.text();
      return new Error(text || `${defaultMsg} (${resp.status})`);
    } catch (e) {
      return new Error(`${defaultMsg} (${resp.status})`);
    }
  }

  /**
   * base64 -> canvas 压缩
   * @param {string} base64DataUrl data:image/...;base64,xxx
   * @param {Object} opts
   * @returns {Promise<{base64: string, width: number, height: number, mimeType: string}>}
   */
  async function compressImageBase64(base64DataUrl, opts = {}) {
    const {
      maxKB = DEFAULT_MAX_KB,
      maxWidth = DEFAULT_SIZE.width,
      maxHeight = DEFAULT_SIZE.height,
      mimeType = 'image/jpeg',
      qualityStart = 0.85,
      qualityMin = 0.5,
      qualityStep = 0.07
    } = opts;

    const img = await loadImage(base64DataUrl);
    const scale = Math.min(1, maxWidth / img.width, maxHeight / img.height);
    const targetW = Math.max(1, Math.round(img.width * scale));
    const targetH = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, targetW, targetH);

    let quality = qualityStart;
    let output = canvas.toDataURL(mimeType, quality);
    while (estimateBase64KB(output) > maxKB && quality > qualityMin) {
      quality = Math.max(qualityMin, quality - qualityStep);
      output = canvas.toDataURL(mimeType, quality);
    }
    return { base64: output, width: targetW, height: targetH, mimeType };
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  // ---- 导出到全局 ----
  global.ImageGeneration = {
    generateImage,
    compressImageBase64,
    normalizeImageRequest,
    adapters: PROVIDER_ADAPTERS
  };

})(typeof window !== 'undefined' ? window : globalThis);
