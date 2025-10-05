// process/ocr-adapters/mineru-adapter.js
// MinerU OCR 适配器

/**
 * MinerU OCR 适配器
 * 特性：
 * - 返回 full.md + images/
 * - 保存原始 PDF 和 JSON（供 V2 结构化翻译使用）
 */
class MinerUOcrAdapter extends OcrAdapter {
  constructor(config) {
    super(config);
    this.token = config.token;
    this.workerUrl = config.workerUrl;
    this.authKey = config.authKey; // Worker Auth Key (可选)
    this.tokenMode = config.tokenMode || 'frontend'; // 'frontend' 或 'worker'
    this.options = {
      is_ocr: config.enableOcr !== false,
      enable_formula: config.enableFormula !== false,
      enable_table: config.enableTable !== false
    };
  }

  /**
   * 转义用于正则的字符串
   */
  escapeRegex(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * 处理文件
   * @param {File} file - PDF 文件
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>} { markdown, images, metadata }
   */
  async processFile(file, onProgress) {
    console.log('[MinerU OCR] Processing file:', file.name);

    // 1. 上传文件
    onProgress?.(0, 100, '上传文件到 MinerU...');
    const batchId = await this.uploadFile(file);

    console.log('[MinerU OCR] Batch ID:', batchId);

    // 2. 轮询结果
    onProgress?.(10, 100, '等待 MinerU 处理...');
    const zipUrl = await this.pollResult(batchId, onProgress);

    console.log('[MinerU OCR] ZIP URL:', zipUrl);

    // 3. 下载并解压 ZIP
    onProgress?.(90, 100, '下载并解析结果...');
    const result = await this.downloadAndExtract(zipUrl);

    onProgress?.(100, 100, '完成');

    return result;
  }

  /**
   * 构建请求头
   * @returns {Object} headers
   */
  buildHeaders() {
    const headers = {};

    // Worker Auth Key (可选)
    if (this.authKey) {
      headers['X-Auth-Key'] = this.authKey;
    }

    // MinerU Token (仅在前端透传模式)
    if (this.tokenMode === 'frontend' && this.token) {
      headers['X-MinerU-Key'] = this.token;
    }

    return headers;
  }

  /**
   * 上传文件
   * @param {File} file
   * @returns {Promise<string>} batch_id
   */
  async uploadFile(file) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('is_ocr', this.options.is_ocr.toString());
    formData.append('enable_formula', this.options.enable_formula.toString());
    formData.append('enable_table', this.options.enable_table.toString());

    const response = await fetch(`${this.workerUrl}/mineru/upload`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: formData
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(`MinerU 上传失败: ${error.error || response.statusText}`);
    }

