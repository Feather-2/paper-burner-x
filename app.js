// app.js - 主入口点和事件协调器

// =====================
// 全局状态变量与并发控制
// =====================
let pdfFiles = [];
let allResults = [];
let processedFilesRecord = {};
let isProcessing = false;
let activeProcessingCount = 0;
let retryAttempts = new Map();
const MAX_RETRIES = 3;
const LAST_SUCCESSFUL_KEYS_LS_KEY = 'paperBurnerLastSuccessfulKeys';

// --- 全局翻译并发控制 ---
let translationSemaphore = {
    limit: 2, // 默认翻译并发数，可由设置覆盖
    count: 0,
    queue: []
};

/**
 * API Key Provider 类
 * 负责加载、筛选、排序和轮询特定模型的API Keys
 */
class KeyProvider {
    constructor(modelName) {
        this.modelName = modelName;
        this.keys = [];      // 存储从localStorage加载的原始key对象数组 {id, value, remark, status, order}
        this.availableKeys = []; // 存储经过筛选和排序的、当前轮次可用的key对象数组
        this.currentIndex = 0;
        this.loadAndPrepareKeys();
    }

    loadAndPrepareKeys() {
        this.keys = typeof loadModelKeys === 'function' ? loadModelKeys(this.modelName) : [];
        // 筛选出 'valid' 或 'untested' 的 keys，并按 order 排序 (loadModelKeys 内部已排序)
        this.availableKeys = this.keys.filter(key => key.status === 'valid' || key.status === 'untested');
        this.currentIndex = 0;
        if (this.availableKeys.length === 0) {
            console.warn(`KeyProvider: No 'valid' or 'untested' keys found for model ${this.modelName}`);
        }
    }

    getNextKey() {
        if (this.availableKeys.length === 0) {
            return null; // 没有可用的key
        }
        const keyObject = this.availableKeys[this.currentIndex];
        this.currentIndex = (this.currentIndex + 1) % this.availableKeys.length;
        return keyObject; // 返回整个key对象，包含 {id, value, status, remark, order}
    }

    // 当一个key被确认无效时调用
    async markKeyAsInvalid(keyId) {
        const keyIndexInAll = this.keys.findIndex(k => k.id === keyId);
        if (keyIndexInAll !== -1) {
            this.keys[keyIndexInAll].status = 'invalid';
            if (typeof saveModelKeys === 'function') {
                await saveModelKeys(this.modelName, this.keys); // 异步保存
            }
        }
        // 从当前可用列表中移除，并重置索引以确保正确轮询剩余的key
        this.availableKeys = this.availableKeys.filter(k => k.id !== keyId);
        this.currentIndex = this.availableKeys.length > 0 ? this.currentIndex % this.availableKeys.length : 0;

        // 如果Key管理弹窗正好显示这个模型, 更新其UI
        if (typeof window.refreshKeyManagerForModel === 'function') {
            window.refreshKeyManagerForModel(this.modelName, keyId, 'invalid');
        }
    }

    hasAvailableKeys() {
        return this.availableKeys.length > 0;
    }
}

/**
 * 获取一个翻译并发槽（信号量实现）
 */
async function acquireTranslationSlot() {
    if (translationSemaphore.count < translationSemaphore.limit) {
        translationSemaphore.count++;
        return Promise.resolve();
    } else {
        return new Promise(resolve => {
            translationSemaphore.queue.push(resolve);
        });
    }
}

/**
 * 释放一个翻译并发槽
 */
function releaseTranslationSlot() {
    translationSemaphore.count--;
    if (translationSemaphore.queue.length > 0) {
        const nextResolve = translationSemaphore.queue.shift();
        acquireTranslationSlot().then(nextResolve);
    }
}

// =====================
// DOMContentLoaded 入口初始化
// =====================
document.addEventListener('DOMContentLoaded', () => {
    // 1. 加载设置和已处理文件记录
    const settings = loadSettings();
    processedFilesRecord = loadProcessedFilesRecord();

    // 2. 应用设置到 UI
    applySettingsToUI(settings);

    // 3. 加载 API Keys（如有记住） - 此功能已通过KeyProvider实现，且UI元素已移除
    // loadApiKeysFromStorage(); // 删除此行

    // 4. 初始化 UI 状态
    updateFileListUI(pdfFiles, isProcessing, handleRemoveFile);
    updateProcessButtonState(pdfFiles, isProcessing);
    updateTranslationUIVisibility(isProcessing);

    // 5. 绑定所有事件
    setupEventListeners();

    // 初始化自定义模型检测UI
    if (typeof initModelDetectorUI === 'function') {
        initModelDetectorUI();
    }
});

