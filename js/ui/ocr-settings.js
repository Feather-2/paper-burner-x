// ui/ocr-settings.js
// OCR 配置管理模块 - 独立于翻译配置

/**
 * OCR 设置管理器
 * 负责：
 * 1. 加载/保存 OCR 配置（独立于翻译配置）
 * 2. 引擎切换逻辑
 * 3. 首次使用提示
 */
class OcrSettingsManager {
  constructor() {
    this.BATCH_SIZE = 10; // MinerU V2 批量翻译的批次大小（预留）

    // localStorage keys（所有以 'ocr' 开头，与翻译配置隔离）
    this.keys = {
      engine: 'ocrEngine',
      // Worker Auth Key (共享)
      workerAuthKey: 'ocrWorkerAuthKey',
      // Mistral OCR
      mistralKeys: 'ocrMistralKeys',
      // MinerU
      mineruToken: 'ocrMinerUToken',
      mineruWorkerUrl: 'ocrMinerUWorkerUrl',
      mineruTokenMode: 'ocrMinerUTokenMode',
      mineruEnableOcr: 'ocrMinerUEnableOcr',
      mineruEnableFormula: 'ocrMinerUEnableFormula',
      mineruEnableTable: 'ocrMinerUEnableTable',
      // Doc2X
      doc2xToken: 'ocrDoc2XToken',
      doc2xWorkerUrl: 'ocrDoc2XWorkerUrl',
      doc2xTokenMode: 'ocrDoc2XTokenMode',
      doc2xFormulaMode: 'ocrDoc2XFormulaMode',
      doc2xExportFormat: 'ocrDoc2XExportFormat',
      // 首次提示标记
      firstTimeTipShown: 'ocrFirstTimeTipShown'
    };

    // DOM 元素
    this.elements = {};

    this.init();
  }

