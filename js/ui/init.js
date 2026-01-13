/**
 * UI 初始化入口模块
 * 统一初始化所有 UI 组件和事件绑定
 */

(function(window) {
  'use strict';

  // 依赖模块
  const Utils = window.UIConfigUtils || {};
  const ModelConfig = window.UIModelConfigRenderer || {};
  const SourceSites = window.UISourceSites || {};
  const escapeHtml = Utils.escapeHtml || ((v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'));
  const escapeAttr = Utils.escapeAttr || escapeHtml;

  // 模块状态
  let currentManagerUI = null;
  let selectedModelForManager = null;

  /**
   * 主初始化函数
   */
  function initUI() {
    // 自定义模型设置切换
    const customModelSettingsToggle = document.getElementById('customModelSettingsToggle');
    const customModelSettings = document.getElementById('customModelSettings');
    const customModelSettingsToggleIcon = document.getElementById('customModelSettingsToggleIcon');

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

    // 模型管理器变量
    const modelKeyManagerBtn = document.getElementById('modelKeyManagerBtn');
    const modelKeyManagerModal = document.getElementById('modelKeyManagerModal');
    const closeModelKeyManager = document.getElementById('closeModelKeyManager');
    const modelListColumn = document.getElementById('modelListColumn');
    const modelConfigColumn = document.getElementById('modelConfigColumn');
    const keyManagerColumn = document.getElementById('keyManagerColumn');

    const supportedModelsForKeyManager = window.supportedModelsForKeyManager || [];

    /**
     * 选择模型用于管理器
     * @param {string} modelKey
     */
    function selectModelForManager(modelKey) {
      if (window.modelManager) {
        window.modelManager.selectModel(modelKey);
        selectedModelForManager = window.modelManager.getSelectedModel();
      }
      if (SourceSites.setCurrentSelectedSourceSiteId) {
        SourceSites.setCurrentSelectedSourceSiteId(null);
      }
    }

    /**
     * 渲染模型配置区域
     * @param {string} modelKey
     */
    function renderModelConfigSection(modelKey) {
      if (!modelConfigColumn) return;
      modelConfigColumn.innerHTML = '';
      const modelDefinition = supportedModelsForKeyManager.find(m => m.key === modelKey);
      if (!modelDefinition) return;

      const title = document.createElement('h3');
      title.className = 'text-lg font-semibold mb-3 text-gray-800';
      modelConfigColumn.appendChild(title);

      if (modelKey === 'custom') {
        title.textContent = '自定义源站管理';

        const addNewButton = document.createElement('button');
        addNewButton.id = 'addNewSourceSiteBtn';
        addNewButton.innerHTML = '<iconify-icon icon="carbon:add-filled" class="mr-2"></iconify-icon>添加新源站';
        addNewButton.className = 'mb-4 px-3 py-1.5 text-sm bg-green-500 hover:bg-green-600 text-white rounded transition-colors flex items-center';
        addNewButton.addEventListener('click', () => {
          if (SourceSites.setCurrentSelectedSourceSiteId) {
            SourceSites.setCurrentSelectedSourceSiteId(null);
          }
          if (SourceSites.renderSourceSitesList) {
            SourceSites.renderSourceSitesList();
          }
          if (SourceSites.renderSourceSiteForm) {
            SourceSites.renderSourceSiteForm(null);
          }
        });
        modelConfigColumn.appendChild(addNewButton);

        const sitesListContainer = document.createElement('div');
        sitesListContainer.id = 'sourceSitesListContainer';
        modelConfigColumn.appendChild(sitesListContainer);

        const siteConfigFormContainer = document.createElement('div');
        siteConfigFormContainer.id = 'sourceSiteConfigFormContainer';
        siteConfigFormContainer.className = 'mt-4 p-4 border border-gray-200 rounded-md hidden';
        modelConfigColumn.appendChild(siteConfigFormContainer);

        if (SourceSites.renderSourceSitesList) {
          SourceSites.renderSourceSitesList();
        }

        const sites = typeof loadAllCustomSourceSites === 'function' ? loadAllCustomSourceSites() : {};
        const currentId = SourceSites.getCurrentSelectedSourceSiteId ? SourceSites.getCurrentSelectedSourceSiteId() : null;

        if (!currentId && Object.keys(sites).length === 0) {
          keyManagerColumn.innerHTML = '<p class="text-sm text-gray-500">请添加并选择一个源站以管理其 API Keys。</p>';
        } else if (!currentId) {
          keyManagerColumn.innerHTML = '<p class="text-sm text-gray-500">请从上方列表选择一个源站以管理其 API Keys。</p>';
        }

      } else if (modelKey === 'embedding') {
        title.textContent = '向量搜索与重排 - 配置';
        if (window.UIEmbeddingConfigRenderer && window.UIEmbeddingConfigRenderer.renderEmbeddingConfig) {
          window.UIEmbeddingConfigRenderer.renderEmbeddingConfig(modelConfigColumn);
        }
      } else if (modelKey === 'academicSearch') {
        title.textContent = '学术搜索与代理 - 配置';
        if (ModelConfig.renderAcademicSearchConfig) {
          ModelConfig.renderAcademicSearchConfig(modelConfigColumn);
        }
      } else if (modelKey === 'mistral') {
        title.textContent = `${modelDefinition.name} - 配置`;
        if (window.UIModelOcrConfigRenderer && window.UIModelOcrConfigRenderer.renderMistralOcrConfig) {
          window.UIModelOcrConfigRenderer.renderMistralOcrConfig(modelConfigColumn);
        }
      } else if (modelKey === 'mineru') {
        title.textContent = `${modelDefinition.name} - 配置`;
        if (window.UIModelOcrConfigRenderer && window.UIModelOcrConfigRenderer.renderMinerUConfig) {
          window.UIModelOcrConfigRenderer.renderMinerUConfig(modelConfigColumn);
        }
      } else if (modelKey === 'doc2x') {
        title.textContent = `${modelDefinition.name} - 配置`;
        if (window.UIModelOcrConfigRenderer && window.UIModelOcrConfigRenderer.renderDoc2XConfig) {
          window.UIModelOcrConfigRenderer.renderDoc2XConfig(modelConfigColumn);
        }
      } else if (modelKey === 'gemini-image') {
        title.textContent = `${modelDefinition.name} - 配置`;
        if (ModelConfig.renderGeminiImageConfig) {
          ModelConfig.renderGeminiImageConfig(modelConfigColumn);
        }
      } else if (modelKey === 'image') {
        title.textContent = `${modelDefinition.name} - 配置`;
        if (ModelConfig.renderGenericImageConfig) {
          ModelConfig.renderGenericImageConfig(modelConfigColumn);
        }
      } else {
        title.textContent = `${modelDefinition.name} - 配置`;
      }
    }

    // 导出到全局
    window.renderModelConfigSection = renderModelConfigSection;
    window.selectModelForManager = selectModelForManager;

    // 初始化模型管理器模块
    if (window.modelManager) {
      window.modelManager.init({
        modelKeyManagerBtn,
        modelKeyManagerModal,
        closeModelKeyManager,
        modelListColumn,
        modelConfigColumn,
        keyManagerColumn
      });
    }

    /**
     * 渲染 Key 管理器
     * @param {string} modelKeyOrSourceSiteModelName
     */
    function renderKeyManagerForModel(modelKeyOrSourceSiteModelName) {
      if (!keyManagerColumn) return;
      keyManagerColumn.innerHTML = '';
      if (currentManagerUI && typeof currentManagerUI.destroy === 'function') {
        currentManagerUI.destroy();
      }

      if (typeof KeyManagerUI === 'function') {
        currentManagerUI = new KeyManagerUI(
          modelKeyOrSourceSiteModelName,
          keyManagerColumn,
          handleTestKey,
          handleTestAllKeys,
          typeof loadModelKeys === 'function' ? loadModelKeys : () => [],
          typeof saveModelKeys === 'function' ? saveModelKeys : () => {}
        );
      }

      // 特定模型的额外面板
      renderModelSpecificPanels(modelKeyOrSourceSiteModelName);
    }

    /**
     * 渲染模型特定的检测面板
     * @param {string} modelName
     */
    function renderModelSpecificPanels(modelName) {
      if (modelName === 'gemini') {
        renderGeminiDetectionPanel();
      } else if (modelName === 'deepseek') {
        renderDeepseekDetectionPanel();
      } else if (modelName === 'tongyi') {
        renderTongyiDetectionPanel();
      } else if (modelName === 'volcano') {
        renderVolcanoManualPanel();
      } else if (modelName === 'deeplx') {
        renderDeeplxEndpointPanel();
      }
    }

    /**
     * 渲染 Gemini 检测面板
     */
    function renderGeminiDetectionPanel() {
      const panel = document.createElement('div');
      panel.className = 'mt-4 p-3 border rounded-md bg-blue-50';
      panel.innerHTML = `
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div class="text-sm text-blue-800 font-medium">Gemini 可用模型检测</div>
          <button id="detectGeminiModelsBtn" class="px-2 py-1 text-xs border rounded hover:bg-white w-full sm:w-auto">检测</button>
        </div>
        <div id="geminiModelsArea" class="mt-2 text-sm text-gray-700 space-y-2">
          <span class="text-gray-500">点击"检测"从 Google API 拉取模型列表</span>
        </div>
      `;
      keyManagerColumn.appendChild(panel);

      const detectBtn = panel.querySelector('#detectGeminiModelsBtn');
      const area = panel.querySelector('#geminiModelsArea');

      detectBtn.onclick = async () => {
        const keys = (typeof loadModelKeys === 'function' ? loadModelKeys('gemini') : []) || [];
        const validKeys = keys.filter(k => k.status !== 'invalid' && k.value);
        if (validKeys.length === 0) {
          area.innerHTML = '<span class="text-red-600">无可用 Gemini API Key</span>';
          return;
        }
        const apiKey = validKeys[0].value.trim();
        detectBtn.disabled = true;
        detectBtn.textContent = '检测中...';

        try {
          const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
          if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
          const data = await resp.json();
          const items = Array.isArray(data.models || data.data) ? (data.models || data.data) : [];
          if (items.length === 0) {
            area.innerHTML = '<span class="text-gray-500">未返回模型列表</span>';
            return;
          }

          const select = document.createElement('select');
          select.className = 'mt-2 w-full sm:flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-sm';

          items.forEach(m => {
            const id = m.name ? String(m.name).split('/').pop() : (m.id || '');
            if (!id) return;
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = id;
            select.appendChild(opt);
          });

          const saveBtn = document.createElement('button');
          saveBtn.className = 'mt-2 px-3 py-1.5 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded w-full sm:w-auto';
          saveBtn.textContent = '设为默认模型';
          saveBtn.onclick = () => {
            if (typeof saveModelConfig === 'function') {
              saveModelConfig('gemini', { preferredModelId: select.value });
            }
            if (typeof showNotification === 'function') showNotification(`Gemini 默认模型已设为 ${select.value}`, 'success');
          };

          area.innerHTML = '';
          const controls = document.createElement('div');
          controls.className = 'mt-2 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center gap-2';
          controls.appendChild(select);
          controls.appendChild(saveBtn);
          area.appendChild(controls);
        } catch (e) {
          console.error(e);
          area.innerHTML = `<span class="text-red-600">检测失败: ${e.message}</span>`;
        } finally {
          detectBtn.disabled = false;
          detectBtn.textContent = '检测';
        }
      };
    }

    /**
     * 渲染 DeepSeek 检测面板
     */
    function renderDeepseekDetectionPanel() {
      const panel = document.createElement('div');
      panel.className = 'mt-4 p-3 border rounded-md bg-blue-50';
      panel.innerHTML = `
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div class="text-sm text-blue-800 font-medium">DeepSeek 可用模型检测</div>
          <button id="detectDeepseekModelsBtn" class="px-2 py-1 text-xs border rounded hover:bg-white w-full sm:w-auto">检测</button>
        </div>
        <div id="deepseekModelsArea" class="mt-2 text-sm text-gray-700 space-y-2">
          <span class="text-gray-500">点击"检测"从 DeepSeek API 拉取模型列表</span>
        </div>
      `;
      keyManagerColumn.appendChild(panel);

      const detectBtn = panel.querySelector('#detectDeepseekModelsBtn');
      const area = panel.querySelector('#deepseekModelsArea');

      detectBtn.onclick = async () => {
        const keys = (typeof loadModelKeys === 'function' ? loadModelKeys('deepseek') : []) || [];
        const validKeys = keys.filter(k => k.status !== 'invalid' && k.value);
        if (validKeys.length === 0) {
          area.innerHTML = '<span class="text-red-600">无可用 DeepSeek API Key</span>';
          return;
        }
        const apiKey = validKeys[0].value.trim();
        detectBtn.disabled = true;
        detectBtn.textContent = '检测中...';

        try {
          const resp = await fetch('https://api.deepseek.com/v1/models', {
            headers: { 'Authorization': `Bearer ${apiKey}` }
          });
          if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
          const data = await resp.json();
          const items = Array.isArray(data.data) ? data.data : [];
          if (items.length === 0) {
            area.innerHTML = '<span class="text-gray-500">未返回模型列表</span>';
            return;
          }

          const select = document.createElement('select');
          select.className = 'mt-2 w-full sm:flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-sm';

          items.forEach(m => {
            const id = m.id;
            if (!id) return;
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = id;
            select.appendChild(opt);
          });

          const saveBtn = document.createElement('button');
          saveBtn.className = 'mt-2 px-3 py-1.5 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded w-full sm:w-auto';
          saveBtn.textContent = '设为默认模型';
          saveBtn.onclick = () => {
            if (typeof saveModelConfig === 'function') {
              saveModelConfig('deepseek', { preferredModelId: select.value });
            }
            if (typeof showNotification === 'function') showNotification(`DeepSeek 默认模型已设为 ${select.value}`, 'success');
          };

          area.innerHTML = '';
          const controls = document.createElement('div');
          controls.className = 'mt-2 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center gap-2';
          controls.appendChild(select);
          controls.appendChild(saveBtn);
          area.appendChild(controls);
        } catch (e) {
          console.error(e);
          area.innerHTML = `<span class="text-red-600">检测失败: ${e.message}</span>`;
        } finally {
          detectBtn.disabled = false;
          detectBtn.textContent = '检测';
        }
      };
    }

    /**
     * 渲染通义检测面板
     */
    function renderTongyiDetectionPanel() {
      const panel = document.createElement('div');
      panel.className = 'mt-4 p-3 border rounded-md bg-blue-50';
      panel.innerHTML = `
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div class="text-sm text-blue-800 font-medium">通义 可用模型检测</div>
          <button id="detectTongyiModelsBtn" class="px-2 py-1 text-xs border rounded hover:bg-white w-full sm:w-auto">检测</button>
        </div>
        <div id="tongyiModelsArea" class="mt-2 text-sm text-gray-700 space-y-2">
          <span class="text-gray-500">点击"检测"从 DashScope API 拉取模型列表</span>
        </div>
      `;
      keyManagerColumn.appendChild(panel);

      const detectBtn = panel.querySelector('#detectTongyiModelsBtn');
      const area = panel.querySelector('#tongyiModelsArea');

      detectBtn.onclick = async () => {
        const keys = (typeof loadModelKeys === 'function' ? loadModelKeys('tongyi') : []) || [];
        const validKeys = keys.filter(k => k.status !== 'invalid' && k.value);
        if (validKeys.length === 0) {
          area.innerHTML = '<span class="text-red-600">无可用 通义 API Key</span>';
          return;
        }
        const apiKey = validKeys[0].value.trim();
        detectBtn.disabled = true;
        detectBtn.textContent = '检测中...';

        try {
          const resp = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/models', {
            headers: { 'Authorization': `Bearer ${apiKey}` }
          });
          if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
          const data = await resp.json();
          const items = Array.isArray(data.data) ? data.data : [];
          if (items.length === 0) {
            area.innerHTML = '<span class="text-gray-500">未返回模型列表</span>';
            return;
          }

          const select = document.createElement('select');
          select.className = 'mt-2 w-full sm:flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-sm';

          items.forEach(m => {
            const id = m.model || m.id || m.name;
            if (!id) return;
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = id;
            select.appendChild(opt);
          });

          const saveBtn = document.createElement('button');
          saveBtn.className = 'mt-2 px-3 py-1.5 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded w-full sm:w-auto';
          saveBtn.textContent = '设为默认模型';
          saveBtn.onclick = () => {
            if (typeof saveModelConfig === 'function') {
              saveModelConfig('tongyi', { preferredModelId: select.value });
            }
            if (typeof showNotification === 'function') showNotification(`通义 默认模型已设为 ${select.value}`, 'success');
          };

          area.innerHTML = '';
          const controls = document.createElement('div');
          controls.className = 'mt-2 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center gap-2';
          controls.appendChild(select);
          controls.appendChild(saveBtn);
          area.appendChild(controls);
        } catch (e) {
          console.error(e);
          area.innerHTML = `<span class="text-red-600">检测失败: ${e.message}</span>`;
        } finally {
          detectBtn.disabled = false;
          detectBtn.textContent = '检测';
        }
      };
    }

    /**
     * 渲染火山手动输入面板
     */
    function renderVolcanoManualPanel() {
      const panel = document.createElement('div');
      panel.className = 'mt-4 p-3 border rounded-md bg-blue-50';
      panel.innerHTML = `
        <div class="text-sm text-blue-800 font-medium mb-2">火山 模型设置</div>
        <div class="flex items-center gap-2">
          <input id="volcanoKMManualInput" type="text" class="w-full sm:flex-grow px-3 py-1.5 border border-gray-300 rounded-md text-sm" placeholder="例如：doubao-1-5-pro-32k-250115">
          <button id="volcanoKMSaveBtn" class="px-4 py-1.5 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded whitespace-nowrap">设为默认</button>
        </div>
        <div class="mt-1 text-xs text-gray-600">不提供在线检测；请手动输入模型ID。</div>
      `;
      keyManagerColumn.appendChild(panel);

      const input = panel.querySelector('#volcanoKMManualInput');
      const saveBtn = panel.querySelector('#volcanoKMSaveBtn');

      try {
        const cfg = typeof loadModelConfig === 'function' ? loadModelConfig('volcano') : null;
        if (cfg && (cfg.preferredModelId || cfg.modelId)) {
          input.value = cfg.preferredModelId || cfg.modelId;
        }
      } catch (e) {}

      saveBtn.onclick = () => {
        const val = (input.value || '').trim();
        if (!val) {
          if (typeof showNotification === 'function') showNotification('请输入模型ID', 'warning');
          return;
        }
        if (typeof saveModelConfig === 'function') {
          saveModelConfig('volcano', { preferredModelId: val });
        }
        if (typeof showNotification === 'function') showNotification(`火山 默认模型已设为 ${val}`, 'success');
      };
    }

    /**
     * 渲染 DeepLX 端点面板
     */
    function renderDeeplxEndpointPanel() {
      const DEEPLX_DEFAULT_ENDPOINT_TEMPLATE = typeof window.DEEPLX_DEFAULT_ENDPOINT_TEMPLATE !== 'undefined'
        ? window.DEEPLX_DEFAULT_ENDPOINT_TEMPLATE
        : 'https://api.deeplx.org/<api-key>/translate';

      const panel = document.createElement('div');
      panel.className = 'mt-4 p-3 border rounded-md bg-blue-50';
      const placeholderHtml = escapeHtml(DEEPLX_DEFAULT_ENDPOINT_TEMPLATE);
      panel.innerHTML = `
        <div class="text-sm text-blue-800 font-medium mb-2">DeepLX 接口模板</div>
        <div class="flex items-center gap-2">
          <input id="deeplxEndpointTemplateInput-manager" type="text" class="flex-1 px-3 py-1.5 border border-blue-200 rounded-md text-sm" placeholder="${placeholderHtml}">
          <button id="deeplxEndpointResetBtn-manager" type="button" class="px-2 py-1 text-xs border border-blue-300 rounded hover:bg-white">恢复默认</button>
        </div>
        <p class="mt-2 text-xs text-blue-900 leading-5">模板中的 &lt;api-key&gt; 或 {API_KEY} 会自动替换为当前使用的 Key。</p>
      `;
      keyManagerColumn.appendChild(panel);

      const inputEl = panel.querySelector('#deeplxEndpointTemplateInput-manager');
      const resetBtn = panel.querySelector('#deeplxEndpointResetBtn-manager');

      if (typeof setupDeeplxEndpointInput === 'function') {
        setupDeeplxEndpointInput(inputEl, resetBtn);
      }
    }

    /**
     * 测试单个 Key
     * @param {string} modelName
     * @param {Object} keyObject
     */
    async function handleTestKey(modelName, keyObject) {
      if (!currentManagerUI) return;
      currentManagerUI.updateKeyStatus(keyObject.id, 'testing');

      let modelConfigForTest = {};
      let apiEndpointForTest = null;
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
        const allSites = typeof loadAllCustomSourceSites === 'function' ? loadAllCustomSourceSites() : {};
        const siteConfig = allSites[sourceSiteId];
        if (siteConfig && siteConfig.apiBaseUrl && siteConfig.modelId) {
          apiEndpointForTest = siteConfig.apiBaseUrl;
          modelConfigForTest = {
            ...siteConfig,
            apiEndpoint: siteConfig.apiBaseUrl
          };
        } else {
          currentManagerUI.updateKeyStatus(keyObject.id, 'untested');
          if (typeof showNotification === 'function') {
            showNotification(`源站配置不完整 (ID: ${sourceSiteId})，缺少 API Base URL 或模型 ID。请在配置区完善。`, 'error');
          }
          return;
        }
      } else {
        modelConfigForTest = typeof loadModelConfig === 'function' ? (loadModelConfig(modelName) || {}) : {};
        apiEndpointForTest = modelConfigForTest.apiEndpoint;
      }

      try {
        let isValid = false;
        if (modelName === 'mistral') {
          try {
            const resp = await fetch('https://api.mistral.ai/v1/models', {
              headers: { 'Authorization': `Bearer ${keyObject.value}` }
            });
            isValid = resp.ok;
          } catch (e) {
            isValid = false;
          }
        } else if (['gemini-image', 'image', 'openai-image', 'sora-image', 'jimeng-image'].includes(modelName)) {
          if (typeof window.ImageGeneration !== 'undefined' && typeof window.ImageGeneration.generateImage === 'function') {
            const cfg = modelConfigForTest || {};
            const modelId = cfg.modelId || (modelName === 'gemini-image' ? 'gemini-2.5-flash-image' : 'gpt-image-1');
            try {
              await window.ImageGeneration.generateImage({
                provider: modelName,
                model: modelId,
                prompt: 'health check image',
                width: 512,
                height: 512,
                maxKB: 400,
                apiKey: keyObject.value
              });
              isValid = true;
            } catch (e) {
              console.warn('Image model key test failed:', e);
              isValid = false;
            }
          } else {
            isValid = false;
          }
        } else {
          if (typeof testModelKey === 'function') {
            const r = await testModelKey(modelName, keyObject.value, modelConfigForTest, apiEndpointForTest);
            isValid = !!r;
          }
        }
        currentManagerUI.updateKeyStatus(keyObject.id, isValid ? 'valid' : 'invalid');
        if (typeof showNotification === 'function') {
          showNotification(`Key (${keyObject.value.substring(0,4)}...) for ${modelDisplayNameForNotification} test: ${isValid ? '有效' : '无效'}`, isValid ? 'success' : 'error');
        }
      } catch (error) {
        console.error("Key test error:", error);
        currentManagerUI.updateKeyStatus(keyObject.id, 'invalid');
        if (typeof showNotification === 'function') {
          showNotification(`Key test for ${modelDisplayNameForNotification} failed: ${error.message}`, 'error');
        }
      }
    }

    /**
     * 测试所有 Keys
     * @param {string} modelName
     * @param {Array} keysArray
     */
    async function handleTestAllKeys(modelName, keysArray) {
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
      if (typeof showNotification === 'function') {
        showNotification(`开始批量测试 ${modelDisplayNameForNotification} 的 ${keysArray.length} 个Key...`, 'info');
      }
      for (const keyObj of keysArray) {
        await handleTestKey(modelName, keyObj);
      }
      if (typeof showNotification === 'function') {
        showNotification(`${modelDisplayNameForNotification} 的所有 Key 测试完毕。`, 'info');
      }
    }

    // 导出到全局
    window.renderKeyManagerForModel = renderKeyManagerForModel;

    // 刷新 Key 管理器
    window.refreshKeyManagerForModel = (modelName, keyId, newStatus) => {
      if (modelKeyManagerModal && !modelKeyManagerModal.classList.contains('hidden') &&
          currentManagerUI && currentManagerUI.modelName === modelName) {
        currentManagerUI.updateKeyStatus(keyId, newStatus);
      }
    };

    // 自定义源站选择事件
    const customSourceSiteSelect = document.getElementById('customSourceSiteSelect');
    if (customSourceSiteSelect) {
      customSourceSiteSelect.addEventListener('change', () => {
        let settings = typeof loadSettings === 'function' ? loadSettings() : {};
        settings.selectedCustomSourceSiteId = customSourceSiteSelect.value;
        if (typeof saveSettings === 'function') {
          saveSettings(settings);
        } else {
          localStorage.setItem('paperBurnerSettings', JSON.stringify(settings));
        }
        if (typeof saveCurrentSettings === 'function') {
          saveCurrentSettings();
        }
        if (SourceSites.updateCustomSourceSiteInfo) {
          SourceSites.updateCustomSourceSiteInfo(customSourceSiteSelect.value);
        }
        if (typeof window.refreshCustomSourceSiteInfo === 'function') {
          window.refreshCustomSourceSiteInfo({ autoSelect: false });
        }
      });
    }

    // 检测模型按钮事件
    const detectModelsBtn = document.getElementById('detectModelsBtn');
    if (detectModelsBtn) {
      detectModelsBtn.addEventListener('click', function() {
        const selectedSiteId = customSourceSiteSelect ? customSourceSiteSelect.value : null;
        if (!selectedSiteId) {
          if (typeof showNotification === 'function') showNotification('请先选择一个源站点', 'warning');
          return;
        }

        const keysForSite = typeof loadModelKeys === 'function' ?
          loadModelKeys(`custom_source_${selectedSiteId}`) : [];
        const validKeys = keysForSite.filter(key => key.status === 'valid' || key.status === 'untested');

        if (validKeys.length === 0) {
          if (confirm('源站点没有可用的API Key。是否立即添加Key？')) {
            const modelKeyManagerBtn = document.getElementById('modelKeyManagerBtn');
            if (modelKeyManagerBtn) modelKeyManagerBtn.click();
            setTimeout(() => {
              selectModelForManager('custom');
              if (SourceSites.selectSourceSite) {
                SourceSites.selectSourceSite(selectedSiteId);
              }
            }, 100);
          }
          return;
        }

        const sites = typeof loadAllCustomSourceSites === 'function' ? loadAllCustomSourceSites() : {};
        const site = sites[selectedSiteId];

        if (!site || !site.apiBaseUrl) {
          if (typeof showNotification === 'function') showNotification('源站点配置不完整，缺少API Base URL', 'error');
          return;
        }

        if (typeof showNotification === 'function') {
          showNotification('开始使用现有API Key检测可用模型，请稍候...', 'info');
        }

        if (SourceSites.detectModelsWithExistingKeys) {
          SourceSites.detectModelsWithExistingKeys(selectedSiteId, site, validKeys);
        }
      });
    }

    // 自定义事件监听
    window.addEventListener('selectCustomSourceSiteForKeyManager', function(e) {
      if (e.detail && typeof e.detail === 'string') {
        selectModelForManager('custom');
        if (SourceSites.selectSourceSite) {
          SourceSites.selectSourceSite(e.detail);
        }
      }
    });
  }

  // 导出到全局
  window.initUI = initUI;

  // 自动初始化
  if (typeof document !== 'undefined') {
    const rs = document.readyState;
    if (rs === 'loading') {
      document.addEventListener('DOMContentLoaded', initUI);
    } else if (typeof rs === 'string') {
      initUI();
    }
  }

})(window);

// ESM 导出
export function initUI(...args) {
  return globalThis.window?.initUI?.(...args);
}

export default { initUI };
