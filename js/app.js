// app.js - 主入口点和事件协调器

// =====================
// 全局状态变量与并发控制
// =====================
/**
 * @file app.js
 * @description
 * 该文件是应用程序的主入口点和事件协调器。它负责管理用户界面交互、
 * 文件处理流程（包括 OCR 和翻译）、API 密钥管理、设置加载与保存、
 * 以及整体应用程序状态。
 *
 * 主要功能包括：
 * - **初始化**: DOMContentLoaded后加载设置、处理记录，并绑定事件监听器。
 * - **UI交互**: 管理文件列表、处理按钮状态、进度显示、翻译设置等UI元素的更新。
 * - **文件处理**:
 *   - 协调PDF、MD、TXT文件的读取、分块、OCR（使用Mistral API）。
 *   - 调用翻译模块对提取的文本进行翻译（支持多种预设及自定义模型）。
 * - **API密钥管理**:
 *   - 通过 `KeyProvider` 类管理不同模型（Mistral、翻译模型）的API密钥。
 *   - 支持密钥的轮询使用、状态标记（有效/无效）、以及从localStorage加载和保存。
 * - **并发控制**:
 *   - 管理文件处理的并发数量。
 *   - 通过信号量 (`translationSemaphore`) 控制翻译任务的并发。
 * - **错误处理与重试**: 实现文件处理失败时的重试机制。
 * - **结果处理**: 收集处理结果，并提供下载功能。
 * - **设置管理**: 加载和保存用户设置（如分块大小、并发数、所选模型等）。
 * - **提示词管理**: 根据用户选择的目标语言或自定义设置，生成或加载相应的翻译提示词。
 */

/**
 * @type {File[]}
 * @description 存储用户选择的待处理文件列表。
 */
let pdfFiles = [];
/**
 * @type {Array<Object>}
 * @description 存储所有文件处理后的结果对象。每个对象通常包含文件名、OCR文本、翻译文本等。
 */
let allResults = [];
/**
 * @type {Object}
 * @description 从 localStorage 加载的已处理文件记录，用于跳过已处理的文件。键为文件标识符，值为 true。
 */
let processedFilesRecord = {};
/**
 * @type {boolean}
 * @description 标记当前是否正在进行文件处理流程。
 */
let isProcessing = false;
/**
 * @type {number}
 * @description 当前活动的（正在处理中的）文件数量。
 */
let activeProcessingCount = 0;
/**
 * @type {Map<string, number>}
 * @description 记录每个文件（以其标识符为键）当前的重试次数。
 */
let retryAttempts = new Map();
/**
 * @const {number} MAX_RETRIES
 * @description 单个文件处理失败时的最大重试次数。
 */
const MAX_RETRIES = 3;
/**
 * @const {string} LAST_SUCCESSFUL_KEYS_LS_KEY
 * @description 用于在 localStorage 中存储各模型最后一次成功使用的 API Key ID 的键名。
 */
const LAST_SUCCESSFUL_KEYS_LS_KEY = 'paperBurnerLastSuccessfulKeys';

/**
 * @typedef {Object} Semaphore
 * @property {number} limit - 信号量允许的最大并发数。
 * @property {number} count - 当前已占用的并发数。
 * @property {Array<Function>} queue - 等待获取信号量的任务队列。
 */

/**
 * @type {Semaphore}
 * @description 用于控制翻译任务并发的信号量。
 */
let translationSemaphore = {
    limit: 2, // 默认翻译并发数，可由设置覆盖
    count: 0,
    queue: []
};

/**
 * @const {string}
 * @description 批量导出的默认命名模板。
 */
const DEFAULT_BATCH_TEMPLATE = '{original_name}_{output_language}_{processing_time:YYYYMMDD-HHmmss}.{original_type}';

const SUPPORTED_FILE_EXTENSIONS = ['pdf', 'md', 'txt', 'docx', 'pptx', 'html', 'htm', 'epub', 'yaml', 'yml', 'json', 'csv', 'ini', 'cfg', 'log', 'tex'];
const SUPPORTED_ARCHIVE_EXTENSIONS = ['zip'];

/**
 * @type {boolean}
 * @description 用户是否开启批量模式的偏好设置。
 */
let batchModeEnabled = false;
/**
 * @type {string}
 * @description 批量导出使用的命名模板。
 */
let batchModeTemplate = DEFAULT_BATCH_TEMPLATE;
/**
 * @type {string[]}
 * @description 批量导出需要生成的格式集合。
 */
let batchModeFormats = ['original', 'markdown'];
/**
 * @type {boolean}
 * @description 批量导出时是否强制打包为 ZIP。
 */
let batchModeZipEnabled = false;

/**
 * @type {boolean}
 * @description 批量配置面板是否折叠。
 */
let batchConfigCollapsed = true;

/**
 * @type {Set<string>}
 * @description 被排除的文件扩展名集合。
 */
const excludedExtensions = new Set();
/**
 * @type {{id:string,total:number,template:string,formats:string[],outputLanguage:string,startedAt:string,counter:number}|null}
 * @description 当前批量处理的上下文信息，在一次处理流程内存在。
 */
let activeBatchSession = null;

/**
 * @class KeyProvider
 * @description 负责加载、筛选、排序和轮询特定模型的API Keys。
 * 它从 localStorage 读取保存的密钥，管理其状态（如'valid', 'untested', 'invalid'），
 * 并在处理过程中提供下一个可用的密钥。
 */
class KeyProvider {
    /**
     * KeyProvider 构造函数。
     * @param {string} modelName - 需要管理 API Keys 的模型名称 (例如 'mistral', 'gemini', 或自定义源站点 'custom_source_xxx')。
     */
    constructor(modelName) {
        /** @type {string} */
        this.modelName = modelName;
        /**
         * @type {Array<Object>}
         * @description 存储从localStorage加载的原始key对象数组。
         * 每个对象结构: {id: string, value: string, remark: string, status: string, order: number}
         */
        this.keys = [];
        /**
         * @type {Array<Object>}
         * @description 存储经过筛选和排序的、当前轮次可用的key对象数组 (status为 'valid' 或 'untested')。
         */
        this.availableKeys = [];
        /**
         * @type {number}
         * @description 当前轮询可用密钥列表的索引。
         */
        this.currentIndex = 0;
        this.loadAndPrepareKeys();
    }

