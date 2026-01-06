/**
 * PPT 编辑器存储管理
 * 使用 IndexedDB 存储项目、资源和历史
 */
export class StorageManager {
    static DB_NAME = 'ppt-editor-db';
    static DB_VERSION = 1;
    static CHUNK_SIZE = 1024 * 1024; // 1MB
    static MAX_INLINE_SIZE = 10 * 1024 * 1024; // 10MB 以上分块

    constructor() {
        this.db = null;
        this._initPromise = null;
    }

    /**
     * 初始化数据库
     */
    async init() {
        if (this.db) return this.db;
        if (this._initPromise) return this._initPromise;

        this._initPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(StorageManager.DB_NAME, StorageManager.DB_VERSION);

            request.onerror = () => reject(new Error('无法打开数据库'));

            request.onsuccess = () => {
                this.db = request.result;
                console.log('[StorageManager] 数据库已连接');
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // 项目存储
                if (!db.objectStoreNames.contains('projects')) {
                    const projectStore = db.createObjectStore('projects', { keyPath: 'id' });
                    projectStore.createIndex('updated', 'updated', { unique: false });
                    projectStore.createIndex('title', 'title', { unique: false });
                }

                // 资源存储（图片等）
                if (!db.objectStoreNames.contains('assets')) {
                    const assetStore = db.createObjectStore('assets', { keyPath: 'id' });
                    assetStore.createIndex('projectId', 'projectId', { unique: false });
                    assetStore.createIndex('type', 'type', { unique: false });
                }

                // 分块存储（大文件）
                if (!db.objectStoreNames.contains('chunks')) {
                    db.createObjectStore('chunks', { keyPath: 'key' });
                }

                // 历史快照
                if (!db.objectStoreNames.contains('snapshots')) {
                    const snapshotStore = db.createObjectStore('snapshots', { keyPath: 'id' });
                    snapshotStore.createIndex('projectId', 'projectId', { unique: false });
                    snapshotStore.createIndex('created', 'created', { unique: false });
                }

                console.log('[StorageManager] 数据库结构已创建');
            };
        });

        return this._initPromise;
    }

    // ═══════════════════════════════════════════════════════════════
    // 项目管理
    // ═══════════════════════════════════════════════════════════════

    /**
     * 获取所有项目列表
     */
    async listProjects() {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('projects', 'readonly');
            const store = tx.objectStore('projects');
            const index = store.index('updated');
            const request = index.openCursor(null, 'prev'); // 按更新时间倒序

            const projects = [];
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    // 只返回元数据，不包含完整 slides
                    const { id, title, created, updated, slideCount, thumbnail } = cursor.value;
                    projects.push({ id, title, created, updated, slideCount, thumbnail });
                    cursor.continue();
                } else {
                    resolve(projects);
                }
            };
            request.onerror = () => reject(new Error('获取项目列表失败'));
        });
    }

    /**
     * 获取项目
     */
    async getProject(projectId) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('projects', 'readonly');
            const request = tx.objectStore('projects').get(projectId);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(new Error('获取项目失败'));
        });
    }

    /**
     * 保存项目
     */
    async saveProject(project) {
        await this.init();
        project.updated = Date.now();
        project.slideCount = project.slides?.length || 0;

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('projects', 'readwrite');
            const request = tx.objectStore('projects').put(project);
            request.onsuccess = () => {
                console.log('[StorageManager] 项目已保存:', project.id);
                resolve(project.id);
            };
            request.onerror = () => reject(new Error('保存项目失败'));
        });
    }

    /**
     * 删除项目
     */
    async deleteProject(projectId) {
        await this.init();

        // 删除项目相关资源
        await this.deleteProjectAssets(projectId);

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('projects', 'readwrite');
            const request = tx.objectStore('projects').delete(projectId);
            request.onsuccess = () => {
                console.log('[StorageManager] 项目已删除:', projectId);
                resolve();
            };
            request.onerror = () => reject(new Error('删除项目失败'));
        });
    }

    /**
     * 创建新项目
     */
    createProject(title = '未命名演示文稿') {
        return {
            id: this.generateId(),
            title,
            created: Date.now(),
            updated: Date.now(),
            slides: [],
            assets: {},
            settings: {
                width: 960,
                height: 540,
                theme: 'default',
            },
        };
    }

    // ═══════════════════════════════════════════════════════════════
    // 资源管理
    // ═══════════════════════════════════════════════════════════════

    /**
     * 保存资源（自动处理大文件分块）
     */
    async saveAsset(projectId, blob, metadata = {}) {
        await this.init();

        const assetId = this.generateId();
        const asset = {
            id: assetId,
            projectId,
            name: metadata.name || `asset_${assetId}`,
            type: this.getAssetType(blob.type),
            mimeType: blob.type,
            size: blob.size,
            width: metadata.width,
            height: metadata.height,
            created: Date.now(),
            source: metadata.source || { type: 'upload' },
        };

        // 大文件分块存储
        if (blob.size > StorageManager.MAX_INLINE_SIZE) {
            const chunkKeys = await this.saveChunks(assetId, blob);
            asset.storage = { type: 'chunks', chunkKeys };
        } else {
            const blobKey = `blob_${assetId}`;
            await this.saveBlob(blobKey, blob);
            asset.storage = { type: 'blob', blobKey };
        }

        // 生成缩略图
        if (asset.type === 'image') {
            try {
                const thumbnail = await this.generateThumbnail(blob, 200);
                const thumbKey = `thumb_${assetId}`;
                await this.saveBlob(thumbKey, thumbnail.blob);
                asset.thumbnail = {
                    blobKey: thumbKey,
                    width: thumbnail.width,
                    height: thumbnail.height,
                };
            } catch (e) {
                console.warn('[StorageManager] 缩略图生成失败:', e);
            }
        }

        // 保存元数据
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('assets', 'readwrite');
            const request = tx.objectStore('assets').put(asset);
            request.onsuccess = () => {
                console.log('[StorageManager] 资源已保存:', assetId, `(${this.formatSize(blob.size)})`);
                resolve(asset);
            };
            request.onerror = () => reject(new Error('保存资源失败'));
        });
    }

    /**
     * 获取资源元数据
     */
    async getAssetMeta(assetId) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('assets', 'readonly');
            const request = tx.objectStore('assets').get(assetId);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(new Error('获取资源失败'));
        });
    }

    /**
     * 获取资源 Blob
     */
    async getAssetBlob(assetId) {
        const asset = await this.getAssetMeta(assetId);
        if (!asset) return null;

        if (asset.storage.type === 'chunks') {
            return this.loadChunks(asset.storage.chunkKeys, asset.mimeType);
        } else {
            return this.getBlob(asset.storage.blobKey);
        }
    }

    /**
     * 获取资源 URL（Object URL，需要手动释放）
     */
    async getAssetUrl(assetId) {
        const blob = await this.getAssetBlob(assetId);
        if (!blob) return null;
        return URL.createObjectURL(blob);
    }

    /**
     * 获取缩略图 URL
     */
    async getThumbnailUrl(assetId) {
        const asset = await this.getAssetMeta(assetId);
        if (!asset?.thumbnail) return null;
        const blob = await this.getBlob(asset.thumbnail.blobKey);
        return blob ? URL.createObjectURL(blob) : null;
    }

    /**
     * 获取项目所有资源
     */
    async getProjectAssets(projectId) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('assets', 'readonly');
            const index = tx.objectStore('assets').index('projectId');
            const request = index.getAll(projectId);
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(new Error('获取项目资源失败'));
        });
    }

    /**
     * 删除项目所有资源
     */
    async deleteProjectAssets(projectId) {
        const assets = await this.getProjectAssets(projectId);
        for (const asset of assets) {
            await this.deleteAsset(asset.id);
        }
    }

    /**
     * 删除资源
     */
    async deleteAsset(assetId) {
        const asset = await this.getAssetMeta(assetId);
        if (!asset) return;

        // 删除数据
        if (asset.storage.type === 'chunks') {
            for (const key of asset.storage.chunkKeys) {
                await this.deleteChunk(key);
            }
        } else {
            await this.deleteBlob(asset.storage.blobKey);
        }

        // 删除缩略图
        if (asset.thumbnail) {
            await this.deleteBlob(asset.thumbnail.blobKey);
        }

        // 删除元数据
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('assets', 'readwrite');
            const request = tx.objectStore('assets').delete(assetId);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(new Error('删除资源失败'));
        });
    }

    async getAssetChain(assetId) {
        const chain = [];
        let currentId = assetId;
        const seen = new Set();

        while (currentId && !seen.has(currentId)) {
            seen.add(currentId);

            const asset = await this.getAssetMeta(currentId);
            if (!asset) break;

            chain.unshift({
                assetId: asset.id,
                timestamp: asset.created,
                operation: asset.source?.operation,
                params: asset.source?.params
            });

            currentId = asset.source?.parentAssetId;
        }

        return chain;
    }

    // ═══════════════════════════════════════════════════════════════
    // 快照管理
    // ═══════════════════════════════════════════════════════════════

    /**
     * 创建快照
     */
    async createSnapshot(projectId, slides, description = '') {
        await this.init();

        const snapshot = {
            id: this.generateId(),
            projectId,
            created: Date.now(),
            description,
            slides: JSON.parse(JSON.stringify(slides)), // 深拷贝
        };

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('snapshots', 'readwrite');
            const request = tx.objectStore('snapshots').put(snapshot);
            request.onsuccess = () => resolve(snapshot);
            request.onerror = () => reject(new Error('创建快照失败'));
        });
    }

    /**
     * 获取项目快照列表
     */
    async getProjectSnapshots(projectId) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('snapshots', 'readonly');
            const index = tx.objectStore('snapshots').index('projectId');
            const request = index.getAll(projectId);
            request.onsuccess = () => {
                const snapshots = request.result || [];
                // 按时间倒序
                snapshots.sort((a, b) => b.created - a.created);
                resolve(snapshots);
            };
            request.onerror = () => reject(new Error('获取快照失败'));
        });
    }

    /**
     * 恢复快照
     */
    async restoreSnapshot(snapshotId) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('snapshots', 'readonly');
            const request = tx.objectStore('snapshots').get(snapshotId);
            request.onsuccess = () => resolve(request.result?.slides || null);
            request.onerror = () => reject(new Error('恢复快照失败'));
        });
    }

    // ═══════════════════════════════════════════════════════════════
    // 内部方法
    // ═══════════════════════════════════════════════════════════════

    async saveBlob(key, blob) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('chunks', 'readwrite');
            const request = tx.objectStore('chunks').put({ key, data: blob });
            request.onsuccess = () => resolve();
            request.onerror = () => reject(new Error('保存 Blob 失败'));
        });
    }

    async getBlob(key) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('chunks', 'readonly');
            const request = tx.objectStore('chunks').get(key);
            request.onsuccess = () => resolve(request.result?.data || null);
            request.onerror = () => reject(new Error('获取 Blob 失败'));
        });
    }

    async deleteBlob(key) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('chunks', 'readwrite');
            const request = tx.objectStore('chunks').delete(key);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(new Error('删除 Blob 失败'));
        });
    }

    async saveChunks(assetId, blob) {
        const chunkKeys = [];
        let offset = 0;
        let index = 0;

        while (offset < blob.size) {
            const chunk = blob.slice(offset, offset + StorageManager.CHUNK_SIZE);
            const key = `${assetId}_chunk_${index}`;
            await this.saveBlob(key, chunk);
            chunkKeys.push(key);
            offset += StorageManager.CHUNK_SIZE;
            index++;
        }

        console.log(`[StorageManager] 大文件已分块存储: ${chunkKeys.length} 块`);
        return chunkKeys;
    }

    async loadChunks(chunkKeys, mimeType) {
        const chunks = [];
        for (const key of chunkKeys) {
            const chunk = await this.getBlob(key);
            if (chunk) chunks.push(chunk);
        }
        return new Blob(chunks, { type: mimeType });
    }

    async deleteChunk(key) {
        return this.deleteBlob(key);
    }

    async generateThumbnail(blob, maxSize = 200) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
                const width = Math.round(img.width * scale);
                const height = Math.round(img.height * scale);

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                canvas.toBlob(
                    (thumbBlob) => {
                        URL.revokeObjectURL(img.src);
                        resolve({ blob: thumbBlob, width, height });
                    },
                    'image/jpeg',
                    0.8
                );
            };
            img.onerror = () => {
                URL.revokeObjectURL(img.src);
                reject(new Error('图片加载失败'));
            };
            img.src = URL.createObjectURL(blob);
        });
    }

    getAssetType(mimeType) {
        if (mimeType.startsWith('image/')) return 'image';
        if (mimeType === 'image/svg+xml') return 'svg';
        if (mimeType.startsWith('video/')) return 'video';
        if (mimeType.startsWith('audio/')) return 'audio';
        return 'file';
    }

    generateId() {
        return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
    }

    formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    /**
     * 获取存储使用情况
     */
    async getStorageQuota() {
        if (navigator.storage?.estimate) {
            const { usage, quota } = await navigator.storage.estimate();
            return {
                used: usage,
                total: quota,
                available: quota - usage,
                percentUsed: ((usage / quota) * 100).toFixed(1),
            };
        }
        return null;
    }
}

// 单例
export const storageManager = new StorageManager();

// 兼容：全局挂载（给 legacy IIFE/脚本使用）
if (typeof window !== 'undefined') {
    window.StorageManager = StorageManager;
    window.storageManager = storageManager;
}