    const data = await response.json();
    return data.batch_id;
  }

  /**
   * 轮询结果
   * @param {string} batchId
   * @param {Function} onProgress
   * @returns {Promise<string>} ZIP URL
   */
  async pollResult(batchId, onProgress) {
    const maxAttempts = 100;
    const pollInterval = 3000; // 3 秒

    for (let i = 0; i < maxAttempts; i++) {
      const response = await fetch(`${this.workerUrl}/mineru/result/${batchId}`, {
        headers: this.buildHeaders()
      });

      if (!response.ok) {
        throw new Error('MinerU 查询失败');
      }

      const data = await response.json();
      const result = data.extract_result[0];

      if (result.state === 'running' && result.extract_progress) {
        const { extracted_pages, total_pages } = result.extract_progress;
        const percent = Math.floor((extracted_pages / total_pages) * 70) + 10;
        onProgress?.(percent, 100, `处理中: ${extracted_pages}/${total_pages} 页`);
      }

      if (result.state === 'done') {
        return result.full_zip_url || result.fullZipUrl;
      }

      if (result.state === 'failed') {
        throw new Error(result.err_msg || 'MinerU 处理失败');
      }

      await this.sleep(pollInterval);
    }

    throw new Error('MinerU 处理超时');
  }

  /**
   * 下载并解压 ZIP
   * @param {string} zipUrl
   * @returns {Promise<Object>} { markdown, images, metadata }
   */
  async downloadAndExtract(zipUrl) {
    // 通过 Worker 代理下载 ZIP，避免浏览器直连跨域
    let finalUrl = zipUrl;
    try {
      if (this.workerUrl) {
        const base = this.workerUrl.replace(/\/+$/, '');
        finalUrl = `${base}/mineru/zip?url=${encodeURIComponent(zipUrl)}`;
      }
    } catch {}

    const headers = {};
    if (this.authKey) headers['X-Auth-Key'] = this.authKey;

    const zipResponse = await fetch(finalUrl, { headers });
    if (!zipResponse.ok) {
      throw new Error('下载 ZIP 失败');
    }

    const zipBlob = await zipResponse.blob();

    // 解压（使用 JSZip）
    if (typeof JSZip === 'undefined') {
      throw new Error('JSZip 未加载');
    }

    const zip = await JSZip.loadAsync(zipBlob);

    // 提取 full.md
    const fullMdFile = zip.file('full.md');
    if (!fullMdFile) {
      throw new Error('ZIP 中未找到 full.md');
    }
    let markdown = await fullMdFile.async('string');

    // 提取 images/
    const images = [];
    const imageFiles = zip.file(/^images\/.+/);
    for (const file of imageFiles) {
      const blob = await file.async('blob');
      const base64 = await this.blobToBase64(blob);
      const name = file.name.replace('images/', '');
      images.push({
        id: name,
        name: name,
        data: this._ensureImageDataUri(base64, name)
      });
    }

    // 规范图片命名（顺序命名）并统一将 Markdown/HTML 中的图片引用改为 images/<新文件名>
    try {
      // 1) 建立重命名表
      const renameMap = new Map(); // oldName -> newName
      const extRegex = /\.([a-z0-9]+)$/i;
      images.forEach((img, idx) => {
        const m = String(img.name || img.id || '').match(extRegex);
        const ext = (m && m[1]) ? m[1].toLowerCase() : 'jpg';
        const newName = `img-${String(idx+1).padStart(3,'0')}.${ext}`;
        if ((img.name && img.name !== newName) || (img.id && img.id !== newName)) {
          renameMap.set(img.name || img.id, newName);
        }
      });
      // 2) 应用重命名到 Markdown/HTML，尽量避免复杂正则
      const simpleEscape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const replaceRefs = (text, oldName, newName) => {
        let t = text;
        // Markdown 直接/相对路径
        const mdVariants = [
          `](images/${oldName})`,
          `](./${oldName})`,
          `](${oldName})`
        ];
        mdVariants.forEach(v => { t = t.split(v).join(`](images/${newName})`); });
        // 更通用：只要是 ](xxx/oldName) 也替换
        try {
          const reMdAny = new RegExp(`\"?\]\([^\)\\]*${simpleEscape(oldName)}\)`, 'g');
          t = t.replace(reMdAny, m => m.replace(new RegExp(simpleEscape(oldName), 'g'), newName).replace(/\]\(/, '](images/'));
        } catch(_) {}
        // HTML src="...oldName"
        try {
          const reSrc = new RegExp(`src=["']([^"']*/)?${simpleEscape(oldName)}["']`, 'gi');
          t = t.replace(reSrc, (m) => `src="images/${newName}"`);
        } catch(_) {}
        return t;
      };
      renameMap.forEach((newName, oldName) => {
        markdown = replaceRefs(markdown, oldName, newName);
      });
      // 3) 同步更新 images 列表的 id/name
      images.forEach((img, idx) => {
        const m = String(img.name || img.id || '').match(extRegex);
        const ext = (m && m[1]) ? m[1].toLowerCase() : 'jpg';
        const newName = `img-${String(idx+1).padStart(3,'0')}.${ext}`;
        img.id = newName;
        img.name = newName;
        img.data = this._ensureImageDataUri(img.data, newName);
      });
    } catch (e) { console.warn('[MinerU OCR] 图片路径重写失败(忽略):', e); }

    // 提取元数据（用于 V2 结构化翻译）
    let layoutJson = null;
    let contentListJson = null;
    let originPdf = null;

    try {
      const layoutFile = zip.file('layout.json');
      if (layoutFile) {
        const layoutStr = await layoutFile.async('string');
        layoutJson = JSON.parse(layoutStr);
      }

      const contentListFile = zip.file(/content_list\.json$/)[0];
      if (contentListFile) {
        const contentListStr = await contentListFile.async('string');
        contentListJson = JSON.parse(contentListStr);
      }

      const originPdfFile = zip.file(/_origin\.pdf$/)[0];
      if (originPdfFile) {
        originPdf = await originPdfFile.async('blob');
      }
    } catch (e) {
      console.warn('[MinerU OCR] 提取元数据时出错:', e);
    }

    return {
      markdown,
      images,
      metadata: {
        engine: 'mineru',
        layoutJson,
        contentListJson,
        originalPdf: originPdf,
        // V2 预留接口
        supportsStructuredTranslation: true
      }
    };
  }

  _ensureImageDataUri(data, name) {
    try {
      if (!data) return '';
      if (typeof data === 'string' && data.startsWith('data:')) {
        // 修正为正确的 mime
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
  window.MinerUOcrAdapter = MinerUOcrAdapter;
}

// 模块化导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MinerUOcrAdapter;
}
