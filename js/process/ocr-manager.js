// process/ocr-manager.js
// OCR 管理器 - 统一的 OCR 接口

/**
 * OCR 管理器
 * 负责：
 * 1. 根据配置创建对应的适配器
 * 2. 统一的上传和处理接口
 * 3. 统一的输出格式：{ markdown: string, images: [{id, data}], metadata: {} }
 */
class OcrManager {
  constructor() {
    this.adapter = null;
  }

  /**
   * 初始化适配器
   * @returns {Promise<void>}
   */
  async initialize() {
    const config = this.getConfig();
    this.adapter = this.createAdapter(config);
    console.log(`[OCR Manager] Initialized with ${config.engine} adapter`);
  }

  /**
   * 获取当前 OCR 配置
   * @returns {Object} 配置对象
   */
  getConfig() {
    if (typeof window !== 'undefined' && window.ocrSettingsManager) {
      return window.ocrSettingsManager.getCurrentConfig();
    }

    // Fallback: 直接从 localStorage 读取
    const engine = localStorage.getItem('ocrEngine') || 'mistral';

    switch (engine) {
      case 'mistral':
        // 使用 KeyManager 的统一 Key 池来管理 Mistral OCR 的 Keys
        // 读取 KeyManager；若为空则回退到 ocrMistralKeys（兼容旧配置）
        try {
          const loadFn = (typeof window !== 'undefined' && typeof window.loadModelKeys === 'function')
            ? window.loadModelKeys
            : (typeof loadModelKeys === 'function' ? loadModelKeys : null);
          let keysFromManager = [];
          if (loadFn) {
            const all = loadFn('mistral') || [];
            keysFromManager = all
              .filter(k => k && k.value && k.value.trim() && (k.status === 'valid' || k.status === 'untested'))
              .map(k => k.value.trim());
          }
          let keysFromLegacy = (localStorage.getItem('ocrMistralKeys') || '')
            .split('\n')
            .map(k => k.trim())
            .filter(Boolean);
          let merged = keysFromManager && keysFromManager.length > 0 ? keysFromManager : keysFromLegacy;

          // 可选：若管理器为空但 legacy 有值，尝试迁移到 KeyManager（非强制）
          if ((!keysFromManager || keysFromManager.length === 0) && keysFromLegacy.length > 0) {
            try {
              const saveFn = (typeof window !== 'undefined' && typeof window.saveModelKeys === 'function')
                ? window.saveModelKeys : (typeof saveModelKeys === 'function' ? saveModelKeys : null);
              if (saveFn) {
                const objects = keysFromLegacy.map((v, i) => ({ id: (typeof generateUUID === 'function' ? generateUUID() : String(Date.now())+'-'+i), value: v, remark: '', status: 'untested', order: i }));
                saveFn('mistral', objects);
              }
            } catch (mErr) { /* ignore migration errors */ }
          }

          return { engine: 'mistral', keys: merged };
        } catch (e) {
          console.warn('[OCR Manager] 加载 Mistral Keys 出错，回退到 ocrMistralKeys。', e);
          const legacy = (localStorage.getItem('ocrMistralKeys') || '')
            .split('\n')
            .map(k => k.trim())
            .filter(Boolean);
          return { engine: 'mistral', keys: legacy };
        }

      case 'mineru':
        return {
          engine: 'mineru',
          token: localStorage.getItem('ocrMinerUToken') || '',
          workerUrl: localStorage.getItem('ocrMinerUWorkerUrl') || '',
          authKey: localStorage.getItem('ocrWorkerAuthKey') || '',
          tokenMode: localStorage.getItem('ocrMinerUTokenMode') || 'frontend',
          enableOcr: localStorage.getItem('ocrMinerUEnableOcr') !== 'false',
          enableFormula: localStorage.getItem('ocrMinerUEnableFormula') !== 'false',
          enableTable: localStorage.getItem('ocrMinerUEnableTable') !== 'false'
        };

      case 'doc2x':
        return {
          engine: 'doc2x',
          token: localStorage.getItem('ocrDoc2XToken') || '',
          workerUrl: localStorage.getItem('ocrDoc2XWorkerUrl') || '',
          authKey: localStorage.getItem('ocrWorkerAuthKey') || '',
          tokenMode: localStorage.getItem('ocrDoc2XTokenMode') || 'frontend'
          // 注意：不再需要 exportFormat，因为我们总是导出 Markdown + 图片
        };

      default:
        throw new Error(`Unknown OCR engine: ${engine}`);
    }
  }