    /**
     * 加载并准备指定模型的API Keys。
     * 它会调用 `loadModelKeys` 从 localStorage 获取密钥，
     * 然后筛选出状态为 'valid' 或 'untested' 的密钥，并按 `order` 排序。
     */
    loadAndPrepareKeys() {
        this.keys = typeof loadModelKeys === 'function' ? loadModelKeys(this.modelName) : [];
        // 筛选出 'valid' 或 'untested' 的 keys，并按 order 排序 (loadModelKeys 内部已排序)
        this.availableKeys = this.keys.filter(key => key.status === 'valid' || key.status === 'untested');
        this.currentIndex = 0;
        if (this.availableKeys.length === 0) {
            console.warn(`KeyProvider: No 'valid' or 'untested' keys found for model ${this.modelName}`);
        }
    }

    /**
     * 获取下一个可用的API Key对象。
     * 实现轮询机制，循环使用 `availableKeys` 列表中的密钥。
     * @returns {Object|null} 返回一个密钥对象 {id, value, status, remark, order}，如果没有可用密钥则返回 null。
     */
    getNextKey() {
        if (this.availableKeys.length === 0) {
            return null; // 没有可用的key
        }
        const keyObject = this.availableKeys[this.currentIndex];
        this.currentIndex = (this.currentIndex + 1) % this.availableKeys.length;
        return keyObject; // 返回整个key对象，包含 {id, value, status, remark, order}
    }

    /**
     * 将指定的API Key标记为无效。
     * 这会更新该密钥在 `this.keys` 中的状态，并将其从 `this.availableKeys` 中移除。
     * 同时，会尝试异步保存更新后的密钥列表到 localStorage，并刷新Key管理界面的UI（如果存在）。
     * @param {string} keyId - 要标记为无效的密钥的ID。
     * @async
     */
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

    /**
     * 检查是否有可用的 API Keys。
     * @returns {boolean} 如果 `availableKeys` 列表不为空，则返回 true，否则返回 false。
     */
    hasAvailableKeys() {
        return this.availableKeys.length > 0;
    }
}

