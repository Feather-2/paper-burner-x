// js/ui/ui-processing.js
// 文件列表展示与处理进度相关的 UI 逻辑。
(function(global) {
    'use strict';

    const fileListContainer = document.getElementById('fileListContainer');
    const fileList = document.getElementById('fileList');
    const downloadAllBtn = document.getElementById('downloadAllBtn');
    const processBtn = document.getElementById('processBtn');
    const resultsSection = document.getElementById('resultsSection');
    const resultsSummary = document.getElementById('resultsSummary');
    const progressSection = document.getElementById('progressSection');
    const batchProgressText = document.getElementById('batchProgressText');
    const concurrentProgressText = document.getElementById('concurrentProgressText');
    const progressStep = document.getElementById('progressStep');
    const progressPercentage = document.getElementById('progressPercentage');
    const progressBar = document.getElementById('progressBar');
    const progressLog = document.getElementById('progressLog');

    function updateFileListUI(pdfFiles, isProcessing, onRemoveFile) {
        if (!fileList || !fileListContainer) return;
        fileList.innerHTML = '';
        if (pdfFiles.length > 0) {
            fileListContainer.classList.remove('hidden');
            pdfFiles.forEach((file, index) => {
                const displayPath = global.getFileDisplayPath(file);
                const displayName = (displayPath.split('/').pop() || file.name || '').trim() || file.name;
                const listItem = document.createElement('div');
                listItem.className = 'file-list-item';
                let virtualBadge = '';
                const vType = (file && file.virtualType) ? String(file.virtualType) : '';
                const nameLower = (file && file.name) ? file.name.toLowerCase() : '';
                const isRetranslate = vType === 'retranslate' || /-retranslate-/.test(nameLower);
                const isRetryFailed = vType === 'retry-failed' || /-retry-failed-/.test(nameLower);
                if (isRetranslate) {
                    virtualBadge = '<span class="ml-2 inline-block text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 flex-shrink-0">重译</span>';
                } else if (isRetryFailed) {
                    virtualBadge = '<span class="ml-2 inline-block text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 flex-shrink-0">失败重试</span>';
                }

                const extSource = displayName || file.name || '';
                const ext = (extSource.split('.').pop() || '').toLowerCase();
                const icon = ext === 'pdf' ? 'carbon:document-pdf' : 'carbon:document';
                const iconColor = ext === 'pdf' ? 'text-red-500' : 'text-gray-500';
                const isExcluded = typeof global.isExtensionExcluded === 'function' ? global.isExtensionExcluded(ext) : false;

                listItem.innerHTML = `
                <div class="flex items-center overflow-hidden mr-2">
                    <iconify-icon icon="${icon}" class="${iconColor} mr-2 flex-shrink-0" width="20"></iconify-icon>
                    <span class="flex flex-col overflow-hidden">
                        <span class="text-sm text-gray-800 truncate" title="${displayName}">${displayName}</span>
                        ${displayPath && displayPath !== displayName ? `<span class="text-[11px] text-gray-500 truncate" title="${displayPath}">${displayPath}</span>` : ''}
                    </span>
                    ${virtualBadge}
                    ${isExcluded ? '<span class="ml-2 inline-block text-[10px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-600 flex-shrink-0">已排除</span>' : ''}
                    <span class="text-xs text-gray-500 ml-2 flex-shrink-0">(${global.formatFileSize(file.size)})</span>
                </div>
                <button data-index="${index}" class="remove-file-btn text-gray-400 hover:text-red-600 flex-shrink-0" title="移除">
                    <iconify-icon icon="carbon:close" width="16"></iconify-icon>
                </button>
            `;
                if (isExcluded) {
                    listItem.classList.add('opacity-60');
                }
                fileList.appendChild(listItem);
            });

            document.querySelectorAll('.remove-file-btn').forEach(button => {
                button.addEventListener('click', (e) => {
                    if (isProcessing) return;
                    const indexToRemove = parseInt(e.currentTarget.getAttribute('data-index'));
                    onRemoveFile(indexToRemove);
                });
            });

            if (pdfFiles.length === 1) {
                global.data = { name: pdfFiles[0].name, ocr: '', translation: '', images: [], summaries: {} };
            } else if (pdfFiles.length === 0) {
                global.data = {};
            } else {
                global.data = { summaries: {} };
            }
            console.log('刷新文件列表:', pdfFiles.map(f => f.name));
        } else {
            fileListContainer.classList.add('hidden');
            global.data = {};
        }

        if (typeof global.syncBatchModeControls === 'function') {
            global.syncBatchModeControls(pdfFiles.length);
        }
    }

    function updateProcessButtonState(pdfFiles, isProcessing) {
        if (!processBtn) return;
        const getActiveFiles = typeof global.getActiveFiles === 'function' ? global.getActiveFiles : null;
        const effectiveFiles = getActiveFiles ? getActiveFiles() : pdfFiles;
        let mistralKeysAvailable = true;
        const hasPdfFiles = effectiveFiles.some(file => file.name.toLowerCase().endsWith('.pdf'));

        if (hasPdfFiles) {
            try {
                const mistralKeys = typeof global.loadModelKeys === 'function' ? global.loadModelKeys('mistral') : [];
                const usableMistralKeys = mistralKeys.filter(key => key.status === 'valid' || key.status === 'untested');
                if (usableMistralKeys.length === 0) {
                    mistralKeysAvailable = false;
                }
            } catch (e) {
                console.warn('Error checking Mistral keys in updateProcessButtonState:', e);
                mistralKeysAvailable = false;
            }
        }

        processBtn.disabled = effectiveFiles.length === 0 || isProcessing || (hasPdfFiles && !mistralKeysAvailable);

        if (isProcessing) {
            processBtn.innerHTML = `<iconify-icon icon="carbon:hourglass" class="mr-1 animate-spin"></iconify-icon>处理中...`;
        } else {
            processBtn.innerHTML = `<iconify-icon icon="carbon:play" class="mr-1"></iconify-icon>开始处理`;
        }
    }

    function showResultsSection(successCount, skippedCount, errorCount, pdfFilesLength) {
        if (!progressSection || !resultsSection || !resultsSummary || !downloadAllBtn || !concurrentProgressText) return;
        progressSection.classList.add('hidden');
        resultsSection.classList.remove('hidden');
        concurrentProgressText.textContent = '';

        const totalAttempted = successCount + skippedCount + errorCount;
        resultsSummary.innerHTML = `
        <p><strong>处理总结:</strong></p>
        <ul class="list-disc list-inside ml-4">
            <li>成功处理: ${successCount} 文件</li>
            <li>跳过 (已处理): ${skippedCount} 文件</li>
            <li>处理失败 (含重试): ${errorCount} 文件</li>
        </ul>
        <p class="mt-2">在 ${pdfFilesLength} 个选定文件中，尝试处理了 ${totalAttempted} 个。</p>
    `;

        downloadAllBtn.disabled = successCount === 0;

        window.scrollTo({
            top: resultsSection.offsetTop - 20,
            behavior: 'smooth'
        });
    }

    function showProgressSection() {
        if (!resultsSection || !progressSection || !progressLog || !batchProgressText || !concurrentProgressText) return;
        resultsSection.classList.add('hidden');
        progressSection.classList.remove('hidden');
        progressLog.innerHTML = '';
        batchProgressText.textContent = '';
        concurrentProgressText.textContent = '';
        updateProgress('初始化...', 0);

        window.scrollTo({
            top: progressSection.offsetTop - 20,
            behavior: 'smooth'
        });
    }

    function updateConcurrentProgress(count) {
        if (concurrentProgressText) {
            concurrentProgressText.textContent = `当前并发任务数: ${count}`;
        }
    }

    function updateOverallProgress(success, skipped, errors, totalFiles) {
        if (!batchProgressText || !progressPercentage || !progressBar) return;
        const completedCount = success + skipped + errors;
        if (totalFiles > 0) {
            const percentage = totalFiles > 0 ? Math.round((completedCount / totalFiles) * 100) : 0;
            batchProgressText.textContent = `整体进度: ${completedCount} / ${totalFiles} 完成`;
            progressPercentage.textContent = `${percentage}%`;
            progressBar.style.width = `${percentage}%`;
        } else {
            batchProgressText.textContent = '';
            progressPercentage.textContent = '0%';
            progressBar.style.width = '0%';
        }
    }

    function updateProgress(stepText, percentage) {
        if (progressStep) {
            progressStep.textContent = stepText;
        }
    }

    function addProgressLog(text) {
        if (!progressLog) return;
        const timestamp = new Date().toLocaleTimeString();
        const logLine = document.createElement('div');
        logLine.textContent = `[${timestamp}] ${text}`;
        progressLog.appendChild(logLine);
        progressLog.scrollTop = progressLog.scrollHeight;
    }

    global.updateFileListUI = updateFileListUI;
    global.updateProcessButtonState = updateProcessButtonState;
    global.showResultsSection = showResultsSection;
    global.showProgressSection = showProgressSection;
    global.updateConcurrentProgress = updateConcurrentProgress;
    global.updateOverallProgress = updateOverallProgress;
    global.updateProgress = updateProgress;
    global.addProgressLog = addProgressLog;
})(window);