// =====================
// UI 设置应用
// =====================
function applySettingsToUI(settings) {
    // 解构所有设置项
    const {
        maxTokensPerChunk: maxTokensVal,
        skipProcessedFiles,
        selectedTranslationModel: modelVal,
        selectedCustomSourceSiteId, // 新增：加载选定的自定义源站点ID
        concurrencyLevel: concurrencyVal,
        translationConcurrencyLevel: translationConcurrencyVal,
        targetLanguage: targetLangVal,
        customTargetLanguageName: customLangNameVal,
        defaultSystemPrompt: defaultSysPromptVal,
        defaultUserPromptTemplate: defaultUserPromptVal,
        useCustomPrompts: useCustomPromptsVal
    } = settings;

    // 应用到各 DOM 元素
    const maxTokensSlider = document.getElementById('maxTokensPerChunk');
    if (maxTokensSlider) {
        maxTokensSlider.value = maxTokensVal;
        document.getElementById('maxTokensPerChunkValue').textContent = maxTokensVal;
    }
    document.getElementById('skipProcessedFiles').checked = skipProcessedFiles;
    const translationModelSelect = document.getElementById('translationModel');
    if (translationModelSelect) translationModelSelect.value = modelVal;

    // ----- 新增：处理自定义源站点下拉列表的逻辑 -----
    const customSourceSiteDropdown = document.getElementById('customSourceSiteSelect');
    if (modelVal === 'custom' && customSourceSiteDropdown) {
        customSourceSiteDropdown.classList.remove('hidden');
        if (typeof window.populateCustomSourceSitesDropdown_ui === 'function') {
            // 假设 ui.js 中有这个函数来填充下拉列表
            window.populateCustomSourceSitesDropdown_ui(selectedCustomSourceSiteId);
        } else {
            console.warn('populateCustomSourceSitesDropdown_ui function not found on window.');
            // 可选：如果函数不存在，至少清空并禁用它
            customSourceSiteDropdown.innerHTML = '<option value="">未找到源站点加载函数</option>';
            customSourceSiteDropdown.disabled = true;
        }
    } else if (customSourceSiteDropdown) {
        customSourceSiteDropdown.classList.add('hidden');
        customSourceSiteDropdown.innerHTML = ''; // 清空选项
        customSourceSiteDropdown.disabled = true;
    }
    // ----- 结束新增 -----

    const concurrencyInput = document.getElementById('concurrencyLevel');
    if (concurrencyInput) concurrencyInput.value = concurrencyVal;
    const translationConcurrencyInput = document.getElementById('translationConcurrencyLevel');
    if (translationConcurrencyInput) translationConcurrencyInput.value = translationConcurrencyVal;
    const targetLanguageSelect = document.getElementById('targetLanguage');
    if (targetLanguageSelect) targetLanguageSelect.value = targetLangVal || 'chinese';
    const customTargetLanguageInput = document.getElementById('customTargetLanguageInput');
    if (customTargetLanguageInput) customTargetLanguageInput.value = customLangNameVal || '';
    const useCustomPromptsCheckbox = document.getElementById('useCustomPromptsCheckbox');
    if (useCustomPromptsCheckbox) useCustomPromptsCheckbox.checked = useCustomPromptsVal || false;

    // 自定义模型设置 (旧版逻辑，现在主要由源站点管理)
    // 这里不再直接从 settings.customModelSettings 读取并填充旧的自定义模型输入框
    // 因为这些设置现在应该通过 key-manager-ui.js 中的源站点表单进行管理。
    // 如果需要，可以在选择特定源站点时，由 ui.js 更新这些显示（如果这些输入框还保留用于显示目的）。

    // 触发 UI 相关联动
    updateTranslationUIVisibility(isProcessing); // 这个函数在ui.js，可能需要调整以配合源站点下拉框
    updateCustomLanguageInputVisibility();
    updatePromptTextareasContent();
}

// =====================
// API Key 加载 (旧版UI的，现在已不需要)
// =====================
/* // 函数整体注释掉或删除
function loadApiKeysFromStorage() {
    const mistralKeysText = localStorage.getItem('mistralApiKeys');
    const translationKeysText = localStorage.getItem('translationApiKeys');

    const mistralTextArea = document.getElementById('mistralApiKeys'); // 这些元素已不存在
    const translationTextArea = document.getElementById('translationApiKeys'); // 这些元素已不存在

    if (mistralKeysText && mistralTextArea) {
        mistralTextArea.value = mistralKeysText;
    }
    if (translationKeysText && translationTextArea) {
        translationTextArea.value = translationKeysText;
    }
}
*/

