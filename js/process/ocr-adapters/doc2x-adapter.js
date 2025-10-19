// process/ocr-adapters/doc2x-adapter.js
// Doc2X OCR 适配器

/**
 * Doc2X OCR 适配器
 * 特性：
 * - 使用 status 端点获取永久 Markdown
 * - 尝试导出带图片版本（3次重试）
 * - 失败后降级到 CDN 图床版本
 * - 使用 Dollar 公式模式
 */
class Doc2XOcrAdapter extends OcrAdapter {
  constructor(config) {
    super(config);
    this.token = config.token;
    this.workerUrl = config.workerUrl;
    this.authKey = config.authKey; // Worker Auth Key (可选)
    this.tokenMode = config.tokenMode || 'frontend'; // 'frontend' 或 'worker'
    this.maxExportRetries = 3; // 导出重试次数
  }

  /**
   * 处理文件
   * @param {File} file - PDF 文件
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>} { markdown, images, metadata }
   */
  async processFile(file, onProgress) {
    console.log('[Doc2X OCR] Processing file:', file.name);

    // 1. 上传文件
    onProgress?.(0, 100, '上传文件到 Doc2X...');
    const uid = await this.uploadFile(file);

    console.log('[Doc2X OCR] UID:', uid);

    // 2. 轮询状态，获取永久 Markdown
    onProgress?.(10, 100, '等待 Doc2X 处理...');
    const statusData = await this.pollStatus(uid, onProgress);

    console.log('[Doc2X OCR] Status data received');

    // 3. 优先直接使用状态端点返回的“永久 Markdown”（包含官方图床链接）
    const preferStatusMd = (localStorage.getItem('ocrDoc2XPreferStatusMd') || 'true') !== 'false';
    const statusMarkdown = statusData && typeof statusData.markdown === 'string' ? statusData.markdown : '';
    if (preferStatusMd && statusMarkdown) {
      onProgress?.(95, 100, '使用状态返回的 Markdown...');
      onProgress?.(100, 100, '完成');
      return {
        markdown: statusMarkdown,
        images: [],
        metadata: {
          engine: 'doc2x',
          source: 'status',
          pageCount: statusData.page_count || 0
        }
      };
    }

    // 可选：若明确配置使用导出 ZIP，则尝试带图片版本
    onProgress?.(85, 100, '尝试导出带图片版本...');
    const exportResult = await this.tryExportWithImages(uid, statusData, onProgress);

    onProgress?.(100, 100, '完成');

    return exportResult;
  }

  /**
   * 构建请求头
   * @param {boolean} isJsonContent - 是否为 JSON 内容（需要 Content-Type）
   * @returns {Object} headers
   */
  buildHeaders(isJsonContent = false) {
    const headers = {};

    // Worker Auth Key (可选)
    if (this.authKey) {
      headers['X-Auth-Key'] = this.authKey;
    }

    // Doc2X Token (仅在前端透传模式)
    if (this.tokenMode === 'frontend' && this.token) {
      headers['X-Doc2X-Key'] = this.token;
      const tokenPreview = this.token.length > 12
        ? `${this.token.substring(0, 6)}...${this.token.substring(this.token.length - 6)}`
        : this.token;
      console.log(`[Doc2X OCR] Authorization: Using frontend mode with token (${tokenPreview})`);
    } else if (this.tokenMode === 'frontend' && !this.token) {
      console.warn('[Doc2X OCR] Authorization: Frontend mode selected but no token provided');
    } else if (this.tokenMode === 'worker') {
      console.log('[Doc2X OCR] Authorization: Using worker mode (token from environment)');
    } else {
      console.warn('[Doc2X OCR] Authorization: Unknown token mode:', this.tokenMode);
    }

    // JSON Content-Type
    if (isJsonContent) {
      headers['Content-Type'] = 'application/json';
    }

    return headers;
  }

  /**
   * 上传文件
   * @param {File} file
   * @returns {Promise<string>} uid
   */
  async uploadFile(file) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('ocr', 'true'); // 启用 OCR
    formData.append('formula_mode', 'dollar'); // Dollar 公式模式

    const response = await fetch(`${this.workerUrl}/doc2x/upload`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: formData
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(`Doc2X 上传失败: ${error.error || response.statusText}`);
    }

