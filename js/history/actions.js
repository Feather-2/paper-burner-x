/**
 * @file js/history/actions.js
 * @description 历史记录动作函数（导出的公开 API）
 */

import { sanitizeId, sanitizePath, sanitizeFileName, isChunkFailed } from './utils.js';
import { removeFolderAssignmentForRecord } from './folders.js';

/** 实现回调 */
let deleteHistoryRecordImpl = null;
let downloadHistoryRecordImpl = null;
let retryTranslateRecordImpl = null;

/**
 * 设置删除记录实现
 * @param {Function} impl - 实现函数
 */
export function setDeleteHistoryRecordImpl(impl) {
    deleteHistoryRecordImpl = impl;
}

/**
 * 设置下载记录实现
 * @param {Function} impl - 实现函数
 */
export function setDownloadHistoryRecordImpl(impl) {
    downloadHistoryRecordImpl = impl;
}

/**
 * 设置重试翻译实现
 * @param {Function} impl - 实现函数
 */
export function setRetryTranslateRecordImpl(impl) {
    retryTranslateRecordImpl = impl;
}

/**
 * 删除历史记录
 * @param {string} id - 记录 ID
 * @param {string} name - 记录名称
 */
export function deleteHistoryRecord(id, name) {
    if (typeof deleteHistoryRecordImpl === 'function') {
        return deleteHistoryRecordImpl(id, name);
    }
}

/**
 * 显示历史记录详情
 * @param {string} id - 记录 ID
 */
export function showHistoryDetail(id) {
    if (typeof window === 'undefined') return;
    const url = 'views/history/history_detail.html?id=' + encodeURIComponent(id);
    const newWindow = window.open(url, '_blank', 'noopener,noreferrer');
    if (newWindow) newWindow.opener = null;
}

/**
 * 下载历史记录
 * @param {string} id - 记录 ID
 * @returns {Promise<void>}
 */
export async function downloadHistoryRecord(id) {
    if (typeof downloadHistoryRecordImpl === 'function') {
        return downloadHistoryRecordImpl(id);
    }
}

/**
 * 重试翻译记录
 * @param {string} id - 记录 ID
 * @param {string} mode - 模式 ('all' 或 'failed')
 */
export function retryTranslateRecord(id, mode) {
    if (typeof retryTranslateRecordImpl === 'function') {
        return retryTranslateRecordImpl(id, mode);
    }
}

/**
 * 猜测 MIME 类型
 * @param {string} ext - 文件扩展名
 * @param {boolean} isText - 是否文本类型
 * @returns {string} MIME 类型
 */
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

/**
 * Base64 转 ArrayBuffer
 * @param {string} base64 - Base64 字符串
 * @returns {ArrayBuffer|null} ArrayBuffer 或 null
 */
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

/**
 * 确保文件扩展名
 * @param {string} baseName - 基础文件名
 * @param {string} extension - 扩展名
 * @returns {string} 完整文件名
 */
function ensureFileExtension(baseName, extension) {
    const sanitized = sanitizeFileName(baseName || 'document');
    const ext = (extension || '').replace(/[^a-zA-Z0-9]/g, '');
    if (!ext) return sanitized;
    if (sanitized.toLowerCase().endsWith(`.${ext.toLowerCase()}`)) {
        return sanitized;
    }
    return `${sanitized}.${ext}`;
}

/**
 * 创建下载记录实现
 * @returns {Function} 下载实现函数
 */
export function createDownloadHistoryRecordImpl() {
    return async function(id) {
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
                const base64Data = img.data.includes(',') ? img.data.split(',')[1] : img.data;
                if (base64Data) {
                    imagesFolder.file(`${img.id}.png`, base64Data, { base64: true });
                }
            }
        }
        const zipBlob = await zip.generateAsync({ type: 'blob', compression: "DEFLATE", compressionOptions: { level: 6 } });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const archiveName = ensureFileExtension(`${sanitizedBase}_${timestamp}`, 'zip');
        saveAs(zipBlob, archiveName);
    };
}

/**
 * 设置忙碌状态
 * @param {string} id - 记录 ID
 * @param {boolean} busy - 是否忙碌
 * @param {string} msg - 状态消息
 */
