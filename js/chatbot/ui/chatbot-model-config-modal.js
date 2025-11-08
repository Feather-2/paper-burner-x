// chatbot/ui/chatbot-model-config-modal.js
// Chatbot 独立模型配置弹窗 UI（无 Tailwind 依赖版本）

(function() {
  'use strict';

  // 预设模型列表
  const PREDEFINED_MODELS = [
    { value: 'mistral', label: 'Mistral Large', description: 'Mistral AI 的旗舰模型', defaultModelId: 'mistral-large-latest' },
    { value: 'deepseek', label: 'DeepSeek', description: 'DeepSeek 对话模型', defaultModelId: 'deepseek-chat' },
    { value: 'gemini', label: 'Google Gemini', description: 'Google 的多模态模型', defaultModelId: 'gemini-1.5-flash' },
    { value: 'tongyi', label: '通义千问', description: '阿里云通义千问', defaultModelId: 'qwen-plus' },
    { value: 'volcano', label: '火山引擎', description: '字节跳动火山引擎', defaultModelId: 'doubao-pro-32k' }
  ];

  /**
   * 检测是否配置了任何预设模型的API密钥
   */
  function checkIfAnyPredefinedModelHasApiKey() {
    try {
      // 检查每个预设模型是否有API密钥
      for (const model of PREDEFINED_MODELS) {
        const modelName = model.value;

        // 使用 loadModelKeys 函数检查是否有可用的密钥
        if (typeof loadModelKeys === 'function') {
          const keys = loadModelKeys(modelName);
          // 检查是否有可用的密钥（valid 或 untested 状态）
          if (keys && Array.isArray(keys) && keys.length > 0) {
            const usableKeys = keys.filter(k => k.status === 'valid' || k.status === 'untested');
            if (usableKeys.length > 0) {
              console.log(`[ChatbotModelConfigModal] 检测到 ${modelName} 有 ${usableKeys.length} 个可用密钥`);
              return true;
            }
          }
        }
      }

      console.log('[ChatbotModelConfigModal] 未检测到任何预设模型的API密钥');
      return false; // 没有任何模型配置API密钥
    } catch (error) {
      console.error('[ChatbotModelConfigModal] 检测API密钥失败:', error);
      return false; // 出错时返回false，显示提示
    }
  }

  /**
   * 创建弹窗HTML
   */
  function createModalHTML() {
    return `
      <div id="chatbot-model-config-modal" class="chatbot-config-modal">
        <!-- 背景遮罩 -->
        <div class="chatbot-config-overlay" id="chatbot-model-config-overlay"></div>

        <!-- 弹窗内容 -->
        <div class="chatbot-config-wrapper">
          <div class="chatbot-config-content">

            <!-- 头部 -->
            <div class="chatbot-config-header">
              <div class="chatbot-config-header-left">
                <div class="chatbot-config-icon">
                  <i class="fa-solid fa-sliders"></i>
                </div>
                <div>
                  <h3 class="chatbot-config-title">AI智能助手 - 模型配置</h3>
                  <p class="chatbot-config-subtitle">独立于翻译模型的配置</p>
                </div>
              </div>
              <button id="chatbot-model-config-close-btn" class="chatbot-config-close-btn">
                <i class="fa-solid fa-xmark" style="font-size: 20px;"></i>
              </button>
            </div>

            <!-- 内容区域 -->
            <div class="chatbot-config-body">

              <!-- 模型来源选择 -->
              <div class="chatbot-source-selector chatbot-config-section">
                <label class="chatbot-source-label">
                  <i class="fa-solid fa-layer-group"></i>
                  模型来源
                </label>
                <div class="chatbot-source-buttons">
                  <button id="chatbot-source-predefined-btn" class="chatbot-source-btn active" data-source="predefined">
                    <i class="fa-solid fa-boxes-stacked"></i>
                    <span>预设模型</span>
                  </button>
                  <button id="chatbot-source-custom-btn" class="chatbot-source-btn" data-source="custom">
                    <i class="fa-solid fa-server"></i>
                    <span>自定义源站点</span>
                  </button>
                </div>
              </div>

              <!-- 预设模型选择区域 -->
              <div id="chatbot-predefined-model-section" class="chatbot-config-section">
                <div class="chatbot-form-group">
                  <label class="chatbot-form-label">
                    <i class="fa-solid fa-robot"></i>
                    选择预设模型
                  </label>
                  <select id="chatbot-predefined-model-select" class="chatbot-form-select">
                    <option value="">-- 请选择模型 --</option>
                  </select>
                  <div id="chatbot-predefined-model-description" class="chatbot-form-description chatbot-hidden">
                    <!-- 模型描述将动态插入 -->
                  </div>

                  <!-- 预设模型信息显示 -->
                  <div id="chatbot-predefined-model-info" class="chatbot-source-info chatbot-hidden">
                    <div class="chatbot-source-info-item">
                      <i class="fa-solid fa-link"></i>
                      <span class="chatbot-source-info-label">API端点:</span>
                      <span id="chatbot-predefined-endpoint" class="chatbot-source-info-value"></span>
                    </div>
                    <div class="chatbot-source-info-item">
                      <i class="fa-solid fa-cog"></i>
                      <span class="chatbot-source-info-label">请求格式:</span>
                      <span id="chatbot-predefined-format" class="chatbot-source-info-value">OpenAI</span>
                    </div>
                  </div>

                  <!-- 无API密钥提示 -->
                  <div id="chatbot-no-api-key-hint" class="chatbot-hint-box chatbot-hidden">
                    <div style="display: flex; align-items: flex-start; gap: 12px;">
                      <i class="fa-solid fa-circle-info" style="color: #3b82f6; font-size: 20px; margin-top: 2px;"></i>
                      <div style="flex: 1;">
                        <div style="font-weight: 600; margin-bottom: 6px; color: #1e293b;">未配置预设模型的API密钥</div>
                        <div style="font-size: 14px; color: #475569; line-height: 1.6; margin-bottom: 10px;">
                          请先在【全局设置】→【翻译模型设置】中配置预设模型（Mistral、DeepSeek、Gemini、通义千问等）的API密钥，然后即可在此选择使用。
                        </div>
                        <button id="chatbot-open-settings-for-api-key-btn" class="chatbot-hint-button" type="button">
                          <i class="fa-solid fa-gear"></i>
                          <span>打开全局设置</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  <!-- 获取模型列表按钮 -->
                  <button id="chatbot-fetch-predefined-models-btn" class="chatbot-fetch-models-btn chatbot-hidden" type="button">
                    <i class="fa-solid fa-rotate"></i>
                    <span>获取可用模型列表</span>
                  </button>
                </div>
              </div>

              <!-- 自定义源站点选择区域 -->
              <div id="chatbot-custom-source-section" class="chatbot-config-section chatbot-hidden">
                <div class="chatbot-form-group">
                  <label class="chatbot-form-label">
                    <i class="fa-solid fa-server"></i>
                    选择源站点
                  </label>
                  <select id="chatbot-custom-source-select" class="chatbot-form-select">
                    <option value="">-- 请选择源站点 --</option>
                  </select>

                  <!-- 无源站点提示 -->
                  <div id="chatbot-no-custom-source-hint" class="chatbot-hint-box chatbot-hidden">
                    <div style="display: flex; align-items: flex-start; gap: 12px;">
                      <i class="fa-solid fa-circle-info" style="color: #3b82f6; font-size: 20px; margin-top: 2px;"></i>
                      <div style="flex: 1;">
                        <div style="font-weight: 600; margin-bottom: 6px; color: #1e293b;">未找到自定义源站点</div>
                        <div style="font-size: 14px; color: #475569; line-height: 1.6; margin-bottom: 10px;">
                          请先在【全局设置】→【自定义源站管理】中添加您的自定义源站点，然后即可在此选择使用。
                        </div>
                        <button id="chatbot-open-global-settings-btn" class="chatbot-hint-button" type="button">
                          <i class="fa-solid fa-gear"></i>
                          <span>打开全局设置</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  <!-- 源站点信息 -->
                  <div id="chatbot-custom-source-info" class="chatbot-source-info chatbot-hidden">
                    <div class="chatbot-source-info-item">
                      <i class="fa-solid fa-link"></i>
                      <span class="chatbot-source-info-label">API端点:</span>
                      <span id="chatbot-source-endpoint" class="chatbot-source-info-value"></span>
                    </div>
                    <div class="chatbot-source-info-item">
                      <i class="fa-solid fa-cog"></i>
                      <span class="chatbot-source-info-label">请求格式:</span>
                      <span id="chatbot-source-format" class="chatbot-source-info-value"></span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 模型ID选择 (支持搜索) -->
              <div id="chatbot-model-id-section" class="chatbot-config-section">
                <div class="chatbot-form-group">
                  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                    <label class="chatbot-form-label" style="margin-bottom: 0;">
                      <i class="fa-solid fa-microchip"></i>
                      模型ID
                      <span style="font-size: 12px; color: #64748b; font-weight: normal;">(可搜索)</span>
                    </label>
                    <button id="chatbot-refresh-models-btn" class="chatbot-refresh-btn chatbot-hidden" type="button" title="刷新模型列表">
                      <i class="fa-solid fa-rotate"></i>
                    </button>
                  </div>

                  <!-- 搜索框 -->
                  <div class="chatbot-search-wrapper">
                    <input
                      type="text"
                      id="chatbot-model-id-search"
                      placeholder="搜索或输入模型ID..."
                      class="chatbot-form-input chatbot-search-input"
                    />
                    <i class="fa-solid fa-magnifying-glass chatbot-search-icon"></i>
                  </div>

                  <!-- 可用模型列表 -->
                  <div id="chatbot-available-models-list" class="chatbot-model-list chatbot-hidden">
                    <!-- 模型列表将动态生成 -->
                  </div>

                  <!-- 或者手动输入 -->
                  <div class="chatbot-text-center" style="margin-top: 12px; font-size: 14px; color: #64748b;">
                    <span>或直接输入自定义模型ID</span>
                  </div>
                </div>
              </div>

              <!-- 参数配置区域 -->
              <div class="chatbot-params-section chatbot-config-section">
                <h4 class="chatbot-params-title">
                  <i class="fa-solid fa-sliders"></i>
                  高级参数
                </h4>

                <!-- 温度 -->
                <div class="chatbot-slider-group">
                  <div class="chatbot-slider-header">
                    <label class="chatbot-slider-label">温度 (Temperature)</label>
                    <span id="chatbot-temperature-value" class="chatbot-slider-value">0.5</span>
                  </div>
                  <input
                    type="range"
                    id="chatbot-temperature-slider"
                    min="0"
                    max="1"
                    step="0.01"
                    value="0.5"
                    class="chatbot-slider"
                  />
                  <div class="chatbot-slider-labels">
                    <span>精确 (0)</span>
                    <span>平衡</span>
                    <span>创造 (1)</span>
                  </div>
                </div>

                <!-- 最大Token -->
                <div class="chatbot-form-group">
                  <label class="chatbot-form-label">最大Token</label>
                  <input
                    type="number"
                    id="chatbot-max-tokens-input"
                    min="100"
                    max="32000"
                    value="8000"
                    class="chatbot-form-input"
                  />
                </div>

                <!-- 并发数 -->
                <div class="chatbot-form-group">
                  <label class="chatbot-form-label">并发上限</label>
                  <input
                    type="number"
                    id="chatbot-concurrency-input"
                    min="1"
                    max="50"
                    value="10"
                    class="chatbot-form-input"
                  />
                </div>
              </div>

            </div>

            <!-- 底部按钮 -->
            <div class="chatbot-config-footer">
              <button id="chatbot-model-config-cancel-btn" class="chatbot-btn chatbot-btn-cancel">
                取消
              </button>
              <button id="chatbot-model-config-save-btn" class="chatbot-btn chatbot-btn-save">
                <i class="fa-solid fa-save"></i>
                保存配置
              </button>
            </div>

          </div>
        </div>
      </div>
    `;
  }

  /**
   * 初始化弹窗
   */
  function initModal() {
    // 检查是否已经存在弹窗
    let modal = document.getElementById('chatbot-model-config-modal');
    if (modal) {
      console.log('[ChatbotModelConfigModal] 弹窗已存在，移除旧的');
      modal.remove();
    }

    // 创建新弹窗
    const modalHTML = createModalHTML();
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // 获取元素引用
    modal = document.getElementById('chatbot-model-config-modal');
    const overlay = document.getElementById('chatbot-model-config-overlay');
    const closeBtn = document.getElementById('chatbot-model-config-close-btn');
    const cancelBtn = document.getElementById('chatbot-model-config-cancel-btn');
    const saveBtn = document.getElementById('chatbot-model-config-save-btn');

    // 绑定关闭事件
    const closeModal = () => {
      modal.classList.remove('active');
    };

    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', closeModal);

    // 初始化预设模型列表
    populatePredefinedModels();

    // 初始化源类型切换
    initSourceTypeSwitch();

    // 初始化模型ID搜索
    initModelIdSearch();

    // 初始化参数控制
    initParameterControls();

    // 初始化保存按钮
    saveBtn.addEventListener('click', saveConfig);

    // 初始化刷新按钮
    const refreshBtn = document.getElementById('chatbot-refresh-models-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        const sourceBtn = document.querySelector('.chatbot-source-btn.active');
        const sourceType = sourceBtn ? sourceBtn.dataset.source : 'predefined';

        if (sourceType === 'predefined') {
          // 刷新预设模型列表
          const modelSelect = document.getElementById('chatbot-predefined-model-select');
          const selectedModel = modelSelect ? modelSelect.value : '';
          if (selectedModel && ['mistral', 'deepseek', 'gemini', 'tongyi'].includes(selectedModel)) {
            fetchPredefinedModels(selectedModel);
          }
        } else {
          // 刷新自定义源站点模型列表
          const sourceSelect = document.getElementById('chatbot-custom-source-select');
          const selectedOption = sourceSelect ? sourceSelect.options[sourceSelect.selectedIndex] : null;
          if (selectedOption && selectedOption.dataset && selectedOption.dataset.site) {
            try {
              const site = JSON.parse(selectedOption.dataset.site);
              loadAvailableModels(site);
            } catch (error) {
              console.error('[ChatbotModelConfigModal] 刷新模型列表失败:', error);
            }
          }
        }
      });
    }

    // 检查是否有全局设置弹窗
    const modelKeyManagerModal = document.getElementById('modelKeyManagerModal');
    const hasGlobalSettings = !!modelKeyManagerModal;

    // 通用函数：打开全局设置弹窗
    const openGlobalSettings = () => {
      // 关闭当前弹窗
      modal.classList.remove('active');

      // 打开 index.html 的模型与Key管理弹窗
      if (modelKeyManagerModal) {
        modelKeyManagerModal.classList.remove('hidden');
      } else {
        console.warn('[ChatbotModelConfigModal] modelKeyManagerModal 元素未找到，可能在详情页面');
        alert('请返回主页面进行设置配置');
      }
    };

    // 初始化"打开全局设置"按钮（自定义源站点的）
    const openSettingsBtn = document.getElementById('chatbot-open-global-settings-btn');
    if (openSettingsBtn) {
      if (hasGlobalSettings) {
        openSettingsBtn.addEventListener('click', openGlobalSettings);
      } else {
        // 如果没有全局设置弹窗，隐藏提示中的按钮
        openSettingsBtn.style.display = 'none';
        // 修改提示文字
        const hintBox = document.getElementById('chatbot-no-custom-source-hint');
        if (hintBox) {
          const hintText = hintBox.querySelector('div[style*="font-size: 14px"]');
          if (hintText) {
            hintText.textContent = '请在主页面的【全局设置】→【自定义源站管理】中添加您的自定义源站点，然后即可在此选择使用。';
          }
        }
      }
    }

    // 初始化"打开全局设置"按钮（预设模型的）
    const openSettingsForApiKeyBtn = document.getElementById('chatbot-open-settings-for-api-key-btn');
    if (openSettingsForApiKeyBtn) {
      if (hasGlobalSettings) {
        openSettingsForApiKeyBtn.addEventListener('click', openGlobalSettings);
      } else {
        // 如果没有全局设置弹窗，隐藏提示中的按钮
        openSettingsForApiKeyBtn.style.display = 'none';
        // 修改提示文字
        const hintBox = document.getElementById('chatbot-no-api-key-hint');
        if (hintBox) {
          const hintText = hintBox.querySelector('div[style*="font-size: 14px"]');
          if (hintText) {
            hintText.textContent = '请在主页面的【全局设置】→【翻译模型设置】中配置预设模型的API密钥，然后即可在此选择使用。';
          }
        }
      }
    }

    console.log('[ChatbotModelConfigModal] 弹窗初始化完成');
  }

  /**
   * 填充预设模型列表
   */
  function populatePredefinedModels() {
    const select = document.getElementById('chatbot-predefined-model-select');
    const fetchBtn = document.getElementById('chatbot-fetch-predefined-models-btn');
    const hintBox = document.getElementById('chatbot-no-api-key-hint');
    if (!select) return;

    // 清空现有选项（保留第一个占位符）
    select.innerHTML = '<option value="">-- 请选择模型 --</option>';

    // 检测是否配置了预设模型的API密钥
    const hasAnyApiKey = checkIfAnyPredefinedModelHasApiKey();
    if (!hasAnyApiKey && hintBox) {
      hintBox.classList.remove('chatbot-hidden');
      select.disabled = true;
    } else {
      if (hintBox) {
        hintBox.classList.add('chatbot-hidden');
      }
      select.disabled = false;
    }

    // 添加预设模型
    PREDEFINED_MODELS.forEach(model => {
      const option = document.createElement('option');
      option.value = model.value;
      option.textContent = model.label;
      option.dataset.description = model.description;
      select.appendChild(option);
    });

    // 监听选择变化
    select.addEventListener('change', (e) => {
      if (!e.target || !e.target.options) {
        console.warn('[ChatbotModelConfigModal] select change: e.target.options 不可用');
        return;
      }

      const selectedIndex = e.target.selectedIndex;
      if (selectedIndex < 0 || selectedIndex >= e.target.options.length) {
        const descEl = document.getElementById('chatbot-predefined-model-description');
        if (descEl) descEl.classList.add('chatbot-hidden');
        hidePredefinedModelInfo();
        if (fetchBtn) fetchBtn.classList.add('chatbot-hidden');
        return;
      }

      const selectedOption = e.target.options[selectedIndex];
      const description = selectedOption && selectedOption.dataset ? selectedOption.dataset.description : null;
      const descEl = document.getElementById('chatbot-predefined-model-description');
      const modelValue = e.target.value;

      if (description && modelValue) {
        descEl.textContent = description;
        descEl.classList.remove('chatbot-hidden');

        // 显示预设模型端点信息
        displayPredefinedModelInfo(modelValue);

        // 显示"获取模型列表"按钮（仅支持的模型）
        if (fetchBtn && ['mistral', 'deepseek', 'gemini', 'tongyi'].includes(modelValue)) {
          fetchBtn.classList.remove('chatbot-hidden');
        } else if (fetchBtn) {
          fetchBtn.classList.add('chatbot-hidden');
        }
      } else {
        if (descEl) descEl.classList.add('chatbot-hidden');
        hidePredefinedModelInfo();
        if (fetchBtn) {
          fetchBtn.classList.add('chatbot-hidden');
        }
      }

      // 清空模型列表（统一使用 chatbot-available-models-list）
      const listDiv = document.getElementById('chatbot-available-models-list');
      if (listDiv) {
        listDiv.innerHTML = '';
        listDiv.classList.add('chatbot-hidden');
      }

      // 清空模型ID搜索框
      const searchInput = document.getElementById('chatbot-model-id-search');
      if (searchInput) {
        searchInput.value = '';
      }

      // 隐藏刷新按钮
      const refreshBtn = document.getElementById('chatbot-refresh-models-btn');
      if (refreshBtn) {
        refreshBtn.classList.add('chatbot-hidden');
      }
    });

    // 绑定"获取模型列表"按钮事件
    if (fetchBtn) {
      fetchBtn.addEventListener('click', () => {
        const selectedModel = select.value;
        if (selectedModel) {
          fetchPredefinedModels(selectedModel);
        }
      });
    }
  }

  /**
   * 初始化源类型切换
   */
  function initSourceTypeSwitch() {
    const predefinedBtn = document.getElementById('chatbot-source-predefined-btn');
    const customBtn = document.getElementById('chatbot-source-custom-btn');
    const predefinedSection = document.getElementById('chatbot-predefined-model-section');
    const customSection = document.getElementById('chatbot-custom-source-section');

    const switchToSource = (sourceType) => {
      // 更新按钮样式
      if (sourceType === 'predefined') {
        predefinedBtn.classList.add('active');
        customBtn.classList.remove('active');

        // 显示/隐藏相应区域
        predefinedSection.classList.remove('chatbot-hidden');
        customSection.classList.add('chatbot-hidden');
      } else {
        customBtn.classList.add('active');
        predefinedBtn.classList.remove('active');

        // 显示/隐藏相应区域
        predefinedSection.classList.add('chatbot-hidden');
        customSection.classList.remove('chatbot-hidden');

        // 加载自定义源站点列表
        loadCustomSourceSites();
      }
    };

    predefinedBtn.addEventListener('click', () => switchToSource('predefined'));
    customBtn.addEventListener('click', () => switchToSource('custom'));

    // 初始化为预设模型
    switchToSource('predefined');
  }

  /**
   * 加载自定义源站点列表
   */
  function loadCustomSourceSites() {
    const select = document.getElementById('chatbot-custom-source-select');
    const hintBox = document.getElementById('chatbot-no-custom-source-hint');
    if (!select) return;

    // 清空现有选项
    select.innerHTML = '<option value="">-- 请选择源站点 --</option>';

    // 获取所有自定义源站点
    const sites = (typeof loadAllCustomSourceSites === 'function')
      ? loadAllCustomSourceSites()
      : {};

    const siteIds = Object.keys(sites);

    if (siteIds.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = '无自定义源站点（请先在设置中添加）';
      select.appendChild(option);
      select.disabled = true;

      // 显示提示框
      if (hintBox) {
        hintBox.classList.remove('chatbot-hidden');
      }
      return;
    }

    select.disabled = false;

    // 隐藏提示框（有源站点）
    if (hintBox) {
      hintBox.classList.add('chatbot-hidden');
    }

    // 添加源站点选项
    siteIds.forEach(id => {
      const site = sites[id];
      const option = document.createElement('option');
      option.value = id;
      option.textContent = site.displayName || `源站点 ${id.substring(0, 8)}...`;
      option.dataset.site = JSON.stringify(site);
      select.appendChild(option);
    });

    // 监听选择变化（使用once: false确保可以重复绑定）
    select.removeEventListener('change', handleCustomSourceChange);
    select.addEventListener('change', handleCustomSourceChange);
  }

  /**
   * 处理自定义源站点选择变化
   */
  function handleCustomSourceChange(e) {
    if (!e.target || !e.target.options) {
      console.warn('[ChatbotModelConfigModal] handleCustomSourceChange: e.target.options 不可用');
      return;
    }

    const selectedIndex = e.target.selectedIndex;
    if (selectedIndex < 0 || selectedIndex >= e.target.options.length) {
      hideSourceSiteInfo();
      return;
    }

    const selectedOption = e.target.options[selectedIndex];
    if (selectedOption && selectedOption.dataset && selectedOption.dataset.site) {
      try {
        const site = JSON.parse(selectedOption.dataset.site);
        displaySourceSiteInfo(site);
        loadAvailableModels(site);
      } catch (error) {
        console.error('[ChatbotModelConfigModal] 解析源站点数据失败:', error);
        hideSourceSiteInfo();
      }
    } else {
      hideSourceSiteInfo();
    }
  }

  /**
   * 显示源站点信息
   */
  function displaySourceSiteInfo(site) {
    const infoDiv = document.getElementById('chatbot-custom-source-info');
    const endpointSpan = document.getElementById('chatbot-source-endpoint');
    const formatSpan = document.getElementById('chatbot-source-format');

    if (site && infoDiv) {
      endpointSpan.textContent = site.apiEndpoint || site.apiBaseUrl || '未知';
      formatSpan.textContent = site.requestFormat || 'OpenAI';
      infoDiv.classList.remove('chatbot-hidden');
    }
  }

  /**
   * 隐藏源站点信息
   */
  function hideSourceSiteInfo() {
    const infoDiv = document.getElementById('chatbot-custom-source-info');
    if (infoDiv) {
      infoDiv.classList.add('chatbot-hidden');
    }
  }

  /**
   * 显示预设模型信息
   */
  function displayPredefinedModelInfo(modelName) {
    const infoDiv = document.getElementById('chatbot-predefined-model-info');
    const endpointSpan = document.getElementById('chatbot-predefined-endpoint');

    if (!infoDiv || !endpointSpan) return;

    // 根据模型名称设置端点
    const endpoints = {
      'mistral': 'https://api.mistral.ai/v1',
      'deepseek': 'https://api.deepseek.com/v1',
      'gemini': 'https://generativelanguage.googleapis.com/v1beta',
      'tongyi': 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      'volcano': '火山引擎 API 端点'
    };

    const endpoint = endpoints[modelName] || '未知';
    endpointSpan.textContent = endpoint;
    infoDiv.classList.remove('chatbot-hidden');
  }

  /**
   * 隐藏预设模型信息
   */
  function hidePredefinedModelInfo() {
    const infoDiv = document.getElementById('chatbot-predefined-model-info');
    if (infoDiv) {
      infoDiv.classList.add('chatbot-hidden');
    }
  }

  /**
   * 获取预设模型的可用模型列表
   */
  async function fetchPredefinedModels(modelName) {
    const fetchBtn = document.getElementById('chatbot-fetch-predefined-models-btn');
    const listDiv = document.getElementById('chatbot-available-models-list'); // 使用统一的列表区域
    const searchInput = document.getElementById('chatbot-model-id-search');
    const refreshBtn = document.getElementById('chatbot-refresh-models-btn');

    if (!fetchBtn || !listDiv) return;

    // 获取对应模型的API Key
    let apiKey = '';
    if (typeof loadModelKeys === 'function') {
      const keys = loadModelKeys(modelName);
      if (keys && Array.isArray(keys)) {
        const usableKeys = keys.filter(k => k.status === 'valid' || k.status === 'untested');
        if (usableKeys.length > 0) {
          apiKey = usableKeys[0].value;
        }
      }
    }

    if (!apiKey) {
      alert(`请先为 ${modelName} 配置有效的 API Key`);
      return;
    }

    // 禁用按钮，显示加载状态
    fetchBtn.disabled = true;
    const originalText = fetchBtn.querySelector('span').textContent;
    fetchBtn.querySelector('span').textContent = '获取中...';

    try {
      let models = [];

      if (modelName === 'mistral') {
        const resp = await fetch('https://api.mistral.ai/v1/models', {
          headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
        const data = await resp.json();
        models = Array.isArray(data.data) ? data.data.map(m => m.id).filter(Boolean) : [];
      } else if (modelName === 'deepseek') {
        const resp = await fetch('https://api.deepseek.com/v1/models', {
          headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
        const data = await resp.json();
        models = Array.isArray(data.data) ? data.data.map(m => m.id).filter(Boolean) : [];
      } else if (modelName === 'gemini') {
        // Gemini API: 使用 Google AI Studio 的 models 端点
        const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
        if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
        const data = await resp.json();
        const items = Array.isArray(data.models || data.data) ? (data.models || data.data) : [];
        // 从 name 字段提取模型 ID (e.g., "models/gemini-1.5-flash" -> "gemini-1.5-flash")
        models = items.map(m => {
          const id = m.name ? String(m.name).split('/').pop() : (m.id || '');
          return id;
        }).filter(Boolean);
      } else if (modelName === 'tongyi') {
        const resp = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/models', {
          headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
        const data = await resp.json();
        const items = Array.isArray(data.data) ? data.data : (Array.isArray(data.models) ? data.models : (Array.isArray(data?.data?.models) ? data.data.models : []));
        models = items.map(m => m.model || m.id || m.name).filter(Boolean);
      }

      if (models.length === 0) {
        listDiv.innerHTML = '<div style="padding: 12px; text-align: center; color: #64748b;">未获取到模型列表</div>';
        listDiv.classList.remove('chatbot-hidden');
        if (refreshBtn) {
          refreshBtn.classList.remove('chatbot-hidden');
        }
        return;
      }

      // 显示模型列表
      loadPredefinedAvailableModels(models, searchInput, listDiv);

      // 显示刷新按钮
      if (refreshBtn) {
        refreshBtn.classList.remove('chatbot-hidden');
      }

      // 自动选择第一个模型
      if (searchInput && models.length > 0) {
        searchInput.value = models[0];
      }

      console.log(`[ChatbotModelConfigModal] 获取到 ${modelName} 的 ${models.length} 个模型`);
    } catch (error) {
      console.error(`[ChatbotModelConfigModal] 获取 ${modelName} 模型列表失败:`, error);
      alert(`获取模型列表失败: ${error.message}`);
      listDiv.innerHTML = '';
      listDiv.classList.add('chatbot-hidden');
      if (refreshBtn) {
        refreshBtn.classList.add('chatbot-hidden');
      }
    } finally {
      fetchBtn.disabled = false;
      fetchBtn.querySelector('span').textContent = originalText;
    }
  }

  /**
   * 加载预设模型的可用模型列表
   */
  function loadPredefinedAvailableModels(models, searchInput, listDiv) {
    if (!listDiv) return;

    // 清空列表
    listDiv.innerHTML = '';

    if (!models || models.length === 0) {
      listDiv.classList.add('chatbot-hidden');
      return;
    }

    listDiv.classList.remove('chatbot-hidden');

    // 生成模型列表项
    models.forEach(modelId => {
      const item = document.createElement('div');
      item.className = 'chatbot-model-item';
      item.textContent = modelId;
      item.dataset.modelId = modelId;

      item.addEventListener('click', () => {
        if (searchInput) {
          searchInput.value = modelId;
        }
        // 高亮选中项
        listDiv.querySelectorAll('.chatbot-model-item').forEach(el => el.classList.remove('selected'));
        item.classList.add('selected');
      });

      listDiv.appendChild(item);
    });

    // 搜索功能
    if (searchInput) {
      const handleSearch = (e) => {
        const query = e.target.value.toLowerCase();
        const items = listDiv.querySelectorAll('.chatbot-model-item');

        let hasVisibleItem = false;

        items.forEach(item => {
          const modelId = (item.dataset.modelId || '').toLowerCase();
          const modelName = (item.textContent || '').toLowerCase();

          if (modelId.includes(query) || modelName.includes(query)) {
            item.classList.remove('chatbot-hidden');
            hasVisibleItem = true;
          } else {
            item.classList.add('chatbot-hidden');
          }
        });

        // 如果有可见项，显示列表；否则隐藏
        if (hasVisibleItem) {
          listDiv.classList.remove('chatbot-hidden');
        } else {
          listDiv.classList.add('chatbot-hidden');
        }
      };

      // 移除之前的监听器（如果有）
      const newSearchInput = searchInput.cloneNode(true);
      searchInput.parentNode.replaceChild(newSearchInput, searchInput);
      newSearchInput.addEventListener('input', handleSearch);
    }
  }

  /**
   * 加载可用模型列表
   */
  function loadAvailableModels(site) {
    const listDiv = document.getElementById('chatbot-available-models-list');
    const searchInput = document.getElementById('chatbot-model-id-search');
    const refreshBtn = document.getElementById('chatbot-refresh-models-btn');
    if (!listDiv) return;

    // 清空现有列表
    listDiv.innerHTML = '';

    if (!site || !site.availableModels || site.availableModels.length === 0) {
      listDiv.classList.add('chatbot-hidden');
      if (refreshBtn) refreshBtn.classList.add('chatbot-hidden');
      return;
    }

    listDiv.classList.remove('chatbot-hidden');
    if (refreshBtn) refreshBtn.classList.remove('chatbot-hidden');

    // 生成模型列表项
    let firstModelId = null;
    site.availableModels.forEach((model, index) => {
      // 处理两种情况：字符串数组或对象数组
      let modelId, modelName;
      if (typeof model === 'string') {
        modelId = model;
        modelName = model;
      } else if (typeof model === 'object' && model !== null) {
        modelId = model.id || model.modelId || model.value || String(model);
        modelName = model.name || model.label || modelId;
      } else {
        return; // 跳过无效项
      }

      // 记录第一个模型ID
      if (index === 0 || firstModelId === null) {
        firstModelId = modelId;
      }

      const item = document.createElement('div');
      item.className = 'chatbot-model-item';
      item.textContent = modelName;
      item.dataset.modelId = modelId;

      item.addEventListener('click', () => {
        if (searchInput) {
          searchInput.value = modelId;
        }
        // 高亮选中项
        listDiv.querySelectorAll('.chatbot-model-item').forEach(d => d.classList.remove('selected'));
        item.classList.add('selected');
      });

      listDiv.appendChild(item);
    });

    // 自动选择第一个模型
    if (firstModelId && searchInput) {
      searchInput.value = firstModelId;
      // 高亮第一个项
      const firstItem = listDiv.querySelector('.chatbot-model-item');
      if (firstItem) {
        firstItem.classList.add('selected');
      }
    }
  }

  /**
   * 初始化模型ID搜索
   */
  function initModelIdSearch() {
    const searchInput = document.getElementById('chatbot-model-id-search');
    const listDiv = document.getElementById('chatbot-available-models-list');

    if (!searchInput || !listDiv) return;

    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase();
      const items = listDiv.querySelectorAll('.chatbot-model-item');

      let hasVisibleItem = false;

      items.forEach(item => {
        const modelId = (item.dataset.modelId || '').toLowerCase();
        const modelName = (item.textContent || '').toLowerCase();
        // 搜索模型ID和显示名称
        if (modelId.includes(query) || modelName.includes(query)) {
          item.classList.remove('chatbot-hidden');
          hasVisibleItem = true;
        } else {
          item.classList.add('chatbot-hidden');
        }
      });

      // 如果有可见项，显示列表；否则隐藏
      if (hasVisibleItem && query) {
        listDiv.classList.remove('chatbot-hidden');
      } else if (!query) {
        // 如果搜索框为空，显示所有项
        items.forEach(item => item.classList.remove('chatbot-hidden'));
        listDiv.classList.remove('chatbot-hidden');
      }
    });
  }

  /**
   * 初始化参数控制
   */
  function initParameterControls() {
    // 温度滑块
    const tempSlider = document.getElementById('chatbot-temperature-slider');
    const tempValue = document.getElementById('chatbot-temperature-value');

    if (tempSlider && tempValue) {
      tempSlider.addEventListener('input', (e) => {
        tempValue.textContent = parseFloat(e.target.value).toFixed(2);
      });
    }
  }

  /**
   * 保存配置
   */
  function saveConfig() {
    const sourceBtn = document.querySelector('.chatbot-source-btn.active');
    const sourceType = sourceBtn ? sourceBtn.dataset.source : 'predefined';

    let config = {
      sourceType: sourceType,
      temperature: parseFloat(document.getElementById('chatbot-temperature-slider').value),
      max_tokens: parseInt(document.getElementById('chatbot-max-tokens-input').value),
      concurrency: parseInt(document.getElementById('chatbot-concurrency-input').value)
    };

    if (sourceType === 'predefined') {
      const modelSelect = document.getElementById('chatbot-predefined-model-select');
      config.model = modelSelect.value;
      config.customSourceSiteId = null;
      // 预设模型也可以有具体的modelId（如果用户获取了模型列表并选择了）
      const modelIdInput = document.getElementById('chatbot-model-id-search');
      config.selectedModelId = modelIdInput ? modelIdInput.value : '';
    } else {
      const sourceSelect = document.getElementById('chatbot-custom-source-select');
      config.model = 'custom';
      config.customSourceSiteId = sourceSelect.value;
      config.selectedModelId = document.getElementById('chatbot-model-id-search').value;
    }

    // 验证配置
    if (sourceType === 'predefined' && !config.model) {
      alert('请选择一个预设模型');
      return;
    }

    if (sourceType === 'custom' && !config.customSourceSiteId) {
      alert('请选择一个自定义源站点');
      return;
    }

    if (sourceType === 'custom' && !config.selectedModelId) {
      alert('请选择或输入一个模型ID');
      return;
    }

    // 保存配置
    if (typeof window !== 'undefined' && window.ChatbotConfigManager) {
      const success = window.ChatbotConfigManager.saveChatbotConfig(config);
      if (success) {
        alert('✓ 配置已保存！');
        closeModalAndRefresh();
      } else {
        alert('× 保存配置失败');
      }
    } else {
      console.error('[ChatbotModelConfigModal] ChatbotConfigManager 不可用');
      alert('× 配置管理器不可用');
    }
  }

  /**
   * 关闭弹窗并刷新
   */
  function closeModalAndRefresh() {
    const modal = document.getElementById('chatbot-model-config-modal');
    if (modal) {
      modal.classList.remove('active');
    }

    // 触发配置更新事件（如果需要通知其他组件）
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('chatbot-config-updated'));
    }
  }

  /**
   * 打开弹窗
   */
  function openModal() {
    const modal = document.getElementById('chatbot-model-config-modal');
    if (!modal) {
      initModal();
    }

    // 加载当前配置
    loadCurrentConfig();

    // 显示弹窗
    const modalEl = document.getElementById('chatbot-model-config-modal');
    if (modalEl) {
      modalEl.classList.add('active');
    }
  }

  /**
   * 加载当前配置到UI
   */
  function loadCurrentConfig() {
    if (typeof window === 'undefined' || !window.ChatbotConfigManager) {
      console.warn('[ChatbotModelConfigModal] ChatbotConfigManager 不可用');
      return;
    }

    try {
      const config = window.ChatbotConfigManager.getChatbotModelConfig();

      // 设置源类型
      const sourceType = config.sourceType || 'predefined';
      const predefinedBtn = document.getElementById('chatbot-source-predefined-btn');
      const customBtn = document.getElementById('chatbot-source-custom-btn');

      if (sourceType === 'predefined') {
        predefinedBtn?.click();

        // 设置预设模型
        const modelSelect = document.getElementById('chatbot-predefined-model-select');
        if (modelSelect && config.model) {
          modelSelect.value = config.model;
          modelSelect.dispatchEvent(new Event('change'));
        }
      } else {
        customBtn?.click();

        // 设置自定义源站点
        const sourceSelect = document.getElementById('chatbot-custom-source-select');
        if (sourceSelect && config.customSourceSiteId) {
          sourceSelect.value = config.customSourceSiteId;
          sourceSelect.dispatchEvent(new Event('change'));
        }

        // 设置模型ID
        const modelIdInput = document.getElementById('chatbot-model-id-search');
        if (modelIdInput && config.selectedModelId) {
          // 确保 selectedModelId 是字符串
          const modelId = typeof config.selectedModelId === 'string'
            ? config.selectedModelId
            : (config.selectedModelId.id || config.selectedModelId.modelId || config.selectedModelId.value || '');
          modelIdInput.value = modelId;
        }
      }

      // 设置参数
      const tempSlider = document.getElementById('chatbot-temperature-slider');
      const tempValue = document.getElementById('chatbot-temperature-value');
      if (tempSlider && config.temperature !== undefined) {
        tempSlider.value = config.temperature;
        if (tempValue) {
          tempValue.textContent = config.temperature.toFixed(2);
        }
      }

      const maxTokensInput = document.getElementById('chatbot-max-tokens-input');
      if (maxTokensInput && config.max_tokens) {
        maxTokensInput.value = config.max_tokens;
      }

      const concurrencyInput = document.getElementById('chatbot-concurrency-input');
      if (concurrencyInput && config.concurrency) {
        concurrencyInput.value = config.concurrency;
      }

      console.log('[ChatbotModelConfigModal] 配置已加载到UI:', config);
    } catch (error) {
      console.error('[ChatbotModelConfigModal] 加载配置失败:', error);
    }
  }

  // 导出到全局
  if (typeof window !== 'undefined') {
    window.ChatbotModelConfigModal = {
      init: initModal,
      open: openModal,
      close: () => {
        const modal = document.getElementById('chatbot-model-config-modal');
        if (modal) modal.classList.remove('active');
      }
    };
  }

  // 页面加载时初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initModal);
  } else {
    initModal();
  }

})();