// =====================
// 事件监听器绑定
// =====================
function setupEventListeners() {
    // (需要从 ui.js 获取 DOM 元素引用)
    // const mistralTextArea = document.getElementById('mistralApiKeys'); // 已移除
    // const translationTextArea = document.getElementById('translationApiKeys'); // 已移除
    const translationModelSelect = document.getElementById('translationModel');
    const advancedSettingsToggle = document.getElementById('advancedSettingsToggle');
    const maxTokensSlider = document.getElementById('maxTokensPerChunk');
    const skipFilesCheckbox = document.getElementById('skipProcessedFiles');
    const concurrencyInput = document.getElementById('concurrencyLevel');
    const translationConcurrencyInput = document.getElementById('translationConcurrencyLevel'); // Get ref to new input
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('pdfFileInput');
    const browseBtn = document.getElementById('browseFilesBtn');
    const clearBtn = document.getElementById('clearFilesBtn');
    const processBtn = document.getElementById('processBtn');
    const downloadBtn = document.getElementById('downloadAllBtn');
    const targetLanguageSelect = document.getElementById('targetLanguage'); // Get ref to target language select
    const customTargetLanguageInput = document.getElementById('customTargetLanguageInput'); // Get ref to custom language input
    const useCustomPromptsCheckbox = document.getElementById('useCustomPromptsCheckbox'); // Get ref to custom prompt checkbox
    const defaultSystemPromptTextarea = document.getElementById('defaultSystemPrompt'); // Get ref to default system prompt textarea
    const defaultUserPromptTemplateTextarea = document.getElementById('defaultUserPromptTemplate'); // Get ref to default user prompt template textarea
    const customModelInputs = [
        document.getElementById('customApiEndpoint'),
        document.getElementById('customModelId'),
        document.getElementById('customRequestFormat'),
        document.getElementById('customTemperature'),
        document.getElementById('customMaxTokens')
    ];
    const customSourceSiteDropdown = document.getElementById('customSourceSiteSelect'); // Get ref to custom source site dropdown
    const customSourceSiteToggleBtn = document.getElementById('customSourceSiteToggle'); // 新增：获取切换按钮
    const customSourceSiteDiv = document.getElementById('customSourceSite'); // 新增：获取要切换的div
    const customSourceSiteToggleIconEl = document.getElementById('customSourceSiteToggleIcon'); // 新增：获取切换图标

    // API Key 存储 - 相关逻辑已移除，因为输入框已移除
    /* // mistralTextArea 的监听器已无意义
    mistralTextArea.addEventListener('input', () => {
        localStorage.setItem('mistralApiKeys', mistralTextArea.value); // 直接保存
        updateProcessButtonState(pdfFiles, isProcessing);
    });
    */
    /* // translationTextArea 的监听器已无意义
    translationTextArea.addEventListener('input', () => {
        localStorage.setItem('translationApiKeys', translationTextArea.value); // 直接保存
        updateTranslationUIVisibility(isProcessing);
    });
    */

    // 翻译模型和自定义设置
    translationModelSelect.addEventListener('change', () => {
        updateTranslationUIVisibility(isProcessing);
        saveCurrentSettings(); // 保存包括模型选择在内的所有设置
    });

    // 新增: Event-Listener für das customSourceSiteSelect Dropdown-Menü
    if (customSourceSiteDropdown) {
        customSourceSiteDropdown.addEventListener('change', () => {
            saveCurrentSettings(); // Speichere die aktuellen Einstellungen, wenn die Auswahl der benutzerdefinierten Quelle geändert wird
            // Optional: Log or update UI based on the new selection if needed immediately
            const settings = loadSettings();
            console.log("Custom source site selection changed and saved:", settings.selectedCustomSourceSiteId);
        });
    }

    // 新增：为"自定义源站点设置"的切换按钮添加事件监听器
    if (customSourceSiteToggleBtn && customSourceSiteDiv && customSourceSiteToggleIconEl) {
        customSourceSiteToggleBtn.addEventListener('click', () => {
            customSourceSiteDiv.classList.toggle('hidden');
            if (customSourceSiteDiv.classList.contains('hidden')) {
                customSourceSiteToggleIconEl.setAttribute('icon', 'carbon:chevron-down');
            } else {
                customSourceSiteToggleIconEl.setAttribute('icon', 'carbon:chevron-up');
            }
        });
    }

    customModelInputs.forEach(input => {
        if (!input) return;
        input.addEventListener('change', saveCurrentSettings);
        input.addEventListener('input', saveCurrentSettings); // 实时保存
    });

    // 高级设置
    advancedSettingsToggle.addEventListener('click', () => {
        const settingsDiv = document.getElementById('advancedSettings');
        const icon = document.getElementById('advancedSettingsIcon');
        settingsDiv.classList.toggle('hidden');
        icon.setAttribute('icon', settingsDiv.classList.contains('hidden') ? 'carbon:chevron-down' : 'carbon:chevron-up');
        // 不需要单独保存，由内部控件处理
    });
    maxTokensSlider.addEventListener('input', () => {
        document.getElementById('maxTokensPerChunkValue').textContent = maxTokensSlider.value;
        saveCurrentSettings();
    });
    skipFilesCheckbox.addEventListener('change', saveCurrentSettings);
    concurrencyInput.addEventListener('input', () => {
        // 输入验证
        let value = parseInt(concurrencyInput.value);
        if (isNaN(value) || value < 1) value = 1;
        if (value > 10) value = 10; // Keep limit for file processing
        concurrencyInput.value = value;
        saveCurrentSettings();
    });
    translationConcurrencyInput.addEventListener('input', () => { // Add listener for new input
        // 输入验证
        let value = parseInt(translationConcurrencyInput.value);
        if (isNaN(value) || value < 1) value = 1;
        if (value > 150) value = 150; // Increase limit for translation concurrency
        translationConcurrencyInput.value = value;
        saveCurrentSettings();
    });

    // 文件上传
    dropZone.addEventListener('dragover', handleDragOver);
    dropZone.addEventListener('dragleave', handleDragLeave);
    dropZone.addEventListener('drop', handleDrop);
    browseBtn.addEventListener('click', () => { if (!isProcessing) fileInput.click(); });
    fileInput.addEventListener('change', handleFileSelect);
    clearBtn.addEventListener('click', handleClearFiles);

    // 目标语言选择
    targetLanguageSelect.addEventListener('change', () => {
        updateCustomLanguageInputVisibility(); // Update visibility based on selection
        saveCurrentSettings(); // Save the new selection
        updatePromptTextareasContent(); // Update prompt textareas based on new language
    });
    customTargetLanguageInput.addEventListener('input', saveCurrentSettings); // Save custom language name changes

    // 默认提示编辑
    useCustomPromptsCheckbox.addEventListener('change', () => {
        updatePromptTextareasContent(); // Update enable/disable and content
        saveCurrentSettings(); // Save the new checkbox state
    });
    defaultSystemPromptTextarea.addEventListener('input', saveCurrentSettings);
    defaultUserPromptTemplateTextarea.addEventListener('input', saveCurrentSettings);

    // 处理和下载
    processBtn.addEventListener('click', handleProcessClick);
    downloadBtn.addEventListener('click', handleDownloadClick);
}

// =====================
// 事件处理函数
// =====================

function handleDragOver(e) {
    e.preventDefault();
    if (!isProcessing) {
        e.currentTarget.classList.add('border-blue-500', 'bg-blue-50');
    }
}

function handleDragLeave(e) {
    e.currentTarget.classList.remove('border-blue-500', 'bg-blue-50');
}

function handleDrop(e) {
    e.preventDefault();
    if (isProcessing) return;
    e.currentTarget.classList.remove('border-blue-500', 'bg-blue-50');
    addFilesToList(e.dataTransfer.files);
}

function handleFileSelect(e) {
    if (isProcessing) return;
    addFilesToList(e.target.files);
    e.target.value = null; // 允许重新选择相同文件
}

function handleClearFiles() {
    if (isProcessing) return;
    pdfFiles = [];
    allResults = []; // 清空结果
    // ========== 新增：清空文件时刷新 window.data ==========
    window.data = {};
    updateFileListUI(pdfFiles, isProcessing, handleRemoveFile);
    updateProcessButtonState(pdfFiles, isProcessing);
}

function handleRemoveFile(indexToRemove) {
    pdfFiles.splice(indexToRemove, 1);
    // ========== 新增：移除文件时刷新 window.data ==========
    if (pdfFiles.length === 1) {
        window.data = { name: pdfFiles[0].name, ocr: '', translation: '', images: [], summaries: {} };
    } else if (pdfFiles.length === 0) {
        window.data = {};
    } else {
        window.data = { summaries: {} };
    }
    updateFileListUI(pdfFiles, isProcessing, handleRemoveFile);
    updateProcessButtonState(pdfFiles, isProcessing);
}

