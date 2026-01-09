/**
 * UI 嵌入与重排配置渲染模块
 * 提取嵌入模型（Embedding）和重排（Rerank）的配置界面渲染代码
 */

(function(window) {
  'use strict';

  // 确保 EmbeddingClient 已加载（必要时动态注入脚本）
  async function ensureEmbeddingClientLoaded() {
    if (window.EmbeddingClient && typeof window.EmbeddingClient.saveConfig === 'function') return true;

    // 从已加载脚本推断候选路径
    const candidates = [];
    try {
      const scripts = Array.from(document.getElementsByTagName('script'));
      const sem = scripts.find(s => (s.src || '').includes('semantic-vector-search.js'));
      if (sem && sem.src) candidates.push(sem.src.replace('semantic-vector-search.js', 'embedding-client.js'));
      const rer = scripts.find(s => (s.src || '').includes('rerank-client.js'));
      if (rer && rer.src) candidates.push(rer.src.replace('rerank-client.js', 'embedding-client.js'));
    } catch(_) {}

    // 兜底：相对当前页面常见路径
    candidates.push('js/chatbot/agents/embedding-client.js');

    // 动态加载（无论是否已存在旧标签，均追加一个带缓存破坏参数的标签）
    for (const base of Array.from(new Set(candidates))) {
      const url = base + (base.includes('?') ? '&' : '?') + 'v=' + Date.now();
      try {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = url;
          s.async = true;
          s.onload = () => resolve();
          s.onerror = () => reject(new Error('load failed: ' + url));
          document.head.appendChild(s);
        });
        if (window.EmbeddingClient && typeof window.EmbeddingClient.saveConfig === 'function') return true;
      } catch(_) {
        // try next
      }
    }
    return !!(window.EmbeddingClient && typeof window.EmbeddingClient.saveConfig === 'function');
  }

  /**
   * 显示嵌入模型选择器对话框
   * @param {Array} models - 模型列表
   * @param {HTMLInputElement} targetInput - 目标输入框
   */
  function showEmbeddingModelSelector(models, targetInput) {
    // 创建一个简单的选择对话框
    const container = document.createElement('div');
    container.style.cssText = `
      position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
      width: 400px; max-width: 90vw; max-height: 60vh;
      background: #fff; border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.4);
      z-index: 100002; padding: 0; overflow: hidden;
    `;

    const header = document.createElement('div');
    header.style.cssText = 'padding: 16px 20px; border-bottom: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center;';
    header.innerHTML = `
      <h4 style="margin: 0; font-size: 16px; font-weight: 600; color: #111827;">选择嵌入模型</h4>
      <button class="model-selector-close" style="border: none; background: none; font-size: 24px; color: #6b7280; cursor: pointer; line-height: 1;">&times;</button>
    `;

    const list = document.createElement('div');
    list.style.cssText = 'max-height: 400px; overflow-y: auto; padding: 8px;';

    models.forEach(model => {
      const item = document.createElement('div');
      item.style.cssText = `
        padding: 12px 16px; margin: 4px 0; border-radius: 8px;
        cursor: pointer; transition: all 0.2s;
        border: 1px solid #e5e7eb;
      `;
      item.innerHTML = `
        <div style="font-weight: 500; color: #111827;">${model.id}</div>
        ${model.owned_by ? `<div style="font-size: 12px; color: #6b7280; margin-top: 2px;">by ${model.owned_by}</div>` : ''}
      `;

      item.onmouseover = () => {
        item.style.background = '#f3f4f6';
        item.style.borderColor = '#3b82f6';
      };
      item.onmouseout = () => {
        item.style.background = '#fff';
        item.style.borderColor = '#e5e7eb';
      };
      item.onclick = () => {
        targetInput.value = model.id;
        document.body.removeChild(overlay);
        document.body.removeChild(container);
      };

      list.appendChild(item);
    });

    container.appendChild(header);
    container.appendChild(list);

    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.5); z-index: 100001;
    `;

    const closeHandler = () => {
      document.body.removeChild(overlay);
      document.body.removeChild(container);
    };

    overlay.onclick = closeHandler;
    header.querySelector('.model-selector-close').onclick = closeHandler;

    document.body.appendChild(overlay);
    document.body.appendChild(container);
  }

  /**
   * 显示重排模型选择器对话框
   * @param {Array} models - 模型列表
   * @param {HTMLInputElement} targetInput - 目标输入框
   */
  function showRerankModelSelector(models, targetInput) {
    const container = document.createElement('div');
    container.style.cssText = `
      position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
      width: 420px; max-width: 92vw; max-height: 60vh;
      background: #fff; border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.4);
      z-index: 100002; padding: 0; overflow: hidden;
    `;

    const header = document.createElement('div');
    header.style.cssText = 'padding: 16px 20px; border-bottom: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center;';
    header.innerHTML = `
      <h4 style="margin: 0; font-size: 16px; font-weight: 600; color: #111827;">选择重排模型</h4>
      <button class="model-selector-close" style="border: none; background: none; font-size: 24px; color: #6b7280; cursor: pointer; line-height: 1;">&times;</button>
    `;

    const list = document.createElement('div');
    list.style.cssText = 'max-height: 400px; overflow-y: auto; padding: 8px;';

    (models || []).forEach(model => {
      const item = document.createElement('div');
      item.style.cssText = `
        padding: 12px 16px; margin: 4px 0; border-radius: 8px;
        cursor: pointer; transition: all 0.2s;
        border: 1px solid #e5e7eb;
      `;
      const id = model.id || model.name || '';
      item.innerHTML = `
        <div style="font-weight: 500; color: #111827;">${id}</div>
        ${model.owned_by ? `<div style="font-size: 12px; color: #6b7280; margin-top: 2px;">by ${model.owned_by}</div>` : ''}
      `;
      item.onmouseover = () => { item.style.background = '#f3f4f6'; item.style.borderColor = '#737373'; };
      item.onmouseout = () => { item.style.background = '#fff'; item.style.borderColor = '#e5e7eb'; };
      item.onclick = () => {
        if (id) targetInput.value = id;
        document.body.removeChild(overlay);
        document.body.removeChild(container);
      };
      list.appendChild(item);
    });

    container.appendChild(header);
    container.appendChild(list);

    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.5); z-index: 100001;
    `;
    const closeHandler = () => { document.body.removeChild(overlay); document.body.removeChild(container); };
    overlay.onclick = closeHandler;
    header.querySelector('.model-selector-close').onclick = closeHandler;
    document.body.appendChild(overlay);
    document.body.appendChild(container);
  }

  /**
   * 渲染嵌入模型配置界面（包含向量搜索和重排两个tab）
   * @param {HTMLElement} container - 配置容器元素（modelConfigColumn）
   */
  function renderEmbeddingConfig(container) {
      // 从localStorage加载配置
      const config = window.EmbeddingClient?.config || {};
      const rerankConfig = window.RerankClient?.config || {};
      const PRESETS = {
          openai: { name: 'OpenAI格式', endpoint: 'https://api.openai.com/v1/embeddings' },
          jina: { name: 'Jina AI', endpoint: 'https://api.jina.ai/v1/embeddings' },
          zhipu: { name: '智谱AI', endpoint: 'https://open.bigmodel.cn/api/paas/v4/embeddings' },
          alibaba: { name: '阿里云百炼', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings' }
      };

      // 阿里云百炼支持的模型和维度
      const ALIBABA_MODELS = {
          'text-embedding-v1': { name: 'text-embedding-v1 (中文)', dims: 1536 },
          'text-embedding-v2': { name: 'text-embedding-v2 (多语言)', dims: 1536 },
          'text-embedding-v3': { name: 'text-embedding-v3 (高性能)', dims: 1024 },
          'text-embedding-v4': { name: 'text-embedding-v4 (多语言，支持2048维)', dims: 2048 }
      };

      const mainContainer = document.createElement('div');

      // Tabs（样式更内敛）
      const tabsDiv = document.createElement('div');
      tabsDiv.className = 'flex border-b border-gray-200 mb-4';
      tabsDiv.innerHTML = `
          <button id="emb-km-tab-vector" class="emb-km-tab flex-1 px-4 py-2 text-sm font-medium text-gray-800 border-b-2 border-gray-300 transition-colors">
              向量搜索
          </button>
          <button id="emb-km-tab-rerank" class="emb-km-tab flex-1 px-4 py-2 text-sm font-medium text-gray-500 border-b-2 border-transparent hover:text-gray-700 transition-colors">
              重排 (Rerank)
          </button>
      `;
      mainContainer.appendChild(tabsDiv);

      // 向量搜索Tab内容
      const vectorContainer = document.createElement('div');
      vectorContainer.id = 'emb-km-vector-content';
      vectorContainer.className = 'emb-km-tab-content space-y-4';

      // 启用开关
      const enabledDiv = document.createElement('div');
      enabledDiv.className = 'flex items-center gap-2';
      enabledDiv.innerHTML = `
          <input type="checkbox" id="emb-enabled-km" ${config.enabled ? 'checked' : ''} class="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500">
          <label for="emb-enabled-km" class="text-sm font-medium text-gray-700">启用向量搜索</label>
      `;
      vectorContainer.appendChild(enabledDiv);

      // 服务商选择
      const providerDiv = document.createElement('div');
      providerDiv.innerHTML = `
          <label class="block text-sm font-medium text-gray-700 mb-1">服务商</label>
          <select id="emb-provider-km" class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500">
              <option value="openai" ${config.provider === 'openai' ? 'selected' : ''}>OpenAI格式</option>
              <option value="jina" ${config.provider === 'jina' ? 'selected' : ''}>Jina AI (多语言优化)</option>
              <option value="zhipu" ${config.provider === 'zhipu' ? 'selected' : ''}>智谱AI (GLM)</option>
              <option value="alibaba" ${config.provider === 'alibaba' ? 'selected' : ''}>阿里云百炼</option>
          </select>
      `;
      vectorContainer.appendChild(providerDiv);

      // API Key（带显示/隐藏按钮）
      const keyDiv = document.createElement('div');
      keyDiv.innerHTML = `
          <label class="block text-sm font-medium text-gray-700 mb-1">API Key</label>
          <div class="flex items-center gap-2">
              <input type="password" id="emb-api-key-km" value="${config.apiKey || ''}" placeholder="sk-..." class="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500">
              <button type="button" id="emb-api-key-toggle-km" class="px-2.5 py-2 border border-gray-300 rounded-md text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-1">
                  <iconify-icon icon="carbon:view" width="16"></iconify-icon>显示
              </button>
          </div>
      `;
      vectorContainer.appendChild(keyDiv);

      // Base URL
      const urlDiv = document.createElement('div');
      // 显示时去掉 /embeddings 后缀
      const displayUrl = (config.endpoint || '').replace(/\/embeddings\/?$/, '');
      urlDiv.innerHTML = `
          <label class="block text-sm font-medium text-gray-700 mb-1">
              Base URL
              <span class="text-xs text-gray-500">(如 https://api.openai.com/v1)</span>
          </label>
          <input type="text" id="emb-endpoint-km" value="${displayUrl}" placeholder="https://api.openai.com/v1" class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500">
      `;
      vectorContainer.appendChild(urlDiv);

      // 模型选择
      const modelDiv = document.createElement('div');
      modelDiv.innerHTML = `
          <label class="block text-sm font-medium text-gray-700 mb-1">模型ID</label>
          <div class="flex gap-2">
              <input type="text" id="emb-model-km" value="${config.model || ''}" placeholder="请输入模型ID，如: text-embedding-3-small" class="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500">
              <button type="button" id="emb-fetch-models-km" class="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md transition-colors whitespace-nowrap" style="display: none;">
                  获取列表
              </button>
          </div>
          <p id="emb-model-hint-km" class="mt-1 text-xs text-gray-500">请输入服务商支持的嵌入模型ID</p>
      `;
      vectorContainer.appendChild(modelDiv);

      // 向量维度 (OpenAI可选)
      const dimsDiv = document.createElement('div');
      dimsDiv.id = 'emb-dims-wrap-km';
      dimsDiv.innerHTML = `
          <label class="block text-sm font-medium text-gray-700 mb-1">
              向量维度
              <span class="text-xs text-gray-500">(可选，留空使用默认)</span>
          </label>
          <input type="number" id="emb-dimensions-km" value="${config.dimensions || ''}" placeholder="1536" class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500">
          <p class="mt-1 text-xs text-gray-500">降低维度可减少存储和计算，但可能影响精度</p>
      `;
      vectorContainer.appendChild(dimsDiv);

      // 并发数配置
      const concurrencyDiv = document.createElement('div');
      concurrencyDiv.innerHTML = `
          <label class="block text-sm font-medium text-gray-700 mb-1">
              并发请求数
              <span class="text-xs text-gray-500">(建议 5-20，最大50)</span>
          </label>
          <input type="number" id="emb-concurrency-km" value="${config.concurrency || 5}" min="1" max="50" placeholder="5" class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500">
          <p class="mt-1 text-xs text-gray-500">提高并发数可加快索引构建速度，但注意API速率限制</p>
      `;
      vectorContainer.appendChild(concurrencyDiv);

      // 测试和保存按钮
      const buttonsDiv = document.createElement('div');
      buttonsDiv.className = 'flex gap-3 pt-2';
      buttonsDiv.innerHTML = `
          <button id="emb-test-km" class="flex-1 px-4 py-2 border border-gray-300 bg-white text-gray-700 rounded-md hover:bg-gray-50">测试连接</button>
          <button id="emb-save-km" class="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">保存配置</button>
      `;
      vectorContainer.appendChild(buttonsDiv);

      // 测试结果
      const resultDiv = document.createElement('div');
      resultDiv.id = 'emb-test-result-km';
      resultDiv.className = 'text-sm mt-2';
      resultDiv.style.display = 'none';
      vectorContainer.appendChild(resultDiv);

      mainContainer.appendChild(vectorContainer);

      // 重排Tab内容
      const rerankContainer = document.createElement('div');
      rerankContainer.id = 'emb-km-rerank-content';
      rerankContainer.className = 'emb-km-tab-content space-y-4 hidden';

      // 重排启用开关
      const rerankEnabledDiv = document.createElement('div');
      rerankEnabledDiv.className = 'flex items-center gap-2';
      rerankEnabledDiv.innerHTML = `
          <input type="checkbox" id="rerank-enabled-km" ${rerankConfig.enabled ? 'checked' : ''} class="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500">
          <label for="rerank-enabled-km" class="text-sm font-medium text-gray-700">启用重排</label>
      `;
      rerankContainer.appendChild(rerankEnabledDiv);

      // 应用范围
      const rerankScopeDiv = document.createElement('div');
      const scope = rerankConfig.scope || 'vector-only';
      rerankScopeDiv.innerHTML = `
          <label class="block text-sm font-medium text-gray-700 mb-2">应用范围</label>
          <div class="space-y-2">
              <label class="flex items-center cursor-pointer">
                  <input type="radio" name="rerank-scope-km" value="vector-only" ${scope === 'vector-only' ? 'checked' : ''} class="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500">
                  <span class="ml-2 text-sm text-gray-700">仅向量搜索使用重排</span>
              </label>
              <label class="flex items-center cursor-pointer">
                  <input type="radio" name="rerank-scope-km" value="all" ${scope === 'all' ? 'checked' : ''} class="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500">
                  <span class="ml-2 text-sm text-gray-700">所有搜索都使用重排（包括BM25等）</span>
              </label>
          </div>
          <p class="mt-1 text-xs text-gray-500">选择重排功能的应用范围，失败时自动降级为原始排序</p>
      `;
      rerankContainer.appendChild(rerankScopeDiv);

      // 服务商选择
      const rerankProviderDiv = document.createElement('div');
      rerankProviderDiv.innerHTML = `
          <label class="block text-sm font-medium text-gray-700 mb-1">服务商</label>
          <select id="rerank-provider-km" class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500">
              <option value="jina" ${rerankConfig.provider === 'jina' ? 'selected' : ''}>Jina AI Reranker</option>
              <option value="cohere" ${rerankConfig.provider === 'cohere' ? 'selected' : ''}>Cohere Rerank</option>
              <option value="openai" ${rerankConfig.provider === 'openai' ? 'selected' : ''}>OpenAI格式</option>
          </select>
      `;
      rerankContainer.appendChild(rerankProviderDiv);

      // API Key（带显示/隐藏按钮）
      const rerankKeyDiv = document.createElement('div');
      rerankKeyDiv.innerHTML = `
          <label class="block text-sm font-medium text-gray-700 mb-1">API Key</label>
          <div class="flex items-center gap-2">
              <input type="password" id="rerank-api-key-km" value="${rerankConfig.apiKey || ''}" placeholder="jina_..." class="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500">
              <button type="button" id="rerank-api-key-toggle-km" class="px-2.5 py-2 border border-gray-300 rounded-md text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-1">
                  <iconify-icon icon="carbon:view" width="16"></iconify-icon>显示
              </button>
          </div>
      `;
      rerankContainer.appendChild(rerankKeyDiv);

      // Base URL（显示时去掉 /rerank 后缀）
      const rerankUrlDiv = document.createElement('div');
      const displayRerankBaseUrl = (rerankConfig.endpoint || '').replace(/\/rerank\/?$/, '');
      rerankUrlDiv.innerHTML = `
          <label class="block text-sm font-medium text-gray-700 mb-1">
              Base URL
              <span class="text-xs text-gray-500">(如 https://api.jina.ai/v1 或 https://api.openai.com/v1)</span>
          </label>
          <input type="text" id="rerank-endpoint-km" value="${displayRerankBaseUrl}" placeholder="https://api.jina.ai/v1" class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500">
      `;
      rerankContainer.appendChild(rerankUrlDiv);

      // 模型ID（支持 OpenAI 格式获取列表与模型检测）
      const rerankModelDiv = document.createElement('div');
      rerankModelDiv.innerHTML = `
          <label class="block text-sm font-medium text-gray-700 mb-1">模型ID</label>
          <div class="flex gap-2">
              <input type="text" id="rerank-model-km" value="${rerankConfig.model || 'jina-reranker-v2-base-multilingual'}" placeholder="例如: jina-reranker-v2-base-multilingual 或 cohere/rerank-multilingual-v3.0" class="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500">
              <button type="button" id="rerank-fetch-models-km" class="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md transition-colors whitespace-nowrap" style="display: none;">获取列表</button>
              <button type="button" id="rerank-check-model-km" class="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md transition-colors whitespace-nowrap">检测模型</button>
          </div>
          <p id="rerank-model-hint-km" class="mt-1 text-xs text-gray-500">请输入服务商支持的重排模型ID；OpenAI格式可点击“获取列表”</p>
      `;
      rerankContainer.appendChild(rerankModelDiv);

      // Top N
      const rerankTopNDiv = document.createElement('div');
      rerankTopNDiv.innerHTML = `
          <label class="block text-sm font-medium text-gray-700 mb-1">
              Top N
              <span class="text-xs text-gray-500">(返回前N个结果)</span>
          </label>
          <input type="number" id="rerank-top-n-km" value="${rerankConfig.topN || 10}" min="1" max="50" placeholder="10" class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500">
          <p class="mt-1 text-xs text-gray-500">建议 5-20，根据实际需求调整</p>
      `;
      rerankContainer.appendChild(rerankTopNDiv);

      // 重排测试和保存按钮
      const rerankButtonsDiv = document.createElement('div');
      rerankButtonsDiv.className = 'flex gap-3 pt-2';
      rerankButtonsDiv.innerHTML = `
          <button id="rerank-test-km" class="flex-1 px-4 py-2 border border-gray-300 bg-white text-gray-700 rounded-md hover:bg-gray-50">测试连接</button>
          <button id="rerank-save-km" class="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">保存配置</button>
      `;
      rerankContainer.appendChild(rerankButtonsDiv);

      // 重排测试结果
      const rerankResultDiv = document.createElement('div');
      rerankResultDiv.id = 'rerank-test-result-km';
      rerankResultDiv.className = 'text-sm mt-2';
      rerankResultDiv.style.display = 'none';
      rerankContainer.appendChild(rerankResultDiv);

      // 说明
      const rerankNoticeDiv = document.createElement('div');
      rerankNoticeDiv.className = 'mt-4 p-3 bg-blue-50 border border-blue-200 rounded-md';
      rerankNoticeDiv.innerHTML = `
          <p class="text-xs text-blue-900">💡 <strong>重排工作原理</strong>：对搜索结果进行二次排序，使用更精确的模型计算相关性分数，提升最终结果的准确度。</p>
      `;
      rerankContainer.appendChild(rerankNoticeDiv);

      mainContainer.appendChild(rerankContainer);

      container.appendChild(mainContainer);

      // 事件绑定
      const $= (id) => document.getElementById(id);

      // API Key 显示/隐藏切换（Embedding）
      (function() {
          const toggleBtn = $('emb-api-key-toggle-km');
          const input = $('emb-api-key-km');
          if (toggleBtn && input) {
              toggleBtn.addEventListener('click', () => {
                  const isPassword = input.type === 'password';
                  input.type = isPassword ? 'text' : 'password';
                  toggleBtn.innerHTML = isPassword
                      ? '<iconify-icon icon="carbon:view-off" width="16"></iconify-icon>隐藏'
                      : '<iconify-icon icon="carbon:view" width="16"></iconify-icon>显示';
              });
          }
      })();

      // API Key 显示/隐藏切换（Rerank）
      (function() {
          const toggleBtn = $('rerank-api-key-toggle-km');
          const input = $('rerank-api-key-km');
          if (toggleBtn && input) {
              toggleBtn.addEventListener('click', () => {
                  const isPassword = input.type === 'password';
                  input.type = isPassword ? 'text' : 'password';
                  toggleBtn.innerHTML = isPassword
                      ? '<iconify-icon icon="carbon:view-off" width="16"></iconify-icon>隐藏'
                      : '<iconify-icon icon="carbon:view" width="16"></iconify-icon>显示';
              });
          }
      })();

      // Tabs切换事件（中性灰）
      const kmTabs = document.querySelectorAll('.emb-km-tab');
      const kmTabContents = document.querySelectorAll('.emb-km-tab-content');
      kmTabs.forEach(tab => {
          tab.addEventListener('click', () => {
              // 更新tab样式
              kmTabs.forEach(t => {
                  t.classList.remove('text-gray-800', 'border-gray-300');
                  t.classList.add('text-gray-500', 'border-transparent');
              });
              tab.classList.remove('text-gray-500', 'border-transparent');
              tab.classList.add('text-gray-800', 'border-gray-300');

              // 切换内容
              const targetId = tab.id.replace('-tab-', '-') + '-content';
              kmTabContents.forEach(content => {
                  content.classList.add('hidden');
              });
              const targetContent = document.getElementById(targetId);
              if (targetContent) {
                  targetContent.classList.remove('hidden');
              }
          });
      });

      // 服务商切换
      $('emb-provider-km').onchange = function() {
          const provider = this.value;
          const fetchBtn = $('emb-fetch-models-km');
          const modelHint = $('emb-model-hint-km');

          // 显示/隐藏获取模型列表按钮（仅 OpenAI格式支持）
          if (provider === 'openai') {
              fetchBtn.style.display = 'block';
              modelHint.textContent = '可手动输入模型ID，或点击"获取列表"从服务器获取';
          } else {
              fetchBtn.style.display = 'none';
              modelHint.textContent = '请输入服务商支持的嵌入模型ID';
          }

          // 当选择阿里云百炼时，更新维度提示
          if (provider === 'alibaba') {
              const dimsInput = $('emb-dimensions-km');
              const dimsHint = dimsInput.nextElementSibling;
              const modelInput = $('emb-model-km');

              // 根据当前模型更新默认维度
              const updateDimensionsForModel = () => {
                  const modelId = modelInput.value.trim();
                  const modelInfo = ALIBABA_MODELS[modelId];
                  if (modelInfo) {
                      dimsInput.placeholder = `默认: ${modelInfo.dims}`;
                      dimsHint.textContent = `默认维度: ${modelInfo.dims}。可输入1-${modelInfo.dims}之间的整数，留空使用默认。`;
                  }
              };

              // 初始化时更新一次
              updateDimensionsForModel();

              // 模型改变时更新
              modelInput.addEventListener('change', updateDimensionsForModel);
          }
      };

      // 初始化时更新 UI
      (function() {
          const provider = config.provider || 'openai';
          const fetchBtn = $('emb-fetch-models-km');
          const modelHint = $('emb-model-hint-km');
          if (provider === 'openai') {
              fetchBtn.style.display = 'block';
              modelHint.textContent = '可手动输入模型ID，或点击"获取列表"从服务器获取';
          }
      })();

      // 获取模型列表（仅 OpenAI格式）
      $('emb-fetch-models-km').onclick = async () => {
          const btn = $('emb-fetch-models-km');
          const modelInput = $('emb-model-km');
          const modelHint = $('emb-model-hint-km');
          const provider = $('emb-provider-km').value;
          const apiKey = $('emb-api-key-km').value;
          let endpoint = $('emb-endpoint-km').value;

          if (!apiKey) {
              modelHint.style.color = '#dc2626';
              modelHint.textContent = '❌ 请先输入 API Key';
              setTimeout(() => {
                  modelHint.style.color = '#6b7280';
                  modelHint.textContent = '可手动输入模型ID，或点击"获取列表"从服务器获取';
              }, 3000);
              return;
          }

          if (!endpoint) {
              endpoint = PRESETS[provider]?.endpoint || '';
          }

          // 自动补全路径
          if (endpoint && !endpoint.endsWith('/embeddings')) {
              endpoint = endpoint.replace(/\/+$/, '') + '/embeddings';
          }

          // 构建 models 端点
          let modelsEndpoint = endpoint.replace('/embeddings', '/models');

          btn.textContent = '获取中...';
          btn.disabled = true;
          modelHint.style.color = '#6b7280';
          modelHint.textContent = '正在获取模型列表...';

          try {
              const response = await fetch(modelsEndpoint, {
                  headers: {
                      'Authorization': `Bearer ${apiKey}`,
                      'Content-Type': 'application/json'
                  }
              });

              if (!response.ok) {
                  throw new Error(`HTTP ${response.status}: ${response.statusText}`);
              }

              const data = await response.json();
              const models = data.data || [];

              // 过滤出嵌入模型（支持多种命名模式）
              const embeddingModels = models.filter(m => {
                  const id = (m.id || '').toLowerCase();
                  return id.includes('embedding') ||
                         id.includes('embed') ||
                         id.includes('bge') ||
                         id.includes('text-similarity') ||
                         id.includes('sentence') ||
                         id.includes('vector');
              });

              if (embeddingModels.length === 0) {
                  modelHint.style.color = '#f59e0b';
                  modelHint.textContent = `⚠️ 未找到嵌入模型（共 ${models.length} 个模型）`;
                  setTimeout(() => {
                      modelHint.style.color = '#6b7280';
                      modelHint.textContent = '可手动输入模型ID，或点击"获取列表"从服务器获取';
                  }, 3000);
                  return;
              }

              // 显示模型选择器
              showEmbeddingModelSelector(embeddingModels, modelInput);
              modelHint.style.color = '#059669';
              modelHint.textContent = `✅ 找到 ${embeddingModels.length} 个嵌入模型`;
              setTimeout(() => {
                  modelHint.style.color = '#6b7280';
                  modelHint.textContent = '可手动输入模型ID，或点击"获取列表"从服务器获取';
              }, 3000);

          } catch (error) {
              modelHint.style.color = '#dc2626';
              modelHint.textContent = `❌ 获取失败: ${error.message}`;
              setTimeout(() => {
                  modelHint.style.color = '#6b7280';
                  modelHint.textContent = '可手动输入模型ID，或点击"获取列表"从服务器获取';
              }, 3000);
          } finally {
              btn.textContent = '获取列表';
              btn.disabled = false;
          }
      };

      // 测试连接
      $('emb-test-km').onclick = async () => {
          const btn = $('emb-test-km');
          const result = $('emb-test-result-km');

          let baseUrl = $('emb-endpoint-km').value.trim();
          // 自动补全 /embeddings 路径
          if (baseUrl && !baseUrl.endsWith('/embeddings')) {
              baseUrl = baseUrl.replace(/\/+$/, '') + '/embeddings';
          }

          const testConfig = {
              provider: $('emb-provider-km').value,
              apiKey: $('emb-api-key-km').value,
              endpoint: baseUrl,
              model: $('emb-model-km').value,
              dimensions: parseInt($('emb-dimensions-km').value) || null
          };

          if (!testConfig.apiKey || !testConfig.endpoint || !testConfig.model) {
              result.style.display = 'block';
              result.style.color = '#dc2626';
              result.textContent = '❌ 请填写完整配置';
              return;
          }

          btn.disabled = true;
          btn.textContent = '测试中...';
          result.style.display = 'none';

          try {
              if (!window.EmbeddingClient || typeof window.EmbeddingClient.saveConfig !== 'function') {
                  const ok = await ensureEmbeddingClientLoaded();
                  if (!ok) throw new Error('EmbeddingClient 未加载');
              }
              window.EmbeddingClient.saveConfig({ ...testConfig, enabled: true });
              const vector = await window.EmbeddingClient.embed('测试文本');

              result.style.display = 'block';
              result.style.color = '#059669';
              result.textContent = `✅ 连接成功！向量维度: ${vector.length}`;
          } catch (error) {
              result.style.display = 'block';
              result.style.color = '#dc2626';
              result.textContent = `❌ 连接失败: ${error.message}`;
          } finally {
              btn.disabled = false;
              btn.textContent = '测试连接';
          }
      };

      // 保存配置
      $('emb-save-km').onclick = async () => {
          let baseUrl = $('emb-endpoint-km').value.trim();
          // 自动补全 /embeddings 路径
          if (baseUrl && !baseUrl.endsWith('/embeddings')) {
              baseUrl = baseUrl.replace(/\/+$/, '') + '/embeddings';
          }

          const newConfig = {
              enabled: $('emb-enabled-km').checked,
              provider: $('emb-provider-km').value,
              apiKey: $('emb-api-key-km').value,
              endpoint: baseUrl,
              model: $('emb-model-km').value,
              dimensions: parseInt($('emb-dimensions-km').value) || null,
              concurrency: Math.max(1, Math.min(parseInt($('emb-concurrency-km').value) || 5, 50))
          };

          if (!window.EmbeddingClient || typeof window.EmbeddingClient.saveConfig !== 'function') {
              const ok = await ensureEmbeddingClientLoaded();
              if (!ok) { alert('❌ 保存失败：EmbeddingClient 未加载'); return; }
          }
          window.EmbeddingClient.saveConfig(newConfig);
          if (typeof showNotification === 'function') {
              showNotification('向量搜索配置已保存', 'success');
          } else {
              alert('配置已保存');
          }
      };

      // Rerank: 服务商切换（仅 OpenAI 格式显示“获取列表”）
      $('rerank-provider-km').onchange = function() {
          const provider = this.value;
          const fetchBtn = $('rerank-fetch-models-km');
          const hint = $('rerank-model-hint-km');
          const endpointInput = $('rerank-endpoint-km');

          if (provider === 'openai') {
              fetchBtn.style.display = 'block';
              hint.textContent = '可手动输入模型ID，或点击"获取列表"从服务器获取';
              if (!endpointInput.value.trim()) endpointInput.placeholder = 'https://api.openai.com/v1';
          } else {
              fetchBtn.style.display = 'none';
              hint.textContent = '请输入服务商支持的重排模型ID';
              if (!endpointInput.value.trim()) {
                  endpointInput.placeholder = provider === 'jina' ? 'https://api.jina.ai/v1' : 'https://api.cohere.ai/v1';
              }
          }
      };

      // 初始化 Rerank 提示与按钮显示
      (function() {
          const provider = ($('rerank-provider-km')?.value) || 'jina';
          const fetchBtn = $('rerank-fetch-models-km');
          const hint = $('rerank-model-hint-km');
          const endpointInput = $('rerank-endpoint-km');
          if (provider === 'openai') {
              fetchBtn.style.display = 'block';
              hint.textContent = '可手动输入模型ID，或点击"获取列表"从服务器获取';
              if (!endpointInput.value.trim()) endpointInput.placeholder = 'https://api.openai.com/v1';
          } else {
              fetchBtn.style.display = 'none';
              hint.textContent = '请输入服务商支持的重排模型ID';
          }
      })();

      // Rerank: 获取模型列表（OpenAI 格式）
      $('rerank-fetch-models-km').onclick = async () => {
          const btn = $('rerank-fetch-models-km');
          const modelInput = $('rerank-model-km');
          const hint = $('rerank-model-hint-km');
          const apiKey = $('rerank-api-key-km').value;
          let baseUrl = $('rerank-endpoint-km').value.trim();

          if (!apiKey) {
              hint.style.color = '#dc2626';
              hint.textContent = '❌ 请先输入 API Key';
              setTimeout(() => { hint.style.color = '#6b7280'; hint.textContent = '可手动输入模型ID，或点击"获取列表"从服务器获取'; }, 3000);
              return;
          }

          if (!baseUrl) {
              baseUrl = 'https://api.openai.com/v1';
          }

          const modelsEndpoint = baseUrl.replace(/\/+$/, '') + '/models';

          btn.textContent = '获取中...';
          btn.disabled = true;
          hint.style.color = '#6b7280';
          hint.textContent = '正在获取模型列表...';

          try {
              const response = await fetch(modelsEndpoint, { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' } });
              if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
              const data = await response.json();
              const models = data.data || [];
              const rerankModels = models.filter(m => {
                  const id = (m.id || '').toLowerCase();
                  return id.includes('rerank') || id.includes('rank') || id.includes('relevance') || id.includes('search');
              });
              const list = rerankModels.length > 0 ? rerankModels : models;
              if (list.length === 0) {
                  hint.style.color = '#f59e0b';
                  hint.textContent = '⚠️ 未从服务端获取到模型列表';
                  setTimeout(() => { hint.style.color = '#6b7280'; hint.textContent = '可手动输入模型ID，或点击"获取列表"从服务器获取'; }, 3000);
                  return;
              }
              showRerankModelSelector(list, modelInput);
              hint.style.color = '#059669';
              hint.textContent = `✅ 找到 ${list.length} 个模型`;
              setTimeout(() => { hint.style.color = '#6b7280'; hint.textContent = '可手动输入模型ID，或点击"获取列表"从服务器获取'; }, 3000);
          } catch (error) {
              hint.style.color = '#dc2626';
              hint.textContent = `❌ 获取失败: ${error.message}`;
              setTimeout(() => { hint.style.color = '#6b7280'; hint.textContent = '可手动输入模型ID，或点击"获取列表"从服务器获取'; }, 3000);
          } finally {
              btn.textContent = '获取列表';
              btn.disabled = false;
          }
      };

      // Rerank: 模型检测
      $('rerank-check-model-km').onclick = async () => {
          const btn = $('rerank-check-model-km');
          const modelId = $('rerank-model-km').value.trim();
          const provider = $('rerank-provider-km').value;
          const apiKey = $('rerank-api-key-km').value;
          let baseUrl = $('rerank-endpoint-km').value.trim();
          const hint = $('rerank-model-hint-km');

          if (!modelId) {
              hint.style.color = '#dc2626';
              hint.textContent = '❌ 请输入模型ID';
              setTimeout(() => { hint.style.color = '#6b7280'; hint.textContent = '请输入服务商支持的重排模型ID；OpenAI格式可点击“获取列表”'; }, 2500);
              return;
          }
          if (!apiKey) {
              hint.style.color = '#dc2626';
              hint.textContent = '❌ 请输入 API Key';
              setTimeout(() => { hint.style.color = '#6b7280'; hint.textContent = '请输入服务商支持的重排模型ID；OpenAI格式可点击“获取列表”'; }, 2500);
              return;
          }

          btn.disabled = true;
          btn.textContent = '检测中...';
          hint.style.color = '#6b7280';
          hint.textContent = '正在检测模型...';

          try {
              if (provider === 'openai') {
                  if (!baseUrl) baseUrl = 'https://api.openai.com/v1';
                  const modelsEndpoint = baseUrl.replace(/\/+$/, '') + '/models';
                  const resp = await fetch(modelsEndpoint, { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' } });
                  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
                  const data = await resp.json();
                  const models = (data.data || []).map(m => m.id);
                  if (models.includes(modelId)) {
                      hint.style.color = '#059669';
                      hint.textContent = '✅ 模型可用';
                  } else {
                      hint.style.color = '#f59e0b';
                      hint.textContent = '⚠️ 未在列表中找到该模型（可能仍可用）';
                  }
              } else {
                  const endpoint = (baseUrl || (provider === 'jina' ? 'https://api.jina.ai/v1' : 'https://api.cohere.ai/v1')).replace(/\/+$/, '') + '/rerank';
                  const resp = await fetch(endpoint, {
                      method: 'POST',
                      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                      body: JSON.stringify({ model: modelId, query: 'ping', documents: ['pong'], top_n: 1 })
                  });
                  if (resp.ok) {
                      hint.style.color = '#059669';
                      hint.textContent = '✅ 模型可用';
                  } else {
                      const text = await resp.text();
                      throw new Error(`${resp.status} ${text}`);
                  }
              }
          } catch (error) {
              hint.style.color = '#dc2626';
              hint.textContent = `❌ 检测失败: ${error.message}`;
          } finally {
              btn.disabled = false;
              btn.textContent = '检测模型';
          }
      };

      // 重排测试连接
      $('rerank-test-km').onclick = async () => {
          const btn = $('rerank-test-km');
          const result = $('rerank-test-result-km');

          // 自动补全 /rerank 路径
          let rerankBase = $('rerank-endpoint-km').value.trim();
          if (rerankBase && !/\/rerank\/?$/.test(rerankBase)) {
              rerankBase = rerankBase.replace(/\/+$/, '') + '/rerank';
          }

          const testConfig = {
              provider: $('rerank-provider-km').value,
              apiKey: $('rerank-api-key-km').value,
              endpoint: rerankBase,
              model: $('rerank-model-km').value,
              topN: parseInt($('rerank-top-n-km').value) || 10
          };

          if (!testConfig.apiKey || !testConfig.model) {
              result.style.display = 'block';
              result.style.color = '#dc2626';
              result.textContent = '❌ 请填写完整配置';
              return;
          }

          btn.disabled = true;
          btn.textContent = '测试中...';
          result.style.display = 'none';

          try {
              if (!window.RerankClient) {
                  throw new Error('RerankClient 未加载');
              }

              window.RerankClient.saveConfig({ ...testConfig, enabled: true });
              const testQuery = '测试查询';
              const testDocs = ['文档1内容', '文档2内容', '文档3内容'];
              const results = await window.RerankClient.rerank(testQuery, testDocs);

              result.style.display = 'block';
              result.style.color = '#059669';
              result.textContent = `✅ 连接成功！返回 ${results.length} 个结果`;
          } catch (error) {
              result.style.display = 'block';
              result.style.color = '#dc2626';
              result.textContent = `❌ 连接失败: ${error.message}`;
          } finally {
              btn.disabled = false;
              btn.textContent = '测试连接';
          }
      };

      // 重排保存配置（补全 /rerank）
      $('rerank-save-km').onclick = () => {
          // 获取选中的scope
          const scopeRadios = document.getElementsByName('rerank-scope-km');
          let scope = 'vector-only';
          for (const radio of scopeRadios) {
              if (radio.checked) {
                  scope = radio.value;
                  break;
              }
          }

          // 自动补全 /rerank 路径
          let rerankBase = $('rerank-endpoint-km').value.trim();
          if (rerankBase && !/\/rerank\/?$/.test(rerankBase)) {
              rerankBase = rerankBase.replace(/\/+$/, '') + '/rerank';
          }

          const newConfig = {
              enabled: $('rerank-enabled-km').checked,
              scope: scope,
              provider: $('rerank-provider-km').value,
              apiKey: $('rerank-api-key-km').value,
              endpoint: rerankBase,
              model: $('rerank-model-km').value,
              topN: parseInt($('rerank-top-n-km').value) || 10
          };

          if (!window.RerankClient) {
              alert('RerankClient 未加载');
              return;
          }

          window.RerankClient.saveConfig(newConfig);
          if (typeof showNotification === 'function') {
              showNotification('重排配置已保存', 'success');
          } else {
              alert('配置已保存');
          }
      };
  }

  // 导出到全局作用域
  window.UIEmbeddingConfigRenderer = {
    renderEmbeddingConfig
  };

})(window);

// ESM 导出
