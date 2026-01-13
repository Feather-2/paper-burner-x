/**
 * UI 源站点管理模块
 * 处理自定义 API 源站点的管理和配置
 */

(function(window) {
  'use strict';

  // 依赖检查
  const Utils = window.UIConfigUtils || {};
  const escapeHtml = Utils.escapeHtml || ((v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'));
  const escapeAttr = Utils.escapeAttr || escapeHtml;
  const createConfigInput = Utils.createConfigInput || window.createConfigInput;
  const createConfigSelect = Utils.createConfigSelect || window.createConfigSelect;
  const generateUUID = Utils.generateUUID || window._generateUUID_ui;

  // 模块状态
  let currentSelectedSourceSiteId = null;

  /**
   * 获取当前选中的源站点 ID
   * @returns {string|null}
   */
  function getCurrentSelectedSourceSiteId() {
    return currentSelectedSourceSiteId;
  }

  /**
   * 设置当前选中的源站点 ID
   * @param {string|null} id
   */
  function setCurrentSelectedSourceSiteId(id) {
    currentSelectedSourceSiteId = id;
  }

  /**
   * 渲染源站点列表
   */
  function renderSourceSitesList() {
    const sitesListContainer = document.getElementById('sourceSitesListContainer');
    if (!sitesListContainer) return;
    sitesListContainer.innerHTML = '';

    const sites = typeof loadAllCustomSourceSites === 'function' ? loadAllCustomSourceSites() : {};
    const siteIds = Object.keys(sites);

    const keyManagerColumn = document.getElementById('keyManagerColumn');

    if (siteIds.length === 0) {
      sitesListContainer.innerHTML = '<p class="text-sm text-gray-500">还没有自定义源站。请点击上方按钮添加一个。</p>';
      const formContainer = document.getElementById('sourceSiteConfigFormContainer');
      if (formContainer) formContainer.classList.add('hidden');
      if (keyManagerColumn) {
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
        if (keyManagerColumn) {
          keyManagerColumn.innerHTML = '<p class="text-sm text-gray-500">编辑源站配置中。保存或取消以管理 Keys。</p>';
        }
      });

      const deleteButton = document.createElement('button');
      deleteButton.innerHTML = '<iconify-icon icon="carbon:trash-can" width="16"></iconify-icon>';
      deleteButton.title = '删除此源站';
      deleteButton.className = 'p-1.5 text-gray-500 hover:text-red-700 rounded hover:bg-red-100';
      deleteButton.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`确定要删除源站 "${site.displayName || id}" 吗？其关联的API Keys也将被删除。`)) {
          if (typeof deleteCustomSourceSite === 'function') {
            deleteCustomSourceSite(id);
          }
          if (typeof showNotification === 'function') showNotification(`源站 "${site.displayName || id}" 已删除。`, 'success');
          if (currentSelectedSourceSiteId === id) {
            currentSelectedSourceSiteId = null;
            if (keyManagerColumn) {
              keyManagerColumn.innerHTML = '<p class="text-sm text-gray-500">请选择一个源站以管理其 API Keys。</p>';
            }
            const formContainer = document.getElementById('sourceSiteConfigFormContainer');
            if (formContainer) formContainer.classList.add('hidden');
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
      if (typeof window.renderKeyManagerForModel === 'function') {
        window.renderKeyManagerForModel(`custom_source_${currentSelectedSourceSiteId}`);
      }
    } else if (siteIds.length > 0) {
      if (keyManagerColumn) {
        keyManagerColumn.innerHTML = '<p class="text-sm text-gray-500">请选择一个源站以管理其 API Keys。</p>';
      }
      const formContainer = document.getElementById('sourceSiteConfigFormContainer');
      if (formContainer) formContainer.classList.add('hidden');
    }
  }

  /**
   * 选择源站点
   * @param {string} siteId - 源站点 ID
   */
  function selectSourceSite(siteId) {
    currentSelectedSourceSiteId = siteId;
    const sites = typeof loadAllCustomSourceSites === 'function' ? loadAllCustomSourceSites() : {};
    const site = sites[siteId];

    if (site) {
      if (typeof window.renderKeyManagerForModel === 'function') {
        window.renderKeyManagerForModel(`custom_source_${siteId}`);
      }
      const formContainer = document.getElementById('sourceSiteConfigFormContainer');
      if (formContainer) {
        formContainer.classList.add('hidden');
        formContainer.innerHTML = '';
      }
    }
    renderSourceSitesList();
  }

  /**
   * 渲染源站点配置表单
   * @param {Object|null} siteData - 源站点数据（null 表示新建）
   */
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

    const siteIdForForm = isEditing ? siteData.id : generateUUID();

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
    endpointModeHint.textContent = '若第三方已提供完整的 /chat/completions 或 /messages 地址，请选择"已是完整端点"。';
    endpointModeField.appendChild(endpointModeHint);
    form.appendChild(endpointModeField);

    // 模型 ID 输入组
    const modelIdGroup = document.createElement('div');
    modelIdGroup.className = 'mb-3';

    const modelIdLabel = document.createElement('label');
    modelIdLabel.htmlFor = `sourceModelId_${siteIdForForm}`;
    modelIdLabel.className = 'block text-xs font-medium text-gray-600 mb-1';
    modelIdLabel.textContent = '默认模型 ID *';
    modelIdGroup.appendChild(modelIdLabel);

    const modelIdInputContainer = document.createElement('div');
    modelIdInputContainer.id = `sourceModelIdInputContainer_${siteIdForForm}`;
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

    // 临时 API Key 输入
    const tempApiKeyInput = createConfigInput(`sourceTempApiKey_${siteIdForForm}`, 'API Key (检测时使用，可留空)', '', 'password', '如需临时检测可填写 Key', null, {autocomplete: 'new-password'});
    tempApiKeyInput.classList.add('text-xs');
    tempApiKeyInput.querySelector('label').classList.add('text-gray-500');
    tempApiKeyInput.querySelector('input').classList.add('text-xs', 'py-1');
    const tempHint = document.createElement('p');
    tempHint.className = 'mt-1 text-[11px] text-slate-400';
    tempHint.textContent = '如已在下方"API Key"列表中添加 Key，可留空自动使用。';
    tempApiKeyInput.appendChild(tempHint);
    modelIdGroup.appendChild(tempApiKeyInput);

    form.appendChild(modelIdGroup);

    // 检测模型按钮事件
    detectModelsButton.addEventListener('click', async () => {
      const baseUrl = document.getElementById(`sourceApiBaseUrl_${siteIdForForm}`).value.trim();
      let tempApiKey = document.getElementById(`sourceTempApiKey_${siteIdForForm}`).value.trim();
      let usedStoredKey = false;

      if (!baseUrl) {
        if (typeof showNotification === 'function') showNotification('请输入 API Base URL 以检测模型。', 'warning');
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
        if (typeof showNotification === 'function') showNotification('未找到可用的 API Key，请在下方添加或临时输入再检测。', 'warning');
        return;
      }

      detectModelsButton.disabled = true;
      detectModelsButton.innerHTML = '<iconify-icon icon="carbon:circle-dash" class="animate-spin mr-1"></iconify-icon>检测中...';

      const endpointModeSelect = document.getElementById(`sourceEndpointMode_${siteIdForForm}`);
      const requestFormatSelect = document.getElementById(`sourceRequestFormat_${siteIdForForm}`);
      const endpointModeValue = endpointModeSelect ? endpointModeSelect.value : 'auto';
      const requestFormatValue = requestFormatSelect ? requestFormatSelect.value : 'openai';

      try {
        if (!window.modelDetector || typeof window.modelDetector.detectModelsForModal !== 'function') {
          throw new Error('模型检测器未加载');
        }
        const detectedModels = await window.modelDetector.detectModelsForModal(baseUrl, tempApiKey, requestFormatValue, endpointModeValue);
        if (usedStoredKey) {
          if (typeof showNotification === 'function') showNotification('已使用已保存的 Key 进行模型检测。', 'info');
        }
        if (typeof showNotification === 'function') showNotification(`检测到 ${detectedModels.length} 个模型。`, 'success');

        const cacheKey = `custom_source_${siteIdForForm}`;
        if (!detectedModels || detectedModels.length === 0) {
          if (typeof setModelSearchCache === 'function') setModelSearchCache(cacheKey, []);
          searchModelsButton.disabled = true;
          if (typeof showNotification === 'function') {
            showNotification('未返回模型列表，请检查 Base URL 或 API Key。', 'info');
          }
          return;
        }

        const currentModelIdValue = document.getElementById(`sourceModelId_${siteIdForForm}`).value;
        const newSelect = document.createElement('select');
        newSelect.id = `sourceModelId_${siteIdForForm}`;
        newSelect.name = `sourceModelId_${siteIdForForm}`;
        newSelect.className = 'w-full sm:flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors';

        const manualOption = document.createElement('option');
        manualOption.value = "__manual_input__";
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

        const inputContainer = document.getElementById(`sourceModelIdInputContainer_${siteIdForForm}`);
        const oldInput = document.getElementById(`sourceModelId_${siteIdForForm}`);
        inputContainer.insertBefore(newSelect, oldInput);
        if (oldInput) oldInput.remove();
        modelIdEditableElement = newSelect;

        if (typeof setModelSearchCache === 'function') setModelSearchCache(cacheKey, normalized);
        if (typeof registerModelSearchIntegration === 'function') {
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
        }
        searchModelsButton.disabled = false;

        let modelFoundInSelect = false;
        if (currentModelIdValue) {
          const existingOption = Array.from(newSelect.options).find(opt => opt.value === currentModelIdValue);
          if (existingOption) {
            newSelect.value = currentModelIdValue;
            modelFoundInSelect = true;
          }
        }
        if (!modelFoundInSelect && detectedModels.length > 0 && !currentModelIdValue) {
          newSelect.value = detectedModels[0].id;
        } else if (!modelFoundInSelect && currentModelIdValue) {
          newSelect.value = "__manual_input__";
        }

      } catch (error) {
        if (typeof showNotification === 'function') showNotification(`模型检测失败: ${error.message}`, 'error');
        console.error("Model detection error in form:", error);
        if (typeof setModelSearchCache === 'function') setModelSearchCache(`custom_source_${siteIdForForm}`, []);
        searchModelsButton.disabled = true;
      } finally {
        detectModelsButton.disabled = false;
        detectModelsButton.innerHTML = '<iconify-icon icon="carbon:search-locate" class="mr-1"></iconify-icon>检测';
      }
    });

    const requestFormatOptions = [
      { value: 'openai', text: 'OpenAI 格式' },
      { value: 'anthropic', text: 'Anthropic 格式' },
      { value: 'gemini', text: 'Google Gemini 格式' }
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
      const sites = typeof loadAllCustomSourceSites === 'function' ? loadAllCustomSourceSites() : {};
      if (currentSelectedSourceSiteId) {
        selectSourceSite(currentSelectedSourceSiteId);
      } else if (Object.keys(sites).length > 0) {
        selectSourceSite(Object.keys(sites)[0]);
      } else {
        const keyManagerColumn = document.getElementById('keyManagerColumn');
        if (keyManagerColumn) {
          keyManagerColumn.innerHTML = '<p class="text-sm text-gray-500">请选择或添加一个源站以管理其 API Keys。</p>';
        }
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

      if (typeof saveCustomSourceSite === 'function') {
        saveCustomSourceSite(newSiteData);
      }
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

  /**
   * 更新自定义源站点信息面板
   * @param {string} siteId - 源站点 ID
   */
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
        infoContainer.classList.remove('hidden');
        manageKeyBtn.classList.remove('hidden');

        const customSourceKeysCount = typeof loadModelKeys === 'function' ?
          (loadModelKeys(`custom_source_${siteId}`) || []).filter(k => k.status !== 'invalid').length : 0;

        const endpointModeLabels = {
          auto: '自动补全 /v1/... (默认)',
          chat: '仅追加 /chat/completions',
          manual: '完整端点（不自动追加）'
        };
        const endpointModeLabel = endpointModeLabels[site.endpointMode] || endpointModeLabels.auto;

        let infoHtml = `
          <div class="p-3">
            <h3 class="font-bold text-gray-800 text-xl mt-1 mb-2">${escapeHtml(site.displayName || '未命名源站点')}</h3>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
              <div><span class="font-medium">API Base URL:</span> <span class="text-gray-600">${escapeHtml(site.apiBaseUrl || '未设置')}</span></div>
              <div><span class="font-medium">端点补全:</span> <span class="text-gray-600">${escapeHtml(endpointModeLabel)}</span></div>
              <div><span class="font-medium">当前模型:</span> <span id="currentModelPreview_${escapeAttr(siteId)}" class="text-gray-600">${escapeHtml(site.modelId || '未设置')}</span></div>
              <div><span class="font-medium">请求格式:</span> <span class="text-gray-600">${escapeHtml(site.requestFormat || 'openai')}</span></div>
              <div><span class="font-medium">温度:</span> <span class="text-gray-600">${escapeHtml(site.temperature || '0.5')}</span></div>
            </div>
          </div>
        `;

        infoContainer.innerHTML = infoHtml;
        manageKeyBtn.classList.add('hidden');
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
        site.modelId = modelId;

        if (typeof saveCustomSourceSite === 'function') {
          saveCustomSourceSite(site);
          if (typeof showNotification === 'function') {
            showNotification(`已将模型 "${modelId}" 设为源站 "${site.displayName || siteId}" 的默认模型`, 'success');
          }
          updateCustomSourceSiteInfo(siteId);
        } else {
          if (typeof showNotification === 'function') showNotification('保存失败：saveCustomSourceSite 函数不可用', 'error');
        }
      } else {
        if (typeof showNotification === 'function') showNotification(`保存失败：未找到ID为 "${siteId}" 的源站点配置`, 'error');
      }
    } catch (e) {
      console.error('Error saving selected model for site:', e);
      if (typeof showNotification === 'function') showNotification('保存模型ID时发生错误', 'error');
    }
  }

  /**
   * 使用现有API Key检测源站点的可用模型
   * @param {string} siteId - 源站点ID
   * @param {Object} site - 源站点配置对象
   * @param {Array} validKeys - 可用的API Key列表
   */
  async function detectModelsWithExistingKeys(siteId, site, validKeys) {
    let detectBtn = document.getElementById('detectModelsBtn');
    let originalBtnText = detectBtn ? detectBtn.innerHTML : '';

    try {
      if (detectBtn) {
        detectBtn.disabled = true;
        detectBtn.innerHTML = '<iconify-icon icon="carbon:circle-dash" class="animate-spin mr-1"></iconify-icon>检测中...';
      }

      let modelsDetected = [];
      let successfulKey = null;

      const requestFormat = site.requestFormat || 'openai';
      const endpointMode = site.endpointMode || 'auto';

      for (const key of validKeys) {
        try {
          if (typeof showNotification === 'function') {
            showNotification(`正在尝试使用Key (${key.value.substring(0, 4)}...) 检测模型`, 'info');
          }
          if (window.modelDetector && typeof window.modelDetector.detectModelsForSite === 'function') {
            modelsDetected = await window.modelDetector.detectModelsForSite(
              site.apiBaseUrl,
              key.value,
              requestFormat,
              endpointMode
            );
          }

          if (modelsDetected && modelsDetected.length > 0) {
            successfulKey = key;
            break;
          }
        } catch (keyError) {
          console.warn(`Key (${key.value.substring(0, 4)}...) 检测模型失败:`, keyError);
        }
      }

      if (modelsDetected.length === 0) {
        throw new Error('所有Key都无法成功检测到模型');
      }

      site.availableModels = modelsDetected;

      if (!site.modelId && modelsDetected.length > 0) {
        site.modelId = modelsDetected[0].id;
      }

      if (typeof saveCustomSourceSite === 'function') {
        saveCustomSourceSite(site);
        if (typeof showNotification === 'function') {
          showNotification(`已检测到 ${modelsDetected.length} 个可用模型，并已保存到源站点配置`, 'success');
        }
        updateCustomSourceSiteInfo(siteId);
      } else {
        throw new Error('保存配置失败：saveCustomSourceSite 函数不可用');
      }

      if (successfulKey && typeof window.refreshKeyManagerForModel === 'function') {
        window.refreshKeyManagerForModel(`custom_source_${siteId}`, successfulKey.id, 'valid');
      }

    } catch (error) {
      console.error('检测模型失败:', error);
      if (typeof showNotification === 'function') showNotification(`检测模型失败: ${error.message}`, 'error');
    } finally {
      if (detectBtn) {
        detectBtn.disabled = false;
        detectBtn.innerHTML = originalBtnText;
      }
    }
  }

  // 导出到全局作用域
  window.UISourceSites = {
    getCurrentSelectedSourceSiteId,
    setCurrentSelectedSourceSiteId,
    renderSourceSitesList,
    selectSourceSite,
    renderSourceSiteForm,
    updateCustomSourceSiteInfo,
    saveSelectedModelForSite,
    detectModelsWithExistingKeys
  };

  // 兼容旧代码
  window.updateCustomSourceSiteInfo = updateCustomSourceSiteInfo;
  window.selectSourceSite = selectSourceSite;

})(window);

// ESM 导出
export const renderSourceSitesList = window.UISourceSites?.renderSourceSitesList;
export const selectSourceSite = window.UISourceSites?.selectSourceSite;
export const renderSourceSiteForm = window.UISourceSites?.renderSourceSiteForm;
export const updateCustomSourceSiteInfo = window.UISourceSites?.updateCustomSourceSiteInfo;

export default {
  renderSourceSitesList,
  selectSourceSite,
  renderSourceSiteForm,
  updateCustomSourceSiteInfo
};
