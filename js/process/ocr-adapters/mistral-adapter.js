// process/ocr-adapters/mistral-adapter.js
// Mistral OCR 适配器 - 保持现有逻辑

/**
 * Mistral OCR 适配器
 * 基于现有的 processOcrResults 逻辑
 */
class MistralOcrAdapter extends OcrAdapter {
  constructor(config) {
    super(config);
    this.keys = config.keys || [];
    this.currentKeyIndex = 0;
    this.baseUrl = (config.baseUrl || 'https://api.mistral.ai').replace(/\/+$/, ''); // 移除尾部斜杠
  }

  /**
   * 处理文件
   * @param {File} file - PDF 文件
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>} { markdown, images, metadata }
   */
  async processFile(file, onProgress) {
    console.log('[Mistral OCR] Processing file:', file.name);

    onProgress?.(0, 100, '准备上传文件...');

    // 调用 Mistral OCR API
    const ocrResponse = await this.callMistralOcr(file, onProgress);

    onProgress?.(80, 100, '处理 OCR 结果...');

    // 处理结果（使用现有的 processOcrResults 逻辑）
    const result = this.processOcrResults(ocrResponse);

    onProgress?.(100, 100, '完成');

    return {
      markdown: result.markdown,
      images: result.images,
      metadata: {
        engine: 'mistral',
        pageCount: ocrResponse.pages?.length || 0
      }
    };
  }

  /**
   * 调用 Mistral OCR API
   * @param {File} file
   * @param {Function} onProgress
   * @returns {Promise<Object>} OCR 响应
   */
  async callMistralOcr(file, onProgress) {
    if (this.keys.length === 0) {
      throw new Error('未配置 Mistral API Keys');
    }

    // 轮询使用不同的 key（简单负载均衡）
    const apiKey = this.keys[this.currentKeyIndex % this.keys.length];
    this.currentKeyIndex++;

    try {
      // 1. 上传文件到 Mistral
      onProgress?.(10, 100, '上传到 Mistral...');
      const fileId = await this.uploadToMistral(file, apiKey);
      console.log('[Mistral OCR] File ID:', fileId);

      // 2. 等待文件处理完成
      onProgress?.(30, 100, '等待文件处理...');
      await this.sleep(1000);

      // 3. 获取签名 URL
      onProgress?.(40, 100, '获取签名 URL...');
      const signedUrl = await this.getMistralSignedUrl(fileId, apiKey);
      console.log('[Mistral OCR] Signed URL obtained');

      // 4. 调用 OCR API
      onProgress?.(50, 100, '开始 OCR 处理...');
      const ocrData = await this.callOcrApi(signedUrl, apiKey);

      // 5. 清理文件（异步，不阻塞）
      this.deleteMistralFile(fileId, apiKey).catch(err => {
        console.warn('[Mistral OCR] 文件清理失败:', err);
      });

      return ocrData;

    } catch (error) {
      // 判断是否为 API Key 失效错误
      if (error.message && (
        error.message.includes('无效') ||
        error.message.includes('未授权') ||
        error.message.includes('401') ||
        error.message.toLowerCase().includes('invalid api key') ||
        error.message.toLowerCase().includes('unauthorized')
      )) {
        throw new Error(`Mistral API Key 可能已失效: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * 上传文件到 Mistral
   * @param {File} file
   * @param {string} apiKey
   * @returns {Promise<string>} file_id
   */
  async uploadToMistral(file, apiKey) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('purpose', 'ocr');

    const response = await fetch(`${this.baseUrl}/v1/files`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      },
      body: formData
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`上传到 Mistral 失败 (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    if (!data || !data.id) {
      throw new Error('上传成功但未返回文件 ID');
    }

    return data.id;
  }

  /**
   * 获取 Mistral 签名 URL
   * @param {string} fileId
   * @param {string} apiKey
   * @returns {Promise<string>} signed_url
   */
  async getMistralSignedUrl(fileId, apiKey) {
    const response = await fetch(`${this.baseUrl}/v1/files/${fileId}/url`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`获取签名 URL 失败 (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    if (!data || !data.url) {
      throw new Error('获取的签名 URL 格式不正确');
    }

    return data.url;
  }

  /**
   * 调用 OCR API
   * @param {string} signedUrl
   * @param {string} apiKey
   * @returns {Promise<Object>} OCR 数据
   */
  async callOcrApi(signedUrl, apiKey) {
    const response = await fetch(`${this.baseUrl}/v1/ocr`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        model: 'mistral-ocr-latest',
        document: { type: 'document_url', document_url: signedUrl },
        include_image_base64: true
      })
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`OCR 处理失败 (${response.status}): ${errorText}`);
    }

    const ocrData = await response.json();
    if (!ocrData || !ocrData.pages) {
      throw new Error('OCR 处理成功但返回的数据格式不正确');
    }

    return ocrData;
  }

  /**
   * 删除 Mistral 文件
   * @param {string} fileId
   * @param {string} apiKey
   * @returns {Promise<void>}
   */
  async deleteMistralFile(fileId, apiKey) {
    if (!fileId || !apiKey) return;

    try {
      const response = await fetch(`${this.baseUrl}/v1/files/${fileId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${apiKey}`
        }
      });

      if (!response.ok) {
        console.warn(`[Mistral OCR] 文件删除失败: ${response.status}`);
      }
    } catch (error) {
      console.warn('[Mistral OCR] 文件删除错误:', error);
    }
  }

  /**
   * 处理 OCR 结果
   * 来自 js/process/ocr.js 的 processOcrResults 函数
   * @param {Object} ocrResponse - OCR API 返回的 JSON
   * @returns {Object} { markdown: string, images: Array }
   */
  processOcrResults(ocrResponse) {
    let markdownContent = '';
    let imagesData = [];

    try {
      for (const page of ocrResponse.pages) {
        const pageImages = {};

        // 提取图片
        if (page.images && Array.isArray(page.images)) {
          for (const img of page.images) {
            if (img.id && img.image_base64) {
              const imgId = img.id;
              const imgData = img.image_base64;
              imagesData.push({ id: imgId, data: imgData });
              // 记录图片 ID 到 markdown 路径的映射
              pageImages[imgId] = `images/${imgId}.png`;
            }
          }
        }

        let pageMarkdown = page.markdown || '';

        // 替换图片路径
        for (const [imgName, imgPath] of Object.entries(pageImages)) {
          // 转义特殊字符
          const escapedImgName = typeof escapeRegex === 'function'
            ? escapeRegex(imgName)
            : imgName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

          const imgRegex = new RegExp(`!\\[([^\\]]*?)\\]\\(${escapedImgName}\\)`, 'g');
          pageMarkdown = pageMarkdown.replace(imgRegex, (match, altText) => {
            const finalAltText = altText || imgName;
            return `![${finalAltText}](${imgPath})`;
          });
        }

        markdownContent += pageMarkdown + '\n\n';
      }

      return { markdown: markdownContent.trim(), images: imagesData };
    } catch (error) {
      console.error('[Mistral OCR] 处理结果时出错:', error);
      throw new Error(`处理 OCR 结果失败: ${error.message}`);
    }
  }
}

// 导出到全局
if (typeof window !== 'undefined') {
  window.MistralOcrAdapter = MistralOcrAdapter;
}

// 模块化导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MistralOcrAdapter;
}