/**
 * 获取一个翻译并发槽（基于信号量实现）。
 * 如果当前并发数未达到上限，则立即获取槽位。
 * 否则，将请求加入等待队列，直到有槽位释放。
 * @returns {Promise<void>} 当成功获取槽位时 resolve 的 Promise。
 * @async
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
 * 释放一个翻译并发槽。
 * 减少当前并发数，并检查等待队列中是否有任务，如果有，则唤醒队列中的下一个任务。
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
/**
 * 当DOM完全加载并解析后执行的初始化函数。
 * 主要任务包括：
 * 1. 加载用户设置和已处理文件记录。
 * 2. 将加载的设置应用到UI元素上。
 * 3. 初始化UI组件状态（如文件列表、处理按钮等）。
 * 4. 绑定所有必要的事件监听器。
 * 5. 初始化自定义模型检测UI（如果相关功能已定义）。
 */
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
    refreshFormatFilters();
    refreshFormatFilters();

    // 暴露刷新验证状态的全局函数
    window.refreshValidationState = function() {
        console.log('[Validation] Refreshing validation state');
        updateProcessButtonState(pdfFiles, isProcessing);
    };

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
/**
 * 将加载的设置对象应用到各个UI元素上。
 * 例如，设置滑块的值、复选框的选中状态、下拉菜单的选定项等。
 * @param {Object} settings - 从 `loadSettings` 加载的设置对象。
 */
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
        useCustomPrompts: useCustomPromptsVal,
        enableGlossary: enableGlossaryVal,
        batchModeEnabled: batchEnabledVal = false,
        batchModeTemplate: batchTemplateVal = DEFAULT_BATCH_TEMPLATE,
        batchModeFormats: batchFormatsVal = ['original', 'markdown'],
        batchModeZipEnabled: batchZipVal = false
    } = settings;

    batchModeEnabled = !!batchEnabledVal;
    batchModeTemplate = typeof batchTemplateVal === 'string' && batchTemplateVal.trim()
        ? batchTemplateVal
        : DEFAULT_BATCH_TEMPLATE;
    batchModeFormats = Array.isArray(batchFormatsVal) && batchFormatsVal.length > 0
        ? Array.from(new Set(['original', ...batchFormatsVal]))
        : ['original', 'markdown'];
    batchModeZipEnabled = !!batchZipVal;
    batchConfigCollapsed = true;

    // 应用到各 DOM 元素
    const maxTokensSlider = document.getElementById('maxTokensPerChunk');
    if (maxTokensSlider) {
        maxTokensSlider.value = maxTokensVal;
        document.getElementById('maxTokensPerChunkValue').textContent = maxTokensVal;
    }
    document.getElementById('skipProcessedFiles').checked = skipProcessedFiles;
    const translationModelSelect = document.getElementById('translationModel');
    if (translationModelSelect) {
        const normalizedModel = (modelVal === 'gemini-preview') ? 'gemini' : modelVal;
        translationModelSelect.value = normalizedModel;
    }

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

    const batchTemplateInput = document.getElementById('batchModeTemplate');
    if (batchTemplateInput) {
        batchTemplateInput.value = batchModeTemplate;
    }
    const batchFormatCheckboxes = document.querySelectorAll('[data-batch-format]');
    const batchZipCheckbox = document.querySelector('[data-batch-zip]');
    if (batchFormatCheckboxes.length > 0) {
        let matched = false;
        batchFormatCheckboxes.forEach(cb => {
            const fmt = cb.getAttribute('data-batch-format');
            const isChecked = batchModeFormats.includes(fmt);
            cb.checked = isChecked;
            if (isChecked) matched = true;
        });
        const originalCheckbox = document.querySelector('[data-batch-format="original"]');
        if (originalCheckbox && !originalCheckbox.checked) {
            originalCheckbox.checked = true;
            if (!batchModeFormats.includes('original')) batchModeFormats.unshift('original');
        }
        if (!matched) {
            batchModeFormats = ['original', 'markdown'];
            batchFormatCheckboxes.forEach(cb => {
                if (['original', 'markdown'].includes(cb.getAttribute('data-batch-format'))) {
                    cb.checked = true;
                } else {
                    cb.checked = false;
                }
            });
        }
    }
    if (batchZipCheckbox) {
        batchZipCheckbox.checked = batchModeZipEnabled;
    }

    if (typeof updateCustomLanguageInputVisibility === 'function') {
        updateCustomLanguageInputVisibility();
    }

    // 单个自定义提示词：填充默认或用户上次修改
    const defaultSystemPromptTextarea = document.getElementById('defaultSystemPrompt');
    const defaultUserPromptTemplateTextarea = document.getElementById('defaultUserPromptTemplate');
    const sysDefault = '你是专业的文档翻译助手。请将用户提供的内容精准翻译为指定语言，严格保留 Markdown 结构与标记，不添加任何说明性文字。';
    const userDefault = '请将以下内容翻译为${targetLangName}：\n\n${content}';
    if (defaultSystemPromptTextarea) {
        defaultSystemPromptTextarea.value = (defaultSysPromptVal && defaultSysPromptVal.trim()) ? defaultSysPromptVal : sysDefault;
    }
    if (defaultUserPromptTemplateTextarea) {
        defaultUserPromptTemplateTextarea.value = (defaultUserPromptVal && defaultUserPromptVal.trim()) ? defaultUserPromptVal : userDefault;
    }
    
    // 设置提示词模式
    const promptMode = settings.promptMode || 'builtin';
    const promptModeRadio = document.querySelector(`input[name="promptMode"][value="${promptMode}"]`);
    if (promptModeRadio) promptModeRadio.checked = true;

    // 备择库开关
    const enableGlossaryToggle = document.getElementById('enableGlossaryToggle');
    if (enableGlossaryToggle) enableGlossaryToggle.checked = !!enableGlossaryVal;

    // 自定义模型设置 (旧版逻辑，现在主要由源站点管理)
    // 这里不再直接从 settings.customModelSettings 读取并填充旧的自定义模型输入框
    // 因为这些设置现在应该通过 key-manager-ui.js 中的源站点表单进行管理。
    // 如果需要，可以在选择特定源站点时，由 ui.js 更新这些显示（如果这些输入框还保留用于显示目的）。

    // 触发 UI 相关联动
    updateTranslationUIVisibility(isProcessing);
    updateCustomLanguageInputVisibility();

    if (typeof syncBatchModeControls === 'function') {
        syncBatchModeControls(pdfFiles.length);
    }
    updateBatchConfigCollapse();
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
/**
 * 绑定应用程序中所有主要的DOM事件监听器。
 * 包括API Key输入、模型选择、高级设置切换、文件上传、处理按钮点击等。
 */
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
    const folderInput = document.getElementById('folderInput');
    const browseBtn = document.getElementById('browseFilesBtn');
    const browseFolderBtn = document.getElementById('browseFolderBtn');
    const githubImportBtn = document.getElementById('githubImportBtn');
    const clearBtn = document.getElementById('clearFilesBtn');
    const processBtn = document.getElementById('processBtn');
    const downloadBtn = document.getElementById('downloadAllBtn');
    const formatFilterContainer = document.getElementById('fileFormatFilters');
    const batchToggle = document.getElementById('batchModeToggle');
    const batchTemplateInput = document.getElementById('batchModeTemplate');
    const batchFormatInputs = document.querySelectorAll('[data-batch-format]');
    const batchZipCheckbox = document.querySelector('[data-batch-zip]');
    const batchConfigToggle = document.getElementById('batchModeConfigToggle');
    const targetLanguageSelect = document.getElementById('targetLanguage'); 
    const customTargetLanguageInput = document.getElementById('customTargetLanguageInput');
    const defaultSystemPromptTextarea = document.getElementById('defaultSystemPrompt');
    const defaultUserPromptTemplateTextarea = document.getElementById('defaultUserPromptTemplate');
    const customModelInputs = [
        document.getElementById('customApiEndpoint'),
        document.getElementById('customModelId'),
        document.getElementById('customRequestFormat'),
        document.getElementById('customTemperature'),
        document.getElementById('customMaxTokens')
    ];
    const customSourceSiteDropdown = document.getElementById('customSourceSiteSelect');
    const customSourceSiteToggleBtn = document.getElementById('customSourceSiteToggle');
    const customSourceSiteDiv = document.getElementById('customSourceSite');
    const customSourceSiteToggleIconEl = document.getElementById('customSourceSiteToggleIcon');
    const enableGlossaryToggle = document.getElementById('enableGlossaryToggle');

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
        if (typeof window.updateDeeplxTargetLangHint === 'function') {
            window.updateDeeplxTargetLangHint();
        }
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

    if (enableGlossaryToggle) {
        enableGlossaryToggle.addEventListener('change', saveCurrentSettings);
    }

    if (batchToggle) {
        batchToggle.addEventListener('change', () => {
            batchModeEnabled = batchToggle.checked;
            syncBatchModeControls(pdfFiles.length);
            saveCurrentSettings();
        });
    }
    if (batchTemplateInput) {
        const syncTemplateValue = () => {
            const raw = batchTemplateInput.value;
            batchModeTemplate = raw && raw.trim() ? raw.trim() : DEFAULT_BATCH_TEMPLATE;
        };
        batchTemplateInput.addEventListener('input', () => {
            syncTemplateValue();
            saveCurrentSettings();
        });
        batchTemplateInput.addEventListener('blur', () => {
            if (!batchTemplateInput.value.trim()) {
                batchTemplateInput.value = DEFAULT_BATCH_TEMPLATE;
                batchModeTemplate = DEFAULT_BATCH_TEMPLATE;
                saveCurrentSettings();
            }
        });
    }
    if (batchFormatInputs && batchFormatInputs.length > 0) {
        batchFormatInputs.forEach(input => {
            input.addEventListener('change', () => {
                const selected = Array.from(document.querySelectorAll('[data-batch-format]:checked'))
                    .map(el => el.getAttribute('data-batch-format'))
                    .filter(Boolean);
                if (!selected.includes('original')) {
                    const originalCheckbox = document.querySelector('[data-batch-format="original"]');
                    if (originalCheckbox) {
                        originalCheckbox.checked = true;
                    }
                    selected.unshift('original');
                    if (typeof showNotification === 'function') {
                        showNotification('已自动保留“原格式”导出项。', 'info');
                    }
                }
                if (selected.length === 0) {
                    const fallback = document.querySelector('[data-batch-format="original"]');
                    if (fallback) fallback.checked = true;
                    selected.push('original');
                }
                batchModeFormats = Array.from(new Set(selected));
                saveCurrentSettings();
            });
        });
    }
    if (batchZipCheckbox) {
        batchZipCheckbox.addEventListener('change', () => {
            batchModeZipEnabled = batchZipCheckbox.checked;
            saveCurrentSettings();
        });
    }

    if (formatFilterContainer) {
        formatFilterContainer.addEventListener('change', handleFormatFilterChange);
        formatFilterContainer.addEventListener('click', handleFormatFilterClick);
    }

    if (batchConfigToggle) {
        batchConfigToggle.addEventListener('click', () => {
            batchConfigCollapsed = !batchConfigCollapsed;
            updateBatchConfigCollapse();
        });
    }

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
        if (value > 50) value = 50; // Allow higher concurrency for file processing
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
    if (browseFolderBtn && folderInput) {
        browseFolderBtn.addEventListener('click', () => { if (!isProcessing) folderInput.click(); });
    }
    if (folderInput) {
        folderInput.addEventListener('change', handleFolderSelect);
    }
    if (githubImportBtn) {
        githubImportBtn.addEventListener('click', async () => {
            if (isProcessing) return;
            await handleGithubImport();
        });
    }
    clearBtn.addEventListener('click', handleClearFiles);

    // 目标语言选择
    targetLanguageSelect.addEventListener('change', () => {
        updateCustomLanguageInputVisibility(); // Update visibility based on selection
        if (typeof window.updateDeeplxTargetLangHint === 'function') {
            window.updateDeeplxTargetLangHint();
        }
        saveCurrentSettings(); // Save the new selection
    });
    customTargetLanguageInput.addEventListener('input', () => {
        saveCurrentSettings();
        if (typeof window.updateDeeplxTargetLangHint === 'function') {
            window.updateDeeplxTargetLangHint();
        }
    }); // Save custom language name changes

    // 默认提示编辑
    if (defaultSystemPromptTextarea) {
        defaultSystemPromptTextarea.addEventListener('input', saveCurrentSettings);
    }
    if (defaultUserPromptTemplateTextarea) {
        defaultUserPromptTemplateTextarea.addEventListener('input', saveCurrentSettings);
    }

    // 处理和下载
    processBtn.addEventListener('click', handleProcessClick);
    downloadBtn.addEventListener('click', handleDownloadClick);

    if (typeof window.updateDeeplxTargetLangHint === 'function') {
        window.updateDeeplxTargetLangHint();
    }
}

