/**
 * @file tests/annotations/annotation-service.test.js
 * @description 批注服务层测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// 模拟 Repository
class MockRepository {
  constructor() {
    this.data = new Map();
  }

  async initialize() {}

  async get(id) {
    return this.data.get(id) || null;
  }

  async save(id, value) {
    this.data.set(id, value);
  }

  async remove(id) {
    this.data.delete(id);
  }

  async getAll() {
    const result = {};
    for (const [key, value] of this.data) {
      result[key] = value;
    }
    return result;
  }

  async clear() {
    this.data.clear();
  }
}

// 动态导入
const loadModules = async () => {
  const service = await import('../../js/annotations/services/annotation-service.js');
  const model = await import('../../js/annotations/core/annotation-model.js');
  return { ...service, ...model };
};

describe('AnnotationService', () => {
  let AnnotationService, createAnnotation;
  let service;
  let mockRepo;

  beforeEach(async () => {
    const modules = await loadModules();
    AnnotationService = modules.AnnotationService;
    createAnnotation = modules.createAnnotation;

    mockRepo = new MockRepository();
    service = new AnnotationService({ repository: mockRepo });
    await service.initialize();
  });

  describe('create', () => {
    it('should create and store annotation', async () => {
      const annotation = await service.create({
        docId: 'doc-123',
        text: 'Test text'
      });

      expect(annotation.id).toBeDefined();
      expect(annotation.docId).toBe('doc-123');
      expect(annotation.text).toBe('Test text');

      // 验证存储
      const stored = await mockRepo.get(annotation.id);
      expect(stored).toBeDefined();
      expect(stored.docId).toBe('doc-123');
    });

    it('should emit created event', async () => {
      const handler = vi.fn();
      if (typeof window !== 'undefined') {
        window.addEventListener('annotation:created', handler);
      }

      await service.create({
        docId: 'doc-123',
        text: 'Test'
      });

      // 事件应该被触发
      if (typeof window !== 'undefined') {
        expect(handler).toHaveBeenCalled();
        window.removeEventListener('annotation:created', handler);
      }
    });

    it('should throw on invalid annotation', async () => {
      await expect(service.create({ text: '' })).rejects.toThrow();
    });
  });

  describe('get', () => {
    it('should retrieve annotation by id', async () => {
      const created = await service.create({
        docId: 'doc-123',
        text: 'Test'
      });

      const retrieved = await service.get(created.id);
      expect(retrieved).toBeDefined();
      expect(retrieved.id).toBe(created.id);
      expect(retrieved.text).toBe('Test');
    });

    it('should return null for non-existent id', async () => {
      const result = await service.get('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('getMany', () => {
    it('should return only existing annotations', async () => {
      const a1 = await service.create({ docId: 'doc-1', text: 'A1' });
      const a2 = await service.create({ docId: 'doc-1', text: 'A2' });

      const results = await service.getMany([a1.id, 'missing', a2.id]);
      expect(results.map(a => a.id).sort()).toEqual([a1.id, a2.id].sort());
    });
  });

  describe('getByDocId', () => {
    it('should retrieve all annotations for a document', async () => {
      await service.create({ docId: 'doc-1', text: 'Text 1' });
      await service.create({ docId: 'doc-1', text: 'Text 2' });
      await service.create({ docId: 'doc-2', text: 'Text 3' });

      const doc1Annotations = await service.getByDocId('doc-1');
      expect(doc1Annotations.length).toBe(2);

      const doc2Annotations = await service.getByDocId('doc-2');
      expect(doc2Annotations.length).toBe(1);
    });

    it('should cache results', async () => {
      await service.create({ docId: 'doc-1', text: 'Text' });

      // 第一次调用
      const result1 = await service.getByDocId('doc-1');

      // 第二次调用应该使用缓存
      const result2 = await service.getByDocId('doc-1');

      expect(result1).toEqual(result2);
    });

    it('should return empty array for unknown docId', async () => {
      const result = await service.getByDocId('unknown');
      expect(result).toEqual([]);
    });
  });

  describe('update', () => {
    it('should update annotation', async () => {
      const created = await service.create({
        docId: 'doc-123',
        text: 'Original'
      });

      const updated = await service.update(created.id, {
        text: 'Modified',
        note: 'Added note'
      });

      expect(updated.text).toBe('Modified');
      expect(updated.note).toBe('Added note');
      expect(updated.id).toBe(created.id);
    });

    it('should throw for non-existent annotation', async () => {
      await expect(service.update('non-existent', { text: 'test' }))
        .rejects.toThrow('Annotation not found');
    });

    it('should update cache', async () => {
      const created = await service.create({
        docId: 'doc-1',
        text: 'Original'
      });

      await service.update(created.id, { text: 'Modified' });

      const cached = await service.getByDocId('doc-1');
      expect(cached[0].text).toBe('Modified');
    });
  });

  describe('delete', () => {
    it('should soft delete annotation', async () => {
      const created = await service.create({
        docId: 'doc-123',
        text: 'Test'
      });

      const result = await service.delete(created.id);
      expect(result).toBe(true);

      // 应该仍然存在但标记为已删除
      const stored = await mockRepo.get(created.id);
      expect(stored.isDeleted).toBe(true);
    });

    it('should remove from cache', async () => {
      const created = await service.create({
        docId: 'doc-1',
        text: 'Test'
      });

      await service.delete(created.id);

      const cached = await service.getByDocId('doc-1');
      expect(cached.find(a => a.id === created.id)).toBeUndefined();
    });

    it('should return false for non-existent annotation', async () => {
      const result = await service.delete('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('hardDelete', () => {
    it('should permanently delete annotation', async () => {
      const created = await service.create({
        docId: 'doc-123',
        text: 'Test'
      });

      await service.hardDelete(created.id);

      const stored = await mockRepo.get(created.id);
      expect(stored).toBeNull();
    });
  });

  describe('search', () => {
    beforeEach(async () => {
      await service.create({ docId: 'doc-1', text: 'Hello world', type: 'highlight', color: 'yellow' });
      await service.create({ docId: 'doc-1', text: 'Test annotation', type: 'note', color: 'blue' });
      await service.create({ docId: 'doc-2', text: 'Another text', type: 'highlight', color: 'yellow' });
    });

    it('should search by docId', async () => {
      const results = await service.search({ docId: 'doc-1' });
      expect(results.length).toBe(2);
    });

    it('should search by type', async () => {
      const results = await service.search({ type: 'highlight' });
      expect(results.length).toBe(2);
    });

    it('should search by color', async () => {
      const results = await service.search({ color: 'blue' });
      expect(results.length).toBe(1);
    });

    it('should search by text content', async () => {
      const results = await service.search({ text: 'hello' });
      expect(results.length).toBe(1);
      expect(results[0].text).toBe('Hello world');
    });

    it('should combine multiple criteria', async () => {
      const results = await service.search({
        docId: 'doc-1',
        type: 'highlight'
      });
      expect(results.length).toBe(1);
    });

    it('should search by startDate/endDate', async () => {
      // 注入可控 createdAt
      await service.create({ docId: 'doc-date', text: 'Old', createdAt: '2020-01-01T00:00:00.000Z' });
      await service.create({ docId: 'doc-date', text: 'New', createdAt: '2021-01-01T00:00:00.000Z' });

      const endOnly = await service.search({ docId: 'doc-date', endDate: '2020-12-31T23:59:59.999Z' });
      expect(endOnly.length).toBe(1);
      expect(endOnly[0].text).toBe('Old');

      const startOnly = await service.search({ docId: 'doc-date', startDate: '2020-12-31T23:59:59.999Z' });
      expect(startOnly.length).toBe(1);
      expect(startOnly[0].text).toBe('New');
    });

    it('should search by tags', async () => {
      await service.create({ docId: 'doc-tag', text: 'Tagged', tags: ['important'] });
      const results = await service.search({ tags: ['important'] });
      expect(results.length).toBe(1);
      expect(results[0].text).toBe('Tagged');
    });
  });

  describe('getStats', () => {
    it('should return statistics for document', async () => {
      await service.create({ docId: 'doc-1', text: 'Text 1', type: 'highlight', color: 'yellow' });
      await service.create({ docId: 'doc-1', text: 'Text 2', type: 'highlight', color: 'blue', note: 'Has note' });
      await service.create({ docId: 'doc-1', text: 'Text 3', type: 'note', color: 'yellow', tags: ['important'] });

      const stats = await service.getStats('doc-1');

      expect(stats.total).toBe(3);
      expect(stats.byType.highlight).toBe(2);
      expect(stats.byType.note).toBe(1);
      expect(stats.byColor.yellow).toBe(2);
      expect(stats.byColor.blue).toBe(1);
      expect(stats.withNotes).toBe(1);
      expect(stats.withTags).toBe(1);
    });
  });

  describe('export/import', () => {
    it('should export as JSON', async () => {
      await service.create({ docId: 'doc-1', text: 'Text 1' });
      await service.create({ docId: 'doc-1', text: 'Text 2' });

      const exported = await service.export('doc-1', 'json');
      const parsed = JSON.parse(exported);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(2);
    });

    it('should export as Markdown', async () => {
      await service.create({ docId: 'doc-1', text: 'Text 1', note: 'Note 1', tags: ['t1', 't2'] });

      const exported = await service.export('doc-1', 'markdown');

      expect(exported).toContain('# 批注导出');
      expect(exported).toContain('Text 1');
      expect(exported).toContain('Note 1');
      expect(exported).toContain('**标签:**');
    });

    it('should import annotations', async () => {
      const data = JSON.stringify([
        { text: 'Imported 1', type: 'highlight' },
        { text: 'Imported 2', type: 'note' }
      ]);

      const imported = await service.import('doc-new', data, 'json');

      expect(imported.length).toBe(2);
      expect(imported[0].docId).toBe('doc-new');
      expect(imported[1].docId).toBe('doc-new');
    });
  });

  describe('clearByDocId', () => {
    it('should clear all annotations for a document', async () => {
      await service.create({ docId: 'doc-1', text: 'Text 1' });
      await service.create({ docId: 'doc-1', text: 'Text 2' });
      await service.create({ docId: 'doc-2', text: 'Text 3' });

      const count = await service.clearByDocId('doc-1');
      expect(count).toBe(2);

      const remaining = await service.getByDocId('doc-1');
      expect(remaining.length).toBe(0);

      const doc2 = await service.getByDocId('doc-2');
      expect(doc2.length).toBe(1);
    });
  });

  describe('clearCache', () => {
    it('should clear internal cache', async () => {
      await service.create({ docId: 'doc-1', text: 'Text' });
      await service.getByDocId('doc-1'); // 填充缓存

      service.clearCache();

      // 缓存应该被清除，下次调用会重新查询
      const result = await service.getByDocId('doc-1');
      expect(result.length).toBe(1);
    });
  });

  describe('destroy/createAnnotationService', () => {
    it('destroy() clears cache and resets initialized state', async () => {
      await service.create({ docId: 'doc-1', text: 'Text' });
      await service.getByDocId('doc-1'); // 填充缓存

      service.destroy();
      expect(service._initialized).toBe(false);

      // 再次 initialize 应该可用
      await service.initialize();
      const result = await service.getByDocId('doc-1');
      expect(result.length).toBe(1);
    });

    it('createAnnotationService() creates an instance', async () => {
      const { createAnnotationService, AnnotationService } = await import('../../js/annotations/services/annotation-service.js');
      const created = createAnnotationService({ repository: mockRepo });
      expect(created).toBeInstanceOf(AnnotationService);
    });
  });
});
