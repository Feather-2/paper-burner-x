/**
 * @file js/storage/glossary-storage.js
 * @description
 * 术语库存储层 - 使用 IndexedDB 和后端数据库存储大容量术语库数据
 * 解决 localStorage 配额限制问题
 */

const GLOSSARY_DB_NAME = 'PaperBurnerGlossaryDB';
const GLOSSARY_DB_VERSION = 1;
const GLOSSARY_SETS_STORE = 'glossary_sets';
const GLOSSARY_ENTRIES_STORE = 'glossary_entries';

// 后端 API 端点
const GLOSSARY_API_BASE = '/api/glossary';

/**
 * 打开 IndexedDB 数据库
 */
function openGlossaryDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(GLOSSARY_DB_NAME, GLOSSARY_DB_VERSION);

        request.onerror = () => {
            console.error('Failed to open glossary database:', request.error);
            reject(request.error);
        };

        request.onsuccess = () => {
            resolve(request.result);
        };

        request.onupgradeneeded = (event) => {
            const db = event.target.result;

            // 创建术语库集合存储（元数据）
            if (!db.objectStoreNames.contains(GLOSSARY_SETS_STORE)) {
                const setsStore = db.createObjectStore(GLOSSARY_SETS_STORE, { keyPath: 'id' });
                setsStore.createIndex('enabled', 'enabled', { unique: false });
                setsStore.createIndex('updatedAt', 'updatedAt', { unique: false });
            }

            // 创建术语条目存储（数据）
            if (!db.objectStoreNames.contains(GLOSSARY_ENTRIES_STORE)) {
                const entriesStore = db.createObjectStore(GLOSSARY_ENTRIES_STORE, { keyPath: 'id' });
                entriesStore.createIndex('setId', 'setId', { unique: false });
                entriesStore.createIndex('term', 'term', { unique: false });
                entriesStore.createIndex('enabled', 'enabled', { unique: false });
            }

            console.log('Glossary database schema created');
        };
    });
}

/**
 * 检测是否有后端支持
 */
async function hasBackendSupport() {
    // 前端模式（file:// 协议）不支持后端
    if (window.location.protocol === 'file:') {
        return false;
    }

    // 检查是否有 storageAdapter 且为前端模式
    if (typeof window.storageAdapter !== 'undefined' && window.storageAdapter.isFrontendMode) {
        return false;
    }

    try {
        const response = await fetch(`${GLOSSARY_API_BASE}/health`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(1000) // 1秒超时
        });
        return response.ok;
    } catch (err) {
        // 静默失败，不打印日志
        return false;
    }
}

/**
 * 从 IndexedDB 加载所有术语库集合
 */
async function loadGlossarySetsFromIDB() {
    const db = await openGlossaryDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(GLOSSARY_SETS_STORE, 'readonly');
        const store = transaction.objectStore(GLOSSARY_SETS_STORE);
        const request = store.getAll();

        request.onsuccess = () => {
            const sets = {};
            (request.result || []).forEach(set => {
                sets[set.id] = set;
            });
            resolve(sets);
        };

        request.onerror = () => {
            console.error('Failed to load glossary sets from IndexedDB:', request.error);
            reject(request.error);
        };
    });
}

/**
 * 保存术语库集合到 IndexedDB
 */
async function saveGlossarySetToIDB(set) {
    const db = await openGlossaryDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(GLOSSARY_SETS_STORE, 'readwrite');
        const store = transaction.objectStore(GLOSSARY_SETS_STORE);

        // 添加时间戳
        set.updatedAt = Date.now();

        const request = store.put(set);

        request.onsuccess = () => resolve();
        request.onerror = () => {
            console.error('Failed to save glossary set to IndexedDB:', request.error);
            reject(request.error);
        };
    });
}

/**
 * 从 IndexedDB 删除术语库集合
 */
async function deleteGlossarySetFromIDB(setId) {
    const db = await openGlossaryDB();

    // 删除集合本身
    await new Promise((resolve, reject) => {
        const transaction = db.transaction(GLOSSARY_SETS_STORE, 'readwrite');
        const store = transaction.objectStore(GLOSSARY_SETS_STORE);
        const request = store.delete(setId);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });

    // 删除该集合的所有条目
    await deleteAllEntriesForSetFromIDB(setId);
}

/**
 * 从 IndexedDB 加载指定术语库的所有条目
 */
async function loadEntriesForSetFromIDB(setId) {
    const db = await openGlossaryDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(GLOSSARY_ENTRIES_STORE, 'readonly');
        const store = transaction.objectStore(GLOSSARY_ENTRIES_STORE);
        const index = store.index('setId');
        const request = index.getAll(setId);

        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => {
            console.error('Failed to load entries from IndexedDB:', request.error);
            reject(request.error);
        };
    });
}

/**
 * 批量保存术语条目到 IndexedDB（优化版 - 分块处理）
 * @param {string} setId - 术语库 ID
 * @param {Array} entries - 术语条目数组
 * @param {Function} onProgress - 进度回调 (current, total) => void
 */