function addFilesToList(selectedFiles) {
    if (!selectedFiles || selectedFiles.length === 0) return;
    let filesAdded = false;
    for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        const fileType = file.name.split('.').pop().toLowerCase();
        if (fileType === 'pdf' || fileType === 'md' || fileType === 'txt') {
            if (!pdfFiles.some(existingFile => existingFile.name === file.name && existingFile.size === file.size)) {
                pdfFiles.push(file);
                filesAdded = true;
            } else {
                showNotification(`文件 "${file.name}" 已在列表中`, 'info');
            }
        } else {
            showNotification(`文件 "${file.name}" 不是支持的文件类型 (PDF, MD, TXT)，已忽略`, 'warning');
        }
    }
    if (filesAdded) {
        // ========== 新增：切换文件时刷新 window.data ==========
        if (pdfFiles.length === 1) {
            // 只选中一个文件时，初始化 window.data
            window.data = { name: pdfFiles[0].name, ocr: '', translation: '', images: [], summaries: {} };
        } else if (pdfFiles.length > 1) {
            // 多文件时，window.data 可按需处理（此处只清空）
            window.data = { summaries: {} };
        }
        updateFileListUI(pdfFiles, isProcessing, handleRemoveFile);
        updateProcessButtonState(pdfFiles, isProcessing);
    }
}

// 根据目标语言下拉菜单更新自定义语言输入框的可见性
function updateCustomLanguageInputVisibility() {
    const targetLangValue = document.getElementById('targetLanguage').value;
    const customInputContainer = document.getElementById('customTargetLanguageContainer');
    if (targetLangValue === 'custom') {
        customInputContainer.classList.remove('hidden');
    } else {
        customInputContainer.classList.add('hidden');
    }
}

// 保存当前所有设置的辅助函数
function saveCurrentSettings() {
    // 从 DOM 读取当前所有设置值
    const targetLangValue = document.getElementById('targetLanguage').value;
    const selectedModel = document.getElementById('translationModel').value;
    let selectedSiteId = null;
    if (selectedModel === 'custom') {
        const siteDropdown = document.getElementById('customSourceSiteSelect');
        if (siteDropdown) {
            selectedSiteId = siteDropdown.value;
        }
    }

    const settingsData = {
        maxTokensPerChunk: document.getElementById('maxTokensPerChunk').value,
        skipProcessedFiles: document.getElementById('skipProcessedFiles').checked,
        selectedTranslationModel: selectedModel,
        selectedCustomSourceSiteId: selectedSiteId, // 新增：保存选定的自定义源站点ID
        concurrencyLevel: document.getElementById('concurrencyLevel').value,
        translationConcurrencyLevel: document.getElementById('translationConcurrencyLevel').value, // Read new setting
        targetLanguage: targetLangValue, // Save target language selection
        customTargetLanguageName: targetLangValue === 'custom' ? document.getElementById('customTargetLanguageInput').value : '', // Save custom language name if applicable
        defaultSystemPrompt: document.getElementById('defaultSystemPrompt').value, // Save default system prompt
        defaultUserPromptTemplate: document.getElementById('defaultUserPromptTemplate').value, // Save default user prompt template
        useCustomPrompts: document.getElementById('useCustomPromptsCheckbox').checked // Save checkbox state
    };
    // 调用 storage.js 中的保存函数
    saveSettings(settingsData);

    // 旧的自定义模型设置保存逻辑已移除，因为它们通过源站点配置进行管理和保存。
    // If a specific custom source site is selected, its details are already saved via key-manager-ui.js
    // and `loadAllCustomSourceSites()` in `handleProcessClick` will fetch them.
}

