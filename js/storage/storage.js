/**
 * @file js/storage.js
 * @description
 * 此文件负责管理应用程序中所有与浏览器本地存储相关的功能，
 * 包括 localStorage 和 IndexedDB。它提供了统一的接口来保存和加载用户设置、
 * API 密钥、已处理文件记录、模型配置以及其他需要持久化的数据。
 *
 * 主要功能包括：
 * - **常量定义**: 定义用于 localStorage 和 IndexedDB 存储键的常量。
 * - **已处理文件记录**: 管理已上传并处理过的文件记录，避免重复处理。
 * - **通用设置**: 保存和加载应用的全局设置，如默认处理选项等。
 * - **IndexedDB 数据库操作**:
 *   - 打开和初始化名为 `ResultDB` 的 IndexedDB 数据库，其中包含 `results` 对象存储区。
 *   - 将PDF处理结果（包括元数据、提取的文本、翻译、摘要等）保存到 IndexedDB。
 *   - 从 IndexedDB 检索、删除或清空处理结果。
 * - **UUID 生成**: 提供生成唯一标识符的功能，主要用于 IndexedDB 中的记录ID。
 * - **模型配置**: (部分可能为旧版) 保存和加载与特定翻译模型相关的配置，例如自定义模型的 Base URL。
 * - **API 密钥管理**: 安全地保存和加载用户为不同翻译服务或自定义模型配置的 API 密钥。
 *   支持多模型/多源站点的密钥管理，并包含对旧版单一密钥格式的兼容和迁移逻辑。
 * - **旧配置迁移**: 实现将旧版本存储的自定义模型配置迁移到新版多源站点结构的功能。
 * - **自定义源站点配置**: 管理用户添加的自定义 API 源站点及其相关配置（如名称、Base URL、API Key、默认模型等）。
 */

// =====================
// 常量定义
// =====================

/**
 * @const {string} SETTINGS_KEY
 * @description 用于在 localStorage 中存储通用设置的键名。
 */
const SETTINGS_KEY = 'userSettings';

/**
 * @const {string} PROCESSED_FILES_KEY
 * @description 用于在 localStorage 中存储已处理文件记录的键名。
 */
const PROCESSED_FILES_KEY = 'processedFilesRecord';

/**
 * @const {string} API_KEYS_STORAGE_KEY
 * @description 用于在 localStorage 中存储（新版）多模型/多源站 API 密钥列表的键名。
 * @deprecated 请使用 `MODEL_KEYS_STORAGE_KEY`。此常量可能指向旧的密钥存储方式或已被取代。
 */
const API_KEYS_STORAGE_KEY = 'apiKeys'; // 旧的或特定用途的, 新的统一用 modelKeys

/**
 * @const {string} CUSTOM_MODELS_KEY
 * @description 用于在 localStorage 中存储自定义模型列表的键名 (可能指旧版可用模型列表)。
 */
const CUSTOM_MODELS_KEY = 'customModels'; // 存储自定义模型列表

/**
 * @const {string} LEGACY_CUSTOM_CONFIG_KEY
 * @description 用于在 localStorage 中存储旧版单一自定义模型配置的键名。
 * 这个配置通常包含一个自定义模型的 Base URL 和 API Key。
 */
const LEGACY_CUSTOM_CONFIG_KEY = 'custom_model_config'; // 旧的自定义配置key

/**
 * @const {string} MODEL_KEYS_STORAGE_KEY
 * @description 用于在 localStorage 中存储（新版）与多个模型或源站点关联的 API 密钥及配置列表的键名。
 * 这个键名代表了当前推荐的存储 API Keys 和相关源站信息的方式。
 */
const MODEL_KEYS_STORAGE_KEY = 'modelKeys'; // 新的存储key，用于多站点
/**
 * @const {string} GLOSSARY_KEY
 * @description 翻译备择库（术语库）存储键名。
 */
const GLOSSARY_KEY = 'translationGlossary';
/**
 * @const {string} GLOSSARY_SETS_KEY
 * @description 多术语库集合键名：{ [id]: { id, name, enabled, entries: [...] } }
 */
const GLOSSARY_SETS_KEY = 'translationGlossarySets';

/**
 * @const {string} DB_NAME
 * @description IndexedDB 数据库的名称。
 */
const DB_NAME = 'ResultDB';
/**
 * @const {string} DB_STORE_NAME
 * @description IndexedDB 中用于存储处理结果的对象存储区的名称。
 */
const DB_STORE_NAME = 'results';
/**
 * @const {string} ANNOTATIONS_STORE_NAME
 * @description IndexedDB 中用于存储高亮和批注的对象存储区的名称。
 */
const ANNOTATIONS_STORE_NAME = 'annotations';
/**
 * @const {number} DB_VERSION
 * @description IndexedDB 数据库的版本号。更改此版本号会触发 `onupgradeneeded` 事件。
 */
const DB_VERSION = 3;
/**
 * @const {string} SEMANTIC_GROUPS_STORE_NAME
 * @description IndexedDB 中用于存储意群数据的对象存储区名称。
 */
const SEMANTIC_GROUPS_STORE_NAME = 'semantic_groups';

// =====================
// 本地存储相关工具函数
// =====================

// 导入依赖 (如果需要，例如 showNotification)
// import { showNotification } from './ui.js';

const MODEL_CONFIGS_KEY = 'translationModelConfigs';
const MODEL_KEYS_KEY = 'translationModelKeys';
const CUSTOM_SOURCE_SITES_KEY = 'paperBurnerCustomSourceSites'; // 新增：自定义源站列表的 Key
const LAST_SUCCESSFUL_KEYS_LS_KEY_STORAGE_REF = 'paperBurnerLastSuccessfulKeys'; // 新增：用于迁移和删除时引用

// ---------------------
// API Key 存储与管理
// ---------------------
/**
 * 更新 localStorage 中的 API Key
 * @param {string} keyName - 存储键名（如 'mistralApiKeys'）
 * @param {string} value - 密钥内容
 * @param {boolean} shouldRemember - 是否记住
 */
function updateApiKeyStorage(keyName, value, shouldRemember) {
    // keyName 应该是 'mistralApiKeys' 或 'translationApiKeys'
    if (shouldRemember) {
        localStorage.setItem(keyName, value);
    } else {
        localStorage.removeItem(keyName);
    }
}

// ---------------------
// 已处理文件记录
// ---------------------
/**
 * 加载已处理文件记录（防止重复处理）
 * @returns {Object} 文件标识到 true 的映射
 */
function loadProcessedFilesRecord() {
    let record = {};
    try {
        const storedRecord = localStorage.getItem(PROCESSED_FILES_KEY);
        if (storedRecord) {
            record = JSON.parse(storedRecord);
            console.log("Loaded processed files record:", record);
        }
    } catch (e) {
        console.error("Failed to load processed files record from localStorage:", e);
        record = {}; // 重置为空对象
    }
    return record; // 返回加载的记录
}

