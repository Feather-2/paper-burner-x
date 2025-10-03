// content-processor.js
// 内容处理模块

(function() {
  'use strict';

  /**
   * 获取当前文档的内容信息
   * @returns {object} 文档内容对象
   */
  function getCurrentDocContent() {
  if (window.data) {
    return {
      ocr: window.data.ocr || '',
      translation: window.data.translation || '',
      images: window.data.images || [],
      name: window.data.name || '',
      // 新增：传递意群数据
      semanticGroups: window.data.semanticGroups || null,
      ocrChunks: window.data.ocrChunks || null,
      translatedChunks: window.data.translatedChunks || null
    };
  }
  return { ocr: '', translation: '', images: [], name: '', semanticGroups: null, ocrChunks: null, translatedChunks: null };
}

/**
 * 根据聊天历史和用户当前输入构建对话消息列表。
 * 消息格式遵循大语言模型 API 的标准，通常是 `{ role: 'user'/'assistant', content: '...' }`。
 *
 * @param {Array<object>} history 包含先前对话的数组，每个元素是一个消息对象。
 * @param {string} userInput 用户当前的输入文本。
 * @returns {Array<object>} 构建好的完整消息列表，准备发送给大模型。
 */
function buildChatMessages(history, userInput) {
  const messages = history.map(m => ({ role: m.role, content: m.content }));
  messages.push({ role: 'user', content: userInput });
  return messages;
}

/**
 * 智能分段函数，用于将长文本内容分割成适合模型处理的块。
 *
 * 主要策略：
 * 1. 限制总长度：如果内容超过 50000 字符，则截取前 50000 字符。
 * 2. 短内容直接返回：如果内容长度小于等于 `maxChunk`，则直接返回包含单个块的数组。
 * 3. 长内容分割：
 *    - 迭代处理内容，每次尝试分割出一个 `maxChunk` 大小的块。
 *    - 优先在块的后半部分（`maxChunk * 0.3` 之后）寻找 Markdown 标题 (`#`, `##`, `###`) 作为分割点，
 *      以保持段落完整性。如果找到，则在该标题前分割。
 *    - 如果未找到合适的 Markdown 标题，则按 `maxChunk` 长度硬分割。
 * 4. 返回分割后的文本块数组。
 *
 * @param {string} content 需要分割的文本内容。
 * @param {number} [maxChunk=8192] 每个分块的最大字符数。
 * @returns {Array<string>} 分割后的文本块数组。
 */
function splitContentSmart(content, maxChunk = 8192) {
  // 最多只取前5万字
  if (content.length > 50000) content = content.slice(0, 50000);
  if (content.length <= maxChunk) return [content];
  const chunks = [];
  let start = 0;
  while (start < content.length) {
    let end = Math.min(start + maxChunk, content.length);
    // 优先在靠近中间的 markdown 标题处分割
    if (end < content.length) {
      const sub = content.slice(start, end);
      // 查找靠近结尾的 markdown 标题
      let idx = sub.lastIndexOf('\n#');
      if (idx === -1) idx = sub.lastIndexOf('\n##');
      if (idx === -1) idx = sub.lastIndexOf('\n###');
      if (idx > maxChunk * 0.3) {
        end = start + idx + 1; // +1补回\n
      }
    }
    chunks.push(content.slice(start, end));
    start = end;
  }
  return chunks;
}

/**
 * 生成当前文档的唯一 ID。
 * 该 ID 用于区分不同文档的聊天上下文或相关数据存储 (如思维导图数据)。
 * ID 的生成基于文档名称、图片数量、OCR 文本长度和翻译文本长度的组合，
 * 以期在实际使用中具有足够的唯一性。
 *
 * @returns {string} 当前文档的唯一 ID。
 */
function getCurrentDocId() {
  const doc = getCurrentDocContent();
  // 用文件名+图片数量+ocr长度+translation长度做唯一性（可根据实际情况调整）
  return `${doc.name || 'unknown'}_${(doc.images||[]).length}_${(doc.ocr||'').length}_${(doc.translation||'').length}`;
}

/**
 * 将选中的意群上下文附加到文档内容信息
 * @param {object} docContentInfo - 文档内容信息
 * @param {object} selection - 选中的意群信息
 * @returns {object} 附加了选中上下文的文档信息
 */
function attachSelectedContextToDoc(docContentInfo, selection) {
  if (!selection) return docContentInfo;
  const ids = Array.isArray(selection.groups) ? selection.groups : [];
  const granularity = selection.granularity || 'digest';
  const byId = new Map((docContentInfo.semanticGroups || []).map(g => [g.groupId, g]));
  const parts = [];
  ids.forEach((id, idx) => {
    const g = byId.get(id);
    if (!g) return;
    const gran = (selection.detail && selection.detail.find(d => d.groupId===id)?.granularity) || granularity;
    const body = gran === 'full' ? (g.fullText || '').slice(0, 6000)
               : gran === 'digest' ? (g.digest || '').slice(0, 3000)
               : (g.summary || '').slice(0, 800);
    parts.push(`【意群${idx+1} - ${id}】\n关键词: ${(g.keywords||[]).join('、')}\n内容(${gran}):\n${body}`);
  });
  const ctx = parts.join('\n\n');
  return Object.assign({}, docContentInfo, { selectedGroupContext: ctx, selectedGroupsMeta: selection });
}

/**
 * 构建降级语义上下文（多轮工具式取材）
 * @param {string} userQuestion - 用户问题
 * @param {Array} groups - 意群数组
 * @returns {object|null} 语义上下文对象
 */
function buildFallbackSemanticContext(userQuestion, groups) {
  try {
    if (!Array.isArray(groups) || groups.length === 0) return null;
    let picks = [];
    try {
      if (window.SemanticGrouper && typeof window.SemanticGrouper.quickMatch === 'function') {
        picks = window.SemanticGrouper.quickMatch(String(userQuestion || ''), groups) || [];
      }
    } catch (_) {}
    if (!picks || picks.length === 0) {
      picks = groups.slice(0, Math.min(3, groups.length));
    }
    const unique = new Set();
    const detail = [];
    const parts = [];
    picks.forEach(g => {
      if (!g || unique.size >= 3 || unique.has(g.groupId)) return;
      unique.add(g.groupId);
      let fetched = null;
      try {
        if (window.SemanticTools && typeof window.SemanticTools.fetchGroupText === 'function') {
          fetched = window.SemanticTools.fetchGroupText(g.groupId, 'digest');
        }
      } catch (_) {}
      const text = (fetched && fetched.text) || g.digest || g.summary || g.fullText || '';
      if (!text) return;
      const gran = (fetched && fetched.granularity) || 'digest';
      parts.push(`【${g.groupId}】\n关键词: ${(g.keywords || []).join('、')}\n内容(${gran}):\n${text}`);
      detail.push({ groupId: g.groupId, granularity: gran });
    });
    if (parts.length === 0) return null;
    return { groups: Array.from(unique), granularity: 'mixed', detail, context: parts.join('\n\n') };
  } catch (e) {
    console.warn('[buildFallbackSemanticContext] 失败:', e);
    return null;
  }
}

  // 导出
  window.ContentProcessor = {
    getCurrentDocContent,
    buildChatMessages,
    splitContentSmart,
    getCurrentDocId,
    attachSelectedContextToDoc,
    buildFallbackSemanticContext
  };

})();