// =====================
// 核心处理流程启动
// =====================
async function handleProcessClick() {
    if (isProcessing) return;

    // 1. 获取设置，包括选定的翻译模型
    const settings = loadSettings(); // 从存储加载最新设置
    // const selectedTranslationModelName = document.getElementById('translationModel').value; // 旧的直接读取方式
    const selectedTranslationModelName = settings.selectedTranslationModel;

    const requiresMistralKey = pdfFiles.some(file => file.name.toLowerCase().endsWith('.pdf'));

    // 2. 初始化 Key Providers
    let mistralKeyProvider = null;
    if (requiresMistralKey) {
        mistralKeyProvider = new KeyProvider('mistral');
        if (!mistralKeyProvider.hasAvailableKeys()) {
            showNotification('检测到 PDF 文件，但没有可用的 Mistral API Key (请在Key管理中添加并确保状态为有效或未测试)', 'error');
            return;
        }
    }

    let translationKeyProvider = null;
    let currentTranslationModelForProvider = null; // 用于 KeyProvider 的模型名
    let translationModelConfigForProcess = null;   // 用于 processSinglePdf 的模型配置

    if (selectedTranslationModelName !== 'none') {
        if (selectedTranslationModelName === 'custom') {
            const selectedCustomSourceId = settings.selectedCustomSourceSiteId; // 从保存的设置中获取
            if (!selectedCustomSourceId) {
                isProcessing = false;
                updateProcessButtonState(pdfFiles, isProcessing);
                showNotification('请先在主页面选择一个自定义源站点，并确保已配置API Key。', 'error');
                addProgressLog('错误: 未选择自定义源站点 (从设置加载失败)。');

                // 尝试自动展开自定义源站点设置区域
                const customSourceSiteToggle = document.getElementById('customSourceSiteToggle');
                const customSourceSite = document.getElementById('customSourceSite');
                const customSourceSiteToggleIcon = document.getElementById('customSourceSiteToggleIcon');

                if (customSourceSiteToggle && customSourceSite && customSourceSite.classList.contains('hidden')) {
                    customSourceSite.classList.remove('hidden');
                    if (customSourceSiteToggleIcon) {
                        customSourceSiteToggleIcon.setAttribute('icon', 'carbon:chevron-up');
                    }
                }

                return;
            }
            const allSourceSites = typeof loadAllCustomSourceSites === 'function' ? loadAllCustomSourceSites() : {};
            const siteConfig = allSourceSites[selectedCustomSourceId];

            if (!siteConfig) {
                isProcessing = false;
                updateProcessButtonState(pdfFiles, isProcessing);
                showNotification(`未能加载ID为 "${selectedCustomSourceId}" 的自定义源站配置。`, 'error');
                addProgressLog(`错误: 未能加载自定义源站配置 (ID: ${selectedCustomSourceId})。`);
                // UI 清理和返回的逻辑...
                return;
            }
            currentTranslationModelForProvider = `custom_source_${selectedCustomSourceId}`;
            translationModelConfigForProcess = siteConfig;
            addProgressLog(`使用自定义源站: ${siteConfig.displayName || selectedCustomSourceId}`);
        } else {
            // For preset models
            currentTranslationModelForProvider = selectedTranslationModelName;
            translationModelConfigForProcess = typeof loadModelConfig === 'function' ? loadModelConfig(selectedTranslationModelName) : {};
            if (!translationModelConfigForProcess && selectedTranslationModelName !== 'none'){
                 //尝试从旧的 customModelSettings 加载，以兼容旧版单自定义模型设置，但这部分应逐渐淘汰
                console.warn(`Preset model config for ${selectedTranslationModelName} not found via loadModelConfig. Attempting fallback (legacy).`);
            }
            addProgressLog(`使用预设翻译模型: ${selectedTranslationModelName}`);
        }

        if (currentTranslationModelForProvider) {
            translationKeyProvider = new KeyProvider(currentTranslationModelForProvider);
            if (!translationKeyProvider.hasAvailableKeys()) {
                // 优化：更友好的错误提示消息
                const modelDisplayName = translationModelConfigForProcess?.displayName || currentTranslationModelForProvider;
                const isCustomSource = currentTranslationModelForProvider.startsWith('custom_source_');
                let errorMsg = '';

                if (isCustomSource) {
                    const sourceSiteId = currentTranslationModelForProvider.replace('custom_source_', '');
                    errorMsg = `源站 "${modelDisplayName}" 没有可用的 API Key。请点击源站信息下方的"管理该站点 API Key"按钮添加Key。`;

                    // 如果当前在处理页，则尝试自动触发API Key管理
                    if (typeof showNotification === 'function') {
                        setTimeout(() => {
                            const manageBtn = document.getElementById('manageSourceSiteKeyBtn');
                            if (manageBtn && !manageBtn.classList.contains('hidden')) {
                                if (confirm(`是否立即打开源站 "${modelDisplayName}" 的API Key管理界面添加Key？`)) {
                                    manageBtn.click();
                                }
                            }
                        }, 1000);
                    }
                } else {
                    errorMsg = `模型 "${modelDisplayName}" 没有可用的 API Key。请点击页面右上方的"模型与Key管理"按钮添加Key。`;
                }

                showNotification(errorMsg, 'error');
                return;
            }
        }
    } else {
        addProgressLog('未选择翻译模型，跳过翻译步骤。');
    }

    if (pdfFiles.length === 0) {
        showNotification('请选择至少一个文件', 'error');
        return;
    }

    // 4. 设置处理状态等...
    isProcessing = true;
    activeProcessingCount = 0;
    retryAttempts.clear();
    allResults = new Array(pdfFiles.length);
    updateProcessButtonState(pdfFiles, isProcessing);
    showProgressSection();
    addProgressLog('=== 开始批量处理 ===');

    // 5. 获取并发和重试设置等...
    const concurrencyLevel = parseInt(settings.concurrencyLevel) || 1;
    const translationConcurrencyLevel = parseInt(settings.translationConcurrencyLevel) || 2;
    const skipEnabled = settings.skipProcessedFiles;
    const maxTokensValue = parseInt(settings.maxTokensPerChunk) || 2000;
    const targetLanguageSetting = settings.targetLanguage;
    const customTargetLanguageNameSetting = settings.customTargetLanguageName;
    const defaultSystemPromptSetting = settings.defaultSystemPrompt;
    const defaultUserPromptTemplateSetting = settings.defaultUserPromptTemplate;
    const useCustomPromptsSetting = settings.useCustomPrompts;

    const effectiveTargetLanguage = targetLanguageSetting === 'custom'
        ? customTargetLanguageNameSetting.trim() || 'English'
        : targetLanguageSetting;

    translationSemaphore.limit = translationConcurrencyLevel;
    translationSemaphore.count = 0;
    translationSemaphore.queue = [];

    addProgressLog(`文件并发: ${concurrencyLevel}, 翻译并发: ${translationConcurrencyLevel}, 最大重试: ${MAX_RETRIES}, 跳过已处理: ${skipEnabled}`);
    updateConcurrentProgress(0);

    let successCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    const pendingIndices = new Set();
    const filesToProcess = pdfFiles.slice();

    for (let i = 0; i < filesToProcess.length; i++) {
        const file = filesToProcess[i];
        const fileIdentifier = `${file.name}_${file.size}`;
        if (skipEnabled && isAlreadyProcessed(fileIdentifier, processedFilesRecord)) {
            addProgressLog(`[${file.name}] 已处理过，跳过。`);
            skippedCount++;
            allResults[i] = { file: file, skipped: true };
        } else {
            pendingIndices.add(i);
        }
    }

    updateOverallProgress(successCount, skippedCount, errorCount, filesToProcess.length);

    const processQueue = async () => {
        while (pendingIndices.size > 0 || activeProcessingCount > 0) {
            while (pendingIndices.size > 0 && activeProcessingCount < concurrencyLevel) {
                const currentFileIndex = pendingIndices.values().next().value;
                pendingIndices.delete(currentFileIndex);

                const currentFile = filesToProcess[currentFileIndex];
                const fileIdentifier = `${currentFile.name}_${currentFile.size}`;
                const currentRetry = retryAttempts.get(fileIdentifier) || 0;

                activeProcessingCount++;
                updateConcurrentProgress(activeProcessingCount);

                const retryText = currentRetry > 0 ? ` (重试 ${currentRetry}/${MAX_RETRIES})` : '';
                addProgressLog(`--- [${successCount + skippedCount + errorCount + 1}/${filesToProcess.length}] 开始处理: ${currentFile.name}${retryText} ---`);

                let mistralKeyObject = null;
                if (mistralKeyProvider) {
                    if (!mistralKeyProvider.hasAvailableKeys()) {
                        addProgressLog(`[${currentFile.name}] 错误: Mistral模型无可用Key，文件处理失败。`);
                        allResults[currentFileIndex] = { file: currentFile, error: 'Mistral模型无可用Key' };
                        errorCount++;
                        activeProcessingCount--;
                        updateConcurrentProgress(activeProcessingCount);
                        updateOverallProgress(successCount, skippedCount, errorCount, filesToProcess.length);
                        retryAttempts.delete(fileIdentifier);
                        continue;
                    }
                    mistralKeyObject = mistralKeyProvider.getNextKey();
                    if (!mistralKeyObject) {
                         addProgressLog(`[${currentFile.name}] 警告: Mistral Key Provider 返回 null Key。`);
                        allResults[currentFileIndex] = { file: currentFile, error: 'Mistral Key Provider 异常' };
                        errorCount++;
                        activeProcessingCount--;
                        updateConcurrentProgress(activeProcessingCount);
                        updateOverallProgress(successCount, skippedCount, errorCount, filesToProcess.length);
                        retryAttempts.delete(fileIdentifier);
                        continue;
                    }
                }

                let translationKeyObject = null;
                // 使用 currentTranslationModelForProvider 来决定是否需要翻译以及获取Key
                if (translationKeyProvider && currentTranslationModelForProvider && currentTranslationModelForProvider !== 'none') {
                    if (!translationKeyProvider.hasAvailableKeys()) {
                        const modelDisplayName = translationModelConfigForProcess?.displayName || currentTranslationModelForProvider;
                        addProgressLog(`[${currentFile.name}] 警告: ${modelDisplayName} 模型无可用Key，将跳过翻译。`);
                    } else {
                        translationKeyObject = translationKeyProvider.getNextKey();
                        if (!translationKeyObject) {
                            const modelDisplayName = translationModelConfigForProcess?.displayName || currentTranslationModelForProvider;
                            addProgressLog(`[${currentFile.name}] 警告: ${modelDisplayName} Key Provider 返回 null Key。将跳过翻译。`);
                        }
                    }
                }
                // 对于自定义模型，再次确认配置完整性 (translationModelConfigForProcess 应该已经包含所需信息)
                if (
                    selectedTranslationModelName === 'custom' &&
                    (
                        !translationModelConfigForProcess ||
                        (!translationModelConfigForProcess.apiEndpoint && !translationModelConfigForProcess.apiBaseUrl) ||
                        !translationModelConfigForProcess.modelId
                    )
                ) {
                    addProgressLog(`[${currentFile.name}] 错误: 自定义翻译模型 (${translationModelConfigForProcess?.displayName || '未知'}) 配置不完整，将跳过翻译。`);
                    translationKeyObject = null; // 强制跳过翻译
                }

                console.log('translationKeyProvider', translationKeyProvider);
                console.log('currentTranslationModelForProvider', currentTranslationModelForProvider);
                console.log('translationKeyProvider.hasAvailableKeys()', translationKeyProvider && translationKeyProvider.hasAvailableKeys());
                console.log('translationKeyProvider.availableKeys', translationKeyProvider && translationKeyProvider.availableKeys);
                console.log('handleProcessClick: translationKeyObject', translationKeyObject);

                processSinglePdf(
                    currentFile,
                    mistralKeyObject,
                    translationKeyObject,
                    selectedTranslationModelName, // 'custom' or preset model name
                    translationModelConfigForProcess, // Specific site config or preset model config
                    maxTokensValue,
                    effectiveTargetLanguage,
                    acquireTranslationSlot,
                    releaseTranslationSlot,
                    defaultSystemPromptSetting,
                    defaultUserPromptTemplateSetting,
                    useCustomPromptsSetting,
                    function onFileSuccess(fileObj) {
                        // ... (onFileSuccess logic)
                    }
                )
                    .then(async result => {
                        if (result && result.keyInvalid) {
                            const { type, keyIdToInvalidate, modelName: invalidModelNameFromCallback } = result.keyInvalid;
                            const affectedKeyProvider = type === 'mistral' ? mistralKeyProvider : translationKeyProvider;
                            // 使用 currentTranslationModelForProvider (如 custom_source_id) 或 invalidModelNameFromCallback
                            const modelNameToLog = type === 'mistral' ? 'Mistral' :
                                (currentTranslationModelForProvider && currentTranslationModelForProvider.startsWith('custom_source_') ?
                                 (translationModelConfigForProcess?.displayName || currentTranslationModelForProvider) :
                                 (invalidModelNameFromCallback || selectedTranslationModelName));

                            if (affectedKeyProvider && keyIdToInvalidate) {
                                addProgressLog(`[${currentFile.name}] 检测到 ${modelNameToLog} API Key (ID: ${keyIdToInvalidate.slice(0,8)}...) 失效。`);
                                await affectedKeyProvider.markKeyAsInvalid(keyIdToInvalidate);

                                if (affectedKeyProvider.hasAvailableKeys()) {
                                    pendingIndices.add(currentFileIndex);
                                    addProgressLog(`[${currentFile.name}] 将使用下一个可用的 ${modelNameToLog} Key 重试文件。`);
                                } else {
                                    addProgressLog(`[${currentFile.name}] ${modelNameToLog} 模型已无可用Key，文件处理失败。`);
                                    allResults[currentFileIndex] = { file: currentFile, error: `${modelNameToLog} 模型已无可用Key` };
                                    errorCount++;
                                    retryAttempts.delete(fileIdentifier);
                                }
                            } else {
                                addProgressLog(`[${currentFile.name}] Key失效报告不完整，无法标记。文件可能处理失败。`);
                                allResults[currentFileIndex] = { file: currentFile, error: result.error || 'Key失效报告不完整' };
                                errorCount++;
                                retryAttempts.delete(fileIdentifier);
                            }
                        } else if (result && !result.error) {
                            allResults[currentFileIndex] = result;
                            markFileAsProcessed(fileIdentifier, processedFilesRecord);
                            addProgressLog(`[${currentFile.name}] 处理成功！`);
                            successCount++;
                            retryAttempts.delete(fileIdentifier);

                            if (mistralKeyObject) {
                                recordLastSuccessfulKey('mistral', mistralKeyObject.id);
                            }
                            // 当翻译成功时，使用 currentTranslationModelForProvider 记录Key
                            if (translationKeyObject && currentTranslationModelForProvider && currentTranslationModelForProvider !== 'none') {
                                recordLastSuccessfulKey(currentTranslationModelForProvider, translationKeyObject.id);
                            }

                        } else {
                            const errorMsg = result?.error || '未知错误';
                            const nextRetryCount = (retryAttempts.get(fileIdentifier) || 0) + 1;

                            if (nextRetryCount <= MAX_RETRIES) {
                                retryAttempts.set(fileIdentifier, nextRetryCount);
                                pendingIndices.add(currentFileIndex);
                                addProgressLog(`[${currentFile.name}] 处理失败: ${errorMsg}. 稍后重试 (${nextRetryCount}/${MAX_RETRIES}).`);
                            } else {
                                addProgressLog(`[${currentFile.name}] 处理失败: ${errorMsg}. 已达最大重试次数.`);
                                allResults[currentFileIndex] = result || { file: currentFile, error: errorMsg };
                                errorCount++;
                                retryAttempts.delete(fileIdentifier);
                            }
                        }
                    })
                    .catch(error => {
                        console.error(`处理文件 ${currentFile.name} 时发生意外错误:`, error);
                        addProgressLog(`错误: 处理 ${currentFile.name} 失败 - ${error.message}`);
                        allResults[currentFileIndex] = { file: currentFile, error: error.message };
                        errorCount++;
                        retryAttempts.delete(fileIdentifier);
                    })
                    .finally(() => {
                        activeProcessingCount--;
                        updateConcurrentProgress(activeProcessingCount);
                        updateOverallProgress(successCount, skippedCount, errorCount, filesToProcess.length);
                    });

                await new Promise(resolve => setTimeout(resolve, 100));
            }
            if (pendingIndices.size > 0 || activeProcessingCount > 0) {
                await new Promise(resolve => setTimeout(resolve, 200));
            }
        }
    };

    try {
        await processQueue();
    } catch (err) {
        console.error("处理队列时发生严重错误:", err);
        addProgressLog(`严重错误: 处理队列失败 - ${err.message}`);
        const currentCompleted = successCount + skippedCount + errorCount;
        errorCount = filesToProcess.length - currentCompleted;
    } finally {
        addProgressLog('=== 批量处理完成 ===');
        updateOverallProgress(successCount, skippedCount, errorCount, filesToProcess.length);
        updateProgress('全部完成!', 100);
        updateConcurrentProgress(0);

        isProcessing = false;
        updateProcessButtonState(pdfFiles, isProcessing);
        showResultsSection(successCount, skippedCount, errorCount, filesToProcess.length);
        saveProcessedFilesRecord(processedFilesRecord);

        allResults = allResults.filter(r => r !== undefined && r !== null);
        console.log("Final results count:", allResults.length);
    }
}

