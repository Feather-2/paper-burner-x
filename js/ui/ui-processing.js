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

    // 使用事件委托绑定验证刷新按钮
    document.addEventListener('click', (e) => {
        const refreshBtn = e.target.closest('#validationRefreshBtn');
        if (refreshBtn) {
            console.log('[Validation] Refresh button clicked');
            e.preventDefault();
            e.stopPropagation();
            if (typeof window.refreshValidationState === 'function') {
                window.refreshValidationState();
            } else {
                console.warn('[Validation] window.refreshValidationState not available');
            }
        }
    });

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
        let translationKeysAvailable = true;
        const hasPdfFiles = effectiveFiles.some(file => file.name.toLowerCase().endsWith('.pdf'));

        // 检查 OCR 引擎与所需配置
        let ocrEngine = 'mistral';
        try {
            if (window.ocrSettingsManager && typeof window.ocrSettingsManager.getCurrentConfig === 'function') {
                ocrEngine = window.ocrSettingsManager.getCurrentConfig().engine || (localStorage.getItem('ocrEngine') || 'mistral');
            } else {
                ocrEngine = localStorage.getItem('ocrEngine') || 'mistral';
            }
        } catch {}

        if (hasPdfFiles) {
            if (ocrEngine === 'mistral') {
                const mistralKeyProvider = new KeyProvider('mistral');
                mistralKeysAvailable = mistralKeyProvider.hasAvailableKeys();
            } else {
                // 非 Mistral OCR，不强制要求 Mistral Keys
                mistralKeysAvailable = true;
            }
        }

        // 检查翻译 Keys（如果需要翻译）- 直接使用 app.js 的逻辑
        const settings = typeof global.loadSettings === 'function' ? global.loadSettings() : {};
        const selectedTranslationModelName = settings.selectedTranslationModel || 'none';
        let translationModelDisplayName = selectedTranslationModelName;
        let currentTranslationModelForProvider = null;
        let translationModelConfigForProcess = null;

        if (selectedTranslationModelName !== 'none') {
            if (selectedTranslationModelName === 'custom') {
                const selectedCustomSourceId = settings.selectedCustomSourceSiteId;
                if (!selectedCustomSourceId) {
                    translationKeysAvailable = false;
                } else {
                    const allSourceSites = typeof global.loadAllCustomSourceSites === 'function' ? global.loadAllCustomSourceSites() : {};
                    const siteConfig = allSourceSites[selectedCustomSourceId];
                    if (!siteConfig) {
                        translationKeysAvailable = false;
                    } else {
                        currentTranslationModelForProvider = `custom_source_${selectedCustomSourceId}`;
                        translationModelConfigForProcess = siteConfig;
                        translationModelDisplayName = siteConfig.displayName || siteConfig.name || selectedCustomSourceId;
                    }
                }
            } else {
                // 预设模型
                currentTranslationModelForProvider = selectedTranslationModelName;
                translationModelConfigForProcess = typeof global.loadModelConfig === 'function' ? global.loadModelConfig(selectedTranslationModelName) : {};
                translationModelDisplayName = translationModelConfigForProcess?.displayName || selectedTranslationModelName;
            }

            // 使用 KeyProvider 检查
            if (currentTranslationModelForProvider) {
                const translationKeyProvider = new KeyProvider(currentTranslationModelForProvider);
                translationKeysAvailable = translationKeyProvider.hasAvailableKeys();
            }
        }

        // 更新按钮禁用状态和验证提示
        const hasValidationIssues = (hasPdfFiles && !mistralKeysAvailable) || (!translationKeysAvailable && selectedTranslationModelName !== 'none');
        processBtn.disabled = effectiveFiles.length === 0 || isProcessing || hasValidationIssues;

        // 更新验证状态提示
        updateValidationAlert(effectiveFiles, hasPdfFiles, mistralKeysAvailable, translationKeysAvailable, selectedTranslationModelName, translationModelDisplayName, isProcessing);

        if (isProcessing) {
            processBtn.innerHTML = `<iconify-icon icon="carbon:hourglass" class="mr-1 animate-spin"></iconify-icon>处理中...`;
        } else {
            processBtn.innerHTML = `<iconify-icon icon="carbon:play" class="mr-1"></iconify-icon>开始处理`;
        }
    }

    function updateValidationAlert(effectiveFiles, hasPdfFiles, mistralKeysAvailable, translationKeysAvailable, selectedTranslationModel, translationModelDisplayName, isProcessing) {
        const validationAlert = document.getElementById('validationAlert');
        const validationIcon = document.getElementById('validationIcon');
        const validationTitle = document.getElementById('validationTitle');
        const validationMessage = document.getElementById('validationMessage');
        const validationActions = document.getElementById('validationActions');

        if (!validationAlert || !validationIcon || !validationTitle || !validationMessage || !validationActions) return;

        // 如果正在处理或没有文件，隐藏提示
        if (isProcessing || effectiveFiles.length === 0) {
            validationAlert.classList.add('hidden');
            return;
        }

        // 检查各种验证条件
        const issues = [];

        if (hasPdfFiles && !mistralKeysAvailable && ocrEngine === 'mistral') {
            issues.push({
                type: 'no-mistral-key',
                title: '缺少 Mistral API Key',
                message: '您上传了 PDF 文件，需要配置 Mistral API Key 才能进行 OCR 识别。配置后可点击右上角刷新按钮更新状态。',
                icon: 'carbon:warning-alt',
                color: 'amber',
                actions: [
                    { text: '去配置 Key', link: '#', onClick: () => {
                        const keyManagerBtn = document.getElementById('modelKeyManagerBtn');
                        if (keyManagerBtn) keyManagerBtn.click();
                    }}
                ]
            });
        }

        if (selectedTranslationModel && selectedTranslationModel !== 'none' && !translationKeysAvailable) {
            const isCustomSource = selectedTranslationModel === 'custom';
            let message = '';
            let actions = [];

            if (isCustomSource) {
                message = `源站 "${translationModelDisplayName}" 没有可用的 API Key。请添加 Key 后再处理，配置后可点击右上角刷新按钮更新状态。`;
                actions = [
                    { text: '去配置该源站 Key', link: '#', onClick: () => {
                        const keyManagerBtn = document.getElementById('modelKeyManagerBtn');
                        if (keyManagerBtn) keyManagerBtn.click();
                    }},
                    { text: '关闭翻译', link: '#', onClick: () => {
                        const translationModelSelect = document.getElementById('translationModel');
                        if (translationModelSelect) {
                            translationModelSelect.value = 'none';
                            translationModelSelect.dispatchEvent(new Event('change'));
                        }
                    }}
                ];
            } else {
                message = `模型 "${translationModelDisplayName}" 没有可用的 API Key。请添加 Key 后再处理，配置后可点击右上角刷新按钮更新状态。`;
                actions = [
                    { text: '去配置 Key', link: '#', onClick: () => {
                        const keyManagerBtn = document.getElementById('modelKeyManagerBtn');
                        if (keyManagerBtn) keyManagerBtn.click();
                    }},
                    { text: '关闭翻译', link: '#', onClick: () => {
                        const translationModelSelect = document.getElementById('translationModel');
                        if (translationModelSelect) {
                            translationModelSelect.value = 'none';
                            translationModelSelect.dispatchEvent(new Event('change'));
                        }
                    }}
                ];
            }

            issues.push({
                type: 'no-translation-key',
                title: '缺少翻译配置',
                message: message,
                icon: 'carbon:warning-alt',
                color: 'amber',
                actions: actions
            });
        }

        // 如果没有问题，隐藏提示
        if (issues.length === 0) {
            validationAlert.classList.add('hidden');
            return;
        }

        // 显示所有问题
        if (issues.length > 0) {
            // 如果有多个问题，合并显示
            if (issues.length > 1) {
                validationIcon.setAttribute('icon', 'carbon:warning-alt');
                validationTitle.textContent = '配置检查';

                // 合并所有问题的消息
                const messages = issues.map(issue => `• ${issue.message}`).join('\n');
                validationMessage.innerHTML = messages.replace(/\n/g, '<br>');

                // 合并所有操作按钮
                validationActions.innerHTML = '';
                const addedButtons = new Set(); // 避免重复按钮
                issues.forEach(issue => {
                    issue.actions.forEach(action => {
                        if (!addedButtons.has(action.text)) {
                            addedButtons.add(action.text);
                            const btn = document.createElement('button');
                            btn.className = 'text-xs px-3 py-1.5 bg-white/80 hover:bg-white border border-current/20 hover:border-current/40 rounded-md transition-all font-medium shadow-sm';
                            btn.textContent = action.text;
                            if (action.onClick) {
                                btn.onclick = action.onClick;
                            }
                            validationActions.appendChild(btn);
                        }
                    });
                });
            } else {
                // 只有一个问题，正常显示
                const issue = issues[0];
                validationIcon.setAttribute('icon', issue.icon);
                validationTitle.textContent = issue.title;
                validationMessage.textContent = issue.message;

                validationActions.innerHTML = '';
                issue.actions.forEach(action => {
                    const btn = document.createElement('button');
                    btn.className = 'text-xs px-3 py-1.5 bg-white/80 hover:bg-white border border-current/20 hover:border-current/40 rounded-md transition-all font-medium shadow-sm';
                    btn.textContent = action.text;
                    if (action.onClick) {
                        btn.onclick = action.onClick;
                    }
                    validationActions.appendChild(btn);
                });
            }

            // 设置颜色主题 - 简洁优雅的样式
            const colorMap = {
                'amber': 'border-amber-400 bg-amber-50/50 text-amber-900',
                'red': 'border-red-400 bg-red-50/50 text-red-900',
                'blue': 'border-blue-400 bg-blue-50/50 text-blue-900'
            };
            validationAlert.className = `mt-6 mb-4 p-3.5 rounded-lg border transition-all shadow-sm ${colorMap['amber']}`;

            validationAlert.classList.remove('hidden');
        } else {
            validationAlert.classList.add('hidden');
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