function setBusy(id, busy, msg = '') {
    const safeId = sanitizeId(id);
    const failedBtn = document.getElementById(`retry-failed-btn-${safeId}`);
    const allBtn = document.getElementById(`retry-all-btn-${safeId}`);
    const statusEl = document.getElementById(`retry-status-${safeId}`);
    if (failedBtn) failedBtn.disabled = !!busy;
    if (allBtn) allBtn.disabled = !!busy;
    if (statusEl) statusEl.textContent = msg || '';
}

/**
 * 获取有效目标语言
 * @param {Object} settings - 设置对象
 * @returns {string} 目标语言
 */
function getEffectiveTargetLanguage(settings) {
    if (!settings) return 'chinese';
    if (settings.targetLanguage === 'custom') {
        const name = (settings.customTargetLanguageName || '').trim();
        return name || 'English';
    }
    return settings.targetLanguage || 'chinese';
}

/**
 * 获取翻译上下文
 * @returns {Object|null} 翻译上下文或 null
 */
function getTranslationContext() {
    const settings = typeof loadSettings === 'function' ? loadSettings() : {};
    const modelName = settings.selectedTranslationModel || 'none';
    if (modelName === 'none') {
        typeof showNotification === 'function' && showNotification('当前未选择翻译模型，无法执行重译。', 'warning');
        return null;
    }

    let providerKey = modelName;
    let modelConfig = null;
    if (modelName === 'custom') {
        const siteId = settings.selectedCustomSourceSiteId;
        if (!siteId) {
            typeof showNotification === 'function' && showNotification('未选择自定义源站点，请先在主界面选择。', 'error');
            return null;
        }
        const allSites = typeof loadAllCustomSourceSites === 'function' ? loadAllCustomSourceSites() : {};
        const siteCfg = allSites[siteId];
        if (!siteCfg) {
            typeof showNotification === 'function' && showNotification('未能加载选定的自定义源站配置。', 'error');
            return null;
        }
        providerKey = `custom_source_${siteId}`;
        modelConfig = siteCfg;
    }

    let kp = null;
    try { kp = new KeyProvider(providerKey); } catch(e) { console.error(e); }
    if (!kp || !kp.hasAvailableKeys()) {
        typeof showNotification === 'function' && showNotification('所选模型没有可用的 API Key，请先配置。', 'error');
        return null;
    }

    const ctx = {
        settings,
        modelName,
        modelConfig,
        keyProvider: kp,
        targetLangName: getEffectiveTargetLanguage(settings),
        tokenLimit: parseInt(settings.maxTokensPerChunk) || 2000,
        defaultSystemPrompt: settings.defaultSystemPrompt || '',
        defaultUserPromptTemplate: settings.defaultUserPromptTemplate || '',
        useCustomPrompts: !!settings.useCustomPrompts
    };
    return ctx;
}

/**
 * 创建重试翻译实现
 * @param {Function} renderHistoryList - 渲染列表函数
 * @returns {Function} 重试实现函数
 */