// =====================
// 下载处理
// =====================
function handleDownloadClick() {
    if (allResults.length > 0) {
        downloadAllResults(allResults);
    } else {
        showNotification('没有可下载的结果', 'warning');
    }
}

// =====================
// 内置提示模板获取
// =====================
function getBuiltInPrompts(languageName) {
    const langLower = languageName.toLowerCase();
    let sys_prompt = '';
    let user_prompt_template = '';
    const sourceLang = 'English'; // Assume source is always English

    switch (langLower) {
        case 'chinese':
            sys_prompt = "你是一个专业的文档翻译助手，擅长将文本精确翻译为简体中文，同时保留原始的 Markdown 格式。";
            user_prompt_template = `请将以下内容翻译为 **简体中文**。\n要求:\n\n1. 保持所有 Markdown 语法元素不变（如 # 标题、 *斜体*、 **粗体**、 [链接]()、 ![图片]() 等）。\n2. 学术/专业术语应准确翻译。\n3. 保持原文的段落结构和格式。\n4. 仅输出翻译后的内容，不要包含任何额外的解释或注释。\n5. 对于行间公式，使用 $$...$$ 标记。\n\n请主动区分该内容是行间公式还是行内公式，使用准确的公式标记。输出$$,$$$$的公式时候：前后需要带空格或换行，公式内部不需要带空格。\n\n文档内容:\n\n\${content}`;
            break;
        case 'japanese':
            sys_prompt = "あなたはプロの文書翻訳アシスタントで、テキストを正確に日本語に翻訳し、元の Markdown 形式を維持することに長けています。";
            user_prompt_template = `以下の内容を **日本語** に翻訳してください。\n要件:\n\n1. すべての Markdown 構文要素（例: # 見出し、 *イタリック*、 **太字**、 [リンク]()、 ![画像]() など）は変更しないでください。\n2. 学術/専門用語は正確に翻訳してください。\n3. 元の段落構造と書式を維持してください。\n4. 翻訳された内容のみを出力し、余分な説明や注釈は含めないでください。\n5. 表示数式には $$...$$ を使用してください。\n\n数式がディスプレイ数式（行間）かインライン数式かを必ず区別し、正しい数式記号を使用してください。$$や$$$$の数式を出力する際は、前後にスペースまたは改行を入れ、数式内部にはスペースを入れないでください。\n\nドキュメント内容:\n\n\${content}`;
            break;
        case 'korean':
            sys_prompt = "당신은 전문 문서 번역 도우미로, 텍스트를 정확하게 한국어로 번역하고 원본 마크다운 형식을 유지하는 데 능숙합니다.";
            user_prompt_template = `다음 내용을 **한국어** 로 번역해 주세요。\n요구 사항:\n\n1. 모든 마크다운 구문 요소(예: # 제목, *기울임꼴*, **굵게**, [링크](), ![이미지]() 등)를 변경하지 마십시오.\n2. 학술/전문 용어는 정확하게 번역하십시오.\n3. 원본 단락 구조와 서식을 유지하십시오.\n4. 번역된 내용만 출력하고 추가 설명이나 주석을 포함하지 마십시오.\n5. 수식 표시는 $$...$$ 를 사용하십시오。\n\n수식이 디스플레이 수식(행간)인지 인라인 수식인지 반드시 구분하고, 정확한 수식 표기법을 사용하세요. $$, $$$$ 수식을 출력할 때는 앞뒤에 공백 또는 줄바꿈을 넣고, 수식 내부에는 공백을 넣지 마세요.\n\n문서 내용:\n\n\${content}`;
            break;
        case 'french':
            sys_prompt = "Vous êtes un assistant de traduction de documents professionnel, compétent pour traduire avec précision le texte en français tout en préservant le format Markdown d'origine.";
            user_prompt_template = `Veuillez traduire le contenu suivant en **Français**。\nExigences:\n\n1. Conserver tous les éléments de syntaxe Markdown inchangés (par exemple, # titres, *italique*, **gras**, [liens](), ![images]()).\n2. Traduire avec précision les termes académiques/professionnels.\n3. Maintenir la structure et le formatage des paragraphes d'origine.\n4. Produire uniquement le contenu traduit, sans explications ni annotations supplémentaires.\n5. Pour les formules mathématiques, utiliser \\$\$...\$\$.\n\nVeuillez distinguer explicitement entre les formules en ligne et les formules en display, et utilisez la notation appropriée. Lors de la sortie des formules $$ ou $$$$, ajoutez un espace ou un saut de ligne avant et après, sans espace à l'intérieur de la formule.\n\nContenu du document:\n\n\${content}`;
            break;
        case 'english':
            sys_prompt = "You are a professional document translation assistant, skilled at accurately translating text into English while preserving the original document format.";
            user_prompt_template = `Please translate the following content into **English**.\n Requirements:\n\n 1. Keep all Markdown syntax elements unchanged (e.g., #headings, *italics*, **bold**, [links](), ![images]()).\n 2. Translate academic/professional terms accurately. Maintain a formal, academic tone.\n 3. Maintain the original paragraph structure and formatting.\n 4. Output only the translated content.\n 5. For display math formulas, use:\n \\$\$\n ...\n \\$\$\n\nPlease explicitly distinguish between display (block) and inline formulas, and use the correct formula markers. When outputting formulas with $$ or $$$$, add a space or line break before and after, and do not add spaces inside the formula.\n\n Document Content:\n\n \${content}`;
            break;
        default: // Fallback for custom languages or other cases
            const targetLangDisplayName = languageName; // Use the passed name directly
            sys_prompt = `You are a professional document translation assistant, skilled at accurately translating content into ${targetLangDisplayName} while preserving the original document format.`;
            user_prompt_template = `Please translate the following content into **${targetLangDisplayName}**. \nRequirements:\n\n1. Keep all Markdown syntax elements unchanged (e.g., #headings, *italics*, **bold**, [links](), ![images]()).\n2. Translate academic/professional terms accurately. If necessary, keep the original term in parentheses if unsure about the translation in ${targetLangDisplayName}.\n3. Maintain the original paragraph structure and formatting.\n4. Translate only the content; do not add extra explanations.\n5. For display math formulas, use:\n\$\$\n...\n\$\$\n\nPlease explicitly distinguish between display (block) and inline formulas, and use the correct formula markers. When outputting formulas with $$ or $$$$, add a space or line break before and after, and do not add spaces inside the formula.\n\nDocument Content:\n\n\${content}`;
            break;
    } // End of switch
    //console.log('getBuiltInPrompts 返回:', {systemPrompt: sys_prompt, userPromptTemplate: user_prompt_template});
    return { systemPrompt: sys_prompt, userPromptTemplate: user_prompt_template };
} // End of getBuiltInPrompts function