// =====================
// 事件处理函数
// =====================

/**
 * 处理文件拖拽到上传区域时的 `dragover` 事件。
 * @param {DragEvent} e - 拖拽事件对象。
 */
function handleDragOver(e) {
    e.preventDefault();
    if (!isProcessing) {
        e.currentTarget.classList.add('border-blue-500', 'bg-blue-50');
    }
}

/**
 * 处理文件拖拽离开上传区域时的 `dragleave` 事件。
 * @param {DragEvent} e - 拖拽事件对象。
 */
function handleDragLeave(e) {
    e.currentTarget.classList.remove('border-blue-500', 'bg-blue-50');
}

/**
 * 处理文件拖放到上传区域时的 `drop` 事件。
 * @param {DragEvent} e - 拖拽事件对象。
 */
async function handleDrop(e) {
    e.preventDefault();
    if (isProcessing) return;
    e.currentTarget.classList.remove('border-blue-500', 'bg-blue-50');
    const files = await extractFilesFromDataTransfer(e.dataTransfer);
    await addFilesToList(files);
}

/**
 * 处理通过文件输入框选择文件后的 `change` 事件。
 * @param {Event} e - 事件对象，`e.target` 是文件输入框。
 */
async function handleFileSelect(e) {
    if (isProcessing) return;
    await addFilesToList(e.target.files);
    e.target.value = null; // 允许重新选择相同文件
}

async function handleFolderSelect(e) {
    if (isProcessing) return;
    await addFilesToList(e.target.files);
    e.target.value = null;
}

/**
 * 处理点击"清空列表"按钮的事件。
 * 清空 `pdfFiles` 数组和 `allResults` 数组，并更新UI。
 * 同时清空 `window.data` 用于调试或特定UI显示。
 */
function handleClearFiles() {
    if (isProcessing) return;
    pdfFiles = [];
    allResults = []; // 清空结果
    // ========== 新增：清空文件时刷新 window.data ==========
    window.data = {};
    updateFileListUI(pdfFiles, isProcessing, handleRemoveFile);
    updateProcessButtonState(pdfFiles, isProcessing);
    refreshFormatFilters();
}

/**
 * 根据当前已选择的文件数量同步批量模式相关控件的状态。
 *
 * @param {number} fileCount - 当前列表中的文件数量。
 */
function syncBatchModeControls(fileCount) {
    const wrapper = document.getElementById('batchModeToggleWrapper');
    const toggle = document.getElementById('batchModeToggle');
    const configPanel = document.getElementById('batchModeConfig');
    const configBody = document.getElementById('batchModeConfigBody');

    const available = fileCount >= 2;
    if (wrapper) {
        wrapper.classList.toggle('hidden', !available);
    }
    if (toggle) {
        toggle.disabled = !available;
        toggle.checked = available && batchModeEnabled;
    }
    if (configPanel) {
        const shouldShowConfig = available && batchModeEnabled;
        configPanel.classList.toggle('hidden', !shouldShowConfig);
        if (!shouldShowConfig) {
            batchConfigCollapsed = true;
        }
    }

    if (configPanel && configBody) {
        updateBatchConfigCollapse();
    }
}

window.syncBatchModeControls = syncBatchModeControls;

/**
 * 处理从文件列表中移除单个文件的操作。
 * @param {number} indexToRemove - 要从 `pdfFiles` 数组中移除的文件的索引。
 */
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
    refreshFormatFilters();
}

/**
 * 将用户选择的文件添加到待处理列表 `pdfFiles` 中。
 * 会进行文件类型检查（支持 PDF / MD / TXT / DOCX / PPTX / HTML / EPUB）和重复文件检查（基于文件名和大小）。
 * 添加文件后会更新UI。
 * @param {FileList} selectedFiles - 用户通过拖拽或文件对话框选择的文件列表。
 */
async function addFilesToList(selectedFiles) {
    if (!selectedFiles || selectedFiles.length === 0) return;
    const fileArray = Array.from(selectedFiles);
    const incomingFiles = [];

    for (const rawFile of fileArray) {
        const ext = deriveExtension(rawFile && rawFile.name ? rawFile.name : '');
        if (SUPPORTED_ARCHIVE_EXTENSIONS.includes(ext)) {
            const extracted = await extractFilesFromZip(rawFile);
            if (extracted.length === 0) {
                showNotification && showNotification(`压缩包 "${rawFile.name}" 中没有可处理的文件`, 'info');
            }
            incomingFiles.push(...extracted);
            continue;
        }

        if (!isSupportedFileExtension(ext)) {
            const supportedLabel = SUPPORTED_FILE_EXTENSIONS.map(v => v.toUpperCase()).join(' / ');
            showNotification && showNotification(`文件 "${rawFile.name}" 不是支持的文件类型 (${supportedLabel})，已忽略`, 'warning');
            continue;
        }

        annotateFileMetadata(rawFile);
        incomingFiles.push(rawFile);
    }

    if (incomingFiles.length === 0) return;

    let filesAdded = false;
    incomingFiles.forEach(file => {
        const identifier = buildFileIdentifier(file);
        const duplication = pdfFiles.some(existing => buildFileIdentifier(existing) === identifier);
        if (duplication) {
            showNotification && showNotification(`文件 "${getFileDisplayName(file)}" 已在列表中`, 'info');
            return;
        }
        pdfFiles.push(file);
        filesAdded = true;
    });

    if (filesAdded) {
        if (pdfFiles.length === 1) {
            window.data = { name: pdfFiles[0].name, ocr: '', translation: '', images: [], summaries: {} };
        } else if (pdfFiles.length > 1) {
            window.data = { summaries: {} };
        }
        updateFileListUI(pdfFiles, isProcessing, handleRemoveFile);
        updateProcessButtonState(pdfFiles, isProcessing);
        syncBatchModeControls(pdfFiles.length);
        refreshFormatFilters();
    }
}

