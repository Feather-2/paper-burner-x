/**
 * UI 模型配置渲染模块
 * 处理各类模型的配置界面渲染（生图、学术搜索等）
 */

(function(window) {
  'use strict';

  // 依赖检查
  const Utils = window.UIConfigUtils || {};
  const escapeHtml = Utils.escapeHtml || ((v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'));
  const escapeAttr = Utils.escapeAttr || escapeHtml;
  const createLabeledInput = Utils.createLabeledInput || window.createLabeledInput;
  const createLabeledSelect = Utils.createLabeledSelect || window.createLabeledSelect;

  /**
   * 渲染 Gemini 生图配置
   * @param {HTMLElement} container - 配置容器
   */
  function renderGeminiImageConfig(container) {
    const cfg = typeof loadModelConfig === 'function' ? (loadModelConfig('gemini-image') || {}) : {};
    const defaultBase = 'https://generativelanguage.googleapis.com';
    const defaultModel = 'gemini-2.0-flash-exp-image-generation';

    const baseRow = createLabeledInput('API Base URL', defaultBase, cfg.apiBaseUrl || defaultBase);
    const modelRow = createLabeledInput('模型 ID', defaultModel, cfg.modelId || defaultModel);

    const aspectRatioRow = createLabeledSelect('图片比例', [
      { value: '1:1', label: '1:1 (正方形)' },
      { value: '16:9', label: '16:9 (横屏)' },
      { value: '9:16', label: '9:16 (竖屏)' },
      { value: '4:3', label: '4:3 (传统)' },
      { value: '3:4', label: '3:4 (竖版)' }
    ], cfg.aspectRatio || '1:1');

    const imageSizeRow = createLabeledSelect('分辨率', [
      { value: '1K', label: '1K (默认)' },
      { value: '2K', label: '2K (标准)' },
      { value: '4K', label: '4K (高清)' }
    ], cfg.imageSize || '1K');

    const hint = document.createElement('p');
    hint.className = 'text-xs text-slate-500 mb-3 bg-slate-50 border border-slate-200 rounded px-3 py-2';
    hint.innerHTML = '使用 Gemini generateContent 接口生图。支持 2.0-flash-exp-image-generation 等模型。需在模型 Key 管理中添加 Gemini API Key。';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded';
    saveBtn.textContent = '保存配置';
    saveBtn.onclick = () => {
      try {
        if (typeof saveModelConfig === 'function') {
          saveModelConfig('gemini-image', {
            apiBaseUrl: (baseRow.input.value || defaultBase).trim(),
            modelId: (modelRow.input.value || defaultModel).trim(),
            aspectRatio: aspectRatioRow.select.value,
            imageSize: imageSizeRow.select.value
          });
        }
        if (typeof showNotification === 'function') showNotification('Gemini 生图配置已保存', 'success');
        else alert('Gemini 生图配置已保存');
      } catch (e) {
        console.error(e);
        if (typeof showNotification === 'function') showNotification('保存失败，请重试', 'error');
        else alert('保存失败，请重试');
      }
    };

    container.appendChild(baseRow.wrapper);
    container.appendChild(modelRow.wrapper);
    container.appendChild(aspectRatioRow.wrapper);
    container.appendChild(imageSizeRow.wrapper);
    container.appendChild(hint);
    container.appendChild(saveBtn);
  }

  /**
   * 渲染通用生图配置
   * @param {HTMLElement} container - 配置容器
   */
  function renderGenericImageConfig(container) {
    const cfg = typeof loadModelConfig === 'function' ? (loadModelConfig('image') || {}) : {};
    const defaultBase = 'https://api.openai.com';
    const defaultEndpoint = '/v1/images/generations';
    const defaultChatEndpoint = '/v1/chat/completions';
    const defaultModel = 'gpt-image-1';
    const defaultResp = 'b64_json';

    const baseRow = createLabeledInput('API Base URL', defaultBase, cfg.apiBaseUrl || defaultBase);
    const epRow = createLabeledInput('图片接口路径 (images/generations)', defaultEndpoint, cfg.apiEndpoint || '');
    const chatRow = createLabeledInput('Chat 接口路径 (可选，用于 chat 出图)', defaultChatEndpoint, cfg.apiEndpointChat || '');
    const modelRow = createLabeledInput('模型 ID', defaultModel, cfg.modelId || defaultModel);
    const respRow = createLabeledInput('response_format (b64_json/url)', defaultResp, cfg.responseFormat || defaultResp);

    const chatModeToggle = document.createElement('div');
    chatModeToggle.className = 'flex items-center gap-2 mb-3';
    const chatCheckbox = document.createElement('input');
    chatCheckbox.type = 'checkbox';
    chatCheckbox.checked = !!cfg.chatImageMode;
    chatCheckbox.id = 'imageChatModeToggle';
    const chatLabel = document.createElement('label');
    chatLabel.setAttribute('for', 'imageChatModeToggle');
    chatLabel.className = 'text-sm text-slate-700';
    chatLabel.textContent = '使用 Chat 接口返回图片（仅当供应商在 chat 响应中返回图片 URL/base64 时勾选）';
    chatModeToggle.appendChild(chatCheckbox);
    chatModeToggle.appendChild(chatLabel);

    const hint = document.createElement('p');
    hint.className = 'text-xs text-slate-500 mb-3 bg-slate-50 border border-slate-200 rounded px-3 py-2';
    hint.innerHTML = '通用生图：默认走 /v1/images/generations，若供应商只暴露 chat/completions 且会返回图片，可勾选 Chat 模式并填写 Chat 路径。';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded';
    saveBtn.textContent = '保存配置';
    saveBtn.onclick = () => {
      try {
        if (typeof saveModelConfig === 'function') {
          saveModelConfig('image', {
            apiBaseUrl: (baseRow.input.value || defaultBase).trim(),
            apiEndpoint: (epRow.input.value || '').trim(),
            apiEndpointChat: (chatRow.input.value || '').trim(),
            modelId: (modelRow.input.value || defaultModel).trim(),
            responseFormat: (respRow.input.value || defaultResp).trim(),
            chatImageMode: chatCheckbox.checked
          });
        }
        if (typeof showNotification === 'function') showNotification('通用生图配置已保存', 'success');
        else alert('通用生图配置已保存');
      } catch (e) {
        console.error(e);
        if (typeof showNotification === 'function') showNotification('保存失败，请重试', 'error');
        else alert('保存失败，请重试');
      }
    };

    container.appendChild(baseRow.wrapper);
    container.appendChild(epRow.wrapper);
    container.appendChild(chatRow.wrapper);
    container.appendChild(modelRow.wrapper);
    container.appendChild(respRow.wrapper);
    container.appendChild(chatModeToggle);
    container.appendChild(hint);
    container.appendChild(saveBtn);
  }

  /**
   * 渲染学术搜索配置
   * @param {HTMLElement} container - 配置容器
   */
  function renderAcademicSearchConfig(container) {
    const proxyConfig = JSON.parse(localStorage.getItem('academicSearchProxyConfig') || 'null') || {
      enabled: false,
      baseUrl: '',
      semanticScholarApiKey: '',
      pubmedApiKey: '',
      authKey: ''
    };

    const sourcesConfig = JSON.parse(localStorage.getItem('academicSearchSourcesConfig') || 'null') || {
      sources: [
        { key: 'crossref', name: 'CrossRef', enabled: true, order: 0 },
        { key: 'openalex', name: 'OpenAlex', enabled: true, order: 1 },
        { key: 'arxiv', name: 'arXiv', enabled: true, order: 2 },
        { key: 'pubmed', name: 'PubMed', enabled: true, order: 3 },
        { key: 'semanticscholar', name: 'Semantic Scholar', enabled: true, order: 4 }
      ]
    };

    const mainContainer = document.createElement('div');
    mainContainer.className = 'space-y-4';

    // Tab 切换
    const tabsDiv = document.createElement('div');
    tabsDiv.className = 'border-b border-gray-200';
    tabsDiv.innerHTML = `
      <nav class="flex -mb-px space-x-4">
        <button id="academic-tab-sources" class="academic-tab px-4 py-2 text-sm font-medium border-b-2 border-blue-600 text-blue-600">
          搜索源管理
        </button>
        <button id="academic-tab-proxy" class="academic-tab px-4 py-2 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300">
          代理配置
        </button>
      </nav>
    `;
    mainContainer.appendChild(tabsDiv);

    // Tab 1: 搜索源管理
    const sourcesTab = document.createElement('div');
    sourcesTab.id = 'academic-sources-tab-content';
    sourcesTab.className = 'pt-4';
    sourcesTab.innerHTML = `
      <div class="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded p-2 mb-3 flex items-center gap-1">
        <iconify-icon icon="carbon:information" width="14"></iconify-icon>
        <span>拖动调整查询顺序，取消勾选可禁用某个源</span>
      </div>
      <div id="academic-sources-list" class="space-y-2"></div>
    `;
    mainContainer.appendChild(sourcesTab);

    // Tab 2: 代理配置
    const proxyTab = document.createElement('div');
    proxyTab.id = 'academic-proxy-tab-content';
    proxyTab.className = 'pt-4 hidden';
    mainContainer.appendChild(proxyTab);

    container.appendChild(mainContainer);

    // 渲染搜索源列表
    renderAcademicSourcesList(sourcesConfig);

    // 渲染代理配置
    renderAcademicProxyConfig(proxyTab, proxyConfig);

    // Tab 切换逻辑
    document.querySelectorAll('.academic-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        const targetId = e.target.id;

        document.querySelectorAll('.academic-tab').forEach(t => {
          t.classList.remove('border-blue-600', 'text-blue-600');
          t.classList.add('border-transparent', 'text-gray-500');
        });
        e.target.classList.remove('border-transparent', 'text-gray-500');
        e.target.classList.add('border-blue-600', 'text-blue-600');

        if (targetId === 'academic-tab-sources') {
          sourcesTab.classList.remove('hidden');
          proxyTab.classList.add('hidden');
        } else {
          sourcesTab.classList.add('hidden');
          proxyTab.classList.remove('hidden');
        }
      });
    });
  }

  /**
   * 渲染学术搜索源列表
   * @param {Object} config - 搜索源配置
   */
  function renderAcademicSourcesList(config) {
    const listContainer = document.getElementById('academic-sources-list');
    if (!listContainer) return;

    listContainer.innerHTML = '';

    const sortedSources = [...config.sources].sort((a, b) => a.order - b.order);

    sortedSources.forEach((source, index) => {
      const item = document.createElement('div');
      item.className = 'flex items-center gap-3 p-3 bg-white border border-gray-200 rounded-md hover:shadow-sm transition-shadow cursor-move';
      item.draggable = true;
      item.dataset.sourceKey = source.key;

      item.innerHTML = `
        <iconify-icon icon="carbon:draggable" width="16" class="text-gray-400"></iconify-icon>
        <input type="checkbox" ${source.enabled ? 'checked' : ''} class="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 source-enable-checkbox" data-key="${escapeAttr(source.key)}">
        <span class="flex-grow text-sm text-gray-700 font-medium">${escapeHtml(source.name)}</span>
        <span class="text-xs text-gray-400">${escapeHtml(source.key)}</span>
      `;

      listContainer.appendChild(item);

      // 拖拽事件
      item.addEventListener('dragstart', (e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', source.key);
        item.classList.add('opacity-50');
      });

      item.addEventListener('dragend', () => {
        item.classList.remove('opacity-50');
      });

      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        item.classList.add('border-blue-400', 'bg-blue-50');
      });

      item.addEventListener('dragleave', () => {
        item.classList.remove('border-blue-400', 'bg-blue-50');
      });

      item.addEventListener('drop', (e) => {
        e.preventDefault();
        item.classList.remove('border-blue-400', 'bg-blue-50');

        const draggedKey = e.dataTransfer.getData('text/plain');
        const targetKey = source.key;

        if (draggedKey !== targetKey) {
          const draggedIndex = config.sources.findIndex(s => s.key === draggedKey);
          const targetIndex = config.sources.findIndex(s => s.key === targetKey);

          const [draggedItem] = config.sources.splice(draggedIndex, 1);
          config.sources.splice(targetIndex, 0, draggedItem);

          config.sources.forEach((s, idx) => s.order = idx);

          localStorage.setItem('academicSearchSourcesConfig', JSON.stringify(config));
          renderAcademicSourcesList(config);
          if (typeof showNotification === 'function') showNotification('搜索源顺序已更新', 'success', 2000);
        }
      });
    });

    // 启用/禁用切换
    document.querySelectorAll('.source-enable-checkbox').forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        const key = e.target.dataset.key;
        const source = config.sources.find(s => s.key === key);
        if (source) {
          source.enabled = e.target.checked;
          localStorage.setItem('academicSearchSourcesConfig', JSON.stringify(config));
          if (typeof showNotification === 'function') showNotification(`${source.name} 已${source.enabled ? '启用' : '禁用'}`, 'success', 2000);
        }
      });
    });

    // 保存按钮
    const saveBtn = document.createElement('button');
    saveBtn.className = 'w-full mt-3 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700';
    saveBtn.textContent = '保存配置';
    saveBtn.onclick = () => {
      localStorage.setItem('academicSearchSourcesConfig', JSON.stringify(config));
      if (typeof showNotification === 'function') showNotification('搜索源配置已保存', 'success');
    };
    listContainer.appendChild(saveBtn);
  }

  /**
   * 渲染学术搜索代理配置
   * @param {HTMLElement} container - 容器元素
   * @param {Object} config - 代理配置
   */
  function renderAcademicProxyConfig(container, config) {
    container.classList.add('space-y-4');
    if (!container.classList.contains('pt-4')) {
      container.classList.add('pt-4');
    }

    // 启用开关
    const enableDiv = document.createElement('div');
    enableDiv.innerHTML = `
      <label class="flex items-center cursor-pointer">
        <input type="checkbox" id="academic-search-enabled" ${config.enabled ? 'checked' : ''} class="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500">
        <span class="ml-2 text-sm font-medium text-gray-700">启用学术搜索代理</span>
      </label>
      <p class="mt-1 text-xs text-gray-500 ml-6">开启后，PubMed、Semantic Scholar 和 arXiv 查询将通过代理服务器</p>
    `;
    container.appendChild(enableDiv);

    // Worker URL
    const urlDiv = document.createElement('div');
    urlDiv.innerHTML = `
      <label class="block text-sm font-medium text-gray-700 mb-1">Worker URL</label>
      <input type="text" id="academic-search-base-url" value="${escapeAttr(config.baseUrl)}" placeholder="https://your-worker.workers.dev" class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500">
      <p class="mt-1 text-xs text-gray-500">Cloudflare Worker 学术搜索代理地址</p>
    `;
    container.appendChild(urlDiv);

    // 部署模式说明
    const modeInfoDiv = document.createElement('div');
    modeInfoDiv.className = 'border-t pt-4';
    modeInfoDiv.innerHTML = `
      <div class="text-xs bg-blue-50 border border-blue-200 rounded p-3 space-y-2">
        <div class="font-semibold text-blue-800 flex items-center gap-1">
          <iconify-icon icon="carbon:information" width="14"></iconify-icon>
          <span>支持两种部署模式</span>
        </div>
        <div class="text-blue-700">
          <strong>方案一：透传模式（推荐）</strong><br>
          在下方填写 API Key，通过 <code class="bg-blue-100 px-1 rounded">X-Api-Key</code> 请求头透传给 Worker
        </div>
        <div class="text-blue-700">
          <strong>方案二：共享密钥模式</strong><br>
          API Key 存储在 Worker 环境变量中，需要在下方填写 Worker Auth Key
        </div>
      </div>
    `;
    container.appendChild(modeInfoDiv);

    // Semantic Scholar API Key
    const s2KeyDiv = document.createElement('div');
    s2KeyDiv.className = 'border-t pt-4';
    s2KeyDiv.innerHTML = `
      <label class="block text-sm font-medium text-gray-700 mb-1">Semantic Scholar API Key（可选）</label>
      <div class="flex items-center gap-2">
        <input type="password" id="academic-search-s2-key" value="${escapeAttr(config.semanticScholarApiKey || '')}" placeholder="留空则使用免费额度" class="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500">
        <button type="button" id="academic-search-s2-toggle" class="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md transition-colors flex items-center gap-1">
          <iconify-icon icon="carbon:view" width="16"></iconify-icon>
          <span>显示</span>
        </button>
      </div>
    `;
    container.appendChild(s2KeyDiv);

    // PubMed API Key
    const pubmedKeyDiv = document.createElement('div');
    pubmedKeyDiv.innerHTML = `
      <label class="block text-sm font-medium text-gray-700 mb-1">PubMed API Key（可选）</label>
      <div class="flex items-center gap-2">
        <input type="password" id="academic-search-pubmed-key" value="${escapeAttr(config.pubmedApiKey || '')}" placeholder="留空则使用免费额度" class="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500">
        <button type="button" id="academic-search-pubmed-toggle" class="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md transition-colors flex items-center gap-1">
          <iconify-icon icon="carbon:view" width="16"></iconify-icon>
          <span>显示</span>
        </button>
      </div>
    `;
    container.appendChild(pubmedKeyDiv);

    // Worker Auth Key
    const authKeyDiv = document.createElement('div');
    authKeyDiv.className = 'border-t pt-4';
    authKeyDiv.innerHTML = `
      <label class="block text-sm font-medium text-gray-700 mb-1">Worker Auth Key（共享模式）</label>
      <div class="flex items-center gap-2">
        <input type="password" id="academic-search-auth-key" value="${escapeAttr(config.authKey || '')}" placeholder="如果 Worker 启用了 ENABLE_AUTH，填写这里" class="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500">
        <button type="button" id="academic-search-auth-toggle" class="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md transition-colors flex items-center gap-1">
          <iconify-icon icon="carbon:view" width="16"></iconify-icon>
          <span>显示</span>
        </button>
      </div>
    `;
    container.appendChild(authKeyDiv);

    // 联系邮箱
    const emailDiv = document.createElement('div');
    emailDiv.innerHTML = `
      <label class="block text-sm font-medium text-gray-700 mb-1">联系邮箱（可选）</label>
      <input type="email" id="academic-search-contact-email" value="${escapeAttr(config.contactEmail || '')}" placeholder="your-email@example.com" class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500">
      <p class="mt-1 text-xs text-gray-500">提供邮箱可获得 CrossRef 和 OpenAlex 更高的速率限制</p>
    `;
    container.appendChild(emailDiv);

    // 测试/保存按钮
    const buttonsDiv = document.createElement('div');
    buttonsDiv.className = 'pt-2 grid grid-cols-1 sm:grid-cols-2 gap-2';
    buttonsDiv.innerHTML = `
      <button id="academic-search-test" class="px-4 py-2 border border-gray-300 bg-white text-gray-700 rounded-md hover:bg-gray-50">测试连接</button>
      <button id="academic-search-save" class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">保存配置</button>
    `;
    container.appendChild(buttonsDiv);

    // 测试结果显示
    const resultDiv = document.createElement('div');
    resultDiv.id = 'academic-search-test-result';
    resultDiv.className = 'text-sm mt-2';
    resultDiv.style.display = 'none';
    container.appendChild(resultDiv);

    // 绑定显示/隐藏切换事件
    const toggleButtons = [
      { btnId: 'academic-search-s2-toggle', inputId: 'academic-search-s2-key' },
      { btnId: 'academic-search-pubmed-toggle', inputId: 'academic-search-pubmed-key' },
      { btnId: 'academic-search-auth-toggle', inputId: 'academic-search-auth-key' }
    ];

    toggleButtons.forEach(({ btnId, inputId }) => {
      const btn = document.getElementById(btnId);
      const input = document.getElementById(inputId);
      if (btn && input) {
        btn.addEventListener('click', () => {
          const isPassword = input.type === 'password';
          input.type = isPassword ? 'text' : 'password';
          btn.querySelector('span').textContent = isPassword ? '隐藏' : '显示';
          btn.querySelector('iconify-icon').setAttribute('icon', isPassword ? 'carbon:view-off' : 'carbon:view');
        });
      }
    });

    // 保存配置
    document.getElementById('academic-search-save').onclick = () => {
      try {
        const newConfig = {
          enabled: document.getElementById('academic-search-enabled').checked,
          baseUrl: document.getElementById('academic-search-base-url').value.trim(),
          semanticScholarApiKey: document.getElementById('academic-search-s2-key').value.trim(),
          pubmedApiKey: document.getElementById('academic-search-pubmed-key').value.trim(),
          authKey: document.getElementById('academic-search-auth-key').value.trim(),
          contactEmail: document.getElementById('academic-search-contact-email').value.trim()
        };

        const existingConfig = JSON.parse(localStorage.getItem('academicSearchProxyConfig') || '{}');
        if (existingConfig.rateLimit) {
          newConfig.rateLimit = existingConfig.rateLimit;
        }

        localStorage.setItem('academicSearchProxyConfig', JSON.stringify(newConfig));
        if (typeof showNotification === 'function') showNotification('学术搜索配置已保存', 'success');

        if (window.academicSearchSettingsManager && typeof window.academicSearchSettingsManager.loadSettings === 'function') {
          window.academicSearchSettingsManager.loadSettings();
        }
      } catch (e) {
        alert('保存配置失败：' + e.message);
      }
    };

    // 测试连接
    document.getElementById('academic-search-test').onclick = async () => {
      const baseUrl = document.getElementById('academic-search-base-url').value.trim();
      const authKey = document.getElementById('academic-search-auth-key').value.trim();
      const resultDiv = document.getElementById('academic-search-test-result');

      if (!baseUrl) {
        resultDiv.style.display = 'block';
        resultDiv.className = 'text-sm mt-2 p-2 bg-red-50 border border-red-200 text-red-700 rounded';
        resultDiv.textContent = '请填写 Worker URL';
        return;
      }

      resultDiv.style.display = 'block';
      resultDiv.className = 'text-sm mt-2 p-2 bg-blue-50 border border-blue-200 text-blue-700 rounded';
      resultDiv.textContent = '正在测试连接...';

      try {
        const headers = { 'Content-Type': 'application/json' };
        if (authKey) headers['X-Auth-Key'] = authKey;

        const response = await fetch(`${baseUrl}/health`, { method: 'GET', headers });

        if (response.ok) {
          const data = await response.json();
          resultDiv.className = 'text-sm mt-2 p-2 bg-green-50 border border-green-200 text-green-700 rounded';
          resultDiv.textContent = '连接成功！';
        } else {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
      } catch (error) {
        resultDiv.className = 'text-sm mt-2 p-2 bg-red-50 border border-red-200 text-red-700 rounded';
        resultDiv.textContent = `连接失败：${error.message}`;
      }
    };
  }

  // 导出到全局作用域
  window.UIModelConfigRenderer = {
    renderGeminiImageConfig,
    renderGenericImageConfig,
    renderAcademicSearchConfig,
    renderAcademicSourcesList,
    renderAcademicProxyConfig
  };

})(window);

// ESM 导出
export const renderGeminiImageConfig = window.UIModelConfigRenderer?.renderGeminiImageConfig;
export const renderGenericImageConfig = window.UIModelConfigRenderer?.renderGenericImageConfig;
export const renderAcademicSearchConfig = window.UIModelConfigRenderer?.renderAcademicSearchConfig;

export default {
  renderGeminiImageConfig,
  renderGenericImageConfig,
  renderAcademicSearchConfig
};