// =====================
// 提示区内容与状态联动
// =====================
function updatePromptTextareasContent() {
    const useCustomCheckbox = document.getElementById('useCustomPromptsCheckbox');
    const systemPromptTextarea = document.getElementById('defaultSystemPrompt');
    const userPromptTextarea = document.getElementById('defaultUserPromptTemplate');
    const currentSettings = loadSettings(); // Get current settings to access saved prompts
    const targetLangValue = document.getElementById('targetLanguage').value;
    const effectiveLangName = targetLangValue === 'custom' ? (document.getElementById('customTargetLanguageInput').value.trim() || 'English') : targetLangValue;
    const promptsContainer = document.getElementById('customPromptsContainer'); // Get the container

    if (useCustomCheckbox.checked) {
        promptsContainer.classList.remove('hidden'); // Show the container
        systemPromptTextarea.disabled = false; // Enable the textarea
        userPromptTextarea.disabled = false; // Enable the textarea

        const builtInPrompts = getBuiltInPrompts(effectiveLangName);
        const savedSystemPrompt = currentSettings.defaultSystemPrompt;
        const savedUserPrompt = currentSettings.defaultUserPromptTemplate;

        // If saved prompt is empty or same as built-in, show built-in, else show saved
        systemPromptTextarea.value = (savedSystemPrompt === null || savedSystemPrompt.trim() === '' || savedSystemPrompt === builtInPrompts.systemPrompt)
            ? builtInPrompts.systemPrompt
            : savedSystemPrompt;

        userPromptTextarea.value = (savedUserPrompt === null || savedUserPrompt.trim() === '' || savedUserPrompt === builtInPrompts.userPromptTemplate)
            ? builtInPrompts.userPromptTemplate
            : savedUserPrompt;

    } else {
        promptsContainer.classList.add('hidden'); // Hide the container
        systemPromptTextarea.disabled = true; // Disable the textarea
        userPromptTextarea.disabled = true; // Disable the textarea
    }
}

// =====================
// 其他协调逻辑
// =====================
// ...（如有其他 app.js 级别的协调逻辑，可在此补充）...

/**
 * 更新本地存储中指定模型最后成功使用的Key ID
 * @param {string} modelName
 * @param {string} keyId
 */
function recordLastSuccessfulKey(modelName, keyId) {
    if (!modelName || !keyId) return;
    try {
        let records = JSON.parse(localStorage.getItem(LAST_SUCCESSFUL_KEYS_LS_KEY) || '{}');
        records[modelName] = keyId;
        localStorage.setItem(LAST_SUCCESSFUL_KEYS_LS_KEY, JSON.stringify(records));
    } catch (e) {
        console.error('Failed to record last successful key:', e);
    }
}

/**
 * 获取本地存储中指定模型最后成功使用的Key ID
 * @param {string} modelName
 * @returns {string | null}
 */
function getLastSuccessfulKeyId(modelName) {
    if (!modelName) return null;
    try {
        const records = JSON.parse(localStorage.getItem(LAST_SUCCESSFUL_KEYS_LS_KEY) || '{}');
        return records[modelName] || null;
    } catch (e) {
        console.error('Failed to get last successful key ID:', e);
        return null;
    }
}