function deriveExtension(name) {
    if (!name || typeof name !== 'string') return '';
    const cleaned = name.split('?')[0].split('#')[0];
    const parts = cleaned.split('.');
    if (parts.length <= 1) return '';
    return parts.pop().trim().toLowerCase();
}

function isExtensionExcluded(ext) {
    return excludedExtensions.has((ext || '').toLowerCase());
}

window.isExtensionExcluded = isExtensionExcluded;

function isSupportedFileExtension(ext) {
    return SUPPORTED_FILE_EXTENSIONS.includes((ext || '').toLowerCase());
}

function getFileRelativePath(file) {
    if (!file) return '';
    return file.pbxRelativePath || file.webkitRelativePath || file.relativePath || file.fullPath || file.name || '';
}

function getFileDisplayName(file) {
    const rel = getFileRelativePath(file);
    if (!rel) return file && file.name ? file.name : '';
    const normalized = rel.replace(/\\/g, '/');
    const parts = normalized.split('/');
    return parts[parts.length - 1] || rel;
}

function annotateFileMetadata(file, providedPath) {
    if (!file) return;
    const relativePath = providedPath || file.webkitRelativePath || file.relativePath || file.fullPath || file.name || '';
    try {
        file.pbxRelativePath = relativePath;
        file.originalName = file.originalName || file.name;
    } catch (e) {
        // ignore readonly property assignment errors
    }
}

function buildFileIdentifier(file) {
    const rel = getFileRelativePath(file).toLowerCase();
    return `${rel}__${file && typeof file.size === 'number' ? file.size : '0'}`;
}

async function extractFilesFromZip(zipFile, options = {}) {
    if (typeof JSZip === 'undefined') {
        showNotification && showNotification('缺少 JSZip 依赖，无法解压 ZIP', 'error');
        return [];
    }
    try {
        const zip = await JSZip.loadAsync(zipFile);
        const entries = [];
        const zipFiles = Object.keys(zip.files);
        const pathPrefix = options.pathPrefix ? options.pathPrefix.replace(/\\/g, '/') : '';
        const stripRoot = options.stripRoot || false;

        for (const key of zipFiles) {
            const entry = zip.files[key];
            if (!entry || entry.dir) continue;
            const normalizedPath = key.replace(/\\/g, '/');

            if (pathPrefix) {
                if (!normalizedPath.startsWith(pathPrefix)) continue;
            }

            const ext = deriveExtension(normalizedPath);
            if (!isSupportedFileExtension(ext)) continue;

            const blob = await entry.async('blob');
            const baseNameParts = normalizedPath.split('/');
            let displayName = baseNameParts.pop();
            let relativePath = normalizedPath;

            if (pathPrefix) {
                relativePath = normalizedPath.substring(pathPrefix.length);
                if (relativePath.startsWith('/')) {
                    relativePath = relativePath.slice(1);
                }
            } else if (stripRoot && baseNameParts.length > 0) {
                // remove first segment (top-level directory)
                const segments = normalizedPath.split('/');
                segments.shift();
                relativePath = segments.join('/');
                displayName = segments.pop() || displayName;
            }

            if (!relativePath) {
                relativePath = displayName;
            }

            const derivedName = displayName || normalizedPath;
            const newFile = new File([blob], derivedName, {
                type: blob.type || 'application/octet-stream',
                lastModified: zipFile.lastModified || Date.now()
            });
            annotateFileMetadata(newFile, relativePath);
            try {
                newFile.virtualSource = 'zip';
                newFile.sourceArchive = zipFile.name;
            } catch (_) {}
            entries.push(newFile);
        }

        return entries;
    } catch (error) {
        console.error('解压 ZIP 文件失败:', error);
        showNotification && showNotification(`解压 "${zipFile && zipFile.name ? zipFile.name : 'ZIP'}" 失败: ${error.message || error}`, 'error');
        return [];
    }
}

async function extractFilesFromDataTransfer(dataTransfer) {
    if (!dataTransfer) return [];
    const itemsSnapshot = dataTransfer.items ? Array.from(dataTransfer.items) : [];
    const fallbackSnapshot = dataTransfer.files ? Array.from(dataTransfer.files) : [];
    const firstItem = itemsSnapshot.length > 0 ? itemsSnapshot[0] : null;
    const hasEntryApi = firstItem && typeof firstItem.webkitGetAsEntry === 'function';

    if (hasEntryApi) {
        const entryPromises = [];
        for (let i = 0; i < itemsSnapshot.length; i++) {
            const item = itemsSnapshot[i];
            if (!item || typeof item.webkitGetAsEntry !== 'function') continue;
            const entry = item.webkitGetAsEntry();
            if (!entry) continue; // In insecure contexts Chrome returns null – fall back later
            entryPromises.push(traverseFileSystemEntry(entry));
        }

        if (entryPromises.length > 0) {
            const results = await Promise.all(entryPromises);
            const flattened = results.flat().filter(Boolean);
            if (flattened.length > 0) {
                return flattened;
            }
            console.warn('extractFilesFromDataTransfer: FileSystemEntry API returned no files, using fallback.');
        }
    }

    fallbackSnapshot.forEach(file => annotateFileMetadata(file));
    return fallbackSnapshot;
}

