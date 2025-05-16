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

// --- 全局翻译并发控制 ---
let translationSemaphore = {
    limit: 2, // 默认翻译并发数，可由设置覆盖
    count: 0,
    queue: []
};

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

    // 3. 加载 API Keys（如有记住）
    loadApiKeysFromStorage();

    // 4. 初始化 UI 状态
    updateFileListUI(pdfFiles, isProcessing, handleRemoveFile);
    updateProcessButtonState(pdfFiles, isProcessing);
    updateTranslationUIVisibility(isProcessing);

    // 5. 绑定所有事件
    setupEventListeners();
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
        concurrencyLevel: concurrencyVal,
        translationConcurrencyLevel: translationConcurrencyVal,
        targetLanguage: targetLangVal,
        customTargetLanguageName: customLangNameVal,
        customModelSettings: cms,
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

    // 自定义模型设置
    if (modelVal === 'custom' && cms) {
        const apiEndpointInput = document.getElementById('customApiEndpoint');
        const modelIdInput = document.getElementById('customModelId');
        const requestFormatInput = document.getElementById('customRequestFormat');
        const temperatureInput = document.getElementById('customTemperature');
        const maxTokensInput = document.getElementById('customMaxTokens');
        if (apiEndpointInput) apiEndpointInput.value = cms.apiEndpoint || '';
        if (modelIdInput) modelIdInput.value = cms.modelId || '';
        if (requestFormatInput) requestFormatInput.value = cms.requestFormat || 'openai';
        if (temperatureInput) temperatureInput.value = (cms.temperature !== undefined ? cms.temperature : 0.5);
        if (maxTokensInput) maxTokensInput.value = (cms.max_tokens !== undefined ? cms.max_tokens : 8000);
    }
    // 触发 UI 相关联动
    updateTranslationUIVisibility(isProcessing);
    updateCustomLanguageInputVisibility();
    updatePromptTextareasContent();
}

// =====================
// API Key 加载
// =====================
function loadApiKeysFromStorage() {
    const mistralKeysText = localStorage.getItem('mistralApiKeys');
    const translationKeysText = localStorage.getItem('translationApiKeys');

    if (mistralKeysText) {
        document.getElementById('mistralApiKeys').value = mistralKeysText;
        document.getElementById('rememberMistralKey').checked = true;
    }
    if (translationKeysText) {
        document.getElementById('translationApiKeys').value = translationKeysText;
        document.getElementById('rememberTranslationKey').checked = true;
    }
}

