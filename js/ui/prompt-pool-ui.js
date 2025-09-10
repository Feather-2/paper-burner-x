// ui/prompt-pool-ui.js
// 翻译提示词池 UI 控制器

/**
 * 提示词池 UI 管理器
 */
class PromptPoolUI {
    constructor() {

        this.promptPool = window.translationPromptPool;
        this.currentEditingId = null;
        this.settingsKey = 'promptPoolSettings'; // localStorage键名
        this.sessionLockedPrompt = null; // 会话内固定提示词
        this.selectedIds = new Set(); // 多选集合
        // 排序/过滤默认值
        this.sortKey = null;
        this.sortAsc = true;
        this.filterHealth = 'all';
        this.searchKeyword = '';

        // 先加载设置，再绑定事件，再根据设置渲染
        this.loadSettings();
        this.initializeEventListeners();
        this.handlePromptModeChange();
        this.updateUI();

        // 延迟加载模型列表，确保其他脚本已加载
        setTimeout(() => { this.populateAvailableModels(); }, 1000);
    }

    /**
     * 加载保存的设置
     */
    loadSettings() {
        try {
            const savedSettings = localStorage.getItem(this.settingsKey);
            if (savedSettings) {
                const settings = JSON.parse(savedSettings);

                // 恢复提示词模式
                if (settings.promptMode) {
                    const modeRadio = document.getElementById(`promptMode${settings.promptMode.charAt(0).toUpperCase() + settings.promptMode.slice(1)}`);
                    if (modeRadio) {
                        modeRadio.checked = true;
                    }
                }

                // 恢复参考提示词
                if (settings.referenceSystemPrompt) {
                    const systemPromptEl = document.getElementById('referenceSystemPrompt');
                    if (systemPromptEl) systemPromptEl.value = settings.referenceSystemPrompt;
                }
                if (settings.referenceUserPrompt) {
                    const userPromptEl = document.getElementById('referenceUserPrompt');
                    if (userPromptEl) userPromptEl.value = settings.referenceUserPrompt;
                }

                // 恢复生成参数
                if (settings.variationCount) {
                    const countEl = document.getElementById('variationCount');
                    if (countEl) countEl.value = settings.variationCount;
                }
                if (settings.similarityControl) {
                    const similarityEl = document.getElementById('similarityControl');
                    if (similarityEl) similarityEl.value = settings.similarityControl;
                }
                // 恢复生成并发
                if (settings.generationConcurrency) {
                    const ccEl = document.getElementById('generationConcurrency');
                    if (ccEl) ccEl.value = settings.generationConcurrency;
                }
                if (settings.generationModel) {
                    const modelEl = document.getElementById('generationModel');
                    if (modelEl) {
                        // 延迟设置，等模型列表加载完成
                        setTimeout(() => {
                            modelEl.value = settings.generationModel;
                        }, 1500);
                    }
                }

                // 恢复提示词池模式
                if (settings.promptPoolMode) {
                    const poolModeEl = document.getElementById('promptPoolMode');
                    if (poolModeEl) poolModeEl.value = settings.promptPoolMode;
                }

                // 恢复生成器元提示词；若没有保存值则填入默认
                const sysEl = document.getElementById('generatorSystemPrompt');
                const userEl = document.getElementById('generatorUserPrompt');
                if (sysEl) sysEl.value = settings.generatorSystemPrompt || this.buildDefaultGeneratorSystemPrompt();
                if (userEl) userEl.value = settings.generatorUserPrompt || this.buildDefaultGeneratorUserPrompt();

                // 恢复生成并发
                if (settings.generationConcurrency) {
                    const ccEl = document.getElementById('generationConcurrency');
                    if (ccEl) ccEl.value = settings.generationConcurrency;
                }

                // 恢复生成语言
                const langEl = document.getElementById('generatorLanguage');
                if (langEl) langEl.value = settings.generatorLanguage || '中文';
            }
        } catch (error) {
            console.error('[PromptPoolUI] 加载设置失败:', error);
        }
    }

    /**
     * 保存当前设置
     */
    saveSettings() {
        try {
            const settings = {
                // 提示词模式
                promptMode: document.querySelector('input[name="promptMode"]:checked')?.value,

                // 参考提示词
                referenceSystemPrompt: document.getElementById('referenceSystemPrompt')?.value,
                referenceUserPrompt: document.getElementById('referenceUserPrompt')?.value,

                // 生成参数
                variationCount: document.getElementById('variationCount')?.value,
                similarityControl: document.getElementById('similarityControl')?.value,
                generationModel: document.getElementById('generationModel')?.value,
                generationConcurrency: document.getElementById('generationConcurrency')?.value,
                generatorLanguage: document.getElementById('generatorLanguage')?.value || '中文',

                // 提示词池模式
                promptPoolMode: document.getElementById('promptPoolMode')?.value,

                // 生成器元提示词（可选）
                generatorSystemPrompt: document.getElementById('generatorSystemPrompt')?.value,
                generatorUserPrompt: document.getElementById('generatorUserPrompt')?.value,

                // 保存时间戳
                savedAt: Date.now()
            };

            localStorage.setItem(this.settingsKey, JSON.stringify(settings));
        } catch (error) {
            console.error('[PromptPoolUI] 保存设置失败:', error);
        }
    }

    /**
     * 初始化事件监听器
     */
    initializeEventListeners() {
        // 提示词模式切换
        document.querySelectorAll('input[name="promptMode"]').forEach(radio => {
            radio.addEventListener('change', () => {
                this.handlePromptModeChange();
                this.saveSettings(); // 保存设置
            });
        });
        // 提示词池内部步骤 Tabs（已移除）

        // 生成变体按钮
        const generateBtn = document.getElementById('generateVariationsBtn');
        if (generateBtn) {
            generateBtn.addEventListener('click', () => this.generateVariations());
        }

        // 生成器元提示词面板开关
        const toggleGenBtn = document.getElementById('toggleGeneratorPromptsBtn');
        if (toggleGenBtn) {
            toggleGenBtn.addEventListener('click', () => {
                const panel = document.getElementById('generatorPromptsPanel');
                if (panel) {
                    panel.classList.toggle('hidden');
                    // 首次展开时，如未填写，则填入默认生成器提示词
                    if (!panel.classList.contains('hidden')) {
                        const sysEl = document.getElementById('generatorSystemPrompt');
                        const userEl = document.getElementById('generatorUserPrompt');
                        if (sysEl && !sysEl.value) sysEl.value = this.buildDefaultGeneratorSystemPrompt();
                        if (userEl && !userEl.value) userEl.value = this.buildDefaultGeneratorUserPrompt();
                    }
                }
            });
        }

        // 重置为默认
        const resetGenBtn = document.getElementById('resetGeneratorPromptsBtn');
        if (resetGenBtn) {
            resetGenBtn.addEventListener('click', () => {
                const sysEl = document.getElementById('generatorSystemPrompt');
                const userEl = document.getElementById('generatorUserPrompt');
                if (sysEl) sysEl.value = this.buildDefaultGeneratorSystemPrompt();
                if (userEl) userEl.value = this.buildDefaultGeneratorUserPrompt();
                this.saveSettings();
                this.showNotification('已重置为默认生成器提示词', 'info');
                const panel = document.getElementById('generatorPromptsPanel');
                if (panel && panel.classList.contains('hidden')) panel.classList.remove('hidden');
            });
        }

        // 清空池按钮
        const clearBtn = document.getElementById('clearPoolBtn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => this.clearPool());
        }

        // 导入导出按钮
        const importBtn = document.getElementById('importPoolBtn');
        const exportBtn = document.getElementById('exportPoolBtn');
        if (importBtn) importBtn.addEventListener('click', () => this.importPool());
        if (exportBtn) exportBtn.addEventListener('click', () => this.exportPool());

        // 健康设置按钮
        const healthSettingsBtn = document.getElementById('healthSettingsBtn');
        if (healthSettingsBtn) {
            healthSettingsBtn.addEventListener('click', () => this.openHealthSettings());
        }

        // 监听参数变化并保存设置
        const parameterInputs = [
            'referenceSystemPrompt',
            'referenceUserPrompt',
            'variationCount',
            'similarityControl',
            'generationModel',
            'promptPoolMode',
            'generatorSystemPrompt',
            'generatorUserPrompt',
            'generationConcurrency',
            'generatorLanguage'
        ];

        parameterInputs.forEach(inputId => {
            const element = document.getElementById(inputId);
            if (element) {
                const eventType = element.type === 'textarea' ? 'input' : 'change';
                element.addEventListener(eventType, () => {
                    // 延迟保存，避免频繁写入
                    clearTimeout(this.saveTimeout);
                    this.saveTimeout = setTimeout(() => {
                        this.saveSettings();
                    }, 500);
                });
            }
        });

        // 初始化模式切换和可用模型列表
        this.handlePromptModeChange();
        this.populateAvailableModels();
        this.updateHealthOverview();

        // 定期更新健康状态显示
        setInterval(() => {
            this.updateHealthOverview();
        }, 30000); // 30秒更新一次
    }

