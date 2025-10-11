// semantic-groups-manager.js
// 语义意群管理模块

(function() {
  'use strict';

  /**
   * 显示多轮检索配置对话框
   * @param {string} docId - 文档ID
   * @returns {Promise<object|null>} 用户配置或null（取消）
   */
  async function showMultiHopConfigDialog(docId) {
  return new Promise((resolve) => {
    // 创建遮罩层
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 100003;
      display: flex;
      align-items: center;
      justify-content: center;
    `;

    // 创建对话框
    const dialog = document.createElement('div');
    dialog.style.cssText = `
      background: white;
      border-radius: 12px;
      padding: 24px;
      max-width: 480px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
    `;

    dialog.innerHTML = `
      <h3 style="margin: 0 0 16px 0; font-size: 18px; color: #1f2937;">检索Agent配置</h3>
      <p style="margin: 0 0 20px 0; font-size: 14px; color: #6b7280; line-height: 1.6;">
        这是您首次在此文档使用检索Agent。请选择启用的功能：
      </p>

      <div style="margin-bottom: 16px;">
        <label style="display: flex; align-items: flex-start; cursor: pointer; padding: 12px; border-radius: 8px; transition: background 0.2s;"
               onmouseover="this.style.background='#f3f4f6'"
               onmouseout="this.style.background='transparent'">
          <input type="checkbox" id="use-semantic-groups" checked style="margin-top: 2px; margin-right: 12px; cursor: pointer;">
          <div>
            <div style="font-weight: 500; color: #1f2937; margin-bottom: 4px;">意群分析</div>
            <div style="font-size: 13px; color: #6b7280;">将文档智能分割为语义单元，提高检索准确性</div>
          </div>
        </label>
      </div>

      <div style="margin-bottom: 24px;">
        <label style="display: flex; align-items: flex-start; cursor: pointer; padding: 12px; border-radius: 8px; transition: background 0.2s;"
               onmouseover="this.style.background='#f3f4f6'"
               onmouseout="this.style.background='transparent'">
          <input type="checkbox" id="use-vector-search" checked style="margin-top: 2px; margin-right: 12px; cursor: pointer;">
          <div>
            <div style="font-weight: 500; color: #1f2937; margin-bottom: 4px;">向量搜索与重排</div>
            <div style="font-size: 13px; color: #6b7280;">使用AI理解语义进行智能搜索，结果可选重排优化（需消耗API token）</div>
          </div>
        </label>
      </div>

      <div style="display: flex; gap: 12px; justify-content: flex-end;">
        <button id="dialog-cancel" style="
          padding: 8px 16px;
          border: 1px solid #d1d5db;
          background: white;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
          color: #374151;
          transition: all 0.2s;
        " onmouseover="this.style.background='#f9fafb'"
           onmouseout="this.style.background='white'">取消</button>
        <button id="dialog-confirm" style="
          padding: 8px 16px;
          border: none;
          background: #059669;
          color: white;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
          transition: all 0.2s;
        " onmouseover="this.style.background='#047857'"
           onmouseout="this.style.background='#059669'">确认</button>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // 绑定事件
    const confirmBtn = dialog.querySelector('#dialog-confirm');
    const cancelBtn = dialog.querySelector('#dialog-cancel');
    const semanticGroupsCheckbox = dialog.querySelector('#use-semantic-groups');
    const vectorSearchCheckbox = dialog.querySelector('#use-vector-search');

    const closeDialog = (result) => {
      document.body.removeChild(overlay);
      resolve(result);
    };

    confirmBtn.onclick = () => {
      const config = {
        useSemanticGroups: semanticGroupsCheckbox.checked,
        useVectorSearch: vectorSearchCheckbox.checked
      };
      closeDialog(config);
    };

    cancelBtn.onclick = () => {
      closeDialog(null); // 取消返回null
    };
  });
}

/**
 * 确保意群数据已准备好
 * 根据文档大小和用户设置，决定是否需要生成意群
 * @param {Object} docContentInfo - 文档内容信息
 * @param {Function} getCurrentDocId - 获取当前文档ID的函数
 * @param {Function} getChatbotConfig - 获取聊天机器人配置的函数
 * @param {Function} singleChunkSummary - 单轮摘要函数
 */
async function ensureSemanticGroupsReady(docContentInfo, getCurrentDocId, getChatbotConfig, singleChunkSummary) {
  // 检查是否启用多轮检索（只有启用多轮检索时才需要意群和向量索引）
  const multiHopEnabled = (window.chatbotActiveOptions && window.chatbotActiveOptions.multiHopRetrieval === true);
  if (!multiHopEnabled) {
    console.log('[ChatbotCore] 多轮检索未启用，跳过意群生成');
    return;
  }

  // 检查 window.data 是否存在
  if (!window.data) {
    return;
  }

  const docId = window.data.currentPdfName || 'unknown';

  // 检查是否已经配置过（针对当前文档）
  if (!window.data.multiHopConfig) {
    window.data.multiHopConfig = {};
  }

  // 如果当前文档未配置过，显示选择对话框
  if (!window.data.multiHopConfig[docId]) {
    console.log('[ChatbotCore] 首次使用多轮检索，显示配置对话框');

    const config = await showMultiHopConfigDialog(docId);

    if (!config) {
      // 用户取消了
      console.log('[ChatbotCore] 用户取消了多轮检索配置');
      window.chatbotActiveOptions.multiHopRetrieval = false; // 关闭多轮检索
      if (window.ChatbotFloatingOptionsUI?.updateDisplay) {
        window.ChatbotFloatingOptionsUI.updateDisplay();
      }
      return;
    }

    // 保存配置
    window.data.multiHopConfig[docId] = config;
    console.log('[ChatbotCore] 保存多轮检索配置:', config);
  }

  // 读取文档配置
  const docConfig = window.data.multiHopConfig[docId];
  console.log('[ChatbotCore] 当前文档多轮检索配置:', docConfig);

  // 如果不使用意群，创建简单的enrichedChunks（不分组）然后返回
  if (!docConfig.useSemanticGroups) {
    console.log('[ChatbotCore] 用户选择不使用意群分析，创建简单chunks用于BM25搜索');

    // 获取原始chunks
    const translationText = docContentInfo.translation || '';
    const ocrText = docContentInfo.ocr || '';
    const chunkCandidates = [];
    if (Array.isArray(docContentInfo.translatedChunks)) {
      chunkCandidates.push(...docContentInfo.translatedChunks);
    }
    if (Array.isArray(docContentInfo.ocrChunks)) {
      chunkCandidates.push(...docContentInfo.ocrChunks);
    }

    // 创建简单的enrichedChunks（不带意群分组信息）
    if (chunkCandidates.length > 0) {
      const simpleEnrichedChunks = chunkCandidates.map((text, idx) => ({
        chunkId: `chunk-${idx}`,
        text: typeof text === 'string' ? text : '',
        position: idx,
        charCount: typeof text === 'string' ? text.length : 0,
        belongsToGroup: null  // 不属于任何意群
      })).filter(c => c.text);

      window.data.enrichedChunks = simpleEnrichedChunks;
      console.log(`[ChatbotCore] 创建了 ${simpleEnrichedChunks.length} 个简单chunks（无意群分组）`);

      // 建立BM25索引（轻量级，不需要API）
      const docId = getCurrentDocId();
      await ensureIndexesBuilt(simpleEnrichedChunks, [], docId, false);
    }

    return;
  }

  // 检查 SemanticGrouper 是否加载
  if (!window.SemanticGrouper || typeof window.SemanticGrouper.aggregate !== 'function') {
    console.warn('[ChatbotCore] SemanticGrouper 未加载，跳过意群生成');
    return;
  }

  // 检查 window.data 是否存在
  if (!window.data) {
    return;
  }

  // 如果已经有意群数据，直接返回
  if (window.data.semanticGroups && window.data.semanticGroups.length > 0) {
    console.log('[ChatbotCore] 意群数据已存在，跳过生成');
    return;
  }

  // 获取文档内容和策略
  const translationText = docContentInfo.translation || '';
  const ocrText = docContentInfo.ocr || '';
  const chunkCandidates = [];
  if (Array.isArray(docContentInfo.translatedChunks)) {
    chunkCandidates.push(...docContentInfo.translatedChunks);
  }
  if (Array.isArray(docContentInfo.ocrChunks)) {
    chunkCandidates.push(...docContentInfo.ocrChunks);
  }

  let contentLength = Math.max(translationText.length, ocrText.length);
  if (contentLength < 50000 && chunkCandidates.length > 0) {
    const chunkLength = chunkCandidates.reduce((sum, chunk) => sum + (typeof chunk === 'string' ? chunk.length : 0), 0);
    contentLength = Math.max(contentLength, chunkLength);
  }

  let content = translationText || ocrText;
  if (!content && chunkCandidates.length > 0) {
    content = chunkCandidates.slice(0, 60).join('\n\n');
  }

  const contentStrategy = (window.chatbotActiveOptions && window.chatbotActiveOptions.contentLengthStrategy) || 'default';
  // 智能检索开启时，自动视为智能分段模式
  const strategySegmented = contentStrategy === 'segmented' || multiHopEnabled;

  // 短文档检查：如果文档长度 < 50000 且未明确开启智能分段，跳过意群生成
  if (contentLength < 50000 && contentStrategy !== 'segmented') {
    console.log(`[ChatbotCore] 文档长度 ${contentLength} < 50000 且未明确开启智能分段，跳过意群生成`);
    return;
  }

  if (!strategySegmented) {
    console.log('[ChatbotCore] 当前策略非智能分段且未开启智能检索，跳过意群生成');
    return;
  }

  // 优先尝试从 IndexedDB 读取缓存
  try {
    const docId = getCurrentDocId();
    if (typeof window.loadSemanticGroupsFromDB === 'function') {
      const cached = await window.loadSemanticGroupsFromDB(docId);
      if (cached && Array.isArray(cached.groups) && cached.groups.length > 0) {
        window.data.semanticGroups = cached.groups;
        if (cached.docGist) window.data.semanticDocGist = cached.docGist;

        // 恢复enrichedChunks，如果缓存中没有则从原始chunks重建
        let enrichedChunks = cached.enrichedChunks || [];

        // 兼容旧数据：如果缓存中没有enrichedChunks，从ocrChunks/translatedChunks重建
        if (!enrichedChunks || enrichedChunks.length === 0) {
          // 根据用户设置的 summarySource 选项决定使用哪个chunks
          const summarySource = (window.chatbotActiveOptions && window.chatbotActiveOptions.summarySource) || 'ocr';
          let rawChunks = [];

          if (summarySource === 'translation') {
            // 优先使用translatedChunks，但如果全是空字符串则降级到ocrChunks
            rawChunks = docContentInfo.translatedChunks || [];
            const hasValidTranslation = rawChunks.some(chunk => chunk && typeof chunk === 'string' && chunk.trim().length > 0);
            if (!hasValidTranslation) {
              rawChunks = docContentInfo.ocrChunks || [];
            }
          } else if (summarySource === 'ocr') {
            // 优先使用ocrChunks，如果没有则使用translatedChunks
            rawChunks = docContentInfo.ocrChunks || docContentInfo.translatedChunks || [];
          } else if (summarySource === 'none') {
            // 明确不使用文档内容
            rawChunks = [];
          }

          if (rawChunks.length > 0) {
            enrichedChunks = rawChunks
              .filter(text => text && typeof text === 'string' && text.trim().length > 0)  // 过滤无效chunk
              .map((text, index) => ({
                chunkId: `chunk-${index}`,
                text: text,
                belongsToGroup: null,
                position: index,
                charCount: text.length
              }));
            console.log(`[ChatbotCore] 从原始chunks(${summarySource})重建了 ${enrichedChunks.length} 个enrichedChunks`);
          }
        } else {
          // 验证enrichedChunks的有效性
          enrichedChunks = enrichedChunks.filter(chunk =>
            chunk && typeof chunk.text === 'string' && chunk.text.trim().length > 0
          );
          if (enrichedChunks.length === 0) {
            console.warn('[ChatbotCore] 缓存的enrichedChunks无效，尝试从原始chunks重建');
            // 根据用户设置的 summarySource 选项决定使用哪个chunks
            const summarySource = (window.chatbotActiveOptions && window.chatbotActiveOptions.summarySource) || 'ocr';
            let rawChunks = [];

            if (summarySource === 'translation') {
              rawChunks = docContentInfo.translatedChunks || [];
              const hasValidTranslation = rawChunks.some(chunk => chunk && typeof chunk === 'string' && chunk.trim().length > 0);
              if (!hasValidTranslation) {
                rawChunks = docContentInfo.ocrChunks || [];
              }
            } else if (summarySource === 'ocr') {
              rawChunks = docContentInfo.ocrChunks || docContentInfo.translatedChunks || [];
            }

            if (rawChunks.length > 0) {
              enrichedChunks = rawChunks
                .filter(text => text && typeof text === 'string' && text.trim().length > 0)
                .map((text, index) => ({
                  chunkId: `chunk-${index}`,
                  text: text,
                  belongsToGroup: null,
                  position: index,
                  charCount: text.length
                }));
              console.log(`[ChatbotCore] 重建了 ${enrichedChunks.length} 个enrichedChunks(${summarySource})`);
            }
          }
        }

        window.data.enrichedChunks = enrichedChunks;

        console.log(`[ChatbotCore] 已从缓存读取意群，共 ${cached.groups.length} 个意群，${enrichedChunks.length} 个chunks`);

        // 检测意群-chunks不匹配：比较缓存中的chunks数量和当前实际chunks数量
        const cachedChunkCount = (cached.enrichedChunks && cached.enrichedChunks.length) || 0;
        const isOutdated = cachedChunkCount > 0 && enrichedChunks.length > 0 &&
                          Math.abs(cachedChunkCount - enrichedChunks.length) > Math.max(cachedChunkCount, enrichedChunks.length) * 0.1;

        if (isOutdated) {
          console.warn(`[ChatbotCore] 检测到意群缓存与chunks不匹配（缓存${cachedChunkCount}个chunk，实际${enrichedChunks.length}个），清除缓存并重新生成`);
          // 删除旧缓存
          if (typeof window.deleteSemanticGroupsFromDB === 'function') {
            await window.deleteSemanticGroupsFromDB(docId);
          }
          delete window.data.semanticGroups;
          delete window.data.enrichedChunks;
          // 不要return，继续走下面的重新生成流程
        } else {
          // 检查并建立索引（向量索引和BM25索引），参数顺序：chunks, groups, docId
          await ensureIndexesBuilt(enrichedChunks, cached.groups, docId);
          return;
        }
      }
    }
  } catch (e) {
    console.warn('[ChatbotCore] 读取意群缓存失败，继续生成:', e);
  }

  // 检查是否有现成的分段数据
  // 根据用户设置的 summarySource 选项决定使用哪个chunks
  const summarySource = (window.chatbotActiveOptions && window.chatbotActiveOptions.summarySource) || 'ocr';
  let chunks = [];

  if (summarySource === 'translation') {
    chunks = docContentInfo.translatedChunks || [];
    const hasValidTranslation = chunks.some(chunk => chunk && typeof chunk === 'string' && chunk.trim().length > 0);
    if (!hasValidTranslation) {
      chunks = docContentInfo.ocrChunks || [];
    }
  } else if (summarySource === 'ocr') {
    chunks = docContentInfo.ocrChunks || docContentInfo.translatedChunks || [];
  } else if (summarySource === 'none') {
    chunks = [];
  }

  if (!chunks || !Array.isArray(chunks) || chunks.length === 0) {
    console.warn('[ChatbotCore] 没有可用的分段数据（ocrChunks/translatedChunks），无法生成意群');
    return;
  }

  if (contentLength < 50000) {
    console.log(`[ChatbotCore] 文档估算字数 ${contentLength} < 50000，但已启用智能分段，继续生成意群`);
  }

  console.log(`[ChatbotCore] 开始生成意群，估算字数: ${contentLength}，分段数: ${chunks.length}`);

  try {
    // 显示加载提示
    if (window.ChatbotUtils && typeof window.ChatbotUtils.showToast === 'function') {
      window.ChatbotUtils.showToast('正在生成文档意群，请稍候...', 'info', 3000);
    }

    // 先生成文档总览（前2万字），作为后续分组摘要的背景信息
    try {
      const preview = content.slice(0, 20000);
      const cfg = getChatbotConfig();
      if (!window.data.semanticDocGist && cfg && cfg.apiKey && typeof singleChunkSummary === 'function') {
        const gistPrompt = `你是学术文档分析助手。请基于提供的文档开头部分，生成一段不超过400字的中文总览，涵盖：主题/研究问题、对象/范围、方法/框架、主要结论或结构。尽量客观、概括，不引用无关细节。`;
        const gist = await singleChunkSummary(gistPrompt, preview, cfg, cfg.apiKey);
        window.data.semanticDocGist = (gist || '').trim();
        console.log('[ChatbotCore] 文档总览（前2万字）已生成');
      }
    } catch (e) {
      console.warn('[ChatbotCore] 文档总览生成失败，将跳过：', e);
      if (!window.data.semanticDocGist) {
        window.data.semanticDocGist = content.slice(0, 400);
      }
    }

    // 生成意群（可由用户设置覆盖默认值）
    const s = (window.semanticGroupsSettings || {});

    // 创建进度显示UI元素
    let progressToast = null;
    if (window.ChatbotUtils && typeof window.ChatbotUtils.showProgressToast === 'function') {
      progressToast = window.ChatbotUtils.showProgressToast('生成意群中...', 0);
    }

    const result = await window.SemanticGrouper.aggregate(chunks, {
      targetChars: Number(s.targetChars) > 0 ? Number(s.targetChars) : 5000,
      minChars: Number(s.minChars) > 0 ? Number(s.minChars) : 2500,
      maxChars: Number(s.maxChars) > 0 ? Number(s.maxChars) : 6000,
      concurrency: Number(s.concurrency) > 0 ? Number(s.concurrency) : 20,  // 恢复默认并发数
      docContext: window.data.semanticDocGist || '',
      onProgress: (current, total, message) => {
        const percent = Math.round((current / total) * 100);
        if (progressToast && typeof progressToast.update === 'function') {
          progressToast.update(`${message} (${percent}%)`, percent);
        }
        console.log(`[ChatbotCore] 意群生成进度: ${current}/${total} (${percent}%)`);
      }
    });

    // 关闭进度提示
    if (progressToast && typeof progressToast.close === 'function') {
      progressToast.close();
    }

    const semanticGroups = result.groups || [];
    const enrichedChunks = result.enrichedChunks || [];

    // 保存到 window.data
    window.data.semanticGroups = semanticGroups;
    window.data.enrichedChunks = enrichedChunks; // 保存带元数据的chunks

    console.log(`[ChatbotCore] 意群生成完成，共 ${semanticGroups.length} 个意群，${enrichedChunks.length} 个chunks`);

    // 获取docId（后续索引构建也需要）
    const docId = getCurrentDocId();

    // 持久化到 IndexedDB
    try {
      if (typeof window.saveSemanticGroupsToDB === 'function') {
        await window.saveSemanticGroupsToDB(docId, semanticGroups, {
          version: 3, // 版本号升级
          docGist: window.data.semanticDocGist || '',
          enrichedChunks: enrichedChunks
        });
        console.log('[ChatbotCore] 意群和chunks已写入缓存');
      }
    } catch (e) {
      console.warn('[ChatbotCore] 写入缓存失败:', e);
    }

    // 更新浮动选项栏的显示（出现"意群"按钮）
    try {
      if (window.ChatbotFloatingOptionsUI && typeof window.ChatbotFloatingOptionsUI.updateDisplay === 'function') {
        window.ChatbotFloatingOptionsUI.updateDisplay();
      }
      if (window.SemanticGroupsUI && typeof window.SemanticGroupsUI.update === 'function') {
        window.SemanticGroupsUI.update();
      }
    } catch (_) {}

    // 显示成功提示
    if (window.ChatbotUtils && typeof window.ChatbotUtils.showToast === 'function') {
      window.ChatbotUtils.showToast(`文档已分析完成，生成 ${semanticGroups.length} 个意群`, 'success', 2000);
    }

    // 异步建立索引（不阻塞）
    await ensureIndexesBuilt(enrichedChunks, semanticGroups, docId, true);

  } catch (e) {
    console.error('[ChatbotCore] 意群生成失败:', e);
    if (window.ChatbotUtils && typeof window.ChatbotUtils.showToast === 'function') {
      window.ChatbotUtils.showToast('意群生成失败: ' + e.message, 'error', 3000);
    }
  }
}

/**
 * 确保向量索引和BM25索引已建立
 * @param {Array} chunks - chunks数组
 * @param {Array} groups - 意群数组
 * @param {string} docId - 文档ID
 * @param {boolean} async - 是否异步建立索引（不阻塞）
 */
async function ensureIndexesBuilt(chunks, groups, docId, async = false) {
  if (!chunks || !Array.isArray(chunks) || chunks.length === 0) {
    return;
  }

  // 检查是否启用多轮检索
  const multiHopEnabled = (window.chatbotActiveOptions && window.chatbotActiveOptions.multiHopRetrieval === true);

  // 读取文档配置
  const docConfig = window.data?.multiHopConfig?.[docId];
  const useVectorSearch = docConfig?.useVectorSearch !== false; // 默认true

  // 异步建立向量索引（仅在用户配置允许且启用了向量搜索时）
  const buildVectorIndex = async () => {
    try {
      // 关键修复：无论multiHopEnabled状态如何，都要检查useVectorSearch配置
      if (!useVectorSearch) {
        console.log('[ChatbotCore] 用户选择不使用向量搜索，跳过向量索引生成');
        return;
      }

      if (!multiHopEnabled) {
        console.log('[ChatbotCore] 多轮检索未启用，跳过向量索引生成');
        return;
      }

      if (window.EmbeddingClient?.config?.enabled && window.SemanticVectorSearch) {
        console.log(`[ChatbotCore] 检测到向量搜索已启用，开始为 ${chunks.length} 个chunks建立索引...`);
        await window.SemanticVectorSearch.indexChunks(chunks, docId, {
          showProgress: true,
          forceRebuild: false
        });
        // 更新UI显示
        if (window.ChatbotFloatingOptionsUI?.updateDisplay) {
          window.ChatbotFloatingOptionsUI.updateDisplay();
        }
      }
    } catch (vectorErr) {
      console.warn('[ChatbotCore] 建立向量索引失败（不影响意群功能）:', vectorErr);
    }
  };

  // 始终建立BM25索引（轻量级，无需API，作为fallback）
  try {
    if (window.SemanticBM25Search) {
      console.log('[ChatbotCore] 为chunks建立BM25索引...');
      window.SemanticBM25Search.indexChunks(chunks, docId);
      console.log('[ChatbotCore] BM25索引建立完成');
    }
  } catch (bm25Err) {
    console.warn('[ChatbotCore] 建立BM25索引失败:', bm25Err);
  }

  // 如果是异步模式，向量索引在后台进行
  if (async) {
    buildVectorIndex(); // 不await，让它在后台运行
    if (multiHopEnabled && useVectorSearch) {
      console.log('[ChatbotCore] 向量索引将在后台生成，不阻塞当前流程');
    }
  } else {
    await buildVectorIndex(); // 同步等待完成
  }
}

  // 导出
  window.SemanticGroupsManager = {
    showMultiHopConfigDialog,
    ensureSemanticGroupsReady,
    ensureIndexesBuilt
  };

})();
