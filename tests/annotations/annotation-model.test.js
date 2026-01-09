/**
 * @file tests/annotations/annotation-model.test.js
 * @description 批注数据模型测试
 */

import { describe, it, expect, beforeEach } from 'vitest';

// 动态导入
const loadModules = async () => {
  const model = await import('../../js/annotations/core/annotation-model.js');
  return model;
};

describe('AnnotationType', () => {
  it('should define annotation types', async () => {
    const { AnnotationType } = await loadModules();
    expect(AnnotationType.HIGHLIGHT).toBe('highlight');
    expect(AnnotationType.NOTE).toBe('note');
    expect(AnnotationType.UNDERLINE).toBe('underline');
    expect(AnnotationType.STRIKETHROUGH).toBe('strikethrough');
  });
});

describe('AnnotationColors', () => {
  it('should define color presets', async () => {
    const { AnnotationColors } = await loadModules();
    expect(AnnotationColors.YELLOW).toBe('#ffeb3b');
    expect(AnnotationColors.GREEN).toBe('#4caf50');
    expect(AnnotationColors.BLUE).toBe('#2196f3');
  });
});

describe('createAnnotation', () => {
  it('should create annotation with defaults', async () => {
    const { createAnnotation, AnnotationType, AnnotationColors } = await loadModules();
    const annotation = createAnnotation();

    expect(annotation.id).toBeDefined();
    expect(annotation.docId).toBe('');
    expect(annotation.type).toBe(AnnotationType.HIGHLIGHT);
    expect(annotation.color).toBe(AnnotationColors.YELLOW);
    expect(annotation.text).toBe('');
    expect(annotation.note).toBe('');
    expect(annotation.isDeleted).toBe(false);
    expect(annotation.tags).toEqual([]);
    expect(annotation.createdAt).toBeDefined();
    expect(annotation.updatedAt).toBeDefined();
  });

  it('should create annotation with custom params', async () => {
    const { createAnnotation, AnnotationType, AnnotationColors } = await loadModules();
    const annotation = createAnnotation({
      docId: 'doc-123',
      type: AnnotationType.NOTE,
      text: 'Selected text',
      note: 'My note',
      color: AnnotationColors.BLUE,
      startOffset: 10,
      endOffset: 50,
      blockIndex: 3,
      tags: ['important', 'review']
    });

    expect(annotation.docId).toBe('doc-123');
    expect(annotation.type).toBe('note');
    expect(annotation.text).toBe('Selected text');
    expect(annotation.note).toBe('My note');
    expect(annotation.color).toBe('#2196f3');
    expect(annotation.startOffset).toBe(10);
    expect(annotation.endOffset).toBe(50);
    expect(annotation.blockIndex).toBe(3);
    expect(annotation.tags).toEqual(['important', 'review']);
  });

  it('should use provided id', async () => {
    const { createAnnotation } = await loadModules();
    const annotation = createAnnotation({ id: 'custom-id' });
    expect(annotation.id).toBe('custom-id');
  });
});