    // ===== 生成器提示词默认构造 =====
    getSimilarityDescriptionUI(similarity) {
        const s = parseFloat(similarity || '0.6');
        if (s <= 0.3) return '改写幅度很大（语序与措辞差异显著）';
        if (s <= 0.5) return '改写幅度中等（保持等价约束，表达有明显变化）';
        if (s <= 0.7) return '改写幅度适中（整体表达有所变化）';
        return '改写幅度较小（细微措辞/顺序调整）';
    }

    buildDefaultGeneratorSystemPrompt() {
        // 默认使用 ${count} 占位符，实际生成时再替换
        return (
`你是资深提示词工程师，负责在不改变风格与约束的前提下，生成同风格的改写变体。

任务：基于参考提示词，生成 \${count} 个“同风格、同约束、同输出要求”的翻译提示词变体；仅在措辞、语序、句式、连接词与段落组织上做改写，以提升稳定性与一致性。

强制要求：
1. 返回 JSON，包含字段 variations（数组）。
2. 每个变体包含：name（名称）、systemPrompt（系统提示）、userPromptTemplate（用户提示模板）、description（简要说明）。必须同时给出 systemPrompt 与 userPromptTemplate 两个字段。
3. 相似度控制：请按请求给定的相似度要求理解（无需在文本中体现具体数值）。注意：风格与约束必须完全一致，仅体现措辞与语序差异。
4. userPromptTemplate 必须且仅出现一次占位符：\${targetLangName} 与 \${content}。
5. 严禁改变参考提示词的风格、语气、规则、术语偏好与输出格式要求；严禁引入“学术/商务/口语/文学”等风格标签的切换或暗示。
6. 允许调整表述顺序、同义替换与句式变化，但要保持语义与约束等价。
7. 仅输出严格的 JSON 对象（不包含 Markdown 代码块、注释或额外文本）。
8. 使用单行（minified）JSON 输出：不得换行、不得缩进。
9. 所有可读文本（如 name/description）请使用 \${genlanguage} 编写。`
        );
    }

    buildDefaultGeneratorUserPrompt() {
        const sysRef = document.getElementById('referenceSystemPrompt')?.value || '';
        const userRef = document.getElementById('referenceUserPrompt')?.value || '';
        return (
`参考提示词（须保持风格/规则/输出要求一致）：

**系统提示：**
${sysRef}

**用户提示模板：**
${userRef}

请基于以上参考提示词生成 \${count} 个“同风格改写”变体：保持风格、语气、规则与输出要求不变，仅做措辞/语序/句式的等价改写。

每个变体必须包含 systemPrompt 与 userPromptTemplate 两个字段；并且确保 userPromptTemplate 都包含且仅包含一次 \${targetLangName} 与 \${content} 占位符。严格输出为单行 JSON（无任何额外文字/提示/代码块）。
请使用 \${genlanguage} 编写所有需要人类阅读的文本（如 name/description）。`
        );
    }

    /**
     * 填充可用的AI模型列表（使用当前源站点的模型列表）
     */
    populateAvailableModels() {
        const modelSelect = document.getElementById('generationModel');
        if (!modelSelect) return;

        // 保存当前选择
        const currentSelection = modelSelect.value;

        // 清空现有选项
        modelSelect.innerHTML = '';

        // 填充模型列表

        try {
            let hasAvailableModels = false;

            // 1. 添加预设模型选项
            const predefinedModels = [
                { value: 'mistral', name: 'Mistral Large' },
                { value: 'deepseek', name: 'DeepSeek V3' },
                { value: 'gemini', name: 'Gemini 2.0' }
            ];

            predefinedModels.forEach(model => {
                const keys = typeof loadModelKeys === 'function' ? loadModelKeys(model.value) : [];
                const validKeys = keys.filter(key => key.status === 'valid' || key.status === 'untested' || !key.status);

                if (validKeys.length > 0) {
                    const option = document.createElement('option');
                    option.value = model.value;
                    option.textContent = model.name;
                    modelSelect.appendChild(option);
                    hasAvailableModels = true;
                }
            });

            // 2. 获取当前选中的自定义源站点及其模型列表
            if (typeof loadAllCustomSourceSites === 'function') {
                const allSites = loadAllCustomSourceSites();

                // 获取当前选中的源站点ID（从设置中读取）
                let settings = {};
                if (typeof loadSettings === 'function') {
                    settings = loadSettings();
                } else {
                    try { settings = JSON.parse(localStorage.getItem('paperBurnerSettings') || '{}'); } catch (e) { settings = {}; }
                }

                const currentSiteId = settings.selectedCustomSourceSiteId;
                if (currentSiteId && allSites[currentSiteId]) {
                    const currentSite = allSites[currentSiteId];

                    // 检查这个源站点是否有可用的API密钥
                    const customModelKey = `custom_source_${currentSiteId}`;
                    const keys = typeof loadModelKeys === 'function' ? loadModelKeys(customModelKey) : [];
                    const validKeys = keys.filter(key => key.status === 'valid' || key.status === 'untested' || !key.status);

                    if (validKeys.length > 0) {
                        console.log(`[PromptPoolUI] 源站点 ${currentSiteId} 有可用密钥`);

                        // 如果源站点有可用模型列表，添加所有模型
                        if (currentSite.availableModels && currentSite.availableModels.length > 0) {
                            console.log(`[PromptPoolUI] 添加源站点的 ${currentSite.availableModels.length} 个可用模型:`, currentSite.availableModels);

                            currentSite.availableModels.forEach(model => {
                                const option = document.createElement('option');
                                option.value = `${currentSiteId}:${model.id}`; // 使用站点ID:模型ID格式
                                option.textContent = `${model.name || model.id} (${currentSite.displayName || '自定义'})`;
                                modelSelect.appendChild(option);
                                hasAvailableModels = true;
                                //console.log(`[PromptPoolUI] 已添加模型选项: ${option.textContent} (value: ${option.value})`);
                            });
                        } else if (currentSite.modelId) {
                            // 如果没有模型列表但有默认模型ID，添加默认模型
                            console.log(`[PromptPoolUI] 添加源站点的默认模型: ${currentSite.modelId}`);
                            const option = document.createElement('option');
                            option.value = `${currentSiteId}:${currentSite.modelId}`;
                            option.textContent = `${currentSite.modelId} (${currentSite.displayName || '自定义'})`;
                            modelSelect.appendChild(option);
                            hasAvailableModels = true;
                            console.log(`[PromptPoolUI] 已添加默认模型选项: ${option.textContent} (value: ${option.value})`);
                        } else {
                            console.log(`[PromptPoolUI] 源站点 ${currentSiteId} 既没有availableModels也没有modelId`);
                        }
                    } else {
                        console.warn(`[PromptPoolUI] 源站点 ${currentSiteId} 没有可用密钥。密钥检查结果:`, {
                            keys: keys,
                            validKeys: validKeys
                        });
                    }
                } else {
                    console.log('[PromptPoolUI] 没有选中的源站点或源站点不存在。', {
                        currentSiteId: currentSiteId,
                        availableSites: Object.keys(allSites)
                    });
                }
            } else {
                console.error('[PromptPoolUI] loadAllCustomSourceSites函数不可用');
            }

            // 如果没有可用模型，添加提示
            if (!hasAvailableModels) {
                const option = document.createElement('option');
                option.value = '';
                option.textContent = '请先在模型管理中配置API密钥和源站点';
                option.disabled = true;
                modelSelect.appendChild(option);
            }

            // 恢复之前的选择（如果还存在）
            if (currentSelection && [...modelSelect.options].some(opt => opt.value === currentSelection)) {
                modelSelect.value = currentSelection;
            }

            console.log(`[PromptPoolUI] 模型列表填充完成，共 ${modelSelect.options.length} 个选项`);

        } catch (error) {
            console.error('填充可用模型列表失败:', error);
            const errorOption = document.createElement('option');
            errorOption.value = "";
            errorOption.textContent = "加载模型列表失败";
            modelSelect.appendChild(errorOption);
            modelSelect.disabled = true;
        }
    }