    const data = await response.json();
    return data.uid;
  }

  /**
   * 轮询状态
   * @param {string} uid
   * @param {Function} onProgress
   * @returns {Promise<Object>} 状态数据（包含永久 Markdown）
   */
  async pollStatus(uid, onProgress) {
    const maxAttempts = 100;
    const pollInterval = 3000; // 3 秒

    for (let i = 0; i < maxAttempts; i++) {
      const response = await fetch(`${this.workerUrl}/doc2x/status/${uid}`, {
        headers: this.buildHeaders()
      });

      if (!response.ok) {
        throw new Error('Doc2X 查询失败');
      }

      const data = await response.json();

      // 更新进度
      if (data.progress !== undefined && data.progress !== null) {
        // 兼容 0-1 或 0-100 两种进度表达
        const raw = Number(data.progress);
        const progressPct = isFinite(raw) ? (raw <= 1 ? Math.round(raw * 100) : Math.round(raw)) : 0;
        const percent = Math.min(10 + Math.floor(progressPct * 0.7), 95);
        onProgress?.(percent, 100, `处理中: ${progressPct}%`);
      }

      // 完成
      if (data.status === 'success' && data.result) {
        return data.result;
      }

      // 失败
      if (data.status === 'failed') {
        throw new Error(data.error || 'Doc2X 处理失败');
      }

      await this.sleep(pollInterval);
    }

    throw new Error('Doc2X 处理超时');
  }

  /**
   * 尝试导出带图片版本（最多3次重试）
   * @param {string} uid
   * @param {Object} statusData - 状态端点返回的数据（包含永久 Markdown 和 CDN 图片）
   * @returns {Promise<Object>} { markdown, images, metadata }
   */
  async tryExportWithImages(uid, statusData, onProgress) {
    // 尝试导出
    for (let attempt = 1; attempt <= this.maxExportRetries; attempt++) {
      try {
        console.log(`[Doc2X OCR] Export attempt ${attempt}/${this.maxExportRetries}`);

        onProgress?.(90, 100, `导出中 (${attempt}/${this.maxExportRetries})...`);
        const exportUrl = await this.requestExport(uid);
        const result = await this.downloadAndExtractExport(exportUrl, statusData);
        onProgress?.(98, 100, '导出完成，正在解析 ZIP...');

        console.log('[Doc2X OCR] Export succeeded');
        return result;

      } catch (error) {
        console.warn(`[Doc2X OCR] Export attempt ${attempt} failed:`, error.message);

        if (attempt === this.maxExportRetries) {
          // 所有重试都失败，降级到 CDN 图床版本
          console.log('[Doc2X OCR] All export attempts failed, falling back to CDN images');
          return this.useCdnImages(statusData);
        }

        // 等待一下再重试
        await this.sleep(2000);
      }
    }
  }

  /**
   * 请求导出
   * @param {string} uid
   * @returns {Promise<string>} 导出 ZIP URL
   */
  async requestExport(uid) {
    // 1) 触发导出任务（使用 to:'md' + formula_mode:'dollar'）
    const triggerResp = await fetch(`${this.workerUrl}/doc2x/convert`, {
      method: 'POST',
      headers: this.buildHeaders(true),
      body: JSON.stringify({
        uid,
        to: 'md',
        formula_mode: 'dollar'
      })
    });
    if (!triggerResp.ok) {
      throw new Error('Doc2X 导出请求失败');
    }
    // 2) 轮询导出结果，直到获得下载 URL
    const headers = this.buildHeaders();
    const base = this.workerUrl.replace(/\/+$/, '');
    for (let i = 0; i < 50; i++) {
      await this.sleep(2000);
      const res = await fetch(`${base}/doc2x/convert/result/${uid}`, { headers });
      if (!res.ok) continue;
      const data = await res.json();
      const url = data.url || data.zip_url || data.full_zip_url || data.fullZipUrl;
      if (data.status === 'success' && url) {
        return url;
      }
    }
    throw new Error('Doc2X 导出超时');
  }

  /**
   * 下载并解压导出的 ZIP（成功导出带图片版本）
   * @param {string} zipUrl
   * @param {Object} statusData - 备用的状态数据
   * @returns {Promise<Object>} { markdown, images, metadata }
   */
  /**
   * 分片下载大文件
   * @param {string} url - 文件 URL
   * @param {Object} headers - 请求头
   * @param {number} chunkSize - 每片大小（默认 10MB）
   * @returns {Promise<Blob>} 完整文件 Blob
   */
  async downloadWithChunks(url, headers = {}, chunkSize = 10 * 1024 * 1024) {
    console.log('[Doc2X OCR] Starting chunked download from:', url);

    // 1. 获取文件大小
    const headResponse = await fetch(url, { method: 'HEAD', headers });
    if (!headResponse.ok) {
      throw new Error(`HEAD request failed: ${headResponse.status}`);
    }

    const contentLength = parseInt(headResponse.headers.get('Content-Length') || '0');
    if (!contentLength || contentLength === 0) {
      throw new Error('Cannot get file size (Content-Length missing)');
    }

    console.log(`[Doc2X OCR] File size: ${(contentLength / 1024 / 1024).toFixed(2)} MB`);

    // 如果文件小于 20MB，直接下载
    if (contentLength < 20 * 1024 * 1024) {
      console.log('[Doc2X OCR] File is small enough, using direct download');
      const response = await fetch(url, { headers });
      if (!response.ok) throw new Error(`Download failed: ${response.status}`);
      return await response.blob();
    }

    // 2. 计算分片数量
    const numChunks = Math.ceil(contentLength / chunkSize);
    console.log(`[Doc2X OCR] Splitting into ${numChunks} chunks of ~${(chunkSize / 1024 / 1024).toFixed(1)} MB each`);

    // 3. 下载每个分片
    const chunks = [];
    for (let i = 0; i < numChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize - 1, contentLength - 1);

      console.log(`[Doc2X OCR] Downloading chunk ${i + 1}/${numChunks} (bytes ${start}-${end})`);

      const rangeHeaders = {
        ...headers,
        'Range': `bytes=${start}-${end}`
      };

      const response = await fetch(url, { headers: rangeHeaders });

      if (!response.ok && response.status !== 206) {
        throw new Error(`Chunk ${i + 1} download failed: ${response.status}`);
      }

      const chunkBlob = await response.blob();
      chunks.push(chunkBlob);

      console.log(`[Doc2X OCR] Chunk ${i + 1}/${numChunks} completed: ${(chunkBlob.size / 1024 / 1024).toFixed(2)} MB`);
    }

    // 4. 合并所有分片
    console.log('[Doc2X OCR] Merging chunks...');
    const fullBlob = new Blob(chunks);
    console.log(`[Doc2X OCR] Chunked download completed: ${(fullBlob.size / 1024 / 1024).toFixed(2)} MB`);

    return fullBlob;
  }

  async downloadAndExtractExport(zipUrl, statusData) {
    console.log('[Doc2X OCR] Downloading ZIP from:', zipUrl);

    // 通过 Worker 代理下载 ZIP，避免浏览器直连跨域
    let finalUrl = zipUrl;
    try {
      if (this.workerUrl) {
        const base = this.workerUrl.replace(/\/+$/, '');
        finalUrl = `${base}/doc2x/zip?url=${encodeURIComponent(zipUrl)}`;
      }
    } catch {}

    const headers = {};
    if (this.authKey) headers['X-Auth-Key'] = this.authKey;

    // 尝试分片下载（解决大文件传输问题）
    let zipBlob;
    try {
      zipBlob = await this.downloadWithChunks(finalUrl, headers);
    } catch (chunkError) {
      console.warn('[Doc2X OCR] Chunked download failed, trying direct download:', chunkError.message);
      // 回退到直接下载
      const zipResponse = await fetch(finalUrl, { headers });
      if (!zipResponse.ok) {
        throw new Error('下载导出 ZIP 失败');
      }
      zipBlob = await zipResponse.blob();
    }

    console.log(`[Doc2X OCR] Downloaded ZIP size: ${(zipBlob.size / 1024 / 1024).toFixed(2)} MB`);

    // 解压（使用 JSZip）
    if (typeof JSZip === 'undefined') {
      throw new Error('JSZip 未加载');
    }

    const zip = await JSZip.loadAsync(zipBlob);

    // 提取 Markdown 文件（可能是 output.md 或其他名称）
    const mdFiles = zip.file(/\.md$/);
    if (mdFiles.length === 0) {
      throw new Error('ZIP 中未找到 Markdown 文件');
    }

    const markdown = await mdFiles[0].async('string');

    // 提取图片
    const images = [];
    const imageFiles = zip.file(/\.(png|jpg|jpeg|gif|webp)$/i);

    for (const file of imageFiles) {
      const blob = await file.async('blob');
      const base64 = await this.blobToBase64(blob);
      const imageName = file.name.split('/').pop(); // 获取文件名

      images.push({
        id: imageName,
        name: imageName,
        data: this._ensureImageDataUri(base64, imageName)
      });
    }

    // 规范图片命名并替换 Markdown/HTML 中的图片路径为 images/<新名>
    let processedMarkdown = markdown;
    try {
      const extRegex = /\.([a-z0-9]+)$/i;
      const renameMap = new Map();
      images.forEach((img, idx) => {
        const m = String(img.name || img.id || '').match(extRegex);
        const ext = (m && m[1]) ? m[1].toLowerCase() : 'jpg';
        const newName = `img-${String(idx+1).padStart(3,'0')}.${ext}`;
        if ((img.name && img.name !== newName) || (img.id && img.id !== newName)) {
          renameMap.set(img.name || img.id, newName);
        }
      });
      // 替换 Markdown 与 HTML，尽量避免复杂正则
      const simpleEscape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const replaceRefs = (text, oldName, newName) => {
        let t = text;
        const mdVariants = [
          `](images/${oldName})`,
          `](./${oldName})`,
          `](${oldName})`
        ];
        mdVariants.forEach(v => { t = t.split(v).join(`](images/${newName})`); });
        try {
          const reMdAny = new RegExp(`\"?\]\([^\)\\]*${simpleEscape(oldName)}\)`, 'g');
          t = t.replace(reMdAny, m => m.replace(new RegExp(simpleEscape(oldName), 'g'), newName).replace(/\]\(/, '](images/'));
        } catch(_) {}
        try {
          const reSrc = new RegExp(`src=["']([^"']*/)?${simpleEscape(oldName)}["']`, 'gi');
          t = t.replace(reSrc, (m) => `src="images/${newName}"`);
        } catch(_) {}
        return t;
      };
      renameMap.forEach((newName, oldName) => {
        processedMarkdown = replaceRefs(processedMarkdown, oldName, newName);
      });
      // 更新 images 列表
      images.forEach((img, idx) => {
        const m = String(img.name || img.id || '').match(extRegex);
        const ext = (m && m[1]) ? m[1].toLowerCase() : 'jpg';
        const newName = `img-${String(idx+1).padStart(3,'0')}.${ext}`;
        img.id = newName;
        img.name = newName;
        img.data = this._ensureImageDataUri(img.data, newName);
      });
    } catch (e) { console.warn('[Doc2X OCR] 顺序命名替换失败(忽略):', e); }

    return {
      markdown: processedMarkdown,
      images,
      metadata: {
        engine: 'doc2x',
        source: 'export', // 来自导出（带图片）
        pageCount: statusData.page_count || 0
      }
    };
  }

  /**
   * 使用 CDN 图床版本（导出失败时的降级方案）
   * @param {Object} statusData - 状态端点返回的数据
   * @returns {Promise<Object>} { markdown, images, metadata }
   */
  async useCdnImages(statusData) {
    const markdown = statusData.markdown || '';

    // 提取 Markdown 中的 CDN 图片 URL
    const cdnImages = [];
    const imageRegex = /!\[([^\]]*)\]\((https?:\/\/[^\)]+)\)/g;
    let match;
    let imageIndex = 0;

    while ((match = imageRegex.exec(markdown)) !== null) {
      const altText = match[1];
      const cdnUrl = match[2];

      imageIndex++;
      const imageId = `cdn_image_${imageIndex}.png`;

      try {
        // 下载 CDN 图片并转为 base64
        const response = await fetch(cdnUrl);
        if (response.ok) {
          const blob = await response.blob();
          const base64 = await this.blobToBase64(blob);

          cdnImages.push({
            id: imageId,
            data: base64,
            originalUrl: cdnUrl
          });
        }
      } catch (error) {
        console.warn(`[Doc2X OCR] Failed to download CDN image: ${cdnUrl}`, error);
      }
    }

    // 替换 Markdown 中的 CDN URL 为 images/ 路径
    let processedMarkdown = markdown;
    imageIndex = 0;

    processedMarkdown = processedMarkdown.replace(imageRegex, (match, altText, url) => {
      imageIndex++;
      const imageId = `cdn_image_${imageIndex}.png`;
      return `![${altText}](images/${imageId})`;
    });

    return {
      markdown: processedMarkdown,
      images: cdnImages,
      metadata: {
        engine: 'doc2x',
        source: 'cdn', // 来自 CDN 图床
        pageCount: statusData.page_count || 0,
        note: 'Using CDN images as export failed after retries'
      }
    };
  }

  /**
   * 转义正则表达式特殊字符
   * @param {string} str
   * @returns {string}
   */
  escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  _ensureImageDataUri(data, name) {
    try {
      if (!data) return '';
      if (typeof data === 'string' && data.startsWith('data:')) {
        if (/^data:application\/octet-stream;base64,/i.test(data)) {
          const mime = this._guessMimeByName(name);
          return data.replace(/^data:application\/octet-stream/i, `data:${mime}`);
        }
        return data;
      }
      const mime = this._guessMimeByName(name);
      return `data:${mime};base64,${data}`;
    } catch { return data; }
  }

  _guessMimeByName(name) {
    const ext = String(name || '').split('.').pop().toLowerCase();
    if (ext === 'png') return 'image/png';
    if (ext === 'gif') return 'image/gif';
    if (ext === 'webp') return 'image/webp';
    if (ext === 'bmp') return 'image/bmp';
    if (ext === 'svg') return 'image/svg+xml';
    return 'image/jpeg';
  }
}

// 导出到全局
if (typeof window !== 'undefined') {
  window.Doc2XOcrAdapter = Doc2XOcrAdapter;
}

// 模块化导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Doc2XOcrAdapter;
}
