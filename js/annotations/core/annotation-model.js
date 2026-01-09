/**
 * @file js/annotations/core/annotation-model.js
 * @description 批注数据模型定义
 */

import { generateUUID } from '../../shared/utils/uuid.js';

/**
 * 批注类型
 */
export const AnnotationType = {
  HIGHLIGHT: 'highlight',
  NOTE: 'note',
  UNDERLINE: 'underline',
  STRIKETHROUGH: 'strikethrough'
};

/**
 * 批注颜色预设
 */
export const AnnotationColors = {
  YELLOW: '#ffeb3b',
  GREEN: '#4caf50',
  BLUE: '#2196f3',
  PINK: '#e91e63',
  PURPLE: '#9c27b0',
  ORANGE: '#ff9800'
};

/**
 * 创建批注对象
 * @param {Object} params - 批注参数
 * @returns {Object} 批注对象
 */
export function createAnnotation(params = {}) {
  const now = new Date().toISOString();

  return {
    id: params.id || generateUUID(),
    docId: params.docId || '',
    type: params.type || AnnotationType.HIGHLIGHT,
    text: params.text || '',
    note: params.note || '',
    color: params.color || AnnotationColors.YELLOW,

    // 位置信息
    startOffset: params.startOffset ?? 0,
    endOffset: params.endOffset ?? 0,
    blockIndex: params.blockIndex ?? -1,
    contentIdentifier: params.contentIdentifier || '',

    // 选区信息（用于重建选区）
    selectionData: params.selectionData || null,

    // 元数据
    createdAt: params.createdAt || now,
    updatedAt: params.updatedAt || now,
    tags: params.tags || [],

    // 状态
    isDeleted: params.isDeleted || false
  };
}

/**
 * 验证批注对象
 * @param {Object} annotation - 批注对象
 * @returns {Object} 验证结果
 */
export function validateAnnotation(annotation) {
  const errors = [];

  if (!annotation.id) {
    errors.push('Missing id');
  }

  if (!annotation.docId) {
    errors.push('Missing docId');
  }

  if (!annotation.text && !annotation.note) {
    errors.push('Annotation must have text or note');
  }

  if (!Object.values(AnnotationType).includes(annotation.type)) {
    errors.push(`Invalid type: ${annotation.type}`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * 更新批注
 * @param {Object} annotation - 原批注
 * @param {Object} updates - 更新内容
 * @returns {Object} 更新后的批注
 */
export function updateAnnotation(annotation, updates) {
  return {
    ...annotation,
    ...updates,
    updatedAt: new Date().toISOString()
  };
}

/**
 * 标记批注为已删除
 * @param {Object} annotation - 批注对象
 * @returns {Object} 标记后的批注
 */
export function markAsDeleted(annotation) {
  return updateAnnotation(annotation, { isDeleted: true });
}

/**
 * 批注比较（用于排序）
 * @param {Object} a - 批注 A
 * @param {Object} b - 批注 B
 * @returns {number} 比较结果
 */
export function compareAnnotations(a, b) {
  // 先按块索引排序
  if (a.blockIndex !== b.blockIndex) {
    return a.blockIndex - b.blockIndex;
  }
  // 再按起始偏移排序
  return a.startOffset - b.startOffset;
}

/**
 * 过滤有效批注
 * @param {Array} annotations - 批注数组
 * @returns {Array} 过滤后的批注
 */
export function filterValidAnnotations(annotations) {
  return annotations.filter(a => !a.isDeleted);
}

/**
 * 按文档 ID 分组
 * @param {Array} annotations - 批注数组
 * @returns {Object} 分组结果
 */
export function groupByDocId(annotations) {
  return annotations.reduce((acc, annotation) => {
    const docId = annotation.docId;
    if (!acc[docId]) {
      acc[docId] = [];
    }
    acc[docId].push(annotation);
    return acc;
  }, {});
}

/**
 * 序列化批注（用于存储）
 * @param {Object} annotation - 批注对象
 * @returns {Object} 序列化后的对象
 */
export function serializeAnnotation(annotation) {
  return {
    ...annotation,
    // 移除不需要持久化的字段
    _element: undefined,
    _range: undefined
  };
}

/**
 * 反序列化批注（从存储恢复）
 * @param {Object} data - 存储的数据
 * @returns {Object} 批注对象
 */
export function deserializeAnnotation(data) {
  return createAnnotation(data);
}

// 默认导出
export default {
  AnnotationType,
  AnnotationColors,
  create: createAnnotation,
  validate: validateAnnotation,
  update: updateAnnotation,
  markAsDeleted,
  compare: compareAnnotations,
  filterValid: filterValidAnnotations,
  groupByDocId,
  serialize: serializeAnnotation,
  deserialize: deserializeAnnotation
};