/**
 * 保存已处理文件记录到 localStorage
 * @param {Object} processedFilesRecord - 文件标识到 true 的映射
 */
function saveProcessedFilesRecord(processedFilesRecord) {
    try {
        localStorage.setItem(PROCESSED_FILES_KEY, JSON.stringify(processedFilesRecord));
        console.log("Saved processed files record.");
    } catch (e) {
        console.error("Failed to save processed files record to localStorage:", e);
        // showNotification("无法保存已处理文件记录到浏览器缓存", "error"); // 避免循环依赖
    }
}

/**
 * 判断文件是否已处理
 * @param {string} fileIdentifier - 文件唯一标识
 * @param {Object} processedFilesRecord - 已处理记录
 * @returns {boolean}
 */
function isAlreadyProcessed(fileIdentifier, processedFilesRecord) {
    return processedFilesRecord.hasOwnProperty(fileIdentifier) && processedFilesRecord[fileIdentifier] === true;
}

/**
 * 标记文件为已处理
 * @param {string} fileIdentifier - 文件唯一标识
 * @param {Object} processedFilesRecord - 已处理记录
 */
function markFileAsProcessed(fileIdentifier, processedFilesRecord) {
    processedFilesRecord[fileIdentifier] = true;
    // 注意：保存操作通常在批处理结束时进行，而不是每次标记时
}

// ---------------------
// 通用设置项存储
// ---------------------
/**
 * 保存设置项到 localStorage
 * @param {Object} settingsData - 设置对象
 */
function saveSettings(settingsData) {
    // settingsData 应该是一个包含所有要保存设置的对象
    // 例如: { maxTokensPerChunk: ..., skipProcessedFiles: ..., ... }
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settingsData));
        //console.log("Settings saved:", settingsData);
    } catch (e) {
        console.error('保存设置失败:', e);
        // showNotification('无法保存设置到浏览器缓存', 'error'); // 避免循环依赖
    }
}

/**
 * 加载设置项（带默认值）
 * @returns {Object} 设置对象
 */
function loadSettings() {
    let settings = {
        // 提供默认值
        maxTokensPerChunk: '2000',
        skipProcessedFiles: false,
        selectedTranslationModel: 'none',
        concurrencyLevel: '1',
        translationConcurrencyLevel: '15',
        targetLanguage: 'chinese',
        customTargetLanguageName: '',
        customModelSettings: {
            apiEndpoint: '',
            modelId: '',
            requestFormat: 'openai',
            temperature: 0.5,
            max_tokens: 8000
        },
        defaultSystemPrompt: '',
        defaultUserPromptTemplate: '',
        useCustomPrompts: false,
        enableGlossary: false,
        batchModeEnabled: false,
        batchModeTemplate: '{original_name}_{output_language}_{processing_time:YYYYMMDD-HHmmss}.{original_type}',
        batchModeFormats: ['original', 'markdown'],
        batchModeZipEnabled: false
    };
    try {
        const storedSettings = localStorage.getItem(SETTINGS_KEY);
        if (storedSettings) {
            const loaded = JSON.parse(storedSettings);
            // 合并加载的设置与默认值，确保所有键都存在
            settings = { ...settings, ...loaded };
            // 确保 customModelSettings 也是合并的
            if (loaded.customModelSettings) {
                settings.customModelSettings = { ...settings.customModelSettings, ...loaded.customModelSettings };
            }
            //console.log("Settings loaded:", settings);

            // 如果启用了自定义模型检测器，尝试加载可用模型
            if (typeof initModelDetectorUI === 'function') {
                setTimeout(() => {
                    loadAvailableModels();
                }, 0);
            }
        } else {
             console.log("No settings found in localStorage, using defaults.");
        }
    } catch (e) {
        console.error('加载设置失败，使用默认值:', e);
        // settings 保持为默认值
    }
    return settings; // 返回加载或默认的设置对象
}

/**
 * 加载可用模型列表
 */
function loadAvailableModels() {
    try {
        // 这里我们只是触发检查和UI更新，不实际加载模型
        // 实际加载和UI更新由modelDetector模块负责
        if (typeof window.modelDetector !== 'undefined') {
            const customModelId = document.getElementById('customModelId');
            const customModelIdInput = document.getElementById('customModelIdInput');

            // 尝试加载保存的模型列表，如果有
            const savedModels = localStorage.getItem('availableCustomModels');
            if (savedModels) {
                const lastSelectedModel = localStorage.getItem('lastSelectedCustomModel');

                // 如果有lastSelectedModel，设置输入框的值
                if (lastSelectedModel && customModelIdInput) {
                    customModelIdInput.value = lastSelectedModel;
                }
            }
        }
    } catch (e) {
        console.error('加载可用模型列表失败:', e);
    }
}

// --- IndexedDB 历史记录存储 ---

function openDB() {
    return new Promise(function(resolve, reject) {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = function(e) {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(DB_STORE_NAME)) {
                db.createObjectStore(DB_STORE_NAME, { keyPath: 'id' });
            }
            // 新增：创建 annotations 对象存储区
            if (!db.objectStoreNames.contains(ANNOTATIONS_STORE_NAME)) {
                const annotationsStore = db.createObjectStore(ANNOTATIONS_STORE_NAME, { keyPath: 'id' });
                annotationsStore.createIndex('docId', 'docId', { unique: false });
            }
            // 新增：创建 semantic_groups 对象存储区（按 docId 存取）
            if (!db.objectStoreNames.contains(SEMANTIC_GROUPS_STORE_NAME)) {
                db.createObjectStore(SEMANTIC_GROUPS_STORE_NAME, { keyPath: 'docId' });
            }
        };
        req.onsuccess = function() { resolve(req.result); };
        req.onerror = function() { reject(req.error); };
    });
}

async function saveResultToDB(resultObj) {
    const db = await openDB();
    return new Promise(function(resolve, reject) {
        const tx = db.transaction(DB_STORE_NAME, 'readwrite');
        tx.objectStore(DB_STORE_NAME).put(resultObj);
        tx.oncomplete = function() { resolve(); };
        tx.onerror = function() { reject(tx.error); };
    });
}

async function getAllResultsFromDB() {
    const db = await openDB();
    return new Promise(function(resolve, reject) {
        const tx = db.transaction(DB_STORE_NAME, 'readonly');
        const store = tx.objectStore(DB_STORE_NAME);
        const req = store.getAll();
        req.onsuccess = function() { resolve(req.result); };
        req.onerror = function() { reject(req.error); };
    });
}

async function getResultFromDB(id) {
    const db = await openDB();
    return new Promise(function(resolve, reject) {
        const tx = db.transaction(DB_STORE_NAME, 'readonly');
        const store = tx.objectStore(DB_STORE_NAME);
        const req = store.get(id);
        req.onsuccess = function() { resolve(req.result); };
        req.onerror = function() { reject(req.error); };
    });
}