function refreshFormatFilters() {
    const container = document.getElementById('fileFormatFilters');
    if (!container) return;
    const counts = new Map();
    pdfFiles.forEach(file => {
        const ext = deriveExtension(file.name || '') || '';
        counts.set(ext, (counts.get(ext) || 0) + 1);
    });
    // 清理不存在的扩展
    Array.from(excludedExtensions).forEach(ext => {
        if (!counts.has(ext)) {
            excludedExtensions.delete(ext);
        }
    });

    if (counts.size === 0) {
        container.innerHTML = '<span class="text-gray-500">暂无文件</span>';
        return;
    }

    const fragments = [];
    const entries = Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    entries.forEach(([ext, count]) => {
        const checked = !isExtensionExcluded(ext) ? 'checked' : '';
        const label = ext ? ext.toUpperCase() : '未知';
        fragments.push(`
            <label class="flex items-center space-x-1 bg-white border border-gray-200 rounded px-2 py-1 shadow-sm">
                <input type="checkbox" class="format-filter-checkbox" data-ext="${ext}" ${checked}>
                <span>${label} <span class="text-gray-400">(${count})</span></span>
            </label>
        `);
    });

    fragments.push('<div class="flex-grow"></div><button type="button" id="resetFormatFilters" class="text-xs text-blue-600">重置</button>');
    container.innerHTML = `<div class="flex flex-wrap gap-2 items-center">${fragments.join('')}</div>`;
}

function getActiveFiles() {
    return pdfFiles.filter(file => {
        const ext = deriveExtension(file.name || '');
        return !isExtensionExcluded(ext);
    });
}

window.getActiveFiles = getActiveFiles;

function updateBatchConfigCollapse() {
    const body = document.getElementById('batchModeConfigBody');
    const toggleLabel = document.getElementById('batchModeConfigToggleLabel');
    const toggleIcon = document.getElementById('batchModeConfigToggleIcon');
    if (!body || !toggleLabel || !toggleIcon) return;

    if (batchConfigCollapsed) {
        body.classList.add('hidden');
        toggleLabel.textContent = '展开设置';
        toggleIcon.setAttribute('icon', 'carbon:chevron-down');
    } else {
        body.classList.remove('hidden');
        toggleLabel.textContent = '收起设置';
        toggleIcon.setAttribute('icon', 'carbon:chevron-up');
    }
}

function handleFormatFilterChange(event) {
    const target = event.target;
    if (!target || !target.classList.contains('format-filter-checkbox')) return;
    const ext = target.getAttribute('data-ext');
    if (!ext) return;
    if (target.checked) {
        excludedExtensions.delete(ext);
    } else {
        excludedExtensions.add(ext);
    }
    updateFileListUI(pdfFiles, isProcessing, handleRemoveFile);
    refreshFormatFilters();
    updateProcessButtonState(pdfFiles, isProcessing);
    syncBatchModeControls(pdfFiles.length);
}

function handleFormatFilterClick(event) {
    const target = event.target;
    if (target && target.id === 'resetFormatFilters') {
        excludedExtensions.clear();
        updateFileListUI(pdfFiles, isProcessing, handleRemoveFile);
        refreshFormatFilters();
        updateProcessButtonState(pdfFiles, isProcessing);
        syncBatchModeControls(pdfFiles.length);
    }
}

function traverseFileSystemEntry(entry, path = '') {
    return new Promise((resolve) => {
        if (!entry) {
            resolve([]);
            return;
        }

        if (entry.isFile) {
            entry.file(file => {
                const relativePath = path ? `${path}/${file.name}` : file.name;
                annotateFileMetadata(file, relativePath);
                resolve([file]);
            }, () => resolve([]));
        } else if (entry.isDirectory) {
            const directoryReader = entry.createReader();
            const accumulated = [];

            const readEntries = () => {
                directoryReader.readEntries(async batch => {
                    if (!batch.length) {
                        const nestedResults = [];
                        for (const child of accumulated) {
                            const childPath = path ? `${path}/${child.name}` : child.name;
                            const childFiles = await traverseFileSystemEntry(child, childPath);
                            nestedResults.push(...childFiles);
                        }
                        resolve(nestedResults);
                    } else {
                        accumulated.push(...batch);
                        readEntries();
                    }
                }, () => resolve([]));
            };

            readEntries();
        } else {
            resolve([]);
        }
    });
}

async function handleGithubImport() {
    const rawUrl = prompt('请输入 GitHub 仓库或目录链接 (例如 https://github.com/user/repo 或 https://github.com/user/repo/tree/branch/path):');
    if (!rawUrl) return;

    const parsed = parseGithubUrl(rawUrl.trim());
    if (!parsed) {
        showNotification && showNotification('无法解析 GitHub 链接，请检查格式。', 'error');
        return;
    }

    const { owner, repo, ref, pathPrefix } = parsed;

    try {
        showNotification && showNotification('正在从 GitHub 获取文件列表，请稍候...', 'info');
        const treeEntries = await fetchGithubTree(owner, repo, ref, pathPrefix);
        if (!treeEntries.length) {
            showNotification && showNotification('在指定路径中未找到可处理的文件。', 'warning');
            return;
        }

        const files = await downloadGithubFiles(owner, repo, ref, treeEntries, pathPrefix);
        if (!files.length) {
            showNotification && showNotification('获取 GitHub 文件失败或没有可处理的文件。', 'warning');
            return;
        }

        await addFilesToList(files);
        showNotification && showNotification(`已从 ${owner}/${repo} 导入 ${files.length} 个文件`, 'success');
    } catch (error) {
        console.error('GitHub 导入失败:', error);
        showNotification && showNotification(`GitHub 导入失败：${error.message || error}`, 'error');
    }
}

function parseGithubUrl(rawUrl) {
    try {
        const url = new URL(rawUrl);
        if (!/github\.com$/i.test(url.hostname)) {
            return null;
        }
        const segments = url.pathname.split('/').filter(Boolean);
        if (segments.length < 2) {
            return null;
        }
        const owner = decodeURIComponent(segments[0]);
        const repo = decodeURIComponent(segments[1].replace(/\.git$/i, ''));
        let ref = 'main';
        let pathPrefix = '';

        if (segments[2] === 'tree' || segments[2] === 'blob') {
            if (segments.length >= 4) {
                ref = decodeURIComponent(segments[3]);
                if (segments.length > 4) {
                    pathPrefix = segments.slice(4).map(decodeURIComponent).join('/');
                }
            }
        }

        return { owner, repo, ref, pathPrefix };
    } catch (error) {
        console.warn('parseGithubUrl error:', error);
        return null;
    }
}

