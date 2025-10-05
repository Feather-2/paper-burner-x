// js/process/ocr-adapters/base-adapter.js
// OCR 适配器基类

/**
 * OCR 适配器基类（抽象类）
 */
class BaseOcrAdapter {
  constructor(config) {
    this.config = config;
  }

  /**
   * 处理文件（子类必须实现）
   * @param {File} file - PDF 文件
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>} { markdown: string, images: [{id, data}], metadata: {} }
   */
  async processFile(file, onProgress) {
    throw new Error('processFile() must be implemented by subclass');
  }

  /**
   * Blob 转 Base64
   * @param {Blob} blob
   * @returns {Promise<string>}
   */
  blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * 生成唯一 ID
   * @returns {string}
   */
  generateId() {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 延迟函数
   * @param {number} ms - 毫秒
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 延迟函数（别名，兼容性）
   * @param {number} ms - 毫秒
   * @returns {Promise<void>}
   */
  delay(ms) {
    return this.sleep(ms);
  }
}

// 导出到全局（向后兼容 OcrAdapter 名称）
if (typeof window !== 'undefined') {
  window.BaseOcrAdapter = BaseOcrAdapter;
  window.OcrAdapter = BaseOcrAdapter; // 兼容旧代码
}