    /**
     * 检查指定模型是否有可用的API密钥（简化版本，照抄ui.js）
     */
    hasAvailableKeys(modelName) {
        console.log(`[PromptPoolUI] 检查模型 ${modelName} 的密钥可用性`);

        const keys = typeof loadModelKeys === 'function' ? loadModelKeys(modelName) : [];
        const validKeys = keys.filter(key => key.status === 'valid' || key.status === 'untested' || !key.status);
        const hasKeys = validKeys.length > 0;

        console.log(`[PromptPoolUI] 模型 ${modelName} 密钥检查结果: ${hasKeys}`, keys);
        return hasKeys;
    }

    /**
     * 处理提示词模式切换
     */
    handlePromptModeChange() {
        const selectedMode = document.querySelector('input[name="promptMode"]:checked')?.value;

        // 隐藏所有容器
        document.getElementById('customPromptsContainer')?.classList.add('hidden');
        document.getElementById('promptPoolContainer')?.classList.add('hidden');

        // 显示对应容器
        if (selectedMode === 'custom') {
            document.getElementById('customPromptsContainer')?.classList.remove('hidden');
        } else if (selectedMode === 'pool') {
            document.getElementById('promptPoolContainer')?.classList.remove('hidden');
            this.updateUI();
        }

        // 更新Tabs样式
        const tabMap = {
            builtin: document.getElementById('tabBuiltin'),
            custom: document.getElementById('tabCustom'),
            pool: document.getElementById('tabPool')
        };
        Object.entries(tabMap).forEach(([mode, el]) => {
            if (!el) return;
            if (mode === selectedMode) {
                el.classList.remove('text-gray-500','border-transparent','hover:text-gray-700','hover:border-gray-300');
                el.classList.add('text-blue-600','border-blue-600');
            } else {
                el.classList.remove('text-blue-600','border-blue-600');
                el.classList.add('text-gray-500','border-transparent','hover:text-gray-700','hover:border-gray-300');
            }
        });
    }