async function deleteResultFromDB(id) {
    const db = await openDB();
    return new Promise(function(resolve, reject) {
        const tx = db.transaction(DB_STORE_NAME, 'readwrite');
        tx.objectStore(DB_STORE_NAME).delete(id);
        tx.oncomplete = function() { resolve(); };
        tx.onerror = function() { reject(tx.error); };
    });
}

async function clearAllResultsFromDB() {
    const db = await openDB();
    return new Promise(function(resolve, reject) {
        const tx = db.transaction(DB_STORE_NAME, 'readwrite');
        tx.objectStore(DB_STORE_NAME).clear();
        tx.oncomplete = function() { resolve(); };
        tx.onerror = function() { reject(tx.error); };
    });
}

// ========== 新增：多模型配置与Key存取 ==========

// --------- 新增：意群数据持久化（IndexedDB） ---------
/**
 * 将意群数据保存到 IndexedDB。
 * @param {string} docId 文档唯一ID。
 * @param {Array<Object>} groups 意群数组。
 * @param {Object} [extra] 额外信息，例如版本、来源等。
 */
async function saveSemanticGroupsToDB(docId, groups, extra = {}) {
    const db = await openDB();
    return new Promise(function(resolve, reject) {
        try {
            const tx = db.transaction(SEMANTIC_GROUPS_STORE_NAME, 'readwrite');
            const store = tx.objectStore(SEMANTIC_GROUPS_STORE_NAME);
            store.put({ docId, groups, updatedAt: Date.now(), ...extra });
            tx.oncomplete = function() { resolve(); };
            tx.onerror = function() { reject(tx.error); };
        } catch (e) {
            reject(e);
        }
    });
}

/**
 * 从 IndexedDB 加载意群数据。
 * @param {string} docId 文档唯一ID。
 * @returns {Promise<{docId: string, groups: Array<Object>, updatedAt: number} | undefined>}
 */
async function loadSemanticGroupsFromDB(docId) {
    const db = await openDB();
    return new Promise(function(resolve, reject) {
        try {
            const tx = db.transaction(SEMANTIC_GROUPS_STORE_NAME, 'readonly');
            const store = tx.objectStore(SEMANTIC_GROUPS_STORE_NAME);
            const req = store.get(docId);
            req.onsuccess = function() { resolve(req.result); };
            req.onerror = function() { reject(req.error); };
        } catch (e) {
            reject(e);
        }
    });
}

/**
 * 删除指定文档的意群数据。
 * @param {string} docId 文档唯一ID。
 */
async function deleteSemanticGroupsFromDB(docId) {
    const db = await openDB();
    return new Promise(function(resolve, reject) {
        try {
            const tx = db.transaction(SEMANTIC_GROUPS_STORE_NAME, 'readwrite');
            const store = tx.objectStore(SEMANTIC_GROUPS_STORE_NAME);
            store.delete(docId);
            tx.oncomplete = function() { resolve(); };
            tx.onerror = function() { reject(tx.error); };
        } catch (e) {
            reject(e);
        }
    });
}

// 暴露到全局（页面通过 <script> 引入非模块脚本时，确保可从 window 访问）
try {
    window.saveSemanticGroupsToDB = saveSemanticGroupsToDB;
    window.loadSemanticGroupsFromDB = loadSemanticGroupsFromDB;
    window.deleteSemanticGroupsFromDB = deleteSemanticGroupsFromDB;
} catch (e) {
    // 忽略：某些环境下 window 可能不可用（例如测试）
}

/**
 * 生成一个简单的 UUID
 * @returns {string}
 */
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * 保存某个模型的配置
 * @param {string} model
 * @param {Object} config
 */
function saveModelConfig(model, config) {
    let allConfigs = {};
    try {
        const raw = localStorage.getItem(MODEL_CONFIGS_KEY);
        if (raw) allConfigs = JSON.parse(raw);
    } catch {}
    allConfigs[model] = config;
    localStorage.setItem(MODEL_CONFIGS_KEY, JSON.stringify(allConfigs));
}

// ========== 新增：翻译备择库（术语库）存取 ==========

/**
 * 加载翻译备择库条目列表。
 * @returns {Array<Object>} 条目数组：[{ id, term, translation, caseSensitive, wholeWord, enabled }]
 */
function loadGlossaryEntries() {
    try {
        // 优先从多术语库集合加载所有已启用的条目
        const sets = loadGlossarySets();
        const setIds = Object.keys(sets || {});
        if (setIds.length > 0) {
            const out = [];
            setIds.forEach(id => {
                const s = sets[id];
                if (s && s.enabled && Array.isArray(s.entries)) {
                    s.entries.forEach(item => {
                        out.push({
                            id: item.id || generateUUID(),
                            term: String(item.term || '').trim(),
                            translation: String(item.translation || '').trim(),
                            caseSensitive: !!item.caseSensitive,
                            wholeWord: !!item.wholeWord,
                            enabled: item.enabled === undefined ? true : !!item.enabled
                        });
                    });
                }
            });
            return out;
        }
        // 兼容旧版单库
        const raw = localStorage.getItem(GLOSSARY_KEY);
        if (!raw) return [];
        const list = JSON.parse(raw);
        if (!Array.isArray(list)) return [];
        return list.filter(Boolean).map(item => ({
            id: item.id || generateUUID(),
            term: String(item.term || '').trim(),
            translation: String(item.translation || '').trim(),
            caseSensitive: !!item.caseSensitive,
            wholeWord: !!item.wholeWord,
            enabled: item.enabled === undefined ? true : !!item.enabled
        }));
    } catch (e) {
        console.error('Failed to load glossary entries:', e);
        return [];
    }
}

/**
 * 保存翻译备择库条目列表。
 * @param {Array<Object>} entries - 条目数组
 */
function saveGlossaryEntries(entries) {
    try {
        const list = Array.isArray(entries) ? entries : [];
        localStorage.setItem(GLOSSARY_KEY, JSON.stringify(list));
    } catch (e) {
        console.error('Failed to save glossary:', e);
    }
}

/**
 * 导出术语库为 JSON 字符串。
 * @returns {string}
 */
function exportGlossary() {
    try {
        const list = loadGlossaryEntries();
        return JSON.stringify(list, null, 2);
    } catch (e) {
        console.error('Failed to export glossary:', e);
        return '[]';
    }
}

/**
 * 从 JSON 文本导入术语库，返回导入后的数组。
 * @param {string} jsonText
 * @returns {Array<Object>}
 */
function importGlossary(jsonText) {
    try {
        const parsed = JSON.parse(jsonText);
        if (!Array.isArray(parsed)) throw new Error('格式错误：应为数组');
        const normalized = parsed.filter(Boolean).map((item, idx) => ({
            id: item.id || generateUUID(),
            term: String(item.term || '').trim(),
            translation: String(item.translation || '').trim(),
            caseSensitive: !!item.caseSensitive,
            wholeWord: !!item.wholeWord,
            enabled: item.enabled === undefined ? true : !!item.enabled
        })).filter(it => it.term && it.translation);
        saveGlossaryEntries(normalized);
        return normalized;
    } catch (e) {
        console.error('Failed to import glossary:', e);
        throw e;
    }
}

