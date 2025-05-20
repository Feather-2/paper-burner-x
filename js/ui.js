// js/ui.js

// =====================
// UI 相关操作与交互函数
// =====================

// ---------------------
// Helper Functions (NEW)
// ---------------------
/**
 * 生成一个简单的 UUID (v4) - 仅用于客户端，非加密安全
 * @returns {string}
 */
function _generateUUID_ui() {
    return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
        (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );
}

// ---------------------
// 表单元素创建工具 (NEW - for renderSourceSiteForm)
// ---------------------
/**
 * 创建一个配置项的输入框组件 (label + input)
 * @param {string} id - 输入框的 ID
 * @param {string} labelText - 标签文本
 * @param {string|number} value - 输入框的初始值
 * @param {string} type - 输入框类型 (text, url, number, etc.)
 * @param {string} placeholder - 输入框的占位符
 * @param {function} [onChangeCallback] - (可选) 输入框值改变时的回调函数
 * @param {object} [attributes] - (可选) 额外的属性对象 (e.g., {min: 0, max: 10, step: 1})
 * @returns {HTMLElement} - 包含标签和输入框的 div 元素
 */
function createConfigInput(id, labelText, value, type = 'text', placeholder = '', onChangeCallback, attributes = {}) {
    const wrapper = document.createElement('div');
    wrapper.className = 'mb-3'; // Add some margin for spacing

    const label = document.createElement('label');
    label.htmlFor = id;
    label.className = 'block text-xs font-medium text-gray-600 mb-1';
    label.textContent = labelText;

    const input = document.createElement('input');
    input.type = type;
    input.id = id;
    input.name = id;
    input.value = value;
    input.placeholder = placeholder;
    input.className = 'w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors';

    if (type === 'number') {
        if (attributes.min !== undefined) input.min = attributes.min;
        if (attributes.max !== undefined) input.max = attributes.max;
        if (attributes.step !== undefined) input.step = attributes.step;
    }
    for (const key in attributes) {
        if (key !== 'min' && key !== 'max' && key !== 'step') { // Avoid re-setting handled attributes
            input.setAttribute(key, attributes[key]);
        }
    }

    if (onChangeCallback && typeof onChangeCallback === 'function') {
        input.addEventListener('change', onChangeCallback);
        input.addEventListener('input', onChangeCallback); // For more responsive updates if needed
    }

    wrapper.appendChild(label);
    wrapper.appendChild(input);
    return wrapper;
}

/**
 * 创建一个配置项的下拉选择框组件 (label + select)
 * @param {string} id - 下拉框的 ID
 * @param {string} labelText - 标签文本
 * @param {string} selectedValue - 预选中的值
 * @param {Array<{value: string, text: string}>} optionsArray - 选项数组
 * @param {function} [onChangeCallback] - (可选) 下拉框值改变时的回调函数
 * @returns {HTMLElement} - 包含标签和下拉框的 div 元素
 */
function createConfigSelect(id, labelText, selectedValue, optionsArray, onChangeCallback) {
    const wrapper = document.createElement('div');
    wrapper.className = 'mb-3';

    const label = document.createElement('label');
    label.htmlFor = id;
    label.className = 'block text-xs font-medium text-gray-600 mb-1';
    label.textContent = labelText;

    const select = document.createElement('select');
    select.id = id;
    select.name = id;
    select.className = 'w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors';

    optionsArray.forEach(opt => {
        const optionElement = document.createElement('option');
        optionElement.value = opt.value;
        optionElement.textContent = opt.text;
        if (opt.value === selectedValue) {
            optionElement.selected = true;
        }
        select.appendChild(optionElement);
    });

    if (onChangeCallback && typeof onChangeCallback === 'function') {
        select.addEventListener('change', onChangeCallback);
    }

    wrapper.appendChild(label);
    wrapper.appendChild(select);
    return wrapper;
}

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
const customSourceSiteContainer = document.getElementById('customSourceSiteContainer');
const customSourceSiteSelect = document.getElementById('customSourceSiteSelect');
const customSourceSiteToggleIcon = document.getElementById('customSourceSiteToggleIcon');
const detectModelsBtn = document.getElementById('detectModelsBtn');

// ---------------------
// 自定义源站点下拉列表填充 (NEW)
// ---------------------
/**
 * 填充自定义源站点下拉列表
 * @param {string | null} selectedSiteIdToSet - (可选) 需要预选中的源站点ID
 */
function populateCustomSourceSitesDropdown_ui(selectedSiteIdToSet = null) {
    const dropdown = document.getElementById('customSourceSiteSelect');
    if (!dropdown) {
        console.warn('populateCustomSourceSitesDropdown_ui: customSourceSiteSelect dropdown not found.');
        return;
    }

    dropdown.innerHTML = ''; // 清空现有选项

    let sites = {};
    // Ensure loadAllCustomSourceSites is available (it's defined in storage.js and should be global or on window)
    if (typeof loadAllCustomSourceSites === 'function') {
        sites = loadAllCustomSourceSites();
    } else {
        console.error('populateCustomSourceSitesDropdown_ui: loadAllCustomSourceSites function is not available.');
        const errorOption = document.createElement('option');
        errorOption.value = "";
        errorOption.textContent = "错误:无法加载源站点";
        dropdown.appendChild(errorOption);
        dropdown.disabled = true;
        return;
    }

    const siteIds = Object.keys(sites);

    // 新增：如果没有传入selectedSiteIdToSet，自动读取设置中的selectedCustomSourceSiteId
    if (!selectedSiteIdToSet) {
        const settings = typeof loadSettings === 'function' ? loadSettings() : {};
        selectedSiteIdToSet = settings.selectedCustomSourceSiteId || null;
    }

    if (siteIds.length === 0) {
        const noSitesOption = document.createElement('option');
        noSitesOption.value = "";
        noSitesOption.textContent = "无自定义源站点"; // "No custom source sites"
        dropdown.appendChild(noSitesOption);
        dropdown.disabled = true;
    } else {
        dropdown.disabled = false;

        const placeholderOption = document.createElement('option');
        placeholderOption.value = "";
        placeholderOption.textContent = "-- 请选择源站点 --"; // "-- Select a source site --"
        dropdown.appendChild(placeholderOption);

        siteIds.forEach(id => {
            const site = sites[id];
            const option = document.createElement('option');
            option.value = id;
            option.textContent = site.displayName || `源站 (ID: ${id.substring(0, 8)}...)`;
            dropdown.appendChild(option);
        });

        // 新增：如果有选中的ID，优先选中
        if (selectedSiteIdToSet && sites[selectedSiteIdToSet]) {
            dropdown.value = selectedSiteIdToSet;
        } else {
            // Default to the placeholder if no valid ID is provided or found
            dropdown.value = "";
        }
    }

    // 新增：填充完下拉框后，更新源站点信息面板
    setTimeout(() => {
        if (typeof updateCustomSourceSiteInfo === 'function' && dropdown.value) {
            updateCustomSourceSiteInfo(dropdown.value);
        }
    }, 100);
}
// 将函数挂载到 window 对象，以便 app.js 和 ui.js 内部其他地方通过 window 调用
window.populateCustomSourceSitesDropdown_ui = populateCustomSourceSitesDropdown_ui;

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
        console.log('刷新文件列表:', pdfFiles.map(f => f.name));
    } else {
        fileListContainer.classList.add('hidden');
        window.data = {};
    }
}