export function createRetryTranslateRecordImpl(renderHistoryList) {
    return async function(id, mode) {
        const ctx = getTranslationContext();
        if (!ctx) return;
        setBusy(id, true, '处理中...');
        try {
            const record = await getResultFromDB(id);
            if (!record) {
                typeof showNotification === 'function' && showNotification('未找到历史记录。', 'error');
                return;
            }
            const logPrefix = `[重译:${record.name}]`;

            if (mode === 'all') {
                const baseName = (record.name || 'document').replace(/\.pdf$/i, '');
                const header = `<!-- PBX-HISTORY-REF:${record.id} -->\n`;
                const mdBody = (record.ocr && record.ocr.trim()) ? record.ocr : Array.isArray(record.ocrChunks) ? record.ocrChunks.join('\n\n') : '';
                const mdText = header + mdBody;
                if (!mdText) {
                    typeof showNotification === 'function' && showNotification('该记录没有可用的 OCR 文本，无法加入待处理列表。', 'warning');
                    return;
                }
                const uniqueSuffix = Math.random().toString(36).slice(2,6);
                const fileName = `${baseName}-retranslate-${uniqueSuffix}.md`;
                try {
                    const virtualFile = new File([mdText], fileName, { type: 'text/markdown' });
                    try { virtualFile.virtualType = 'retranslate'; } catch(_) {}
                    if (typeof addFilesToList === 'function') {
                        addFilesToList([virtualFile]);
                        typeof showNotification === 'function' && showNotification(`已将"${fileName}"加入待处理列表，请在主界面点击"开始处理"。`, 'success');
                        try { document.getElementById('historyPanel')?.classList.add('hidden'); } catch(_) {}
                    } else {
                        if (typeof window !== 'undefined' && Array.isArray(window.pdfFiles)) {
                            window.pdfFiles.push(virtualFile);
                            if (typeof updateFileListUI === 'function' && typeof updateProcessButtonState === 'function' && typeof handleRemoveFile === 'function') {
                                updateFileListUI(window.pdfFiles, window.isProcessing || false, handleRemoveFile);
                                updateProcessButtonState(window.pdfFiles, window.isProcessing || false);
                            }
                            typeof showNotification === 'function' && showNotification(`已将"${fileName}"加入待处理列表，请在主界面点击"开始处理"。`, 'success');
                            try { document.getElementById('historyPanel')?.classList.add('hidden'); } catch(_) {}
                        } else {
                            typeof showNotification === 'function' && showNotification('无法加入待处理列表：缺少文件列表接口。', 'error');
                        }
                    }
                } catch (e) {
                    console.error('创建虚拟文件失败:', e);
                    typeof showNotification === 'function' && showNotification('创建虚拟文件失败，无法加入待处理列表。', 'error');
                }
            } else {
                const total = Array.isArray(record.ocrChunks) ? record.ocrChunks.length : 0;

                if (total > 0 && Array.isArray(record.translatedChunks)) {
                    const pieces = [];
                    for (let i = 0; i < total; i++) {
                        if (isChunkFailed(record.translatedChunks[i])) {
                            const ocrText = record.ocrChunks[i] || '';
                            if (ocrText.trim()) {
                                pieces.push(`<!-- PBX-CHUNK-INDEX:${i} -->\n\n${ocrText}`);
                            }
                        }
                    }
                    if (pieces.length === 0) {
                        typeof showNotification === 'function' && showNotification('没有需要重试的片段。', 'info');
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
                            typeof showNotification === 'function' && showNotification(`已将"${fileName}"加入待处理列表（失败片段），请点击"开始处理"。`, 'success');
                            try { document.getElementById('historyPanel')?.classList.add('hidden'); } catch(_) {}
                        } else if (typeof window !== 'undefined' && Array.isArray(window.pdfFiles)) {
                            window.pdfFiles.push(virtualFile);
                            if (typeof updateFileListUI === 'function' && typeof updateProcessButtonState === 'function' && typeof handleRemoveFile === 'function') {
                                updateFileListUI(window.pdfFiles, window.isProcessing || false, handleRemoveFile);
                                updateProcessButtonState(window.pdfFiles, window.isProcessing || false);
                            }
                            typeof showNotification === 'function' && showNotification(`已将"${fileName}"加入待处理列表（失败片段），请点击"开始处理"。`, 'success');
                            try { document.getElementById('historyPanel')?.classList.add('hidden'); } catch(_) {}
                        } else {
                            typeof showNotification === 'function' && showNotification('无法加入待处理列表：缺少文件列表接口。', 'error');
                        }
                    } catch (e) {
                        console.error('创建虚拟文件失败:', e);
                        typeof showNotification === 'function' && showNotification('创建虚拟文件失败，无法加入待处理列表。', 'error');
                    }
                    return;
                }

                const meta = record && record.metadata ? record.metadata : {};
                let failedItems = Array.isArray(meta.failedStructuredItems) ? meta.failedStructuredItems.slice() : [];

                if (failedItems.length === 0 && Array.isArray(meta.translatedContentList)) {
                    const _norm = (v) => {
                        if (v == null) return '';
                        try {
                            if (Array.isArray(v)) return v.join(' ').trim();
                            if (typeof v === 'string') return v.trim();
                            return String(v).trim();
                        } catch(_) { return ''; }
                    };
                    const tlist = meta.translatedContentList;
                    const olist = Array.isArray(meta.contentListJson) ? meta.contentListJson : [];
                    const minLen = Math.min(tlist.length, olist.length);
                    for (let i = 0; i < minLen; i++) {
                        const t = tlist[i] || {};
                        const o = olist[i] || {};
                        let isFailed = false;

                        if (t.failed && t.failureReason) {
                            isFailed = (t.failureReason === 'empty');
                        } else if (t.failed || !t.text) {
                            if (o.type === 'text') {
                                const a = _norm(o.text);
                                const b = _norm(t.text);
                                isFailed = a && !b;
                            } else if (o.type === 'image') {
                                const a = _norm(o.image_caption);
                                const b = _norm(t.image_caption);
                                isFailed = a && !b;
                            } else if (o.type === 'table') {
                                const a = _norm(o.table_caption);
                                const b = _norm(t.table_caption);
                                isFailed = a && !b;
                            }
                        }
                        if (isFailed) {
                            const rawText = (o.type === 'text') ? (o.text || '')
                                            : (o.type === 'image') ? (Array.isArray(o.image_caption) ? o.image_caption.join(' ') : o.image_caption)
                                            : (o.type === 'table') ? (o.table_caption || '')
                                            : '';
                            const normText = _norm(rawText);
                            if (normText) {
                                failedItems.push({ index: i, type: o.type, page_idx: o.page_idx || 0, text: normText });
                            }
                        }
                    }
                }

                if (failedItems.length === 0) {
                    typeof showNotification === 'function' && showNotification('没有需要重试的片段。', 'info');
                    return;
                }

                const header = `<!-- PBX-HISTORY-REF:${record.id} -->\n<!-- PBX-MODE:retry-structured-failed -->\n<!-- PBX-FAILED-COUNT:${failedItems.length} -->\n`;
                const failedIndices = failedItems.map(fi => fi.index).join(',');
                const mdText = header + `<!-- PBX-FAILED-INDICES:${failedIndices} -->\n\n结构化翻译失败片段重试（${failedItems.length} 个）`;
                const baseName = (record.name || 'document').replace(/\.pdf$/i, '');
                const uniqueSuffix = Math.random().toString(36).slice(2,6);
                const fileName = `${baseName}-retry-structured-${uniqueSuffix}.md`;

                try {
                    const virtualFile = new File([mdText], fileName, { type: 'text/markdown' });
                    try { virtualFile.virtualType = 'retry-structured-failed'; } catch(_) {}

                    if (typeof addFilesToList === 'function') {
                        addFilesToList([virtualFile]);
                        typeof showNotification === 'function' && showNotification(`已将"${fileName}"加入待处理列表（${failedItems.length} 个失败片段），请点击"开始处理"。`, 'success');
                        try { document.getElementById('historyPanel')?.classList.add('hidden'); } catch(_) {}
                    } else if (typeof window !== 'undefined' && Array.isArray(window.pdfFiles)) {
                        window.pdfFiles.push(virtualFile);
                        if (typeof updateFileListUI === 'function' && typeof updateProcessButtonState === 'function' && typeof handleRemoveFile === 'function') {
                            updateFileListUI(window.pdfFiles, window.isProcessing || false, handleRemoveFile);
                            updateProcessButtonState(window.pdfFiles, window.isProcessing || false);
                        }
                        typeof showNotification === 'function' && showNotification(`已将"${fileName}"加入待处理列表（${failedItems.length} 个失败片段），请点击"开始处理"。`, 'success');
                        try { document.getElementById('historyPanel')?.classList.add('hidden'); } catch(_) {}
                    } else {
                        typeof showNotification === 'function' && showNotification('无法加入待处理列表：缺少文件列表接口。', 'error');
                    }
                } catch (e) {
                    console.error('创建虚拟文件失败:', e);
                    typeof showNotification === 'function' && showNotification('创建虚拟文件失败，无法加入待处理列表。', 'error');
                }
                return;
            }

            if (typeof renderHistoryList === 'function') {
                await renderHistoryList();
            }
        } catch (e) {
            console.error('重译发生错误:', e);
            typeof showNotification === 'function' && showNotification(`重译失败：${e && e.message ? e.message : String(e)}`, 'error');
        } finally {
            setBusy(id, false, '');
        }
    };
}
