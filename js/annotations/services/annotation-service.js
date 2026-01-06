/**
 * @file js/annotations/services/annotation-service.js
 * @description 批注服务层 - 提供批注 CRUD 操作
 */

import {
  createAnnotation,
  validateAnnotation,
  updateAnnotation,
  markAsDeleted,
  serializeAnnotation,
  deserializeAnnotation,
  filterValidAnnotations,
  groupByDocId,
  compareAnnotations
} from '../core/annotation-model.js';

import { resolveSelection } from '../core/selection-resolver.js';

/**
 * 批注服务类
 */
export class AnnotationService {
  /**
   * @param {Object} options - 配置选项
   * @param {Object} options.repository - 批注仓库实例
   * @param {Object} [options.eventEmitter] - 事件发射器
   */
  constructor(options = {}) {
    this.repository = options.repository;
    this.eventEmitter = options.eventEmitter || null;
    this._cache = new Map();
    this._initialized = false;
  }

  /**
   * 初始化服务
   */
  async initialize() {
    if (this._initialized) return;

    if (this.repository) {
      await this.repository.initialize?.();
    }

    this._initialized = true;
  }

  /**
   * 发射事件
   * @private
   */
  _emit(event, data) {
    if (this.eventEmitter?.emit) {
      this.eventEmitter.emit(event, data);
    }
    // 浏览器自定义事件
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(`annotation:${event}`, { detail: data }));
    }
  }

  /**
   * 创建批注
   * @param {Object} params - 批注参数
   * @returns {Promise<Object>} 创建的批注
   */
  async create(params) {
    const annotation = createAnnotation(params);
    const validation = validateAnnotation(annotation);

    if (!validation.valid) {
      throw new Error(`Invalid annotation: ${validation.errors.join(', ')}`);
    }

    if (this.repository) {
      await this.repository.save(annotation.id, serializeAnnotation(annotation));
    }

    // 更新缓存
    this._updateCache(annotation.docId, annotation);

    this._emit('created', annotation);

    return annotation;
  }

  /**
   * 从选区创建批注
   * @param {Selection} selection - 浏览器选区
   * @param {HTMLElement} containerElement - 容器元素
   * @param {Object} options - 额外选项
   * @returns {Promise<Object>} 创建的批注
   */
  async createFromSelection(selection, containerElement, options = {}) {
    const selectionInfo = resolveSelection(selection, containerElement);

    if (!selectionInfo) {
      throw new Error('No valid selection');
    }

    const params = {
      docId: options.docId || '',
      text: selectionInfo.text,
      type: options.type || 'highlight',
      color: options.color || 'yellow',
      note: options.note || '',
      startOffset: selectionInfo.startOffset,
      endOffset: selectionInfo.endOffset,
      blockIndex: selectionInfo.blockIndex,
      contentIdentifier: options.contentIdentifier || '',
      selectionData: {
        isCrossBlock: selectionInfo.isCrossBlock,
        affectedSubBlocks: selectionInfo.affectedSubBlocks,
        startSubBlockId: selectionInfo.startSubBlockId,
        endSubBlockId: selectionInfo.endSubBlockId
      }
    };

    return this.create(params);
  }

  /**
   * 获取单个批注
   * @param {string} id - 批注 ID
   * @returns {Promise<Object|null>}
   */
  async get(id) {
    if (this.repository) {
      const data = await this.repository.get(id);
      return data ? deserializeAnnotation(data) : null;
    }
    return null;
  }

  /**
   * 获取文档的所有批注
   * @param {string} docId - 文档 ID
   * @returns {Promise<Array>}
   */
  async getByDocId(docId) {
    // 检查缓存
    if (this._cache.has(docId)) {
      return this._cache.get(docId);
    }

    if (!this.repository) return [];

    const allData = await this.repository.getAll();
    const annotations = Object.values(allData)
      .map(deserializeAnnotation)
      .filter(a => a.docId === docId && !a.isDeleted)
      .sort(compareAnnotations);

    this._cache.set(docId, annotations);

    return annotations;
  }

  /**
   * 更新批注
   * @param {string} id - 批注 ID
   * @param {Object} updates - 更新内容
   * @returns {Promise<Object>}
   */
  async update(id, updates) {
    const existing = await this.get(id);

    if (!existing) {
      throw new Error(`Annotation not found: ${id}`);
    }

    const updated = updateAnnotation(existing, updates);

    if (this.repository) {
      await this.repository.save(id, serializeAnnotation(updated));
    }

    // 更新缓存
    this._updateCache(updated.docId, updated);

    this._emit('updated', updated);

    return updated;
  }

  /**
   * 删除批注（软删除）
   * @param {string} id - 批注 ID
   * @returns {Promise<boolean>}
   */
  async delete(id) {
    const existing = await this.get(id);

    if (!existing) {
      return false;
    }

    const deleted = markAsDeleted(existing);

    if (this.repository) {
      await this.repository.save(id, serializeAnnotation(deleted));
    }

    // 从缓存中移除
    this._removeFromCache(deleted.docId, id);

    this._emit('deleted', { id, docId: deleted.docId });

    return true;
  }

  /**
   * 硬删除批注
   * @param {string} id - 批注 ID
   * @returns {Promise<boolean>}
   */
  async hardDelete(id) {
    const existing = await this.get(id);

    if (this.repository) {
      await this.repository.remove(id);
    }

    if (existing) {
      this._removeFromCache(existing.docId, id);
    }

    this._emit('deleted', { id, docId: existing?.docId });

    return true;
  }

  /**
   * 批量获取批注
   * @param {Array<string>} ids - 批注 ID 列表
   * @returns {Promise<Array>}
   */
  async getMany(ids) {
    const results = await Promise.all(ids.map(id => this.get(id)));
    return results.filter(Boolean);
  }

  /**
   * 搜索批注
   * @param {Object} criteria - 搜索条件
   * @returns {Promise<Array>}
   */
  async search(criteria = {}) {
    if (!this.repository) return [];

    const allData = await this.repository.getAll();
    let annotations = Object.values(allData)
      .map(deserializeAnnotation)
      .filter(a => !a.isDeleted);

    // 按条件过滤
    if (criteria.docId) {
      annotations = annotations.filter(a => a.docId === criteria.docId);
    }

    if (criteria.type) {
      annotations = annotations.filter(a => a.type === criteria.type);
    }

    if (criteria.color) {
      annotations = annotations.filter(a => a.color === criteria.color);
    }

    if (criteria.tags?.length) {
      annotations = annotations.filter(a =>
        criteria.tags.some(tag => a.tags.includes(tag))
      );
    }

    if (criteria.text) {
      const searchText = criteria.text.toLowerCase();
      annotations = annotations.filter(a =>
        a.text.toLowerCase().includes(searchText) ||
        a.note.toLowerCase().includes(searchText)
      );
    }

    if (criteria.startDate) {
      annotations = annotations.filter(a =>
        new Date(a.createdAt) >= new Date(criteria.startDate)
      );
    }

    if (criteria.endDate) {
      annotations = annotations.filter(a =>
        new Date(a.createdAt) <= new Date(criteria.endDate)
      );
    }

    return annotations.sort(compareAnnotations);
  }

  /**
   * 导出批注
   * @param {string} docId - 文档 ID
   * @param {string} format - 导出格式 ('json' | 'markdown')
   * @returns {Promise<string>}
   */
  async export(docId, format = 'json') {
    const annotations = await this.getByDocId(docId);

    if (format === 'markdown') {
      return this._exportAsMarkdown(annotations);
    }

    return JSON.stringify(annotations, null, 2);
  }

  /**
   * 导入批注
   * @param {string} docId - 文档 ID
   * @param {string} data - 导入数据
   * @param {string} format - 数据格式
   * @returns {Promise<Array>}
   */
  async import(docId, data, format = 'json') {
    let annotations = [];

    if (format === 'json') {
      const parsed = JSON.parse(data);
      annotations = Array.isArray(parsed) ? parsed : [parsed];
    }

    const created = [];
    for (const item of annotations) {
      const annotation = await this.create({
        ...item,
        docId,
        id: undefined // 生成新 ID
      });
      created.push(annotation);
    }

    return created;
  }

  /**
   * 清除文档的所有批注
   * @param {string} docId - 文档 ID
   * @returns {Promise<number>} 删除的数量
   */
  async clearByDocId(docId) {
    const annotations = await this.getByDocId(docId);
    let count = 0;

    // 注意：delete() 会 splice 缓存数组；这里需要先复制 id 列表，避免迭代时跳过元素
    const ids = annotations.map(a => a.id);
    for (const id of ids) {
      const ok = await this.delete(id);
      if (ok) count++;
    }

    this._cache.delete(docId);

    return count;
  }

  /**
   * 获取统计信息
   * @param {string} docId - 文档 ID
   * @returns {Promise<Object>}
   */
  async getStats(docId) {
    const annotations = await this.getByDocId(docId);

    return {
      total: annotations.length,
      byType: annotations.reduce((acc, a) => {
        acc[a.type] = (acc[a.type] || 0) + 1;
        return acc;
      }, {}),
      byColor: annotations.reduce((acc, a) => {
        acc[a.color] = (acc[a.color] || 0) + 1;
        return acc;
      }, {}),
      withNotes: annotations.filter(a => a.note).length,
      withTags: annotations.filter(a => a.tags.length > 0).length
    };
  }

  /**
   * 更新缓存
   * @private
   */
  _updateCache(docId, annotation) {
    if (!this._cache.has(docId)) {
      this._cache.set(docId, []);
    }

    const list = this._cache.get(docId);
    const index = list.findIndex(a => a.id === annotation.id);

    if (index >= 0) {
      list[index] = annotation;
    } else {
      list.push(annotation);
      list.sort(compareAnnotations);
    }
  }

  /**
   * 从缓存移除
   * @private
   */
  _removeFromCache(docId, id) {
    if (!this._cache.has(docId)) return;

    const list = this._cache.get(docId);
    const index = list.findIndex(a => a.id === id);

    if (index >= 0) {
      list.splice(index, 1);
    }
  }

  /**
   * 导出为 Markdown
   * @private
   */
  _exportAsMarkdown(annotations) {
    const lines = ['# 批注导出\n'];

    const grouped = groupByDocId(annotations);

    for (const [docId, docAnnotations] of Object.entries(grouped)) {
      lines.push(`## 文档: ${docId}\n`);

      for (const annotation of docAnnotations) {
        lines.push(`### ${annotation.type} (${annotation.color})`);
        lines.push(`> ${annotation.text}`);

        if (annotation.note) {
          lines.push(`\n**笔记:** ${annotation.note}`);
        }

        if (annotation.tags.length) {
          lines.push(`\n**标签:** ${annotation.tags.join(', ')}`);
        }

        lines.push(`\n*创建于: ${annotation.createdAt}*\n`);
      }
    }

    return lines.join('\n');
  }

  /**
   * 清除缓存
   */
  clearCache() {
    this._cache.clear();
  }

  /**
   * 销毁服务
   */
  destroy() {
    this.clearCache();
    this._initialized = false;
  }
}

/**
 * 创建批注服务实例
 * @param {Object} options - 配置选项
 * @returns {AnnotationService}
 */
export function createAnnotationService(options = {}) {
  return new AnnotationService(options);
}

// 默认导出
export default {
  AnnotationService,
  createAnnotationService
};
