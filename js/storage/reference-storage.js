// js/storage/reference-storage.js
// 参考文献存储管理器

(function(global) {
    'use strict';

    const STORAGE_KEY_PREFIX = 'pbx_references_';
    const STORAGE_KEY_INDEX = 'pbx_reference_index';

    /**
     * 参考文献存储类
     */
    class ReferenceStorage {
        constructor() {
            this.cache = new Map();
            this.loadIndex();
        }

        /**
         * 加载索引
         */
        loadIndex() {
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
         * 保存索引
         */
        saveIndex() {
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
         * @param {string} documentId - 文档ID
         * @param {Array} references - 文献数组
         * @param {Object} metadata - 元数据
         */
        saveReferences(documentId, references, metadata = {}) {
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

                const key = STORAGE_KEY_PREFIX + documentId;
                localStorage.setItem(key, JSON.stringify(data));

                // 更新索引
                if (!this.documentIds.includes(documentId)) {
                    this.documentIds.push(documentId);
                }
                this.metadata[documentId] = data.metadata;
                this.saveIndex();

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
         * @param {string} documentId - 文档ID
         * @returns {Object|null} { documentId, references, metadata }
         */
        loadReferences(documentId) {
            // 先检查缓存
            if (this.cache.has(documentId)) {
                return this.cache.get(documentId);
            }

            try {
                const key = STORAGE_KEY_PREFIX + documentId;
                const data = localStorage.getItem(key);
                if (data) {
                    const parsed = JSON.parse(data);
                    this.cache.set(documentId, parsed);
                    return parsed;
                }
                return null;
            } catch (error) {
                console.error('[ReferenceStorage] Failed to load references:', error);
                return null;
            }
        }

        /**
         * 删除文档的参考文献
         * @param {string} documentId - 文档ID
         */
        deleteReferences(documentId) {
            try {
                const key = STORAGE_KEY_PREFIX + documentId;
                localStorage.removeItem(key);

                // 更新索引
                this.documentIds = this.documentIds.filter(id => id !== documentId);
                delete this.metadata[documentId];
                this.saveIndex();

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
         * @param {string} documentId - 文档ID
         * @param {number} referenceIndex - 文献索引
         * @param {Object} updates - 更新内容
         */
        updateReference(documentId, referenceIndex, updates) {
            const data = this.loadReferences(documentId);
            if (!data || !data.references[referenceIndex]) {
                console.error('[ReferenceStorage] Reference not found');
                return false;
            }

            data.references[referenceIndex] = {
                ...data.references[referenceIndex],
                ...updates,
                updatedAt: new Date().toISOString()
            };

            return this.saveReferences(documentId, data.references, data.metadata);
        }

        /**
         * 添加新文献
         * @param {string} documentId - 文档ID
         * @param {Object} reference - 文献对象
         */
        addReference(documentId, reference) {
            let data = this.loadReferences(documentId);
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

            return this.saveReferences(documentId, data.references, data.metadata);
        }

        /**
         * 删除单个文献
         * @param {string} documentId - 文档ID
         * @param {number} referenceIndex - 文献索引
         */
        removeReference(documentId, referenceIndex) {
            const data = this.loadReferences(documentId);
            if (!data) {
                return false;
            }

            data.references.splice(referenceIndex, 1);

            // 重新索引
            data.references.forEach((ref, idx) => {
                ref.index = idx;
            });

            return this.saveReferences(documentId, data.references, data.metadata);
        }

        /**
         * 搜索文献
         * @param {string} documentId - 文档ID
         * @param {string} query - 搜索关键词
         * @returns {Array} 匹配的文献
         */
        searchReferences(documentId, query) {
            const data = this.loadReferences(documentId);
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
         * @param {string} documentId - 文档ID
         * @param {string} tag - 标签
         * @returns {Array} 匹配的文献
         */
        filterByTag(documentId, tag) {
            const data = this.loadReferences(documentId);
            if (!data) {
                return [];
            }

            return data.references.filter(ref =>
                ref.tags && ref.tags.includes(tag)
            );
        }

        /**
         * 获取所有文档列表
         * @returns {Array} 文档列表
         */
        getAllDocuments() {
            return this.documentIds.map(id => ({
                documentId: id,
                ...this.metadata[id]
            }));
        }

        /**
         * 导出文献数据（BibTeX格式）
         * @param {string} documentId - 文档ID
         * @returns {string} BibTeX格式的文献
         */
        exportToBibTeX(documentId) {
            const data = this.loadReferences(documentId);
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
         * @param {string} documentId - 文档ID
         * @returns {string} JSON格式的文献
         */
        exportToJSON(documentId) {
            const data = this.loadReferences(documentId);
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
         * @param {string} documentId - 文档ID
         * @returns {Object} 统计信息
         */
        getStatistics(documentId) {
            const data = this.loadReferences(documentId);
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

    console.log('[ReferenceStorage] Reference storage loaded.');

})(window);



