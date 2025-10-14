// js/ui/glossary-ui.js (multi-sets)

(function() {
  function el(id) { return document.getElementById(id); }
  function escapeHtml(str) { return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;'); }

  function normalizeTermForMatch(term) {
    return String(term || '').trim().toLowerCase();
  }

  function buildSimpleTextFromEntries(entries) {
    if (!Array.isArray(entries) || entries.length === 0) return '';
    return entries.map(item => {
      const cols = [item.term || '', item.translation || ''];
      const extras = [item.caseSensitive ? '1' : '0', item.wholeWord ? '1' : '0', item.enabled === false ? '0' : '1'];
      const defaults = ['0', '0', '1'];
      let len = extras.length;
      while (len > 0 && extras[len - 1] === defaults[len - 1]) len--;
      return cols.concat(extras.slice(0, len)).join('\t');
    }).join('\n');
  }

  function parseTMXFormat(xmlText) {
    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
      const parseError = xmlDoc.querySelector('parsererror');
      if (parseError) throw new Error('XML 解析失败');

      const tuNodes = xmlDoc.querySelectorAll('tu');
      const entries = [];

      tuNodes.forEach(tu => {
        const tuvs = tu.querySelectorAll('tuv');
        if (tuvs.length < 2) return;

        let sourceTerm = '';
        let targetTerm = '';

        tuvs.forEach(tuv => {
          const lang = tuv.getAttribute('xml:lang') || tuv.getAttribute('lang') || '';
          const seg = tuv.querySelector('seg');
          if (!seg) return;

          const text = seg.textContent.trim();
          if (!text) return;

          if (lang.toLowerCase().startsWith('en') || lang.toLowerCase().startsWith('zh-hans') === false) {
            if (!sourceTerm) sourceTerm = text;
          } else {
            targetTerm = text;
          }
        });

        if (sourceTerm && targetTerm) {
          entries.push({
            id: generateUUID(),
            term: sourceTerm,
            translation: targetTerm,
            caseSensitive: false,
            wholeWord: false,
            enabled: true
          });
        }
      });

      return { success: true, entries };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }


  function parseTBXFormat(xmlText) {
    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
      const parseError = xmlDoc.querySelector('parsererror');
      if (parseError) throw new Error('XML 解析失败');

      // TBX (TermBase eXchange) 格式
      // 结构: <martif> -> <body> -> <termEntry> -> <langSet> -> <tig> -> <term>
      const termEntries = xmlDoc.querySelectorAll('termEntry');
      const entries = [];

      termEntries.forEach(termEntry => {
        const langSets = termEntry.querySelectorAll('langSet');
        if (langSets.length < 2) return;

        let sourceTerm = '';
        let targetTerm = '';

        langSets.forEach(langSet => {
          const lang = langSet.getAttribute('xml:lang') || '';
          const term = langSet.querySelector('term, tig term, ntig term');
          if (!term) return;

          const text = term.textContent.trim();
          if (!text) return;

          // 简单的语言判断
          if (lang.toLowerCase().startsWith('en') || !sourceTerm) {
            sourceTerm = text;
          } else {
            targetTerm = text;
          }
        });

        if (sourceTerm && targetTerm && sourceTerm !== targetTerm) {
          entries.push({
            id: generateUUID(),
            term: sourceTerm,
            translation: targetTerm,
            caseSensitive: false,
            wholeWord: false,
            enabled: true
          });
        }
      });

      if (entries.length === 0) {
        return { success: false, error: 'TBX 文件中未找到有效的术语条目' };
      }

      return { success: true, entries };
    } catch (err) {
      return { success: false, error: `TBX 解析失败: ${err.message}` };
    }
  }

  function parseCSVFormat(text) {
    // CSV 格式解析（兼容 SDLTB 导出的 CSV）
    const lines = text.trim().split(/\r?\n/);
    if (lines.length === 0) return { success: false, error: 'CSV 文件为空' };

    const entries = [];
    let headerSkipped = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // 简单的 CSV 解析（支持引号包裹的字段）
      const fields = [];
      let field = '';
      let inQuotes = false;

      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          fields.push(field.trim());
          field = '';
        } else {
          field += char;
        }
      }
      fields.push(field.trim());

      // 移除引号
      const cleanFields = fields.map(f => f.replace(/^"(.*)"$/, '$1'));

      // 检测是否为表头（包含 "source" "target" "term" 等关键字）
      if (!headerSkipped && cleanFields.some(f =>
        /^(source|target|term|translation|原文|译文)$/i.test(f.toLowerCase())
      )) {
        headerSkipped = true;
        continue;
      }

      // 至少需要两列
      if (cleanFields.length < 2) continue;

      const term = cleanFields[0] || '';
      const translation = cleanFields[1] || '';

      if (term && translation) {
        entries.push({
          id: generateUUID(),
          term,
          translation,
          caseSensitive: false,
          wholeWord: false,
          enabled: true
        });
      }
    }

    if (entries.length === 0) {
      return { success: false, error: 'CSV 文件中未找到有效的术语条目' };
    }

    return { success: true, entries };
  }

  function parseSimpleGlossaryText(text) {
    const raw = String(text || '');
    const trimmed = raw.trim();
    const result = {
      rawLineCount: 0,
      entries: [],
      duplicates: [],
      invalidLines: [],
      errorMessage: ''
    };

    if (!trimmed) return result;

    if (trimmed.startsWith('<?xml') || trimmed.includes('<tmx')) {
      const tmxResult = parseTMXFormat(trimmed);
      if (!tmxResult.success) {
        result.errorMessage = 'TMX 解析失败：' + tmxResult.error;
        return result;
      }
      const map = new Map();
      const duplicates = [];
      tmxResult.entries.forEach(item => {
        const key = normalizeTermForMatch(item.term);
        if (map.has(key)) duplicates.push(item.term);
        map.set(key, item);
      });
      result.entries = Array.from(map.values());
      result.rawLineCount = tmxResult.entries.length;
      result.duplicates = duplicates;
      return result;
    }

    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsedJson = JSON.parse(trimmed);
        let arr = [];
        if (Array.isArray(parsedJson)) arr = parsedJson;
        else if (parsedJson && Array.isArray(parsedJson.entries)) arr = parsedJson.entries;
        else throw new Error('JSON 中未找到 entries 数组');
        const normalized = normalizeImportedEntries(arr);
        const map = new Map();
        const duplicates = [];
        normalized.forEach(item => {
          const key = normalizeTermForMatch(item.term);
          if (map.has(key)) duplicates.push(item.term);
          map.set(key, { ...item });
        });
        result.entries = Array.from(map.values());
        result.rawLineCount = normalized.length;
        result.duplicates = duplicates;
      } catch (err) {
        result.errorMessage = 'JSON 解析失败：' + (err && err.message ? err.message : String(err));
      }
      return result;
    }

    // 尝试检测是否为 CSV 格式（包含逗号分隔）
    const firstLine = trimmed.split(/\r?\n/)[0];
    const hasCommas = firstLine.includes(',');
    const hasTabs = firstLine.includes('\t');

    if (hasCommas && !hasTabs) {
      // 很可能是 CSV 格式
      const csvResult = parseCSVFormat(trimmed);
      if (csvResult.success) {
        const map = new Map();
        const duplicates = [];
        csvResult.entries.forEach(item => {
          const key = normalizeTermForMatch(item.term);
          if (map.has(key)) duplicates.push(item.term);
          map.set(key, item);
        });
        result.entries = Array.from(map.values());
        result.rawLineCount = csvResult.entries.length;
        result.duplicates = duplicates;
        return result;
      }
    }

    const lines = raw.split(/\r?\n/);
    const trimmedLines = lines.map(line => line.trim()).filter(Boolean);
    const map = new Map();
    const duplicates = [];
    const invalidLines = [];

    trimmedLines.forEach((line, idx) => {
      let cols = line.split('\t');
      if (cols.length === 1) {
        if (line.includes('=>')) cols = line.split('=>');
        else if (line.includes(',')) cols = line.split(',');
      }
      cols = cols.map(part => part.trim());
      const term = cols[0] || '';
      const translation = cols[1] || '';
      if (!term || !translation) {
        invalidLines.push({ index: idx + 1, content: line });
        return;
      }
      const caseSensitive = cols[2] ? ['1','true','yes','y'].includes(cols[2].toLowerCase()) : false;
      const wholeWord = cols[3] ? ['1','true','yes','y'].includes(cols[3].toLowerCase()) : false;
      const enabledVal = cols[4] ? ['1','true','yes','y'].includes(cols[4].toLowerCase()) : true;
      const entry = {
        id: generateUUID(),
        term,
        translation,
        caseSensitive,
        wholeWord,
        enabled: enabledVal
      };
      const key = normalizeTermForMatch(term);
      if (map.has(key)) duplicates.push(term);
      map.set(key, entry);
    });

    result.rawLineCount = trimmedLines.length;
    result.entries = Array.from(map.values());
    result.duplicates = duplicates;
    result.invalidLines = invalidLines;
    return result;
  }

  function normalizeImportedEntries(arr) {
    return (Array.isArray(arr) ? arr : []).map(item => ({
      id: generateUUID(),
      term: String(item.term || '').trim(),
      translation: String(item.translation || '').trim(),
      caseSensitive: !!item.caseSensitive,
      wholeWord: !!item.wholeWord,
      enabled: item.enabled === undefined ? true : !!item.enabled
    })).filter(it => it.term && it.translation);
  }

  function createGlossaryModal(title) {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-[10000] bg-slate-900/45 backdrop-blur-sm flex items-center justify-center p-4';

    const card = document.createElement('div');
    card.className = 'w-full max-w-4xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col';

    const header = document.createElement('div');
    header.className = 'flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50';
    const titleEl = document.createElement('h3');
    titleEl.className = 'text-lg font-semibold text-slate-800';
    titleEl.textContent = title;
    const closeBtn = document.createElement('button');
    closeBtn.className = 'text-slate-500 hover:text-slate-800 transition-colors';
    closeBtn.innerHTML = '<iconify-icon icon="carbon:close" width="20"></iconify-icon>';
    header.appendChild(titleEl);
    header.appendChild(closeBtn);

    const body = document.createElement('div');
    body.className = 'px-6 py-5 overflow-y-auto max-h-[70vh] space-y-4';

    card.appendChild(header);
    card.appendChild(body);
    overlay.appendChild(card);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.body.appendChild(overlay);

    function close() {
      overlay.remove();
      document.body.style.overflow = previousOverflow;
    }

    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    return { overlay, card, body, close };
  }

  function openGlossaryExportModal(setId) {
    const sets = loadGlossarySets();
    const target = sets[setId];
    if (!target) { showNotification && showNotification('找不到对应术语库', 'error'); return; }
    const entries = Array.isArray(target.entries) ? target.entries : [];
    const simpleText = buildSimpleTextFromEntries(entries);
    const jsonText = JSON.stringify(entries, null, 2);

    const modal = createGlossaryModal('导出术语库');
    const info = document.createElement('div');
    info.className = 'text-sm text-slate-600 leading-relaxed';
    info.innerHTML = `<p>当前术语库 <span class="font-semibold text-slate-800">${escapeHtml(target.name || '')}</span> 共 <span class="font-semibold">${entries.length}</span> 条词条。可复制下方简易文本或下载 JSON。</p>`;

    const textareaWrap = document.createElement('div');
    const textareaLabel = document.createElement('label');
    textareaLabel.className = 'block text-sm font-medium text-slate-600 mb-2';
    textareaLabel.textContent = '简易文本（术语[TAB]译文 ...）';
    const textarea = document.createElement('textarea');
    textarea.className = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm leading-relaxed focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-200 transition';
    textarea.rows = 10;
    textarea.value = simpleText;
    textareaWrap.appendChild(textareaLabel);
    textareaWrap.appendChild(textarea);

    const details = document.createElement('details');
    details.className = 'border border-slate-200 rounded-xl bg-slate-50/60';
    const summary = document.createElement('summary');
    summary.className = 'cursor-pointer px-4 py-2 text-sm font-medium text-slate-700';
    summary.textContent = '查看 JSON 格式';
    const pre = document.createElement('pre');
    pre.className = 'px-4 py-3 text-xs text-slate-600 overflow-x-auto whitespace-pre-wrap';
    pre.textContent = jsonText;
    details.appendChild(summary);
    details.appendChild(pre);

    const btnRow = document.createElement('div');
    btnRow.className = 'flex flex-wrap items-center justify-between gap-3 pt-2';
    const leftHint = document.createElement('div');
    leftHint.className = 'text-xs text-slate-500';
    leftHint.textContent = '提示：简易文本可直接粘贴到导入面板，JSON 适合备份。';
    const btnGroup = document.createElement('div');
    btnGroup.className = 'flex flex-wrap gap-2';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 bg-white text-sm hover:border-blue-300 hover:text-blue-600 transition';
    copyBtn.innerHTML = '<iconify-icon icon="carbon:copy" width="16"></iconify-icon>复制文本';
    copyBtn.addEventListener('click', async () => {
      try {
        if (navigator.clipboard) await navigator.clipboard.writeText(textarea.value || '');
        else { textarea.select(); document.execCommand('copy'); }
        showNotification && showNotification('已复制到剪贴板', 'success');
      } catch (err) {
        showNotification && showNotification('复制失败，请手动复制', 'warning');
      }
    });

    const downloadTextBtn = document.createElement('button');
    downloadTextBtn.type = 'button';
    downloadTextBtn.className = 'inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 bg-white text-sm hover:border-blue-300 hover:text-blue-600 transition';
    downloadTextBtn.innerHTML = '<iconify-icon icon="carbon:download" width="16"></iconify-icon>下载 TXT';
    downloadTextBtn.addEventListener('click', () => {
      const blob = new Blob([textarea.value || ''], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'glossary.txt';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });

    const downloadJsonBtn = document.createElement('button');
    downloadJsonBtn.type = 'button';
    downloadJsonBtn.className = 'inline-flex items-center gap-1 rounded-lg border border-blue-500 px-3 py-1.5 bg-blue-50 text-sm text-blue-600 hover:border-blue-600 hover:bg-blue-100 transition';
    downloadJsonBtn.innerHTML = '<iconify-icon icon="carbon:document-export" width="16"></iconify-icon>下载 JSON';
    downloadJsonBtn.addEventListener('click', () => {
      const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'glossary-entries.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 bg-white text-sm hover:border-slate-300 transition';
    closeBtn.innerHTML = '<iconify-icon icon="carbon:close" width="16"></iconify-icon>关闭';
    closeBtn.addEventListener('click', () => modal.close());

    btnGroup.appendChild(copyBtn);
    btnGroup.appendChild(downloadTextBtn);
    btnGroup.appendChild(downloadJsonBtn);
    btnGroup.appendChild(closeBtn);
    btnRow.appendChild(leftHint);
    btnRow.appendChild(btnGroup);

    modal.body.appendChild(info);
    modal.body.appendChild(textareaWrap);
    modal.body.appendChild(details);
    modal.body.appendChild(btnRow);
  }

  function openGlossaryImportModal(setId) {
    const sets = loadGlossarySets();
    const target = sets[setId];
    if (!target) { showNotification && showNotification('找不到对应术语库', 'error'); return; }
    const existingEntries = Array.isArray(target.entries) ? target.entries : [];

    const modal = createGlossaryModal('导入术语库');
    const intro = document.createElement('div');
    intro.className = 'text-sm text-slate-600 leading-relaxed space-y-2';
    intro.innerHTML = `
      <p>支持五种格式：<strong>CSV</strong>（逗号分隔）、<strong>简易文本</strong>（TAB 分隔）、<strong>JSON</strong>、<strong>TMX</strong>（Translation Memory eXchange）、<strong>TBX</strong>（TermBase eXchange）。导入前可预览冲突并逐条决定保留现有或采用新词条。</p>
      <p class="text-xs text-slate-500">提示：可直接粘贴文本/JSON/TMX/TBX/CSV，或上传文件</p>`;

    // 添加文件上传区域
    const fileUploadArea = document.createElement('div');
    fileUploadArea.className = 'rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/50 p-4 text-center';
    fileUploadArea.innerHTML = `
      <div class="flex flex-col items-center gap-2">
        <iconify-icon icon="carbon:document-import" width="32" class="text-slate-400"></iconify-icon>
        <div class="text-sm text-slate-600">
          <label class="cursor-pointer text-blue-600 hover:text-blue-700 font-medium">
            点击上传文件
            <input type="file" accept=".csv,.tmx,.tbx,.txt,.json,.xml" class="hidden" id="glossaryFileInput">
          </label>
          或拖拽文件到此处
        </div>
        <div class="text-xs text-slate-400">支持: .csv, .tmx, .tbx, .txt, .json, .xml</div>
      </div>
    `;

    const textarea = document.createElement('textarea');
    textarea.className = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm leading-relaxed focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-200 transition';
    textarea.rows = 8;
    textarea.placeholder = '或直接粘贴术语文本、JSON、TMX 内容...';

    const actionRow = document.createElement('div');
    actionRow.className = 'flex flex-wrap items-center justify-between gap-3';
    const hint = document.createElement('div');
    hint.className = 'text-xs text-slate-500';
    hint.textContent = `当前术语库共有 ${existingEntries.length} 条，导入时可选择覆盖冲突条目。`;
    const btnGroup = document.createElement('div');
    btnGroup.className = 'flex flex-wrap gap-2';

    const previewBtn = document.createElement('button');
    previewBtn.type = 'button';
    previewBtn.className = 'inline-flex items-center gap-1 rounded-lg border border-blue-500 px-3 py-1.5 text-sm text-blue-600 bg-blue-50 hover:border-blue-600 hover:bg-blue-100 transition';
    previewBtn.innerHTML = '<iconify-icon icon="carbon:result" width="16"></iconify-icon>解析文本';

    const applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.className = 'inline-flex items-center gap-1 rounded-lg border border-green-500 px-3 py-1.5 text-sm text-white bg-green-500 hover:bg-green-600 disabled:bg-slate-200 disabled:border-slate-200 disabled:text-slate-400 transition';
    applyBtn.innerHTML = '<iconify-icon icon="carbon:checkmark" width="16"></iconify-icon>确认导入';
    applyBtn.disabled = true;

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm bg-white hover:border-slate-300 transition';
    cancelBtn.innerHTML = '<iconify-icon icon="carbon:close" width="16"></iconify-icon>取消';
    cancelBtn.addEventListener('click', () => modal.close());

    btnGroup.appendChild(previewBtn);
    btnGroup.appendChild(applyBtn);
    btnGroup.appendChild(cancelBtn);
    actionRow.appendChild(hint);
    actionRow.appendChild(btnGroup);

    const previewArea = document.createElement('div');
    previewArea.className = 'space-y-4';

    modal.body.appendChild(intro);
    modal.body.appendChild(fileUploadArea);
    modal.body.appendChild(textarea);
    modal.body.appendChild(actionRow);
    modal.body.appendChild(previewArea);

    const state = {
      setId,
      parseResult: null,
      conflicts: [],
      conflictChoices: new Map(),
      nonConflictEntries: [],
      incomingCount: 0,
      originalEntries: existingEntries
    };

    // 文件上传处理
    const fileInput = modal.body.querySelector('#glossaryFileInput');
    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const fileName = file.name.toLowerCase();
      try {
        if (fileName.endsWith('.tbx') || fileName.endsWith('.xml')) {
          // 处理 TBX/XML 文件
          const text = await file.text();
          const result = parseTBXFormat(text);
          if (!result.success) {
            // 如果 TBX 解析失败，尝试作为普通 TMX/文本解析
            textarea.value = text;
            state.parseResult = parseSimpleGlossaryText(text);
          } else {
            state.parseResult = {
              rawLineCount: result.entries.length,
              entries: result.entries,
              duplicates: [],
              invalidLines: [],
              errorMessage: ''
            };
          }
        } else if (fileName.endsWith('.csv')) {
          // 处理 CSV 文件
          const text = await file.text();
          const result = parseCSVFormat(text);
          if (!result.success) {
            showNotification && showNotification(result.error, 'error');
            return;
          }
          state.parseResult = {
            rawLineCount: result.entries.length,
            entries: result.entries,
            duplicates: [],
            invalidLines: [],
            errorMessage: ''
          };
        } else {
          // TMX/TXT/JSON 文本文件
          const text = await file.text();
          textarea.value = text;
          state.parseResult = parseSimpleGlossaryText(text);
        }

        // 自动触发预览
        analyzeAndPreview();
      } catch (err) {
        showNotification && showNotification('文件读取失败: ' + err.message, 'error');
      }
    });

    // 拖拽上传
    fileUploadArea.addEventListener('dragover', (e) => {
      e.preventDefault();
      fileUploadArea.classList.add('border-blue-400', 'bg-blue-50');
    });
    fileUploadArea.addEventListener('dragleave', () => {
      fileUploadArea.classList.remove('border-blue-400', 'bg-blue-50');
    });
    fileUploadArea.addEventListener('drop', async (e) => {
      e.preventDefault();
      fileUploadArea.classList.remove('border-blue-400', 'bg-blue-50');
      const file = e.dataTransfer.files[0];
      if (file) {
        fileInput.files = e.dataTransfer.files;
        fileInput.dispatchEvent(new Event('change'));
      }
    });

    function renderConflictPreview() {
      const pr = state.parseResult;
      previewArea.innerHTML = '';
      if (!pr) return;

      if (pr.errorMessage) {
        const errorBox = document.createElement('div');
        errorBox.className = 'rounded-xl border border-red-200 bg-red-50/80 text-red-600 text-sm px-4 py-3';
        errorBox.innerHTML = `<div class="font-semibold mb-1">解析失败</div><div>${escapeHtml(pr.errorMessage)}</div>`;
        previewArea.appendChild(errorBox);
        return;
      }

      if (pr.entries.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'rounded-xl border border-slate-200 bg-white px-4 py-4 text-sm text-slate-600 text-center';
        empty.innerHTML = '<iconify-icon icon="carbon:information" class="text-slate-400" width="18"></iconify-icon><span class="ml-2">未解析到有效术语，请检查文本格式。</span>';
        previewArea.appendChild(empty);
        applyBtn.disabled = true;
        applyBtn.innerHTML = '<iconify-icon icon="carbon:checkmark" width="16"></iconify-icon>确认导入';
        return;
      }

      if (pr.invalidLines.length > 0) {
        const warn = document.createElement('div');
        warn.className = 'rounded-xl border border-amber-200 bg-amber-50/80 text-amber-700 text-sm px-4 py-3';
        const list = pr.invalidLines.map(item => `<li>第 ${item.index} 行：${escapeHtml(item.content)}</li>`).join('');
        warn.innerHTML = `<div class="font-semibold mb-1">已忽略 ${pr.invalidLines.length} 行格式不正确的记录</div><ul class="list-disc list-inside space-y-0.5">${list}</ul>`;
        previewArea.appendChild(warn);
      }

      if (pr.duplicates.length > 0) {
        const dup = document.createElement('div');
        dup.className = 'rounded-xl border border-indigo-200 bg-indigo-50/80 text-indigo-700 text-sm px-4 py-3';
        const uniq = Array.from(new Set(pr.duplicates.map(t => t.trim()).filter(Boolean)));
        dup.innerHTML = `<div class="font-semibold mb-1">导入文本内存在重复术语，已保留最后一次出现</div><div class="text-xs mt-1">${uniq.map(t => escapeHtml(t)).join('、')}</div>`;
        previewArea.appendChild(dup);
      }

      const summary = document.createElement('div');
      summary.className = 'rounded-xl border border-slate-200 bg-white shadow-sm px-4 py-3 text-sm text-slate-600 flex flex-col gap-1';
      summary.innerHTML = `
        <div>有效条目：<strong class="text-slate-800">${state.incomingCount}</strong> 条</div>
        <div>新增：<strong class="text-emerald-600">${state.nonConflictEntries.length}</strong> 条，冲突：<strong class="text-amber-600">${state.conflicts.length}</strong> 条</div>`;
      previewArea.appendChild(summary);

      if (state.conflicts.length > 0) {
        const card = document.createElement('div');
        card.className = 'rounded-2xl border-2 border-dashed border-amber-200 bg-amber-50/60 p-4 space-y-4';
        const header = document.createElement('div');
        header.className = 'flex flex-col md:flex-row md:items-center md:justify-between gap-3';
        header.innerHTML = `
          <div class="text-sm font-semibold text-amber-700 flex items-center gap-2">
            <iconify-icon icon="carbon:warning" width="18"></iconify-icon>
            <span>检测到 ${state.conflicts.length} 条冲突项</span>
          </div>`;
        const actionBtns = document.createElement('div');
        actionBtns.className = 'flex flex-wrap gap-2 text-xs';
        const useNewBtn = document.createElement('button');
        useNewBtn.type = 'button';
        useNewBtn.className = 'inline-flex items-center gap-1 rounded-lg border border-emerald-400 px-3 py-1 bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition';
        useNewBtn.innerHTML = '<iconify-icon icon="carbon:checkmark" width="14"></iconify-icon>全部使用导入版本';
        const useOldBtn = document.createElement('button');
        useOldBtn.type = 'button';
        useOldBtn.className = 'inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1 bg-white text-slate-600 hover:border-slate-400 transition';
        useOldBtn.innerHTML = '<iconify-icon icon="carbon:renew" width="14"></iconify-icon>全部保留现有版本';
        actionBtns.appendChild(useNewBtn);
        actionBtns.appendChild(useOldBtn);
        header.appendChild(actionBtns);
        card.appendChild(header);

        const list = document.createElement('div');
        list.className = 'space-y-3';
        state.conflicts.forEach((conflict, idx) => {
          const choice = state.conflictChoices.get(conflict.key) || 'new';
          const item = document.createElement('div');
          item.className = 'rounded-xl border border-amber-200 bg-white px-4 py-3 space-y-3 shadow-sm';
          item.innerHTML = `
            <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div class="text-sm font-semibold text-slate-700">${escapeHtml(conflict.term)}</div>
              <div class="flex flex-wrap gap-2 text-xs">
                <label class="inline-flex items-center gap-1 rounded-full border ${choice==='old' ? 'border-slate-400 bg-slate-100 text-slate-700' : 'border-slate-200 bg-white text-slate-500'} px-3 py-1 transition">
                  <input type="radio" class="hidden" name="conflict-${idx}" data-conflict-key="${conflict.key}" value="old" ${choice==='old'?'checked':''}>
                  <span>保留现有</span>
                </label>
                <label class="inline-flex items-center gap-1 rounded-full border ${choice==='new' ? 'border-emerald-400 bg-emerald-100 text-emerald-700' : 'border-slate-200 bg-white text-slate-500'} px-3 py-1 transition">
                  <input type="radio" class="hidden" name="conflict-${idx}" data-conflict-key="${conflict.key}" value="new" ${choice==='new'?'checked':''}>
                  <span>使用导入版本</span>
                </label>
              </div>
            </div>
            <div class="grid md:grid-cols-2 gap-3 text-xs text-slate-600">
              <div class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <div class="font-semibold text-slate-600 mb-1">现有条目</div>
                <div class="leading-relaxed">译文：${escapeHtml(conflict.existing.translation)}</div>
                <div class="mt-1 text-[11px] text-slate-500">大小写敏感：${conflict.existing.caseSensitive ? '是' : '否'} ｜ 全词匹配：${conflict.existing.wholeWord ? '是' : '否'} ｜ 启用：${conflict.existing.enabled === false ? '否' : '是'}</div>
              </div>
              <div class="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                <div class="font-semibold text-emerald-700 mb-1">导入条目</div>
                <div class="leading-relaxed">译文：${escapeHtml(conflict.incoming.translation)}</div>
                <div class="mt-1 text-[11px] text-emerald-600">大小写敏感：${conflict.incoming.caseSensitive ? '是' : '否'} ｜ 全词匹配：${conflict.incoming.wholeWord ? '是' : '否'} ｜ 启用：${conflict.incoming.enabled === false ? '否' : '是'}</div>
              </div>
            </div>`;
          list.appendChild(item);
        });
        card.appendChild(list);
        previewArea.appendChild(card);

        actionBtns.querySelectorAll('button').forEach(btn => {
          btn.addEventListener('click', (evt) => {
            evt.preventDefault();
            const mode = btn === useNewBtn ? 'new' : 'old';
            state.conflicts.forEach(conflict => state.conflictChoices.set(conflict.key, mode));
            renderConflictPreview();
          });
        });

        list.querySelectorAll('input[type="radio"]').forEach(radio => {
          radio.addEventListener('change', () => {
            const key = radio.getAttribute('data-conflict-key');
            const value = radio.value;
            state.conflictChoices.set(key, value);
            renderConflictPreview();
          });
        });
      }
    }

    function analyzeAndPreview() {
      if (!state.parseResult) {
        const text = textarea.value;
        state.parseResult = parseSimpleGlossaryText(text);
      }

      const parsed = state.parseResult;
      state.incomingCount = parsed.entries.length;

      const currentMap = new Map(state.originalEntries.map(item => [normalizeTermForMatch(item.term), item]));
      const conflicts = [];
      const nonConflict = [];
      parsed.entries.forEach(entry => {
        const key = normalizeTermForMatch(entry.term);
        const existing = currentMap.get(key);
        if (existing) conflicts.push({ key, term: entry.term, existing, incoming: entry });
        else nonConflict.push(entry);
      });
      state.conflicts = conflicts;
      state.nonConflictEntries = nonConflict;
      state.conflictChoices = new Map(conflicts.map(c => [c.key, 'new']));

      const canApply = parsed.entries.length > 0 && !parsed.errorMessage;
      applyBtn.disabled = !canApply;
      if (canApply) {
        applyBtn.innerHTML = `<iconify-icon icon="carbon:checkmark" width="16"></iconify-icon>确认导入（${parsed.entries.length} 条）`;
      } else {
        applyBtn.innerHTML = '<iconify-icon icon="carbon:checkmark" width="16"></iconify-icon>确认导入';
      }
      renderConflictPreview();
    }

    previewBtn.addEventListener('click', () => {
      state.parseResult = null; // 重置，强制重新解析
      analyzeAndPreview();
    });

    applyBtn.addEventListener('click', () => {
      if (!state.parseResult || state.parseResult.entries.length === 0 || state.parseResult.errorMessage) return;
      const setsLatest = loadGlossarySets();
      const targetLatest = setsLatest[setId];
      if (!targetLatest) { showNotification && showNotification('术语库已被删除', 'error'); modal.close(); return; }
      const existing = Array.isArray(targetLatest.entries) ? targetLatest.entries : [];
      const result = [];
      const conflictMap = new Map(state.conflicts.map(conflict => [conflict.key, conflict]));
      const choiceMap = state.conflictChoices;

      existing.forEach(item => {
        const key = normalizeTermForMatch(item.term);
        if (conflictMap.has(key)) {
          const conflict = conflictMap.get(key);
          const choice = choiceMap.get(key) || 'new';
          if (choice === 'new') {
            const newEntry = { ...conflict.incoming, id: item.id };
            result.push(newEntry);
          } else {
            result.push(item);
          }
        } else {
          result.push(item);
        }
      });

      state.nonConflictEntries.forEach(entry => {
        result.push({ ...entry });
      });

      targetLatest.entries = result;
      saveGlossarySets(setsLatest);
      renderEntriesTable(setId);
      renderGlossarySetsTable();
      modal.close();
      showNotification && showNotification(`已导入 ${state.parseResult.entries.length} 条术语（新增 ${state.nonConflictEntries.length}，冲突 ${state.conflicts.length}）`, 'success');
    });
  }

  function renderGlossarySetsTable() {
    const container = el('glossarySetsTable');
    if (!container || typeof loadGlossarySets !== 'function') return;
    const sets = loadGlossarySets();
    const ids = Object.keys(sets);
    const hint = el('glossarySetsCountHint');
    const enabledCount = ids.reduce((acc, id) => acc + (sets[id] && sets[id].enabled ? 1 : 0), 0);

    if (hint) {
      if (ids.length === 0) {
        hint.textContent = '暂无术语库';
        hint.classList.add('text-slate-400');
      } else {
        hint.textContent = `启用 ${enabledCount} / ${ids.length}`;
        hint.classList.remove('text-slate-400');
      }
    }

    if (ids.length === 0) {
      container.innerHTML = `
        <div class="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-6 text-center text-sm text-slate-500">
          <iconify-icon icon="carbon:book" width="22" class="mx-auto mb-2 text-slate-400"></iconify-icon>
          <p>暂无术语库，可点击上方按钮快速创建或导入现有 JSON 文件。</p>
        </div>`;
      return;
    }

    const cards = ids.map(id => {
      const s = sets[id];
      const count = Array.isArray(s.entries) ? s.entries.length : 0;
      return `
        <section class="rounded-xl border border-slate-200 bg-white shadow-sm px-4 py-3 md:px-5 md:py-4 transition-all hover:border-blue-200 hover:shadow-md" data-id="${id}">
          <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div class="flex items-start gap-3 flex-1">
              <div class="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-500">
                <iconify-icon icon="carbon:catalog" width="18"></iconify-icon>
              </div>
              <div class="flex-1">
                <input type="text" data-action="rename-set" data-id="${id}" value="${escapeHtml(s.name || '')}" class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-200 transition" placeholder="未命名术语库">
                <div class="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span class="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5">
                    <iconify-icon icon="carbon:data-vis-1" width="14"></iconify-icon>${count} 条词条
                  </span>
                  <span class="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5">ID: ${id.slice(0, 8)}</span>
                </div>
              </div>
            </div>
            <div class="flex flex-col items-start md:items-end gap-2">
              <label class="inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 bg-slate-50">
                <input type="checkbox" data-action="toggle-set" data-id="${id}" ${s.enabled ? 'checked' : ''} class="h-4 w-4 text-blue-600 border-slate-300 rounded">
                <span>${s.enabled ? '已启用' : '未启用'}</span>
              </label>
              <div class="flex flex-wrap gap-2 text-xs">
                <button class="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 hover:border-blue-300 hover:text-blue-600 transition" data-action="edit-set" data-id="${id}">
                  <iconify-icon icon="carbon:edit" width="14"></iconify-icon>编辑
                </button>
                <button class="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 hover:border-blue-300 hover:text-blue-600 transition" data-action="export-set" data-id="${id}">
                  <iconify-icon icon="carbon:export" width="14"></iconify-icon>导出
                </button>
                <button class="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1 text-red-500 hover:border-red-400 hover:bg-red-50 transition" data-action="delete-set" data-id="${id}">
                  <iconify-icon icon="carbon:trash-can" width="14"></iconify-icon>删除
                </button>
              </div>
            </div>
          </div>
        </section>`;
    }).join('');

    container.innerHTML = `<div class="grid gap-3">${cards}</div>`;

    container.querySelectorAll('[data-action="toggle-set"]').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const id = e.target.getAttribute('data-id');
        toggleGlossarySet(id, e.target.checked);
        renderGlossarySetsTable();
      });
    });
    container.querySelectorAll('[data-action="rename-set"]').forEach(inp => {
      const handler = (e) => renameGlossarySet(e.target.getAttribute('data-id'), e.target.value);
      inp.addEventListener('change', handler);
      inp.addEventListener('blur', handler);
    });
    container.querySelectorAll('[data-action="delete-set"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        if (!confirm('确认删除该术语库？此操作不可撤销。')) return;
        deleteGlossarySet(id);
        const panel = el('glossaryEditorPanel');
        if (panel && panel.dataset.editingId === id) { panel.classList.add('hidden'); panel.dataset.editingId = ''; }
        renderGlossarySetsTable();
      });
    });
    container.querySelectorAll('[data-action="export-set"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        const data = exportGlossarySet(id);
        const blob = new Blob([data], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'glossary-set.json';
        document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      });
    });
    container.querySelectorAll('[data-action="edit-set"]').forEach(btn => btn.addEventListener('click', (e) => openEditorForSet(e.currentTarget.getAttribute('data-id'))));
  }

  function openEditorForSet(setId) {
    const panel = el('glossaryEditorPanel');
    if (!panel) return;
    panel.classList.remove('hidden');
    panel.dataset.editingId = setId;
    renderEntriesTable(setId);
  }

  function renderEntriesTable(setId) {
    const wrap = el('glossaryEntriesTable');
    if (!wrap) return;
    const sets = loadGlossarySets();
    const s = sets[setId];
    if (!s) { wrap.innerHTML = '<div class="rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-sm px-3 py-2">术语库不存在，可能已被删除。</div>'; return; }
    const entries = Array.isArray(s.entries) ? s.entries : [];

    const rows = entries.map(e => `
      <tr class="border-b last:border-0 hover:bg-slate-50/70 transition">
        <td class="px-3 py-2 align-top">
          <input type="text" data-row="${e.id}" data-col="term" class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-200 transition" value="${escapeHtml(e.term)}" placeholder="术语或词组">
        </td>
        <td class="px-3 py-2 align-top">
          <textarea data-row="${e.id}" data-col="translation" class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm leading-relaxed focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-200 transition" rows="2" placeholder="对应译文">${escapeHtml(e.translation)}</textarea>
        </td>
        <td class="px-3 py-2 text-center">
          <input type="checkbox" data-row="${e.id}" data-col="caseSensitive" ${e.caseSensitive?'checked':''} class="h-4 w-4 text-blue-600 border-slate-300 rounded">
        </td>
        <td class="px-3 py-2 text-center">
          <input type="checkbox" data-row="${e.id}" data-col="wholeWord" ${e.wholeWord?'checked':''} class="h-4 w-4 text-blue-600 border-slate-300 rounded">
        </td>
        <td class="px-3 py-2 text-center">
          <input type="checkbox" data-row="${e.id}" data-col="enabled" ${e.enabled!==false?'checked':''} class="h-4 w-4 text-blue-600 border-slate-300 rounded">
        </td>
        <td class="px-3 py-2 text-right">
          <button class="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2 py-1 text-xs text-red-500 hover:border-red-400 hover:bg-red-50 transition" data-action="del-entry" data-row="${e.id}">
            <iconify-icon icon="carbon:trash-can" width="14"></iconify-icon>删除
          </button>
        </td>
      </tr>
    `).join('');

    wrap.innerHTML = `
      <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
        <div class="text-sm font-medium text-slate-700">当前术语库：${escapeHtml(s.name || '')}（${entries.length} 条）</div>
        <div class="flex flex-wrap items-center gap-2 text-xs">
          <button id="addEntryBtn" class="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 bg-white hover:border-blue-300 hover:text-blue-600 transition">
            <iconify-icon icon="carbon:add-alt" width="14"></iconify-icon>新增词条
          </button>
          <button id="importEntriesBtn" class="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 bg-white hover:border-blue-300 hover:text-blue-600 transition">
            <iconify-icon icon="carbon:import" width="14"></iconify-icon>导入
          </button>
          <button id="exportEntriesBtn" class="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 bg-white hover:border-blue-300 hover:text-blue-600 transition">
            <iconify-icon icon="carbon:export" width="14"></iconify-icon>导出
          </button>
        </div>
      </div>
      <div class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table class="min-w-full text-sm text-slate-700">
          <thead class="bg-slate-100 text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th class="px-3 py-2 text-left">术语/词组</th>
              <th class="px-3 py-2 text-left">译文</th>
              <th class="px-3 py-2 text-center">大小写敏感</th>
              <th class="px-3 py-2 text-center">全词匹配</th>
              <th class="px-3 py-2 text-center">启用</th>
              <th class="px-3 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="6" class="px-6 py-6 text-center text-sm text-slate-400">暂无词条，请先新增或导入。</td></tr>'}</tbody>
        </table>
      </div>
    `;

    wrap.querySelectorAll('input[data-row][data-col], textarea[data-row][data-col]').forEach(inp => {
      const handler = () => {
        const row = inp.getAttribute('data-row');
        const col = inp.getAttribute('data-col');
        const sets2 = loadGlossarySets();
        const s2 = sets2[setId];
        if (!s2) return;
        const idx = s2.entries.findIndex(x => x.id === row);
        if (idx === -1) return;
        let val;
        if (inp.type === 'checkbox') {
          val = inp.checked;
        } else {
          val = inp.value;
        }
        s2.entries[idx][col] = val;
        saveGlossarySets(sets2);
      };
      inp.addEventListener('change', handler);
      if (inp.type !== 'checkbox') inp.addEventListener('input', handler);
    });

    wrap.querySelectorAll('[data-action="del-entry"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const row = btn.getAttribute('data-row');
        const sets2 = loadGlossarySets();
        const s2 = sets2[setId];
        if (!s2) return;
        s2.entries = s2.entries.filter(x => x.id !== row);
        saveGlossarySets(sets2);
        renderEntriesTable(setId);
      });
    });

    const addBtn = el('addEntryBtn');
    if (addBtn) addBtn.addEventListener('click', () => {
      const sets2 = loadGlossarySets();
      const s2 = sets2[setId];
      s2.entries.push({ id: generateUUID(), term: '', translation: '', caseSensitive: false, wholeWord: false, enabled: true });
      saveGlossarySets(sets2);
      renderEntriesTable(setId);
    });

    const importBtn = el('importEntriesBtn');
    if (importBtn) importBtn.addEventListener('click', () => openGlossaryImportModal(setId));

    const exportBtn = el('exportEntriesBtn');
    if (exportBtn) exportBtn.addEventListener('click', () => openGlossaryExportModal(setId));
  }

  function bindTopControls() {
    const addSetBtn = el('addGlossarySetBtn');
    if (addSetBtn) addSetBtn.addEventListener('click', () => {
      const s = prompt('输入术语库名称', '新术语库');
      if (s === null) return;
      createGlossarySet(s || '新术语库');
      renderGlossarySetsTable();
    });

    const importSetBtn = el('importGlossarySetBtn');
    const importSetFile = el('importGlossarySetFile');
    if (importSetBtn && importSetFile) {
      importSetBtn.addEventListener('click', () => importSetFile.click());
      importSetFile.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          try { importGlossarySet(String(reader.result || '{}')); renderGlossarySetsTable(); showNotification && showNotification('术语库已导入', 'success'); }
          catch (err) { showNotification && showNotification(`导入失败：${err.message}`, 'error'); }
        };
        reader.readAsText(file);
        importSetFile.value = '';
      });
    }

    const exportAllBtn = el('exportAllGlossarySetsBtn');
    if (exportAllBtn) exportAllBtn.addEventListener('click', () => {
      const data = exportAllGlossarySets();
      const blob = new Blob([data], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'glossary-sets.json';
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    });
  }

  window.glossaryUI = { renderGlossarySetsTable, openEditorForSet, renderEntriesTable };

  document.addEventListener('DOMContentLoaded', function() { renderGlossarySetsTable(); bindTopControls(); });
})();