async function fetchGithubTree(owner, repo, ref, pathPrefix) {
    const encodedRef = encodeURIComponent(ref);
    const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodedRef}?recursive=1`;
    const response = await fetch(treeUrl, { headers: { 'Accept': 'application/vnd.github+json' } });
    if (response.status === 404) {
        throw new Error('未找到仓库或分支，请检查链接');
    }
    if (response.status === 403) {
        throw new Error('GitHub API 速率限制，请稍后再试');
    }
    if (!response.ok) {
        throw new Error(`GitHub API 返回错误状态 ${response.status}`);
    }
    const data = await response.json();
    if (!data || !Array.isArray(data.tree)) {
        throw new Error('GitHub API 返回数据不完整');
    }

    const prefix = pathPrefix ? pathPrefix.replace(/\\/g, '/').replace(/^\//, '').replace(/\/$/, '') : '';
    const matched = data.tree.filter(item => {
        if (!item || item.type !== 'blob') return false;
        if (!prefix) return true;
        if (!item.path) return false;
        return item.path === prefix || item.path.startsWith(prefix + '/');
    });

    return matched;
}

async function downloadGithubFiles(owner, repo, ref, treeEntries, pathPrefix) {
    const files = [];
    const prefix = pathPrefix ? pathPrefix.replace(/\\/g, '/').replace(/^\//, '').replace(/\/$/, '') : '';
    const repoIdentifier = `${owner}/${repo}@${ref}`;

    const queue = treeEntries.slice();
    const concurrency = 4;
    const workers = new Array(concurrency).fill(null).map(async () => {
        while (queue.length > 0) {
            const entry = queue.shift();
            if (!entry || !entry.path) continue;
            let relativePath = entry.path;
            if (prefix) {
                if (!entry.path.startsWith(prefix + '/')) {
                    continue;
                }
                relativePath = entry.path.slice(prefix.length + 1);
            }
            if (!relativePath || relativePath.endsWith('/')) continue;
            const ext = deriveExtension(relativePath);
            if (!isSupportedFileExtension(ext)) continue;

            const rawPathParts = entry.path.split('/').map(encodeURIComponent).join('/');
            const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${rawPathParts}`;
            try {
                const fileResponse = await fetch(rawUrl);
                if (!fileResponse.ok) {
                    console.warn(`无法获取 ${rawUrl}: ${fileResponse.status}`);
                    continue;
                }
                const blob = await fileResponse.blob();
                const displayName = relativePath.split('/').pop();
                const file = new File([blob], displayName || 'document', {
                    type: blob.type || 'application/octet-stream',
                    lastModified: Date.now()
                });
                const pathSegments = [repo];
                if (prefix) pathSegments.push(prefix);
                pathSegments.push(relativePath);
                const annotatedPath = pathSegments
                    .filter(Boolean)
                    .join('/')
                    .replace(/\/+/g, '/');
                annotateFileMetadata(file, annotatedPath);
                try {
                    file.virtualSource = 'github';
                    file.sourceArchive = repoIdentifier;
                } catch (_) {}
                files.push(file);
            } catch (error) {
                console.warn('下载 GitHub 文件失败:', error);
            }
        }
    });

    await Promise.all(workers);
    return files;
}

/**
 * 根据目标语言下拉菜单的选择，更新自定义语言输入框的可见性。
 * 如果选择了 "custom"，则显示自定义语言名称输入框，否则隐藏。
 */
function updateCustomLanguageInputVisibility() {
    const targetLangValue = document.getElementById('targetLanguage').value;
    const customInputContainer = document.getElementById('customTargetLanguageContainer');
    if (targetLangValue === 'custom') {
        customInputContainer.classList.remove('hidden');
    } else {
        customInputContainer.classList.add('hidden');
    }

    if (typeof window.updateDeeplxTargetLangHint === 'function') {
        window.updateDeeplxTargetLangHint();
    }
}

function updateDeeplxTargetLangHint() {
    const hintEl = document.getElementById('deeplxTargetLangHint');
    if (!hintEl) return;
    const modelSelect = document.getElementById('translationModel');
    const modelValue = modelSelect ? modelSelect.value : '';
    if (modelValue !== 'deeplx') {
        hintEl.textContent = '选择 DeepLX 后会显示对应的目标语言代码。';
        return;
    }

    const targetSelect = document.getElementById('targetLanguage');
    let langValue = targetSelect ? targetSelect.value : '';
    if (langValue === 'custom') {
        const customInput = document.getElementById('customTargetLanguageInput');
        if (customInput && customInput.value.trim()) {
            langValue = customInput.value.trim();
        } else {
            langValue = '';
        }
    }

    const mapper = (typeof window.mapToDeeplxLangCode === 'function') ? window.mapToDeeplxLangCode : null;
    const code = mapper ? mapper(langValue) : undefined;
    if (code) {
        const displayMap = (typeof window.DEEPLX_LANG_DISPLAY === 'object') ? window.DEEPLX_LANG_DISPLAY : null;
        const display = displayMap && displayMap[code];
        const zhName = display && display.zh ? display.zh : '';
        hintEl.textContent = zhName ? `当前目标语言代码：${code}（${zhName}）` : `当前目标语言代码：${code}`;
    } else {
        hintEl.textContent = '请在目标语言中选择 DeepL 支持的语言，或在自定义输入框中手动填写如 EN、DE 等代码。';
    }
}

window.updateDeeplxTargetLangHint = updateDeeplxTargetLangHint;

/**
 * 保存当前所有用户设置到 localStorage。
 * 从UI元素读取各项配置值，构建设置对象，然后调用 `saveSettings` (来自 storage.js)。
 */
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
        selectedCustomSourceSiteId: selectedSiteId,
        concurrencyLevel: document.getElementById('concurrencyLevel').value,
        translationConcurrencyLevel: document.getElementById('translationConcurrencyLevel').value,
        targetLanguage: targetLangValue,
        customTargetLanguageName: targetLangValue === 'custom' ? document.getElementById('customTargetLanguageInput').value : '',
        defaultSystemPrompt: document.getElementById('defaultSystemPrompt').value,
        defaultUserPromptTemplate: document.getElementById('defaultUserPromptTemplate').value,
        promptMode: document.querySelector('input[name="promptMode"]:checked')?.value || 'builtin',
        enableGlossary: document.getElementById('enableGlossaryToggle')?.checked || false,
        batchModeEnabled: batchModeEnabled,
        batchModeTemplate: batchModeTemplate,
        batchModeFormats: Array.from(new Set(batchModeFormats)),
        batchModeZipEnabled: batchModeZipEnabled
    };
    if (!settingsData.batchModeFormats.includes('original')) {
        settingsData.batchModeFormats.unshift('original');
    }
    // 调用 storage.js 中的保存函数
    saveSettings(settingsData);

    // 旧的自定义模型设置保存逻辑已移除，因为它们通过源站点配置进行管理和保存。
    // If a specific custom source site is selected, its details are already saved via key-manager-ui.js
    // and `loadAllCustomSourceSites()` in `handleProcessClick` will fetch them.
}