    /**
     * 生成提示词变体
     */
    async generateVariations() {
        const generateBtn = document.getElementById('generateVariationsBtn');
        const generateStatus = document.getElementById('generateStatus');
        if (!generateBtn || !generateStatus) return;

        // 获取参数
        const referenceSystemPrompt = document.getElementById('referenceSystemPrompt')?.value?.trim();
        const referenceUserPrompt = document.getElementById('referenceUserPrompt')?.value?.trim();
        const count = parseInt(document.getElementById('variationCount')?.value || '10');
        const similarity = parseFloat(document.getElementById('similarityControl')?.value || '0.6');
        const apiModel = document.getElementById('generationModel')?.value;
        const concurrencyRaw = document.getElementById('generationConcurrency')?.value || '1';
        let concurrency = parseInt(concurrencyRaw, 10);
        if (!Number.isFinite(concurrency) || concurrency < 1) concurrency = 1;
        if (concurrency > 10) concurrency = 10;
        const genLanguage = (document.getElementById('generatorLanguage')?.value || '中文').trim() || '中文';

        // 验证参数
        if (!referenceSystemPrompt || !referenceUserPrompt) {
            this.showNotification('请先填写参考提示词', 'warning');
            return;
        }

        if (!apiModel) {
            this.showNotification('请选择AI模型', 'warning');
            return;
        }

        // 验证占位符
        const targetLangCount = (referenceUserPrompt.match(/\$\{targetLangName\}/g) || []).length;
        const contentCount = (referenceUserPrompt.match(/\$\{content\}/g) || []).length;

        if (targetLangCount !== 1 || contentCount !== 1) {
            this.showNotification('参考用户提示词必须包含且仅包含一次 ${targetLangName} 和 ${content} 占位符', 'error');
            return;
        }

        // 获取API密钥
        let apiKey;
        try {
            apiKey = await this.getApiKeyForModel(apiModel);
            if (!apiKey) {
                this.showNotification(`模型 ${apiModel} 没有可用的API密钥，请先在模型管理中配置`, 'error');
                return;
            }
        } catch (error) {
            this.showNotification(`获取API密钥失败: ${error.message}`, 'error');
            return;
        }

        // 显示生成状态
        generateBtn.disabled = true;
        generateStatus.classList.remove('hidden');
        this.showGenerationProgress(`准备生成：${count} × 并发 ${concurrency}，共计 ${count*concurrency} 个`, 10);

        try {
            // 支持在生成器提示词中使用 ${count} 与 ${genlanguage} 占位符
            let genSysRaw = document.getElementById('generatorSystemPrompt')?.value?.trim();
            let genUserRaw = document.getElementById('generatorUserPrompt')?.value?.trim();
            if (!genSysRaw) genSysRaw = this.buildDefaultGeneratorSystemPrompt();
            if (!genUserRaw) genUserRaw = this.buildDefaultGeneratorUserPrompt();
            const genSys = genSysRaw
                .replace(/\$\{count\}/g, String(count))
                .replace(/\$\{genlanguage\}/g, genLanguage);
            const genUser = genUserRaw
                .replace(/\$\{count\}/g, String(count))
                .replace(/\$\{genlanguage\}/g, genLanguage);

            // 构造并发任务
            const tasks = [];
            let finished = 0;
            let successBatches = 0;
            let failedBatches = 0;
            const collected = [];
            const totalBatches = concurrency;

            const updateBatchProgress = () => {
                finished++;
                const pct = 30 + Math.round((finished / totalBatches) * 50); // 30%~80% 区间
                this.showGenerationProgress(`AI并发生成中... 已完成 ${finished}/${totalBatches} 次`, pct);
            };

            for (let i = 0; i < totalBatches; i++) {
                tasks.push(
                    (async () => {
                        // 轻微抖动，降低同秒触发限流概率
                        await new Promise(r => setTimeout(r, 80 * i));
                        let success = false;
                        let lastErr = null;
                        const maxAttempts = 2;
                        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                            try {
                                const arr = await this.promptPool.generateVariationsWithAI(
                                    referenceSystemPrompt,
                                    referenceUserPrompt,
                                    count,
                                    similarity,
                                    apiModel,
                                    apiKey,
                                    { generatorSystemPrompt: genSys, generatorUserPrompt: genUser }
                                );
                                collected.push(...arr);
                                successBatches++;
                                success = true;
                                break;
                            } catch (err) {
                                lastErr = err;
                                const msg = (err && err.message) ? err.message : '';
                                if (attempt < maxAttempts && /429|rate|Too Many|limit/i.test(msg)) {
                                    // 指数退避 + 抖动
                                    const delay = 400 + Math.floor(Math.random()*400) * attempt;
                                    await new Promise(r => setTimeout(r, delay));
                                    continue;
                                }
                                break;
                            }
                        }
                        if (!success) {
                            console.warn('[PromptPoolUI] 并发批次失败:', lastErr);
                            failedBatches++;
                        }
                        updateBatchProgress();
                    })()
                );
            }

            await Promise.allSettled(tasks);

            // 去重：按 systemPrompt + userPromptTemplate 组合键
            const seen = new Set();
            const unique = [];
            for (const v of collected) {
                const key = `${(v.systemPrompt||'').trim()}||${(v.userPromptTemplate||'').trim()}`;
                if (!seen.has(key)) { seen.add(key); unique.push(v); }
            }

            this.showGenerationProgress('验证并写入结果...', 90);

            // 添加到池中
            this.promptPool.addVariationsToPool(unique);

            // 更新UI
            this.updateUI();

            this.showGenerationProgress('完成！', 100);

            // 成功/失败反馈
            const totalExpected = count * totalBatches;
            const msg = `成功生成 ${unique.length}/${totalExpected} 条；批次成功 ${successBatches}，失败 ${failedBatches}`;
            this.showNotification(msg, failedBatches === 0 ? 'success' : 'warning');

        } catch (error) {
            console.error('AI生成提示词变体失败:', error);
            this.showNotification('生成提示词变体失败：' + error.message, 'error');
        } finally {
            // 恢复按钮状态
            generateBtn.disabled = false;
            generateStatus.classList.add('hidden');
            this.hideGenerationProgress();
        }
    }

    /**
     * 获取指定模型的API密钥（处理自定义源站点的新格式，添加详细调试）
     */
    async getApiKeyForModel(apiModel) {
        try {
            console.log(`[PromptPoolUI] 获取模型 ${apiModel} 的API密钥`);

            let actualModelName = apiModel;

            // 处理自定义源站点的格式: "siteId:modelId"
            if (apiModel.includes(':')) {
                const [siteId, modelId] = apiModel.split(':');
                actualModelName = `custom_source_${siteId}`;
            }

            // 先检查 loadModelKeys 函数是否可用
            if (typeof loadModelKeys !== 'function') {
                console.error(`[PromptPoolUI] loadModelKeys函数不可用`);
                throw new Error('loadModelKeys函数不可用');
            }

            // 调用 loadModelKeys 获取密钥
            const keys = loadModelKeys(actualModelName);

            if (!keys) throw new Error('loadModelKeys返回null/undefined');

            if (!Array.isArray(keys)) throw new Error('loadModelKeys返回的不是数组');

            if (keys.length > 0) {
                // 优先选择已验证有效的密钥
                const validKeys = keys.filter(key => key.status === 'valid');

                if (validKeys.length > 0) {
                    return validKeys[0].value; // 应该是 .value 而不是 .key
                }

                // 如果没有已验证的，选择未测试的
                const untestedKeys = keys.filter(key => key.status === 'untested' || !key.status);

                if (untestedKeys.length > 0) {
                    return untestedKeys[0].value; // 应该是 .value 而不是 .key
                }

                // 如果都没有，返回第一个
                return keys[0].value; // 应该是 .value 而不是 .key
            }

            throw new Error('未找到可用的API密钥');

        } catch (error) {
            console.error(`[PromptPoolUI] 获取模型 ${apiModel} 的API密钥失败:`, error);
            throw error;
        }
    }

    /**
     * 显示生成进度
     */
    showGenerationProgress(message, percentage) {
        // 检查是否已存在进度条，如果没有则创建
        let progressContainer = document.getElementById('promptGenerationProgress');
        if (!progressContainer) {
            progressContainer = document.createElement('div');
            progressContainer.id = 'promptGenerationProgress';
            progressContainer.className = 'fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center p-4';
            progressContainer.innerHTML = `
                <div class="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md">
                    <div class="flex items-center mb-4">
                        <iconify-icon icon="carbon:ai-status" class="text-blue-600 mr-3" width="24"></iconify-icon>
                        <h3 class="text-lg font-semibold">AI生成提示词变体</h3>
                    </div>
                    <div class="mb-4">
                        <div class="flex justify-between text-sm text-gray-700 mb-2">
                            <span id="ppProgressMessage">初始化...</span>
                            <span id="ppProgressPercentage">0%</span>
                        </div>
                        <div class="w-full bg-gray-200 rounded-full h-2">
                            <div id="ppProgressBarFill" class="bg-blue-600 h-2 rounded-full transition-all duration-300" style="width: 0%"></div>
                        </div>
                    </div>
                    <div class="text-xs text-gray-500 text-center">
                        请稍候，AI正在生成同风格改写的提示词...
                    </div>
                </div>
            `;
            document.body.appendChild(progressContainer);
        }

        // 更新进度
        const progressMessage = document.getElementById('ppProgressMessage');
        const progressPercentage = document.getElementById('ppProgressPercentage');
        const progressBarFill = document.getElementById('ppProgressBarFill');

        if (progressMessage) progressMessage.textContent = message;
        if (progressPercentage) progressPercentage.textContent = `${percentage}%`;
        if (progressBarFill) progressBarFill.style.width = `${percentage}%`;
    }

    /**
     * 隐藏生成进度
     */
    hideGenerationProgress() {
        const progressContainer = document.getElementById('promptGenerationProgress');
        if (progressContainer) {
            setTimeout(() => {
                progressContainer.remove();
            }, 1000);
        }
    }

    /**
     * 更新健康状态概览
     */
    updateHealthOverview() {
        if (!this.promptPool) return;

        const stats = this.promptPool.getHealthStats();

        // 更新健康状态计数
        const healthyCountEl = document.getElementById('healthyCount');
        const degradedCountEl = document.getElementById('degradedCount');
        const deactivatedCountEl = document.getElementById('deactivatedCount');
        const successRateEl = document.getElementById('successRate');

        if (healthyCountEl) healthyCountEl.textContent = stats.healthy;
        if (degradedCountEl) degradedCountEl.textContent = stats.degraded;
        if (deactivatedCountEl) deactivatedCountEl.textContent = stats.deactivated;
        if (successRateEl) {
            successRateEl.textContent = `${Math.round(stats.averageSuccessRate * 100)}%`;
        }

        // 更新状态颜色
        if (stats.deactivated > 0) {
            document.getElementById('healthOverview')?.classList.add('border-red-300');
            document.getElementById('healthOverview')?.classList.remove('border-blue-200');
        } else if (stats.degraded > 0) {
            document.getElementById('healthOverview')?.classList.add('border-yellow-300');
            document.getElementById('healthOverview')?.classList.remove('border-blue-200');
        } else {
            document.getElementById('healthOverview')?.classList.remove('border-red-300', 'border-yellow-300');
            document.getElementById('healthOverview')?.classList.add('border-blue-200');
        }
    }

    /**
     * 打开健康设置对话框
     */
    openHealthSettings() {
        const config = this.promptPool.getHealthConfig();

        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center p-4';
        modal.innerHTML = `
            <div class="bg-white rounded-xl shadow-2xl w-full max-w-2xl">
                <div class="flex justify-between items-center p-4 border-b">
                    <h3 class="text-lg font-semibold flex items-center">
                        <iconify-icon icon="carbon:health-cross" class="mr-2 text-blue-600" width="20"></iconify-icon>
                        提示词健康管理设置
                    </h3>
                    <button id="closeHealthSettings" class="text-gray-400 hover:text-red-500">
                        <iconify-icon icon="carbon:close" width="20"></iconify-icon>
                    </button>
                </div>
                <div class="p-4 space-y-4 max-h-[60vh] overflow-y-auto">
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label class="flex items-center">
                                <input type="checkbox" id="deactivationEnabled" ${config.deactivationEnabled ? 'checked' : ''} class="mr-2">
                                <span class="text-sm font-medium">启用失活机制</span>
                            </label>
                            <p class="text-xs text-gray-500 mt-1">连续失败时自动失活提示词</p>
                        </div>
                        <div>
                            <label class="flex items-center">
                                <input type="checkbox" id="switchOnFailure" ${config.switchOnFailure ? 'checked' : ''} class="mr-2">
                                <span class="text-sm font-medium">失败时自动切换</span>
                            </label>
                            <p class="text-xs text-gray-500 mt-1">失败时切换到其他健康提示词</p>
                        </div>
                        <div>
                            <label class="flex items-center">
                                <input type="checkbox" id="resurrectionEnabled" ${config.resurrectionEnabled ? 'checked' : ''} class="mr-2">
                                <span class="text-sm font-medium">启用自动复活</span>
                            </label>
                            <p class="text-xs text-gray-500 mt-1">失活一段时间后自动复活</p>
                        </div>
                        <div>
                            <label class="flex items-center">
                                <input type="checkbox" id="queueManagementEnabled" ${config.queueManagementEnabled ? 'checked' : ''} class="mr-2">
                                <span class="text-sm font-medium">启用队列管理</span>
                            </label>
                            <p class="text-xs text-gray-500 mt-1">替换队列中失败提示词的请求</p>
                        </div>
                    </div>

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">最大连续失败次数</label>
                            <input type="number" id="maxConsecutiveFailures" value="${config.maxConsecutiveFailures}" min="1" max="10" class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
                            <p class="text-xs text-gray-500 mt-1">超过此次数后提示词将被失活</p>
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">复活时间（分钟）</label>
                            <input type="number" id="resurrectionTimeMinutes" value="${config.resurrectionTimeMinutes}" min="1" max="1440" class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
                            <p class="text-xs text-gray-500 mt-1">失活后等待多久自动复活</p>
                        </div>
                    </div>

                    <div class="bg-blue-50 border border-blue-200 rounded-md p-3">
                        <div class="flex items-start">
                            <iconify-icon icon="carbon:information" class="text-blue-500 mr-2 mt-0.5" width="16"></iconify-icon>
                            <div class="text-sm text-blue-800">
                                <p class="font-medium mb-1">智能健康管理说明：</p>
                                <ul class="text-xs space-y-1 text-blue-700">
                                    <li>• 系统会自动跟踪每个提示词的成功率和响应时间</li>
                                    <li>• 连续失败的提示词会被降级或失活，保护翻译质量</li>
                                    <li>• 智能选择模式会根据健康状态分配使用权重</li>
                                    <li>• 失活的提示词会在指定时间后自动复活重新尝试</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="flex justify-end space-x-2 p-4 border-t">
                    <button id="cancelHealthSettings" class="px-4 py-2 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50">取消</button>
                    <button id="saveHealthSettings" class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">保存设置</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // 添加事件监听器
        modal.querySelector('#closeHealthSettings').addEventListener('click', () => {
            modal.remove();
        });
        modal.querySelector('#cancelHealthSettings').addEventListener('click', () => {
            modal.remove();
        });
        modal.querySelector('#saveHealthSettings').addEventListener('click', () => {
            this.saveHealthSettings(modal);
            modal.remove();
        });

        // 点击背景关闭
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
    }

    /**
     * 保存健康设置
     */
    saveHealthSettings(modal) {
        const newConfig = {
            deactivationEnabled: modal.querySelector('#deactivationEnabled').checked,
            switchOnFailure: modal.querySelector('#switchOnFailure').checked,
            resurrectionEnabled: modal.querySelector('#resurrectionEnabled').checked,
            queueManagementEnabled: modal.querySelector('#queueManagementEnabled').checked,
            maxConsecutiveFailures: parseInt(modal.querySelector('#maxConsecutiveFailures').value),
            resurrectionTimeMinutes: parseInt(modal.querySelector('#resurrectionTimeMinutes').value)
        };

        this.promptPool.updateHealthConfig(newConfig);
        this.showNotification('健康管理设置已更新', 'success');
        this.updateHealthOverview();
    }

    /**
     * 更新提示词健康显示
     */
    updateHealthDisplay(promptId) {
        // 更新特定提示词的健康状态显示
        this.updatePromptList();
        this.updateHealthOverview();
    }

    resetFilters() {
        this.searchKeyword = '';
        this.filterHealth = 'all';
        this.sortKey = null;
        this.sortAsc = true;
        this.updatePromptList();
    }

    /**
     * 更新提示词列表显示
     */
    updatePromptList() {
        const container = document.getElementById('promptPoolList');
        if (!container) return;

        // 确保提示词池实例可用
        if (!this.promptPool || typeof this.promptPool.getAllPrompts !== 'function') {
            this.promptPool = (typeof window !== 'undefined') ? window.translationPromptPool : null;
        }
        if (!this.promptPool || typeof this.promptPool.getAllPrompts !== 'function') {
            container.innerHTML = `
                <div class="text-center text-gray-500 text-sm py-8">
                    <iconify-icon icon="carbon:time" class="text-gray-400 mb-2" width="32"></iconify-icon>
                    <p>正在加载提示词池...</p>
                </div>`;
            setTimeout(() => this.updatePromptList(), 400);
            return;
        }

        let prompts = this.promptPool.getAllPrompts() || [];

        // 过滤
        prompts = prompts.filter(p => {
            const h = p.healthStatus || {};
            const status = h.status || 'unknown';
            const healthPass = this.filterHealth === 'all' || status === this.filterHealth;
            if (!healthPass) return false;
            if (!this.searchKeyword) return true;
            const kw = this.searchKeyword.toLowerCase();
            const text = [p.name, p.systemPrompt, p.userPromptTemplate, (p.tags||[]).join(' ')].join(' ').toLowerCase();
            return text.includes(kw);
        });

        // 排序
        const key = this.sortKey;
        if (key) {
            const healthOrder = { healthy: 0, degraded: 1, deactivated: 2, unknown: 3 };
            const asc = this.sortAsc;
            prompts.sort((a, b) => {
                const ha = a.healthStatus || {}; const hb = b.healthStatus || {};
                const sa = ha.status || 'unknown'; const sb = hb.status || 'unknown';
                const ra = (ha.totalRequests>0)? (ha.successCount/ha.totalRequests): -1;
                const rb = (hb.totalRequests>0)? (hb.successCount/hb.totalRequests): -1;
                const va = {
                    name: a.name || '',
                    category: a.category || '',
                    health: healthOrder[sa],
                    success: ra,
                    requests: ha.totalRequests||0,
                    fails: ha.consecutiveFailures||0,
                    avg: ha.averageResponseTime||0,
                    usage: a.usage_count||0,
                    created: Date.parse(a.created_at||0) || 0
                }[key];
                const vb = {
                    name: b.name || '',
                    category: b.category || '',
                    health: healthOrder[sb],
                    success: rb,
                    requests: hb.totalRequests||0,
                    fails: hb.consecutiveFailures||0,
                    avg: hb.averageResponseTime||0,
                    usage: b.usage_count||0,
                    created: Date.parse(b.created_at||0) || 0
                }[key];
                let cmp = 0;
                if (typeof va === 'string' && typeof vb === 'string') cmp = va.localeCompare(vb);
                else cmp = (va===vb)?0:((va>vb)?1:-1);
                return asc ? cmp : -cmp;
            });
        }
        
        const header = `
            <thead class="bg-white sticky top-0 z-10">
                <tr class="text-left text-xs text-gray-500">
                    <th class="px-2 py-2"><input type="checkbox" id="ppSelectAllTop" /></th>
                    <th class="px-2 py-2 cursor-pointer" data-sort="name">名称</th>
                    <th class="px-2 py-2 cursor-pointer" data-sort="category">类别</th>
                    <th class="px-2 py-2 cursor-pointer" data-sort="health">健康</th>
                    <th class="px-2 py-2 cursor-pointer" data-sort="success">成功率</th>
                    <th class="px-2 py-2 cursor-pointer" data-sort="requests">请求</th>
                    <th class="px-2 py-2 cursor-pointer" data-sort="fails">连续失败</th>
                    <th class="px-2 py-2 cursor-pointer" data-sort="avg">平均耗时</th>
                    <th class="px-2 py-2 cursor-pointer" data-sort="usage">使用</th>
                    <th class="px-2 py-2 cursor-pointer" data-sort="created">创建时间</th>
                    <th class="px-2 py-2">操作</th>
                </tr>
            </thead>`;

        const rows = (prompts.length > 0)
            ? prompts.map(p => this.createPromptItemHTML(p)).join('')
            : `<tr><td colspan="11" class="px-3 py-8 text-center text-gray-500">
                   <iconify-icon icon="carbon:ai-status-queued" class="text-gray-400 mb-2" width="24"></iconify-icon>
                   <span>暂无匹配的提示词</span>
                   <button id="ppClearFiltersLink" class="ml-2 text-blue-600 hover:underline text-xs">清除筛选</button>
               </td></tr>`;
        const controls = `
            <div class="flex items-center justify-between mb-2">
                <div class="flex items-center space-x-2">
                    <input id="ppFilterInput" type="text" placeholder="搜索名称/内容/标签" class="text-sm border rounded px-2 py-1 w-56" value="${this.searchKeyword.replace(/"/g,'&quot;')}">
                    <select id="ppHealthFilter" class="text-sm border rounded px-2 py-1">
                        <option value="all" ${this.filterHealth==='all'?'selected':''}>全部</option>
                        <option value="healthy" ${this.filterHealth==='healthy'?'selected':''}>健康</option>
                        <option value="degraded" ${this.filterHealth==='degraded'?'selected':''}>降级</option>
                        <option value="deactivated" ${this.filterHealth==='deactivated'?'selected':''}>失活</option>
                    </select>
                </div>
                <div class="flex items-center space-x-2">
                    <div class="text-xs text-gray-500">共 ${prompts.length} 条</div>
                    <button id="ppClearFilters" class="text-xs px-2 py-1 border rounded hover:bg-gray-50 ${ (this.searchKeyword||this.sortKey||this.filterHealth!=='all') ? '' : 'hidden'}">清除筛选</button>
                </div>
            </div>`;

        const table = `
            ${controls}
            <div class="overflow-auto">
                <table class="min-w-full bg-white rounded-lg">
                    ${header}
                    <tbody class="divide-y divide-gray-100">
                        ${rows}
                    </tbody>
                </table>
            </div>`;

        container.innerHTML = table;

        // 顶部全选
        const selectAll = document.getElementById('ppSelectAllTop');
        if (selectAll) {
            selectAll.addEventListener('change', (e) => {
                const checked = e.target.checked;
                document.querySelectorAll('.prompt-select-checkbox').forEach(cb => {
                    cb.checked = checked; 
                    const id = cb.getAttribute('data-id');
                    if (checked) this.selectedIds.add(id); else this.selectedIds.delete(id);
                });
                this.updateBulkBar();
            });
        }

        // 顶部全选事件已绑定

        // 绑定排序点击
        container.querySelectorAll('th[data-sort]').forEach(th => {
            th.addEventListener('click', () => {
                const k = th.getAttribute('data-sort');
                if (this.sortKey === k) {
                    this.sortAsc = !this.sortAsc;
                } else {
                    this.sortKey = k;
                    this.sortAsc = true;
                }
                this.updatePromptList();
            });
        });

        // 绑定过滤/搜索
        const input = document.getElementById('ppFilterInput');
        if (input) {
            input.addEventListener('input', (e) => {
                this.searchKeyword = e.target.value.trim();
                clearTimeout(this._filterTimer); this._filterTimer = setTimeout(()=>this.updatePromptList(), 150);
            });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') { this.resetFilters(); }
            });
        }
        const sel = document.getElementById('ppHealthFilter');
        if (sel) {
            sel.addEventListener('change', (e) => {
                this.filterHealth = e.target.value;
                this.updatePromptList();
            });
        }

        const clearBtn = document.getElementById('ppClearFilters');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => this.resetFilters());
        }
        const clearLink = document.getElementById('ppClearFiltersLink');
        if (clearLink) {
            clearLink.addEventListener('click', () => this.resetFilters());
        }

        // 添加事件监听器
        this.attachPromptItemListeners();
        this.ensureBulkBar();
        this.updateBulkBar();
    }

    /**
     * 更新UI显示
     */
    updateUI() {
        this.updatePromptList();
        this.updateStats();
        this.updateHealthOverview();
    }

    /**
     * 创建提示词项目的HTML
     */
    createPromptItemHTML(prompt) {
        const isSelected = prompt.userSelected === true;
        const isRejected = prompt.userSelected === false;
        const isUnset = prompt.userSelected === null;
        
        // 健康状态信息
        const health = prompt.healthStatus || {};
        const healthStatus = health.status || 'unknown';
        const successRate = (health.totalRequests > 0)
            ? Math.round((health.successCount / health.totalRequests) * 100)
            : null;
        const successCls = successRate === null ? 'text-gray-500' : (successRate >= 80 ? 'text-green-600' : successRate >= 50 ? 'text-yellow-600' : 'text-red-600');
        const successText = successRate === null ? '-' : `${successRate}%`;
        const avgTime = health.averageResponseTime > 0 ? `${Math.round(health.averageResponseTime / 1000)}s` : '-';
        const healthText = healthStatus === 'healthy' ? '健康' : (healthStatus === 'degraded' ? '降级' : (healthStatus === 'deactivated' ? '失活' : '未知'));

        return `
            <tr class="align-top" data-id="${prompt.id}">
                <td class="px-2 py-2"><input type="checkbox" class="prompt-select-checkbox w-4 h-4" data-id="${prompt.id}" ${this.selectedIds.has(prompt.id) ? 'checked' : ''} /></td>
                <td class="px-2 py-2">
                    <div class="text-gray-800 text-sm font-medium">${prompt.name}</div>
                    <div class="text-xs text-gray-500 mt-0.5">系统: ${this.truncateText(prompt.systemPrompt, 60)}</div>
                    <div class="text-xs text-gray-500">用户: ${this.truncateText(prompt.userPromptTemplate, 60)}</div>
                </td>
                <td class="px-2 py-2"><span class="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded">${prompt.category}</span></td>
                <td class="px-2 py-2 text-xs">${healthText}</td>
                <td class="px-2 py-2 text-xs ${successCls}">${successText}</td>
                <td class="px-2 py-2 text-xs">${health.totalRequests || 0}</td>
                <td class="px-2 py-2 text-xs ${health.consecutiveFailures>0?'text-red-600':''}">${health.consecutiveFailures || 0}</td>
                <td class="px-2 py-2 text-xs">${avgTime}</td>
                <td class="px-2 py-2 text-xs">${prompt.usage_count || 0}</td>
                <td class="px-2 py-2 text-xs">${(prompt.created_at||'').replace('T',' ').replace('Z','')}</td>
                <td class="px-2 py-2">
                    <div class="flex items-center space-x-1">
                        <button class="prompt-select-btn p-1 rounded hover:bg-gray-100 ${healthStatus === 'deactivated' ? 'opacity-50 cursor-not-allowed' : ''}"
                                data-id="${prompt.id}" data-action="select" title="选择使用" ${isSelected || healthStatus === 'deactivated' ? 'style=\"display:none\"' : ''}>
                            <iconify-icon icon="carbon:checkmark" class="text-green-600" width="16"></iconify-icon>
                        </button>
                        <button class="prompt-reject-btn p-1 rounded hover:bg-gray-100" data-id="${prompt.id}" data-action="reject" title="拒绝使用" ${isRejected ? 'style=\"display:none\"' : ''}>
                            <iconify-icon icon="carbon:close" class="text-red-600" width="16"></iconify-icon>
                        </button>
                        ${healthStatus === 'deactivated' ? `
                            <button class="prompt-resurrect-btn p-1 rounded hover:bg-gray-100" data-id="${prompt.id}" data-action="resurrect" title="手动复活">
                                <iconify-icon icon="carbon:restart" class="text-blue-600" width="16"></iconify-icon>
                            </button>
                        ` : ''}
                        <button class="prompt-edit-btn p-1 rounded hover:bg-gray-100" data-id="${prompt.id}" data-action="edit" title="编辑">
                            <iconify-icon icon="carbon:edit" class="text-blue-600" width="16"></iconify-icon>
                        </button>
                        <button class="prompt-delete-btn p-1 rounded hover:bg-gray-100" data-id="${prompt.id}" data-action="delete" title="删除">
                            <iconify-icon icon="carbon:trash-can" class="text-red-600" width="16"></iconify-icon>
                        </button>
                    </div>
                </td>
            </tr>`;
    }

    /**
     * 附加提示词项目的事件监听器
     */
    attachPromptItemListeners() {
        // 多选复选框
        document.querySelectorAll('.prompt-select-checkbox').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const id = e.target.getAttribute('data-id');
                if (e.target.checked) this.selectedIds.add(id); else this.selectedIds.delete(id);
                this.updateBulkBar();
            });
        });
        // 选择按钮
        document.querySelectorAll('.prompt-select-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.handlePromptAction(e, 'select'));
        });

        // 拒绝按钮
        document.querySelectorAll('.prompt-reject-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.handlePromptAction(e, 'reject'));
        });

        // 编辑按钮
        document.querySelectorAll('.prompt-edit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.handlePromptAction(e, 'edit'));
        });

        // 删除按钮
        document.querySelectorAll('.prompt-delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.handlePromptAction(e, 'delete'));
        });

        // 复活按钮
        document.querySelectorAll('.prompt-resurrect-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.handlePromptAction(e, 'resurrect'));
        });
    }

    /**
     * 创建批量操作条（如未存在）
     */
    ensureBulkBar() {
        if (document.getElementById('promptPoolBulkBar')) return;
        const bar = document.createElement('div');
        bar.id = 'promptPoolBulkBar';
        bar.className = 'fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-white border border-gray-200 rounded-xl shadow-lg px-3 py-2 flex items-center space-x-2 hidden';
        bar.innerHTML = `
            <span id="bulkCount" class="text-sm text-gray-700 mr-2">已选 0 项</span>
            <button id="bulkSelectAll" class="text-xs px-2 py-1 border rounded hover:bg-gray-50">全选</button>
            <button id="bulkClear" class="text-xs px-2 py-1 border rounded hover:bg-gray-50">清空</button>
            <span class="mx-2 text-gray-300">|</span>
            <button id="bulkEnable" class="text-xs px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700">批量启用</button>
            <button id="bulkResurrect" class="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700">批量复活</button>
            <button id="bulkDisable" class="text-xs px-2 py-1 bg-yellow-600 text-white rounded hover:bg-yellow-700">批量禁用</button>
            <button id="bulkDelete" class="text-xs px-2 py-1 bg-red-600 text-white rounded hover:bg-red-700">批量删除</button>
        `;
        document.body.appendChild(bar);

        // 绑定事件
        document.getElementById('bulkSelectAll').addEventListener('click', () => {
            document.querySelectorAll('.prompt-select-checkbox').forEach(cb => { cb.checked = true; this.selectedIds.add(cb.getAttribute('data-id')); });
            this.updateBulkBar();
        });
        document.getElementById('bulkClear').addEventListener('click', () => {
            this.selectedIds.clear();
            document.querySelectorAll('.prompt-select-checkbox').forEach(cb => { cb.checked = false; });
            this.updateBulkBar();
        });
        document.getElementById('bulkEnable').addEventListener('click', () => this.handleBulkEnable());
        document.getElementById('bulkResurrect').addEventListener('click', () => this.handleBulkResurrect());
        document.getElementById('bulkDisable').addEventListener('click', () => this.handleBulkDisable());
        document.getElementById('bulkDelete').addEventListener('click', () => this.handleBulkDelete());
    }

    updateBulkBar() {
        const bar = document.getElementById('promptPoolBulkBar');
        if (!bar) return;
        const count = this.selectedIds.size;
        const countEl = document.getElementById('bulkCount');
        if (countEl) countEl.textContent = `已选 ${count} 项`;
        bar.classList.toggle('hidden', count === 0);
    }

    handleBulkEnable() {
        if (this.selectedIds.size === 0) return;
        const ids = Array.from(this.selectedIds);
        if (window.translationPromptPool && typeof window.translationPromptPool.updatePromptItems === 'function') {
            window.translationPromptPool.updatePromptItems(ids, { userSelected: true, isActive: true });
            this.showNotification('批量启用完成', 'success');
            this.updateUI();
        }
    }

    handleBulkResurrect() {
        if (this.selectedIds.size === 0) return;
        const ids = Array.from(this.selectedIds);
        if (window.translationPromptPool && typeof window.translationPromptPool.resurrectPrompts === 'function') {
            window.translationPromptPool.resurrectPrompts(ids);
            this.showNotification('批量复活完成', 'success');
            this.updateUI();
        }
    }

    handleBulkDisable() {
        if (this.selectedIds.size === 0) return;
        const ids = Array.from(this.selectedIds);
        if (window.translationPromptPool && typeof window.translationPromptPool.updatePromptItems === 'function') {
            window.translationPromptPool.updatePromptItems(ids, { userSelected: false, isActive: false });
            this.showNotification('批量禁用完成', 'info');
            this.updateUI();
        }
    }

    handleBulkDelete() {
        if (this.selectedIds.size === 0) return;
        if (!confirm(`确定删除选中的 ${this.selectedIds.size} 个提示词吗？`)) return;
        const ids = Array.from(this.selectedIds);
        if (window.translationPromptPool && typeof window.translationPromptPool.deletePromptItem === 'function') {
            ids.forEach(id => window.translationPromptPool.deletePromptItem(id));
            this.selectedIds.clear();
            this.showNotification('批量删除完成', 'info');
            this.updateUI();
        }
    }

    /**
     * 处理提示词操作
     */
    handlePromptAction(event, action) {
        const id = event.target.closest('[data-id]').dataset.id;

        switch (action) {
            case 'select':
                this.promptPool.updatePromptItem(id, {
                    userSelected: true,
                    isActive: true
                });
                this.showNotification('提示词已选择', 'success');
                break;
            case 'reject':
                this.promptPool.updatePromptItem(id, {
                    userSelected: false,
                    isActive: false
                });
                this.showNotification('提示词已拒绝', 'info');
                break;
            case 'resurrect':
                this.promptPool.resurrectPrompt(id);
                this.showNotification('提示词已手动复活', 'success');
                break;
            case 'edit':
                this.openEditModal(id);
                return;
            case 'delete':
                if (confirm('确定要删除这个提示词吗？')) {
                    this.promptPool.deletePromptItem(id);
                    this.showNotification('提示词已删除', 'info');
                }
                break;
        }

        this.updateUI();
    }

    /**
     * 打开编辑模态框
     */
    openEditModal(id) {
        const prompt = this.promptPool.getAllPrompts().find(p => p.id === id);
        if (!prompt) return;

        this.currentEditingId = id;

        // 创建模态框
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center p-4';
        modal.innerHTML = `
            <div class="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
                <div class="flex justify-between items-center p-4 border-b">
                    <h3 class="text-lg font-semibold">编辑提示词</h3>
                    <button id="closeEditModal" class="text-gray-400 hover:text-red-500">
                        <iconify-icon icon="carbon:close" width="20"></iconify-icon>
                    </button>
                </div>
                <div class="flex-1 overflow-y-auto p-4 space-y-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">名称</label>
                        <input type="text" id="editPromptName" class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500" value="${prompt.name}">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">类别</label>
                        <select id="editPromptCategory" class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500">
                            <option value="academic" ${prompt.category === 'academic' ? 'selected' : ''}>学术</option>
                            <option value="casual" ${prompt.category === 'casual' ? 'selected' : ''}>通俗</option>
                            <option value="technical" ${prompt.category === 'technical' ? 'selected' : ''}>技术</option>
                            <option value="business" ${prompt.category === 'business' ? 'selected' : ''}>商务</option>
                            <option value="literary" ${prompt.category === 'literary' ? 'selected' : ''}>文学</option>
                            <option value="custom" ${!['academic', 'casual', 'technical', 'business', 'literary'].includes(prompt.category) ? 'selected' : ''}>自定义</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">系统提示</label>
                        <textarea id="editSystemPrompt" rows="4" class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500">${prompt.systemPrompt}</textarea>
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">用户提示模板</label>
                        <textarea id="editUserPromptTemplate" rows="6" class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500">${prompt.userPromptTemplate}</textarea>
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">标签 (用空格分隔)</label>
                        <input type="text" id="editPromptTags" class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500" value="${prompt.tags.join(' ')}">
                    </div>
                </div>
                <div class="flex justify-end space-x-2 p-4 border-t">
                    <button id="cancelEdit" class="px-4 py-2 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50">取消</button>
                    <button id="saveEdit" class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">保存</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // 添加事件监听器
        modal.querySelector('#closeEditModal').addEventListener('click', () => this.closeEditModal(modal));
        modal.querySelector('#cancelEdit').addEventListener('click', () => this.closeEditModal(modal));
        modal.querySelector('#saveEdit').addEventListener('click', () => this.saveEdit(modal));

        // 点击背景关闭
        modal.addEventListener('click', (e) => {
            if (e.target === modal) this.closeEditModal(modal);
        });
    }

    /**
     * 关闭编辑模态框
     */
    closeEditModal(modal) {
        modal.remove();
        this.currentEditingId = null;
    }

    /**
     * 保存编辑
     */
    saveEdit(modal) {
        if (!this.currentEditingId) return;

        const updates = {
            name: modal.querySelector('#editPromptName').value,
            category: modal.querySelector('#editPromptCategory').value,
            systemPrompt: modal.querySelector('#editSystemPrompt').value,
            userPromptTemplate: modal.querySelector('#editUserPromptTemplate').value,
            tags: modal.querySelector('#editPromptTags').value.split(' ').filter(tag => tag.trim())
        };

        this.promptPool.updatePromptItem(this.currentEditingId, updates);
        this.updateUI();
        this.closeEditModal(modal);
        this.showNotification('提示词已更新！', 'success');
    }

    /**
     * 更新统计信息
     */
    updateStats() {
        const statsText = document.getElementById('poolStatsText');
        if (!statsText) return;

        const allPrompts = this.promptPool.getAllPrompts();
        const selectedCount = allPrompts.filter(p => p.userSelected === true).length;
        const totalCount = allPrompts.length;

        statsText.textContent = `(${selectedCount} / ${totalCount} 个已选)`;
    }

    /**
     * 清空提示词池
     */
    clearPool() {
        if (!confirm('确定要清空所有提示词吗？此操作不可撤销。')) return;

        this.promptPool.clearPool();
        this.updateUI();
        this.showNotification('提示词池已清空', 'info');
    }

    /**
     * 导出提示词池
     */
    exportPool() {
        const prompts = this.promptPool.getAllPrompts();
        if (prompts.length === 0) {
            this.showNotification('没有提示词可以导出', 'warning');
            return;
        }

        const dataStr = JSON.stringify(prompts, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });

        const link = document.createElement('a');
        link.href = URL.createObjectURL(dataBlob);
        link.download = `prompt-pool-${new Date().toISOString().split('T')[0]}.json`;
        link.click();

        this.showNotification('提示词池已导出', 'success');
    }

    /**
     * 导入提示词池
     */
    importPool() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const prompts = JSON.parse(e.target.result);
                    if (!Array.isArray(prompts)) throw new Error('Invalid format');

                    this.promptPool.addVariationsToPool(prompts);
                    this.updateUI();
                    this.showNotification(`成功导入 ${prompts.length} 个提示词`, 'success');
                } catch (error) {
                    this.showNotification('导入失败：文件格式无效', 'error');
                }
            };
            reader.readAsText(file);
        });
        input.click();
    }

    /**
     * 截断文本
     */
    truncateText(text, maxLength) {
        return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
    }

    /**
     * 显示通知
     */
    showNotification(message, type = 'info') {
        // 简单的通知实现，可以与现有通知系统集成
        const colors = {
            success: 'bg-green-500',
            error: 'bg-red-500',
            warning: 'bg-yellow-500',
            info: 'bg-blue-500'
        };

        const notification = document.createElement('div');
        notification.className = `fixed top-4 right-4 ${colors[type]} text-white px-4 py-2 rounded shadow-lg z-50 transition-opacity`;
        notification.textContent = message;

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.opacity = '0';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    /**
     * 获取当前选择的提示词模式
     */
    getCurrentPromptMode() {
        return document.querySelector('input[name="promptMode"]:checked')?.value || 'builtin';
    }

    /**
     * 获取用于翻译的提示词
     * 根据当前模式返回相应的提示词
     */
    getPromptForTranslation() {
        const mode = this.getCurrentPromptMode();

        switch (mode) {
            case 'custom':
                {
                    const sys = (document.getElementById('defaultSystemPrompt')?.value || '').trim();
                    const usr = (document.getElementById('defaultUserPromptTemplate')?.value || '').trim();
                    // 若自定义为空，则返回 null，让上层回退到内置提示词
                    if (!sys || !usr) return null;
                    return { systemPrompt: sys, userPromptTemplate: usr };
                }
            case 'pool':
                // 会话内固定：处理进行中时锁定首次选择，确保单次处理的一致性
                if (typeof window !== 'undefined' && window.isProcessing && this.sessionLockedPrompt) {
                    return {
                        id: this.sessionLockedPrompt.id,
                        systemPrompt: this.sessionLockedPrompt.systemPrompt,
                        userPromptTemplate: this.sessionLockedPrompt.userPromptTemplate
                    };
                }

                const poolMode = document.getElementById('promptPoolMode')?.value || 'rotation';
                const activePrompt = poolMode === 'random'
                    ? this.promptPool.getRandomActivePrompt()
                    : this.promptPool.getRotationActivePrompt();

                if (typeof window !== 'undefined' && window.isProcessing && activePrompt) {
                    this.sessionLockedPrompt = activePrompt; // 锁定本次会话
                }

                return activePrompt ? {
                    id: activePrompt.id,
                    systemPrompt: activePrompt.systemPrompt,
                    userPromptTemplate: activePrompt.userPromptTemplate
                } : null;
            default:
                return null; // 使用内置提示词
        }
    }

    resetSessionLock() {
        this.sessionLockedPrompt = null;
    }

    breakSessionLockIfMatches(promptId) {
        if (this.sessionLockedPrompt && this.sessionLockedPrompt.id === promptId) {
            this.sessionLockedPrompt = null;
            this.showNotification('当前会话提示词失效，已切换为动态挑选。', 'warning');
        }
    }
}

// 初始化提示词池UI
if (typeof window !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        window.promptPoolUI = new PromptPoolUI();
    });
}

// 导出类
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PromptPoolUI;
}
