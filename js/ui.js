// js/ui.js

// =====================
// UI 相关操作与交互函数
// =====================

// ---------------------
// DOM 元素获取（集中管理，便于维护）
// ---------------------
const mistralApiKeysTextarea = document.getElementById('mistralApiKeys');
const rememberMistralKeyCheckbox = document.getElementById('rememberMistralKey');
const translationApiKeysTextarea = document.getElementById('translationApiKeys');
const rememberTranslationKeyCheckbox = document.getElementById('rememberTranslationKey');
const translationModelSelect = document.getElementById('translationModel');
const customModelSettingsContainer = document.getElementById('customModelSettingsContainer');
const customModelSettings = document.getElementById('customModelSettings');
const advancedSettingsToggle = document.getElementById('advancedSettingsToggle');
const advancedSettings = document.getElementById('advancedSettings');
const advancedSettingsIcon = document.getElementById('advancedSettingsIcon');
const maxTokensPerChunk = document.getElementById('maxTokensPerChunk');
const maxTokensPerChunkValue = document.getElementById('maxTokensPerChunkValue');
const skipProcessedFilesCheckbox = document.getElementById('skipProcessedFiles');
const concurrencyLevelInput = document.getElementById('concurrencyLevel');
const dropZone = document.getElementById('dropZone');
const pdfFileInput = document.getElementById('pdfFileInput');
const browseFilesBtn = document.getElementById('browseFilesBtn');
const fileListContainer = document.getElementById('fileListContainer');
const fileList = document.getElementById('fileList');
const clearFilesBtn = document.getElementById('clearFilesBtn');
const targetLanguage = document.getElementById('targetLanguage');
const processBtn = document.getElementById('processBtn');
const downloadAllBtn = document.getElementById('downloadAllBtn');
const resultsSection = document.getElementById('resultsSection');
const resultsSummary = document.getElementById('resultsSummary');
const progressSection = document.getElementById('progressSection');
const batchProgressText = document.getElementById('batchProgressText');
const concurrentProgressText = document.getElementById('concurrentProgressText');
const progressStep = document.getElementById('progressStep');
const progressPercentage = document.getElementById('progressPercentage');
const progressBar = document.getElementById('progressBar');
const progressLog = document.getElementById('progressLog');
const notificationContainer = document.getElementById('notification-container');
const customModelSettingsToggle = document.getElementById('customModelSettingsToggle');
const customModelSettingsToggleIcon = document.getElementById('customModelSettingsToggleIcon');

// ---------------------
// 文件大小格式化工具
// ---------------------
function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// ---------------------
// 文件列表 UI 更新
// ---------------------
/**
 * 刷新文件列表区域，支持移除操作
 */
function updateFileListUI(pdfFiles, isProcessing, onRemoveFile) {
    fileList.innerHTML = '';
    if (pdfFiles.length > 0) {
        fileListContainer.classList.remove('hidden');
        pdfFiles.forEach((file, index) => {
            const listItem = document.createElement('div');
            listItem.className = 'file-list-item';
            listItem.innerHTML = `
                <div class="flex items-center overflow-hidden mr-2">
                    <iconify-icon icon="carbon:document-pdf" class="text-red-500 mr-2 flex-shrink-0" width="20"></iconify-icon>
                    <span class="text-sm text-gray-800 truncate" title="${file.name}">${file.name}</span>
                    <span class="text-xs text-gray-500 ml-2 flex-shrink-0">(${formatFileSize(file.size)})</span>
                </div>
                <button data-index="${index}" class="remove-file-btn text-gray-400 hover:text-red-600 flex-shrink-0">
                    <iconify-icon icon="carbon:close" width="16"></iconify-icon>
                </button>
            `;
            fileList.appendChild(listItem);
        });

        document.querySelectorAll('.remove-file-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                if (isProcessing) return;
                const indexToRemove = parseInt(e.currentTarget.getAttribute('data-index'));
                onRemoveFile(indexToRemove); // 调用回调函数处理删除逻辑
            });
        });
        // ========== 新增：文件列表刷新时刷新 window.data ==========
        if (pdfFiles.length === 1) {
            window.data = { name: pdfFiles[0].name, ocr: '', translation: '', images: [], summaries: {} };
        } else if (pdfFiles.length === 0) {
            window.data = {};
        } else {
            window.data = { summaries: {} };
        }
    } else {
        fileListContainer.classList.add('hidden');
        window.data = {};
    }
}

