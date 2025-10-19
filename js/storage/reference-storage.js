// js/storage/reference-storage.js
// 参考文献存储管理器 - 支持前端 localStorage 和后端 API 双模式

(function(global) {
    'use strict';

    const STORAGE_KEY_PREFIX = 'pbx_references_';
    const STORAGE_KEY_INDEX = 'pbx_reference_index';

    /**
     * 判断是否为后端模式
     */
    function isBackendMode() {
        return window.storageAdapter && window.storageAdapter.isFrontendMode === false;
    }

    /**
     * 参考文献存储类
     */
    class ReferenceStorage {
        constructor() {
            this.cache = new Map();
            this.loadIndex();
        }

        /**
         * 加载索引（仅前端模式）
         */
        loadIndex() {
            if (isBackendMode()) {
                this.documentIds = [];
                this.metadata = {};
                return;
            }

            try {
                const indexData = localStorage.getItem(STORAGE_KEY_INDEX);
                if (indexData) {
                    const index = JSON.parse(indexData);
                    this.documentIds = index.documentIds || [];
                    this.metadata = index.metadata || {};
                } else {
                    this.documentIds = [];
                    this.metadata = {};
                }
            } catch (error) {
                console.error('[ReferenceStorage] Failed to load index:', error);
                this.documentIds = [];
                this.metadata = {};
            }
        }

        /**
         * 保存索引（仅前端模式）
         */
        saveIndex() {
            if (isBackendMode()) return;

            try {
                const index = {
                    documentIds: this.documentIds,
                    metadata: this.metadata,
                    lastUpdated: new Date().toISOString()
                };
                localStorage.setItem(STORAGE_KEY_INDEX, JSON.stringify(index));
            } catch (error) {
                console.error('[ReferenceStorage] Failed to save index:', error);
            }
        }

        /**
         * 保存文档的参考文献
         */
        async saveReferences(documentId, references, metadata = {}) {
            try {
                const data = {
                    documentId: documentId,
                    references: references,
                    metadata: {
                        ...metadata,
                        totalCount: references.length,
                        savedAt: new Date().toISOString()
                    }
                };

                if (isBackendMode()) {
                    // 后端模式：批量保存引用
                    // 先清空旧的，再批量添加
                    const existing = await window.storageAdapter.loadReferences(documentId);
                    // TODO: 可优化为差异同步
                    for (const ref of references) {
                        await window.storageAdapter.saveReference(documentId, {
                            citationKey: ref.citationKey || `[${ref.index + 1}]`,
                            doi: ref.doi,
                            title: ref.title,
                            authors: ref.authors,
                            year: ref.year,
                            journal: ref.journal,
                            volume: ref.volume,
                            pages: ref.pages,
                            url: ref.url,
                            metadata: ref
                        });
                    }
                } else {
                    // 前端模式：localStorage
                    const key = STORAGE_KEY_PREFIX + documentId;
                    localStorage.setItem(key, JSON.stringify(data));

                    // 更新索引
                    if (!this.documentIds.includes(documentId)) {
                        this.documentIds.push(documentId);
                    }
                    this.metadata[documentId] = data.metadata;
                    this.saveIndex();
                }

                // 更新缓存
                this.cache.set(documentId, data);

                console.log(`[ReferenceStorage] Saved ${references.length} references for document ${documentId}`);
                return true;
            } catch (error) {
                console.error('[ReferenceStorage] Failed to save references:', error);
                return false;
            }
        }

        /**
         * 加载文档的参考文献
         */
        async loadReferences(documentId) {
            // 先检查缓存
            if (this.cache.has(documentId)) {
                return this.cache.get(documentId);
            }

            try {
                if (isBackendMode()) {
                    // 后端模式：从 API 加载
                    const backendRefs = await window.storageAdapter.loadReferences(documentId);
                    const data = {
                        documentId: documentId,
                        references: backendRefs.map((ref, idx) => ({
                            index: idx,
                            citationKey: ref.citationKey,
                            doi: ref.doi,
                            title: ref.title,
                            authors: ref.authors,
                            year: ref.year,
                            journal: ref.journal,
                            volume: ref.volume,
                            pages: ref.pages,
                            url: ref.url,
                            ...(ref.metadata || {})
                        })),
                        metadata: {
                            totalCount: backendRefs.length
                        }
                    };
                    this.cache.set(documentId, data);
                    return data;
                } else {
                    // 前端模式：localStorage
                    const key = STORAGE_KEY_PREFIX + documentId;
                    const storedData = localStorage.getItem(key);
                    if (storedData) {
                        const parsed = JSON.parse(storedData);
                        this.cache.set(documentId, parsed);
                        return parsed;
                    }
                }
                return null;
            } catch (error) {
                console.error('[ReferenceStorage] Failed to load references:', error);
                return null;
            }
        }

        /**
         * 删除文档的参考文献
         */
        async deleteReferences(documentId) {
            try {
                if (isBackendMode()) {
                    // 后端模式：调用 API 删除
                    const refs = await window.storageAdapter.loadReferences(documentId);
                    for (const ref of refs) {
                        await window.storageAdapter.deleteReference(documentId, ref.id);
                    }
                } else {
                    // 前端模式：localStorage
                    const key = STORAGE_KEY_PREFIX + documentId;
                    localStorage.removeItem(key);

                    // 更新索引
                    this.documentIds = this.documentIds.filter(id => id !== documentId);
                    delete this.metadata[documentId];
                    this.saveIndex();
                }

                // 清除缓存
                this.cache.delete(documentId);

                console.log(`[ReferenceStorage] Deleted references for document ${documentId}`);
                return true;
            } catch (error) {
                console.error('[ReferenceStorage] Failed to delete references:', error);
                return false;
            }
        }

        /**
         * 更新单个文献
         */
        async updateReference(documentId, referenceIndex, updates) {
            const data = await this.loadReferences(documentId);
            if (!data || !data.references[referenceIndex]) {
                console.error('[ReferenceStorage] Reference not found');
                return false;
            }

            data.references[referenceIndex] = {
                ...data.references[referenceIndex],
                ...updates,
                updatedAt: new Date().toISOString()
            };

            return await this.saveReferences(documentId, data.references, data.metadata);
        }

        /**
         * 添加新文献
         */
        async addReference(documentId, reference) {
            let data = await this.loadReferences(documentId);
            if (!data) {
                data = {
                    documentId: documentId,
                    references: [],
                    metadata: {}
                };
            }

            reference.index = data.references.length;
            reference.addedAt = new Date().toISOString();
            data.references.push(reference);

            return await this.saveReferences(documentId, data.references, data.metadata);
        }

        /**
         * 删除单个文献
         */
        async removeReference(documentId, referenceIndex) {
            const data = await this.loadReferences(documentId);
            if (!data) {
                return false;
            }

            data.references.splice(referenceIndex, 1);

            // 重新索引
            data.references.forEach((ref, idx) => {
                ref.index = idx;
            });

            return await this.saveReferences(documentId, data.references, data.metadata);
        }

        /**
         * 搜索文献
         */
        async searchReferences(documentId, query) {
            const data = await this.loadReferences(documentId);
            if (!data) {
                return [];
            }

            const lowerQuery = query.toLowerCase();
            return data.references.filter(ref => {
                const searchText = [
                    ref.title,
                    ...(ref.authors || []),
                    ref.journal,
                    ref.doi,
                    ref.rawText
                ].filter(Boolean).join(' ').toLowerCase();

                return searchText.includes(lowerQuery);
            });
        }

        /**
         * 按标签筛选文献
         */
        async filterByTag(documentId, tag) {
            const data = await this.loadReferences(documentId);
            if (!data) {
                return [];
            }

            return data.references.filter(ref =>
                ref.tags && ref.tags.includes(tag)
            );
        }

        /**
         * 获取所有文档列表
         */
        getAllDocuments() {
            return this.documentIds.map(id => ({
                documentId: id,
                ...this.metadata[id]
            }));
        }

        /**
         * 导出文献数据（BibTeX格式）
         */
        async exportToBibTeX(documentId) {
            const data = await this.loadReferences(documentId);
            if (!data) {
                return '';
            }

            const bibtex = data.references.map((ref, idx) => {
                const key = `ref${idx + 1}`;
                const type = ref.type || 'article';
                const fields = [];

                if (ref.authors && ref.authors.length > 0) {
                    fields.push(`  author = {${ref.authors.join(' and ')}}`);
                }
                if (ref.title) {
                    fields.push(`  title = {${ref.title}}`);
                }
                if (ref.journal) {
                    fields.push(`  journal = {${ref.journal}}`);
                }
                if (ref.year) {
                    fields.push(`  year = {${ref.year}}`);
                }
                if (ref.volume) {
                    fields.push(`  volume = {${ref.volume}}`);
                }
                if (ref.issue) {
                    fields.push(`  number = {${ref.issue}}`);
                }
                if (ref.pages) {
                    fields.push(`  pages = {${ref.pages}}`);
                }
                if (ref.doi) {
                    fields.push(`  doi = {${ref.doi}}`);
                }
                if (ref.url) {
                    fields.push(`  url = {${ref.url}}`);
                }

                return `@${type}{${key},\n${fields.join(',\n')}\n}`;
            });

            return bibtex.join('\n\n');
        }

        /**
         * 导出文献数据（JSON格式）
         */
        async exportToJSON(documentId) {
            const data = await this.loadReferences(documentId);
            if (!data) {
                return '[]';
            }

            return JSON.stringify(data.references, null, 2);
        }

        /**
         * 清空缓存
         */
        clearCache() {
            this.cache.clear();
        }

        /**
         * 获取统计信息
         */
        async getStatistics(documentId) {
            const data = await this.loadReferences(documentId);
            if (!data) {
                return null;
            }

            const stats = {
                total: data.references.length,
                withDOI: 0,
                byType: {},
                byYear: {},
                byTag: {},
                avgConfidence: 0
            };

            let totalConfidence = 0;

            data.references.forEach(ref => {
                // DOI统计
                if (ref.doi) stats.withDOI++;

                // 类型统计
                const type = ref.type || 'unknown';
                stats.byType[type] = (stats.byType[type] || 0) + 1;

                // 年份统计
                if (ref.year) {
                    stats.byYear[ref.year] = (stats.byYear[ref.year] || 0) + 1;
                }

                // 标签统计
                if (ref.tags) {
                    ref.tags.forEach(tag => {
                        stats.byTag[tag] = (stats.byTag[tag] || 0) + 1;
                    });
                }

                // 置信度统计
                if (ref.confidence !== undefined) {
                    totalConfidence += ref.confidence;
                }
            });

            stats.avgConfidence = stats.total > 0 ? totalConfidence / stats.total : 0;

            return stats;
        }
    }

    // 创建全局实例
    const storage = new ReferenceStorage();

    // 导出API
    global.ReferenceStorage = storage;

    console.log('[ReferenceStorage] Reference storage loaded (supports frontend & backend modes).');

})(window);



