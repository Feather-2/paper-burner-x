/**
 * @file js/storage/storage-adapter.js
 * @description
 * 存储适配器 - 支持 localStorage（前端模式）和 Backend API（Docker 模式）双模式
 *
 * 使用方式:
 * 1. 前端模式（Vercel）: 使用 localStorage + IndexedDB
 * 2. 后端模式（Docker）: 使用 Backend API + 数据库
 */

// 检测部署模式
const DEPLOYMENT_MODE = window.ENV_DEPLOYMENT_MODE || 'frontend'; // 'frontend' | 'backend'
const API_BASE_URL = window.ENV_API_BASE_URL || '/api';

// 认证 Token 管理
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
        return token ? {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        } : {
            'Content-Type': 'application/json'
        };
    }
}

// 后端存储实现
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
            if (!AuthManager.isAuthenticated()) {
                return this._getDefaultSettings();
            }
            const data = await this.fetchAPI('/user/settings');
            return data;
        } catch (error) {
            console.error('Failed to load settings from backend:', error);
            return this._getDefaultSettings();
        }
    }

    async saveSettings(settings) {
        try {
            if (!AuthManager.isAuthenticated()) {
                console.warn('Not authenticated, settings not saved');
                return;
            }
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
            await this.fetchAPI('/documents', {
                method: 'POST',
                body: JSON.stringify(document)
            });
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
            glossaries.forEach(g => {
                sets[g.id] = g;
            });
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
                    await this.fetchAPI('/user/glossaries', {
                        method: 'POST',
                        body: JSON.stringify(set)
                    });
                } else {
                    await this.fetchAPI(`/user/glossaries/${id}`, {
                        method: 'PUT',
                        body: JSON.stringify(set)
                    });
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
            await this.fetchAPI(`/documents/${annotation.documentId}/annotations`, {
                method: 'POST',
                body: JSON.stringify(annotation)
            });
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

// 存储适配器工厂
class StorageAdapterFactory {
    static create() {
        if (DEPLOYMENT_MODE === 'backend') {
            console.log('[Storage] Using Backend Storage Mode');
            return new BackendStorage();
        } else {
            console.log('[Storage] Using Local Storage Mode');
            // 返回 storage.js 中的函数包装器
            return {
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
        }
    }
}

// 全局存储实例
window.storageAdapter = StorageAdapterFactory.create();
window.AuthManager = AuthManager;
window.DEPLOYMENT_MODE = DEPLOYMENT_MODE;

console.log('[Storage Adapter] Initialized in mode:', DEPLOYMENT_MODE);