// ==== 多术语库集合 API ====
// 注意：这些是兼容性包装函数，实际使用 IndexedDB 存储
// 需要配合 glossary-storage.js 使用

/**
 * 加载所有术语库集合（同步接口 - 优先使用缓存）
 * 推荐使用 loadGlossarySetsAsync
 */
function loadGlossarySets() {
    // 尝试从缓存加载
    if (window._glossarySetsCache) {
        return window._glossarySetsCache;
    }

    // 触发异步加载并缓存结果
    if (typeof window.glossaryStorage !== 'undefined') {
        loadGlossarySetsAsync()
            .then(sets => {
                window._glossarySetsCache = sets;
                // 触发事件通知 UI 更新
                window.dispatchEvent(new CustomEvent('glossarySetsLoaded', { detail: sets }));
            })
            .catch(err => console.error('Failed to load glossary sets:', err));
    }

    // 返回空对象或缓存
    return window._glossarySetsCache || {};
}

/**
 * 加载所有术语库集合（推荐使用的异步版本）
 */
async function loadGlossarySetsAsync() {
    try {
        if (typeof window.glossaryStorage === 'undefined') {
            console.error('glossary-storage.js not loaded');
            return {};
        }

        // 首先尝试迁移旧数据
        await window.glossaryStorage.migrateFromLocalStorage();

        // 从 IndexedDB/后端加载
        return await window.glossaryStorage.loadGlossarySetsUnified();
    } catch (e) {
        console.error('Failed to load glossary sets:', e);
        return {};
    }
}

/**
 * 保存术语库集合（异步版本）
 * @param {Object} sets - 术语库集合对象
 * @param {Function} onProgress - 可选的进度回调函数 (current, total, setId) => void
 */
async function saveGlossarySetsAsync(sets, onProgress) {
    try {
        if (typeof window.glossaryStorage === 'undefined') {
            console.error('glossary-storage.js not loaded');
            throw new Error('Storage module not available');
        }

        const setIds = Object.keys(sets);
        const totalSets = setIds.length;

        // 批量保存所有集合
        for (let i = 0; i < totalSets; i++) {
            const setId = setIds[i];
            const set = sets[setId];
            const entries = Array.isArray(set.entries) ? set.entries : [];

            // 从集合中分离 entries
            const setMeta = { ...set };
            delete setMeta.entries;

            // 保存单个集合，传递进度回调
            await window.glossaryStorage.saveGlossarySetUnified(setMeta, entries, (current, total) => {
                if (onProgress) {
                    // 报告当前集合的进度
                    onProgress(current, total, setId, i + 1, totalSets);
                }
            });
        }

        console.log('Glossary sets saved successfully');
    } catch (e) {
        console.error('Failed to save glossary sets:', e);
        throw e;
    }
}

/**
 * 保存术语库集合（同步兼容接口）
 */
function saveGlossarySets(sets) {
    // 立即更新缓存
    window._glossarySetsCache = sets;

    // 异步保存到 IndexedDB
    if (typeof window.glossaryStorage !== 'undefined') {
        saveGlossarySetsAsync(sets)
            .then(() => {
                console.log('Glossary sets saved successfully');
                // 触发保存完成事件
                window.dispatchEvent(new CustomEvent('glossarySetsSaved', { detail: sets }));
            })
            .catch(err => {
                console.error('Failed to save glossary sets:', err);
                if (typeof showNotification === 'function') {
                    showNotification('保存术语库失败: ' + err.message, 'error');
                }
            });
    } else {
        console.error('glossary-storage.js not loaded, cannot save');
        if (typeof showNotification === 'function') {
            showNotification('术语库存储模块未加载', 'error');
        }
    }
}

// 创建术语库集合（异步版本）
async function createGlossarySetAsync(name) {
    const id = generateUUID();
    const newSet = { id, name: name || ('术语库-' + id.slice(0,8)), enabled: true };

    // 保存到 IndexedDB
    await window.glossaryStorage.saveGlossarySetUnified(newSet, []);

    // 更新缓存
    if (!window._glossarySetsCache) window._glossarySetsCache = {};
    window._glossarySetsCache[id] = { ...newSet, entries: [] };

    return window._glossarySetsCache[id];
}

function createGlossarySet(name) {
    const id = generateUUID();
    const newSet = { id, name: name || ('术语库-' + id.slice(0,8)), enabled: true, entries: [] };

    // 立即更新缓存
    if (!window._glossarySetsCache) window._glossarySetsCache = {};
    window._glossarySetsCache[id] = newSet;

    // 异步保存
    createGlossarySetAsync(name)
        .then(set => {
            console.log('Glossary set created:', set.id);
        })
        .catch(err => console.error('Failed to create glossary set:', err));

    return newSet;
}

// 删除术语库集合（异步版本）
async function deleteGlossarySetAsync(id) {
    await window.glossaryStorage.deleteGlossarySetUnified(id);

    // 从缓存中删除
    if (window._glossarySetsCache && window._glossarySetsCache[id]) {
        delete window._glossarySetsCache[id];
    }
}

function deleteGlossarySet(id) {
    // 立即从缓存中删除
    if (window._glossarySetsCache && window._glossarySetsCache[id]) {
        delete window._glossarySetsCache[id];
    }

    // 异步删除
    deleteGlossarySetAsync(id)
        .then(() => {
            console.log('Glossary set deleted:', id);
        })
        .catch(err => console.error('Failed to delete glossary set:', err));
}

// 重命名术语库（异步版本）
async function renameGlossarySetAsync(id, newName) {
    if (!window._glossarySetsCache || !window._glossarySetsCache[id]) return;

    const sets = window._glossarySetsCache;
    sets[id].name = String(newName || '').trim() || sets[id].name;

    const entries = sets[id].entries || [];
    await window.glossaryStorage.saveGlossarySetUnified(sets[id], entries);
}

function renameGlossarySet(id, newName) {
    // 立即更新缓存
    if (window._glossarySetsCache && window._glossarySetsCache[id]) {
        window._glossarySetsCache[id].name = String(newName || '').trim() || window._glossarySetsCache[id].name;
    }

    // 异步保存
    renameGlossarySetAsync(id, newName)
        .then(() => {
            console.log('Glossary set renamed:', id);
        })
        .catch(err => console.error('Failed to rename glossary set:', err));
}

// 切换术语库启用状态（异步版本）
async function toggleGlossarySetAsync(id, enabled) {
    if (!window._glossarySetsCache || !window._glossarySetsCache[id]) return;

    const sets = window._glossarySetsCache;
    sets[id].enabled = !!enabled;

    const entries = sets[id].entries || [];
    await window.glossaryStorage.saveGlossarySetUnified(sets[id], entries);
}