// =====================
// 事件监听器绑定
// =====================
function setupEventListeners() {
    // (需要从 ui.js 获取 DOM 元素引用)
    const mistralTextArea = document.getElementById('mistralApiKeys');
    const translationTextArea = document.getElementById('translationApiKeys');
    const rememberMistralCheckbox = document.getElementById('rememberMistralKey');
    const rememberTranslationCheckbox = document.getElementById('rememberTranslationKey');
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

    // API Key 存储
    rememberMistralCheckbox.addEventListener('change', () => {
        updateApiKeyStorage('mistralApiKeys', mistralTextArea.value, rememberMistralCheckbox.checked);
    });
    rememberTranslationCheckbox.addEventListener('change', () => {
        updateApiKeyStorage('translationApiKeys', translationTextArea.value, rememberTranslationCheckbox.checked);
    });
    mistralTextArea.addEventListener('input', () => {
        if (rememberMistralCheckbox.checked) {
            localStorage.setItem('mistralApiKeys', mistralTextArea.value); // 直接保存
        }
        updateProcessButtonState(pdfFiles, isProcessing);
    });
    translationTextArea.addEventListener('input', () => {
        if (rememberTranslationCheckbox.checked) {
            localStorage.setItem('translationApiKeys', translationTextArea.value); // 直接保存
        }
        updateTranslationUIVisibility(isProcessing);
    });

    // 翻译模型和自定义设置
    translationModelSelect.addEventListener('change', () => {
        updateTranslationUIVisibility(isProcessing);
        saveCurrentSettings(); // 保存包括模型选择在内的所有设置
    });
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
        if (file.type === 'application/pdf') {
            if (!pdfFiles.some(existingFile => existingFile.name === file.name && existingFile.size === file.size)) {
                pdfFiles.push(file);
                filesAdded = true;
            } else {
                showNotification(`文件 "${file.name}" 已在列表中`, 'info');
            }
        } else {
            showNotification(`文件 "${file.name}" 不是PDF，已忽略`, 'warning');
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
    const settingsData = {
        maxTokensPerChunk: document.getElementById('maxTokensPerChunk').value,
        skipProcessedFiles: document.getElementById('skipProcessedFiles').checked,
        selectedTranslationModel: document.getElementById('translationModel').value,
        concurrencyLevel: document.getElementById('concurrencyLevel').value,
        translationConcurrencyLevel: document.getElementById('translationConcurrencyLevel').value, // Read new setting
        targetLanguage: targetLangValue, // Save target language selection
        customTargetLanguageName: targetLangValue === 'custom' ? document.getElementById('customTargetLanguageInput').value : '', // Save custom language name if applicable
        customModelSettings: {
            apiEndpoint: document.getElementById('customApiEndpoint').value,
            modelId: document.getElementById('customModelId').value,
            requestFormat: document.getElementById('customRequestFormat').value,
            temperature: parseFloat(document.getElementById('customTemperature').value),
            max_tokens: parseInt(document.getElementById('customMaxTokens').value)
        },
        defaultSystemPrompt: document.getElementById('defaultSystemPrompt').value, // Save default system prompt
        defaultUserPromptTemplate: document.getElementById('defaultUserPromptTemplate').value, // Save default user prompt template
        useCustomPrompts: document.getElementById('useCustomPromptsCheckbox').checked // Save checkbox state
    };
    // 调用 storage.js 中的保存函数
    saveSettings(settingsData);
}

// =====================
// 核心处理流程启动
// =====================
async function handleProcessClick() {
    if (isProcessing) return;

    // 1. 解析和验证 API Keys
    if (!apiKeyManager.parseKeys('mistral')) {
        showNotification('请输入至少一个有效的 Mistral API Key', 'error');
        return;
    }
    const translationModel = document.getElementById('translationModel').value;
    if (translationModel !== 'none' && !apiKeyManager.parseKeys('translation')) {
        showNotification(`选择了翻译模型，请输入至少一个有效的翻译 API Key`, 'error');
        return;
    }
    if (pdfFiles.length === 0) {
        showNotification('请选择至少一个 PDF 文件', 'error');
        return;
    }
    // 2. 验证自定义模型设置
    if (translationModel === 'custom') {
        const endpoint = document.getElementById('customApiEndpoint').value.trim();
        const id = document.getElementById('customModelId').value.trim();
        if (!endpoint || !id) {
            showNotification('请填写完整的自定义模型 API Endpoint 和模型 ID', 'error');
            return;
        }
    }

    // 3. 设置处理状态
    isProcessing = true;
    activeProcessingCount = 0;
    retryAttempts.clear();
    allResults = new Array(pdfFiles.length);
    updateProcessButtonState(pdfFiles, isProcessing);
    showProgressSection();
    addProgressLog('=== 开始批量处理 ===');

    // 4. 获取并发和重试设置
    const concurrencyLevel = parseInt(document.getElementById('concurrencyLevel').value) || 1;
    const translationConcurrencyLevel = parseInt(document.getElementById('translationConcurrencyLevel').value) || 2;
    const skipEnabled = document.getElementById('skipProcessedFiles').checked;
    const maxTokensValue = document.getElementById('maxTokensPerChunk').value;
    const targetLanguageSetting = document.getElementById('targetLanguage').value;
    const customTargetLanguageNameSetting = document.getElementById('customTargetLanguageInput').value;
    const defaultSystemPromptSetting = document.getElementById('defaultSystemPrompt').value;
    const defaultUserPromptTemplateSetting = document.getElementById('defaultUserPromptTemplate').value;
    const useCustomPromptsSetting = document.getElementById('useCustomPromptsCheckbox').checked;

    // 确定最终的目标语言名称
    const effectiveTargetLanguage = targetLanguageSetting === 'custom'
        ? customTargetLanguageNameSetting.trim() || 'English'
        : targetLanguageSetting;

    // 初始化翻译信号量
    translationSemaphore.limit = translationConcurrencyLevel;
    translationSemaphore.count = 0;
    translationSemaphore.queue = [];

    addProgressLog(`文件并发: ${concurrencyLevel}, 翻译并发: ${translationConcurrencyLevel}, 最大重试: ${MAX_RETRIES}, 跳过已处理: ${skipEnabled}`);
    updateConcurrentProgress(0);

    // 5. 初始化计数器和待处理队列
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

    // 6. 更新初始进度
    updateOverallProgress(successCount, skippedCount, errorCount, filesToProcess.length);

    // 7. 启动并发处理队列
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

                // 获取当前任务的 key
                const mistralKeyForTask = apiKeyManager.getMistralKey();
                const translationKeyForTask = apiKeyManager.getTranslationKey();

                // 调用核心处理函数
                processSinglePdf(
                    currentFile,
                    mistralKeyForTask,
                    translationKeyForTask,
                    translationModel,
                    maxTokensValue,
                    effectiveTargetLanguage,
                    acquireTranslationSlot,
                    releaseTranslationSlot,
                    defaultSystemPromptSetting,
                    defaultUserPromptTemplateSetting,
                    useCustomPromptsSetting
                )
                    .then(result => {
                        if (result && !result.error) {
                            allResults[currentFileIndex] = result;
                            markFileAsProcessed(fileIdentifier, processedFilesRecord);
                            addProgressLog(`[${currentFile.name}] 处理成功！`);
                            successCount++;
                            retryAttempts.delete(fileIdentifier);
                        } else {
                            // 处理失败和重试
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
                        // 捕获 processSinglePdf 内部未预料的错误
                        console.error(`处理文件 ${currentFile.name} 时发生意外错误:`, error);
                        addProgressLog(`错误: 处理 ${currentFile.name} 失败 - ${error.message}`);
                        allResults[currentFileIndex] = { file: currentFile, error: error.message };
                        errorCount++;
                        retryAttempts.delete(fileIdentifier);
                    })
                    .finally(() => {
                        // 任务完成（成功、重试或最终失败）
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

    // 8. 执行队列并处理最终结果
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
    let user_prompt_template = ''; // Use template literal placeholders
    const sourceLang = 'English'; // Assume source is always English

    switch (langLower) {
        case 'chinese':
            sys_prompt = "你是一个专业的文档翻译助手，擅长将文本精确翻译为简体中文，同时保留原始的 Markdown 格式。";
            user_prompt_template = `请将以下内容翻译为 **简体中文**。\n要求:\n\n1. 保持所有 Markdown 语法元素不变（如 # 标题、 *斜体*、 **粗体**、 [链接]()、 ![图片]() 等）。\n2. 学术/专业术语应准确翻译。\n3. 保持原文的段落结构和格式。\n4. 仅输出翻译后的内容，不要包含任何额外的解释或注释。\n5. 对于行间公式，使用 $$...$$ 标记。\n\n文档内容:\n\n\${content}`;
            break;
        case 'japanese':
            sys_prompt = "あなたはプロの文書翻訳アシスタントで、テキストを正確に日本語に翻訳し、元の Markdown 形式を維持することに長けています。";
            user_prompt_template = `以下の内容を **日本語** に翻訳してください。\n要件:\n\n1. すべての Markdown 構文要素（例: # 見出し、 *イタリック*、 **太字**、 [リンク]()、 ![画像]() など）は変更しないでください。\n2. 学術/専門用語は正確に翻訳してください。\n3. 元の段落構造と書式を維持してください。\n4. 翻訳された内容のみを出力し、余分な説明や注釈は含めないでください。\n5. 表示数式には $$...$$ を使用してください。\n\nドキュメント内容:\n\n\${content}`;
            break;
        case 'korean':
            sys_prompt = "당신은 전문 문서 번역 도우미로, 텍스트를 정확하게 한국어로 번역하고 원본 마크다운 형식을 유지하는 데 능숙합니다.";
            user_prompt_template = `다음 내용을 **한국어** 로 번역해 주세요。\n요구 사항:\n\n1. 모든 마크다운 구문 요소(예: # 제목, *기울임꼴*, **굵게**, [링크](), ![이미지]() 등)를 변경하지 마십시오.\n2. 학술/전문 용어는 정확하게 번역하십시오.\n3. 원본 단락 구조와 서식을 유지하십시오.\n4. 번역된 내용만 출력하고 추가 설명이나 주석을 포함하지 마십시오.\n5. 수식 표시는 $$...$$ 를 사용하십시오。\n\n문서 내용:\n\n\${content}`;
            break;
        case 'french':
            sys_prompt = "Vous êtes un assistant de traduction de documents professionnel, compétent pour traduire avec précision le texte en français tout en préservant le format Markdown d'origine.";
            user_prompt_template = `Veuillez traduire le contenu suivant en **Français**。\nExigences:\n\n1. Conserver tous les éléments de syntaxe Markdown inchangés (par exemple, # titres, *italique*, **gras**, [liens](), ![images]()).\n2. Traduire avec précision les termes académiques/professionnels.\n3. Maintenir la structure et le formatage des paragraphes d'origine.\n4. Produire uniquement le contenu traduit, sans explications ni annotations supplémentaires.\n5. Pour les formules mathématiques, utiliser \$\$...\$\$.\n\nContenu du document:\n\n\${content}`;
            break;
        case 'english':
            sys_prompt = "You are a professional document translation assistant, skilled at accurately translating text into English while preserving the original document format.";
            user_prompt_template = `Please translate the following content into **English**.\n Requirements:\n\n 1. Keep all Markdown syntax elements unchanged (e.g., #headings, *italics*, **bold**, [links](), ![images]()).\n 2. Translate academic/professional terms accurately. Maintain a formal, academic tone.\n 3. Maintain the original paragraph structure and formatting.\n 4. Output only the translated content.\n 5. For display math formulas, use:\n \$\$\n ...\n \$\$\n\n Document Content:\n\n \${content}`;
            break;
        default: // Fallback for custom languages or other cases
            const targetLangDisplayName = languageName; // Use the passed name directly
            sys_prompt = `You are a professional document translation assistant, skilled at accurately translating content into ${targetLangDisplayName} while preserving the original document format.`;
            // Revert to standard template literal with correct escaping
            user_prompt_template = `Please translate the following content into **${targetLangDisplayName}**. \nRequirements:\n\n1. Keep all Markdown syntax elements unchanged (e.g., #headings, *italics*, **bold**, [links](), ![images]()).\n2. Translate academic/professional terms accurately. If necessary, keep the original term in parentheses if unsure about the translation in ${targetLangDisplayName}.\n3. Maintain the original paragraph structure and formatting.\n4. Translate only the content; do not add extra explanations.\n5. For display math formulas, use:\n\$\$\n...\n\$\$\n\nDocument Content:\n\n\${content}`;
            break; // Ensure break statement is here
    } // End of switch
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
