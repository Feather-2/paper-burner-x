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
        if (!listDiv) return;

        const results = await getAllResultsFromDB();
        if (!results || results.length === 0) {
            listDiv.innerHTML = '<div class="text-gray-400 text-center py-8">暂无历史记录</div>';
            window.__historyRecordCache = {};
            window.__historyBatchCache = {};
            return;
        }

        results.sort((a, b) => new Date(b.time) - new Date(a.time));

        const recordCache = {};
        const batchMap = new Map();
        const singleRecords = [];

        results.forEach(record => {
            recordCache[record.id] = record;
            if (record.batchId) {
                if (!batchMap.has(record.batchId)) {
                    batchMap.set(record.batchId, []);
                }
                batchMap.get(record.batchId).push(record);
            } else {
                singleRecords.push(record);
            }
        });

        const fragments = [];

        batchMap.forEach((group, batchId) => {
            group.sort((a, b) => {
                const orderA = typeof a.batchOrder === 'number' ? a.batchOrder : (typeof a.batchOriginalIndex === 'number' ? a.batchOriginalIndex + 1 : 0);
                const orderB = typeof b.batchOrder === 'number' ? b.batchOrder : (typeof b.batchOriginalIndex === 'number' ? b.batchOriginalIndex + 1 : 0);
                if (orderA !== orderB) return orderA - orderB;
                return new Date(a.time) - new Date(b.time);
            });
            fragments.push(renderBatchGroupItem(batchId, group));
        });

        singleRecords.forEach(record => {
            fragments.push(renderHistoryRecordItem(record));
        });

        listDiv.innerHTML = fragments.join('') || '<div class="text-gray-400 text-center py-8">暂无历史记录</div>';

        window.__historyRecordCache = recordCache;
        const batchCache = {};
        batchMap.forEach((group, batchId) => {
            batchCache[batchId] = group;
        });
        window.__historyBatchCache = batchCache;
    }

    const DEFAULT_EXPORT_TEMPLATE = '{original_name}_{output_language}_{processing_time:YYYYMMDD-HHmmss}.{original_type}';
    const DEFAULT_EXPORT_FORMATS = ['original', 'markdown'];
    const SUPPORTED_EXPORT_FORMATS = ['original', 'markdown', 'html', 'docx', 'pdf'];
    const TEXTUAL_ORIGINAL_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'yaml', 'yml', 'json', 'csv', 'ini', 'cfg', 'log', 'tex', 'html', 'htm']);
    const PACKAGING_OPTIONS = {
        preserve: 'preserve',
        flat: 'flat'
    };

    const historyListElement = document.getElementById('historyList');
    if (historyListElement) {
        historyListElement.addEventListener('click', handleHistoryListAction);
        historyListElement.addEventListener('change', handleHistoryListChange);
    }

    function renderBatchGroupItem(batchId, records) {
        const safeBatchId = sanitizeId(batchId || 'batch');
        const representative = records[0] || {};
        const summaryName = representative.name || batchId || '批量任务';
        const timeLabel = formatDisplayTime(representative.time);
        const targetLang = representative.batchOutputLanguage || representative.targetLanguage || '';
        const template = representative.batchTemplate || DEFAULT_EXPORT_TEMPLATE;
        const formats = Array.isArray(representative.batchFormats) && representative.batchFormats.length > 0
            ? Array.from(new Set(['original', ...representative.batchFormats]))
            : DEFAULT_EXPORT_FORMATS;
        const zipEnabled = typeof representative.batchZip === 'boolean' ? representative.batchZip : false;
        const structure = representative.batchZipStructure || PACKAGING_OPTIONS.preserve;

        const childrenHtml = records.map(record => renderHistoryRecordItem(record, { withinBatch: true, batchId })).join('');
        const configId = `batch-export-config-${safeBatchId}`;

        return `
        <details class="history-batch-group border border-blue-200 bg-blue-50/60 rounded-lg mb-3" data-batch-id="${escapeAttr(batchId)}">
            <summary class="cursor-pointer select-none px-3 py-2">
                <div class="flex flex-col gap-1">
                    <div class="flex justify-between items-center">
                        <span class="text-sm font-semibold text-gray-800 flex items-center gap-2">
                            <span>批量任务</span>
                            <span class="text-blue-600">${escapeHtml(summaryName)}</span>
                            <span class="text-[11px] bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full">${records.length} 个文件</span>
                        </span>
                        <span class="text-xs text-gray-500">${timeLabel}${targetLang ? ` · 语言：${escapeHtml(targetLang)}` : ''}</span>
                    </div>
                    <div class="flex flex-wrap gap-2 text-xs text-gray-600">
                        <button type="button" class="px-2 py-1 bg-blue-500 text-white rounded hover:bg-blue-600" data-history-action="open-batch-export" data-batch-id="${escapeAttr(batchId)}" data-target="${configId}">导出</button>
                        <button type="button" class="px-2 py-1 border border-gray-300 rounded hover:bg-gray-100 text-gray-600" data-history-action="delete-batch" data-batch-id="${escapeAttr(batchId)}">删除</button>
                    </div>
                </div>
            </summary>
            <div class="px-3 pb-3 space-y-2">
                ${renderExportConfigPanel({
                    id: configId,
                    scope: 'batch',
                    ownerId: batchId,
                    template,
                    formats,
                    zipEnabled,
                    structure,
                    withinBatch: true
                })}
                ${childrenHtml || '<div class="text-xs text-gray-500">暂无记录</div>'}
            </div>
        </details>
        `;
    }

    function renderHistoryRecordItem(record, options = {}) {
        const safeId = sanitizeId(record.id || 'record');
        const withinBatch = !!options.withinBatch;
        const status = analyzeRecordStatus(record);
        const statusBadge = buildStatusBadge(status);
        const ocrSnippet = buildSnippetText(record.ocr);
        const translationSnippet = buildSnippetText(record.translation);
        const timeLabel = formatDisplayTime(record.time);
        const targetLang = record.batchOutputLanguage || record.targetLanguage || '';
        const relativePathLabel = buildRelativePathLabel(record);
        const template = record.batchTemplate || DEFAULT_EXPORT_TEMPLATE;
        const formats = Array.isArray(record.batchFormats) && record.batchFormats.length > 0
            ? Array.from(new Set(['original', ...record.batchFormats]))
            : DEFAULT_EXPORT_FORMATS;
        const zipEnabled = typeof record.batchZip === 'boolean' ? record.batchZip : false;
        const structure = record.batchZipStructure || PACKAGING_OPTIONS.preserve;
        const configId = `record-export-config-${safeId}${options.batchId ? `-${sanitizeId(options.batchId)}` : ''}`;
        const retryDisabled = status.failed === 0 ? 'disabled opacity-50 cursor-not-allowed' : '';

        const containerClasses = withinBatch
            ? 'border border-gray-200 rounded-lg p-3 bg-white'
            : 'border border-gray-200 rounded-lg p-4 bg-white shadow-sm';

        return `
        <div class="${containerClasses}" id="history-item-${safeId}" data-record-id="${escapeAttr(record.id)}">
            <div class="flex flex-col gap-1">
                <div class="flex justify-between items-start gap-2">
                    <div class="min-w-0">
                        <div class="text-sm font-semibold text-gray-800 flex items-center gap-2 break-all">
                            ${escapeHtml(record.name || '未命名')} ${statusBadge}
                        </div>
                        <div class="text-xs text-gray-500 mt-1">
                            ${timeLabel}${targetLang ? ` · 语言：${escapeHtml(targetLang)}` : ''}
                            ${relativePathLabel ? ` · <span title="${escapeAttr(relativePathLabel)}">${escapeHtml(relativePathLabel)}</span>` : ''}
                        </div>
                    </div>
                    <div class="flex flex-wrap gap-2 text-xs text-gray-600 justify-end">
                        <button type="button" class="px-2 py-1 bg-blue-50 text-blue-600 rounded hover:bg-blue-100" data-history-action="open-record-export" data-record-id="${escapeAttr(record.id)}" data-target="${configId}">导出</button>
                        <button type="button" class="px-2 py-1 border border-gray-200 rounded hover:bg-gray-100" onclick="showHistoryDetail('${record.id}')">详情</button>
                        <button type="button" class="px-2 py-1 border border-gray-200 rounded hover:bg-gray-100 text-green-600" onclick="downloadHistoryRecord('${record.id}')">下载</button>
                        ${withinBatch ? '' : `<button type="button" class="px-2 py-1 border border-gray-200 rounded hover:bg-gray-100 text-red-500" onclick="deleteHistoryRecord('${record.id}')">删除</button>`}
                    </div>
                </div>
                <div class="text-xs text-gray-600 break-words">OCR：${ocrSnippet}</div>
                <div class="text-xs text-gray-600 break-words">翻译：${translationSnippet}</div>
                <div class="flex flex-wrap items-center gap-2 text-xs text-gray-600 mt-2">
                    <button id="retry-failed-btn-${safeId}" onclick="retryTranslateRecord('${record.id}','failed')" class="px-2 py-1 border border-gray-200 rounded hover:bg-gray-100 ${retryDisabled}">重试失败段</button>
                    <button id="retry-all-btn-${safeId}" onclick="retryTranslateRecord('${record.id}','all')" class="px-2 py-1 border border-gray-200 rounded hover:bg-gray-100">重新翻译全部</button>
                    <span id="retry-status-${safeId}" class="text-xs text-gray-500"></span>
                </div>
                ${renderExportConfigPanel({
                    id: configId,
                    scope: 'record',
                    ownerId: record.id,
                    template,
                    formats,
                    zipEnabled,
                    structure,
                    withinBatch
                })}
            </div>
        </div>
        `;
    }

    function renderExportConfigPanel({ id, scope, ownerId, template, formats, zipEnabled, structure, withinBatch }) {
        const formatOptions = SUPPORTED_EXPORT_FORMATS.map(fmt => {
            const checked = formats.includes(fmt) ? 'checked' : '';
            const label = fmt === 'original' ? '原格式' : fmt.toUpperCase();
            return `<label class="flex items-center space-x-2"><input type="checkbox" value="${fmt}" ${checked} data-config-format="${fmt}" class="rounded border-gray-300 text-blue-600 focus:ring-blue-500"><span>${label}</span></label>`;
        }).join('');

        const sectionClasses = withinBatch ? 'mt-2 hidden border border-dashed border-blue-200 bg-white rounded-lg p-3' : 'mt-3 hidden border border-dashed border-gray-200 bg-gray-50 rounded-lg p-3';
        const structureValue = structure && PACKAGING_OPTIONS[structure] ? structure : PACKAGING_OPTIONS.preserve;
        const preserveChecked = structureValue === PACKAGING_OPTIONS.preserve ? 'checked' : '';
        const flatChecked = structureValue === PACKAGING_OPTIONS.flat ? 'checked' : '';

        const zipCheckedAttr = (zipEnabled || structureValue === PACKAGING_OPTIONS.flat) ? 'checked' : '';
        const zipDisabledAttr = structureValue === PACKAGING_OPTIONS.flat ? 'disabled' : '';

        return `
        <div id="${id}" class="${sectionClasses}" data-config-scope="${scope}" data-owner-id="${escapeAttr(ownerId)}">
            <label class="block text-xs text-gray-600 mb-2">
                命名模板
                <input type="text" class="mt-1 w-full border border-gray-200 rounded px-2 py-1 text-sm focus:ring-1 focus:ring-blue-400 focus:border-blue-400" value="${escapeAttr(template || DEFAULT_EXPORT_TEMPLATE)}" data-config-template>
            </label>
            <div class="flex flex-col gap-2 text-xs text-gray-700" data-config-formats>
                ${formatOptions}
            </div>
            <div class="mt-3 text-xs text-gray-600" data-config-structure-group>
                <span class="block mb-1">ZIP 结构</span>
                <label class="flex items-center space-x-2">
                    <input type="radio" name="pack-structure-${id}" value="preserve" ${preserveChecked} data-config-structure>
                    <span>保留原始目录结构</span>
                </label>
                <label class="flex items-center space-x-2">
                    <input type="radio" name="pack-structure-${id}" value="flat" ${flatChecked} data-config-structure>
                    <span>原文/译文分组，不保留目录</span>
                </label>
            </div>
            <label class="mt-3 flex items-center space-x-2 text-xs text-gray-600">
                <input type="checkbox" ${zipCheckedAttr} ${zipDisabledAttr} data-config-zip class="rounded border-gray-300 text-blue-600 focus:ring-blue-500">
                <span>导出为 ZIP（某些结构将自动启用）</span>
            </label>
            <div class="mt-3 flex items-center gap-2">
                <button type="button" class="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700" data-history-action="confirm-${scope}-export" data-owner-id="${escapeAttr(ownerId)}" data-target="${id}">确认导出</button>
                <button type="button" class="px-3 py-1 border border-gray-200 rounded text-gray-600 hover:bg-gray-100" data-history-action="cancel-config" data-target="${id}">取消</button>
            </div>
        </div>
        `;
    }

    function analyzeRecordStatus(record) {
        const ocrChunks = Array.isArray(record.ocrChunks) ? record.ocrChunks : [];
        const translatedChunks = Array.isArray(record.translatedChunks) ? record.translatedChunks : [];
        const total = ocrChunks.length;
        if (total === 0) {
            return { total: 0, success: 0, failed: 0 };
        }
        let failed = 0;
        for (let i = 0; i < total; i++) {
            const text = translatedChunks[i] || '';
            if (_isChunkFailed(text)) {
                failed++;
            }
        }
        const success = total - failed;
        return { total, success, failed };
    }

    function buildStatusBadge(status) {
        if (!status || status.total === 0) {
            return '<span class="ml-2 inline-block text-[11px] px-2 py-0.5 rounded bg-gray-100 text-gray-500">未分块</span>';
        }
        if (status.failed > 0) {
            return `<span class="ml-2 inline-block text-[11px] px-2 py-0.5 rounded bg-amber-100 text-amber-700">部分失败 ${status.success}/${status.total}</span>`;
        }
        return `<span class="ml-2 inline-block text-[11px] px-2 py-0.5 rounded bg-green-100 text-green-700">完成 ${status.success}/${status.total}</span>`;
    }

    function buildSnippetText(text) {
        if (!text) return '无';
        const sanitized = text.replace(/\s+/g, ' ').trim();
        return sanitized.length > 80 ? `${escapeHtml(sanitized.slice(0, 80))}…` : escapeHtml(sanitized);
    }

    function formatDisplayTime(timeValue) {
        if (!timeValue) return '未知时间';
        try {
            const date = new Date(timeValue);
            if (Number.isNaN(date.getTime())) return '未知时间';
            return date.toLocaleString();
        } catch (e) {
            return '未知时间';
        }
    }

    function buildRelativePathLabel(record) {
        const rel = record.relativePath || (record.file && record.file.pbxRelativePath) || '';
        if (!rel) return '';
        return rel;
    }

    function sanitizeId(id) {
        return String(id || '').replace(/[^a-zA-Z0-9_-]/g, '_');
    }

    function escapeHtml(str) {
        return String(str || '').replace(/[&<>"']/g, function(ch) {
            switch (ch) {
                case '&': return '&amp;';
                case '<': return '&lt;';
                case '>': return '&gt;';
                case '"': return '&quot;';
                case "'": return '&#39;';
                default: return ch;
            }
        });
    }

    function escapeAttr(str) {
        return escapeHtml(str).replace(/"/g, '&quot;');
    }

    async function handleHistoryListAction(event) {
        const actionButton = event.target.closest('[data-history-action]');
        if (!actionButton) return;

        const action = actionButton.getAttribute('data-history-action');
        const targetId = actionButton.getAttribute('data-target');

        try {
            switch (action) {
                case 'open-record-export':
                case 'open-batch-export': {
                    const panel = targetId ? document.getElementById(targetId) : null;
                    if (!panel) break;
                    if (action === 'open-batch-export') {
                        const parentDetails = actionButton.closest('details');
                        if (parentDetails) parentDetails.open = true;
                    }
                    togglePanelVisibility(panel);
                    break;
                }
                case 'cancel-config': {
                    const panel = targetId ? document.getElementById(targetId) : null;
                    if (panel) {
                        panel.classList.add('hidden');
                    }
                    break;
                }
                case 'confirm-record-export': {
                    const recordId = actionButton.getAttribute('data-owner-id');
                    if (!recordId) break;
                    const panel = targetId ? document.getElementById(targetId) : null;
                    if (!panel) break;
                    const config = collectExportConfig(panel);
                    if (config.formats.length === 0) {
                        showNotification && showNotification('请至少选择一种导出格式', 'warning');
                        break;
                    }
                    const recordCache = window.__historyRecordCache || {};
                    const record = recordCache[recordId];
                    if (!record) {
                        showNotification && showNotification('未找到历史记录数据', 'error');
                        break;
                    }
                    panel.classList.add('hidden');
                    await performHistoryExport([record], config);
                    break;
                }
                case 'confirm-batch-export': {
                    const batchId = actionButton.getAttribute('data-owner-id');
                    if (!batchId) break;
                    const panel = targetId ? document.getElementById(targetId) : null;
                    if (!panel) break;
                    const config = collectExportConfig(panel);
                    if (config.formats.length === 0) {
                        showNotification && showNotification('请至少选择一种导出格式', 'warning');
                        break;
                    }
                    const batchCache = window.__historyBatchCache || {};
                    const records = batchCache[batchId];
                    if (!records || records.length === 0) {
                        showNotification && showNotification('未找到批量任务记录', 'error');
                        break;
                    }
                    panel.classList.add('hidden');
                    await performHistoryExport(records, config, { batchId });
                    break;
                }
                case 'delete-batch': {
                    const batchId = actionButton.getAttribute('data-batch-id');
                    if (!batchId) break;
                    if (!confirm('确定要删除整个批量任务吗？此操作不可恢复。')) break;
                    await deleteBatchRecords(batchId);
                    await renderHistoryList();
                    showNotification && showNotification('批量任务已删除', 'success');
                    break;
                }
                default:
                    break;
            }
        } catch (error) {
            console.error('历史记录操作失败:', error);
            showNotification && showNotification(`导出失败：${error && error.message ? error.message : error}`, 'error');
        }
    }

    function handleHistoryListChange(event) {
        const target = event.target;
        if (!target) return;

        if (target.hasAttribute('data-config-structure')) {
            const panel = target.closest('[data-config-scope]');
            if (!panel) return;
            const zipInput = panel.querySelector('[data-config-zip]');
            if (!zipInput) return;
            if (target.value === PACKAGING_OPTIONS.flat) {
                zipInput.checked = true;
                zipInput.disabled = true;
            } else {
                zipInput.disabled = false;
            }
        }
    }

    function togglePanelVisibility(panel) {
        if (!panel) return;
        if (panel.classList.contains('hidden')) {
            // 隐藏同级已展开的配置面板
            const siblings = panel.parentElement ? panel.parentElement.querySelectorAll('[data-config-scope]') : [];
            siblings.forEach(el => { if (el !== panel) el.classList.add('hidden'); });
            panel.classList.remove('hidden');
        } else {
            panel.classList.add('hidden');
        }
    }

    function collectExportConfig(panel) {
        const templateInput = panel.querySelector('[data-config-template]');
        const formatInputs = panel.querySelectorAll('[data-config-formats] input[type="checkbox"]');
        const zipInput = panel.querySelector('[data-config-zip]');
        const structureInput = panel.querySelector('[data-config-structure]:checked');

        const template = templateInput && templateInput.value && templateInput.value.trim()
            ? templateInput.value.trim()
            : DEFAULT_EXPORT_TEMPLATE;
        const formats = Array.from(formatInputs || [])
            .filter(input => input.checked)
            .map(input => input.value)
            .filter(fmt => SUPPORTED_EXPORT_FORMATS.includes(fmt));
        if (!formats.includes('original')) {
            formats.unshift('original');
            const originalCheckbox = panel.querySelector('[data-config-formats] input[value="original"]');
            if (originalCheckbox) originalCheckbox.checked = true;
            if (typeof showNotification === 'function') {
                showNotification('已自动保留“原格式”导出。', 'info');
            }
        }
        const uniqueFormats = Array.from(new Set(formats));
        const structure = structureInput ? structureInput.value : PACKAGING_OPTIONS.preserve;
        const enforceZip = structure === PACKAGING_OPTIONS.flat;
        const zip = enforceZip ? true : (zipInput ? zipInput.checked : false);
        if (enforceZip && zipInput) {
            zipInput.checked = true;
            zipInput.disabled = true;
        } else if (zipInput) {
            zipInput.disabled = false;
        }

        return { template, formats: uniqueFormats, zip, structure };
    }

    async function performHistoryExport(records, config, context = {}) {
        if (!Array.isArray(records) || records.length === 0) return;
        if (!config || config.formats.length === 0) return;

        const exporter = window.PBXHistoryExporter;
        if (!exporter) {
            showNotification && showNotification('导出模块尚未加载完成', 'error');
            return;
        }

        const structure = config.structure || PACKAGING_OPTIONS.preserve;
        const enforceZip = structure === PACKAGING_OPTIONS.flat;
        const shouldZip = enforceZip || config.zip || records.length > 1 || config.formats.length > 1;
        if (shouldZip && typeof JSZip === 'undefined') {
            showNotification && showNotification('JSZip 未加载，无法打包成 ZIP', 'error');
            return;
        }

        const ensureExporter = (format, shouldZip) => {
            if (format === 'pdf' && shouldZip) {
                showNotification && showNotification('PDF 导出目前不支持打包为 ZIP，请单独导出或选择其他格式。', 'warning');
                return null;
            }
            const handler = resolveFormatHandler(format, exporter);
            if (!handler || !handler.exporterFn) {
                showNotification && showNotification(`暂不支持导出 ${format.toUpperCase()} 格式`, 'warning');
                return null;
            }
            return handler;
        };

        const assets = [];
        const generatedPaths = new Set();
        for (const record of records) {
            const variants = [];
            const hasTranslation = record.translation && record.translation.trim();
            if (hasTranslation) {
                variants.push('translation');
            }
            const includeOriginal = !hasTranslation || structure === PACKAGING_OPTIONS.flat || shouldZip;
            if (includeOriginal) {
                variants.push('original');
            }
            if (variants.length === 0) {
                variants.push('original');
            }
            for (const variant of variants) {
                const payload = buildExportPayloadFromRecord(record, variant);
                if (!payload && format !== 'original') continue;
                for (const format of config.formats) {
                    if (!SUPPORTED_EXPORT_FORMATS.includes(format)) continue;

                    if (format === 'original') {
                        if (variant === 'translation' && !TEXTUAL_ORIGINAL_EXTENSIONS.has((record.originalExtension || record.fileType || '').toLowerCase())) {
                            continue;
                        }
                        const originalAsset = buildOriginalAsset(record);
                        if (!originalAsset) {
                            showNotification && showNotification('无法导出原始格式：缺少原始内容。', 'warning');
                            continue;
                        }
                        if (variant === 'original') {
                            const relativeDirOriginal = computeRelativeDirectory(record, 'original', format, structure);
                            const sanitizedDirOriginal = relativeDirOriginal ? sanitizePath(relativeDirOriginal) : '';
                            const originalName = determineOriginalFileName(record, originalAsset.extension);
                            const uniqueOriginalName = ensureUniqueFileName(originalName, sanitizedDirOriginal, generatedPaths, 'original');
                            if (!shouldZip) {
                                saveAs(originalAsset.blob, uniqueOriginalName);
                            } else {
                                assets.push({ blob: originalAsset.blob, fileName: uniqueOriginalName, relativeDir: sanitizedDirOriginal });
                            }
                        } else if (variant === 'translation') {
                            const translatedAsset = buildOriginalTranslationAsset(record, originalAsset.extension);
                            if (!translatedAsset) continue;
                            const contextForTemplate = buildTemplateContext(record, 'original', 'translation');
                            const desiredName = applyNamingTemplate(config.template, contextForTemplate);
                            const fileName = ensureFileName(desiredName, originalAsset.extension || 'txt');
                            const relativeDir = computeRelativeDirectory(record, 'translation', format, structure);
                            const sanitizedDir = relativeDir ? sanitizePath(relativeDir) : '';
                            const uniqueName = ensureUniqueFileName(fileName, sanitizedDir, generatedPaths, 'original-translation');
                            if (!shouldZip) {
                                saveAs(translatedAsset.blob, uniqueName);
                            } else {
                                assets.push({ blob: translatedAsset.blob, fileName: uniqueName, relativeDir: sanitizedDir });
                            }
                        }
                        continue;
                    }

                    const handler = ensureExporter(format, shouldZip);
                    if (!handler) continue;

                    if (format === 'pdf' && shouldZip) {
                        continue; // 已提示
                    }

                    if (!payload) continue;
                    const contextForTemplate = buildTemplateContext(record, format, variant);
                    const desiredName = applyNamingTemplate(config.template, contextForTemplate);
                    const fileName = ensureFileName(desiredName, handler.extension);
                    const options = shouldZip ? { returnBlob: true, fileName } : { returnBlob: true, fileName };

                    try {
                        const result = await handler.exporterFn(payload, options);
                        if (!result) continue;
                        const blob = result.blob || (result.content ? new Blob([result.content], { type: result.mime || 'application/octet-stream' }) : null);
                        if (!blob) continue;

                        const relativeDir = computeRelativeDirectory(record, variant, format, structure);
                        const sanitizedDir = relativeDir ? sanitizePath(relativeDir) : '';
                        const uniqueName = ensureUniqueFileName(fileName, sanitizedDir, generatedPaths, variant);
                        if (!shouldZip) {
                            saveAs(blob, uniqueName);
                            continue;
                        }

                        assets.push({ blob, fileName: uniqueName, relativeDir: sanitizedDir });
                    } catch (error) {
                        console.error('导出失败:', error);
                        showNotification && showNotification(`导出 ${format.toUpperCase()} (${variant === 'original' ? '原文' : '译文'}) 失败：${error.message || error}`, 'error');
                    }
                }
            }
        }

        if (!shouldZip) {
            return;
        }

        const filteredAssets = assets.filter(asset => asset && asset.blob);
        if (!filteredAssets.length) {
            showNotification && showNotification('没有可打包的导出文件', 'warning');
            return;
        }

        const zip = new JSZip();
        filteredAssets.forEach(asset => {
            const dir = asset.relativeDir ? asset.relativeDir : '';
            const path = dir ? `${dir}/${asset.fileName}` : asset.fileName;
            zip.file(path, asset.blob);
        });

        const archiveName = buildArchiveName(records, config, context);
        const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
        saveAs(zipBlob, archiveName);
        showNotification && showNotification(`已生成 ZIP (${filteredAssets.length} 个文件)`, 'success');
    }

    function resolveFormatHandler(format, exporter) {
        switch (format) {
            case 'markdown':
                return { extension: 'md', exporterFn: exporter.exportAsMarkdown };
            case 'html':
                return { extension: 'html', exporterFn: exporter.exportAsHtml };
            case 'docx':
                return { extension: 'docx', exporterFn: exporter.exportAsDocx };
            case 'pdf':
                return { extension: 'pdf', exporterFn: exporter.exportAsPdf };
            default:
                return { extension: format, exporterFn: null };
        }
    }

    function buildExportPayloadFromRecord(record, variant = 'auto') {
        if (!record) return null;
        const data = {
            id: record.id,
            name: record.name,
            time: record.time,
            ocr: record.ocr || '',
            translation: record.translation || '',
            images: Array.isArray(record.images) ? record.images : [],
            ocrChunks: Array.isArray(record.ocrChunks) ? record.ocrChunks : [],
            translatedChunks: Array.isArray(record.translatedChunks) ? record.translatedChunks : []
        };
        let mode = 'ocr';
        if (variant === 'translation') {
            if (!data.translation || !data.translation.trim()) return null;
            mode = 'translation';
        } else if (variant === 'original') {
            if (!data.ocr || !data.ocr.trim()) return null;
            mode = 'ocr';
        } else {
            mode = data.translation ? 'translation' : 'ocr';
            if (mode === 'translation' && (!data.translation || !data.translation.trim())) {
                mode = 'ocr';
            }
        }
        const exporter = window.PBXHistoryExporter;
        if (!exporter || typeof exporter.preparePayload !== 'function') {
            return null;
        }
        const payload = exporter.preparePayload(mode, data);
        if (payload) {
            payload.customFileName = record.name;
        }
        return payload;
    }

    function buildTemplateContext(record, format, variant = 'translation') {
        const relativePath = normalizeRelativePath(record);
        const originalName = relativePath ? relativePath.split('/').pop() : (record.name || 'document');
        let originalType;
        if (format === 'markdown') {
            originalType = 'md';
        } else if (format === 'html') {
            originalType = 'html';
        } else if (format === 'docx') {
            originalType = 'docx';
        } else if (format === 'pdf') {
            originalType = 'pdf';
        } else if (format === 'original') {
            originalType = (record.originalExtension || record.fileType || 'txt').replace(/[^a-zA-Z0-9_-]/g, '') || 'txt';
        } else {
            originalType = format.replace(/[^a-zA-Z0-9_-]/g, '') || 'txt';
        }
        return {
            originalName,
            originalType,
            outputLanguage: record.batchOutputLanguage || record.targetLanguage || '',
            processingTime: record.processedAt || record.time,
            batchId: record.batchId || null,
            variant: variant === 'original' ? 'original' : 'translation'
        };
    }

    function applyNamingTemplate(template, context) {
        const safeTemplate = template || DEFAULT_EXPORT_TEMPLATE;
        return safeTemplate.replace(/\{([^{}]+)\}/g, (match, token) => {
            const [key, modifier] = token.split(':');
            switch (key) {
                case 'original_name':
                    return sanitizeFileName(context.originalName || 'document');
                case 'original_type':
                    return (context.originalType || '').replace(/[^a-zA-Z0-9_-]/g, '');
                case 'output_language':
                    return sanitizeFileName(context.outputLanguage || '');
                case 'processing_time':
                    return formatProcessingTime(context.processingTime, modifier);
                case 'batch_id':
                    return sanitizeFileName(context.batchId || '');
                case 'variant':
                    return sanitizeFileName(context.variant || '');
                default:
                    return '';
            }
        });
    }

    function formatProcessingTime(timeValue, pattern = 'YYYYMMDD-HHmmss') {
        if (!timeValue) return '';
        const date = new Date(timeValue);
        if (Number.isNaN(date.getTime())) return '';
        const pad = num => String(num).padStart(2, '0');
        return pattern
            .replace(/YYYY/g, date.getFullYear())
            .replace(/MM/g, pad(date.getMonth() + 1))
            .replace(/DD/g, pad(date.getDate()))
            .replace(/HH/g, pad(date.getHours()))
            .replace(/mm/g, pad(date.getMinutes()))
            .replace(/ss/g, pad(date.getSeconds()));
    }

    function ensureFileName(baseName, extension) {
        const sanitized = sanitizeFileName(baseName || 'document');
        const ext = (extension || '').replace(/[^a-zA-Z0-9]/g, '');
        if (!ext) return sanitized;
        if (sanitized.toLowerCase().endsWith(`.${ext.toLowerCase()}`)) {
            return sanitized;
        }
        return `${sanitized}.${ext}`;
    }

    function sanitizeFileName(name) {
        return (name || 'document').replace(/[\\/:*?"<>|]/g, '_');
    }

    function sanitizePath(path) {
        return (path || '').split('/').map(segment => sanitizeFileName(segment)).filter(Boolean).join('/');
    }

    function ensureFileExtension(baseName, extension) {
        const sanitized = sanitizeFileName(baseName || 'document');
        const ext = (extension || '').replace(/[^a-zA-Z0-9]/g, '');
        if (!ext) return sanitized;
        if (sanitized.toLowerCase().endsWith(`.${ext.toLowerCase()}`)) {
            return sanitized;
        }
        return `${sanitized}.${ext}`;
    }

    function normalizeRelativePath(record) {
        const rel = record.relativePath || '';
        if (!rel) {
            return (record.name || '').replace(/\\/g, '/');
        }
        return rel.replace(/\\/g, '/');
    }

    function normalizeRelativeDir(record) {
        const rel = normalizeRelativePath(record);
        if (!rel) return '';
        const lastSlash = rel.lastIndexOf('/');
        if (lastSlash === -1) return '';
        return sanitizePath(rel.slice(0, lastSlash));
    }

    function computeRelativeDirectory(record, variant, format, structure) {
        if (structure === PACKAGING_OPTIONS.flat) {
            const variantDir = variant === 'original' ? 'original' : 'translation';
            let formatDir;
            if (format === 'original') {
                formatDir = (record.originalExtension || record.fileType || 'raw').toLowerCase();
            } else {
                formatDir = format.toLowerCase();
            }
            return `${variantDir}/${sanitizeFileName(formatDir || 'raw')}`;
        }
        return normalizeRelativeDir(record);
    }

    function ensureUniqueFileName(fileName, dir, set, variant) {
        let uniqueName = fileName;
        let counter = 1;
        let key = `${dir}||${uniqueName}`;
        while (set.has(key)) {
            uniqueName = appendSuffix(fileName, counter++, variant);
            key = `${dir}||${uniqueName}`;
        }
        set.add(key);
        return uniqueName;
    }

    function appendSuffix(fileName, counter, variant) {
        let baseSuffix;
        if (variant === 'original') {
            baseSuffix = '_original';
        } else if (variant === 'original-translation') {
            baseSuffix = '_translated';
        } else {
            baseSuffix = '_translation';
        }
        const suffix = counter === 1 ? baseSuffix : `${baseSuffix}${counter}`;
        const idx = fileName.lastIndexOf('.');
        if (idx === -1) {
            return `${fileName}${suffix}`;
        }
        const name = fileName.slice(0, idx);
        const ext = fileName.slice(idx);
        return `${name}${suffix}${ext}`;
    }

    function buildOriginalAsset(record) {
        if (!record) return null;
        const extension = (record.originalExtension || record.fileType || 'txt').toLowerCase();
        if (record.originalEncoding === 'text' && typeof record.originalContent === 'string') {
            const mime = guessMimeType(extension, true);
            return {
                blob: new Blob([record.originalContent], { type: `${mime};charset=utf-8` }),
                extension
            };
        }
        if (record.originalEncoding && record.originalEncoding !== 'text' && record.originalBinary) {
            const buffer = base64ToArrayBuffer(record.originalBinary);
            if (!buffer) return null;
            const mime = guessMimeType(extension, false);
            return {
                blob: new Blob([buffer], { type: mime }),
                extension
            };
        }
        return null;
    }

    function buildOriginalTranslationAsset(record, extension) {
        if (!record || !record.translation || !record.translation.trim()) {
            return null;
        }
        const lowered = (extension || '').toLowerCase();
        if (!TEXTUAL_ORIGINAL_EXTENSIONS.has(lowered)) {
            // 暂不支持复杂二进制格式的译文导出
            return null;
        }
        const mime = guessMimeType(lowered, true);
        // 直接输出译文内容（目前为 Markdown 或纯文本）
        const content = record.translation;
        return {
            blob: new Blob([content], { type: `${mime};charset=utf-8` })
        };
    }

    function determineOriginalFileName(record, extension) {
        const relativePath = normalizeRelativePath(record);
        if (relativePath) {
            const parts = relativePath.split('/');
            const baseName = parts.pop() || relativePath;
            return ensureFileExtension(baseName, extension || 'txt');
        }
        const base = sanitizeFileName(record.name || 'document');
        return ensureFileExtension(base, extension || 'txt');
    }

    function guessMimeType(ext, isText) {
        const lowercase = (ext || '').toLowerCase();
        if (isText) {
            if (lowercase === 'html' || lowercase === 'htm') return 'text/html';
            if (lowercase === 'md' || lowercase === 'markdown') return 'text/markdown';
            if (lowercase === 'yaml' || lowercase === 'yml') return 'text/yaml';
            if (lowercase === 'json') return 'application/json';
            if (lowercase === 'txt') return 'text/plain';
            return 'text/plain';
        }
        if (lowercase === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        if (lowercase === 'pptx') return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
        if (lowercase === 'epub') return 'application/epub+zip';
        if (lowercase === 'pdf') return 'application/pdf';
        return 'application/octet-stream';
    }

    function base64ToArrayBuffer(base64) {
        try {
            const binaryString = atob(base64);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            return bytes.buffer;
        } catch (error) {
            console.warn('base64ToArrayBuffer failed:', error);
            return null;
        }
    }

    function buildArchiveName(records, config, context) {
        const firstRecord = records[0];
        const ext = 'zip';
        const suffix = config.structure === PACKAGING_OPTIONS.flat ? '_flat' : '';
        if (records.length === 1) {
            const baseName = applyNamingTemplate(config.template, buildTemplateContext(firstRecord, 'zip'));
            return ensureFileName(`${baseName}${suffix}`, ext);
        }
        const base = context.batchId || 'batch';
        const time = formatProcessingTime(firstRecord.processedAt || firstRecord.time, 'YYYYMMDD-HHmmss');
        return ensureFileName(`${base}_${time || Date.now()}${suffix}`, ext);
    }

    async function deleteBatchRecords(batchId) {
        const batchCache = window.__historyBatchCache || {};
        const records = batchCache[batchId];
        if (!records || !records.length) return;
        for (const record of records) {
            await deleteResultFromDB(record.id);
        }
    }

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
        const normalizedPath = (r.relativePath || r.name || '').replace(/\\/g, '/');
        const dirPath = normalizedPath.includes('/') ? normalizedPath.slice(0, normalizedPath.lastIndexOf('/')) : '';
        const baseName = normalizedPath.includes('/') ? normalizedPath.slice(normalizedPath.lastIndexOf('/') + 1) : (r.name || 'document');
        const baseWithoutExt = baseName.replace(/\.[^.]+$/, '');
        const sanitizedDir = dirPath ? sanitizePath(dirPath) : '';
        const sanitizedBase = sanitizeFileName(baseWithoutExt).substring(0, 120) || 'document';
        const folderPath = sanitizedDir ? `${sanitizedDir}/${sanitizedBase}` : sanitizedBase;
        const folder = zip.folder(folderPath);
        folder.file('document.md', r.ocr || '');
        if (r.translation) folder.file('translation.md', r.translation);
        if (r.originalEncoding === 'text' && typeof r.originalContent === 'string') {
            const ext = (r.originalExtension || r.fileType || 'txt').toLowerCase();
            const mime = guessMimeType(ext, true);
            folder.file(`original.${ext || 'txt'}`, new Blob([r.originalContent], { type: `${mime};charset=utf-8` }));
        } else if (r.originalEncoding && r.originalEncoding !== 'text' && r.originalBinary) {
            const buffer = base64ToArrayBuffer(r.originalBinary);
            if (buffer) {
                const ext = (r.originalExtension || r.fileType || 'bin').toLowerCase();
                const mime = guessMimeType(ext, false);
                folder.file(`original.${ext || 'bin'}`, new Blob([buffer], { type: mime }));
            }
        }
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
        const archiveName = ensureFileName(`${sanitizedBase}_${timestamp}`, 'zip');
        saveAs(zipBlob, archiveName);
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
                        // 成功后自动关闭历史面板，避免遮挡主界面交互
                        try { document.getElementById('historyPanel')?.classList.add('hidden'); } catch(_) {}
                    } else {
                        // 后备：直接操作全局数组并刷新UI
                        if (typeof window !== 'undefined' && Array.isArray(window.pdfFiles)) {
                            window.pdfFiles.push(virtualFile);
                            if (typeof updateFileListUI === 'function' && typeof updateProcessButtonState === 'function' && typeof handleRemoveFile === 'function') {
                                updateFileListUI(window.pdfFiles, window.isProcessing || false, handleRemoveFile);
                                updateProcessButtonState(window.pdfFiles, window.isProcessing || false);
                            }
                            showNotification && showNotification(`已将“${fileName}”加入待处理列表，请在主界面点击“开始处理”。`, 'success');
                            try { document.getElementById('historyPanel')?.classList.add('hidden'); } catch(_) {}
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
                        try { document.getElementById('historyPanel')?.classList.add('hidden'); } catch(_) {}
                    } else if (typeof window !== 'undefined' && Array.isArray(window.pdfFiles)) {
                        window.pdfFiles.push(virtualFile);
                        if (typeof updateFileListUI === 'function' && typeof updateProcessButtonState === 'function' && typeof handleRemoveFile === 'function') {
                            updateFileListUI(window.pdfFiles, window.isProcessing || false, handleRemoveFile);
                            updateProcessButtonState(window.pdfFiles, window.isProcessing || false);
                        }
                        showNotification && showNotification(`已将“${fileName}”加入待处理列表（失败片段），请点击“开始处理”。`, 'success');
                        try { document.getElementById('historyPanel')?.classList.add('hidden'); } catch(_) {}
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