function toggleGlossarySet(id, enabled) {
    // 立即更新缓存
    if (window._glossarySetsCache && window._glossarySetsCache[id]) {
        window._glossarySetsCache[id].enabled = !!enabled;
    }

    // 异步保存
    toggleGlossarySetAsync(id, enabled)
        .then(() => {
            console.log('Glossary set toggled:', id, enabled);
        })
        .catch(err => console.error('Failed to toggle glossary set:', err));
}

// 更新术语库条目（异步版本）
async function updateGlossarySetEntriesAsync(id, entries, onProgress) {
    if (!window._glossarySetsCache || !window._glossarySetsCache[id]) return;

    const sets = window._glossarySetsCache;
    sets[id].entries = Array.isArray(entries) ? entries : [];

    await window.glossaryStorage.saveGlossarySetUnified(sets[id], entries, onProgress);
}

/**
 * 保存单个术语库（异步版本）
 * @param {string} setId - 术语库 ID
 * @param {string} name - 术语库名称
 * @param {boolean} enabled - 是否启用
 * @param {Array} entries - 术语条目数组
 * @param {Function} onProgress - 进度回调函数
 */
async function saveGlossarySetAsync(setId, name, enabled, entries, onProgress) {
    if (!window.glossaryStorage) {
        throw new Error('glossary-storage.js not loaded');
    }

    const setMeta = {
        id: setId,
        name: String(name || '').trim(),
        enabled: !!enabled
    };

    const normalizedEntries = Array.isArray(entries) ? entries : [];

    // 保存到 IndexedDB/后端
    await window.glossaryStorage.saveGlossarySetUnified(setMeta, normalizedEntries, onProgress);

    // 更新缓存
    if (!window._glossarySetsCache) window._glossarySetsCache = {};
    window._glossarySetsCache[setId] = { ...setMeta, entries: normalizedEntries };
}

function updateGlossarySetEntries(id, entries) {
    // 立即更新缓存
    if (window._glossarySetsCache && window._glossarySetsCache[id]) {
        window._glossarySetsCache[id].entries = Array.isArray(entries) ? entries : [];
    }

    // 异步保存
    updateGlossarySetEntriesAsync(id, entries)
        .then(() => {
            console.log('Glossary entries updated:', id);
        })
        .catch(err => console.error('Failed to update glossary entries:', err));
}

// 导出术语库（异步版本）
async function exportGlossarySetAsync(id) {
    const sets = await loadGlossarySetsAsync();
    const s = sets[id];
    if (!s) return '{}';

    // 加载条目
    const entries = await window.glossaryStorage.loadEntriesForSetUnified(id);
    return JSON.stringify({ ...s, entries }, null, 2);
}

function exportGlossarySet(id) {
    // 返回空字符串，实际使用异步版本
    exportGlossarySetAsync(id)
        .then(data => {
            window.dispatchEvent(new CustomEvent('glossarySetExported', { detail: { id, data } }));
        })
        .catch(err => console.error('Failed to export glossary set:', err));
    return '{}';
}

// 导入术语库（异步版本，支持进度回调）
async function importGlossarySetAsync(jsonText, onProgress) {
    const obj = JSON.parse(jsonText);
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.entries)) {
        throw new Error('文件不是有效的术语库');
    }

    const id = generateUUID();
    const newSet = {
        id,
        name: String(obj.name || ('导入库-' + id.slice(0,8))),
        enabled: obj.enabled === undefined ? true : !!obj.enabled
    };

    const entries = obj.entries.filter(Boolean).map(item => ({
        id: item.id || generateUUID(),
        term: String(item.term || '').trim(),
        translation: String(item.translation || '').trim(),
        caseSensitive: !!item.caseSensitive,
        wholeWord: !!item.wholeWord,
        enabled: item.enabled === undefined ? true : !!item.enabled
    }));

    // 使用带进度的保存函数
    await window.glossaryStorage.saveGlossarySetUnified(newSet, entries, onProgress);

    // 更新缓存
    if (!window._glossarySetsCache) window._glossarySetsCache = {};
    window._glossarySetsCache[id] = { ...newSet, entries };

    return { ...newSet, entries };
}

function importGlossarySet(jsonText) {
    importGlossarySetAsync(jsonText)
        .then(set => {
            window.dispatchEvent(new CustomEvent('glossarySetImported', { detail: set }));
        })
        .catch(err => {
            console.error('Failed to import glossary set:', err);
            throw err;
        });
    return { id: generateUUID(), name: '导入中...', enabled: true, entries: [] };
}

// 导出所有术语库（异步版本）
async function exportAllGlossarySetsAsync() {
    const sets = await loadGlossarySetsAsync();

    // 加载所有条目
    for (const setId in sets) {
        const entries = await window.glossaryStorage.loadEntriesForSetUnified(setId);
        sets[setId].entries = entries;
    }

    return JSON.stringify(sets, null, 2);
}

function exportAllGlossarySets() {
    exportAllGlossarySetsAsync()
        .then(data => {
            window.dispatchEvent(new CustomEvent('allGlossarySetsExported', { detail: data }));
        })
        .catch(err => console.error('Failed to export all glossary sets:', err));
    return '{}';
}

/**
 * 加载某个模型的配置
 * @param {string} model
 * @returns {Object|null}
 */
function loadModelConfig(model) {
    try {
        const raw = localStorage.getItem(MODEL_CONFIGS_KEY);
        if (raw) {
            const allConfigs = JSON.parse(raw);
            return allConfigs[model] || null;
        }
    } catch {}
    return null;
}

/**
 * 保存某个模型的key列表 (支持对象数组)
 * @param {string} model
 * @param {Array<Object>} keysArray - [{ id, value, remark, status, order }, ...]
 */
function saveModelKeys(model, keysArray) {
    let allModelKeyStores = {};
    try {
        const raw = localStorage.getItem(MODEL_KEYS_KEY);
        if (raw) allModelKeyStores = JSON.parse(raw);
    } catch (e) {
        console.error("Error parsing model keys from localStorage:", e);
    }
    // 确保 keysArray 是数组
    if (!Array.isArray(keysArray)) {
        console.error(`Attempted to save non-array for model ${model}'s keys.`);
        return;
    }
    allModelKeyStores[model] = keysArray;
    localStorage.setItem(MODEL_KEYS_KEY, JSON.stringify(allModelKeyStores));
}

/**
 * 加载某个模型的key列表 (返回对象数组, 带兼容性处理)
 * @param {string} model
 * @returns {Array<Object>} [{ id, value, remark, status, order }, ...]
 */
