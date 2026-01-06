/**
 * @file js/storage/migrations/backup.js
 * @description 数据备份工具，支持完整备份和恢复
 */

import { generateUUID } from '../../shared/utils/uuid.js';

const BACKUP_DB_NAME = 'PaperBurnerBackupDB';
const BACKUP_STORE_NAME = 'backups';
const BACKUP_DB_VERSION = 1;

/**
 * 打开备份数据库
 */
async function openBackupDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(BACKUP_DB_NAME, BACKUP_DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(BACKUP_STORE_NAME)) {
        db.createObjectStore(BACKUP_STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * 从 IndexedDB 获取所有数据
 */
async function getAllFromIDBStore(dbName, storeName) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(storeName)) {
        resolve([]);
        return;
      }
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const getAll = store.getAll();
      getAll.onsuccess = () => resolve(getAll.result || []);
      getAll.onerror = () => reject(getAll.error);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * 创建完整备份
 * @returns {Promise<Object>} 备份对象
 */
export async function createFullBackup() {
  const backup = {
    id: generateUUID(),
    version: 1,
    timestamp: Date.now(),
    createdAt: new Date().toISOString(),
    localStorage: {},
    indexedDB: {}
  };

  // 备份 localStorage
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key) {
      backup.localStorage[key] = localStorage.getItem(key);
    }
  }

  // 备份 IndexedDB - ResultDB
  try {
    backup.indexedDB.results = await getAllFromIDBStore('ResultDB', 'results');
    backup.indexedDB.annotations = await getAllFromIDBStore('ResultDB', 'annotations');
    backup.indexedDB.semantic_groups = await getAllFromIDBStore('ResultDB', 'semantic_groups');
  } catch (e) {
    console.warn('Failed to backup ResultDB:', e);
    backup.indexedDB.results = [];
    backup.indexedDB.annotations = [];
    backup.indexedDB.semantic_groups = [];
  }

  // 备份 GlossaryDB
  try {
    backup.indexedDB.glossarySets = await getAllFromIDBStore('PaperBurnerGlossaryDB', 'sets');
    backup.indexedDB.glossaryEntries = await getAllFromIDBStore('PaperBurnerGlossaryDB', 'entries');
  } catch (e) {
    console.warn('Failed to backup GlossaryDB:', e);
    backup.indexedDB.glossarySets = [];
    backup.indexedDB.glossaryEntries = [];
  }

  return backup;
}

/**
 * 保存备份到 BackupDB
 */
export async function saveBackup(backup) {
  const db = await openBackupDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BACKUP_STORE_NAME, 'readwrite');
    tx.objectStore(BACKUP_STORE_NAME).put(backup);
    tx.oncomplete = () => resolve(backup.id);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * 列出所有备份
 */
export async function listBackups() {
  const db = await openBackupDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BACKUP_STORE_NAME, 'readonly');
    const request = tx.objectStore(BACKUP_STORE_NAME).getAll();
    request.onsuccess = () => {
      const backups = (request.result || [])
        .map(b => ({
          id: b.id,
          timestamp: b.timestamp,
          createdAt: b.createdAt,
          version: b.version
        }))
        .sort((a, b) => b.timestamp - a.timestamp);
      resolve(backups);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * 加载指定备份
 */
export async function loadBackup(backupId) {
  const db = await openBackupDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BACKUP_STORE_NAME, 'readonly');
    const request = tx.objectStore(BACKUP_STORE_NAME).get(backupId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * 下载备份为 JSON 文件
 */
export async function downloadBackupAsJson() {
  const backup = await createFullBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `paper-burner-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  return backup;
}

/**
 * 从 JSON 恢复备份
 */
export async function restoreFromJson(jsonText) {
  const backup = JSON.parse(jsonText);
  if (!backup || !backup.version || !backup.localStorage) {
    throw new Error('Invalid backup format');
  }
  return rollbackToBackup(backup);
}

/**
 * 回滚到指定备份
 */
export async function rollbackToBackup(backup) {
  // 恢复 localStorage
  for (const [key, value] of Object.entries(backup.localStorage)) {
    if (value !== null) {
      localStorage.setItem(key, value);
    }
  }

  // 恢复 IndexedDB - ResultDB
  if (backup.indexedDB) {
    await restoreIDBStore('ResultDB', 'results', backup.indexedDB.results || [], 3);
    await restoreIDBStore('ResultDB', 'annotations', backup.indexedDB.annotations || [], 3);
    await restoreIDBStore('ResultDB', 'semantic_groups', backup.indexedDB.semantic_groups || [], 3);

    // 恢复 GlossaryDB
    await restoreIDBStore('PaperBurnerGlossaryDB', 'sets', backup.indexedDB.glossarySets || [], 1);
    await restoreIDBStore('PaperBurnerGlossaryDB', 'entries', backup.indexedDB.glossaryEntries || [], 1);
  }

  console.info('[Backup] Restored from backup:', backup.id || 'imported');
  return true;
}

/**
 * 恢复单个 IDB store
 */
async function restoreIDBStore(dbName, storeName, data, version) {
  if (!data || data.length === 0) return;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, version);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(storeName)) {
        resolve();
        return;
      }
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);

      // 先清空再恢复
      store.clear();
      data.forEach(item => store.put(item));

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * 删除指定备份
 */
export async function deleteBackup(backupId) {
  const db = await openBackupDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BACKUP_STORE_NAME, 'readwrite');
    tx.objectStore(BACKUP_STORE_NAME).delete(backupId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// 默认导出
export default {
  createFullBackup,
  saveBackup,
  listBackups,
  loadBackup,
  downloadBackupAsJson,
  restoreFromJson,
  rollbackToBackup,
  deleteBackup
};
