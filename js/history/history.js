// js/history.js

// =====================
// 历史记录面板相关逻辑
// =====================

/**
 * 当 HTML 文档完全加载并解析完成后，执行此函数。
 * 主要负责初始化历史记录面板的用户交互：
 *  - 为"显示历史"按钮绑定点击事件，用于打开历史面板并渲染历史列表。
 *  - 为"关闭历史面板"按钮绑定点击事件。
 *  - 为"清空历史记录"按钮绑定点击事件，并在用户确认后清空所有历史数据并刷新列表。
 */
document.addEventListener('DOMContentLoaded', function() {
    // 显示历史面板并渲染历史列表
    document.getElementById('showHistoryBtn').onclick = async function() {
        document.getElementById('historyPanel').classList.remove('hidden');
        await renderHistoryList();
    };
    // 关闭历史面板
    document.getElementById('closeHistoryPanel').onclick = function() {
        document.getElementById('historyPanel').classList.add('hidden');
    };
    // 清空所有历史记录
    document.getElementById('clearHistoryBtn').onclick = async function() {
        if (confirm('确定要清空所有历史记录吗？')) {
            await clearAllResultsFromDB();
            await renderHistoryList();
        }
    };

    // ---------------------
    // 历史记录列表渲染
    // ---------------------
    /**
     * 从 IndexedDB 加载所有历史记录，并将其渲染到历史记录面板的列表中。
     *
     * 主要步骤:
     * 1. 获取用于显示历史列表的 DOM 元素 (`#historyList`)。
     * 2. 调用 `getAllResultsFromDB()` 从 IndexedDB 异步获取所有存储的处理结果。
     * 3. 检查结果：如果无历史记录，则在列表区域显示"暂无历史记录"的提示。
     * 4. 排序：将获取到的历史记录按处理时间 (`time` 字段) 降序排列 (最新的在前)。
     * 5. 生成 HTML：遍历排序后的结果数组，为每条记录生成一个 HTML 片段，
     *    包含文件名、删除按钮、时间戳、OCR 和翻译内容的摘要、以及"查看详情"和"下载"按钮。
     *    每个按钮都绑定了相应的 `window` 上的全局函数 (如 `deleteHistoryRecord`, `showHistoryDetail`, `downloadHistoryRecord`)。
     * 6. 更新 DOM：将生成的 HTML 字符串集合设置为 `#historyList` 的 `innerHTML`。
     *
     * @async
     * @private
     * @returns {Promise<void>} 当列表渲染完成时解决。
     */
    async function renderHistoryList() {
        const listDiv = document.getElementById('historyList');
        const results = await getAllResultsFromDB();
        if (!results || results.length === 0) {
            listDiv.innerHTML = '<div class="text-gray-400 text-center py-8">暂无历史记录</div>';
            return;
        }
        // 按时间倒序排列
        results.sort((a, b) => new Date(b.time) - new Date(a.time));
        listDiv.innerHTML = results.map(r => {
            const totalChunks = Array.isArray(r.ocrChunks) ? r.ocrChunks.length : 0;
            const translatedChunks = Array.isArray(r.translatedChunks) ? r.translatedChunks : [];
            const { successCount, failedCount } = (function analyze() {
                let success = 0, failed = 0;
                if (totalChunks === 0) return { successCount: 0, failedCount: 0 };
                for (let i = 0; i < totalChunks; i++) {
                    const t = translatedChunks[i] || '';
                    if (_isChunkFailed(t)) {
                        failed++;
                    } else {
                        success++;
                    }
                }
                return { successCount: success, failedCount: failed };
            })();
            const statusBadge = totalChunks > 0
                ? (failedCount > 0
                    ? `<span class="ml-2 inline-block text-xs px-2 py-0.5 rounded bg-yellow-100 text-yellow-700">部分失败 ${failedCount}/${totalChunks}</span>`
                    : `<span class="ml-2 inline-block text-xs px-2 py-0.5 rounded bg-green-100 text-green-700">完成 ${successCount}/${totalChunks}</span>`)
                : `<span class="ml-2 inline-block text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-500">未分块</span>`;

            const disableRetryFailed = failedCount === 0 ? 'disabled opacity-50 cursor-not-allowed' : '';

            return `
            <div class="border-b py-2" id="history-item-${r.id.replace(/[^a-zA-Z0-9_-]/g,'_')}">
                <div class="flex justify-between items-center">
                    <span class="font-semibold flex items-center">${r.name}${statusBadge}</span>
                    <button onclick="deleteHistoryRecord('${r.id}')" class="text-xs text-red-400 hover:text-red-600">删除</button>
                </div>
                <div class="text-xs text-gray-500">时间: ${new Date(r.time).toLocaleString()}</div>
                <div class="text-xs text-gray-500">OCR: ${r.ocr ? r.ocr.slice(0, 40).replace(/\\n/g, ' ') + (r.ocr.length > 40 ? '...' : '') : '无'}</div>
                <div class="text-xs text-gray-500">翻译: ${r.translation ? r.translation.slice(0, 40).replace(/\\n/g, ' ') + (r.translation.length > 40 ? '...' : '') : '无'}</div>
                <div class="mt-2 flex items-center flex-wrap gap-2">
                  <button onclick="showHistoryDetail('${r.id}')" class="text-blue-600 text-xs hover:underline">查看详情</button>
                  <button onclick="downloadHistoryRecord('${r.id}')" class="text-green-600 text-xs hover:underline">下载</button>
                  <span class="mx-1 text-gray-300">|</span>
                  <button id="retry-failed-btn-${r.id}" onclick="retryTranslateRecord('${r.id}','failed')" class="text-xs px-2 py-1 border rounded hover:bg-gray-50 ${disableRetryFailed}">重试失败段</button>
                  <button id="retry-all-btn-${r.id}" onclick="retryTranslateRecord('${r.id}','all')" class="text-xs px-2 py-1 border rounded hover:bg-gray-50">重新翻译全部</button>
                  <span id="retry-status-${r.id}" class="text-xs text-gray-500"></span>
                </div>
            </div>`;
        }).join('');
    }

    // ---------------------
    // 历史记录操作（删除/查看/下载）
    // ---------------------

    /**
     * (全局可调用) 删除指定 ID 的单条历史记录。
     * 操作完成后会重新渲染历史记录列表以反映更改。
     *
     * @async
     * @param {string} id - 要删除的历史记录的唯一 ID (通常是 `result.id`)。
     * @returns {Promise<void>} 当删除和列表刷新完成后解决。
     */
    window.deleteHistoryRecord = async function(id) {
        await deleteResultFromDB(id);
        await renderHistoryList();
    };

    /**
     * (全局可调用) 在新的浏览器标签页或窗口中显示指定历史记录的详细信息。
     * 它通过构建一个指向 `views/history/history_detail.html` 的 URL (包含记录 ID 作为查询参数) 并使用 `window.open` 实现。
     *
     * @param {string} id - 要查看详情的历史记录的唯一 ID。
     */
    window.showHistoryDetail = function(id) {
        window.open('views/history/history_detail.html?id=' + encodeURIComponent(id), '_blank');
    };

    /**
     * (全局可调用) 将指定 ID 的单条历史记录打包成一个 ZIP 文件并触发浏览器下载。
     * ZIP 包中将包含：
     *  - `document.md`: 包含原始 OCR 文本（如果存在）。
     *  - `translation.md`: 包含翻译后的文本（如果存在）。
     *  - `images/` 文件夹: 包含处理过程中提取的所有图片 (PNG格式，从 Base64 数据转换)。
     *
     * 主要步骤:
     * 1. 从 IndexedDB 获取指定 ID 的历史记录数据。
     * 2. 检查 JSZip库是否已加载，未加载则提示错误。
     * 3. 创建一个新的 JSZip 实例。
     * 4. 根据记录名创建一个顶层文件夹（文件名中的非法字符会被替换）。
     * 5. 将 OCR 文本和翻译文本（如果存在）分别存为 Markdown 文件。
     * 6. 如果存在图片数据 (`r.images`)，则创建一个 `images` 子文件夹，并将每张图片（Base64编码）
     *    解码后以 PNG 格式存入该子文件夹。
     * 7. 使用 JSZip 生成 ZIP 文件的 Blob 数据 (DEFLATE 压缩)。
     * 8. 构建文件名 (包含原始文件名和时间戳) 并使用 `saveAs` (FileSaver.js) 触发下载。
     *
     * @async
     * @param {string} id - 要下载的历史记录的唯一 ID。
     * @returns {Promise<void>} 当 ZIP 文件准备好并开始下载时解决，或在发生错误时提前返回。
     */
    window.downloadHistoryRecord = async function(id) {
        const r = await getResultFromDB(id);
        if (!r) return;
        if (typeof JSZip === 'undefined') {
            alert('JSZip 加载失败，无法打包下载');
            return;
        }
        const zip = new JSZip();
        // 文件夹名处理，去除非法字符
        const folder = zip.folder(r.name.replace(/\.pdf$/i, '').replace(/[/\\:*?"<>|]/g, '_').substring(0, 100));
        folder.file('document.md', r.ocr || '');
        if (r.translation) folder.file('translation.md', r.translation);
        if (r.images && r.images.length > 0) {
            const imagesFolder = folder.folder('images');
            for (const img of r.images) {
                // 处理base64图片数据
                const base64Data = img.data.includes(',') ? img.data.split(',')[1] : img.data;
                if (base64Data) {
                    imagesFolder.file(`${img.id}.png`, base64Data, { base64: true });
                }
            }
        }
        // 生成zip并下载
        const zipBlob = await zip.generateAsync({ type: 'blob', compression: "DEFLATE", compressionOptions: { level: 6 } });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        saveAs(zipBlob, `PaperBurner_${r.name}_${timestamp}.zip`);
    };

    // ---------------------
    // 重新翻译（全部/失败段）
    // ---------------------

    function _isChunkFailed(text) {
        if (text == null) return true;
        let t = String(text).trim();
        if (!t) return true;
        // 取首行，规避后续原文内容干扰
        const firstLine = t.split('\n', 1)[0];
        // 去除常见 Markdown 前缀（引用符、粗体符号等）
        let norm = firstLine.replace(/^>+\s*/, '').trim();
        norm = norm.replace(/^\*\*(.*)\*\*$/,'$1').trim();
        // 识别多种失败提示格式
        if (/^\[(?:翻译失败|处理错误|翻译错误|翻译意外失败)/i.test(norm)) return true;
        if (/保留原文\s*Part/i.test(norm)) return true;
        return false;
    }

    function _setBusy(id, busy, msg = '') {
        const failedBtn = document.getElementById(`retry-failed-btn-${id}`);
        const allBtn = document.getElementById(`retry-all-btn-${id}`);
        const statusEl = document.getElementById(`retry-status-${id}`);
        if (failedBtn) failedBtn.disabled = !!busy;
        if (allBtn) allBtn.disabled = !!busy;
        if (statusEl) statusEl.textContent = msg || '';
    }

    function _getEffectiveTargetLanguage(settings) {
        if (!settings) return 'chinese';
        if (settings.targetLanguage === 'custom') {
            const name = (settings.customTargetLanguageName || '').trim();
            return name || 'English';
        }
        return settings.targetLanguage || 'chinese';
    }

    function _getTranslationContext() {
        const settings = typeof loadSettings === 'function' ? loadSettings() : {};
        const modelName = settings.selectedTranslationModel || 'none';
        if (modelName === 'none') {
            showNotification && showNotification('当前未选择翻译模型，无法执行重译。', 'warning');
            return null;
        }

        let providerKey = modelName;
        let modelConfig = null;
        if (modelName === 'custom') {
            const siteId = settings.selectedCustomSourceSiteId;
            if (!siteId) {
                showNotification && showNotification('未选择自定义源站点，请先在主界面选择。', 'error');
                return null;
            }
            const allSites = typeof loadAllCustomSourceSites === 'function' ? loadAllCustomSourceSites() : {};
            const siteCfg = allSites[siteId];
            if (!siteCfg) {
                showNotification && showNotification('未能加载选定的自定义源站配置。', 'error');
                return null;
            }
            providerKey = `custom_source_${siteId}`;
            modelConfig = siteCfg;
        }

        // KeyProvider 来自 app.js，作为全局可用
        let kp = null;
        try { kp = new KeyProvider(providerKey); } catch(e) { console.error(e); }
        if (!kp || !kp.hasAvailableKeys()) {
            showNotification && showNotification('所选模型没有可用的 API Key，请先配置。', 'error');
            return null;
        }

        const ctx = {
            settings,
            modelName,
            modelConfig,
            keyProvider: kp,
            targetLangName: _getEffectiveTargetLanguage(settings),
            tokenLimit: parseInt(settings.maxTokensPerChunk) || 2000,
            defaultSystemPrompt: settings.defaultSystemPrompt || '',
            defaultUserPromptTemplate: settings.defaultUserPromptTemplate || '',
            useCustomPrompts: !!settings.useCustomPrompts
        };
        return ctx;
    }

    async function _translateOneChunk(chunkText, ctx, logPrefix) {
        // 轮询 Key，失败时标记无效并切换
        let lastErr = null;
        for (let attempt = 0; attempt < 5; attempt++) {
            const keyObj = ctx.keyProvider.getNextKey();
            if (!keyObj) { lastErr = new Error('无可用Key'); break; }
            const keyVal = keyObj.value;
            try {
                if (ctx.modelName === 'custom') {
                    const res = await translateMarkdown(
                        chunkText,
                        ctx.targetLangName,
                        'custom',
                        keyVal,
                        ctx.modelConfig,
                        logPrefix || '',
                        ctx.defaultSystemPrompt,
                        ctx.defaultUserPromptTemplate,
                        ctx.useCustomPrompts
                    );
                    return res;
                } else {
                    const res = await translateMarkdown(
                        chunkText,
                        ctx.targetLangName,
                        ctx.modelName,
                        keyVal,
                        logPrefix || '',
                        ctx.defaultSystemPrompt,
                        ctx.defaultUserPromptTemplate,
                        ctx.useCustomPrompts
                    );
                    return res;
                }
            } catch (e) {
                const msg = (e && e.message ? e.message : String(e)).toLowerCase();
                lastErr = e;
                // 常见失活/未授权关键词，标记Key失效
                if (msg.includes('unauthorized') || msg.includes('invalid') || msg.includes('forbidden') || msg.includes('401')) {
                    try { await ctx.keyProvider.markKeyAsInvalid(keyObj.id); } catch {}
                    continue;
                } else {
                    // 其他错误不标记失活，但尝试下一个Key
                    continue;
                }
            }
        }
        throw lastErr || new Error('翻译失败');
    }

    async function _retryRecordInternal(id, mode) {
        const ctx = _getTranslationContext();
        if (!ctx) return;
        _setBusy(id, true, '处理中...');
        try {
            const record = await getResultFromDB(id);
            if (!record) {
                showNotification && showNotification('未找到历史记录。', 'error');
                return;
            }
            const logPrefix = `[重译:${record.name}]`;

            if (mode === 'all') {
                // 按需求：不要直接执行重译，将整篇加入“上传文件列表”（虚拟目录），供用户统一点击处理
                const baseName = (record.name || 'document').replace(/\.pdf$/i, '');
                const header = `<!-- PBX-HISTORY-REF:${record.id} -->\n`;
                const mdBody = (record.ocr && record.ocr.trim()) ? record.ocr : Array.isArray(record.ocrChunks) ? record.ocrChunks.join('\n\n') : '';
                const mdText = header + mdBody;
                if (!mdText) {
                    showNotification && showNotification('该记录没有可用的 OCR 文本，无法加入待处理列表。', 'warning');
                    return;
                }
                const uniqueSuffix = Math.random().toString(36).slice(2,6);
                const fileName = `${baseName}-retranslate-${uniqueSuffix}.md`;
                try {
                    const virtualFile = new File([mdText], fileName, { type: 'text/markdown' });
                    try { virtualFile.virtualType = 'retranslate'; } catch(_) {}
                    if (typeof addFilesToList === 'function') {
                        addFilesToList([virtualFile]);
                        showNotification && showNotification(`已将“${fileName}”加入待处理列表，请在主界面点击“开始处理”。`, 'success');
                    } else {
                        // 后备：直接操作全局数组并刷新UI
                        if (typeof window !== 'undefined' && Array.isArray(window.pdfFiles)) {
                            window.pdfFiles.push(virtualFile);
                            if (typeof updateFileListUI === 'function' && typeof updateProcessButtonState === 'function' && typeof handleRemoveFile === 'function') {
                                updateFileListUI(window.pdfFiles, window.isProcessing || false, handleRemoveFile);
                                updateProcessButtonState(window.pdfFiles, window.isProcessing || false);
                            }
                            showNotification && showNotification(`已将“${fileName}”加入待处理列表，请在主界面点击“开始处理”。`, 'success');
                        } else {
                            showNotification && showNotification('无法加入待处理列表：缺少文件列表接口。', 'error');
                        }
                    }
                } catch (e) {
                    console.error('创建虚拟文件失败:', e);
                    showNotification && showNotification('创建虚拟文件失败，无法加入待处理列表。', 'error');
                }
            } else {
                // 仅重试失败段 -> 改为加入待处理列表（仅包含失败片段的 OCR 文本）
                const total = Array.isArray(record.ocrChunks) ? record.ocrChunks.length : 0;
                if (total === 0) {
                    showNotification && showNotification('此记录缺少分块信息，无法筛选失败片段。', 'warning');
                    return;
                }
                if (!Array.isArray(record.translatedChunks)) {
                    showNotification && showNotification('此记录缺少译文分块信息，无法识别失败片段。', 'warning');
                    return;
                }
                const pieces = [];
                for (let i = 0; i < total; i++) {
                    if (_isChunkFailed(record.translatedChunks[i])) {
                        const ocrText = record.ocrChunks[i] || '';
                        if (ocrText.trim()) {
                            // 添加可解析的原始分块索引标记
                            pieces.push(`<!-- PBX-CHUNK-INDEX:${i} -->\n\n${ocrText}`);
                        }
                    }
                }
                if (pieces.length === 0) {
                    showNotification && showNotification('没有需要重试的片段。', 'info');
                    return;
                }
                const header = `<!-- PBX-HISTORY-REF:${record.id} -->\n<!-- PBX-MODE:retry-failed -->\n`;
                const mdText = header + pieces.join('\n\n\n');
                const baseName = (record.name || 'document').replace(/\.pdf$/i, '');
                const uniqueSuffix = Math.random().toString(36).slice(2,6);
                const fileName = `${baseName}-retry-failed-${uniqueSuffix}.md`;
                try {
                    const virtualFile = new File([mdText], fileName, { type: 'text/markdown' });
                    try { virtualFile.virtualType = 'retry-failed'; } catch(_) {}
                    if (typeof addFilesToList === 'function') {
                        addFilesToList([virtualFile]);
                        showNotification && showNotification(`已将“${fileName}”加入待处理列表（失败片段），请点击“开始处理”。`, 'success');
                    } else if (typeof window !== 'undefined' && Array.isArray(window.pdfFiles)) {
                        window.pdfFiles.push(virtualFile);
                        if (typeof updateFileListUI === 'function' && typeof updateProcessButtonState === 'function' && typeof handleRemoveFile === 'function') {
                            updateFileListUI(window.pdfFiles, window.isProcessing || false, handleRemoveFile);
                            updateProcessButtonState(window.pdfFiles, window.isProcessing || false);
                        }
                        showNotification && showNotification(`已将“${fileName}”加入待处理列表（失败片段），请点击“开始处理”。`, 'success');
                    } else {
                        showNotification && showNotification('无法加入待处理列表：缺少文件列表接口。', 'error');
                    }
                } catch (e) {
                    console.error('创建虚拟文件失败:', e);
                    showNotification && showNotification('创建虚拟文件失败，无法加入待处理列表。', 'error');
                }
            }

            // 刷新列表显示状态
            await renderHistoryList();
        } catch (e) {
            console.error('重译发生错误:', e);
            showNotification && showNotification(`重译失败：${e && e.message ? e.message : String(e)}`, 'error');
        } finally {
            _setBusy(id, false, '');
        }
    }

    /**
     * (全局可调用) 对历史记录执行重新翻译
     * @param {string} id 历史记录ID
     * @param {('all'|'failed')} mode 模式：全部或仅失败
     */
    window.retryTranslateRecord = function(id, mode) {
        _retryRecordInternal(id, mode === 'all' ? 'all' : 'failed');
    };
});