describe('validateAnnotation', () => {
  it('should validate valid annotation', async () => {
    const { createAnnotation, validateAnnotation } = await loadModules();
    const annotation = createAnnotation({
      docId: 'doc-123',
      text: 'Some text'
    });
    const result = validateAnnotation(annotation);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('should fail without id', async () => {
    const { validateAnnotation } = await loadModules();
    const result = validateAnnotation({ docId: 'doc', text: 'text' });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing id');
  });

  it('should fail without docId', async () => {
    const { validateAnnotation } = await loadModules();
    const result = validateAnnotation({ id: 'id', text: 'text', type: 'highlight' });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing docId');
  });

  it('should fail without text or note', async () => {
    const { validateAnnotation } = await loadModules();
    const result = validateAnnotation({ id: 'id', docId: 'doc', type: 'highlight' });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Annotation must have text or note');
  });

  it('should fail with invalid type', async () => {
    const { validateAnnotation } = await loadModules();
    const result = validateAnnotation({
      id: 'id',
      docId: 'doc',
      text: 'text',
      type: 'invalid-type'
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Invalid type'))).toBe(true);
  });
});

describe('updateAnnotation', () => {
  it('should update annotation fields', async () => {
    const { createAnnotation, updateAnnotation } = await loadModules();
    const original = createAnnotation({ text: 'original', updatedAt: '2000-01-01T00:00:00.000Z' });
    const originalUpdatedAt = original.updatedAt;

    const updated = updateAnnotation(original, { text: 'modified', note: 'new note' });

    expect(updated.text).toBe('modified');
    expect(updated.note).toBe('new note');
    expect(updated.id).toBe(original.id);
    expect(updated.updatedAt).not.toBe(originalUpdatedAt);
  });

  it('should preserve unchanged fields', async () => {
    const { createAnnotation, updateAnnotation } = await loadModules();
    const original = createAnnotation({
      text: 'text',
      color: '#ff0000',
      tags: ['tag1']
    });

    const updated = updateAnnotation(original, { note: 'added note' });

    expect(updated.text).toBe('text');
    expect(updated.color).toBe('#ff0000');
    expect(updated.tags).toEqual(['tag1']);
  });
});

describe('markAsDeleted', () => {
  it('should mark annotation as deleted', async () => {
    const { createAnnotation, markAsDeleted } = await loadModules();
    const annotation = createAnnotation({ text: 'text' });
    expect(annotation.isDeleted).toBe(false);

    const deleted = markAsDeleted(annotation);
    expect(deleted.isDeleted).toBe(true);
    expect(deleted.id).toBe(annotation.id);
  });
});

describe('compareAnnotations', () => {
  it('should sort by blockIndex first', async () => {
    const { createAnnotation, compareAnnotations } = await loadModules();
    const a = createAnnotation({ blockIndex: 1, startOffset: 100 });
    const b = createAnnotation({ blockIndex: 2, startOffset: 0 });

    expect(compareAnnotations(a, b)).toBeLessThan(0);
    expect(compareAnnotations(b, a)).toBeGreaterThan(0);
  });

  it('should sort by startOffset when blockIndex is equal', async () => {
    const { createAnnotation, compareAnnotations } = await loadModules();
    const a = createAnnotation({ blockIndex: 1, startOffset: 10 });
    const b = createAnnotation({ blockIndex: 1, startOffset: 50 });

    expect(compareAnnotations(a, b)).toBeLessThan(0);
    expect(compareAnnotations(b, a)).toBeGreaterThan(0);
  });

  it('should return 0 for equal positions', async () => {
    const { createAnnotation, compareAnnotations } = await loadModules();
    const a = createAnnotation({ blockIndex: 1, startOffset: 10 });
    const b = createAnnotation({ blockIndex: 1, startOffset: 10 });

    expect(compareAnnotations(a, b)).toBe(0);
  });
});

describe('filterValidAnnotations', () => {
  it('should filter out deleted annotations', async () => {
    const { createAnnotation, markAsDeleted, filterValidAnnotations } = await loadModules();
    const a1 = createAnnotation({ text: 'a1' });
    const a2 = markAsDeleted(createAnnotation({ text: 'a2' }));
    const a3 = createAnnotation({ text: 'a3' });

    const valid = filterValidAnnotations([a1, a2, a3]);
    expect(valid.length).toBe(2);
    expect(valid.map(a => a.text)).toEqual(['a1', 'a3']);
  });
});

describe('groupByDocId', () => {
  it('should group annotations by docId', async () => {
    const { createAnnotation, groupByDocId } = await loadModules();
    const annotations = [
      createAnnotation({ docId: 'doc1', text: 'a' }),
      createAnnotation({ docId: 'doc2', text: 'b' }),
      createAnnotation({ docId: 'doc1', text: 'c' }),
      createAnnotation({ docId: 'doc3', text: 'd' }),
      createAnnotation({ docId: 'doc2', text: 'e' })
    ];

    const grouped = groupByDocId(annotations);
    expect(Object.keys(grouped)).toEqual(['doc1', 'doc2', 'doc3']);
    expect(grouped['doc1'].length).toBe(2);
    expect(grouped['doc2'].length).toBe(2);
    expect(grouped['doc3'].length).toBe(1);
  });
});

describe('serialize/deserialize', () => {
  it('should serialize and deserialize annotation', async () => {
    const { createAnnotation, serializeAnnotation, deserializeAnnotation } = await loadModules();
    const original = createAnnotation({
      docId: 'doc-123',
      text: 'test text',
      note: 'test note',
      tags: ['tag1', 'tag2']
    });

    // 添加运行时字段（无需依赖 DOM）
    original._element = { tag: 'div' };
    original._range = { start: 0, end: 1 };

    const serialized = serializeAnnotation(original);
    expect(serialized._element).toBeUndefined();
    expect(serialized._range).toBeUndefined();

    const deserialized = deserializeAnnotation(serialized);
    expect(deserialized.docId).toBe('doc-123');
    expect(deserialized.text).toBe('test text');
    expect(deserialized.note).toBe('test note');
    expect(deserialized.tags).toEqual(['tag1', 'tag2']);
  });
});
