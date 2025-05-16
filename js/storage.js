// js/storage.js

// =====================
// 本地存储相关工具函数
// =====================

// 导入依赖 (如果需要，例如 showNotification)
// import { showNotification } from './ui.js';

const SETTINGS_KEY = 'paperBurnerSettings'; // 设置项存储 key
const PROCESSED_FILES_KEY = 'paperBurnerProcessedFiles'; // 已处理文件记录 key

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
        console.log("Settings saved:", settingsData);
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
        translationConcurrencyLevel: '2',
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
        useCustomPrompts: false
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
            console.log("Settings loaded:", settings);
        } else {
             console.log("No settings found in localStorage, using defaults.");
        }
    } catch (e) {
        console.error('加载设置失败，使用默认值:', e);
        // settings 保持为默认值
    }
    return settings; // 返回加载或默认的设置对象
}

// --- IndexedDB 历史记录存储 ---
const DB_NAME = 'PaperBurnerDB';
const DB_VERSION = 1;
const STORE_NAME = 'results';

function openDB() {
    return new Promise(function(resolve, reject) {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = function(e) {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
        req.onsuccess = function() { resolve(req.result); };
        req.onerror = function() { reject(req.error); };
    });
}

async function saveResultToDB(resultObj) {
    const db = await openDB();
    return new Promise(function(resolve, reject) {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(resultObj);
        tx.oncomplete = function() { resolve(); };
        tx.onerror = function() { reject(tx.error); };
    });
}

async function getAllResultsFromDB() {
    const db = await openDB();
    return new Promise(function(resolve, reject) {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = function() { resolve(req.result); };
        req.onerror = function() { reject(req.error); };
    });
}

async function getResultFromDB(id) {
    const db = await openDB();
    return new Promise(function(resolve, reject) {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(id);
        req.onsuccess = function() { resolve(req.result); };
        req.onerror = function() { reject(req.error); };
    });
}

async function deleteResultFromDB(id) {
    const db = await openDB();
    return new Promise(function(resolve, reject) {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(id);
        tx.oncomplete = function() { resolve(); };
        tx.onerror = function() { reject(tx.error); };
    });
}

async function clearAllResultsFromDB() {
    const db = await openDB();
    return new Promise(function(resolve, reject) {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).clear();
        tx.oncomplete = function() { resolve(); };
        tx.onerror = function() { reject(tx.error); };
    });
}

// --- 导出 Storage 相关函数 ---
// export { updateApiKeyStorage, loadProcessedFilesRecord, saveProcessedFilesRecord, isAlreadyProcessed, markFileAsProcessed, saveSettings, loadSettings };