// ---------------------
// 处理按钮状态更新
// ---------------------
function updateProcessButtonState(pdfFiles, isProcessing) {
    const mistralKeys = mistralApiKeysTextarea.value
        .split('\n')
        .map(k => k.trim())
        .filter(k => k !== '');
    processBtn.disabled = pdfFiles.length === 0 || mistralKeys.length === 0 || isProcessing;

    // 按处理状态切换按钮内容
    if (isProcessing) {
        processBtn.innerHTML = `<iconify-icon icon="carbon:hourglass" class="mr-2 animate-spin" width="20"></iconify-icon> <span>处理中...</span>`;
    } else {
        processBtn.innerHTML = `<iconify-icon icon="carbon:play" class="mr-2" width="20"></iconify-icon> <span>开始处理</span>`;
    }
}

// ---------------------
// 翻译相关 UI 显隐
// ---------------------
function updateTranslationUIVisibility(isProcessing) {
    const translationModelValue = translationModelSelect.value;
    const translationApiKeyDiv = translationApiKeysTextarea.closest('div').parentNode;
    const translationKeys = translationApiKeysTextarea.value
        .split('\n')
        .map(k => k.trim())
        .filter(k => k !== '');

    if (translationModelValue !== 'none') {
        translationApiKeyDiv.style.display = 'block';
        if (translationKeys.length === 0 && !isProcessing) {
            const textarea = translationApiKeyDiv.querySelector('textarea');
            if (textarea) {
                textarea.classList.add('border-red-500', 'focus:border-red-500', 'focus:ring-red-500');
            }
        } else {
            const textarea = translationApiKeyDiv.querySelector('textarea');
            if (textarea) {
                textarea.classList.remove('border-red-500', 'focus:border-red-500', 'focus:ring-red-500');
            }
        }
    } else {
        translationApiKeyDiv.style.display = 'none';
        const textarea = translationApiKeyDiv.querySelector('textarea');
        if (textarea) {
            textarea.classList.remove('border-red-500', 'focus:border-red-500', 'focus:ring-red-500');
        }
    }

    if (translationModelValue === 'custom') {
        customModelSettingsContainer.classList.remove('hidden');
        customModelSettings.classList.remove('hidden');
    } else {
        customModelSettingsContainer.classList.add('hidden');
        customModelSettings.classList.add('hidden');
    }
}