function loadModelKeys(model) {
    let modelKeyStore = [];
    try {
        const raw = localStorage.getItem(MODEL_KEYS_KEY);
        if (raw) {
            const allModelKeyStores = JSON.parse(raw);
            if (allModelKeyStores && Array.isArray(allModelKeyStores[model])) {
                const loadedKeys = allModelKeyStores[model];
                // 检查是否是新格式 (对象数组)
                if (loadedKeys.length > 0 && typeof loadedKeys[0] === 'object' && loadedKeys[0] !== null && 'value' in loadedKeys[0]) {
                    modelKeyStore = loadedKeys.sort((a, b) => (a.order || 0) - (b.order || 0));
                    return modelKeyStore; //已经是新格式，直接返回并排序
                } else if (loadedKeys.length > 0 && typeof loadedKeys[0] === 'string') {
                    // 旧格式 (字符串数组)，需要转换
                    console.log(`Migrating keys for model ${model} to new format.`);
                    modelKeyStore = loadedKeys.map((keyString, index) => ({
                        id: generateUUID(),
                        value: keyString,
                        remark: '',
                        status: 'untested', // 'untested', 'valid', 'invalid', 'testing'
                        order: index
                    }));
                    saveModelKeys(model, modelKeyStore); // 保存转换后的新格式
                    return modelKeyStore.sort((a, b) => a.order - b.order);
                } else if (loadedKeys.length === 0) {
                    return []; // 空数组，直接返回
                }
            }
        }
    } catch (e) {
        console.error("Error loading or migrating model keys from localStorage for model " + model + ":", e);
    }

    // 兼容迁移：将旧命名的通义/火山 Key 合并到新命名下
    try {
        const raw = localStorage.getItem(MODEL_KEYS_KEY);
        if (raw) {
            const allModelKeyStores = JSON.parse(raw);
            if (model === 'tongyi') {
                const old1 = Array.isArray(allModelKeyStores['tongyi-deepseek-v3']) ? allModelKeyStores['tongyi-deepseek-v3'] : [];
                const old2 = Array.isArray(allModelKeyStores['tongyi-qwen-turbo']) ? allModelKeyStores['tongyi-qwen-turbo'] : [];
                const merged = [...old1, ...old2];
                if (merged.length > 0) {
                    // 统一为对象数组格式
                    const normalized = merged.map((k, idx) => (typeof k === 'string') ? ({ id: generateUUID(), value: k, remark: '', status: 'untested', order: idx }) : k);
                    saveModelKeys('tongyi', normalized);
                    return normalized.sort((a,b)=> (a.order||0)-(b.order||0));
                }
            }
            if (model === 'volcano') {
                const old1 = Array.isArray(allModelKeyStores['volcano-deepseek-v3']) ? allModelKeyStores['volcano-deepseek-v3'] : [];
                const old2 = Array.isArray(allModelKeyStores['volcano-doubao']) ? allModelKeyStores['volcano-doubao'] : [];
                const merged = [...old1, ...old2];
                if (merged.length > 0) {
                    const normalized = merged.map((k, idx) => (typeof k === 'string') ? ({ id: generateUUID(), value: k, remark: '', status: 'untested', order: idx }) : k);
                    saveModelKeys('volcano', normalized);
                    return normalized.sort((a,b)=> (a.order||0)-(b.order||0));
                }
            }
        }
    } catch (e) { /* ignore */ }

    // 进一步兼容非常旧的、独立的 localStorage key (mistralApiKeys, translationApiKeys)
    let legacyKeysArray = [];
    if (model === 'mistral') {
        const mistralKeysText = localStorage.getItem('mistralApiKeys');
        if (mistralKeysText) {
            legacyKeysArray = mistralKeysText.split('\n').map(k => k.trim()).filter(Boolean);
        }
    } else if (model !== 'custom' && model !== 'mistral') { // 假设其他预设模型可能存在于 translationApiKeys
        const translationKeysText = localStorage.getItem('translationApiKeys');
        if (translationKeysText) {
            legacyKeysArray = translationKeysText.split('\n').map(k => k.trim()).filter(Boolean);
        }
    }

    if (legacyKeysArray.length > 0) {
        console.log(`Migrating legacy keys for model ${model} from separate localStorage items.`);
        modelKeyStore = legacyKeysArray.map((keyString, index) => ({
            id: generateUUID(),
            value: keyString,
            remark: '',
            status: 'untested',
            order: index
        }));
        saveModelKeys(model, modelKeyStore); // 保存转换后的新格式
        // 清理旧的独立 localStorage 项 (可选，但推荐)
        // if (model === 'mistral') localStorage.removeItem('mistralApiKeys');
        // if (model !== 'custom' && model !== 'mistral') localStorage.removeItem('translationApiKeys'); // 要小心，这可能会影响其他尚未迁移的逻辑
        return modelKeyStore.sort((a, b) => a.order - b.order);
    }

    return []; // 默认返回空数组
}

// ========== 新增：自定义源站配置管理 ==========

/**
 * 迁移旧的单一自定义模型配置到新的多源站结构。
 * 这应该只运行一次。
 * @returns {boolean} - 如果执行了迁移则返回 true，否则返回 false。
 */
