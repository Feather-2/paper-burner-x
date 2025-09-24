function showTab(tab) {
  // ========== 先尝试清理上一视图的资源（尤其 chunk-compare） ==========
  try {
    const prevTab = window.currentVisibleTabId;
    if (prevTab === 'chunk-compare' && tab !== 'chunk-compare') {
      // 断开观察器并清空优化器缓存
      if (window.ChunkCompareOptimizer && window.ChunkCompareOptimizer.instance && typeof window.ChunkCompareOptimizer.instance.cleanup === 'function') {
        window.ChunkCompareOptimizer.instance.cleanup();
      }
      // 清空分块解析缓存，释放大数组
      if (window.chunkParseCache) {
        Object.keys(window.chunkParseCache).forEach(k => delete window.chunkParseCache[k]);
      }
      // 释放块级原始内容引用
      if (typeof window.__lastChunkCompareTotalBlocks === 'number') {
        for (let i = 0; i <= window.__lastChunkCompareTotalBlocks; i++) {
          try { delete window[`blockRawContent_${i}`]; } catch(e) { /* ignore */ }
        }
        window.__lastChunkCompareTotalBlocks = 0;
      }
      // 清理大型临时数据
      if (window.largeDocumentData) window.largeDocumentData = null;
    }
  } catch (e) {
    console.warn('[showTab] 清理上一视图资源时出错:', e);
  }
  // === 新增：没有翻译内容时禁止切换到翻译和对比页 ===
  if ((tab === 'translation' || tab === 'chunk-compare') && (!data || !data.translation || data.translation.trim() === "")) {
    alert('没有翻译内容，无法显示该页面');
    return;
  }
  // ========== 保证内容标识符始终正确 ==========
  if (tab === 'ocr') {
    window.globalCurrentContentIdentifier = 'ocr';
  } else if (tab === 'translation') {
    window.globalCurrentContentIdentifier = 'translation';
  } else {
    window.globalCurrentContentIdentifier = '';
  }
  // ========== 防抖锁：防止同一 tab 重复渲染 ==========
  if (renderingTab === tab) {
    console.log(`[showTab] Tab ${tab} 正在渲染中，跳过重复渲染`);
    return;
  }
  renderingTab = tab;
  // ================================================
  // 性能测试断点 - 总渲染
  console.time('[性能] showTab_总渲染');
  currentVisibleTabId = tab; // Update global current tab ID
  window.currentVisibleTabId = tab; // 同时更新挂载到 window 对象上的变量
  window.currentBlockTokensForCopy = window.currentBlockTokensForCopy || {}; // Initialize if not exists

  // ========== 新增：用局部变量保存内容标识符 ==========
  let contentIdentifier = '';
  if (tab === 'ocr') {
    contentIdentifier = 'ocr';
  } else if (tab === 'translation') {
    contentIdentifier = 'translation';
  }
  window.globalCurrentContentIdentifier = contentIdentifier;
  console.log('[showTab] 设置 window.globalCurrentContentIdentifier =', contentIdentifier);
  // ==================================================

  if (docIdForLocalStorage) {
    const activeTabKey = `activeTab_${docIdForLocalStorage}`;
    localStorage.setItem(activeTabKey, tab);
    // console.log(`Saved active tab for ${docIdForLocalStorage}: ${tab}`);
  }

  document.getElementById('tab-ocr').classList.remove('active');
  document.getElementById('tab-translation').classList.remove('active');
  // document.getElementById('tab-compare').classList.remove('active'); // 对应按钮已注释，此行也可注释
  document.getElementById('tab-chunk-compare').classList.remove('active');

  let html = '';
  let contentContainerId = ''; // 用于 applyAnnotationsToContent
  let activeContentElement = null; // 用于 applyAnnotationsToContent
  const significantTokenTypes = ['paragraph', 'heading', 'code', 'table', 'blockquote', 'list', 'html', 'hr'];

  // ---- 增加日志 ----
  // 日志现在可以准确反映 globalCurrentContentIdentifier
  console.log(`[showTab - ${tab}] 即将渲染。当前 window.globalCurrentContentIdentifier:`, window.globalCurrentContentIdentifier);
  if (data && data.annotations) {
      console.log(`[showTab - ${tab}] data.annotations (长度 ${data.annotations.length}):`, JSON.parse(JSON.stringify(data.annotations)));
  } else {
      console.log(`[showTab - ${tab}] data.annotations 不可用或为空。`);
  }
  // ---- 日志结束 ----

  if (tab === 'chunk-compare') {
    // 安全校验：需要 ocrChunks/transChunks 同步存在且长度一致
    if (!data || !Array.isArray(data.ocrChunks) || !Array.isArray(data.translatedChunks) || data.ocrChunks.length === 0 || data.translatedChunks.length === 0 || data.ocrChunks.length !== data.translatedChunks.length) {
      document.getElementById('tab-chunk-compare').classList.add('active');
      const warn = `<div class="warning-box" style="padding:12px;border:1px solid #fbbf24;background:#fffbeb;color:#92400e;border-radius:8px;">`
                 + `无法进入“分块对比”：当前记录的原文分块数量与译文分块数量不一致，或缺少分块信息。`
                 + `<br>请先查看“仅OCR/仅翻译”，或重新生成分块以使用对比功能。`
                 + `</div>`;
      document.getElementById('tabContent').innerHTML = warn;
      if (typeof window.refreshTocList === 'function') window.refreshTocList();
      renderingTab = null;
      console.timeEnd && console.timeEnd('[性能] showTab_总渲染');
      return;
    }
  }

  if(tab === 'ocr') {
    document.getElementById('tab-ocr').classList.add('active');
    contentContainerId = 'ocr-content-wrapper';
    let ocrText = data.ocr || '';
    // 性能测试断点 - OCR渲染
    console.time('[性能] OCR分批渲染');
    html = `<h3>OCR内容</h3><div id="${contentContainerId}" class="markdown-body content-wrapper"></div>`;
  } else if(tab === 'translation') {
    document.getElementById('tab-translation').classList.add('active');
    contentContainerId = 'translation-content-wrapper';
    html = `<h3>翻译内容</h3><div id="${contentContainerId}" class="markdown-body content-wrapper"></div>`;
    console.time('[性能] 翻译分批渲染');
  } else if (tab === 'chunk-compare') {
    // 性能监控：记录分块对比开始时间
    window.chunkCompareStartTime = performance.now();
    console.log(`[性能] 开始渲染分块对比，总块数: ${data.ocrChunks ? data.ocrChunks.length : 0}`);

    // ========== 超长文本降级策略开关 ==========
    (function computeLargeDocFlag(){
      const LARGE_TEXT_THRESHOLD = 120000; // 8万字阈值
      let totalLen = 0;
      try {
        if (Array.isArray(data.ocrChunks)) {
          for (let i = 0; i < data.ocrChunks.length; i++) totalLen += (data.ocrChunks[i] ? data.ocrChunks[i].length : 0);
        }
        if (Array.isArray(data.translatedChunks)) {
          for (let i = 0; i < data.translatedChunks.length; i++) totalLen += (data.translatedChunks[i] ? data.translatedChunks[i].length : 0);
        }
      } catch(e) { /* ignore */ }
      window.disableEqualizeForLargeDoc = totalLen > LARGE_TEXT_THRESHOLD;
      console.log(`[Chunk-Compare] 文本总长度=${totalLen}，等高降级=${window.disableEqualizeForLargeDoc}`);
      // 记录用于后续清理的块数量
      try { window.__lastChunkCompareTotalBlocks = (Array.isArray(data.ocrChunks) ? data.ocrChunks.length : 0); } catch(e) { window.__lastChunkCompareTotalBlocks = 0; }
    })();

    // window.globalCurrentContentIdentifier = ''; // 已在函数开头正确设置
    document.getElementById('tab-chunk-compare').classList.add('active');
    if (data.ocrChunks && data.ocrChunks.length > 0 && data.translatedChunks && data.translatedChunks.length === data.ocrChunks.length) {
        // 使用优化器进行分块对比渲染
        if (false && window.ChunkCompareOptimizer && window.ChunkCompareOptimizer.instance) {
            console.log('[性能] 使用优化后的分块对比渲染器');
            html = window.ChunkCompareOptimizer.instance.optimizeChunkComparison(
                data.ocrChunks,
                data.translatedChunks,
                {
                    images: data.images,
                    isOriginalFirst: window.isOriginalFirstInChunkCompare !== false
                }
            );
        } else {
            // 回退到原有渲染逻辑
            console.log('[性能] 使用旧版分块对比渲染');
            html = `
              <div class="chunk-compare-title-bar">
                <h3>分块对比</h3>
                <button id="swap-chunks-btn" title="切换原文/译文位置">⇆</button>
              </div>
              <div class="chunk-compare-container">
            `;
            // 继续使用原有的渲染逻辑...
        }
        // 强制走旧版渲染逻辑（禁用优化器路径）
        if (true) {
        /**
         * 解析Markdown文本为逻辑块数组，主要基于标题进行分割。
         * 代码块 (```...```) 会被视为单个块的一部分，不会被分割。
         * @param {string} md - Markdown文本。
         * @returns {Array<Object>} 每个对象包含 `{ content: string }`。
         */
        function parseMarkdownBlocks(md) {
          const lines = (md || '').split(/\r?\n/);
          const blocks = [];
          let buffer = [];
          let inCode = false;
          let isFirstBlock = true;
          function flush() {
            if (buffer.length) {
              blocks.push({ content: buffer.join('\n') });
              buffer = [];
            }
          }
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (/^\s*```/.test(line)) { // 代码块
              inCode = !inCode;
              buffer.push(line);
              continue;
            }
            if (inCode) {
              buffer.push(line);
              continue;
            }
            if (/^\s*#/.test(line)) { // 标题作为新分块的起点
              if (!isFirstBlock) flush();
              isFirstBlock = false;
              buffer.push(line);
              continue;
            }
            // 普通内容、列表、空行等都合并到当前块
            buffer.push(line);
          }
          flush();
          return blocks;
        }
        /**
         * 对齐两组Markdown逻辑块，用于并排显示。
         * 简单地按索引逐个配对，如果某一组块少，则对应位置为空字符串。
         * @param {Array<Object>} blocks1 - 第一组块。
         * @param {Array<Object>} blocks2 - 第二组块。
         * @returns {Array<Array<string>>} 每个内部数组包含两个字符串 `[block1_content, block2_content]`。
         */
        function alignBlocks(blocks1, blocks2) {
          // 简单按类型和顺序对齐
          const maxLen = Math.max(blocks1.length, blocks2.length);
          const aligned = [];
          for (let i = 0; i < maxLen; i++) {
            aligned.push([
              blocks1[i] ? blocks1[i].content : '',
              blocks2[i] ? blocks2[i].content : ''
            ]);
          }
          return aligned;
        }
        /**
         * 渲染单个OCR块和其对应的翻译块的对齐视图，支持分层结构。
         * - 它首先使用 `parseMarkdownBlocks` 将OCR和翻译文本分割成小块（基于标题）。
         * - 然后使用 `alignBlocks` 对齐这些小块。
         * - 为每个对齐的小块对生成并排的HTML结构，用于显示原文和译文。
         * - 提供工具栏按钮，用于切换显示模式（对比、仅原文、仅译文）、复制整块内容以及导航到上下块。
         * - 原始块内容存储在 `window.blockRawContent_[blockIndex]` 中，供复制功能使用。
         *
         * @param {string} ocrChunk - OCR文本块。
         * @param {string} translatedChunk - 对应的翻译文本块。
         * @param {Array<Object>} images - 与此文档关联的图片数据。
         * @param {number} blockIndex - 当前大块在整个文档分块中的索引。
         * @param {number} totalBlocks - 文档分块的总数。
         * @returns {string} 生成的HTML字符串，用于显示对齐的块内容。
         */
        function renderLevelAlignedFlex(ocrChunk, translatedChunk, images, blockIndex, totalBlocks) {
          // 性能优化：缓存解析结果避免重复计算
          const cacheKey = `${blockIndex}_${ocrChunk.length}_${translatedChunk.length}`;
          if (window.chunkParseCache && window.chunkParseCache[cacheKey]) {
            const cachedResult = window.chunkParseCache[cacheKey];
            const ocrBlocks = cachedResult.ocrBlocks;
            const transBlocks = cachedResult.transBlocks;
            const aligned = cachedResult.aligned;
            let showMode = window[`showMode_block_${blockIndex}`] || 'both';

            // 使用缓存的解析结果渲染HTML
            return renderAlignedHTML(ocrBlocks, transBlocks, aligned, images, blockIndex, totalBlocks, showMode);
          }

          const ocrBlocks = parseMarkdownBlocks(ocrChunk);
          const transBlocks = parseMarkdownBlocks(translatedChunk);
          const aligned = alignBlocks(ocrBlocks, transBlocks);

          // 缓存解析结果
          if (!window.chunkParseCache) window.chunkParseCache = {};
          window.chunkParseCache[cacheKey] = { ocrBlocks, transBlocks, aligned };

          let showMode = window[`showMode_block_${blockIndex}`] || 'both';
          return renderAlignedHTML(ocrBlocks, transBlocks, aligned, images, blockIndex, totalBlocks, showMode);
        }

        /**
         * 渲染对齐后的HTML内容
         */
        function renderAlignedHTML(ocrBlocks, transBlocks, aligned, images, blockIndex, totalBlocks, showMode) {
          // ========== 辅助：媒体与段落对齐增强 ==========
          function normalizeHtml(html) {
            return (html || '')
              .replace(/\s+/g, ' ')
              .replace(/\u00A0/g, ' ')
              .trim();
          }
          function extractFirstMatch(html, regex) {
            const m = (html || '').match(regex);
            if (!m) return { match: null, rest: html };
            const before = html.slice(0, m.index);
            const after = html.slice(m.index + m[0].length);
            return { match: m[0], rest: before + after };
          }
          function extractFirstTable(html) {
            // 支持 HTML 表格；Markdown 表格在本阶段不易可靠识别，先处理 HTML
            const res = extractFirstMatch(html, /<table[\s\S]*?<\/table>/i);
            return { table: res.match, rest: res.rest };
          }
          function extractFirstImage(html) {
            // 支持 <img> 或 markdown 图片
            const imgHtml = extractFirstMatch(html, /<img\b[\s\S]*?>/i);
            if (imgHtml.match) return { image: imgHtml.match, rest: imgHtml.rest };
            const mdImg = extractFirstMatch(html, /!\[[^\]]*\]\([^\)]+\)/);
            return { image: mdImg.match, rest: mdImg.rest };
          }
          function isSameImage(imgA, imgB) {
            if (!imgA || !imgB) return false;
            const srcA = (imgA.match(/src\s*=\s*"([^"]+)"/) || [])[1] || (imgA.match(/\]\(([^\)]+)\)/) || [])[1];
            const srcB = (imgB.match(/src\s*=\s*"([^"]+)"/) || [])[1] || (imgB.match(/\]\(([^\)]+)\)/) || [])[1];
            if (!srcA || !srcB) return false;
            return normalizeHtml(srcA) === normalizeHtml(srcB);
          }
          function areTablesSimilar(tblA, tblB) {
            if (!tblA || !tblB) return false;
            const a = normalizeHtml(tblA.replace(/<thead[\s\S]*?<\/thead>/ig, '').replace(/<tbody[\s\S]*?<\/tbody>/ig, '').replace(/<[^>]+>/g, ''));
            const b = normalizeHtml(tblB.replace(/<thead[\s\S]*?<\/thead>/ig, '').replace(/<tbody[\s\S]*?<\/tbody>/ig, '').replace(/<[^>]+>/g, ''));
            if (!a || !b) return false;
            const lenRatio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
            return lenRatio >= 0.7;
          }
          function splitParagraphs(text) {
            return (text || '')
              .split(/\n{2,}/)
              .map(s => s.trim())
              .filter(Boolean);
          }

          // 统一去掉段落首尾多余空格/空行，避免不可见换行导致高度不一致
          function stripEdgeWhitespace(md) {
            if (!md) return md;
            // 标准化不可见空白（NBSP、零宽字符）
            md = md.replace(/\u00A0/g, ' '); // NBSP → 普通空格
            md = md.replace(/[\u200B-\u200D\uFEFF]/g, ''); // 零宽空白
            md = md.replace(/^\uFEFF/, ''); // BOM
            md = md.replace(/^[\s\t\r\n]+/, '');    // 开头空白/换行
            md = md.replace(/[\s\t\r\n]+$/, '');    // 结尾空白/换行
            // 再次清理尾随 NBSP（有的浏览器不把 NBSP 视为 \s）
            md = md.replace(/\u00A0+$/, '');
            return md;
          }

          // 判断是否包含表格语法（markdown 管道表格或已渲染 HTML 表格）
          function containsTableSyntax(src) {
            if (!src) return false;
            if (/<table\b/i.test(src)) return true;
            // 简单判断：含有表头分隔线 | --- |
            const lines = src.split(/\n/);
            for (let i = 0; i < lines.length - 1; i++) {
              const a = lines[i], b = lines[i+1];
              if (/\|/.test(a) && /\|\s*:?\-+\s*\|/.test(b)) return true;
            }
            return false;
          }

          // 针对整块层级做一次媒体“拿出来”与对齐增强
          let oWhole = (ocrBlocks || []).map(b => b.content).join('\n\n');
          let tWhole = (transBlocks || []).map(b => b.content).join('\n\n');

          let hoistedParts = [];

          // 表格不再抽出合并，保持左右对齐并在开屏时逐对等高微调

          // 3) 图片相同则抽出一个显示
          const exImgO = extractFirstImage(oWhole);
          const exImgT = extractFirstImage(tWhole);
          if (exImgO.image && exImgT.image && isSameImage(exImgO.image, exImgT.image)) {
            hoistedParts.push({ type: 'merged-image', html: exImgO.image });
            oWhole = exImgO.rest.trim();
            tWhole = exImgT.rest.trim();
          }

          // 4) 对剩余内容尝试逐段落对齐（仅当段落数一致）
          let paragraphPairs = null;
          const parasO = splitParagraphs(oWhole);
          const parasT = splitParagraphs(tWhole);
          if (parasO.length > 0 && parasO.length === parasT.length) {
            paragraphPairs = parasO.map((p, i) => [p, parasT[i]]);
          }

          // 在分块对比内部也尝试使用自定义渲染器
          // 注意：这里的 annotations 应该是整个文档的，contentIdentifier 需要根据当前块是原文还是译文来确定
          // 为了简化，我们暂时假设分块对比中的内容不直接参与这种精细的预标注，
          // 或者需要更复杂的逻辑来传递正确的 contentIdentifier
          // MODIFIED: Pass empty array for annotations in chunk-compare mode to disable highlights/annotations
          const annotationsForChunkRender = [];
          const ocrRenderer = createCustomMarkdownRenderer(annotationsForChunkRender, 'ocr', MarkdownProcessor.renderWithKatexFailback);
          const transRenderer = createCustomMarkdownRenderer(annotationsForChunkRender, 'translation', MarkdownProcessor.renderWithKatexFailback);

          // 整块复制按钮
          let html = `
            <div class="block-toolbar" data-block-toolbar="${blockIndex}">
              <div class="block-toolbar-left">
                <span class="block-mode-btn ${showMode === 'both' ? 'active' : ''}" data-mode="both" data-block="${blockIndex}">对比</span>
                <span class="block-mode-btn ${showMode === 'ocr' ? 'active' : ''}" data-mode="ocr" data-block="${blockIndex}">原文</span>
                <span class="block-mode-btn ${showMode === 'trans' ? 'active' : ''}" data-mode="trans" data-block="${blockIndex}">译文</span>
                <button class="block-copy-btn" data-block="${blockIndex}" title="复制本块内容">复制本块</button>
              </div>
              <div class="block-toolbar-right">
                ${blockIndex > 0 ? `<button class="block-nav-btn" data-dir="prev" data-block="${blockIndex}" title="上一段">↑</button>` : ''}
                ${blockIndex < totalBlocks-1 ? `<button class="block-nav-btn" data-dir="next" data-block="${blockIndex}" title="下一段">↓</button>` : ''}
              </div>
            </div>
          `;

          // 性能优化：批量构建HTML字符串（按序：先 hoisted，再对齐对，再fallback）
          const alignedHTML = [];
          // 先渲染抽出的媒体（图片单列）
          if (hoistedParts.length > 0) {
            hoistedParts.forEach((part, idx) => {
              if (part.type === 'merged-image') {
                const rendered = (window.MarkdownProcessor && window.MarkdownProcessor.renderWithKatexFailback)
                  ? window.MarkdownProcessor.renderWithKatexFailback(window.MarkdownProcessor.safeMarkdown(part.html, images))
                  : part.html;
                alignedHTML.push(`
                  <div class="align-flex block-flex block-flex-${blockIndex} block-mode-both" data-block="${blockIndex}" data-align-index="hoisted-${idx}">
                    <div class="align-block" style="flex:1 1 100%">
                      <div class="align-title"><span>图片</span></div>
                      <div class="align-content markdown-body">${rendered}</div>
                    </div>
                  </div>
                `);
              }
            });
          }

          // 再渲染逐段落对齐（若可用）
          if (paragraphPairs) {
            for (let i = 0; i < paragraphPairs.length; i++) {
              const [pO, pT] = paragraphPairs[i];
              const isTablePair = containsTableSyntax(pO) && containsTableSyntax(pT);
              const titleLeft = isTablePair ? '表格' : '原文';
              const titleRight = isTablePair ? '表格' : '译文';
              alignedHTML.push(`
                <div class="align-flex block-flex block-flex-${blockIndex} ${isTablePair ? 'table-pair ' : ''}${showMode==='ocr'?'block-mode-ocr-only':showMode==='trans'?'block-mode-trans-only':'block-mode-both'}" data-block="${blockIndex}" data-align-index="para-${i}">
                  <div class="align-block align-block-ocr">
                    <div class="align-title">
                      <span>${titleLeft}</span>
                      <div class="align-actions">
                        <button class="block-struct-copy-btn block-icon-btn" data-block="${blockIndex}" data-type="ocr" data-idx="${i}" title="复制原文结构">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                        </button>
                        <button class="block-edit-btn block-icon-btn" data-block="${blockIndex}" data-type="ocr" data-idx="${i}" title="编辑此段">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>
                        </button>
                        <button class="block-edit-reset-btn block-icon-btn" data-block="${blockIndex}" data-type="ocr" data-idx="${i}" title="重置为原文" style="display:none;">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>
                        </button>
                      </div>
                    </div>
                    <div class="align-content markdown-body" data-raw-markdown="${encodeURIComponent(stripEdgeWhitespace(pO))}">${MarkdownProcessor.renderWithKatexFailback(MarkdownProcessor.safeMarkdown(stripEdgeWhitespace((()=>{const key = `chunkOverride_${window.docIdForLocalStorage||'default'}_${blockIndex}_${i}_ocr`; const ov = localStorage.getItem(key); return ov ? ov : pO;})()), images), isOriginalFirstInChunkCompare ? ocrRenderer : transRenderer)}</div>
                    <div class="align-edit-panel" style="display:none;">
                      <textarea class="align-edit-area" style="width:100%;min-height:120px;box-sizing:border-box;"></textarea>
                      <div class="align-edit-actions" style="margin-top:6px;display:flex;gap:8px;">
                        <button class="align-edit-save" data-block="${blockIndex}" data-type="ocr" data-idx="para-${i}">保存</button>
                        <button class="align-edit-cancel" data-block="${blockIndex}" data-type="ocr" data-idx="para-${i}">取消</button>
                      </div>
                    </div>
                  </div>
                  <div class="splitter" title="拖动调整比例"></div>
                  <div class="align-block align-block-trans">
                    <div class="align-title">
                      <span>${titleRight}</span>
                      <div class="align-actions">
                        <button class="block-struct-copy-btn block-icon-btn" data-block="${blockIndex}" data-type="trans" data-idx="${i}" title="复制译文结构">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                        </button>
                        <button class="block-edit-btn block-icon-btn" data-block="${blockIndex}" data-type="trans" data-idx="${i}" title="编辑此段">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>
                        </button>
                        <button class="block-edit-reset-btn block-icon-btn" data-block="${blockIndex}" data-type="trans" data-idx="${i}" title="重置为原文" style="display:none;">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>
                        </button>
                      </div>
                    </div>
                    <div class="align-content markdown-body" data-raw-markdown="${encodeURIComponent(stripEdgeWhitespace(pT))}">${MarkdownProcessor.renderWithKatexFailback(MarkdownProcessor.safeMarkdown(stripEdgeWhitespace((()=>{const key = `chunkOverride_${window.docIdForLocalStorage||'default'}_${blockIndex}_${i}_trans`; const ov = localStorage.getItem(key); return ov ? ov : pT;})()), images), isOriginalFirstInChunkCompare ? transRenderer : ocrRenderer)}</div>
                    <div class="align-edit-panel" style="display:none;">
                      <textarea class="align-edit-area" style="width:100%;min-height:120px;"></textarea>
                      <div class="align-edit-actions" style="margin-top:6px;display:flex;gap:8px;">
                        <button class="align-edit-save" data-block="${blockIndex}" data-type="trans" data-idx="para-${i}">保存</button>
                        <button class="align-edit-cancel" data-block="${blockIndex}" data-type="trans" data-idx="para-${i}">取消</button>
                      </div>
                    </div>
                  </div>
                </div>
              `);
            }
          } else {
            // 最后 fallback：使用原有的 aligned 对
            for (let i = 0; i < aligned.length; i++) {
              const isTablePair = containsTableSyntax(aligned[i][0]) && containsTableSyntax(aligned[i][1]);
              const titleLeft = isTablePair ? '表格' : '原文';
              const titleRight = isTablePair ? '表格' : '译文';
              alignedHTML.push(`
                <div class="align-flex block-flex block-flex-${blockIndex} ${isTablePair ? 'table-pair ' : ''}${showMode==='ocr'?'block-mode-ocr-only':showMode==='trans'?'block-mode-trans-only':'block-mode-both'}" data-block="${blockIndex}" data-align-index="${i}">
                   <div class="align-block align-block-ocr">
                     <div class="align-title">
                      <span>${titleLeft}</span>
                      <div class="align-actions">
                        <button class="block-struct-copy-btn block-icon-btn" data-block="${blockIndex}" data-type="ocr" data-idx="${i}" title="复制原文结构">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                        </button>
                        <button class="block-edit-btn block-icon-btn" data-block="${blockIndex}" data-type="ocr" data-idx="${i}" title="编辑此段">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>
                        </button>
                        <button class="block-edit-reset-btn block-icon-btn" data-block="${blockIndex}" data-type="ocr" data-idx="${i}" title="重置为原文" style="display:none;">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>
                        </button>
                      </div>
                     </div>
                    <div class="align-content markdown-body" data-raw-markdown="${encodeURIComponent(stripEdgeWhitespace(aligned[i][0]))}">${MarkdownProcessor.renderWithKatexFailback(MarkdownProcessor.safeMarkdown(stripEdgeWhitespace((()=>{const key = `chunkOverride_${window.docIdForLocalStorage||'default'}_${blockIndex}_${i}_ocr`; const ov = localStorage.getItem(key); return ov ? ov : aligned[i][0];})()), images), isOriginalFirstInChunkCompare ? ocrRenderer : transRenderer)}</div>
                    <div class="align-edit-panel" style="display:none;">
                      <textarea class="align-edit-area" style="width:100%;min-height:120px;"></textarea>
                      <div class="align-edit-actions" style="margin-top:6px;display:flex;gap:8px;">
                        <button class="align-edit-save" data-block="${blockIndex}" data-type="ocr" data-idx="${i}">保存</button>
                        <button class="align-edit-cancel" data-block="${blockIndex}" data-type="ocr" data-idx="${i}">取消</button>
                      </div>
                    </div>
                  </div>
                  <div class="splitter" title="拖动调整比例"></div>
                   <div class="align-block align-block-trans">
                     <div class="align-title">
                      <span>${titleRight}</span>
                      <div class="align-actions">
                        <button class="block-struct-copy-btn block-icon-btn" data-block="${blockIndex}" data-type="trans" data-idx="${i}" title="复制译文结构">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                        </button>
                        <button class="block-edit-btn block-icon-btn" data-block="${blockIndex}" data-type="trans" data-idx="${i}" title="编辑此段">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>
                        </button>
                        <button class="block-edit-reset-btn block-icon-btn" data-block="${blockIndex}" data-type="trans" data-idx="${i}" title="重置为原文" style="display:none;">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>
                        </button>
                      </div>
                     </div>
                    <div class="align-content markdown-body" data-raw-markdown="${encodeURIComponent(stripEdgeWhitespace(aligned[i][1]))}">${MarkdownProcessor.renderWithKatexFailback(MarkdownProcessor.safeMarkdown(stripEdgeWhitespace((()=>{const key = `chunkOverride_${window.docIdForLocalStorage||'default'}_${blockIndex}_${i}_trans`; const ov = localStorage.getItem(key); return ov ? ov : aligned[i][1];})()), images), isOriginalFirstInChunkCompare ? transRenderer : ocrRenderer)}</div>
                    <div class="align-edit-panel" style="display:none;">
                      <textarea class="align-edit-area" style="width:100%;min-height:120px;"></textarea>
                      <div class="align-edit-actions" style="margin-top:6px;display:flex;gap:8px;">
                        <button class="align-edit-save" data-block="${blockIndex}" data-type="trans" data-idx="${i}">保存</button>
                        <button class="align-edit-cancel" data-block="${blockIndex}" data-type="trans" data-idx="${i}">取消</button>
                      </div>
                    </div>
                  </div>
                </div>
              `);
            }
          }

          html += alignedHTML.join('');

          // 记录原始内容，供复制用
          window[`blockRawContent_${blockIndex}`] = aligned;
          return html;
        }

        // 恢复原始渲染逻辑：渲染每个分块，增加唯一id
        for (let i = 0; i < data.ocrChunks.length; i++) {
            const ocrChunk = data.ocrChunks[i] || '';
            const translatedChunk = data.translatedChunks[i] || '';
            let blockHtmlToRender;
            let outerBlockTitle;

            if (isOriginalFirstInChunkCompare) {
                // 当原文在左侧时，调用 renderLevelAlignedFlex(原文, 译文)
                // window[`blockRawContent_${i}`] 将存储 [原文子块, 译文子块]
                blockHtmlToRender = renderLevelAlignedFlex(ocrChunk, translatedChunk, data.images, i, data.ocrChunks.length);
                outerBlockTitle = `原文块 ${i+1}`;
            } else {
                // 当译文在左侧时，调用 renderLevelAlignedFlex(译文, 原文)
                // window[`blockRawContent_${i}`] 将存储 [译文子块, 原文子块]
                blockHtmlToRender = renderLevelAlignedFlex(translatedChunk, ocrChunk, data.images, i, data.ocrChunks.length);
                outerBlockTitle = `译文块 ${i+1}`; // 标题也反映左侧内容
            }
            html += `<div class="chunk-pair">`;
            html += `<div id="block-${i}" class="block-outer">`; // id 用于导航
            html += `<h4>${outerBlockTitle}</h4>`;
            html += blockHtmlToRender;
            html += `</div></div>`;
        }
        // 绑定每个分块的切换按钮和导航按钮事件
        setTimeout(() => {
          // 拖动分割条实现 - 使用CSS变量而不是直接设置样式
          let ratio = window.chunkCompareRatio;
          if (typeof ratio !== 'number' || isNaN(ratio)) ratio = 0.5;
          window.chunkCompareRatio = ratio;

          function applyRatioToAll() {
            const currentRatio = window.chunkCompareRatio || 0.5;
            document.querySelectorAll('.align-flex').forEach(flex => {
              // 优先使用每对的等高比例
              if (flex.hasAttribute('data-equalized')) {
                const ratioSaved = parseFloat(flex.getAttribute('data-equalized'));
                if (isFinite(ratioSaved)) {
                  flex.style.setProperty('--ocr-ratio', (ratioSaved * 100) + '%');
                  flex.style.setProperty('--trans-ratio', ((1 - ratioSaved) * 100) + '%');
                  return;
                }
              }
              const hasTableOCR = !!flex.querySelector('.align-block-ocr table');
              const hasTableTRANS = !!flex.querySelector('.align-block-trans table');
              const anyTable = hasTableOCR || hasTableTRANS;
              // 表格对若未等高，临时使用0.5；文本对使用全局
              const ratio = anyTable ? 0.5 : currentRatio;
              flex.style.setProperty('--ocr-ratio', (ratio * 100) + '%');
              flex.style.setProperty('--trans-ratio', ((1 - ratio) * 100) + '%');
            });
          }

          // 一次性、逐卡片的简化等高（避免视口进入时抖动）：
          // 在当前布局基础上，以 0.5 为初始，按 hL/(hL+hR) 估算每对的专属比例，仅设置一次
          function equalizePairsOnce() {
            if (window.disableEqualizeForLargeDoc) {
              // 超长文本时跳过逐对等高，避免大量 reflow
              return;
            }
            const pairs = document.querySelectorAll('.align-flex');
            pairs.forEach(flex => {
              if (flex.hasAttribute('data-equalized')) return;
              const left = flex.querySelector('.align-block-ocr .align-content');
              const right = flex.querySelector('.align-block-trans .align-content');
              if (!left || !right) return;
              // 统一先设为 0.5 以获得一致的初始测量
              flex.style.setProperty('--ocr-ratio', '50%');
              flex.style.setProperty('--trans-ratio', '50%');
              const hL = left.getBoundingClientRect().height;
              const hR = right.getBoundingClientRect().height;
              if (!isFinite(hL) || !isFinite(hR) || (hL + hR) === 0) return;
              let r = hL / (hL + hR);
              r = Math.max(0.3, Math.min(0.7, r));
              flex.setAttribute('data-equalized', String(r));
              flex.style.setProperty('--ocr-ratio', (r * 100) + '%');
              flex.style.setProperty('--trans-ratio', ((1 - r) * 100) + '%');
            });
          }
          // 超长文本时不对所有对齐对写入比例，保留默认 50/50（避免全量 DOM 循环）
          if (!window.disableEqualizeForLargeDoc) {
            applyRatioToAll();
            // 简化的一次性等高（无复验、无视口触发，避免抖动）
            try { equalizePairsOnce(); } catch {}
          }

          // 性能优化：缓存DOM查询结果
          const blockModeButtons = document.querySelectorAll('.block-mode-btn');
          const allSplitters = document.querySelectorAll('.splitter');
          const blockCopyButtons = document.querySelectorAll('.block-copy-btn');
          const blockStructCopyButtons = document.querySelectorAll('.block-struct-copy-btn');
          const blockNavButtons = document.querySelectorAll('.block-nav-btn');

          // 性能优化：使用事件委托减少事件监听器数量
          const chunkCompareContainer = document.querySelector('.chunk-compare-container');
          if (chunkCompareContainer && !chunkCompareContainer.dataset.delegateSet) {
            // 为复制按钮添加事件委托
            chunkCompareContainer.addEventListener('click', function(e) {
              // 段落编辑：进入编辑
              if (e.target.classList.contains('block-edit-btn') || e.target.closest('.block-edit-btn')) {
                const btn = e.target.closest('.block-edit-btn');
                const blockIndex = btn.dataset.block;
                const idx = btn.dataset.idx;
                const type = btn.dataset.type; // 'ocr' | 'trans'
                const flex = btn.closest('.align-block');
                const content = flex.querySelector('.align-content.markdown-body');
                const panel = flex.querySelector('.align-edit-panel');
                const textarea = panel && panel.querySelector('.align-edit-area');
                if (!content || !panel || !textarea) return;
                // 初始文案：优先已保存覆盖，其次 data-raw-markdown
                const key = `chunkOverride_${window.docIdForLocalStorage||'default'}_${blockIndex}_${idx}_${type}`;
                const saved = localStorage.getItem(key);
                const raw = decodeURIComponent(content.getAttribute('data-raw-markdown') || '') || '';
                textarea.value = saved || raw;
                // 让编辑区域尽量占满当前卡片高度
                const h = Math.max(content.offsetHeight, 120);
                textarea.style.minHeight = h + 'px';
                content.style.display = 'none';
                panel.style.display = '';
                // 显示重置按钮（如果存在覆盖）
                const resetBtn = flex.querySelector('.block-edit-reset-btn[data-block="'+blockIndex+'"][data-type="'+type+'"][data-idx="'+idx+'"]');
                if (resetBtn) resetBtn.style.display = saved ? '' : 'none';
                return;
              }
              // 段落编辑：保存
              if (e.target.classList.contains('align-edit-save')) {
                const btn = e.target;
                const blockIndex = btn.dataset.block;
                const idx = btn.dataset.idx;
                const type = btn.dataset.type; // 'ocr' | 'trans'
                const block = btn.closest('.align-block');
                const content = block.querySelector('.align-content.markdown-body');
                const panel = block.querySelector('.align-edit-panel');
                const textarea = panel && panel.querySelector('.align-edit-area');
                if (!content || !panel || !textarea) return;
                const md = (textarea.value || '').trim();
                const key = `chunkOverride_${window.docIdForLocalStorage||'default'}_${blockIndex}_${idx}_${type}`;
                if (md) localStorage.setItem(key, md); else localStorage.removeItem(key);
                // 重新渲染该侧
                try {
                  const imgs = (window.data && window.data.images) || [];
                  const html = window.MarkdownProcessor && window.MarkdownProcessor.renderWithKatexFailback
                    ? window.MarkdownProcessor.renderWithKatexFailback(window.MarkdownProcessor.safeMarkdown(md, imgs))
                    : md.replace(/\n/g, '<br>');
                  content.innerHTML = html;
                  content.setAttribute('data-raw-markdown', encodeURIComponent(md));
                } catch { content.textContent = md; }
                panel.style.display = 'none';
                content.style.display = '';
                // 显示重置按钮
                const resetBtn = block.querySelector('.block-edit-reset-btn[data-block="'+blockIndex+'"][data-type="'+type+'"][data-idx="'+idx+'"]');
                if (resetBtn) resetBtn.style.display = md ? '' : 'none';
                return;
              }
              // 段落编辑：取消
              if (e.target.classList.contains('align-edit-cancel')) {
                const btn = e.target;
                const block = btn.closest('.align-block');
                const content = block.querySelector('.align-content.markdown-body');
                const panel = block.querySelector('.align-edit-panel');
                if (!content || !panel) return;
                panel.style.display = 'none';
                content.style.display = '';
                return;
              }
              // 段落编辑：重置覆盖
              if (e.target.classList.contains('block-edit-reset-btn')) {
                const btn = e.target;
                const blockIndex = btn.dataset.block;
                const idx = btn.dataset.idx;
                const type = btn.dataset.type;
                const key = `chunkOverride_${window.docIdForLocalStorage||'default'}_${blockIndex}_${idx}_${type}`;
                localStorage.removeItem(key);
                // 还原为原始 data-raw-markdown
                const block = btn.closest('.align-block');
                const content = block.querySelector('.align-content.markdown-body');
                const panel = block.querySelector('.align-edit-panel');
                if (content) {
                  const md = decodeURIComponent(content.getAttribute('data-raw-markdown') || '') || '';
                  try {
                    const imgs = (window.data && window.data.images) || [];
                    const html = window.MarkdownProcessor && window.MarkdownProcessor.renderWithKatexFailback
                      ? window.MarkdownProcessor.renderWithKatexFailback(window.MarkdownProcessor.safeMarkdown(md, imgs))
                      : md.replace(/\n/g, '<br>');
                    content.innerHTML = html;
                  } catch { content.textContent = md; }
                }
                if (panel) panel.style.display = 'none';
                if (content) content.style.display = '';
                // 隐藏重置按钮
                btn.style.display = 'none';
                return;
              }
              if (e.target.classList.contains('block-copy-btn')) {
                // 复制按钮逻辑保持不变，但通过事件委托触发
                const btn = e.target;
                const blockIndex = btn.dataset.block;
                const rawBlockContent = window[`blockRawContent_${blockIndex}`];
                const currentMode = window[`showMode_block_${blockIndex}`] || 'both';

                // 复制逻辑保持原样...
                if (rawBlockContent && Array.isArray(rawBlockContent)) {
                  let textToCopy = "";
                  let alertMessage = "";

                  if (currentMode === 'ocr') {
                    rawBlockContent.forEach(pair => {
                      const ocrText = isOriginalFirstInChunkCompare ? (pair && pair[0]) : (pair && pair[1]);
                      if (ocrText) textToCopy += ocrText + "\n\n";
                    });
                    textToCopy = textToCopy.trim();
                    alertMessage = `第 ${parseInt(blockIndex) + 1} 块的 原文 已复制!`;
                  } else if (currentMode === 'trans') {
                    rawBlockContent.forEach(pair => {
                      const transText = isOriginalFirstInChunkCompare ? (pair && pair[1]) : (pair && pair[0]);
                      if (transText) textToCopy += transText + "\n\n";
                    });
                    textToCopy = textToCopy.trim();
                    alertMessage = `第 ${parseInt(blockIndex) + 1} 块的 译文 已复制!`;
                  } else {
                    rawBlockContent.forEach(pair => {
                      const ocrText = isOriginalFirstInChunkCompare ? (pair && pair[0]) : (pair && pair[1]);
                      const transText = isOriginalFirstInChunkCompare ? (pair && pair[1]) : (pair && pair[0]);
                      if (ocrText) textToCopy += "原文:\n" + ocrText + "\n\n";
                      if (transText) textToCopy += "译文:\n" + transText + "\n\n";
                    });
                    textToCopy = textToCopy.trim();
                    alertMessage = `第 ${parseInt(blockIndex) + 1} 块的 原文和译文 已复制!`;
                  }

                  if (textToCopy) {
                    navigator.clipboard.writeText(textToCopy)
                      .then(() => alert(alertMessage))
                      .catch(err => {
                        console.error('复制失败:', err);
                        alert('复制失败，请查看控制台。');
                      });
                  } else {
                    alert('没有内容可复制。');
                  }
                } else {
                  alert('没有内容可复制。');
                }
              }
            });

            chunkCompareContainer.dataset.delegateSet = 'true';
          }

          // 保留原有的独立事件绑定（为了兼容性）
          blockModeButtons.forEach(btn => {
            btn.onclick = function() {
              const blockIndex = this.dataset.block;
              const mode = this.dataset.mode;
              window[`showMode_block_${blockIndex}`] = mode;

              // 更新按钮激活状态
              document.querySelectorAll(`.block-mode-btn[data-block="${blockIndex}"]`).forEach(b => {
                b.classList.remove('active');
              });
              this.classList.add('active');

              // 使用CSS类管理显示模式，而不是直接操作样式
              document.querySelectorAll(`.block-flex-${blockIndex}`).forEach(flexPair => {
                // 移除所有模式类
                flexPair.classList.remove('block-mode-ocr-only', 'block-mode-trans-only', 'block-mode-both');

                // 添加对应的模式类
                if (mode === 'ocr') {
                  flexPair.classList.add('block-mode-ocr-only');
                } else if (mode === 'trans') {
                  flexPair.classList.add('block-mode-trans-only');
                } else { // mode === 'both'
                  flexPair.classList.add('block-mode-both');
                  // 当切换回 both 模式时，重新应用拖动条的比例
                  applyRatioToAllFlexPairsInBlock(blockIndex);
                }
              });
            };
          });

          // 辅助函数：将当前拖动比例应用到指定blockIndex的所有flexPair
          function applyRatioToAllFlexPairsInBlock(blockIndexToUpdate) {
            const currentRatio = window.chunkCompareRatio || 0.5;
            document.querySelectorAll(`.block-flex-${blockIndexToUpdate}`).forEach(flex => {
              if (flex.hasAttribute('data-equalized')) {
                const ratioSaved = parseFloat(flex.getAttribute('data-equalized'));
                if (isFinite(ratioSaved)) {
                  flex.style.setProperty('--ocr-ratio', (ratioSaved * 100) + '%');
                  flex.style.setProperty('--trans-ratio', ((1 - ratioSaved) * 100) + '%');
                  return;
                }
              }
              const hasTableOCR = !!flex.querySelector('.align-block-ocr table');
              const hasTableTRANS = !!flex.querySelector('.align-block-trans table');
              const anyTable = hasTableOCR || hasTableTRANS;
              const ratio = anyTable ? 0.5 : currentRatio;
              flex.style.setProperty('--ocr-ratio', (ratio * 100) + '%');
              flex.style.setProperty('--trans-ratio', ((1 - ratio) * 100) + '%');
            });
          }

          // 初始化拖动比例应用到所有分块的所有对比对
          // 确保在按钮事件绑定之后，但在第一次渲染时就能正确设置
          if (document.querySelector('.align-flex')) { // 确保有可操作的元素
            const allBlockIndexes = new Set();
            document.querySelectorAll('[data-block]').forEach(el => allBlockIndexes.add(el.dataset.block));
            allBlockIndexes.forEach(idx => {
                if(window[`showMode_block_${idx}`] === undefined || window[`showMode_block_${idx}`] === 'both') {
                    applyRatioToAllFlexPairsInBlock(idx);
                }
            });
          }

          // 拖动分割条实现
          let draggingSplitterInfo = null; // {splitter, flexContainer, startX, initialOcrBasisPx}

          allSplitters.forEach(splitter => {
            splitter.onmousedown = function(e) {
              const flexContainer = e.target.closest('.align-flex');
              if (!flexContainer) return;
              const ocrBlock = flexContainer.querySelector('.align-block-ocr');
              if (!ocrBlock || getComputedStyle(ocrBlock).display === 'none') return; // 只在对比模式下拖动

              // 用户手动操作该对比对，清除自动等高的固定比例标记
              if (flexContainer.hasAttribute('data-equalized')) {
                flexContainer.removeAttribute('data-equalized');
              }

              draggingSplitterInfo = {
                splitter: e.target,
                flexContainer: flexContainer,
                startX: e.clientX,
                initialOcrBasisPx: ocrBlock.offsetWidth
              };

              e.target.classList.add('active');
              // 使用CSS类而不是直接设置样式
              document.body.classList.add('dragging-cursor');
              e.preventDefault();
            };
          });

          document.addEventListener('mousemove', function(e) {
            if (!draggingSplitterInfo) return;

            const { splitter, flexContainer, startX, initialOcrBasisPx } = draggingSplitterInfo;
            const ocrBlock = flexContainer.querySelector('.align-block-ocr');
            const transBlock = flexContainer.querySelector('.align-block-trans');
            if (!ocrBlock || !transBlock) return;

            const dx = e.clientX - startX;
            const containerWidth = flexContainer.offsetWidth;
            if (containerWidth === 0) return;

            let newOcrWidthPx = initialOcrBasisPx + dx;
            // 限制最小/最大宽度，例如总宽度的20%到80%
            const minWidthPx = containerWidth * 0.2;
            const maxWidthPx = containerWidth * 0.8;
            newOcrWidthPx = Math.max(minWidthPx, Math.min(newOcrWidthPx, maxWidthPx));

            const newOcrRatio = newOcrWidthPx / containerWidth;

            // 更新当前拖动的块的比例
            flexContainer.style.setProperty('--ocr-ratio', (newOcrRatio * 100) + '%');
            flexContainer.style.setProperty('--trans-ratio', ((1 - newOcrRatio) * 100) + '%');

            // 仅更新当前对比对比例（取消联动）
            draggingSplitterInfo.currentRatio = newOcrRatio;
          });

          document.addEventListener('mouseup', function() {
            if (draggingSplitterInfo) {
              draggingSplitterInfo.splitter.classList.remove('active');
              // 使用CSS类而不是直接设置样式
              document.body.classList.remove('dragging-cursor');
              // 将当前对比对的最终比例写入专属 data-equalized，保持独立
              try {
                const { flexContainer, currentRatio } = draggingSplitterInfo;
                if (flexContainer && typeof currentRatio === 'number' && isFinite(currentRatio)) {
                  flexContainer.setAttribute('data-equalized', String(currentRatio));
                  // 若之前有硬等高 min-height，拖动后移除，完全以用户设定为准
                  const left = flexContainer.querySelector('.align-block-ocr .align-content');
                  const right = flexContainer.querySelector('.align-block-trans .align-content');
                  if (left) left.style.minHeight = '';
                  if (right) right.style.minHeight = '';
                }
              } catch {}
              draggingSplitterInfo = null;
            }
          });

          // ============= 智能比例建议（仅默认比例、每文档一次） =============
          (function smartRatioBootstrap() {
            try {
              const docId = window.docIdForLocalStorage;
              if (!docId) return;
              const promptFlagKey = `chunkCompareSmartRatioPromptShown_${docId}`;
              const alreadyPrompted = localStorage.getItem(promptFlagKey) === 'true';
              // 若已有用户自定义比例，或已弹过提示，则不再计算
              const savedRatioText = localStorage.getItem(`chunkCompareRatio_${docId}`);
              const hasCustomRatio = savedRatioText !== null && !isNaN(parseFloat(savedRatioText)) && parseFloat(savedRatioText) !== 0.5;
              if (alreadyPrompted || hasCustomRatio) return;

              // 延迟执行，等待列表 DOM 渲染完成
              setTimeout(() => maybeSuggestSmartRatio(docId, promptFlagKey), 800);
            } catch (e) { console.warn('smartRatioBootstrap error:', e); }
          })();

          // 等高工具：更稳的帧同步+测量、粗采样+细化、困难对硬等高
          if (false) (function setupPairEqualization() {
            const docId = window.docIdForLocalStorage || 'default';
            window.__pairEqualizer = window.__pairEqualizer || {};
            const state = window.__pairEqualizer;

            const raf2 = () => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
            async function waitImages(el, ms=150) {
              const imgs = el.querySelectorAll('img');
              if (imgs.length === 0) { await new Promise(r=>setTimeout(r, ms)); return; }
              await Promise.race([
                new Promise(r=>setTimeout(r, ms)),
                Promise.all(Array.from(imgs).map(img=> new Promise(r=>{ if (img.complete) return r(); img.addEventListener('load', r, {once:true}); img.addEventListener('error', r, {once:true}); })))
              ]);
            }
            async function measureDiff(flex, leftEl, rightEl, ratio) {
              flex.style.setProperty('--ocr-ratio', (ratio * 100) + '%');
              flex.style.setProperty('--trans-ratio', ((1 - ratio) * 100) + '%');
              await raf2();
              const hL = leftEl.getBoundingClientRect().height;
              const hR = rightEl.getBoundingClientRect().height;
              return { diff: hL - hR, hL, hR };
            }
            async function equalizePair(flex) {
              try {
                if (flex.dataset.equalizedDone === 'true') return;
                const left = flex.querySelector('.align-block-ocr .align-content');
                const right = flex.querySelector('.align-block-trans .align-content');
                if (!left || !right) { flex.dataset.equalizedDone = 'true'; return; }
                if (flex.classList.contains('block-mode-ocr-only') || flex.classList.contains('block-mode-trans-only')) { return; }
                await waitImages(flex, 120);
                await raf2();
                const isTablePair = !!flex.querySelector('.align-block-ocr table') && !!flex.querySelector('.align-block-trans table');
                const coarse = [0.35,0.45,0.5,0.55,0.65];
                let best = 0.5, bestAbs = Infinity;
                for (const r of coarse) {
                  const m = await measureDiff(flex, left, right, r);
                  const a = Math.abs(m.diff);
                  if (a < bestAbs) { bestAbs = a; best = r; }
                }
                let low = Math.max(0.3, best - 0.1);
                let high = Math.min(0.7, best + 0.1);
                const tol = isTablePair ? 4 : 6;
                for (let i=0;i<(isTablePair?7:6);i++) {
                  const mid = (low+high)/2;
                  const m = await measureDiff(flex, left, right, mid);
                  const a = Math.abs(m.diff);
                  if (a < bestAbs) { bestAbs = a; best = mid; }
                  if (a <= tol) break;
                  if (m.diff > 0) { low = mid; } else { high = mid; }
                }
                // 复验微调
                for (let step=0.04, k=0; k<3; k++, step*=0.5) {
                  const candidates = [best-step, best, best+step].map(r=> Math.max(0.3, Math.min(0.7, r)));
                  for (const r of candidates) {
                    const m = await measureDiff(flex, left, right, r);
                    const a = Math.abs(m.diff);
                    if (a < bestAbs) { bestAbs = a; best = r; }
                  }
                  if (bestAbs <= (isTablePair?2:3)) break;
                }
                // 困难对硬等高：误差仍过大
                if (bestAbs > (isTablePair?4:6)) {
                  const last = await measureDiff(flex, left, right, best);
                  const target = Math.max(last.hL, last.hR);
                  left.style.minHeight = target + 'px';
                  right.style.minHeight = target + 'px';
                  flex.setAttribute('data-equalized', 'hard');
                } else {
                  flex.setAttribute('data-equalized', String(best));
                }
                flex.dataset.equalizedDone = 'true';
              } catch (e) { /* ignore per pair */ }
            }

            // 进入视口再等高（首屏优先）
            if (!state.observer) {
              state.observer = new IntersectionObserver(async entries => {
                for (const entry of entries) {
                  if (entry.isIntersecting) {
                    const flex = entry.target;
                    state.observer.unobserve(flex);
                    await equalizePair(flex);
                  }
                }
              }, { root: null, rootMargin: '200px', threshold: 0.1 });
            }
            document.querySelectorAll('.align-flex').forEach(flex => {
              // 清理因硬等高设置的 min-height（避免历史残留影响）
              const left = flex.querySelector('.align-block-ocr .align-content');
              const right = flex.querySelector('.align-block-trans .align-content');
              if (left) left.style.minHeight = '';
              if (right) right.style.minHeight = '';
              state.observer.observe(flex);
            });
          })();

          // 控制台调试入口：window.forceSmartRatioPrompt({ resetPrompt:true, resetRatio:true })
          window.forceSmartRatioPrompt = function(opts={}) {
            try {
              const docId = window.docIdForLocalStorage;
              if (!docId) return console.warn('forceSmartRatioPrompt: missing docId');
              const promptFlagKey = `chunkCompareSmartRatioPromptShown_${docId}`;
              if (opts.resetPrompt) localStorage.removeItem(promptFlagKey);
              if (opts.resetRatio) localStorage.removeItem(`chunkCompareRatio_${docId}`);
              maybeSuggestSmartRatio(docId, promptFlagKey);
            } catch(e) { console.warn('forceSmartRatioPrompt error:', e); }
          };

          async function maybeSuggestSmartRatio(docId, promptFlagKey) {
            try {
              // 再次确认是否已经设置过比例
              const savedRatioText = localStorage.getItem(`chunkCompareRatio_${docId}`);
              const hasCustomRatio = savedRatioText !== null && !isNaN(parseFloat(savedRatioText)) && parseFloat(savedRatioText) !== 0.5;
              if (hasCustomRatio) return;

              if (!window.data || !Array.isArray(window.data.ocrChunks) || !Array.isArray(window.data.translatedChunks)) return;
              const total = Math.min(window.data.ocrChunks.length, window.data.translatedChunks.length);
              if (total === 0) return;

              // 选取最多15个候选块（优先无图、长度>=150）
              const candidates = selectCandidateBlockIndices(window.data.ocrChunks, window.data.translatedChunks, 15);
              // 调试日志
              try { console.log('[SmartRatio] candidates:', candidates); } catch {}
              // 需要至少2个候选块
              if (candidates.length < 2) return;

              // 统一设置当前比率为0.5，确保测量一致
              window.chunkCompareRatio = 0.5;
              applyRatioToAll();

              const ratios = [];
              // 逐个确保加载完整块并测量
              for (const idx of candidates) {
                const ok = await ensureChunkPresent(idx, 4000);
                if (!ok) continue;
                const loaded = await ensureChunkLoaded(idx, 6000);
                if (!loaded) continue;

                // 对新加载的flex对也应用0.5比例
                applyRatioToAll();

                const r = measureRecommendedRatioForBlock(idx);
                if (typeof r === 'number' && isFinite(r) && r > 0 && r < 1) {
                  ratios.push(r);
                }
                if (ratios.length >= 15) break;
              }

              // 至少需要2个有效测量结果
              if (ratios.length < 2) { try { console.log('[SmartRatio] Not enough measured ratios:', ratios); } catch {}; return; }
              // 剔除极端值：简单去头去尾（10%）；n>=6时各去1个
              ratios.sort((a,b)=>a-b);
              let trimmed = ratios.slice();
              if (ratios.length >= 6) {
                trimmed = ratios.slice(1, ratios.length - 1);
              }
              const avg = trimmed.reduce((s,v)=>s+v,0) / trimmed.length;
              let suggested = Math.max(0.3, Math.min(0.7, avg));
              try { console.log('[SmartRatio] ratios:', ratios, 'trimmed:', trimmed, 'avg:', avg, 'suggested:', suggested); } catch {}

              // 主动弹窗（每文档只弹一次）
              localStorage.setItem(promptFlagKey, 'true');
              const pct = Math.round(suggested * 100);
              const use = confirm(`已根据前 ${trimmed.length} 个块估算出建议对比比例为 ${pct}%（原文）/ ${100-pct}%（译文）。是否应用？`);
              if (use) {
                window.chunkCompareRatio = suggested;
                applyRatioToAll();
                localStorage.setItem(`chunkCompareRatio_${docId}`, String(suggested));
                if (typeof showNotification === 'function') {
                  showNotification(`已应用智能比例：原文 ${pct}%`, 'success');
                }
              }
            } catch (e) {
              console.warn('maybeSuggestSmartRatio error:', e);
            }
          }

          function selectCandidateBlockIndices(ocrChunks, transChunks, limit) {
            const n = Math.min(ocrChunks.length, transChunks.length);
            const items = [];
            for (let i = 0; i < n; i++) {
              const o = ocrChunks[i] || '';
              const t = transChunks[i] || '';
              const lenOk = (o.length >= 150) && (t.length >= 150);
              const hasImg = /!\[[^\]]*\]\([^)]*\)|<img\b/i.test(o) || /!\[[^\]]*\]\([^)]*\)|<img\b/i.test(t);
              const hasMdTable = /(^|[\r\n])\s*\|.*\|/m.test(o) || /(^|[\r\n])\s*\|.*\|/m.test(t) || /<table\b/i.test(o) || /<table\b/i.test(t);
              items.push({ idx: i, lenOk, hasImg, hasMdTable });
            }
            // 过滤：长度达标
            const filtered = items.filter(it => it.lenOk && !it.hasMdTable);
            // 优先无图，再有图，再按索引
            filtered.sort((a,b)=> (a.hasImg===b.hasImg?0:(a.hasImg?1:-1)) || (a.idx-b.idx));
            return filtered.slice(0, limit).map(it=>it.idx);
          }

          function measureRecommendedRatioForBlock(blockIndex) {
            try {
              // 兼容旧版与新版容器：优先旧版 #block-{i}，再尝试 #chunk-{i} 或 data-chunk-index
              const container =
                document.getElementById(`block-${blockIndex}`) ||
                document.getElementById(`chunk-${blockIndex}`) ||
                document.querySelector(`.chunk-pair[data-chunk-index="${blockIndex}"]`);
              if (!container) return null;
              // 跳过包含表格的块，避免对建议比例产生干扰
              if (container.querySelector('table')) return null;
              const ocrNodes = container.querySelectorAll('.align-block-ocr .align-content');
              const transNodes = container.querySelectorAll('.align-block-trans .align-content');
              if (ocrNodes.length === 0 || transNodes.length === 0) return null;
              let hOcr = 0, hTrans = 0;
              ocrNodes.forEach(n => { hOcr += n.getBoundingClientRect().height; });
              transNodes.forEach(n => { hTrans += n.getBoundingClientRect().height; });
              if (!isFinite(hOcr) || !isFinite(hTrans) || hOcr <= 0 || hTrans <= 0) return null;
              // 基于 h ~ A/r, 推导 r* = hOcr / (hOcr + hTrans)
              const r = hOcr / (hOcr + hTrans);
              return r;
            } catch (e) {
              return null;
            }
          }

          function wait(ms) { return new Promise(res => setTimeout(res, ms)); }

          async function ensureChunkPresent(index, timeoutMs = 4000) {
            const start = Date.now();
            while (Date.now() - start < timeoutMs) {
              const el = document.getElementById(`block-${index}`) ||
                          document.getElementById(`chunk-${index}`) ||
                          document.querySelector(`.chunk-pair[data-chunk-index="${index}"]`);
              if (el) return true;
              await wait(60);
            }
            return false;
          }

          async function ensureChunkLoaded(index, timeoutMs = 6000) {
            try {
              const container = document.getElementById(`block-${index}`) ||
                                document.getElementById(`chunk-${index}`) ||
                                document.querySelector(`.chunk-pair[data-chunk-index="${index}"]`);
              if (!container) return false;
              // 旧版一次性渲染，存在 .align-flex 即视为已加载
              if (container.querySelector('.align-flex')) return true;
              // 新版需触发懒加载
              if (window.ChunkCompareOptimizer && window.ChunkCompareOptimizer.instance && typeof window.ChunkCompareOptimizer.instance.loadFullChunk === 'function') {
                window.ChunkCompareOptimizer.instance.loadFullChunk(index);
              }
              const start = Date.now();
              while (Date.now() - start < timeoutMs) {
                if (container.querySelector('.align-flex')) return true;
                await wait(80);
              }
            } catch {}
            return false;
          }

          blockCopyButtons.forEach(btn => {
            btn.onclick = function() {
              const blockIndex = this.dataset.block;
              const rawBlockContent = window[`blockRawContent_${blockIndex}`];
              const currentMode = window[`showMode_block_${blockIndex}`] || 'both'; // 获取当前模式

              if (rawBlockContent && Array.isArray(rawBlockContent)) {
                let textToCopy = "";
                let alertMessage = "";

                if (currentMode === 'ocr') {
                  rawBlockContent.forEach(pair => {
                    // 如果原文在左，pair[0]是原文；如果译文在左，pair[0]是译文
                    const ocrText = isOriginalFirstInChunkCompare ? (pair && pair[0]) : (pair && pair[1]);
                    if (ocrText) textToCopy += ocrText + "\n\n";
                  });
                  textToCopy = textToCopy.trim();
                  alertMessage = `第 ${parseInt(blockIndex) + 1} 块的 原文 已复制!`;
                } else if (currentMode === 'trans') {
                  rawBlockContent.forEach(pair => {
                    // 如果原文在左，pair[1]是译文；如果译文在左，pair[1]是原文
                    const transText = isOriginalFirstInChunkCompare ? (pair && pair[1]) : (pair && pair[0]);
                    if (transText) textToCopy += transText + "\n\n";
                  });
                  textToCopy = textToCopy.trim();
                  alertMessage = `第 ${parseInt(blockIndex) + 1} 块的 译文 已复制!`;
                } else { // mode === 'both'
                  rawBlockContent.forEach(pair => {
                    const ocrText = isOriginalFirstInChunkCompare ? (pair && pair[0]) : (pair && pair[1]);
                    const transText = isOriginalFirstInChunkCompare ? (pair && pair[1]) : (pair && pair[0]);
                    if (ocrText) textToCopy += "原文:\n" + ocrText + "\n\n";
                    if (transText) textToCopy += "译文:\n" + transText + "\n\n";
                  });
                  textToCopy = textToCopy.trim();
                  alertMessage = `第 ${parseInt(blockIndex) + 1} 块的 原文和译文 已复制!`;
                }

                if (textToCopy) {
                  navigator.clipboard.writeText(textToCopy)
                    .then(() => alert(alertMessage))
                    .catch(err => {
                      console.error('复制失败:', err);
                      alert('复制失败，请查看控制台。');
                    });
                } else {
                  alert('没有内容可复制。');
                }
              }
            };
          });

          blockStructCopyButtons.forEach(btn => {
            btn.onclick = function() {
              const blockIndex = this.dataset.block;
              const type = this.dataset.type; // 'ocr' or 'trans'
              const structIdx = parseInt(this.dataset.idx);
              const rawBlockContent = window[`blockRawContent_${blockIndex}`];
              if (rawBlockContent && rawBlockContent[structIdx]) {
                const textToCopy = (type === 'ocr') ? rawBlockContent[structIdx][0] : rawBlockContent[structIdx][1];
                navigator.clipboard.writeText(textToCopy)
                  .then(() => alert(`第 ${parseInt(blockIndex) + 1} 块的 ${type === 'ocr' ? '原文' : '译文'} (结构 ${structIdx + 1}) 已复制!`))
                  .catch(err => console.error('复制失败:', err));
              }
            };
          });

          blockNavButtons.forEach(btn => {
            btn.onclick = function() {
              const blockIndex = parseInt(this.dataset.block);
              const direction = this.dataset.dir;
              let targetIndex = direction === 'prev' ? blockIndex - 1 : blockIndex + 1;
              const targetElement = document.getElementById(`block-${targetIndex}`);
              if (targetElement) {
                targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
                // 可选：添加高亮效果
                targetElement.classList.add('block-highlight');
                setTimeout(() => targetElement.classList.remove('block-highlight'), 1500);
              }
            };
          });

          // 性能监控：记录分块对比渲染时间
          const renderEndTime = performance.now();
          console.log(`[性能] 分块对比渲染完成，总块数: ${data.ocrChunks.length}，耗时: ${(renderEndTime - window.chunkCompareStartTime || 0).toFixed(2)}ms`);

          // 内存优化：清理旧的缓存（如果太多的话）
          if (window.chunkParseCache && Object.keys(window.chunkParseCache).length > 100) {
            console.log('[性能] 清理部分解析缓存以释放内存');
            // 超长文档更激进地清理缓存
            const MAX_CACHE_ITEMS = (window.disableEqualizeForLargeDoc ? 5 : 50);
            const cacheKeys = Object.keys(window.chunkParseCache);
            const keysToDelete = cacheKeys.slice(0, cacheKeys.length - MAX_CACHE_ITEMS);
            keysToDelete.forEach(key => delete window.chunkParseCache[key]);
          }

        }, 0);
        } // end fallback (no optimizer)
    } else {
        html = '<h3>分块对比</h3><p>此记录没有有效的分块对比数据。</p>';
        if (!data.ocrChunks || !data.translatedChunks) {
             html += '<p>原因：缺少分块数据 (ocrChunks or translatedChunks missing)。</p>';
        } else if (data.ocrChunks.length !== data.translatedChunks.length) {
             html += `<p>原因：原文块数量 (${data.ocrChunks.length}) 与译文块数量 (${data.translatedChunks.length}) 不匹配。</p>`;
        } else {
             html += '<p>原因：分块数据为空。</p>';
        }
    }
  }
  document.getElementById('tabContent').innerHTML = html;
  // 分批渲染逻辑（仅对 OCR 和翻译标签页生效）
  if(tab === 'ocr' || tab === 'translation') {
    const contentText = tab === 'ocr' ? (data.ocr || '') : (data.translation || '');
    const contentContainer = document.getElementById(contentContainerId);
    const batchSize = 30; // 每批渲染的段落数，可调整
    const tokens = marked.lexer(contentText).filter(token => ['paragraph','heading','code','table','blockquote','list','html','hr'].includes(token.type));
    window.currentBlockTokensForCopy[tab] = tokens;
    // 性能优化：禁用预标注（inline span 注入），统一改为渲染完成后由 applyBlockAnnotations 处理
    // 这样可避免在长文本上进行大量正则匹配与 DOM 拼接。
    const customRenderer = createCustomMarkdownRenderer([], tab, MarkdownProcessor.renderWithKatexFailback);

    // Define segmentInBatches here, so it's in scope for renderBatch's callback
    function segmentInBatches(containerElement, batchSize = 10, delay = 50, onDone) {
        const blocks = Array.from(containerElement.children).filter(node => node.nodeType === Node.ELEMENT_NODE);
        let i = 0;
        function runBatch() {
            const end = Math.min(i + batchSize, blocks.length);
            for (; i < end; i++) {
                const el = blocks[i];
                el.dataset.blockIndex = String(i);
                if (window.SubBlockSegmenter && typeof window.SubBlockSegmenter.segment === 'function') {
                    // 强制分段，保证英文/短段也有子块，便于精确高亮
                    window.SubBlockSegmenter.segment(el, i, true);
                } else {
                    console.error("SubBlockSegmenter.segment is not available.");
                }
            }
            if (i < blocks.length) {
                setTimeout(runBatch, delay);
            } else {
                // 所有父块的子块分割完成
                onDone && onDone();
            }
        }
        runBatch();
    }

    function renderBatch(startIdx, onDoneAllBatchesCallback) { // Added onDoneAllBatchesCallback parameter
      const fragment = document.createDocumentFragment();
      for(let i=startIdx;i<Math.min(tokens.length, startIdx+batchSize);i++){
        const htmlStr = MarkdownProcessor.renderWithKatexFailback(MarkdownProcessor.safeMarkdown(tokens[i].raw || '', data.images), customRenderer);
        const wrap = document.createElement('div');
        wrap.innerHTML = htmlStr;
        while(wrap.firstChild) fragment.appendChild(wrap.firstChild);
      }
      contentContainer.appendChild(fragment);
      if(startIdx+batchSize<tokens.length) {
        setTimeout(()=>renderBatch(startIdx+batchSize, onDoneAllBatchesCallback),0); // Pass callback along
      } else {
        // 所有批次渲染完成
        if(tab==='ocr') console.timeEnd('[性能] OCR分批渲染');
        if(tab==='translation') console.timeEnd('[性能] 翻译分批渲染');

        // Use requestAnimationFrame to allow browser to paint/layout before further DOM manipulation
        requestAnimationFrame(() => {
          console.log(`[showTab - ${tab}] RAF triggered after all batches rendered.`);
          const currentTabContentWrapper = document.getElementById(contentContainerId);
          if (currentTabContentWrapper) {
              adjustLongHeadingsToParagraphs(currentTabContentWrapper);
          }

          // Now, call segmentInBatches on the fully rendered content
          activeContentElement = document.getElementById(contentContainerId); // Re-affirm activeContentElement
          if (activeContentElement) {
            segmentInBatches(activeContentElement, 10, 50, () => {
                // This is the onDone callback for segmentInBatches
                // All segmentation is complete, now apply annotations and listeners
                if (data && data.annotations && typeof window.applyBlockAnnotations === 'function') {
                    window.applyBlockAnnotations(activeContentElement, data.annotations, contentIdentifier);
                }
                // Finally, update Dock stats and TOC as content and structure are finalized
                if (window.DockLogic && typeof window.DockLogic.updateStats === 'function') {
                  console.log(`[showTab - ${tab}] OCR/Translation: segmentInBatches done, forcing Dock stats update.`);
                  window.DockLogic.updateStats(window.data, currentVisibleTabId);
                }
                if (typeof window.refreshTocList === 'function') {
                  console.log(`[showTab - ${tab}] OCR/Translation: segmentInBatches done, forcing TOC refresh.`);
                  window.refreshTocList();
                }
                // ========== 渲染完成，解锁 ==========='
                renderingTab = null;
                // ====================================
                // ========== 内容加载完成 =============
                window.contentReady = true;
                console.log('[DEBUG] window.contentReady = true (after OCR/Translation segmentInBatches)');
                // ====================================
            });
          } else {
            // ========== 渲染完成，解锁 ==========='
            renderingTab = null;
            // ====================================
            // ========== 内容加载完成 =============
            window.contentReady = true;
            console.log('[DEBUG] window.contentReady = true (after OCR/Translation segmentInBatches, no activeContentElement)');
            // ====================================
          }
        }); // End of requestAnimationFrame
      }
    }

    // Start rendering batches and provide a callback for when all are done
    renderBatch(0, () => {
      // This callback is executed after all batches for OCR/Translation are rendered
      console.log(`[showTab - ${tab}] All batches rendered. Proceeding with DOM processing.`);

      // Use requestAnimationFrame to allow browser to paint/layout before further DOM manipulation
      requestAnimationFrame(() => {
        console.log(`[showTab - ${tab}] RAF triggered after all batches rendered.`);
        const currentTabContentWrapper = document.getElementById(contentContainerId);
        if (currentTabContentWrapper) {
            adjustLongHeadingsToParagraphs(currentTabContentWrapper);
        }

        // Now, call segmentInBatches on the fully rendered content
        activeContentElement = document.getElementById(contentContainerId); // Re-affirm activeContentElement
        if (activeContentElement) {
          segmentInBatches(activeContentElement, 10, 50, () => {
              // This is the onDone callback for segmentInBatches
              // All segmentation is complete, now apply annotations and listeners
              if (data && data.annotations && typeof window.applyBlockAnnotations === 'function') {
                  window.applyBlockAnnotations(activeContentElement, data.annotations, contentIdentifier);
              }
              // Finally, update Dock stats and TOC as content and structure are finalized
              if (window.DockLogic && typeof window.DockLogic.updateStats === 'function') {
                console.log(`[showTab - ${tab}] OCR/Translation: segmentInBatches done, forcing Dock stats update.`);
                window.DockLogic.updateStats(window.data, currentVisibleTabId);
              }
              if (typeof window.refreshTocList === 'function') {
                console.log(`[showTab - ${tab}] OCR/Translation: segmentInBatches done, forcing TOC refresh.`);
                window.refreshTocList();
              }
              // ========== 渲染完成，解锁 ==========='
              renderingTab = null;
              // ====================================
              // ========== 内容加载完成 =============
              window.contentReady = true;
              console.log('[DEBUG] window.contentReady = true (after OCR/Translation segmentInBatches)');
              // ====================================
          });
        } else {
          // ========== 渲染完成，解锁 ==========='
          renderingTab = null;
          // ====================================
          // ========== 内容加载完成 =============
          window.contentReady = true;
          console.log('[DEBUG] window.contentReady = true (after OCR/Translation segmentInBatches, no activeContentElement)');
          // ====================================
        }
      }); // End of requestAnimationFrame
    });
  }

  // NEW: Adjust long headings. This should be called AFTER innerHTML is set
  // and BEFORE refreshTocList is called.
  // MOVED: adjustLongHeadingsToParagraphs is now called after renderBatch completes for OCR/Translation
  // const tabContentElement = document.getElementById('tabContent');
  // if (tabContentElement) {
  //     adjustLongHeadingsToParagraphs(tabContentElement);
  // }

  // MOVED: refreshTocList is now called later for OCR/Translation
  // if (typeof window.refreshTocList === 'function') {
  //   window.refreshTocList(); // 更新TOC
  // }

  // Update reading progress when tab changes and content is rendered - CALLING DOCK_LOGIC
  if (window.DockLogic && typeof window.DockLogic.forceUpdateReadingProgress === 'function') {
    window.DockLogic.forceUpdateReadingProgress();
  }

  // 如果是分块对比视图，并且按钮存在，则绑定事件
  if (tab === 'chunk-compare') {
    const swapBtn = document.getElementById('swap-chunks-btn');
    if (swapBtn) {
        swapBtn.onclick = function() {
            isOriginalFirstInChunkCompare = !isOriginalFirstInChunkCompare;
            showTab('chunk-compare'); // 重新渲染分块对比视图
        };
    }
  }

  // After tab content is updated, refresh chatbot UI if it's open
  if (window.isChatbotOpen && typeof window.ChatbotUI !== 'undefined' && typeof window.ChatbotUI.updateChatbotUI === 'function') {
    window.ChatbotUI.updateChatbotUI();
  }

  // 应用高亮和批注
  // MOVED: The logic for applying annotations and adding listeners for OCR/Translation
  // is now inside the callback chain starting from renderBatch a few lines above.
  /*
  if ((tab === 'ocr' || tab === 'translation') && contentContainerId) {
    activeContentElement = document.getElementById(contentContainerId);
    if (activeContentElement) {
        // 分批异步分割子块，避免一次性阻塞
        function segmentInBatches(containerElement, batchSize = 10, delay = 50, onDone) {
            const blocks = Array.from(containerElement.children).filter(node => node.nodeType === Node.ELEMENT_NODE);
            let i = 0;
            function runBatch() {
                const end = Math.min(i + batchSize, blocks.length);
                for (; i < end; i++) {
                    const el = blocks[i];
                    el.dataset.blockIndex = String(i);
                    if (window.SubBlockSegmenter && typeof window.SubBlockSegmenter.segment === 'function') {
                        // 强制分段，保证英文/短段也有子块，便于精确高亮
                        window.SubBlockSegmenter.segment(el, i, true);
                    } else {
                        console.error("SubBlockSegmenter.segment is not available.");
                    }
                }
                if (i < blocks.length) {
                    setTimeout(runBatch, delay);
                } else {
                    // 所有父块的子块分割完成
                    onDone && onDone();
                }
            }
            runBatch();
        }

        segmentInBatches(activeContentElement, 10, 50, () => {
            // 所有分割完成后，应用批注和监听器
            if (data && data.annotations && typeof window.applyBlockAnnotations === 'function') {
                window.applyBlockAnnotations(activeContentElement, data.annotations, window.globalCurrentContentIdentifier);
            }
            // **** 新增：在所有子块分割和批注应用完成后，再次更新Dock统计 ****
            if (window.DockLogic && typeof window.DockLogic.updateStats === 'function') {
              console.log(`[showTab - ${tab}] OCR/Translation content and annotations processed, forcing Dock stats update.`);
              window.DockLogic.updateStats(window.data, currentVisibleTabId);
            }
            // TOC refresh will be handled later
        });
    }
  } else if (tab === 'chunk-compare') {
  */
  // The chunk-compare logic for annotations and Dock stats remains, as it has its own processing path.
  // We only moved the OCR/Translation specific part.
  if (tab === 'chunk-compare') { // This is the original start of the else if block
     // 对于分块对比视图，为每个原文和译文块单独处理
     setTimeout(() => { //确保DOM更新完毕
        // 清理工具：移除区域末尾的换行/空白/空段落，避免不可见换行导致高度不齐
        function trimTrailingBreaks(area) {
          if (!area) return;
          try {
            function isWhitespaceText(n) {
              if (!n || n.nodeType !== Node.TEXT_NODE) return false;
              let t = n.textContent || '';
              t = t.replace(/\u00A0/g, ' '); // NBSP → space
              t = t.replace(/[\u200B-\u200D\uFEFF]/g, ''); // zero-width
              return /^\s*$/.test(t);
            }
            function isEmptyElement(n) {
              if (!n || n.nodeType !== Node.ELEMENT_NODE) return false;
              // 没有可见文本与可见子节点（如图片/表格）
              const hasMedia = n.querySelector('img, table, video, svg');
              let txt = (n.textContent || '');
              txt = txt.replace(/\u00A0/g, ' ');
              txt = txt.replace(/[\u200B-\u200D\uFEFF]/g, '');
              txt = txt.replace(/\s+/g, '');
              return !hasMedia && txt.length === 0;
            }
            function removeTrailingIn(el) {
              let node = el && el.lastChild;
              // 先清理内部子节点的末尾 <br> 与空白
              if (node && node.nodeType === Node.ELEMENT_NODE) {
                while (node.lastChild && (node.lastChild.nodeType === Node.ELEMENT_NODE && node.lastChild.tagName.toLowerCase() === 'br' || isWhitespaceText(node.lastChild))) {
                  node.removeChild(node.lastChild);
                }
              }
              // 再清理当前容器的末尾
              while (node) {
                if (isWhitespaceText(node)) {
                  const prev = node.previousSibling; el.removeChild(node); node = prev; continue;
                }
                if (node.nodeType === Node.ELEMENT_NODE) {
                  const tag = node.tagName.toLowerCase();
                  if (tag === 'br') { const prev = node.previousSibling; el.removeChild(node); node = prev; continue; }
                  // 清理元素内末尾 <br> 以及纯空元素
                  while (node.lastChild && (node.lastChild.nodeType === Node.ELEMENT_NODE && node.lastChild.tagName.toLowerCase() === 'br' || isWhitespaceText(node.lastChild))) {
                    node.removeChild(node.lastChild);
                  }
                  if (isEmptyElement(node)) { const prev = node.previousSibling; el.removeChild(node); node = prev; continue; }
                }
                break;
              }
            }
            removeTrailingIn(area);
          } catch (e) { /* ignore */ }
        }
        const ocrContentAreas = document.querySelectorAll('.chunk-compare-container .align-block-ocr .align-content.markdown-body');
        const transContentAreas = document.querySelectorAll('.chunk-compare-container .align-block-trans .align-content.markdown-body');
        let areasProcessed = 0;
        const totalAreasToProcess = ocrContentAreas.length + transContentAreas.length;

        function singleAreaProcessed() {
            areasProcessed++;
            if (areasProcessed === totalAreasToProcess) {
                // 所有分块对比区域处理完毕后更新Dock统计和TOC
                if (window.DockLogic && typeof window.DockLogic.updateStats === 'function') {
                    console.log(`[showTab - ${tab}] Chunk-compare: all areas processed, forcing Dock stats update.`);
                    window.DockLogic.updateStats(window.data, currentVisibleTabId);
                }
                if (typeof window.refreshTocList === 'function') {
                    console.log(`[showTab - ${tab}] Chunk-compare: all areas processed, forcing TOC refresh.`);
                    window.refreshTocList();
                }
            }
        }

        function processContentAreaAsync(area, isOcrArea, callback) { // Renamed for clarity
            if (!area.id) {
                area.id = 'chunk-content-' + _page_generateUUID();
            }
            // 渲染完成后立即清理尾部换行/空白
            trimTrailingBreaks(area);
            const effectiveContentIdentifier = isOriginalFirstInChunkCompare ? (isOcrArea ? 'ocr' : 'translation') : (isOcrArea ? 'translation' : 'ocr');
            const blockElements = Array.from(area.children).filter(node => node.nodeType === Node.ELEMENT_NODE);

            let i = 0;
            const batchSize = 5;
            function runChunkSubBatch() {
                const end = Math.min(i + batchSize, blockElements.length);
                for (; i < end; i++) {
                    const element = blockElements[i];
                    element.dataset.blockIndex = String(i);
                    if (typeof window.SubBlockSegmenter !== 'undefined' && typeof window.SubBlockSegmenter.segment === 'function') {
                        window.SubBlockSegmenter.segment(element, i);
                    } else {
                        console.error("SubBlockSegmenter.segment is not available for chunk processing.");
                    }
                }
                if (i < blockElements.length) {
                    setTimeout(runChunkSubBatch, 20);
                } else {
                    if (data && data.annotations && typeof window.applyBlockAnnotations === 'function') {
                        const annotationsToApply = (currentVisibleTabId === 'chunk-compare') ? [] : data.annotations;
                        window.applyBlockAnnotations(area, annotationsToApply, effectiveContentIdentifier);
                    }
                    callback(); // Signal completion for this area
                }
            }
            runChunkSubBatch();
        }

        if (totalAreasToProcess === 0) { // Handle case with no content areas
             if (window.DockLogic && typeof window.DockLogic.updateStats === 'function') {
                console.log(`[showTab - ${tab}] Chunk-compare has no content areas, forcing Dock stats update.`);
                window.DockLogic.updateStats(window.data, currentVisibleTabId);
            }
            // TOC refresh will be handled later -> Actually, should be called here too if no areas.
            if (typeof window.refreshTocList === 'function') {
                console.log(`[showTab - ${tab}] Chunk-compare has no content areas, forcing TOC refresh.`);
                window.refreshTocList();
            }
        } else {
            ocrContentAreas.forEach(area => processContentAreaAsync(area, true, singleAreaProcessed));
            transContentAreas.forEach(area => processContentAreaAsync(area, false, singleAreaProcessed));
        }
     }, 0);
     // ========== 渲染完成，解锁 ===========
     renderingTab = null;
     // ====================================
  }

  // Attempt to restore scroll position for the current tab
  if (docIdForLocalStorage && currentVisibleTabId) {
    // 添加模式标识到存储键中
    const isImmersive = window.ImmersiveLayout && window.ImmersiveLayout.isActive();
    const modePrefix = isImmersive ? 'immersive_' : 'normal_';
    const scrollKey = `scrollPos_${modePrefix}${docIdForLocalStorage}_${currentVisibleTabId}`;
    const savedScrollTop = localStorage.getItem(scrollKey);
    console.log(`[showTab] 尝试恢复滚动位置: ${scrollKey}, 保存的值: ${savedScrollTop}, 沉浸模式: ${isImmersive ? '是' : '否'}`);

    if (savedScrollTop !== null && !isNaN(parseInt(savedScrollTop, 10))) {
      const scrollableElement = getCurrentScrollableElementForHistoryDetail(); // MODIFIED
      if (scrollableElement) {
        console.log(`[showTab] 找到可滚动元素:`, {
          元素ID: scrollableElement.id || '无ID',
          元素类名: scrollableElement.className || '无类名',
          元素标签: scrollableElement.tagName,
          当前scrollTop: scrollableElement.scrollTop,
          将要设置的scrollTop: parseInt(savedScrollTop, 10),
          scrollHeight: scrollableElement.scrollHeight,
          clientHeight: scrollableElement.clientHeight,
          路径: getElementPath(scrollableElement)
        });

        // 使用多次尝试确保滚动位置被正确设置
        const scrollTopToSet = parseInt(savedScrollTop, 10);
        let attemptCount = 0;

        function attemptToSetScroll() {
          if (currentVisibleTabId !== tab) {
            console.log(`[showTab] 标签已切换，取消恢复滚动位置`);
            return;
          }

          attemptCount++;
          console.log(`[showTab] 第${attemptCount}次尝试设置滚动位置: ${scrollTopToSet}`);
          scrollableElement.scrollTop = scrollTopToSet;

          // 检查是否成功设置
          setTimeout(() => {
            const currentScrollTop = scrollableElement.scrollTop;
            const difference = Math.abs(scrollTopToSet - currentScrollTop);
            console.log(`[showTab] 设置后检查: 预期=${scrollTopToSet}, 实际=${currentScrollTop}, 差值=${difference}`);

            // 如果差异大于阈值且尝试次数小于最大次数，则重试
            if (difference > 5 && attemptCount < 3) {
              console.warn(`[showTab] 警告: 滚动位置设置可能未生效! 将在200ms后重试...`);
              setTimeout(attemptToSetScroll, 200);
            } else if (difference > 5) {
              console.warn(`[showTab] 警告: 滚动位置设置失败，已达到最大尝试次数`);
            } else {
              console.log(`[showTab] 滚动位置设置成功!`);
            }
          }, 50);
        }

        // 使用requestAnimationFrame确保DOM已更新
        requestAnimationFrame(() => {
          if(currentVisibleTabId === tab) { // Ensure tab hasn't changed during async operation
            attemptToSetScroll();
          } else {
            console.log(`[showTab] 标签已切换，取消恢复滚动位置`);
          }
        });
      } else {
        console.warn(`[showTab] 未找到可滚动元素，无法恢复滚动位置`);
      }
    } else {
      console.log(`[showTab] 没有保存的滚动位置或值无效: ${savedScrollTop}`);
    }
  } else {
    console.log(`[showTab] 缺少必要参数: docId=${docIdForLocalStorage}, tabId=${currentVisibleTabId}`);
  }

  // Call updateReadingProgress after potential scroll restoration and content rendering - CALLING DOCK_LOGIC
  // 延迟调用，确保滚动位置恢复后再更新阅读进度
  setTimeout(() => {
    if (window.DockLogic && typeof window.DockLogic.forceUpdateReadingProgress === 'function') {
      console.log("[showTab] 延迟调用 forceUpdateReadingProgress 更新阅读进度");
      window.DockLogic.forceUpdateReadingProgress();
    }
  }, 300);

  // 新增：每次渲染后都绑定 scroll 事件到正确容器
  if (window.DockLogic && typeof window.DockLogic.bindScrollForCurrentScrollable === 'function') {
    window.DockLogic.bindScrollForCurrentScrollable();
  }
  // 性能测试断点 - 总渲染结束
  console.timeEnd('[性能] showTab_总渲染');
}