// ---------------------
// 结果与进度区域 UI
// ---------------------
function showResultsSection(successCount, skippedCount, errorCount, pdfFilesLength) {
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

// ---------------------
// 并发与进度条 UI
// ---------------------
function updateConcurrentProgress(count) {
    concurrentProgressText.textContent = `当前并发任务数: ${count}`;
}

function updateOverallProgress(success, skipped, errors, totalFiles) {
    const completedCount = success + skipped + errors;
    if (totalFiles > 0) {
        const percentage = totalFiles > 0 ? Math.round((completedCount / totalFiles) * 100) : 0;
        batchProgressText.textContent = `整体进度: ${completedCount} / ${totalFiles} 完成`;
        progressPercentage.textContent = `${percentage}%`;
        progressBar.style.width = `${percentage}%`;
    } else {
        batchProgressText.textContent = '';
        progressPercentage.textContent = `0%`;
        progressBar.style.width = `0%`;
    }
}

function updateProgress(stepText, percentage) {
    progressStep.textContent = stepText;
}

// ---------------------
// 日志与通知系统
// ---------------------
function addProgressLog(text) {
    const logElement = progressLog;
    const timestamp = new Date().toLocaleTimeString();
    const logLine = document.createElement('div');
    logLine.textContent = `[${timestamp}] ${text}`;
    logElement.appendChild(logLine);
    logElement.scrollTop = logElement.scrollHeight;
}

/**
 * 显示通知（支持 info/success/warning/error）
 */
function showNotification(message, type = 'info', duration = 5000) {
    const notification = document.createElement('div');
    notification.className = 'pointer-events-auto w-full max-w-sm overflow-hidden rounded-lg bg-white shadow-lg ring-1 ring-black ring-opacity-5 mb-2 transition-all duration-300 ease-in-out transform translate-x-full opacity-0';

    let iconName, iconColor, borderColor;
    switch (type) {
        case 'success': iconName = 'carbon:checkmark-filled'; iconColor = 'text-green-500'; borderColor = 'border-green-500'; break;
        case 'error': iconName = 'carbon:error-filled'; iconColor = 'text-red-500'; borderColor = 'border-red-500'; break;
        case 'warning': iconName = 'carbon:warning-filled'; iconColor = 'text-yellow-500'; borderColor = 'border-yellow-500'; break;
        default: iconName = 'carbon:information-filled'; iconColor = 'text-blue-500'; borderColor = 'border-blue-500'; break;
    }

    notification.innerHTML = `
        <div class="p-4 border-l-4 ${borderColor}">
          <div class="flex items-start">
            <div class="flex-shrink-0">
              <iconify-icon icon="${iconName}" class="h-6 w-6 ${iconColor}" aria-hidden="true"></iconify-icon>
            </div>
            <div class="ml-3 w-0 flex-1 pt-0.5">
              <p class="text-sm font-medium text-gray-900">通知</p>
              <p class="mt-1 text-sm text-gray-500 break-words">${message}</p>
            </div>
            <div class="ml-4 flex flex-shrink-0">
              <button type="button" class="inline-flex rounded-md bg-white text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2">
                <span class="sr-only">关闭</span>
                <iconify-icon icon="carbon:close" class="h-5 w-5" aria-hidden="true"></iconify-icon>
              </button>
            </div>
          </div>
        </div>
    `;

    notificationContainer.appendChild(notification);

    requestAnimationFrame(() => {
        notification.classList.remove('translate-x-full', 'opacity-0');
        notification.classList.add('translate-x-0', 'opacity-100');
    });

    const closeButton = notification.querySelector('button');
    const closeFunc = () => closeNotification(notification);
    closeButton.addEventListener('click', closeFunc);

    const timeout = setTimeout(closeFunc, duration);
    notification.dataset.timeout = timeout;

    return notification;
}

function closeNotification(notification) {
    if (!notification || !notification.parentNode) return;

    clearTimeout(notification.dataset.timeout);
    notification.classList.remove('translate-x-0', 'opacity-100');
    notification.classList.add('translate-x-full', 'opacity-0');

    setTimeout(() => {
        if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
        }
    }, 300);
}

// --- 导出 UI 相关函数 ---
// (根据需要选择性导出，如果使用模块化导入/导出)
// export { updateFileListUI, updateProcessButtonState, ... };

document.addEventListener('DOMContentLoaded', function() {
    // ... 其它初始化 ...
    if (customModelSettingsToggle && customModelSettings && customModelSettingsToggleIcon) {
        customModelSettingsToggle.addEventListener('click', function() {
            customModelSettings.classList.toggle('hidden');
            if (customModelSettings.classList.contains('hidden')) {
                customModelSettingsToggleIcon.setAttribute('icon', 'carbon:chevron-down');
            } else {
                customModelSettingsToggleIcon.setAttribute('icon', 'carbon:chevron-up');
            }
        });
    }
});