async function migrateLegacyCustomConfig() {
    console.log("Checking for legacy custom config migration...");
    const oldCustomConfig = loadModelConfig('custom'); // 使用现有函数加载旧配置
    let existingSourceSites = {};
    try {
        const storedSites = localStorage.getItem(CUSTOM_SOURCE_SITES_KEY);
        if (storedSites) {
            existingSourceSites = JSON.parse(storedSites);
        }
    } catch (e) {
        console.error("Error parsing existing source sites for migration check:", e);
    }

    if (oldCustomConfig && Object.keys(existingSourceSites).length === 0) {
        console.log("Legacy 'custom' config found and no new source sites exist. Starting migration.");
        if (typeof showNotification === 'function') {
            showNotification("检测到旧版自定义配置，正在迁移...", "info", 4000);
        }

        const newSourceSiteId = generateUUID();
        const migratedSite = {
            id: newSourceSiteId,
            displayName: "旧版自定义配置 (已迁移)",
            apiBaseUrl: oldCustomConfig.apiBaseUrl || oldCustomConfig.apiEndpoint || "",
            modelId: oldCustomConfig.modelId || "",
            availableModels: oldCustomConfig.availableModels || [], // 保留旧的可用模型（如果有）
            requestFormat: oldCustomConfig.requestFormat || "openai",
            temperature: oldCustomConfig.temperature !== undefined ? oldCustomConfig.temperature : 0.5,
            max_tokens: oldCustomConfig.max_tokens !== undefined ? oldCustomConfig.max_tokens : 8000,
            endpointMode: 'auto'
        };

        // 1. 保存新的源站配置 (通过调用 saveCustomSourceSite 来确保统一处理)
        // 先直接写入，避免 saveCustomSourceSite 中的 loadAllCustomSourceSites 再次触发迁移
        existingSourceSites[newSourceSiteId] = migratedSite;
        localStorage.setItem(CUSTOM_SOURCE_SITES_KEY, JSON.stringify(existingSourceSites));
        console.log("Migrated site config saved to CUSTOM_SOURCE_SITES_KEY for ID:", newSourceSiteId);


        const newModelNameKey = `custom_source_${newSourceSiteId}`;

        // 2. 迁移 API Keys
        let allModelKeyStores = {};
        try {
            const rawKeys = localStorage.getItem(MODEL_KEYS_KEY);
            if (rawKeys) allModelKeyStores = JSON.parse(rawKeys);
        } catch (e) {
            console.error("Error parsing model keys during migration:", e);
        }

        if (allModelKeyStores && allModelKeyStores['custom']) {
            console.log(`Migrating API keys for 'custom' to '${newModelNameKey}'`);
            allModelKeyStores[newModelNameKey] = allModelKeyStores['custom'];
            delete allModelKeyStores['custom']; // Remove old key entry
            localStorage.setItem(MODEL_KEYS_KEY, JSON.stringify(allModelKeyStores));
        }

        // 3. 迁移上次成功使用的 Key ID
        try {
            let lastSuccessfulRecords = JSON.parse(localStorage.getItem(LAST_SUCCESSFUL_KEYS_LS_KEY_STORAGE_REF) || '{}');
            if (lastSuccessfulRecords && lastSuccessfulRecords['custom']) {
                console.log(`Migrating last successful key ID for 'custom' to '${newModelNameKey}'`);
                lastSuccessfulRecords[newModelNameKey] = lastSuccessfulRecords['custom'];
                delete lastSuccessfulRecords['custom']; // Remove old entry
                localStorage.setItem(LAST_SUCCESSFUL_KEYS_LS_KEY_STORAGE_REF, JSON.stringify(lastSuccessfulRecords));
            }
        } catch (e) {
            console.error("Error migrating last successful key ID:", e);
        }

        // 4. 删除旧的 'custom' 模型配置
        let allConfigs = {};
        try {
            const rawConfigs = localStorage.getItem(MODEL_CONFIGS_KEY);
            if (rawConfigs) allConfigs = JSON.parse(rawConfigs);
        } catch {}
        if (allConfigs && allConfigs['custom']) {
            console.log("Removing old 'custom' entry from model configs.");
            delete allConfigs['custom'];
            localStorage.setItem(MODEL_CONFIGS_KEY, JSON.stringify(allConfigs));
        }

        if (typeof showNotification === 'function') {
            showNotification("旧版自定义配置已成功迁移到新的源站管理。", "success", 5000);
        }
        console.log("Legacy migration completed for ID:", newSourceSiteId);
        return true; // Migration happened
    } else if (oldCustomConfig && Object.keys(existingSourceSites).length > 0) {
        console.log("Legacy 'custom' config found, but new source sites already exist. Migration skipped. Removing old 'custom' config from MODEL_CONFIGS_KEY to prevent conflicts.");
        let allConfigs = {};
        try {
            const rawConfigs = localStorage.getItem(MODEL_CONFIGS_KEY);
            if (rawConfigs) allConfigs = JSON.parse(rawConfigs);
        } catch {}
        if (allConfigs && allConfigs['custom']) {
            delete allConfigs['custom'];
            localStorage.setItem(MODEL_CONFIGS_KEY, JSON.stringify(allConfigs));
            if (typeof showNotification === 'function') {
                showNotification("检测到旧版自定义配置和新的源站点共存，已自动移除旧的独立自定义配置。请在源站点管理中查看。", "info", 7000);
            }
        }
    } else {
        console.log("No legacy 'custom' config to migrate or migration already effectively done (no old config or new sites exist).");
    }
    return false; // No migration happened or needed now
}

/**
 * 加载所有自定义源站配置。
 * 会在首次加载时尝试迁移旧配置 (如果 migrateLegacyCustomConfig 还未被有效执行过)。
 * @returns {Object} 以源站 ID 为键，源站配置为值的对象，如果出错则返回空对象。
 */
function loadAllCustomSourceSites() {
    // 确保迁移逻辑被考虑。migrateLegacyCustomConfig 有内部检查防止重复执行。
    // 为了避免 loadAllCustomSourceSites -> migrateLegacyCustomConfig -> loadModelConfig (旧) -> ...
    // 的循环或多次不必要检查，迁移最好在应用初始化时更明确地调用一次。
    // 但为确保数据一致性，这里保留一次检查。
    // 如果此函数在应用启动早期被调用，迁移会发生。
    if (!localStorage.getItem(CUSTOM_SOURCE_SITES_KEY) && localStorage.getItem(MODEL_CONFIGS_KEY)) {
         // 仅当新结构不存在但旧的 MODEL_CONFIGS_KEY 可能含有 'custom' 时，才更积极地尝试迁移。
        migrateLegacyCustomConfig();
    }

    let sites = {};
    try {
        const storedSites = localStorage.getItem(CUSTOM_SOURCE_SITES_KEY);
        if (storedSites) {
            sites = JSON.parse(storedSites);
        } else {
            // 如果 CUSTOM_SOURCE_SITES_KEY 不存在，也可能是迁移后第一次加载，
            // migrateLegacyCustomConfig 应该已经创建了它（如果需要迁移）。
            // 所以如果仍然是 null，说明确实没有数据。
        }
    } catch (e) {
        console.error("Failed to load custom source sites from localStorage:", e);
        sites = {}; // 出错时返回空对象
    }
    return sites;
}

/**
 * 保存单个自定义源站的配置 (新增或更新)。
 * @param {Object} sourceSiteConfig - 要保存的源站配置对象，必须包含 'id' 属性。
 */
function saveCustomSourceSite(sourceSiteConfig) {
    if (!sourceSiteConfig || !sourceSiteConfig.id) {
        console.error("Cannot save source site: config is invalid or missing ID.", sourceSiteConfig);
        if (typeof showNotification === 'function') {
            showNotification("保存源站配置失败：ID缺失。", "error");
        }
        return;
    }
    // 不再从 loadAllCustomSourceSites 内部调用 migrateLegacyCustomConfig
    // 假设迁移已在应用启动时或首次加载时处理完毕。
    let allSites = {};
    try {
        const storedSites = localStorage.getItem(CUSTOM_SOURCE_SITES_KEY);
        if (storedSites) {
            allSites = JSON.parse(storedSites);
        }
    } catch (e) {
        console.error("Error parsing existing source sites before saving:", e);
        // 继续尝试保存，可能会覆盖损坏的数据
    }

    allSites[sourceSiteConfig.id] = sourceSiteConfig;
    try {
        localStorage.setItem(CUSTOM_SOURCE_SITES_KEY, JSON.stringify(allSites));
        console.log("Custom source site saved:", sourceSiteConfig.id, sourceSiteConfig.displayName);
    } catch (e) {
        console.error("Failed to save custom source site to localStorage:", e);
        if (typeof showNotification === 'function') {
            showNotification(`保存源站 ${sourceSiteConfig.displayName || sourceSiteConfig.id} 失败。`, "error");
        }
    }
}

/**
 * 删除指定的自定义源站配置及其关联的API Keys和最后成功记录。
 * @param {string} sourceSiteId - 要删除的源站的 ID。
 */
