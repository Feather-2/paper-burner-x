// js/ui.js

// =====================
// UI 相关操作与交互函数
// =====================

// ---------------------
// DOM 元素获取（集中管理，便于维护）
// ---------------------
/** @type {HTMLTextAreaElement | null} mistralApiKeysTextarea - Mistral API 密钥输入框。 */
const mistralApiKeysTextarea = document.getElementById('mistralApiKeys');
/** @type {HTMLInputElement | null} rememberMistralKeyCheckbox - "记住 Mistral 密钥"复选框。 */
const rememberMistralKeyCheckbox = document.getElementById('rememberMistralKey');
/** @type {HTMLTextAreaElement | null} translationApiKeysTextarea - (通用)翻译服务 API 密钥输入框。 */
const translationApiKeysTextarea = document.getElementById('translationApiKeys');
/** @type {HTMLInputElement | null} rememberTranslationKeyCheckbox - "记住翻译密钥"复选框。 */
const rememberTranslationKeyCheckbox = document.getElementById('rememberTranslationKey');
/** @type {HTMLSelectElement | null} translationModelSelect - 翻译模型选择下拉框。 */
const translationModelSelect = document.getElementById('translationModel');
/** @type {HTMLElement | null} customModelSettingsContainer - (旧版)自定义模型设置区域的容器。 */
const customModelSettingsContainer = document.getElementById('customModelSettingsContainer');
/** @type {HTMLElement | null} customModelSettings - (旧版)自定义模型具体设置的容器。 */
const customModelSettings = document.getElementById('customModelSettings');
/** @type {HTMLElement | null} advancedSettingsToggle - 高级设置区域的切换按钮。 */
const advancedSettingsToggle = document.getElementById('advancedSettingsToggle');
/** @type {HTMLElement | null} advancedSettings - 高级设置区域的容器。 */
const advancedSettings = document.getElementById('advancedSettings');
/** @type {HTMLElement | null} advancedSettingsIcon - 高级设置切换按钮中的图标。 */
const advancedSettingsIcon = document.getElementById('advancedSettingsIcon');
/** @type {HTMLInputElement | null} maxTokensPerChunk - 每个文本块最大 Token 数的滑块输入。 */
const maxTokensPerChunk = document.getElementById('maxTokensPerChunk');
/** @type {HTMLElement | null} maxTokensPerChunkValue - 显示当前最大 Token 数的元素。 */
const maxTokensPerChunkValue = document.getElementById('maxTokensPerChunkValue');
/** @type {HTMLInputElement | null} skipProcessedFilesCheckbox - "跳过已处理文件"复选框。 */
const skipProcessedFilesCheckbox = document.getElementById('skipProcessedFiles');
/** @type {HTMLInputElement | null} concurrencyLevelInput - (OCR/通用)并发级别输入框。 */
const concurrencyLevelInput = document.getElementById('concurrencyLevel');
/** @type {HTMLElement | null} dropZone - 文件拖放区域。 */
const dropZone = document.getElementById('dropZone');
/** @type {HTMLInputElement | null} pdfFileInput - 文件选择输入框 (type="file")。 */
const pdfFileInput = document.getElementById('pdfFileInput');
/** @type {HTMLButtonElement | null} browseFilesBtn - "浏览文件"按钮。 */
const browseFilesBtn = document.getElementById('browseFilesBtn');
/** @type {HTMLElement | null} fileListContainer - 文件列表的容器。 */
const fileListContainer = document.getElementById('fileListContainer');
/** @type {HTMLElement | null} fileList - 文件列表的 UL 或 OL 元素。 */
const fileList = document.getElementById('fileList');
/** @type {HTMLButtonElement | null} clearFilesBtn - "清空文件列表"按钮。 */
const clearFilesBtn = document.getElementById('clearFilesBtn');
/** @type {HTMLSelectElement | null} targetLanguage - 目标语言选择下拉框。 */
const targetLanguage = document.getElementById('targetLanguage');
/** @type {HTMLButtonElement | null} processBtn - "开始处理"按钮。 */
const processBtn = document.getElementById('processBtn');
/** @type {HTMLButtonElement | null} downloadAllBtn - "全部下载"按钮。 */
const downloadAllBtn = document.getElementById('downloadAllBtn');
/** @type {HTMLElement | null} batchModeToggleWrapper - 批量模式开关容器。 */
const batchModeToggleWrapper = document.getElementById('batchModeToggleWrapper');
/** @type {HTMLInputElement | null} batchModeToggle - 批量模式开关。 */
const batchModeToggle = document.getElementById('batchModeToggle');
/** @type {HTMLElement | null} batchModeConfigPanel - 批量模式配置面板。 */
const batchModeConfigPanel = document.getElementById('batchModeConfig');
/** @type {HTMLElement | null} resultsSection - 处理结果显示区域。 */
const resultsSection = document.getElementById('resultsSection');
/** @type {HTMLElement | null} resultsSummary - 处理结果总结信息的容器。 */
const resultsSummary = document.getElementById('resultsSummary');
/** @type {HTMLElement | null} progressSection - 进度显示区域。 */
const progressSection = document.getElementById('progressSection');
/** @type {HTMLElement | null} batchProgressText - 批处理整体进度文本显示元素。 */
const batchProgressText = document.getElementById('batchProgressText');
/** @type {HTMLElement | null} concurrentProgressText - 当前并发任务数文本显示元素。 */
const concurrentProgressText = document.getElementById('concurrentProgressText');
/** @type {HTMLElement | null} progressStep - 当前处理步骤文本显示元素。 */
const progressStep = document.getElementById('progressStep');
/** @type {HTMLElement | null} progressPercentage - 进度百分比文本显示元素。 */
const progressPercentage = document.getElementById('progressPercentage');
/** @type {HTMLElement | null} progressBar - 进度条的内部填充元素。 */
const progressBar = document.getElementById('progressBar');
/** @type {HTMLElement | null} progressLog - 详细进度日志的容器。 */
const progressLog = document.getElementById('progressLog');
/** @type {HTMLElement | null} notificationContainer - 通知消息的容器。 */
const notificationContainer = document.getElementById('notification-container');
/** @type {HTMLElement | null} customModelSettingsToggle - (旧版)自定义模型设置的切换按钮。 */
const customModelSettingsToggle = document.getElementById('customModelSettingsToggle');
/** @type {HTMLElement | null} customModelSettingsToggleIcon - (旧版)自定义模型设置切换按钮中的图标。 */
const customModelSettingsToggleIcon = document.getElementById('customModelSettingsToggleIcon');
/** @type {HTMLElement | null} customSourceSiteContainer - 自定义API源站点选择区域的容器。 */
const customSourceSiteContainer = document.getElementById('customSourceSiteContainer');
/** @type {HTMLSelectElement | null} customSourceSiteSelect - 自定义API源站点选择下拉框。 */
const customSourceSiteSelect = document.getElementById('customSourceSiteSelect');
/** @type {HTMLElement | null} customSourceSiteToggleIcon - 自定义源站点设置区域切换按钮的图标 (可能与高级设置共用或独立)。 */
const customSourceSiteToggleIcon = document.getElementById('customSourceSiteToggleIcon'); // 注意：此ID可能与 advancedSettingsIcon 描述冲突，需确认实际HTML结构
/** @type {HTMLButtonElement | null} detectModelsBtn - "检测可用模型"按钮，通常用于自定义源站点。 */
const detectModelsBtn = document.getElementById('detectModelsBtn');

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
        { key: 'mistral', name: 'Mistral OCR', group: 'ocr' },
        { key: 'deepseek', name: 'DeepSeek 翻译', group: 'translation' },
        { key: 'gemini', name: 'Gemini 翻译', group: 'translation' },
        { key: 'tongyi', name: '通义百炼', group: 'translation' },
        { key: 'volcano', name: '火山引擎', group: 'translation' },
        { key: 'deeplx', name: 'DeepLX (DeepL 接口)', group: 'translation' },
        { key: 'custom', name: '自定义翻译模型', group: 'translation' }
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

        const modelHasValidKey = {};
        const hasUsableKey = (keys = []) => keys.some(k => k && k.value && k.value.trim() && k.status !== 'invalid');

        supportedModelsForKeyManager.forEach(model => {
            if (typeof loadModelKeys !== 'function') {
                modelHasValidKey[model.key] = false;
                return;
            }

            if (model.key === 'custom') {
                let anyCustomKey = false;
                const sites = typeof loadAllCustomSourceSites === 'function' ? loadAllCustomSourceSites() : {};
                Object.keys(sites || {}).forEach(siteId => {
                    const siteKeys = loadModelKeys(`custom_source_${siteId}`) || [];
                    if (hasUsableKey(siteKeys)) anyCustomKey = true;
                });
                modelHasValidKey[model.key] = anyCustomKey;
            } else {
                const keys = loadModelKeys(model.key) || [];
                modelHasValidKey[model.key] = hasUsableKey(keys);
            }
        });

        const hasMistralKey = !!modelHasValidKey['mistral'];
        const translationHasKey = supportedModelsForKeyManager
            .filter(m => m.group === 'translation')
            .some(m => modelHasValidKey[m.key]);

        const headerSection = document.createElement('div');
        headerSection.className = 'mb-3 space-y-1';

        const importExportRow = document.createElement('div');
        importExportRow.className = 'flex items-center gap-2 px-1';

        const exportIconBtn = document.createElement('button');
        exportIconBtn.type = 'button';
        exportIconBtn.innerHTML = '<iconify-icon icon="carbon:export" width="16"></iconify-icon><span class="ml-1">导出全部</span>';
        exportIconBtn.className = 'px-2 py-1 text-xs rounded-md border border-slate-200 hover:border-blue-300 text-slate-600 transition-colors flex items-center';
        exportIconBtn.addEventListener('click', () => {
            KeyManagerUI.exportAllModelData();
        });

        const importIconBtn = document.createElement('button');
        importIconBtn.type = 'button';
        importIconBtn.innerHTML = '<iconify-icon icon="carbon:import-export" width="16"></iconify-icon><span class="ml-1">导入全部</span>';
        importIconBtn.className = 'px-2 py-1 text-xs rounded-md border border-slate-200 hover:border-blue-300 text-slate-600 transition-colors flex items-center';
        importIconBtn.addEventListener('click', () => {
            KeyManagerUI.importAllModelData(() => {
                if (typeof renderModelList === 'function') renderModelList();
                if (typeof keyManagerColumn !== 'undefined' && typeof selectedModelForManager !== 'undefined') {
                    renderKeyManagerForModel(selectedModelForManager);
                }
            });
        });

        importExportRow.appendChild(exportIconBtn);
        importExportRow.appendChild(importIconBtn);
        headerSection.appendChild(importExportRow);

        const importExportHint = document.createElement('div');
        importExportHint.className = 'text-[11px] text-slate-500 px-1';
        importExportHint.textContent = '配置文件为 Paper Burner X 专用 JSON。';
        headerSection.appendChild(importExportHint);
        modelListColumn.appendChild(headerSection);

        const divider = document.createElement('div');
        divider.className = 'border-t border-dashed border-slate-200 my-3';
        modelListColumn.appendChild(divider);

        if (!hasMistralKey) {
            const ocrWarning = document.createElement('div');
            ocrWarning.className = 'mb-3 text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded px-3 py-2 flex items-start gap-2';
            ocrWarning.innerHTML = '<iconify-icon icon="carbon:warning" width="14"></iconify-icon><span>当前未提供 OCR Key，无法进行 PDF 的 OCR 操作。</span>';
            modelListColumn.appendChild(ocrWarning);
        }

        if (!translationHasKey) {
            const translationWarning = document.createElement('div');
            translationWarning.className = 'mb-3 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-2 flex items-start gap-2';
            translationWarning.innerHTML = '<iconify-icon icon="carbon:warning" width="14"></iconify-icon><span>当前无有效翻译 Key，无法进行翻译操作。</span>';
            modelListColumn.appendChild(translationWarning);
        }

        const sections = [
            { title: '所有 OCR 方式', group: 'ocr', className: 'mt-4 mb-2' },
            { title: '翻译和分析 API', group: 'translation', className: 'mt-5 mb-2' }
        ];

        sections.forEach((section, idx) => {
            const header = document.createElement('div');
            header.className = `text-xs font-semibold text-slate-500 uppercase tracking-wide px-1 ${section.className || ''}`;
            header.textContent = section.title;
            modelListColumn.appendChild(header);

            supportedModelsForKeyManager
                .filter(model => model.group === section.group)
                .forEach(model => {
                    const button = document.createElement('button');
                    button.dataset.modelKey = model.key;
                    button.className = 'w-full text-left px-3 py-2 text-sm rounded-md transition-colors ';
                    const indicator = modelHasValidKey[model.key]
                        ? '<span class="inline-block w-1.5 h-1.5 mr-2 rounded-full bg-emerald-500"></span>'
                        : '<span class="inline-block w-1.5 h-1.5 mr-2 rounded-full bg-slate-300"></span>';
                    button.innerHTML = indicator + model.name;
                    if (model.key === selectedModelForManager) {
                        button.classList.add('bg-blue-100', 'text-blue-700', 'font-semibold');
                    } else {
                        button.classList.add('hover:bg-gray-200', 'text-gray-700');
                    }
                    button.addEventListener('click', () => selectModelForManager(model.key));
                    modelListColumn.appendChild(button);
                });

            if (idx !== sections.length - 1) {
                const sectionDivider = document.createElement('div');
                sectionDivider.className = 'border-t border-dashed border-slate-200 my-3';
                modelListColumn.appendChild(sectionDivider);
            }
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
        form.appendChild(createConfigInput(`sourceApiBaseUrl_${siteIdForForm}`, 'API Base URL *', isEditing ? siteData.apiBaseUrl : '', 'url', '例如: https://api.openai.com', () => {}));

        const endpointModeOptions = [
            { value: 'auto', text: '自动补全（必要时追加 /v1/...）' },
            { value: 'chat', text: '仅追加 /chat/completions' },
            { value: 'manual', text: '已是完整端点（不追加）' }
        ];
        const endpointModeField = createConfigSelect(
            `sourceEndpointMode_${siteIdForForm}`,
            '端点补全方式',
            isEditing ? (siteData.endpointMode || 'auto') : 'auto',
            endpointModeOptions,
            () => {}
        );
        const endpointModeHint = document.createElement('p');
        endpointModeHint.className = 'mt-1 text-[11px] text-gray-500 leading-4';
        endpointModeHint.textContent = '若第三方已提供完整的 /chat/completions 或 /messages 地址，请选择“已是完整端点”。';
        endpointModeField.appendChild(endpointModeHint);
        form.appendChild(endpointModeField);

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
        modelIdInputContainer.className = 'flex flex-col sm:flex-row sm:items-center sm:space-x-2 space-y-2 sm:space-y-0';

        let modelIdEditableElement = document.createElement('input');
        modelIdEditableElement.type = 'text';
        modelIdEditableElement.id = `sourceModelId_${siteIdForForm}`;
        modelIdEditableElement.name = `sourceModelId_${siteIdForForm}`;
        modelIdEditableElement.value = isEditing ? siteData.modelId : '';
        modelIdEditableElement.placeholder = '例如: gpt-4-turbo';
        modelIdEditableElement.className = 'w-full sm:flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors';
        modelIdInputContainer.appendChild(modelIdEditableElement);

        const detectModelsButton = document.createElement('button');
        detectModelsButton.type = 'button';
        detectModelsButton.innerHTML = '<iconify-icon icon="carbon:search-locate" class="mr-1"></iconify-icon>检测';
        detectModelsButton.title = '从此 Base URL 检测可用模型';
        detectModelsButton.className = 'px-3 py-1.5 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded transition-colors flex items-center justify-center w-full sm:w-auto';
        modelIdInputContainer.appendChild(detectModelsButton);

        const searchModelsButton = document.createElement('button');
        searchModelsButton.type = 'button';
        searchModelsButton.id = `sourceModelSearchBtn_${siteIdForForm}`;
        searchModelsButton.innerHTML = '<iconify-icon icon="carbon:search" class="mr-1"></iconify-icon>搜索模型';
        searchModelsButton.className = 'px-3 py-1.5 text-xs border border-gray-300 rounded text-gray-600 hover:text-blue-600 hover:border-blue-400 transition-colors flex-shrink-0 flex items-center disabled:opacity-60 disabled:cursor-not-allowed';
        searchModelsButton.disabled = true;
        modelIdInputContainer.appendChild(searchModelsButton);
        modelIdGroup.appendChild(modelIdInputContainer);

        // Temporary API Key for detection
        const tempApiKeyInput = createConfigInput(`sourceTempApiKey_${siteIdForForm}`, 'API Key (检测时使用，可留空)', '', 'password', '如需临时检测可填写 Key', null, {autocomplete: 'new-password'});
        tempApiKeyInput.classList.add('text-xs'); // Smaller label
        tempApiKeyInput.querySelector('label').classList.add('text-gray-500');
        tempApiKeyInput.querySelector('input').classList.add('text-xs', 'py-1');
        const tempHint = document.createElement('p');
        tempHint.className = 'mt-1 text-[11px] text-slate-400';
        tempHint.textContent = '如已在下方“API Key”列表中添加 Key，可留空自动使用。';
        tempApiKeyInput.appendChild(tempHint);
        modelIdGroup.appendChild(tempApiKeyInput); // Add it below the model ID input group

        form.appendChild(modelIdGroup);
        // Event listener for detectModelsButton
        detectModelsButton.addEventListener('click', async () => {
            const baseUrl = document.getElementById(`sourceApiBaseUrl_${siteIdForForm}`).value.trim();
            let tempApiKey = document.getElementById(`sourceTempApiKey_${siteIdForForm}`).value.trim();
            let usedStoredKey = false;

            if (!baseUrl) {
                showNotification('请输入 API Base URL 以检测模型。', 'warning');
                return;
            }
            if (!tempApiKey && typeof loadModelKeys === 'function') {
                const storedKeys = (loadModelKeys(`custom_source_${siteIdForForm}`) || [])
                    .filter(k => k && k.value && k.value.trim() && k.status !== 'invalid');
                if (storedKeys.length > 0) {
                    tempApiKey = storedKeys[0].value.trim();
                    usedStoredKey = true;
                }
            }
            if (!tempApiKey) {
                showNotification('未找到可用的 API Key，请在下方添加或临时输入再检测。', 'warning');
                return;
            }

            detectModelsButton.disabled = true;
            detectModelsButton.innerHTML = '<iconify-icon icon="carbon:circle-dash" class="animate-spin mr-1"></iconify-icon>检测中...';

            const endpointModeSelect = document.getElementById(`sourceEndpointMode_${siteIdForForm}`);
            const requestFormatSelect = document.getElementById(`sourceRequestFormat_${siteIdForForm}`);
            const endpointModeValue = endpointModeSelect ? endpointModeSelect.value : 'auto';
            const requestFormatValue = requestFormatSelect ? requestFormatSelect.value : 'openai';

            try {
                const detectedModels = await window.modelDetector.detectModelsForModal(baseUrl, tempApiKey, requestFormatValue, endpointModeValue);
                if (usedStoredKey) {
                    showNotification && showNotification('已使用已保存的 Key 进行模型检测。', 'info');
                }
                showNotification(`检测到 ${detectedModels.length} 个模型。`, 'success');

                const cacheKey = `custom_source_${siteIdForForm}`;
                if (!detectedModels || detectedModels.length === 0) {
                    setModelSearchCache(cacheKey, []);
                    searchModelsButton.disabled = true;
                    if (typeof showNotification === 'function') {
                        showNotification('未返回模型列表，请检查 Base URL 或 API Key。', 'info');
                    }
                    return;
                }

                const currentModelIdValue = document.getElementById(`sourceModelId_${siteIdForForm}`).value;
                const newSelect = document.createElement('select');
                newSelect.id = `sourceModelId_${siteIdForForm}`; // Keep the same ID for form submission
                newSelect.name = `sourceModelId_${siteIdForForm}`;
                newSelect.className = 'w-full sm:flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors';

                // Option for manual input
                const manualOption = document.createElement('option');
                manualOption.value = "__manual_input__"; // Special value
                manualOption.textContent = "-- 手动输入其他模型 --";
                newSelect.appendChild(manualOption);

                const normalized = [];
                detectedModels.forEach(model => {
                    const option = document.createElement('option');
                    option.value = model.id;
                    option.textContent = model.name || model.id;
                    newSelect.appendChild(option);
                    normalized.push({
                        value: model.id,
                        label: model.name || model.id,
                        description: model.rawName || ''
                    });
                });

                // Replace the input with the select
                const inputContainer = document.getElementById(`sourceModelIdInputContainer_${siteIdForForm}`);
                const oldInput = document.getElementById(`sourceModelId_${siteIdForForm}`);
                inputContainer.insertBefore(newSelect, oldInput); // Insert select before old input
                if(oldInput) oldInput.remove(); // Remove the old text input
                modelIdEditableElement = newSelect; // Update reference

                setModelSearchCache(cacheKey, normalized);
                registerModelSearchIntegration({
                    key: cacheKey,
                    selectEl: newSelect,
                    buttonEl: searchModelsButton,
                    title: `选择模型（${document.getElementById(`sourceDisplayName_${siteIdForForm}`).value || '自定义源'}）`,
                    placeholder: '搜索模型 ID...',
                    emptyMessage: '未找到匹配的模型',
                    onEmpty: () => {
                        if (!detectModelsButton.disabled) detectModelsButton.click();
                        return true;
                    }
                });
                searchModelsButton.disabled = false;

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
                setModelSearchCache(`custom_source_${siteIdForForm}`, []);
                searchModelsButton.disabled = true;
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
                availableModels: isEditing && siteData.availableModels ? siteData.availableModels : [],
                endpointMode: document.getElementById(`sourceEndpointMode_${siteIdForForm}`).value
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

        // 追加：对于 Gemini 提供“检测可用模型并设为默认”的小面板
        if (modelKeyOrSourceSiteModelName === 'gemini') {
            const panel = document.createElement('div');
            panel.className = 'mt-4 p-3 border rounded-md bg-blue-50';
            panel.innerHTML = `
                <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div class="text-sm text-blue-800 font-medium">Gemini 可用模型检测</div>
                    <button id="detectGeminiModelsBtn" class="px-2 py-1 text-xs border rounded hover:bg-white w-full sm:w-auto">检测</button>
                </div>
                <div id="geminiModelsArea" class="mt-2 text-sm text-gray-700 space-y-2">
                    <span class="text-gray-500">点击“检测”从 Google API 拉取模型列表</span>
                </div>
            `;
            keyManagerColumn.appendChild(panel);

            const detectBtn = panel.querySelector('#detectGeminiModelsBtn');
            const area = panel.querySelector('#geminiModelsArea');
            let searchBtn;
            detectBtn.onclick = async () => {
                const keys = (loadModelKeys('gemini') || []).filter(k => k.status !== 'invalid' && k.value);
                if (keys.length === 0) { area.innerHTML = '<span class="text-red-600">无可用 Gemini API Key</span>'; return; }
                const apiKey = keys[0].value.trim();
                detectBtn.disabled = true; detectBtn.textContent = '检测中...';
                let searchBtn;
                try {
                    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
                    if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
                    const data = await resp.json();
                    const items = Array.isArray(data.models || data.data) ? (data.models || data.data) : [];
                    if (items.length === 0) { area.innerHTML = '<span class="text-gray-500">未返回模型列表</span>'; return; }
                    const select = document.createElement('select');
                    select.className = 'mt-2 w-full sm:flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors';
                    const normalized = [];
                    items.forEach(m => {
                        const id = m.name ? String(m.name).split('/').pop() : (m.id || '');
                        if (!id || normalized.some(n => n.value === id)) return;
                        const opt = document.createElement('option');
                        opt.value = id; opt.textContent = id;
                        select.appendChild(opt);
                        const display = m.displayName || m.description || '';
                        normalized.push({ value: id, label: id, description: display });
                    });
                    const cacheKey = 'gemini_key_manager_detect_list';
                    setModelSearchCache(cacheKey, normalized);
                    searchBtn = document.createElement('button');
                    searchBtn.className = 'mt-2 px-3 py-1.5 text-xs border border-gray-300 rounded text-gray-600 hover:text-blue-600 hover:border-blue-400 transition-colors flex items-center justify-center w-full sm:w-auto';
                    searchBtn.innerHTML = '<iconify-icon icon="carbon:search" class="mr-1" width="14"></iconify-icon>搜索模型';
                    registerModelSearchIntegration({
                        key: cacheKey,
                        selectEl: select,
                        buttonEl: searchBtn,
                        title: '选择 Gemini 模型',
                        placeholder: '搜索模型 ID 或名称...',
                        emptyMessage: '未找到匹配的模型',
                        onEmpty: () => {
                            detectBtn.click();
                            return true;
                        },
                        onSelect: (value) => {
                            if (select.value !== value) {
                                select.value = value;
                                select.dispatchEvent(new Event('change', { bubbles: true }));
                            }
                        }
                    });
                    searchBtn.disabled = normalized.length === 0;

                    const saveBtn = document.createElement('button');
                    saveBtn.className = 'mt-2 px-3 py-1.5 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded w-full sm:w-auto';
                    saveBtn.textContent = '设为默认模型';
                    saveBtn.onclick = () => {
                        saveModelConfig('gemini', { preferredModelId: select.value });
                        if (typeof showNotification === 'function') showNotification(`Gemini 默认模型已设为 ${select.value}`, 'success');
                    };
                    area.innerHTML = '';
                    const controls = document.createElement('div');
                    controls.className = 'mt-2 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center gap-2';
                    controls.appendChild(select);
                    controls.appendChild(searchBtn);
                    controls.appendChild(saveBtn);
                    area.appendChild(controls);
                } catch (e) {
                    console.error(e);
                    area.innerHTML = `<span class="text-red-600">检测失败: ${e.message}</span>`;
                    setModelSearchCache('gemini_key_manager_detect_list', []);
                    if (searchBtn) searchBtn.disabled = true;
                } finally {
                    detectBtn.disabled = false; detectBtn.textContent = '检测';
                }
            };
        }        // 追加：DeepSeek 检测面板
        if (modelKeyOrSourceSiteModelName === 'deepseek') {
            const panel = document.createElement('div');
            panel.className = 'mt-4 p-3 border rounded-md bg-blue-50';
            panel.innerHTML = `
                <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div class="text-sm text-blue-800 font-medium">DeepSeek 可用模型检测</div>
                    <button id="detectDeepseekModelsBtn" class="px-2 py-1 text-xs border rounded hover:bg-white w-full sm:w-auto">检测</button>
                </div>
                <div id="deepseekModelsArea" class="mt-2 text-sm text-gray-700 space-y-2">
                    <span class="text-gray-500">点击“检测”从 DeepSeek API 拉取模型列表</span>
                </div>
            `;
            keyManagerColumn.appendChild(panel);

            const detectBtn = panel.querySelector('#detectDeepseekModelsBtn');
            const area = panel.querySelector('#deepseekModelsArea');

            detectBtn.onclick = async () => {
                const keys = (loadModelKeys('deepseek') || []).filter(k => k.status !== 'invalid' && k.value);
                if (keys.length === 0) {
                    area.innerHTML = '<span class="text-red-600">无可用 DeepSeek API Key</span>';
                    return;
                }

                const apiKey = keys[0].value.trim();
                detectBtn.disabled = true;
                detectBtn.textContent = '检测中...';

                let searchBtn;

                try {
                    const resp = await fetch('https://api.deepseek.com/v1/models', {
                        headers: { 'Authorization': `Bearer ${apiKey}` }
                    });
                    if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);

                    const data = await resp.json();
                    const items = Array.isArray(data.data) ? data.data : [];

                    if (items.length === 0) {
                        area.innerHTML = '<span class="text-gray-500">未返回模型列表</span>';
                        setModelSearchCache('deepseek_key_manager_detect_list', []);
                        return;
                    }

                    const select = document.createElement('select');
                    select.className = 'mt-2 w-full sm:flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors';

                    const normalized = [];
                    items.forEach(m => {
                        const id = m.id;
                        if (!id || normalized.some(n => n.value === id)) return;
                        const opt = document.createElement('option');
                        opt.value = id;
                        opt.textContent = id;
                        select.appendChild(opt);
                        normalized.push({ value: id, label: id, description: '' });
                    });

                    const cacheKey = 'deepseek_key_manager_detect_list';
                    setModelSearchCache(cacheKey, normalized);

                    searchBtn = document.createElement('button');
                    searchBtn.className = 'mt-2 px-3 py-1.5 text-xs border border-gray-300 rounded text-gray-600 hover:text-blue-600 hover:border-blue-400 transition-colors flex items-center justify-center w-full sm:w-auto';
                    searchBtn.innerHTML = '<iconify-icon icon="carbon:search" class="mr-1" width="14"></iconify-icon>搜索模型';

                    registerModelSearchIntegration({
                        key: cacheKey,
                        selectEl: select,
                        buttonEl: searchBtn,
                        title: '选择 DeepSeek 模型',
                        placeholder: '搜索模型 ID...',
                        emptyMessage: '未找到匹配的模型',
                        onEmpty: () => { detectBtn.click(); return true; },
                        onSelect: value => {
                            if (select.value !== value) {
                                select.value = value;
                                select.dispatchEvent(new Event('change', { bubbles: true }));
                            }
                        }
                    });
                    searchBtn.disabled = normalized.length === 0;

                    const saveBtn = document.createElement('button');
                    saveBtn.className = 'mt-2 px-3 py-1.5 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded w-full sm:w-auto';
                    saveBtn.textContent = '设为默认模型';
                    saveBtn.onclick = () => {
                        saveModelConfig('deepseek', { preferredModelId: select.value });
                        showNotification && showNotification(`DeepSeek 默认模型已设为 ${select.value}`, 'success');
                    };

                    area.innerHTML = '';
                    const controls = document.createElement('div');
                    controls.className = 'mt-2 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center gap-2';
                    controls.appendChild(select);
                    controls.appendChild(searchBtn);
                    controls.appendChild(saveBtn);
                    area.appendChild(controls);
                } catch (error) {
                    console.error(error);
                    area.innerHTML = `<span class="text-red-600">检测失败: ${error.message}</span>`;
                    setModelSearchCache('deepseek_key_manager_detect_list', []);
                    if (searchBtn) searchBtn.disabled = true;
                } finally {
                    detectBtn.disabled = false;
                    detectBtn.textContent = '检测';
                }
            };
        }

        if (modelKeyOrSourceSiteModelName === 'tongyi') {
        const panel = document.createElement('div');
        panel.className = 'mt-4 p-3 border rounded-md bg-blue-50';
        panel.innerHTML = `
            <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div class="text-sm text-blue-800 font-medium">通义 可用模型检测</div>
                <button id="detectTongyiModelsBtn" class="px-2 py-1 text-xs border rounded hover:bg-white w-full sm:w-auto">检测</button>
            </div>
            <div id="tongyiModelsArea" class="mt-2 text-sm text-gray-700 space-y-2">
                <span class="text-gray-500">点击“检测”从 DashScope API 拉取模型列表</span>
            </div>
        `;
        keyManagerColumn.appendChild(panel);
        const detectBtn = panel.querySelector('#detectTongyiModelsBtn');
        const area = panel.querySelector('#tongyiModelsArea');
        detectBtn.onclick = async () => {
            let keys = (loadModelKeys('tongyi') || []);
            keys = keys.filter(k => k.status !== 'invalid' && k.value);
            if (keys.length === 0) {
                area.innerHTML = '<span class="text-red-600">无可用 通义 API Key</span>';
                return;
            }
            const apiKey = keys[0].value.trim();
            detectBtn.disabled = true;
            detectBtn.textContent = '检测中...';
            let searchBtn;
            try {
                const resp = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/models', {
                    headers: { 'Authorization': `Bearer ${apiKey}` }
                });
                if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
                const data = await resp.json();
                const items = Array.isArray(data.data) ? data.data : (Array.isArray(data.models) ? data.models : (Array.isArray(data?.data?.models) ? data.data.models : []));
                if (!items || items.length === 0) {
                    area.innerHTML = '<span class="text-gray-500">未返回模型列表</span>';
                    setModelSearchCache('tongyi_key_manager_detect_list', []);
                    return;
                }
                const select = document.createElement('select');
                select.className = 'mt-2 w-full sm:flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors';
                const normalized = [];
                items.forEach(m => {
                    const id = m.model || m.id || m.name;
                    if (!id || normalized.some(n => n.value === id)) return;
                    const opt = document.createElement('option');
                    opt.value = id;
                    opt.textContent = id;
                    select.appendChild(opt);
                    normalized.push({ value: id, label: id, description: '' });
                });
                const cacheKey = 'tongyi_key_manager_detect_list';
                setModelSearchCache(cacheKey, normalized);
                searchBtn = document.createElement('button');
                searchBtn.className = 'mt-2 px-3 py-1.5 text-xs border border-gray-300 rounded text-gray-600 hover:text-blue-600 hover:border-blue-400 transition-colors flex items-center justify-center w-full sm:w-auto';
                searchBtn.innerHTML = '<iconify-icon icon="carbon:search" class="mr-1" width="14"></iconify-icon>搜索模型';
                registerModelSearchIntegration({
                    key: cacheKey,
                    selectEl: select,
                    buttonEl: searchBtn,
                    title: '选择通义模型',
                    placeholder: '搜索模型 ID...',
                    emptyMessage: '未找到匹配的模型',
                    onEmpty: () => { detectBtn.click(); return true; },
                    onSelect: value => {
                        if (select.value !== value) {
                            select.value = value;
                            select.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    }
                });
                searchBtn.disabled = normalized.length === 0;
                const saveBtn = document.createElement('button');
                saveBtn.className = 'mt-2 px-3 py-1.5 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded w-full sm:w-auto';
                saveBtn.textContent = '设为默认模型';
                saveBtn.onclick = () => {
                    saveModelConfig('tongyi', { preferredModelId: select.value });
                    showNotification && showNotification(`通义 默认模型已设为 ${select.value}`, 'success');
                };
                area.innerHTML = '';
                const controls = document.createElement('div');
                controls.className = 'mt-2 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center gap-2';
                controls.appendChild(select);
                controls.appendChild(searchBtn);
                controls.appendChild(saveBtn);
                area.appendChild(controls);
            } catch (e) {
                if (typeof console !== 'undefined') console.error(e);
                area.innerHTML = `<span class="text-red-600">检测失败: ${e.message}</span>`;
                setModelSearchCache('tongyi_key_manager_detect_list', []);
                if (searchBtn) searchBtn.disabled = true;
            } finally {
                detectBtn.disabled = false;
                detectBtn.textContent = '检测';
            }
        };
        }

        // 追加：火山 检测面板（两个火山条目使用 'volcano'）
        if (modelKeyOrSourceSiteModelName === 'volcano') {
            const panel = document.createElement('div');
            panel.className = 'mt-4 p-3 border rounded-md bg-blue-50';
            panel.innerHTML = `
                <div class="flex items-center justify之间">
                    <div class="text-sm text-blue-800 font-medium">火山 可用模型检测</div>
                    <button id="detectVolcanoModelsBtn" class="px-2 py-1 text-xs border rounded hover:bg白">检测</button>
                </div>
                <div id="volcanoModelsArea" class="mt-2 text-sm text-gray-700">
                    <span class="text-gray-500">点击“检测”从 Ark API 拉取模型列表</span>
                </div>
            `;
            // 修正误植
            panel.innerHTML = panel.innerHTML.replace('之间', 'between').replace('白', 'white');
            keyManagerColumn.appendChild(panel);
            const detectBtn = panel.querySelector('#detectVolcanoModelsBtn');
            const area = panel.querySelector('#volcanoModelsArea');
            // 按用户要求：不提供在线检测，改为手动输入并保存
            if (detectBtn && area) {
                detectBtn.style.display = 'none';
                area.innerHTML = `
                    <div class="flex items-center gap-2">
                        <input id="volcanoKMManualInput" type="text" class="w-full sm:flex-grow px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500" placeholder="例如：doubao-1-5-pro-32k-250115">
                        <button id="volcanoKMSaveBtn" class="px-4 py-1.5 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded whitespace-nowrap">设为默认</button>
                    </div>
                    <div class="mt-1 text-xs text-gray-600">不提供在线检测；请手动输入模型ID。</div>
                `;
                try { const cfg = loadModelConfig && loadModelConfig('volcano'); if (cfg && (cfg.preferredModelId || cfg.modelId)) area.querySelector('#volcanoKMManualInput').value = cfg.preferredModelId || cfg.modelId; } catch {}
                const saveBtn = area.querySelector('#volcanoKMSaveBtn');
                saveBtn.onclick = () => {
                    const val = (area.querySelector('#volcanoKMManualInput').value || '').trim();
                    if (!val) { showNotification && showNotification('请输入模型ID', 'warning'); return; }
                    saveModelConfig && saveModelConfig('volcano', { preferredModelId: val });
                    showNotification && showNotification(`火山 默认模型已设为 ${val}`, 'success');
                };
                // 不再绑定在线检测
                return;
            }
            if (detectBtn) detectBtn.style.display = 'none';
            if (area) area.innerHTML = '<span class="text-gray-600">请手动输入模型ID，或在设置中选择。示例：<code>doubao-1-5-pro-32k-250115</code> / <code>deepseek-v3-250324</code></span>';
        }

        if (modelKeyOrSourceSiteModelName === 'deeplx') {
            const panel = document.createElement('div');
            panel.className = 'mt-4 p-3 border rounded-md bg-blue-50';
            const placeholderHtml = DEEPLX_DEFAULT_ENDPOINT_TEMPLATE.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            panel.innerHTML = `
                <div class="text-sm text-blue-800 font-medium mb-2">DeepLX 接口模板</div>
                <div class="flex items-center gap-2">
                    <input id="deeplxEndpointTemplateInput-manager" type="text" class="flex-1 px-3 py-1.5 border border-blue-200 rounded-md text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors" placeholder="${placeholderHtml}">
                    <button id="deeplxEndpointResetBtn-manager" type="button" class="px-2 py-1 text-xs border border-blue-300 rounded hover:bg-white">恢复默认</button>
                </div>
                <p class="mt-2 text-xs text-blue-900 leading-5">模板中的 <code>&lt;api-key&gt;</code> 或 {API_KEY} 会自动替换为当前使用的 Key，可用于自建代理地址。</p>
            `;
            keyManagerColumn.appendChild(panel);
            const inputEl = panel.querySelector('#deeplxEndpointTemplateInput-manager');
            const resetBtn = panel.querySelector('#deeplxEndpointResetBtn-manager');
            setupDeeplxEndpointInput(inputEl, resetBtn);
        }
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
            if (typeof window.refreshCustomSourceSiteInfo === 'function') {
                window.refreshCustomSourceSiteInfo({ autoSelect: false });
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

                const endpointModeLabels = {
                    auto: '自动补全 /v1/... (默认)',
                    chat: '仅追加 /chat/completions',
                    manual: '完整端点（不自动追加）'
                };
                const endpointModeLabel = endpointModeLabels[site.endpointMode] || endpointModeLabels.auto;

                // 构建HTML以展示站点信息
                let infoHtml = `
                    <div class="p-3">
                        <h3 class="font-bold text-gray-800 text-xl mt-1 mb-2">${site.displayName || '未命名源站点'}</h3>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                            <div><span class="font-medium">API Base URL:</span> <span class="text-gray-600">${site.apiBaseUrl || '未设置'}</span></div>
                            <div><span class="font-medium">端点补全:</span> <span class="text-gray-600">${endpointModeLabel}</span></div>
                            <div><span class="font-medium">当前模型:</span> <span id="currentModelPreview_${siteId}" class="text-gray-600">${site.modelId || '未设置'}</span></div>
                            <div><span class="font-medium">请求格式:</span> <span class="text-gray-600">${site.requestFormat || 'openai'}</span></div>
                            <div><span class="font-medium">温度:</span> <span class="text-gray-600">${site.temperature || '0.5'}</span></div>
                        </div>`;

                // 如果有可用模型列表，则展示为可选择的下拉框
                if (site.availableModels && site.availableModels.length > 0) {
                    infoHtml += `
                        <div class="mt-2 border-t border-dashed pt-2">
                            <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                                <div class="font-medium mb-1">选择模型:</div>
                                <div class="flex flex-col sm:flex-row sm:items-center sm:space-x-2 gap-2">
                                    <span class="text-xs text-green-600 flex items-center">
                                        <iconify-icon icon="carbon:checkmark-filled" class="mr-1" width="14"></iconify-icon>
                                        检测到 ${site.availableModels.length} 个可用模型
                                    </span>
                                    <button id="reDetectModelsBtn_${siteId}" class="ml-1 px-1.5 py-0.5 bg-gray-100 hover:bg-blue-100 text-blue-600 rounded flex items-center" title="重新检测模型">
                                        <iconify-icon icon="carbon:renew" class="animate-spin-slow" width="16"></iconify-icon>
                                    </button>
                                </div>
                            </div>
                            <div class="flex flex-col sm:flex-row sm:items-center sm:space-x-2 space-y-2 sm:space-y-0 mt-2">
                                <select id="sourceSiteModelSelect_${siteId}" class="w-full sm:flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors">`;

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
                                <button id="sourceSiteModelSearchBtn_${siteId}" class="px-3 py-1.5 border border-gray-300 rounded text-xs text-gray-600 hover:text-blue-600 hover:border-blue-400 transition-colors flex items-center whitespace-nowrap">
                                    <iconify-icon icon="carbon:search" class="mr-1" width="14"></iconify-icon>
                                    搜索模型
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
                        <div class="flex flex-col sm:flex-row sm:items-center gap-2 w-full">
                            <input type="text" id="manualModelId_${siteId}" class="w-full sm:flex-1 px-3 py-1.5 border border-gray-300 rounded-l-md text-sm" value="${site.modelId || ''}" placeholder="例如: gpt-4-turbo">
                            <button id="saveManualModelBtn_${siteId}" class="px-2 py-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded sm:rounded-r-md text-xs flex items-center justify-center w-full sm:w-auto">
                                <iconify-icon icon="carbon:save" class="mr-1" width="14"></iconify-icon>
                                保存
                            </button>
                        </div>
                        <div class="mt-2 text-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
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
                        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                            <div class="flex flex-col sm:flex-row sm:items-center gap-3 h-full">
                                <span class="font-medium">API Keys:</span>
                                <span class="text-sm ${customSourceKeysCount > 0 ? 'text-green-600' : 'text-red-600'} flex items-center">
                                    ${customSourceKeysCount > 0 ?
                                      `<iconify-icon icon="carbon:checkmark-filled" class="mr-1" width="14"></iconify-icon>${customSourceKeysCount}个可用Key` :
                                      `<iconify-icon icon="carbon:warning-filled" class="mr-1" width="14"></iconify-icon>无可用Key`}
                                </span>
                            </div>
                            <button id="infoManageKeyBtn_${siteId}" class="px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded text-xs flex items-center justify-center w-full sm:w-auto" style="min-height:2.4em;">
                                <iconify-icon icon="carbon:api" class="mr-1" width="14"></iconify-icon>
                                管理API Key
                            </button>
                        </div>
                    </div>`;

                infoHtml += `</div>`;
                infoContainer.innerHTML = infoHtml;

                const cacheKey = `custom_source_${siteId}`;
                const modelSelectEl = document.getElementById(`sourceSiteModelSelect_${siteId}`);
                const searchBtnEl = document.getElementById(`sourceSiteModelSearchBtn_${siteId}`);
                if (modelSelectEl) {
                    const normalizedModels = [];
                    const seenModelIds = new Set();
                    (site.availableModels || []).forEach(model => {
                        const modelId = model && (model.id || model.name);
                        if (!modelId || seenModelIds.has(modelId)) return;
                        seenModelIds.add(modelId);
                        normalizedModels.push({
                            value: modelId,
                            label: model.name || modelId,
                            description: model.rawName || model.description || ''
                        });
                    });
                    setModelSearchCache(cacheKey, normalizedModels);

                    if (searchBtnEl) {
                        registerModelSearchIntegration({
                            key: cacheKey,
                            selectEl: modelSelectEl,
                            buttonEl: searchBtnEl,
                            title: `选择模型（${site.displayName || '自定义源'}）`,
                            placeholder: '搜索模型 ID...',
                            emptyMessage: '未找到匹配的模型',
                            onEmpty: () => {
                                const reDetectBtn = document.getElementById(`reDetectModelsBtn_${siteId}`) || document.getElementById(`infoDetectModelsBtn_${siteId}`);
                                if (reDetectBtn && !reDetectBtn.disabled) {
                                    reDetectBtn.click();
                                }
                                return true;
                            },
                            onSelect: (value) => {
                                if (!modelSelectEl || !value) return;
                                if (modelSelectEl.value !== value) {
                                    modelSelectEl.value = value;
                                    modelSelectEl.dispatchEvent(new Event('change', { bubbles: true }));
                                }
                            }
                        });
                    }
                } else if (searchBtnEl) {
                    searchBtnEl.disabled = true;
                }

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

                    if (modelSelect) {
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
                            // 新增：同步写入 lastSelectedCustomModel
                            localStorage.setItem('lastSelectedCustomModel', modelSelect.value);
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

            const requestFormat = site.requestFormat || 'openai';

            for (const key of validKeys) {
                try {
                    showNotification(`正在尝试使用Key (${key.value.substring(0, 4)}...) 检测模型`, 'info');
                    modelsDetected = await window.modelDetector.detectModelsForSite(site.apiBaseUrl, key.value, requestFormat);

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
