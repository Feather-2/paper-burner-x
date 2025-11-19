// vector-worker.js
// Web Worker for vector computations (cosine similarity, etc.)
// 解决主线程阻塞问题

'use strict';

/**
 * 计算两个向量的余弦相似度
 * @param {number[]} vecA - 向量 A
 * @param {number[]} vecB - 向量 B
 * @returns {number} 余弦相似度 (0-1)
 */
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

/**
 * 批量计算向量相似度
 * @param {number[]} queryVector - 查询向量
 * @param {Array} items - 待比较的向量数组 [{id, vector, ...}]
 * @param {number} topK - 返回前 K 个结果
 * @returns {Array} 排序后的结果
 */
function batchCosineSimilarity(queryVector, items, topK = 10) {
  const results = items.map(item => ({
    ...item,
    score: cosineSimilarity(queryVector, item.vector)
  }));

  // 按相似度降序排序
  results.sort((a, b) => b.score - a.score);

  // 返回 Top-K
  return results.slice(0, topK);
}

// Worker 消息处理
self.onmessage = function(e) {
  const { type, payload, requestId } = e.data;

  try {
    let result;

    switch (type) {
      case 'cosineSimilarity':
        result = cosineSimilarity(payload.vecA, payload.vecB);
        break;

      case 'batchSearch':
        result = batchCosineSimilarity(
          payload.queryVector,
          payload.items,
          payload.topK || 10
        );
        break;

      default:
        throw new Error(`Unknown task type: ${type}`);
    }

    self.postMessage({
      success: true,
      requestId,
      result
    });

  } catch (error) {
    self.postMessage({
      success: false,
      requestId,
      error: error.message
    });
  }
};

// Worker 初始化完成
self.postMessage({ type: 'ready' });
