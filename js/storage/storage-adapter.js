/**
 * @file js/storage/storage-adapter.js
 * @description
 * 存储适配器 - 支持 localStorage（前端模式）和 Backend API（后端模式）双模式
 *
 * 使用方式:
 * 1. 前端模式（Vercel/静态/直接打开 index.html）: 使用 localStorage + IndexedDB
 * 2. 后端模式（Docker/自建后端）: 使用 Backend API + 数据库
 */

// ---------------- 部署模式与后端探测 ----------------
// 优先级（高→低）：URL 查询参数 ?mode=backend|frontend → window.ENV_DEPLOYMENT_MODE → 自动探测 /api/health → 默认 frontend
function getQueryModeOverride() {
  try {
    const p = new URLSearchParams(window.location.search);
    const m = (p.get('mode') || '').toLowerCase();
    if (m === 'backend' || m === 'frontend') return m;
  } catch {}
  return null;
}

let DEPLOYMENT_MODE = (getQueryModeOverride() || (window.ENV_DEPLOYMENT_MODE && window.ENV_DEPLOYMENT_MODE !== 'auto'
  ? window.ENV_DEPLOYMENT_MODE
  : 'frontend'));

const API_BASE_URL = window.ENV_API_BASE_URL || '/api';

async function autoDetectBackendAvailability(timeoutMs = 900) {
  // file:// 明确无后端
  if (window.location.protocol === 'file:') return false;
  // 显式覆盖不探测
  if (getQueryModeOverride() || (window.ENV_DEPLOYMENT_MODE && window.ENV_DEPLOYMENT_MODE !== 'auto')) {
    return DEPLOYMENT_MODE === 'backend';
  }
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${API_BASE_URL}/health`, { signal: controller.signal, cache: 'no-store' });
    clearTimeout(id);
    return res.ok;
  } catch {
    return false;
  }
}

// ---------------- 认证 Token 管理 ----------------
class AuthManager {
  static getToken() {
    return localStorage.getItem('auth_token');
  }

  static setToken(token) {
    localStorage.setItem('auth_token', token);
  }

  static removeToken() {
    localStorage.removeItem('auth_token');
  }

  static isAuthenticated() {
    return !!this.getToken();
  }

  static getHeaders() {
    const token = this.getToken();
    return token
      ? { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
      : { 'Content-Type': 'application/json' };
  }
}

// ---------------- 后端存储实现 ----------------
class BackendStorage {
  async fetchAPI(endpoint, options = {}) {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        ...AuthManager.getHeaders(),
        ...options.headers
      }
    });

    if (!response.ok) {
      if (response.status === 401) {
        // Token 过期，需要重新登录
        AuthManager.removeToken();
        window.location.href = '/login.html';
      }
      throw new Error(`API Error: ${response.status}`);
    }

    return response.json();
  }

  // 用户设置
  async loadSettings() {
    try {
      if (!AuthManager.isAuthenticated()) return this._getDefaultSettings();
      const data = await this.fetchAPI('/user/settings');
      return data;
    } catch (error) {
      console.error('Failed to load settings from backend:', error);
      return this._getDefaultSettings();
    }
  }

  async saveSettings(settings) {
    try {
      if (!AuthManager.isAuthenticated()) return;
      await this.fetchAPI('/user/settings', {
        method: 'PUT',
        body: JSON.stringify(settings)
      });
    } catch (error) {
      console.error('Failed to save settings to backend:', error);
      throw error;
    }
  }

  // API Keys
  async loadModelKeys(provider) {
    try {
      if (!AuthManager.isAuthenticated()) return [];
      const keys = await this.fetchAPI(`/user/api-keys?provider=${provider}`);
      return keys;
    } catch (error) {
      console.error('Failed to load API keys:', error);
      return [];
    }
  }

  async saveModelKeys(provider, keys) {
    try {
      if (!AuthManager.isAuthenticated()) return;
      await this.fetchAPI('/user/api-keys', {
        method: 'POST',
        body: JSON.stringify({ provider, keys })
      });
    } catch (error) {
      console.error('Failed to save API keys:', error);
      throw error;
    }
  }

  // 文档历史
  async saveResultToDB(document) {
    try {
      if (!AuthManager.isAuthenticated()) return;
      await this.fetchAPI('/documents', { method: 'POST', body: JSON.stringify(document) });
    } catch (error) {
      console.error('Failed to save document:', error);
      throw error;
    }
  }

  async getAllResultsFromDB() {
    try {
      if (!AuthManager.isAuthenticated()) return [];
      const data = await this.fetchAPI('/documents');
      return data.documents || [];
    } catch (error) {
      console.error('Failed to load documents:', error);
      return [];
    }
  }

  async getResultFromDB(id) {
    try {
      if (!AuthManager.isAuthenticated()) return null;
      return await this.fetchAPI(`/documents/${id}`);
    } catch (error) {
      console.error('Failed to load document:', error);
      return null;
    }
  }

  async deleteResultFromDB(id) {
    try {
      if (!AuthManager.isAuthenticated()) return;
      await this.fetchAPI(`/documents/${id}`, { method: 'DELETE' });
    } catch (error) {
      console.error('Failed to delete document:', error);
      throw error;
    }
  }

  // 术语库
  async loadGlossarySets() {
    try {
      if (!AuthManager.isAuthenticated()) return {};
      const glossaries = await this.fetchAPI('/user/glossaries');
      const sets = {};
      glossaries.forEach(g => { sets[g.id] = g; });
      return sets;
    } catch (error) {
      console.error('Failed to load glossaries:', error);
      return {};
    }
  }

  async saveGlossarySets(sets) {
    try {
      if (!AuthManager.isAuthenticated()) return;
      // 批量保存（简化实现）
      for (const [id, set] of Object.entries(sets)) {
        if (set._isNew) {
          await this.fetchAPI('/user/glossaries', { method: 'POST', body: JSON.stringify(set) });
        } else {
          await this.fetchAPI(`/user/glossaries/${id}`, { method: 'PUT', body: JSON.stringify(set) });
        }
      }
    } catch (error) {
      console.error('Failed to save glossaries:', error);
      throw error;
    }
  }

  // 标注
  async saveAnnotationToDB(annotation) {
    try {
      if (!AuthManager.isAuthenticated()) return;
      await this.fetchAPI(`/documents/${annotation.documentId}/annotations`, { method: 'POST', body: JSON.stringify(annotation) });
    } catch (error) {
      console.error('Failed to save annotation:', error);
      throw error;
    }
  }

  async getAnnotationsForDocFromDB(docId) {
    try {
      if (!AuthManager.isAuthenticated()) return [];
      return await this.fetchAPI(`/documents/${docId}/annotations`);
    } catch (error) {
      console.error('Failed to load annotations:', error);
      return [];
    }
  }

  _getDefaultSettings() {
    return {
      maxTokensPerChunk: 2000,
      skipProcessedFiles: false,
      selectedTranslationModel: 'none',
      concurrencyLevel: 1,
      translationConcurrencyLevel: 15,
      targetLanguage: 'chinese',
      customTargetLanguageName: '',
      enableGlossary: false,
      batchModeEnabled: false,
      batchModeTemplate: '{original_name}_{output_language}_{processing_time:YYYYMMDD-HHmmss}.{original_type}',
      batchModeFormats: ['original', 'markdown'],
      batchModeZipEnabled: false
    };
  }
}

// ---------------- 存储适配器工厂 ----------------
class StorageAdapterFactory {
  static create(mode) {
    if (mode === 'backend') {
      console.log('[Storage] Using Backend Storage Mode');
      const instance = new BackendStorage();
      instance.isFrontendMode = false; // 供其他模块探测
      return instance;
    }
    console.log('[Storage] Using Local Storage Mode');
    // 返回 storage.js 中的函数包装（保持现有调用不变）
    const adapter = {
      loadSettings: window.loadSettings,
      saveSettings: window.saveSettings,
      loadModelKeys: window.loadModelKeys,
      saveModelKeys: window.saveModelKeys,
      saveResultToDB: window.saveResultToDB,
      getAllResultsFromDB: window.getAllResultsFromDB,
      getResultFromDB: window.getResultFromDB,
      deleteResultFromDB: window.deleteResultFromDB,
      clearAllResultsFromDB: window.clearAllResultsFromDB,
      loadGlossarySets: window.loadGlossarySets,
      saveGlossarySets: window.saveGlossarySets,
      saveAnnotationToDB: window.saveAnnotationToDB,
      getAnnotationsForDocFromDB: window.getAnnotationsForDocFromDB,
      updateAnnotationInDB: window.updateAnnotationInDB,
      deleteAnnotationFromDB: window.deleteAnnotationFromDB,
      loadProcessedFilesRecord: window.loadProcessedFilesRecord,
      saveProcessedFilesRecord: window.saveProcessedFilesRecord
    };
    adapter.isFrontendMode = true; // 供其他模块探测
    return adapter;
  }
}

// ---------------- 初始化与自动切换 ----------------
function printBanner() {
  const logoStyle = 'font-size: 16px; font-weight: bold; color: #3b82f6;';
  const infoStyle = 'font-size: 14px; color: #10b981;';
  const modeStyle = 'font-size: 14px; font-weight: bold; color: #f59e0b;';
  const borderStyle = 'color: #6366f1;';
  const linkStyle = 'font-size: 13px; color: #06b6d4; text-decoration: underline;';

  const logo = `
  ____                          ____                              __  __
 |  _ \\ __ _ _ __   ___ _ __   | __ ) _   _ _ __ _ __   ___ _ __ \\ \\/ /
 | |_) / _\` | '_ \\ / _ \\ '__|  |  _ \\| | | | '__| '_ \\ / _ \\ '__| \\  /
 |  __/ (_| | |_) |  __/ |     | |_) | |_| | |  | | | |  __/ |    /  \\
 |_|   \\__,_| .__/ \\___|_|     |____/ \\__,_|_|  |_| |_|\\___|_|   /_/\\_\\
            |_|
  `;

  const mode = DEPLOYMENT_MODE === 'backend' ? '后端模式 (Backend Mode)' : '前端模式 (Frontend Mode)';
  const storage = DEPLOYMENT_MODE === 'backend' ? 'Backend API + PostgreSQL' : 'localStorage + IndexedDB';
  const auth = DEPLOYMENT_MODE === 'backend' ? 'JWT Authentication' : 'No Authentication';

  console.log('%c' + logo, logoStyle);
  console.log('%c╔════════════════════════════════════════════════════════════╗', borderStyle);
  console.log('%c║                   系统信息 / System Info                   ║', borderStyle);
  console.log('%c╠════════════════════════════════════════════════════════════╣', borderStyle);
  console.log('%c║ %c运行模式: ' + mode + '                                  %c║', borderStyle, modeStyle, borderStyle);
  console.log('%c║ %c存储方式: ' + storage + '                %c║', borderStyle, infoStyle, borderStyle);
  console.log('%c║ %c认证方式: ' + auth + '                         %c║', borderStyle, infoStyle, borderStyle);
  console.log('%c╚════════════════════════════════════════════════════════════╝', borderStyle);
  console.log('%c\n🚀 Paper Burner X 已就绪！Ready to burn papers!\n', 'font-size: 14px; color: #8b5cf6; font-weight: bold;');
  console.log('%c→ GitHub: %chttps://github.com/Feather-2/paper-burner-x', 'font-size: 13px; color: #64748b;', linkStyle);
}

// 初始实例（默认前端/显式覆盖），随后可能自动切换为 backend
window.storageAdapter = StorageAdapterFactory.create(DEPLOYMENT_MODE);
window.AuthManager = AuthManager;
window.DEPLOYMENT_MODE = DEPLOYMENT_MODE;
printBanner();

// 自动探测，有后端则无缝切换（不阻塞静态模式渲染）
autoDetectBackendAvailability().then((hasBackend) => {
  if (hasBackend && DEPLOYMENT_MODE !== 'backend') {
    DEPLOYMENT_MODE = 'backend';
    window.DEPLOYMENT_MODE = DEPLOYMENT_MODE;
    window.storageAdapter = StorageAdapterFactory.create('backend');
    try { window.dispatchEvent(new CustomEvent('pb:storage-mode-changed', { detail: { mode: 'backend' } })); } catch {}
    console.log('[Storage] Auto-switched to Backend mode (health check passed)');
  }
}).catch(() => {/* ignore */});