  /**
   * 初始化
   */
  init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.onDOMReady());
    } else {
      this.onDOMReady();
    }
  }

  /**
   * DOM 加载完成后的初始化
   */
  onDOMReady() {
    this.cacheElements();
    this.loadSettings();
    this.bindEvents();
    this.showFirstTimeTip();

    console.log('[OCR Settings] Initialized');
  }

  /**
   * 缓存 DOM 元素引用
   */
  cacheElements() {
    // OCR 引擎选择
    this.elements.ocrEngine = document.getElementById('ocrEngine');

    // Mistral OCR
    this.elements.mistralOcrKeys = document.getElementById('mistralOcrKeys');
    this.elements.mistralOcrConfig = document.getElementById('mistralOcrConfig');

    // MinerU
    this.elements.mineruToken = document.getElementById('mineruToken');
    this.elements.mineruWorkerUrl = document.getElementById('mineruWorkerUrl');
    this.elements.mineruEnableOcr = document.getElementById('mineruEnableOcr');
    this.elements.mineruEnableFormula = document.getElementById('mineruEnableFormula');
    this.elements.mineruEnableTable = document.getElementById('mineruEnableTable');
    this.elements.mineruOcrConfig = document.getElementById('mineruOcrConfig');

    // Doc2X
    this.elements.doc2xToken = document.getElementById('doc2xToken');
    this.elements.doc2xWorkerUrl = document.getElementById('doc2xWorkerUrl');
    this.elements.doc2xFormulaMode = document.getElementById('doc2xFormulaMode');
    this.elements.doc2xExportFormat = document.getElementById('doc2xExportFormat');
    this.elements.doc2xOcrConfig = document.getElementById('doc2xOcrConfig');
  }

  /**
   * 加载所有 OCR 配置
   */
  loadSettings() {
    try {
      // 引擎选择
      const engine = localStorage.getItem(this.keys.engine) || 'mistral';
      if (this.elements.ocrEngine) {
        this.elements.ocrEngine.value = engine;
        this.switchEngine(engine); // 显示对应的配置面板
      }

      // Mistral OCR
      if (this.elements.mistralOcrKeys) {
        this.elements.mistralOcrKeys.value = localStorage.getItem(this.keys.mistralKeys) || '';
      }

      // MinerU
      if (this.elements.mineruToken) {
        this.elements.mineruToken.value = localStorage.getItem(this.keys.mineruToken) || '';
      }
      if (this.elements.mineruWorkerUrl) {
        this.elements.mineruWorkerUrl.value = localStorage.getItem(this.keys.mineruWorkerUrl) || '';
      }
      if (this.elements.mineruEnableOcr) {
        this.elements.mineruEnableOcr.checked = localStorage.getItem(this.keys.mineruEnableOcr) !== 'false';
      }
      if (this.elements.mineruEnableFormula) {
        this.elements.mineruEnableFormula.checked = localStorage.getItem(this.keys.mineruEnableFormula) !== 'false';
      }
      if (this.elements.mineruEnableTable) {
        this.elements.mineruEnableTable.checked = localStorage.getItem(this.keys.mineruEnableTable) !== 'false';
      }

      // Doc2X
      if (this.elements.doc2xToken) {
        this.elements.doc2xToken.value = localStorage.getItem(this.keys.doc2xToken) || '';
      }
      if (this.elements.doc2xWorkerUrl) {
        this.elements.doc2xWorkerUrl.value = localStorage.getItem(this.keys.doc2xWorkerUrl) || '';
      }
      if (this.elements.doc2xFormulaMode) {
        this.elements.doc2xFormulaMode.value = localStorage.getItem(this.keys.doc2xFormulaMode) || 'dollar';
      }
      if (this.elements.doc2xExportFormat) {
        this.elements.doc2xExportFormat.value = localStorage.getItem(this.keys.doc2xExportFormat) || '';
      }

      console.log('[OCR Settings] Settings loaded');
    } catch (error) {
      console.error('[OCR Settings] Failed to load settings:', error);
    }
  }

  /**
   * 保存所有 OCR 配置
   */
  saveSettings() {
    try {
      // 引擎选择
      if (this.elements.ocrEngine) {
        localStorage.setItem(this.keys.engine, this.elements.ocrEngine.value);
      }

      // Mistral OCR
      if (this.elements.mistralOcrKeys) {
        localStorage.setItem(this.keys.mistralKeys, this.elements.mistralOcrKeys.value);
      }

      // MinerU
      if (this.elements.mineruToken) {
        localStorage.setItem(this.keys.mineruToken, this.elements.mineruToken.value);
      }
      if (this.elements.mineruWorkerUrl) {
        localStorage.setItem(this.keys.mineruWorkerUrl, this.elements.mineruWorkerUrl.value);
      }
      if (this.elements.mineruEnableOcr) {
        localStorage.setItem(this.keys.mineruEnableOcr, this.elements.mineruEnableOcr.checked);
      }
      if (this.elements.mineruEnableFormula) {
        localStorage.setItem(this.keys.mineruEnableFormula, this.elements.mineruEnableFormula.checked);
      }
      if (this.elements.mineruEnableTable) {
        localStorage.setItem(this.keys.mineruEnableTable, this.elements.mineruEnableTable.checked);
      }

      // Doc2X
      if (this.elements.doc2xToken) {
        localStorage.setItem(this.keys.doc2xToken, this.elements.doc2xToken.value);
      }
      if (this.elements.doc2xWorkerUrl) {
        localStorage.setItem(this.keys.doc2xWorkerUrl, this.elements.doc2xWorkerUrl.value);
      }
      if (this.elements.doc2xFormulaMode) {
        localStorage.setItem(this.keys.doc2xFormulaMode, this.elements.doc2xFormulaMode.value);
      }
      if (this.elements.doc2xExportFormat) {
        localStorage.setItem(this.keys.doc2xExportFormat, this.elements.doc2xExportFormat.value);
      }

      console.log('[OCR Settings] Settings saved');
    } catch (error) {
      console.error('[OCR Settings] Failed to save settings:', error);
    }
  }

  /**
   * 绑定事件监听器
   */
  bindEvents() {
    // 引擎切换
    if (this.elements.ocrEngine) {
      this.elements.ocrEngine.addEventListener('change', (e) => {
        this.switchEngine(e.target.value);
        this.saveSettings();
      });
    }

    // 所有输入框自动保存
    const inputIds = [
      'mistralOcrKeys',
      'mineruToken', 'mineruWorkerUrl',
      'mineruEnableOcr', 'mineruEnableFormula', 'mineruEnableTable',
      'doc2xToken', 'doc2xWorkerUrl',
      'doc2xFormulaMode', 'doc2xExportFormat'
    ];

    inputIds.forEach(id => {
      const el = this.elements[id];
      if (el) {
        el.addEventListener('change', () => this.saveSettings());

        // 对于 textarea 和 text input，也监听 input 事件（实时保存）
        if (el.tagName === 'TEXTAREA' || el.type === 'text' || el.type === 'password') {
          el.addEventListener('input', this.debounce(() => this.saveSettings(), 500));
        }
      }
    });

    console.log('[OCR Settings] Events bound');
  }

  /**
   * 切换 OCR 引擎（显示/隐藏对应配置面板）
   * @param {string} engine - 引擎名称: 'mistral' | 'mineru' | 'doc2x'
   */
  switchEngine(engine) {
    // 隐藏所有配置面板
    if (this.elements.mistralOcrConfig) {
      this.elements.mistralOcrConfig.classList.add('hidden');
    }
    if (this.elements.mineruOcrConfig) {
      this.elements.mineruOcrConfig.classList.add('hidden');
    }
    if (this.elements.doc2xOcrConfig) {
      this.elements.doc2xOcrConfig.classList.add('hidden');
    }

    // 显示选中的配置面板
    switch (engine) {
      case 'mistral':
        if (this.elements.mistralOcrConfig) {
          this.elements.mistralOcrConfig.classList.remove('hidden');
        }
        break;
      case 'mineru':
        if (this.elements.mineruOcrConfig) {
          this.elements.mineruOcrConfig.classList.remove('hidden');
        }
        break;
      case 'doc2x':
        if (this.elements.doc2xOcrConfig) {
          this.elements.doc2xOcrConfig.classList.remove('hidden');
        }
        break;
    }

    console.log(`[OCR Settings] Switched to ${engine}`);
  }

  /**
   * 首次使用提示（可选功能）
   * 检测是否已有翻译用的 Mistral Keys，提示用户是否复制到 OCR 配置
   */
  showFirstTimeTip() {
    try {
      const ocrKeys = localStorage.getItem(this.keys.mistralKeys);
      const translationKeys = localStorage.getItem('mistralApiKeys'); // 翻译用的 Keys
      const tipShown = localStorage.getItem(this.keys.firstTimeTipShown);

      // 条件：OCR 未配置 + 翻译已配置 + 提示未显示过
      if (!ocrKeys && translationKeys && !tipShown) {
        const message =
          '检测到您已配置 Mistral 翻译 API Keys。\n\n' +
          '提示：OCR 功能使用独立的 API Key 配置。\n' +
          '是否将翻译配置复制到 OCR 配置中作为初始值？\n\n' +
          '（您可以稍后在设置中单独修改）';

        if (confirm(message)) {
          localStorage.setItem(this.keys.mistralKeys, translationKeys);
          if (this.elements.mistralOcrKeys) {
            this.elements.mistralOcrKeys.value = translationKeys;
          }
          console.log('[OCR Settings] Copied translation keys to OCR config');
        }

        // 标记提示已显示
        localStorage.setItem(this.keys.firstTimeTipShown, 'true');
      }
    } catch (error) {
      console.error('[OCR Settings] Failed to show first time tip:', error);
    }
  }

  /**
   * 获取当前选择的 OCR 引擎配置
   * @returns {Object} 配置对象
   */
  getCurrentConfig() {
    const engine = localStorage.getItem(this.keys.engine) || 'mistral';

    switch (engine) {
      case 'mistral':
        // 优先从 Key 管理器读取 Mistral Keys，若为空则回退到 legacy 文本框存储（ocrMistralKeys）
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
          const legacy = (localStorage.getItem(this.keys.mistralKeys) || '')
            .split('\n')
            .map(k => k.trim())
            .filter(Boolean);
          const merged = (keysFromManager && keysFromManager.length > 0) ? keysFromManager : legacy;
          return { engine: 'mistral', keys: merged };
        } catch (e) {
          console.warn('[OCR Settings] 读取 Mistral Keys 失败，回退 legacy。', e);
          const legacy = (localStorage.getItem(this.keys.mistralKeys) || '')
            .split('\n')
            .map(k => k.trim())
            .filter(Boolean);
          return { engine: 'mistral', keys: legacy };
        }

      case 'mineru':
        return {
          engine: 'mineru',
          token: localStorage.getItem(this.keys.mineruToken) || '',
          workerUrl: localStorage.getItem(this.keys.mineruWorkerUrl) || '',
          authKey: localStorage.getItem(this.keys.workerAuthKey) || '',
          tokenMode: localStorage.getItem(this.keys.mineruTokenMode) || 'frontend',
          enableOcr: localStorage.getItem(this.keys.mineruEnableOcr) !== 'false',
          enableFormula: localStorage.getItem(this.keys.mineruEnableFormula) !== 'false',
          enableTable: localStorage.getItem(this.keys.mineruEnableTable) !== 'false'
        };

      case 'doc2x':
        return {
          engine: 'doc2x',
          token: localStorage.getItem(this.keys.doc2xToken) || '',
          workerUrl: localStorage.getItem(this.keys.doc2xWorkerUrl) || '',
          authKey: localStorage.getItem(this.keys.workerAuthKey) || '',
          tokenMode: localStorage.getItem(this.keys.doc2xTokenMode) || 'frontend',
          formulaMode: localStorage.getItem(this.keys.doc2xFormulaMode) || 'dollar',
          exportFormat: localStorage.getItem(this.keys.doc2xExportFormat) || ''
        };

      default:
        throw new Error(`Unknown OCR engine: ${engine}`);
    }
  }

  /**
   * 验证 OCR 配置是否完整
   * @returns {Object} { valid: boolean, message: string }
   */
  validateConfig() {
    const config = this.getCurrentConfig();

    switch (config.engine) {
      case 'mistral':
        // 支持 Key 管理器 + legacy 两种来源（由 getCurrentConfig 聚合）
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
   * 防抖函数
   * @param {Function} func - 要防抖的函数
   * @param {number} wait - 等待时间（毫秒）
   * @returns {Function} 防抖后的函数
   */
  debounce(func, wait) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }
}

// 创建全局实例
if (typeof window !== 'undefined') {
  window.ocrSettingsManager = new OcrSettingsManager();
}

// 导出（如果使用模块化）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = OcrSettingsManager;
}