// ---------------------
// 处理按钮状态更新
// ---------------------
function updateProcessButtonState(pdfFiles, isProcessing) {
    let mistralKeysAvailable = true; // 默认Key可用，除非检测到需要但没有
    const hasPdfFiles = pdfFiles.some(file => file.name.toLowerCase().endsWith('.pdf'));

    if (hasPdfFiles) {
        // 检查 Mistral keys 是否配置 (假设 loadModelKeys 全局可用或已导入)
        try {
            const mistralKeys = typeof loadModelKeys === 'function' ? loadModelKeys('mistral') : [];
            const usableMistralKeys = mistralKeys.filter(key => key.status === 'valid' || key.status === 'untested');
            if (usableMistralKeys.length === 0) {
                mistralKeysAvailable = false;
            }
        } catch (e) {
            console.warn("Error checking Mistral keys in updateProcessButtonState:", e);
            mistralKeysAvailable = false; // 出错时保守处理，认为Key不可用
        }
    }

    processBtn.disabled = pdfFiles.length === 0 || isProcessing || (hasPdfFiles && !mistralKeysAvailable);

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

    // 控制旧的全局自定义模型设置UI (customModelSettingsContainer)
    if (translationModelValue === 'custom') {
        // customModelSettingsContainer.classList.remove('hidden'); // 旧的全局自定义设置容器，暂时保留，但可能后续移除
        // customModelSettings.classList.remove('hidden'); // 同上

        // 处理模型选择器和输入框的显示/隐藏逻辑 (旧逻辑，可能不再需要，因为配置在Key管理器中)
        const modelSelector = document.getElementById('customModelId'); // 这些ID是旧的全局自定义输入框
        const modelInput = document.getElementById('customModelIdInput');

        if (modelSelector && modelInput) {
            const hasAvailableModels = modelSelector.options.length > 1;
            if (hasAvailableModels) {
                if (modelSelector.value === 'manual-input') {
                    modelInput.style.display = 'block';
                } else {
                    modelInput.style.display = 'none';
                }
            } else {
                modelSelector.style.display = 'none';
                modelInput.style.display = 'block';
            }
        }
    } else {
        // customModelSettingsContainer.classList.add('hidden'); // 旧的全局自定义设置容器
        // customModelSettings.classList.add('hidden');    // 同上
    }

    // ----- 新增：处理自定义源站点下拉列表的显示/隐藏和填充 -----
    if (customSourceSiteContainer && customSourceSiteSelect) {
        if (translationModelValue === 'custom') {
            customSourceSiteContainer.classList.remove('hidden');
            customSourceSiteSelect.disabled = false;
            // 调用填充函数 - populateCustomSourceSitesDropdown_ui 会从设置中尝试获取上次选择的ID
            if (typeof window.populateCustomSourceSitesDropdown_ui === 'function') {
                 window.populateCustomSourceSitesDropdown_ui(); // 让它自己从 loadSettings() 获取 selectedCustomSourceSiteId
            } else {
                console.warn('populateCustomSourceSitesDropdown_ui function not found on window.');
                customSourceSiteSelect.innerHTML = '<option value="">加载函数错误</option>';
            }

            // 更新源站点信息显示 - 新增的调用
            setTimeout(() => {
                if (customSourceSiteSelect.value) {
                    updateCustomSourceSiteInfo(customSourceSiteSelect.value);
                }
            }, 300);
        } else {
            customSourceSiteContainer.classList.add('hidden');
            customSourceSiteSelect.innerHTML = ''; // 清空选项
            customSourceSiteSelect.disabled = true;

            // 新增：隐藏信息和按钮
            const infoContainer = document.getElementById('customSourceSiteInfo');
            const manageKeyBtn = document.getElementById('manageSourceSiteKeyBtn');
            if (infoContainer) infoContainer.classList.add('hidden');
            if (manageKeyBtn) manageKeyBtn.classList.add('hidden');
        }
    }
    // ----- 结束新增 -----
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
    notification.className = 'pointer-events-auto w-full max-w-lg overflow-hidden rounded-lg bg-white shadow-lg ring-1 ring-black ring-opacity-5 mb-2 transition-all duration-300 ease-in-out transform translate-x-full opacity-0';

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
            <div class="ml-3 flex-1 pt-0.5">
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

    const modelKeyManagerBtn = document.getElementById('modelKeyManagerBtn');
    const modelKeyManagerModal = document.getElementById('modelKeyManagerModal');
    const closeModelKeyManager = document.getElementById('closeModelKeyManager');
    const modelListColumn = document.getElementById('modelListColumn');
    const modelConfigColumn = document.getElementById('modelConfigColumn');
    const keyManagerColumn = document.getElementById('keyManagerColumn');

    let currentManagerUI = null;
    let selectedModelForManager = null;
    let currentSelectedSourceSiteId = null; // 新增: 当前选中的自定义源站ID

    const supportedModelsForKeyManager = [
        { key: 'mistral', name: 'Mistral OCR' },
        { key: 'deepseek', name: 'DeepSeek v3' },
        { key: 'gemini', name: 'Gemini 2.0 Flash' },
        { key: 'gemini-preview', name: 'Gemini-2.5 Preview' },
        { key: 'tongyi-deepseek-v3', name: '通义百炼 DeepSeek v3' },
        { key: 'tongyi-qwen-turbo', name: '通义百炼 Qwen Turbo' },
        { key: 'volcano-deepseek-v3', name: '火山引擎 DeepSeek v3' },
        { key: 'volcano-doubao', name: '火山引擎 豆包1.5-Pro' },
        { key: 'custom', name: '自定义翻译模型' }
    ];

    if (modelKeyManagerBtn && modelKeyManagerModal && closeModelKeyManager && modelListColumn && modelConfigColumn && keyManagerColumn) {
        modelKeyManagerBtn.addEventListener('click', function() {
            if (typeof migrateLegacyCustomConfig === 'function') { // 确保迁移已执行
                migrateLegacyCustomConfig();
            }
            renderModelList();
            if (!selectedModelForManager && supportedModelsForKeyManager.length > 0) {
                selectModelForManager(supportedModelsForKeyManager[0].key);
            } else if (selectedModelForManager) {
                selectModelForManager(selectedModelForManager);
            }
            modelKeyManagerModal.classList.remove('hidden');
        });
        closeModelKeyManager.addEventListener('click', function() {
            modelKeyManagerModal.classList.add('hidden');
            currentSelectedSourceSiteId = null; // 重置选中源站
        });
    }

    function renderModelList() {
        modelListColumn.innerHTML = '';

        // 先插入导入/导出按钮
        const exportAllBtn = document.createElement('button');
        exportAllBtn.innerHTML = '<iconify-icon icon="carbon:export" class="mr-1"></iconify-icon>导出全部配置';
        exportAllBtn.className = 'w-full text-left px-3 py-2 text-sm rounded-md flex items-center hover:bg-gray-100 transition-colors';

        const importAllBtn = document.createElement('button');
        importAllBtn.innerHTML = '<iconify-icon icon="carbon:import" class="mr-1"></iconify-icon>导入全部配置';
        importAllBtn.className = 'w-full text-left px-3 py-2 text-sm rounded-md flex items-center hover:bg-gray-100 transition-colors mb-2';

        exportAllBtn.addEventListener('click', () => {
            KeyManagerUI.exportAllModelData();
        });
        importAllBtn.addEventListener('click', () => {
            KeyManagerUI.importAllModelData(() => {
                if (typeof renderModelList === 'function') renderModelList();
                if (typeof keyManagerColumn !== 'undefined' && typeof selectedModelForManager !== 'undefined') {
                    renderKeyManagerForModel(selectedModelForManager);
                }
            });
        });

        modelListColumn.appendChild(exportAllBtn);
        modelListColumn.appendChild(importAllBtn);

        // 再插入模型按钮
        supportedModelsForKeyManager.forEach(model => {
            const button = document.createElement('button');
            button.textContent = model.name;
            button.dataset.modelKey = model.key;
            button.className = 'w-full text-left px-3 py-2 text-sm rounded-md transition-colors ';
            if (model.key === selectedModelForManager) {
                button.classList.add('bg-blue-100', 'text-blue-700', 'font-semibold');
            } else {
                button.classList.add('hover:bg-gray-200', 'text-gray-700');
            }
            button.addEventListener('click', () => selectModelForManager(model.key));
            modelListColumn.appendChild(button);
        });
    }

    function selectModelForManager(modelKey) {
        selectedModelForManager = modelKey;
        currentSelectedSourceSiteId = null; //切换主模型类型时，重置自定义源站选择
        renderModelList();
        renderModelConfigSection(modelKey);

        if (modelKey !== 'custom') {
            renderKeyManagerForModel(modelKey);
        } else {
            // 对于 'custom', renderSourceSitesList (由 renderModelConfigSection 调用)
            // 将处理第一个源站的选择和其 Key 管理器的渲染
            // 如果没有源站，keyManagerColumn 会显示提示
        }
    }

    function renderModelConfigSection(modelKey) {
        modelConfigColumn.innerHTML = '';
        const modelDefinition = supportedModelsForKeyManager.find(m => m.key === modelKey);
        if (!modelDefinition) return;

        const title = document.createElement('h3');
        title.className = 'text-lg font-semibold mb-3 text-gray-800';
        modelConfigColumn.appendChild(title);

        if (modelKey === 'custom') {
            title.textContent = `自定义源站管理`;

            const addNewButton = document.createElement('button');
            addNewButton.id = 'addNewSourceSiteBtn';
            addNewButton.innerHTML = '<iconify-icon icon="carbon:add-filled" class="mr-2"></iconify-icon>添加新源站';
            addNewButton.className = 'mb-4 px-3 py-1.5 text-sm bg-green-500 hover:bg-green-600 text-white rounded transition-colors flex items-center';
            addNewButton.addEventListener('click', () => {
                currentSelectedSourceSiteId = null; // 清除选中状态，表示新增
                renderSourceSitesList(); // 更新列表，移除高亮
                renderSourceSiteForm(null);
            });
            modelConfigColumn.appendChild(addNewButton);

            const sitesListContainer = document.createElement('div');
            sitesListContainer.id = 'sourceSitesListContainer';
            modelConfigColumn.appendChild(sitesListContainer);

            const siteConfigFormContainer = document.createElement('div');
            siteConfigFormContainer.id = 'sourceSiteConfigFormContainer';
            siteConfigFormContainer.className = 'mt-4 p-4 border border-gray-200 rounded-md hidden';
            modelConfigColumn.appendChild(siteConfigFormContainer);

            renderSourceSitesList();

            if (!currentSelectedSourceSiteId && Object.keys(loadAllCustomSourceSites()).length === 0) {
                 keyManagerColumn.innerHTML = '<p class="text-sm text-gray-500">请添加并选择一个源站以管理其 API Keys。</p>';
            } else if (!currentSelectedSourceSiteId) {
                keyManagerColumn.innerHTML = '<p class="text-sm text-gray-500">请从上方列表选择一个源站以管理其 API Keys。</p>';
            }

        } else {
            title.textContent = `${modelDefinition.name} - 配置`;
            // 移除旧的自定义模型配置相关代码，因为它们现在通过源站管理
            const existingInputs = modelConfigColumn.querySelectorAll('input, select, button, p, div:not(#sourceSitesListContainer):not(#sourceSiteConfigFormContainer)');
            existingInputs.forEach(el => {
                if(el.id !== 'addNewSourceSiteBtn') el.remove();
            });

            const info = document.createElement('p');
            info.textContent = '此预设模型没有额外的可配置项。';
            info.className = 'text-sm text-gray-600';
            modelConfigColumn.appendChild(info);
        }
    }

    function renderSourceSitesList() {
        const sitesListContainer = document.getElementById('sourceSitesListContainer');
        if (!sitesListContainer) return;
        sitesListContainer.innerHTML = '';

        const sites = loadAllCustomSourceSites();
        const siteIds = Object.keys(sites);

        if (siteIds.length === 0) {
            sitesListContainer.innerHTML = '<p class="text-sm text-gray-500">还没有自定义源站。请点击上方按钮添加一个。</p>';
            document.getElementById('sourceSiteConfigFormContainer').classList.add('hidden');
            if (selectedModelForManager === 'custom') {
                 keyManagerColumn.innerHTML = '<p class="text-sm text-gray-500">请添加并选择一个源站以管理其 API Keys。</p>';
            }
            return;
        }

        const ul = document.createElement('ul');
        ul.className = 'space-y-2';

        siteIds.forEach(id => {
            const site = sites[id];
            const li = document.createElement('li');
            li.className = `p-3 border rounded-md flex justify-between items-center cursor-pointer hover:bg-gray-100 transition-colors ${currentSelectedSourceSiteId === id ? 'bg-blue-50 border-blue-300 shadow-md' : 'bg-white'}`;
            li.dataset.siteId = id;

            li.addEventListener('click', () => {
                selectSourceSite(id);
            });

            const displayNameSpan = document.createElement('span');
            displayNameSpan.textContent = site.displayName || `源站 (ID: ${id.substring(0,8)}...)`;
            displayNameSpan.className = 'font-medium text-sm text-gray-700 flex-grow';

            const buttonsDiv = document.createElement('div');
            buttonsDiv.className = 'space-x-2 flex-shrink-0';

            const editButton = document.createElement('button');
            editButton.innerHTML = '<iconify-icon icon="carbon:edit" width="16"></iconify-icon>';
            editButton.title = '编辑此源站配置';
            editButton.className = 'p-1.5 text-gray-500 hover:text-blue-700 rounded hover:bg-blue-100';
            editButton.addEventListener('click', (e) => {
                e.stopPropagation();
                currentSelectedSourceSiteId = id;
                renderSourceSitesList();
                renderSourceSiteForm(site);
                keyManagerColumn.innerHTML = '<p class="text-sm text-gray-500">编辑源站配置中。保存或取消以管理 Keys。</p>';
            });

            const deleteButton = document.createElement('button');
            deleteButton.innerHTML = '<iconify-icon icon="carbon:trash-can" width="16"></iconify-icon>';
            deleteButton.title = '删除此源站';
            deleteButton.className = 'p-1.5 text-gray-500 hover:text-red-700 rounded hover:bg-red-100';
            deleteButton.addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm(`确定要删除源站 "${site.displayName || id}" 吗？其关联的API Keys也将被删除。`)) {
                    deleteCustomSourceSite(id);
                    if (typeof showNotification === 'function') showNotification(`源站 "${site.displayName || id}" 已删除。`, 'success');
                    if (currentSelectedSourceSiteId === id) {
                        currentSelectedSourceSiteId = null;
                        keyManagerColumn.innerHTML = '<p class="text-sm text-gray-500">请选择一个源站以管理其 API Keys。</p>';
                        document.getElementById('sourceSiteConfigFormContainer').classList.add('hidden');
                    }
                    renderSourceSitesList();
                }
            });

            buttonsDiv.appendChild(editButton);
            buttonsDiv.appendChild(deleteButton);

            li.appendChild(displayNameSpan);
            li.appendChild(buttonsDiv);
            ul.appendChild(li);
        });
        sitesListContainer.appendChild(ul);

        if (!currentSelectedSourceSiteId && siteIds.length > 0) {
            selectSourceSite(siteIds[0]);
        } else if (currentSelectedSourceSiteId && sites[currentSelectedSourceSiteId]) {
            renderKeyManagerForModel(`custom_source_${currentSelectedSourceSiteId}`);
        } else if (siteIds.length > 0) { // Has sites, but nothing selected (e.g. after a delete)
             keyManagerColumn.innerHTML = '<p class="text-sm text-gray-500">请选择一个源站以管理其 API Keys。</p>';
             document.getElementById('sourceSiteConfigFormContainer').classList.add('hidden');
        }
    }

    function selectSourceSite(siteId) {
        currentSelectedSourceSiteId = siteId;
        const sites = loadAllCustomSourceSites();
        const site = sites[siteId];

        if (site) {
            renderKeyManagerForModel(`custom_source_${siteId}`);
            const formContainer = document.getElementById('sourceSiteConfigFormContainer');
            if (formContainer) {
                formContainer.classList.add('hidden');
                formContainer.innerHTML = '';
            }
        }
        renderSourceSitesList();
    }

    function renderSourceSiteForm(siteData) {
        const formContainer = document.getElementById('sourceSiteConfigFormContainer');
        if (!formContainer) return;
        formContainer.innerHTML = '';
        formContainer.classList.remove('hidden');

        const isEditing = siteData !== null;
        const formTitleText = isEditing ? `编辑源站: ${siteData.displayName || '未命名'}` : '添加新源站';

        const formTitle = document.createElement('h4');
        formTitle.textContent = formTitleText;
        formTitle.className = 'text-md font-semibold mb-3 text-gray-700';
        formContainer.appendChild(formTitle);

        const form = document.createElement('form');
        form.className = 'space-y-3';

        const siteIdForForm = isEditing ? siteData.id : _generateUUID_ui();

        form.appendChild(createConfigInput(`sourceDisplayName_${siteIdForForm}`, '显示名称 *', isEditing ? siteData.displayName : '', 'text', '例如: 我的备用 OpenAI', () => {}));
        form.appendChild(createConfigInput(`sourceApiBaseUrl_${siteIdForForm}`, 'API Base URL *', isEditing ? siteData.apiBaseUrl : '', 'url', '例如: https://api.openai.com/v1', () => {}));

        // --- Enhanced Model ID Input with Detection ---
        const modelIdGroup = document.createElement('div');
        modelIdGroup.className = 'mb-3';

        const modelIdLabel = document.createElement('label');
        modelIdLabel.htmlFor = `sourceModelId_${siteIdForForm}`;
        modelIdLabel.className = 'block text-xs font-medium text-gray-600 mb-1';
        modelIdLabel.textContent = '默认模型 ID *';
        modelIdGroup.appendChild(modelIdLabel);

        const modelIdInputContainer = document.createElement('div');
        modelIdInputContainer.id = `sourceModelIdInputContainer_${siteIdForForm}`; // Container to hold input/select
        modelIdInputContainer.className = 'flex items-center space-x-2';

        let modelIdEditableElement = document.createElement('input');
        modelIdEditableElement.type = 'text';
        modelIdEditableElement.id = `sourceModelId_${siteIdForForm}`;
        modelIdEditableElement.name = `sourceModelId_${siteIdForForm}`;
        modelIdEditableElement.value = isEditing ? siteData.modelId : '';
        modelIdEditableElement.placeholder = '例如: gpt-4-turbo';
        modelIdEditableElement.className = 'w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors flex-grow';
        modelIdInputContainer.appendChild(modelIdEditableElement);

        const detectModelsButton = document.createElement('button');
        detectModelsButton.type = 'button';
        detectModelsButton.innerHTML = '<iconify-icon icon="carbon:search-locate" class="mr-1"></iconify-icon>检测';
        detectModelsButton.title = '从此 Base URL 检测可用模型';
        detectModelsButton.className = 'px-3 py-1.5 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded transition-colors flex-shrink-0 flex items-center';
        modelIdInputContainer.appendChild(detectModelsButton);
        modelIdGroup.appendChild(modelIdInputContainer);

        // Temporary API Key for detection
        const tempApiKeyInput = createConfigInput(`sourceTempApiKey_${siteIdForForm}`, 'API Key (仅用于模型检测)', '', 'password', '输入一个Key来检测模型', null, {autocomplete: 'new-password'});
        tempApiKeyInput.classList.add('text-xs'); // Smaller label
        tempApiKeyInput.querySelector('label').classList.add('text-gray-500');
        tempApiKeyInput.querySelector('input').classList.add('text-xs', 'py-1');
        modelIdGroup.appendChild(tempApiKeyInput); // Add it below the model ID input group

        form.appendChild(modelIdGroup);
        // Event listener for detectModelsButton
        detectModelsButton.addEventListener('click', async () => {
            const baseUrl = document.getElementById(`sourceApiBaseUrl_${siteIdForForm}`).value.trim();
            const tempApiKey = document.getElementById(`sourceTempApiKey_${siteIdForForm}`).value.trim();

            if (!baseUrl) {
                showNotification('请输入 API Base URL 以检测模型。', 'warning');
                return;
            }
            if (!tempApiKey) {
                showNotification('请输入一个临时 API Key 以检测模型。', 'warning');
                return;
            }

            detectModelsButton.disabled = true;
            detectModelsButton.innerHTML = '<iconify-icon icon="carbon:circle-dash" class="animate-spin mr-1"></iconify-icon>检测中...';

            try {
                const detectedModels = await window.modelDetector.detectModelsForModal(baseUrl, tempApiKey);
                showNotification(`检测到 ${detectedModels.length} 个模型。`, 'success');

                const currentModelIdValue = document.getElementById(`sourceModelId_${siteIdForForm}`).value;
                const newSelect = document.createElement('select');
                newSelect.id = `sourceModelId_${siteIdForForm}`; // Keep the same ID for form submission
                newSelect.name = `sourceModelId_${siteIdForForm}`;
                newSelect.className = 'w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors flex-grow';

                // Option for manual input
                const manualOption = document.createElement('option');
                manualOption.value = "__manual_input__"; // Special value
                manualOption.textContent = "-- 手动输入其他模型 --";
                newSelect.appendChild(manualOption);

                detectedModels.forEach(model => {
                    const option = document.createElement('option');
                    option.value = model.id;
                    option.textContent = model.name || model.id;
                    newSelect.appendChild(option);
                });

                // Replace the input with the select
                const inputContainer = document.getElementById(`sourceModelIdInputContainer_${siteIdForForm}`);
                const oldInput = document.getElementById(`sourceModelId_${siteIdForForm}`);
                inputContainer.insertBefore(newSelect, oldInput); // Insert select before old input
                if(oldInput) oldInput.remove(); // Remove the old text input
                modelIdEditableElement = newSelect; // Update reference

                // Try to set the value
                let modelFoundInSelect = false;
                if (currentModelIdValue) {
                    const existingOption = Array.from(newSelect.options).find(opt => opt.value === currentModelIdValue);
                    if (existingOption) {
                        newSelect.value = currentModelIdValue;
                        modelFoundInSelect = true;
                    }
                }
                if (!modelFoundInSelect && detectedModels.length > 0 && !currentModelIdValue) {
                     newSelect.value = detectedModels[0].id; // Default to first detected if no prior value
                } else if (!modelFoundInSelect && currentModelIdValue) {
                    newSelect.value = "__manual_input__"; // Fallback to manual if current value not in list
                    // We might need to re-create a text input here if manual is selected and there was a value
                    // For now, this just selects "manual input" in the dropdown.
                }

                // If manual input is selected, and there was a value, we might want to show a text input again.
                // This part can be enhanced later for a smoother UX when switching back to manual from select.

            } catch (error) {
                showNotification(`模型检测失败: ${error.message}`, 'error');
                console.error("Model detection error in form:", error);
            } finally {
                detectModelsButton.disabled = false;
                detectModelsButton.innerHTML = '<iconify-icon icon="carbon:search-locate" class="mr-1"></iconify-icon>检测';
            }
        });
        // --- End of Enhanced Model ID Input ---

        const requestFormatOptions = [
            { value: 'openai', text: 'OpenAI 格式' }, { value: 'anthropic', text: 'Anthropic 格式' }, { value: 'gemini', text: 'Google Gemini 格式' }
        ];
        form.appendChild(createConfigSelect(`sourceRequestFormat_${siteIdForForm}`, '请求格式', isEditing ? siteData.requestFormat : 'openai', requestFormatOptions, () => {}));

        form.appendChild(createConfigInput(`sourceTemperature_${siteIdForForm}`, '温度 (0-2)', isEditing ? siteData.temperature : 0.5, 'number', '0.5', () => {}, {min:0, max:2, step:0.01}));
        form.appendChild(createConfigInput(`sourceMaxTokens_${siteIdForForm}`, '最大 Tokens', isEditing ? siteData.max_tokens : 8000, 'number', '8000', () => {}, {min:1, step:1}));

        const buttonsDiv = document.createElement('div');
        buttonsDiv.className = 'flex space-x-2 pt-3 border-t mt-2';

        const saveButton = document.createElement('button');
        saveButton.type = 'submit';
        saveButton.innerHTML = '<iconify-icon icon="carbon:save" class="mr-1"></iconify-icon>保存';
        saveButton.className = 'px-3 py-1.5 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded transition-colors flex items-center';

        const cancelButton = document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.textContent = '取消';
        cancelButton.className = 'px-3 py-1.5 text-sm bg-gray-200 hover:bg-gray-300 text-gray-700 rounded transition-colors';
        cancelButton.addEventListener('click', () => {
            formContainer.classList.add('hidden');
            formContainer.innerHTML = '';
            if (currentSelectedSourceSiteId) {
                selectSourceSite(currentSelectedSourceSiteId);
            } else if (Object.keys(loadAllCustomSourceSites()).length > 0){
                selectSourceSite(Object.keys(loadAllCustomSourceSites())[0]);
            } else {
                 keyManagerColumn.innerHTML = '<p class="text-sm text-gray-500">请选择或添加一个源站以管理其 API Keys。</p>';
            }
        });

        buttonsDiv.appendChild(saveButton);
        buttonsDiv.appendChild(cancelButton);
        form.appendChild(buttonsDiv);

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const newSiteData = {
                id: siteIdForForm,
                displayName: document.getElementById(`sourceDisplayName_${siteIdForForm}`).value.trim(),
                apiBaseUrl: document.getElementById(`sourceApiBaseUrl_${siteIdForForm}`).value.trim(),
                // Get modelId from the input/select, which now shares the same ID
                modelId: document.getElementById(`sourceModelId_${siteIdForForm}`).value === '__manual_input__' ? '' : document.getElementById(`sourceModelId_${siteIdForForm}`).value.trim(),
                requestFormat: document.getElementById(`sourceRequestFormat_${siteIdForForm}`).value,
                temperature: parseFloat(document.getElementById(`sourceTemperature_${siteIdForForm}`).value),
                max_tokens: parseInt(document.getElementById(`sourceMaxTokens_${siteIdForForm}`).value),
                availableModels: isEditing && siteData.availableModels ? siteData.availableModels : []
            };

            if (!newSiteData.displayName || !newSiteData.apiBaseUrl || !newSiteData.modelId) {
                if (typeof showNotification === 'function') showNotification('显示名称、API Base URL 和模型 ID 不能为空！', 'error');
                return;
            }

            saveCustomSourceSite(newSiteData);
            if (typeof showNotification === 'function') showNotification(`源站 "${newSiteData.displayName}" 已${isEditing ? '更新' : '添加'}。`, 'success');
            formContainer.classList.add('hidden');
            formContainer.innerHTML = '';
            currentSelectedSourceSiteId = siteIdForForm;
            renderSourceSitesList();
            selectSourceSite(siteIdForForm);
        });
        formContainer.appendChild(form);
        document.getElementById(`sourceDisplayName_${siteIdForForm}`).focus();
    }

    function renderKeyManagerForModel(modelKeyOrSourceSiteModelName) {
        keyManagerColumn.innerHTML = '';
        if (currentManagerUI && typeof currentManagerUI.destroy === 'function') {
             currentManagerUI.destroy();
        }
        currentManagerUI = new KeyManagerUI(
            modelKeyOrSourceSiteModelName,
            keyManagerColumn,
            handleTestKey,
            handleTestAllKeys,
            loadModelKeys,
            saveModelKeys
        );
    }

    async function handleTestKey(modelName, keyObject) {
        if (!currentManagerUI) return;
        currentManagerUI.updateKeyStatus(keyObject.id, 'testing');

        let modelConfigForTest = {};
        let apiEndpointForTest = null;
        // 获取友好显示名
        let modelDisplayNameForNotification = modelName;
        if (modelName.startsWith('custom_source_')) {
            const sourceSiteId = modelName.replace('custom_source_', '');
            if (typeof loadAllCustomSourceSites === 'function') {
                const sites = loadAllCustomSourceSites();
                const site = sites[sourceSiteId];
                if (site && site.displayName) {
                    modelDisplayNameForNotification = `"${site.displayName}"`;
                } else {
                    modelDisplayNameForNotification = `源站点 (ID: ...${sourceSiteId.slice(-8)})`;
                }
            }
        }

        if (modelName.startsWith('custom_source_')) {
            const sourceSiteId = modelName.replace('custom_source_', '');
            const allSites = loadAllCustomSourceSites();
            const siteConfig = allSites[sourceSiteId];
            if (siteConfig && siteConfig.apiBaseUrl && siteConfig.modelId) {
                apiEndpointForTest = siteConfig.apiBaseUrl;
                modelConfigForTest = {
                    ...siteConfig,
                    apiEndpoint: siteConfig.apiBaseUrl
                };
            } else {
                currentManagerUI.updateKeyStatus(keyObject.id, 'untested');
                showNotification(`源站配置不完整 (ID: ${sourceSiteId})，缺少 API Base URL 或模型 ID。请在配置区完善。`, 'error');
                return;
            }
        } else {
            modelConfigForTest = loadModelConfig(modelName) || {};
            apiEndpointForTest = modelConfigForTest.apiEndpoint;
        }

        try {
            const isValid = await testModelKey(modelName, keyObject.value, modelConfigForTest, apiEndpointForTest);
            currentManagerUI.updateKeyStatus(keyObject.id, isValid ? 'valid' : 'invalid');
            showNotification(`Key (${keyObject.value.substring(0,4)}...) for ${modelDisplayNameForNotification} test: ${isValid ? '有效' : '无效'}`, isValid ? 'success' : 'error');
        } catch (error) {
            console.error("Key test error:", error);
            currentManagerUI.updateKeyStatus(keyObject.id, 'invalid');
            showNotification(`Key test for ${modelDisplayNameForNotification} failed: ${error.message}`, 'error');
        }
    }

    async function handleTestAllKeys(modelName, keysArray) {
        // 获取友好显示名
        let modelDisplayNameForNotification = modelName;
        if (modelName.startsWith('custom_source_')) {
            const sourceSiteId = modelName.replace('custom_source_', '');
            if (typeof loadAllCustomSourceSites === 'function') {
                const sites = loadAllCustomSourceSites();
                const site = sites[sourceSiteId];
                if (site && site.displayName) {
                    modelDisplayNameForNotification = `"${site.displayName}"`;
                } else {
                    modelDisplayNameForNotification = `源站点 (ID: ...${sourceSiteId.slice(-8)})`;
                }
            }
        }
        showNotification(`开始批量测试 ${modelDisplayNameForNotification} 的 ${keysArray.length} 个Key...`, 'info');
        for (const keyObj of keysArray) {
            await handleTestKey(modelName, keyObj);
        }
        showNotification(`${modelDisplayNameForNotification} 的所有 Key 测试完毕。`, 'info');
    }

    // 旧的 updateCustomModelConfig, handleDetectModelsInModal might need to be adapted or removed
    // if their functionality is now part of the source site form.
    // The functions createConfigInput and createConfigSelect are still useful for the new form.

    window.refreshKeyManagerForModel = (modelName, keyId, newStatus) => {
        if (modelKeyManagerModal && !modelKeyManagerModal.classList.contains('hidden') &&
            currentManagerUI && currentManagerUI.modelName === modelName) {
            currentManagerUI.updateKeyStatus(keyId, newStatus);
        }
    };

    // 新增: Event-Listener für das customSourceSiteSelect Dropdown-Menü
    if (customSourceSiteSelect) {
        customSourceSiteSelect.addEventListener('change', () => {
            // 保存当前选中的源站点ID到设置
            let settings = typeof loadSettings === 'function' ? loadSettings() : {};
            settings.selectedCustomSourceSiteId = customSourceSiteSelect.value;
            if (typeof saveSettings === 'function') {
                saveSettings(settings);
            } else {
                localStorage.setItem('paperBurnerSettings', JSON.stringify(settings));
            }
            // 原有逻辑
            saveCurrentSettings && saveCurrentSettings();
            // 新增：切换后立即刷新信息面板
            if (typeof updateCustomSourceSiteInfo === 'function') {
                updateCustomSourceSiteInfo(customSourceSiteSelect.value);
            }
        });
    }

    // 新增：更新自定义源站点信息函数
    function updateCustomSourceSiteInfo(siteId) {
        const infoContainer = document.getElementById('customSourceSiteInfo');
        const manageKeyBtn = document.getElementById('manageSourceSiteKeyBtn');

        if (!infoContainer || !manageKeyBtn) return;

        if (!siteId) {
            infoContainer.classList.add('hidden');
            manageKeyBtn.classList.add('hidden');
            return;
        }

        try {
            const sites = typeof loadAllCustomSourceSites === 'function' ? loadAllCustomSourceSites() : {};
            const site = sites[siteId];

            if (site) {
                // 显示信息面板和按钮
                infoContainer.classList.remove('hidden');
                manageKeyBtn.classList.remove('hidden');

                // 获取可用API Key数量 - 移到前面以便模板使用
                const customSourceKeysCount = typeof loadModelKeys === 'function' ?
                    (loadModelKeys(`custom_source_${siteId}`) || []).filter(k => k.status !== 'invalid').length : 0;

                // 构建HTML以展示站点信息
                let infoHtml = `
                    <div class="p-3">
                        <h3 class="font-bold text-gray-800 text-xl mb-3">${site.displayName || '未命名源站点'}</h3>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                            <div><span class="font-medium">API Base URL:</span> <span class="text-gray-600">${site.apiBaseUrl || '未设置'}</span></div>
                            <div><span class="font-medium">当前模型:</span> <span id="currentModelPreview_${siteId}" class="text-gray-600">${site.modelId || '未设置'}</span></div>
                            <div><span class="font-medium">请求格式:</span> <span class="text-gray-600">${site.requestFormat || 'openai'}</span></div>
                            <div><span class="font-medium">温度:</span> <span class="text-gray-600">${site.temperature || '0.5'}</span></div>
                        </div>`;

                // 如果有可用模型列表，则展示为可选择的下拉框
                if (site.availableModels && site.availableModels.length > 0) {
                    infoHtml += `
                        <div class="mt-2 border-t border-dashed pt-2">
                            <div class="flex justify-between items-center">
                                <div class="font-medium mb-1">选择模型:</div>
                                <div class="flex items-center space-x-2">
                                    <span class="text-xs text-green-600 flex items-center">
                                        <iconify-icon icon="carbon:checkmark-filled" class="mr-1" width="14"></iconify-icon>
                                        检测到 ${site.availableModels.length} 个可用模型
                                    </span>
                                    <button id="reDetectModelsBtn_${siteId}" class="ml-1 px-1.5 py-0.5 bg-gray-100 hover:bg-blue-100 text-blue-600 rounded flex items-center" title="重新检测模型">
                                        <iconify-icon icon="carbon:renew" class="animate-spin-slow" width="16"></iconify-icon>
                                    </button>
                                </div>
                            </div>
                            <div class="flex items-center space-x-2 mt-2">
                                <select id="sourceSiteModelSelect_${siteId}" class="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors">`;

                    site.availableModels.forEach(model => {
                        const modelName = model.name || model.id;
                        const modelId = model.id;
                        const isSelected = modelId === site.modelId;
                        infoHtml += `<option value="${modelId}" ${isSelected ? 'selected' : ''}>${modelName}</option>`;
                    });

                    // 添加当前使用的模型（如果不在列表中）
                    if (site.modelId && !site.availableModels.some(m => m.id === site.modelId)) {
                        infoHtml += `<option value="${site.modelId}" selected>${site.modelId} (当前使用)</option>`;
                    }

                    infoHtml += `</select>
                                <button id="saveModelBtn_${siteId}" class="px-5 py-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded text-xs flex items-center min-w-[80px] whitespace-nowrap">
                                    <iconify-icon icon="carbon:save" class="mr-1" width="16"></iconify-icon>
                                    设为默认
                                </button>
                            </div>
                        </div>`;
                } else {
                    // 没有可用模型列表时，显示更明确的提示和手动输入选项
                    infoHtml += `<div class="mt-2 pt-2 border-t">
                        <div class="flex justify-between items-center">
                            <div class="font-medium mb-1">模型ID:</div>
                            <div class="text-xs text-gray-500">
                                <iconify-icon icon="carbon:information" class="mr-1" width="14"></iconify-icon>
                                <span>还未检测模型</span>
                            </div>
                        </div>
                        <div class="flex items-center w-full">
                            <input type="text" id="manualModelId_${siteId}" class="flex-grow px-3 py-1.5 border border-gray-300 rounded-l-md text-sm" value="${site.modelId || ''}" placeholder="例如: gpt-4-turbo">
                            <button id="saveManualModelBtn_${siteId}" class="px-2 py-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded-r-md text-xs flex items-center">
                                <iconify-icon icon="carbon:save" class="mr-1" width="14"></iconify-icon>
                                保存
                            </button>
                        </div>
                        <div class="mt-2 text-xs flex items-center justify-between">
                            <span class="text-blue-600 inline-flex items-center">
                                <iconify-icon icon="carbon:arrow-right" class="mr-1" width="14"></iconify-icon>
                                点击
                                <button id="infoDetectModelsBtn_${siteId}" class="mx-1 px-1.5 py-0.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs flex items-center">
                                    <iconify-icon icon="carbon:model-alt" class="mr-1" width="12"></iconify-icon>
                                    检测可用模型
                                </button>
                            </span>

                            <!-- 检查是否有可用的API Key -->
                            <span class="${customSourceKeysCount > 0 ? 'text-green-600' : 'text-red-600'} inline-flex items-center">
                                ${customSourceKeysCount > 0 ?
                                  `<iconify-icon icon="carbon:checkmark" class="mr-1" width="14"></iconify-icon>${customSourceKeysCount}个可用Key` :
                                  `<iconify-icon icon="carbon:warning" class="mr-1" width="14"></iconify-icon>请先添加API Key`}
                            </span>
                        </div>
                    </div>`;
                }

                // 添加键检查信息和API Key管理按钮
                infoHtml += `
                    <div class="mt-6 pt-3 border-t border-dashed ">
                        <div class="flex items-center justify-between">
                            <div class="flex items-center">
                                <span class="font-medium mr-2">API Keys:</span>
                                <span class="text-sm ${customSourceKeysCount > 0 ? 'text-green-600' : 'text-red-600'}">
                                    ${customSourceKeysCount > 0 ?
                                      `<iconify-icon icon="carbon:checkmark-filled" class="mr-1" width="14"></iconify-icon>${customSourceKeysCount}个可用Key` :
                                      `<iconify-icon icon="carbon:warning-filled" class="mr-1" width="14"></iconify-icon>无可用Key`}
                                </span>
                            </div>
                            <button id="infoManageKeyBtn_${siteId}" class="px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded text-xs flex items-center" style="height:2.1em;">
                                <iconify-icon icon="carbon:api" class="mr-1" width="14"></iconify-icon>
                                管理API Key
                            </button>
                        </div>
                    </div>`;

                infoHtml += `</div>`;
                infoContainer.innerHTML = infoHtml;

                // 隐藏底部的管理按钮 - 因为我们有了内联的按钮
                manageKeyBtn.classList.add('hidden');

                // 为内联的管理API Key按钮添加点击事件
                const infoManageKeyBtn = document.getElementById(`infoManageKeyBtn_${siteId}`);
                if (infoManageKeyBtn) {
                    infoManageKeyBtn.onclick = function() {
                        // 打开模型Key管理弹窗
                        document.getElementById('modelKeyManagerBtn').click();

                        // 等待弹窗打开，然后设置正确的模型和源站点
                        setTimeout(() => {
                            if (typeof selectModelForManager === 'function') {
                                // 选择custom模型
                                selectModelForManager('custom');

                                // 再选择特定源站点
                                if (typeof selectSourceSite === 'function') {
                                    selectSourceSite(siteId);
                                }
                            }
                        }, 100);
                    };
                }

                // 为内联的检测模型按钮添加点击事件
                const infoDetectModelsBtn = document.getElementById(`infoDetectModelsBtn_${siteId}`);
                if (infoDetectModelsBtn) {
                    infoDetectModelsBtn.onclick = function() {
                        // 直接调用外部检测按钮的点击事件
                        const mainDetectBtn = document.getElementById('detectModelsBtn');
                        if (mainDetectBtn) {
                            mainDetectBtn.click();
                        }
                    };
                }
                // 为重新检测按钮添加事件
                const reDetectBtn = document.getElementById(`reDetectModelsBtn_${siteId}`);
                if (reDetectBtn) {
                    reDetectBtn.onclick = function() {
                        const mainDetectBtn = document.getElementById('detectModelsBtn');
                        if (mainDetectBtn) {
                            mainDetectBtn.click();
                        }
                    };
                }

                // 添加新功能：绑定模型选择/保存事件
                setTimeout(() => {
                    // 1. 如果有可用模型下拉框，绑定保存事件
                    const modelSelectBtn = document.getElementById(`saveModelBtn_${siteId}`);
                    const modelSelect = document.getElementById(`sourceSiteModelSelect_${siteId}`);

                    // 新增：如果 site.modelId 为空，自动选中第一个并保存
                    if (modelSelect && (!site.modelId || !site.availableModels.some(m => m.id === site.modelId))) {
                        if (modelSelect.options.length > 0) {
                            const firstModelId = modelSelect.options[0].value;
                            if (!site.modelId || site.modelId !== firstModelId) {
                                site.modelId = firstModelId;
                                if (typeof saveCustomSourceSite === 'function') {
                                    saveCustomSourceSite(site);
                                }
                                modelSelect.value = firstModelId;
                                // 同步预览
                                const previewText = document.getElementById(`currentModelPreview_${siteId}`);
                                if (previewText) {
                                    previewText.textContent = modelSelect.options[0].text || firstModelId;
                                }
                            }
                        }
                    }

                    if (modelSelectBtn && modelSelect) {
                        // 保存按钮点击事件
                        modelSelectBtn.addEventListener('click', () => {
                            if (modelSelect) {
                                const selectedModelId = modelSelect.value;
                                site.modelId = selectedModelId;
                                if (typeof saveCustomSourceSite === 'function') {
                                    saveCustomSourceSite(site);
                                }
                                // 同步预览
                                const previewText = document.getElementById(`currentModelPreview_${siteId}`);
                                if (previewText) {
                                    previewText.textContent = modelSelect.options[modelSelect.selectedIndex].text || selectedModelId;
                                    previewText.classList.add('font-semibold', 'text-blue-600');
                                    setTimeout(() => {
                                        previewText.classList.remove('font-semibold', 'text-blue-600');
                                    }, 1500);
                                }
                            }
                        });

                        // 下拉框change事件 - 实现即时预览并保存
                        modelSelect.addEventListener('change', () => {
                            const selectedOption = modelSelect.options[modelSelect.selectedIndex];
                            const previewText = document.getElementById(`currentModelPreview_${siteId}`);
                            if (previewText) {
                                previewText.textContent = selectedOption.text || selectedOption.value;
                                previewText.classList.add('font-semibold', 'text-blue-600');
                                setTimeout(() => {
                                    previewText.classList.remove('font-semibold', 'text-blue-600');
                                }, 1500);
                            }
                            // 新增：切换时立即保存
                            site.modelId = modelSelect.value;
                            if (typeof saveCustomSourceSite === 'function') {
                                saveCustomSourceSite(site);
                            }
                        });
                    }

                    // 2. 如果有手动输入模型ID，绑定保存事件
                    const saveManualModelBtn = document.getElementById(`saveManualModelBtn_${siteId}`);
                    const manualModelInput = document.getElementById(`manualModelId_${siteId}`);

                    if (saveManualModelBtn && manualModelInput) {
                        saveManualModelBtn.addEventListener('click', () => {
                            if (manualModelInput && manualModelInput.value.trim()) {
                                saveSelectedModelForSite(siteId, manualModelInput.value.trim());

                                // 更新当前模型显示
                                const previewText = document.getElementById(`currentModelPreview_${siteId}`);
                                if (previewText) {
                                    previewText.textContent = manualModelInput.value.trim();
                                    previewText.classList.add('font-semibold', 'text-blue-600');
                                    setTimeout(() => {
                                        previewText.classList.remove('font-semibold', 'text-blue-600');
                                    }, 1500);
                                }
                            } else {
                                showNotification('请输入有效的模型ID', 'warning');
                            }
                        });

                        // 添加Enter键保存功能
                        manualModelInput.addEventListener('keypress', (e) => {
                            if (e.key === 'Enter' && manualModelInput.value.trim()) {
                                saveManualModelBtn.click();
                            }
                        });
                    }
                }, 100);
            } else {
                infoContainer.classList.add('hidden');
                manageKeyBtn.classList.add('hidden');
            }
        } catch (e) {
            console.error("Error updating custom source site info:", e);
            infoContainer.classList.add('hidden');
            manageKeyBtn.classList.add('hidden');
        }
    }

    /**
     * 保存选定的模型ID到源站点配置
     * @param {string} siteId - 源站点ID
     * @param {string} modelId - 要保存的模型ID
     */
    function saveSelectedModelForSite(siteId, modelId) {
        if (!siteId || !modelId) return;

        try {
            const sites = typeof loadAllCustomSourceSites === 'function' ? loadAllCustomSourceSites() : {};
            const site = sites[siteId];

            if (site) {
                // 更新模型ID
                site.modelId = modelId;

                // 保存更新后的配置
                if (typeof saveCustomSourceSite === 'function') {
                    saveCustomSourceSite(site);
                    showNotification(`已将模型 "${modelId}" 设为源站 "${site.displayName || siteId}" 的默认模型`, 'success');

                    // 刷新信息显示
                    updateCustomSourceSiteInfo(siteId);
                } else {
                    showNotification('保存失败：saveCustomSourceSite 函数不可用', 'error');
                }
            } else {
                showNotification(`保存失败：未找到ID为 "${siteId}" 的源站点配置`, 'error');
            }
        } catch (e) {
            console.error('Error saving selected model for site:', e);
            showNotification('保存模型ID时发生错误', 'error');
        }
    }

    // 新增：自定义事件监听，用于外部调用源站点选择
    window.addEventListener('selectCustomSourceSiteForKeyManager', function(e) {
        if (e.detail && typeof e.detail === 'string') {
            if (typeof selectModelForManager === 'function') {
                selectModelForManager('custom');
                if (typeof selectSourceSite === 'function') {
                    selectSourceSite(e.detail);
                }
            }
        }
    });

    // 新增：选择源站点完毕后首次加载信息的钩子
    if (customSourceSiteSelect) {
        setTimeout(() => {
            // 自动展开自定义源站点设置区域
            const customSourceSiteDiv = document.getElementById('customSourceSite');
            if (customSourceSiteDiv && customSourceSiteDiv.classList.contains('hidden')) {
                customSourceSiteDiv.classList.remove('hidden');
                const customSourceSiteToggleIcon = document.getElementById('customSourceSiteToggleIcon');
                if (customSourceSiteToggleIcon) {
                    customSourceSiteToggleIcon.setAttribute('icon', 'carbon:chevron-up');
                }
            }
            // 如果没有选择，自动选择第一个
            if (!customSourceSiteSelect.value) {
                if (customSourceSiteSelect.options.length > 0) {
                    for (let i = 0; i < customSourceSiteSelect.options.length; i++) {
                        if (customSourceSiteSelect.options[i].value) {
                            customSourceSiteSelect.value = customSourceSiteSelect.options[i].value;
                            break;
                        }
                    }
                }
            }
            // 没有自定义站点时显示提示
            if (customSourceSiteSelect.options.length <= 1) {
                const infoContainer = document.getElementById('customSourceSiteInfo');
                if (infoContainer) {
                    infoContainer.classList.remove('hidden');
                    infoContainer.innerHTML = `<div class="p-4 text-center text-red-500 text-sm font-semibold">您还没设置自定义源站点，请您先手动进行设置...</div>`;
                }
            } else {
                updateCustomSourceSiteInfo(customSourceSiteSelect.value);
            }
        }, 500);
    }

    // 新增：把选择源站和显示信息函数暴露给全局
    window.updateCustomSourceSiteInfo = updateCustomSourceSiteInfo;

    // 新增：使管理函数可全局访问
    window.selectModelForManager = selectModelForManager;
    window.selectSourceSite = selectSourceSite;

    // 新增：检测可用模型按钮事件
    if (detectModelsBtn) {
        detectModelsBtn.addEventListener('click', function() {
            const selectedSiteId = customSourceSiteSelect.value;
            if (!selectedSiteId) {
                showNotification('请先选择一个源站点', 'warning');
                return;
            }

            // 先检查该源站点是否已有API Key
            const keysForSite = typeof loadModelKeys === 'function' ?
                loadModelKeys(`custom_source_${selectedSiteId}`) : [];

            const validKeys = keysForSite.filter(key => key.status === 'valid' || key.status === 'untested');

            if (validKeys.length === 0) {
                // 没有可用的Key，提示用户先添加Key
                if (confirm(`源站点没有可用的API Key。是否立即添加Key？`)) {
                    // 打开模型管理器并直接跳到Key管理界面
                    document.getElementById('modelKeyManagerBtn').click();

                    setTimeout(() => {
                        if (typeof selectModelForManager === 'function') {
                            selectModelForManager('custom');
                            if (typeof selectSourceSite === 'function') {
                                selectSourceSite(selectedSiteId);
                            }
                        }
                    }, 100);
                }
                return;
            }

            // 有可用的Key，则直接开始检测模型
            const sites = typeof loadAllCustomSourceSites === 'function' ? loadAllCustomSourceSites() : {};
            const site = sites[selectedSiteId];

            if (!site || !site.apiBaseUrl) {
                showNotification('源站点配置不完整，缺少API Base URL', 'error');
                return;
            }

            // 这里使用已有的Key进行检测，而不是要求用户重新输入
            showNotification('开始使用现有API Key检测可用模型，请稍候...', 'info');

            // 修改为直接使用现有Key检测
            if (typeof window.modelDetector === 'object' && typeof window.modelDetector.detectModelsForSite === 'function') {
                detectModelsWithExistingKeys(selectedSiteId, site, validKeys);
            } else {
                showNotification('模型检测器不可用，请刷新页面重试', 'error');
            }
        });
    }

    /**
     * 使用现有API Key检测源站点的可用模型
     * @param {string} siteId - 源站点ID
     * @param {object} site - 源站点配置对象
     * @param {array} validKeys - 可用的API Key列表
     */
    async function detectModelsWithExistingKeys(siteId, site, validKeys) {
        let detectBtn = document.getElementById('detectModelsBtn');
        let originalBtnText = detectBtn.innerHTML;

        try {
            // 修改按钮状态
            detectBtn.disabled = true;
            detectBtn.innerHTML = '<iconify-icon icon="carbon:circle-dash" class="animate-spin mr-1"></iconify-icon>检测中...';

            // 尝试每个Key，直到成功检测到模型
            let modelsDetected = [];
            let successfulKey = null;

            for (const key of validKeys) {
                try {
                    showNotification(`正在尝试使用Key (${key.value.substring(0, 4)}...) 检测模型`, 'info');
                    modelsDetected = await window.modelDetector.detectModelsForSite(site.apiBaseUrl, key.value);

                    if (modelsDetected && modelsDetected.length > 0) {
                        successfulKey = key;
                        break; // 成功检测到模型，跳出循环
                    }
                } catch (keyError) {
                    console.warn(`Key (${key.value.substring(0, 4)}...) 检测模型失败:`, keyError);
                    // 继续尝试下一个Key
                }
            }

            if (modelsDetected.length === 0) {
                throw new Error('所有Key都无法成功检测到模型');
            }

            // 更新源站点的可用模型列表
            site.availableModels = modelsDetected;

            // 如果源站点还没有设置默认模型，则设置为第一个检测到的模型
            if (!site.modelId && modelsDetected.length > 0) {
                site.modelId = modelsDetected[0].id;
            }

            // 保存更新后的源站点配置
            if (typeof saveCustomSourceSite === 'function') {
                saveCustomSourceSite(site);
                showNotification(`已检测到 ${modelsDetected.length} 个可用模型，并已保存到源站点配置`, 'success');

                // 刷新源站点信息显示
                updateCustomSourceSiteInfo(siteId);
            } else {
                throw new Error('保存配置失败：saveCustomSourceSite 函数不可用');
            }

            // 更新使用成功的Key状态
            if (successfulKey && typeof window.refreshKeyManagerForModel === 'function') {
                // 标记为有效状态
                window.refreshKeyManagerForModel(`custom_source_${siteId}`, successfulKey.id, 'valid');
            }

        } catch (error) {
            console.error('检测模型失败:', error);
            showNotification(`检测模型失败: ${error.message}`, 'error');
        } finally {
            // 恢复按钮状态
            detectBtn.disabled = false;
            detectBtn.innerHTML = originalBtnText;
        }
    }
});