function deleteCustomSourceSite(sourceSiteId) {
    if (!sourceSiteId) {
        console.error("Cannot delete source site: ID is missing.");
        return;
    }

    let allSites = {}; // Initialize as empty object
    try {
        const storedSites = localStorage.getItem(CUSTOM_SOURCE_SITES_KEY);
        if (storedSites) {
            allSites = JSON.parse(storedSites);
        }
    } catch (e) {
        console.error("Error parsing existing source sites before deletion:", e);
        // If parsing fails, we might not be able to confirm siteToDelete.displayName later.
        // However, we should still attempt to remove the entry by ID.
    }

    const siteToDelete = allSites[sourceSiteId]; // Get a reference before deleting

    if (siteToDelete || allSites.hasOwnProperty(sourceSiteId)) { // Check if key exists even if value is falsy
        delete allSites[sourceSiteId];
        try {
            localStorage.setItem(CUSTOM_SOURCE_SITES_KEY, JSON.stringify(allSites));
            console.log("Custom source site config removed from localStorage:", sourceSiteId);

            const modelNameKeyForSite = `custom_source_${sourceSiteId}`;

            // 删除关联的 API Keys
            let allModelKeyStores = {};
            try {
                const rawKeys = localStorage.getItem(MODEL_KEYS_KEY);
                if (rawKeys) allModelKeyStores = JSON.parse(rawKeys);
            } catch {} // Ignore parsing errors for key store, just try to delete if key exists
            if (allModelKeyStores && allModelKeyStores[modelNameKeyForSite]) {
                delete allModelKeyStores[modelNameKeyForSite];
                localStorage.setItem(MODEL_KEYS_KEY, JSON.stringify(allModelKeyStores));
                console.log("Deleted API keys for source site:", sourceSiteId);
            }

            // 删除关联的最后成功 Key 记录
            try {
                let lastSuccessfulRecords = JSON.parse(localStorage.getItem(LAST_SUCCESSFUL_KEYS_LS_KEY_STORAGE_REF) || '{}');
                if (lastSuccessfulRecords && lastSuccessfulRecords[modelNameKeyForSite]) {
                    delete lastSuccessfulRecords[modelNameKeyForSite];
                    localStorage.setItem(LAST_SUCCESSFUL_KEYS_LS_KEY_STORAGE_REF, JSON.stringify(lastSuccessfulRecords));
                    console.log("Deleted last successful key record for source site:", sourceSiteId);
                }
            } catch (e) {
                 console.error("Error deleting last successful key record for source site:", sourceSiteId, e);
            }

            const displayName = siteToDelete ? siteToDelete.displayName : sourceSiteId;
            if (typeof showNotification === 'function') {
                showNotification(`源站 "${displayName}" 已成功删除。`, "success");
            }

        } catch (e) {
            const displayName = siteToDelete ? siteToDelete.displayName : sourceSiteId;
            console.error(`Failed to delete custom source site "${displayName}" or its related data:`, e);
            if (typeof showNotification === 'function') {
                showNotification(`删除源站 "${displayName}" 失败。`, "error");
            }
        }
    } else {
        console.warn("Attempted to delete a non-existent source site:", sourceSiteId);
         if (typeof showNotification === 'function') {
            showNotification(`尝试删除不存在的源站 (ID: ${sourceSiteId})。`, "warning");
        }
    }
}

// ========== 新增：高亮与批注数据存储 ==========

/**
 * 将高亮/批注对象保存到 IndexedDB。
 * @param {Object} annotation - 高亮/批注对象，应包含 id, docId 等属性。
 * @returns {Promise<void>}
 */
async function saveAnnotationToDB(annotation) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(ANNOTATIONS_STORE_NAME, 'readwrite');
        const store = tx.objectStore(ANNOTATIONS_STORE_NAME);
        // 确保有 createdAt 和 updatedAt 时间戳
        const now = new Date().toISOString();
        annotation.createdAt = annotation.createdAt || now;
        annotation.updatedAt = now;
        store.put(annotation);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });
}

/**
 * 根据文档 ID 从 IndexedDB 获取所有高亮/批注。
 * @param {string} docId - 文档 ID。
 * @returns {Promise<Array<Object>>} - 与该文档关联的高亮/批注对象数组。
 */
async function getAnnotationsForDocFromDB(docId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(ANNOTATIONS_STORE_NAME, 'readonly');
        const store = tx.objectStore(ANNOTATIONS_STORE_NAME);
        const index = store.index('docId');
        const request = index.getAll(docId);
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
    });
}

/**
 * 更新 IndexedDB 中的一个高亮/批注对象。
 * (等同于保存，因为 put 会覆盖)
 * @param {Object} annotation - 要更新的高亮/批注对象。
 * @returns {Promise<void>}
 */
async function updateAnnotationInDB(annotation) {
    // put 操作会覆盖已存在的记录（如果 key 相同），或者新增一条记录。
    // 我们确保 updatedAt 时间戳被更新。
    return saveAnnotationToDB(annotation);
}

/**
 * 根据 ID 从 IndexedDB 删除一个高亮/批注。
 * @param {string} annotationId - 要删除的高亮/批注的 ID。
 * @returns {Promise<void>}
 */
async function deleteAnnotationFromDB(annotationId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(ANNOTATIONS_STORE_NAME, 'readwrite');
        const store = tx.objectStore(ANNOTATIONS_STORE_NAME);
        const request = store.delete(annotationId);
        request.onsuccess = resolve;
        request.onerror = () => reject(request.error);
    });
}

// --- 导出多模型配置和key存取方法 ---
// export { saveModelConfig, loadModelConfig, saveModelKeys, loadModelKeys };

// --- 导出 Storage 相关函数 ---

// --- 显式暴露必要的函数到全局作用域 ---
if (typeof window !== 'undefined') {
    // 暴露提示词池需要的关键函数
    window.loadAllCustomSourceSites = loadAllCustomSourceSites;
    // 纠正导出名称：函数为 saveCustomSourceSite（单数）
    window.saveCustomSourceSite = saveCustomSourceSite;
    window.saveModelConfig = saveModelConfig;
    window.loadModelConfig = loadModelConfig;
    window.loadKeys = loadModelKeys;  // 为了兼容性，使用 loadKeys 作为别名
    window.loadModelKeys = loadModelKeys;
    window.loadSettings = loadSettings;
    window.saveSettings = saveSettings;
    console.log('[Storage] 函数已暴露到全局作用域:', {
        loadAllCustomSourceSites: typeof window.loadAllCustomSourceSites,
        saveCustomSourceSite: typeof window.saveCustomSourceSite,
        saveModelConfig: typeof window.saveModelConfig,
        loadModelConfig: typeof window.loadModelConfig,
        loadKeys: typeof window.loadKeys,
        loadModelKeys: typeof window.loadModelKeys,
        loadSettings: typeof window.loadSettings,
        saveSettings: typeof window.saveSettings
    });
}
// export { updateApiKeyStorage, loadProcessedFilesRecord, saveProcessedFilesRecord, isAlreadyProcessed, markFileAsProcessed, saveSettings, loadSettings };