  /**
   * 创建适配器
   * @param {Object} config - 配置对象
   * @returns {OcrAdapter} 适配器实例
   */
  createAdapter(config) {
    switch (config.engine) {
      case 'mistral':
        if (typeof MistralOcrAdapter === 'undefined') {
          throw new Error('MistralOcrAdapter not loaded');
        }
        return new MistralOcrAdapter(config);

      case 'mineru':
        if (typeof MinerUOcrAdapter === 'undefined') {
          throw new Error('MinerUOcrAdapter not loaded');
        }
        return new MinerUOcrAdapter(config);

      case 'doc2x':
        if (typeof Doc2XOcrAdapter === 'undefined') {
          throw new Error('Doc2XOcrAdapter not loaded');
        }
        return new Doc2XOcrAdapter(config);

      default:
        throw new Error(`Unknown OCR engine: ${config.engine}`);
    }
  }

  /**
   * 验证配置
   * @returns {Object} { valid: boolean, message: string }
   */
  validateConfig() {
    if (typeof window !== 'undefined' && window.ocrSettingsManager) {
      return window.ocrSettingsManager.validateConfig();
    }

    // Fallback 验证
    const config = this.getConfig();

    switch (config.engine) {
      case 'mistral':
        if (!config.keys || config.keys.length === 0) {
          return { valid: false, message: '请配置 Mistral OCR API Keys' };
        }
        break;

      case 'mineru':
        // 前端透传模式需要 Token，Worker 配置模式不需要
        if (config.tokenMode === 'frontend' && !config.token) {
          return { valid: false, message: '请配置 MinerU Token（前端透传模式）' };
        }
        if (!config.workerUrl) {
          return { valid: false, message: '请配置 MinerU Worker URL' };
        }
        break;

      case 'doc2x':
        // 前端透传模式需要 Token，Worker 配置模式不需要
        if (config.tokenMode === 'frontend' && !config.token) {
          return { valid: false, message: '请配置 Doc2X Token（前端透传模式）' };
        }
        if (!config.workerUrl) {
          return { valid: false, message: '请配置 Doc2X Worker URL' };
        }
        break;
    }

    return { valid: true, message: '' };
  }

  /**
   * 上传并处理文件
   * @param {File} file - PDF 文件
   * @param {Function} onProgress - 进度回调 (current, total, message)
   * @returns {Promise<Object>} { markdown: string, images: [{id, data}], metadata: {} }
   */
  async processFile(file, onProgress) {
    // 验证配置
    const validation = this.validateConfig();
    if (!validation.valid) {
      throw new Error(validation.message);
    }

    // 初始化适配器
    await this.initialize();

    console.log(`[OCR Manager] Processing file: ${file.name} with ${this.adapter.constructor.name}`);

    // 调用适配器处理
    return await this.adapter.processFile(file, onProgress);
  }
}

/**
 * OCR 适配器基类（抽象类）
 */
class OcrAdapter {
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
   * 延迟
   * @param {number} ms - 毫秒
   * @returns {Promise<void>}
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// 导出到全局（非模块化环境）
if (typeof window !== 'undefined') {
  window.OcrManager = OcrManager;
  window.OcrAdapter = OcrAdapter;
}

// 模块化导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { OcrManager, OcrAdapter };
}