async function saveEntriesToIDB(setId, entries, onProgress) {
    const db = await openGlossaryDB();
    const CHUNK_SIZE = 1000; // 每次批量写入 1000 条
    const totalEntries = entries.length;

    // 先删除该集合的所有旧条目
    await deleteAllEntriesForSetFromIDB(setId);

    // 分块批量插入
    for (let i = 0; i < totalEntries; i += CHUNK_SIZE) {
        const chunk = entries.slice(i, Math.min(i + CHUNK_SIZE, totalEntries));

        await new Promise((resolve, reject) => {
            const transaction = db.transaction(GLOSSARY_ENTRIES_STORE, 'readwrite');
            const store = transaction.objectStore(GLOSSARY_ENTRIES_STORE);

            // 批量插入这一块
            chunk.forEach(entry => {
                entry.setId = setId;
                store.put(entry);
            });

            transaction.oncomplete = () => {
                // 报告进度
                if (onProgress) {
                    onProgress(Math.min(i + CHUNK_SIZE, totalEntries), totalEntries);
                }
                resolve();
            };

            transaction.onerror = () => {
                console.error('Failed to save entries chunk to IndexedDB:', transaction.error);
                reject(transaction.error);
            };
        });

        // 让出主线程，避免阻塞 UI
        if (i + CHUNK_SIZE < totalEntries) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    console.log(`[GlossaryStorage] Saved ${totalEntries} entries in ${Math.ceil(totalEntries / CHUNK_SIZE)} chunks`);
}

/**
 * 删除指定术语库的所有条目
 */
async function deleteAllEntriesForSetFromIDB(setId) {
    const db = await openGlossaryDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(GLOSSARY_ENTRIES_STORE, 'readwrite');
        const store = transaction.objectStore(GLOSSARY_ENTRIES_STORE);
        const index = store.index('setId');
        const request = index.openCursor(IDBKeyRange.only(setId));

        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                cursor.delete();
                cursor.continue();
            } else {
                resolve();
            }
        };

        request.onerror = () => {
            console.error('Failed to delete entries from IndexedDB:', request.error);
            reject(request.error);
        };
    });
}

/**
 * 从后端加载所有术语库集合
 */
async function loadGlossarySetsFromBackend() {
    try {
        const response = await fetch(`${GLOSSARY_API_BASE}/sets`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });

        if (!response.ok) {
            throw new Error(`Backend returned ${response.status}`);
        }

        const data = await response.json();
        return data.sets || {};
    } catch (err) {
        console.error('Failed to load glossary sets from backend:', err);
        throw err;
    }
}

/**
 * 保存术语库集合到后端
 */
async function saveGlossarySetToBackend(set, entries) {
    try {
        const response = await fetch(`${GLOSSARY_API_BASE}/sets/${set.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ set, entries })
        });

        if (!response.ok) {
            throw new Error(`Backend returned ${response.status}`);
        }

        return await response.json();
    } catch (err) {
        console.error('Failed to save glossary set to backend:', err);
        throw err;
    }
}

/**
 * 从后端删除术语库集合
 */
async function deleteGlossarySetFromBackend(setId) {
    try {
        const response = await fetch(`${GLOSSARY_API_BASE}/sets/${setId}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' }
        });

        if (!response.ok) {
            throw new Error(`Backend returned ${response.status}`);
        }

        return await response.json();
    } catch (err) {
        console.error('Failed to delete glossary set from backend:', err);
        throw err;
    }
}

/**
 * 从后端加载指定术语库的条目
 */
async function loadEntriesForSetFromBackend(setId) {
    try {
        const response = await fetch(`${GLOSSARY_API_BASE}/sets/${setId}/entries`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });

        if (!response.ok) {
            throw new Error(`Backend returned ${response.status}`);
        }

        const data = await response.json();
        return data.entries || [];
    } catch (err) {
        console.error('Failed to load entries from backend:', err);
        throw err;
    }
}

/**
 * 统一接口：加载所有术语库集合（优先使用后端，降级到 IndexedDB）
 */
async function loadGlossarySetsUnified() {
    const hasBackend = await hasBackendSupport();

    if (hasBackend) {
        try {
            const sets = await loadGlossarySetsFromBackend();
            // 同步到 IndexedDB 作为缓存
            for (const setId in sets) {
                await saveGlossarySetToIDB(sets[setId]);
            }
            return sets;
        } catch (err) {
            console.warn('Backend failed, falling back to IndexedDB');
        }
    }

    // 降级使用 IndexedDB
    return await loadGlossarySetsFromIDB();
}

/**
 * 统一接口：保存术语库集合（同时保存到 IndexedDB 和后端）
 * @param {Object} set - 术语库元数据
 * @param {Array} entries - 术语条目数组
 * @param {Function} onProgress - 进度回调 (current, total) => void
 */
async function saveGlossarySetUnified(set, entries, onProgress) {
    // 先保存到 IndexedDB（快速响应）
    await saveGlossarySetToIDB(set);
    await saveEntriesToIDB(set.id, entries, onProgress);

    // 异步同步到后端（如果可用）
    const hasBackend = await hasBackendSupport();
    if (hasBackend) {
        try {
            await saveGlossarySetToBackend(set, entries);
        } catch (err) {
            console.warn('Failed to sync to backend, data saved locally only');
        }
    }
}