// =====================
// 核心处理流程启动
// =====================
/**
 * 处理点击"开始处理"按钮的事件，启动核心的文件处理流程。
 * 步骤包括：
 * 1. 加载最新设置。
 * 2. 根据是否需要OCR（PDF文件）和用户选择的翻译模型，初始化 `KeyProvider` 实例。
 * 3. 检查所需API Keys是否可用，若不可用则提示用户并中止。
 * 4. 检查是否有文件被选中。
 * 5. 设置处理状态变量，更新UI（如进度条、按钮状态）。
 * 6. 获取并发数、重试次数、目标语言等处理参数。
 * 7. 遍历文件列表，对于需要处理的文件（未跳过），将其加入处理队列。
 * 8. 启动异步处理队列 `processQueue`，该队列会并发地调用 `processSinglePdf` 处理每个文件。
 * 9. `processSinglePdf` 会处理单个文件的OCR、分块、翻译，并处理可能的Key失效和重试。
 * 10. 收集每个文件的处理结果（成功、失败、跳过）。
 * 11. 处理完成后，更新UI，保存已处理文件记录，并显示结果下载区域。
 * @async
 */
async function handleProcessClick() {
    if (isProcessing) return;

    // 1. 获取设置，包括选定的翻译模型
    const settings = loadSettings(); // 从存储加载最新设置
    // const selectedTranslationModelName = document.getElementById('translationModel').value; // 旧的直接读取方式
    const selectedTranslationModelName = settings.selectedTranslationModel;

    const requiresMistralKey = pdfFiles.some(file => file.name.toLowerCase().endsWith('.pdf'));
    const filesToProcess = getActiveFiles();

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
    /** @type {string|null}  用于 KeyProvider 的模型名 (例如 'gemini', 'custom_source_xxx') */
    let currentTranslationModelForProvider = null;
    /** @type {Object|null} 用于 processSinglePdf 的模型配置对象 (包含baseUrl, modelId等) */
    let translationModelConfigForProcess = null;

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
            translationModelConfigForProcess = siteConfig; // siteConfig 包含 apiBaseUrl, modelId 等
            addProgressLog(`使用自定义源站: ${siteConfig.displayName || selectedCustomSourceId}`);
        } else {
            // For preset models
            currentTranslationModelForProvider = selectedTranslationModelName;
            translationModelConfigForProcess = typeof loadModelConfig === 'function' ? loadModelConfig(selectedTranslationModelName) : {}; // 可能包含预设的baseUrl等
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

    if (filesToProcess.length === 0) {
        showNotification('请选择至少一个可处理的文件（检查格式筛选是否排除全部文件）', 'error');
        return;
    }

    // 4. 设置处理状态等...
    isProcessing = true;
    if (typeof window !== 'undefined' && window.promptPoolUI && typeof window.promptPoolUI.resetSessionLock === 'function') {
        window.promptPoolUI.resetSessionLock();
    }
    activeProcessingCount = 0;
    retryAttempts.clear();
    allResults = new Array(filesToProcess.length);
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

    if (batchModeEnabled && pdfFiles.length >= 2) {
        const uniqueFormats = Array.from(new Set(batchModeFormats && batchModeFormats.length > 0 ? batchModeFormats : ['markdown']));
        activeBatchSession = {
            id: `batch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            total: pdfFiles.length,
            template: batchModeTemplate && batchModeTemplate.trim() ? batchModeTemplate.trim() : DEFAULT_BATCH_TEMPLATE,
            formats: uniqueFormats,
            outputLanguage: effectiveTargetLanguage,
            startedAt: new Date().toISOString(),
            counter: 0,
            zipOutput: batchModeZipEnabled
        };
    } else {
        activeBatchSession = null;
    }

    translationSemaphore.limit = translationConcurrencyLevel;
    translationSemaphore.count = 0;
    translationSemaphore.queue = [];

    addProgressLog(`文件并发: ${concurrencyLevel}, 翻译并发: ${translationConcurrencyLevel}, 最大重试: ${MAX_RETRIES}, 跳过已处理: ${skipEnabled}`);
    updateConcurrentProgress(0);

    let successCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    const pendingIndices = new Set();

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

    /**
     * 异步处理队列，负责调度单个文件的处理。
     * 它会根据设定的并发数 (`concurrencyLevel`) 来启动 `processSinglePdf` 任务。
     * 内部维护一个待处理文件索引集合 `pendingIndices` 和当前活动处理数 `activeProcessingCount`。
     * @async
     */
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

                let batchContextForFile = null;
                if (activeBatchSession) {
                    activeBatchSession.counter += 1;
                    batchContextForFile = {
                        id: activeBatchSession.id,
                        total: activeBatchSession.total,
                        template: activeBatchSession.template,
                        formats: activeBatchSession.formats,
                        outputLanguage: activeBatchSession.outputLanguage,
                        startedAt: activeBatchSession.startedAt,
                        order: currentFileIndex + 1,
                        originalIndex: currentFileIndex,
                        attempt: activeBatchSession.counter
                    };
                }

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
                    batchContextForFile,
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

                            // 单文件模式：更新 window.data
                            if (filesToProcess.length === 1 && result.markdown !== undefined) {
                                window.data = {
                                    name: currentFile.name,
                                    ocr: result.markdown || '',
                                    translation: result.translation || '',
                                    images: result.images || [],
                                    summaries: {}
                                };
                            }

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

        activeBatchSession = null;
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
/**
 * 处理点击"下载全部结果"按钮的事件。
 * 如果 `allResults` 数组中有内容，则调用 `downloadAllResults` (来自 ui.js) 来打包并下载结果。
 */
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
/**
 * 根据指定的目标语言名称，获取内置的翻译系统提示和用户提示模板。
 * @param {string} languageName - 目标语言的名称 (例如 'chinese', 'english', 'japanese', 或自定义语言名)。
 * @returns {{systemPrompt: string, userPromptTemplate: string}} 包含系统提示和用户提示模板的对象。
 */
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
// updatePromptTextareasContent函数已移除，因为新的提示词系统通过promptPoolUI处理

// =====================
// 其他协调逻辑
// =====================
// ...（如有其他 app.js 级别的协调逻辑，可在此补充）...

/**
 * 更新本地存储中指定模型最后成功使用的Key ID。
 * @param {string} modelName - 模型名称 (例如 'mistral', 'gemini', 或 'custom_source_xxx')。
 * @param {string} keyId - 成功使用的 API Key 的 ID。
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
 * 获取本地存储中指定模型最后成功使用的Key ID。
 * @param {string} modelName - 模型名称。
 * @returns {string | null} 存储的 Key ID，如果未找到则返回 null。
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