/**
 * 统一接口：删除术语库集合（同时从 IndexedDB 和后端删除）
 */
async function deleteGlossarySetUnified(setId) {
    // 从 IndexedDB 删除
    await deleteGlossarySetFromIDB(setId);

    // 从后端删除（如果可用）
    const hasBackend = await hasBackendSupport();
    if (hasBackend) {
        try {
            await deleteGlossarySetFromBackend(setId);
        } catch (err) {
            console.warn('Failed to delete from backend, deleted locally only');
        }
    }
}

/**
 * 统一接口：加载指定术语库的条目
 */
async function loadEntriesForSetUnified(setId) {
    const hasBackend = await hasBackendSupport();

    if (hasBackend) {
        try {
            const entries = await loadEntriesForSetFromBackend(setId);
            // 同步到 IndexedDB 作为缓存
            await saveEntriesToIDB(setId, entries);
            return entries;
        } catch (err) {
            console.warn('Backend failed, falling back to IndexedDB');
        }
    }

    // 降级使用 IndexedDB
    return await loadEntriesForSetFromIDB(setId);
}

/**
 * 从 localStorage 迁移数据到 IndexedDB
 */
async function migrateFromLocalStorage() {
    const GLOSSARY_SETS_KEY = 'translationGlossarySets';
    const MIGRATION_FLAG = 'glossaryMigratedToIDB';

    // 检查是否已迁移
    if (localStorage.getItem(MIGRATION_FLAG)) {
        console.log('Glossary data already migrated');
        return { success: true, alreadyMigrated: true };
    }

    try {
        const rawData = localStorage.getItem(GLOSSARY_SETS_KEY);
        if (!rawData) {
            console.log('No glossary data to migrate');
            localStorage.setItem(MIGRATION_FLAG, 'true');
            return { success: true, noData: true };
        }

        const sets = JSON.parse(rawData);
        const setIds = Object.keys(sets);

        if (setIds.length === 0) {
            console.log('No glossary sets to migrate');
            localStorage.setItem(MIGRATION_FLAG, 'true');
            return { success: true, noData: true };
        }

        console.log(`Migrating ${setIds.length} glossary sets to IndexedDB...`);

        let migratedCount = 0;
        let totalEntries = 0;

        for (const setId of setIds) {
            const set = sets[setId];
            const entries = Array.isArray(set.entries) ? set.entries : [];

            // 保存集合元数据（不包含 entries）
            const setMeta = { ...set };
            delete setMeta.entries;

            await saveGlossarySetToIDB(setMeta);

            // 保存条目
            if (entries.length > 0) {
                await saveEntriesToIDB(setId, entries);
                totalEntries += entries.length;
            }

            migratedCount++;
        }

        console.log(`Migration completed: ${migratedCount} sets, ${totalEntries} entries`);

        // 标记为已迁移
        localStorage.setItem(MIGRATION_FLAG, 'true');

        // 清理 localStorage（可选）
        try {
            localStorage.removeItem(GLOSSARY_SETS_KEY);
            console.log('Cleaned up localStorage glossary data');
        } catch (err) {
            console.warn('Failed to cleanup localStorage, but migration succeeded');
        }

        return {
            success: true,
            migratedSets: migratedCount,
            migratedEntries: totalEntries
        };
    } catch (err) {
        console.error('Failed to migrate glossary data:', err);
        return { success: false, error: err.message };
    }
}

// 暴露到全局作用域
if (typeof window !== 'undefined') {
    window.glossaryStorage = {
        loadGlossarySetsUnified,
        saveGlossarySetUnified,
        deleteGlossarySetUnified,
        loadEntriesForSetUnified,
        migrateFromLocalStorage,
        hasBackendSupport
    };

    // 自动初始化：迁移数据并加载到缓存
    (async function initGlossaryStorage() {
        try {
            console.log('[GlossaryStorage] Initializing...');

            // 1. 执行迁移（如果需要）
            const migrationResult = await migrateFromLocalStorage();
            if (migrationResult.success && migrationResult.migratedSets > 0) {
                console.log(`[GlossaryStorage] Migrated ${migrationResult.migratedSets} sets with ${migrationResult.migratedEntries} entries`);
            }

            // 2. 加载数据到缓存
            const sets = await loadGlossarySetsUnified();

            // 3. 加载每个术语库的条目到内存
            for (const setId in sets) {
                const entries = await loadEntriesForSetUnified(setId);
                sets[setId].entries = entries;
            }

            // 4. 更新缓存
            window._glossarySetsCache = sets;

            console.log(`[GlossaryStorage] Initialized with ${Object.keys(sets).length} glossary sets`);

            // 5. 触发加载完成事件
            window.dispatchEvent(new CustomEvent('glossarySetsLoaded', { detail: sets }));
        } catch (err) {
            console.error('[GlossaryStorage] Initialization failed:', err);
        }
    })();

    console.log('[GlossaryStorage] Module loaded and exposed to window.glossaryStorage');
}
