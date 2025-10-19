/**
 * UI OCR 配置渲染模块
 * 提取 OCR 引擎（Mistral、MinerU、Doc2X）的配置界面渲染代码
 */

(function(window) {
  'use strict';

  /**
   * 渲染 Mistral OCR 配置界面
   * @param {HTMLElement} container - 配置容器元素（modelConfigColumn）
   */
  function renderMistralOcrConfig(container) {
    const configDiv = document.createElement('div');
    configDiv.className = 'space-y-3';

    const noticeDiv = document.createElement('div');
    noticeDiv.className = 'bg-purple-50 border border-purple-200 rounded-md p-3 text-sm text-gray-700';
    noticeDiv.innerHTML = `
      <p class="font-semibold mb-1">📝 Mistral OCR Keys 管理</p>
      <ul class="list-disc list-inside space-y-1 text-xs">
        <li>请在下方"Key 管理器"中添加/测试 Mistral API Keys（每个 Key 独立管理）。</li>
        <li>系统会在 OCR 时按顺序轮询可用 Key，实现负载均衡与容错。</li>
      </ul>
    `;
    configDiv.appendChild(noticeDiv);

    // Base URL 配置
    const baseUrlDiv = document.createElement('div');
    const currentBaseUrl = localStorage.getItem('ocrMistralBaseUrl') || 'https://api.mistral.ai';
    baseUrlDiv.innerHTML = `
      <label class="block text-sm font-medium text-gray-700 mb-1">API Base URL</label>
      <input type="text" id="mistral-base-url-km" value="${currentBaseUrl}" placeholder="https://api.mistral.ai" class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500">
      <p class="mt-1 text-xs text-gray-500">默认: https://api.mistral.ai，如需使用第三方代理可在此修改</p>
    `;
    configDiv.appendChild(baseUrlDiv);

    // 保存按钮
    const saveBtn = document.createElement('button');
    saveBtn.textContent = '保存配置';
    saveBtn.className = 'px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-md transition-colors';
    saveBtn.addEventListener('click', () => {
      const baseUrlInput = document.getElementById('mistral-base-url-km');
      if (baseUrlInput) {
        const newBaseUrl = baseUrlInput.value.trim() || 'https://api.mistral.ai';
        localStorage.setItem('ocrMistralBaseUrl', newBaseUrl);
        if (typeof showNotification === 'function') {
          showNotification('Mistral OCR 配置已保存', 'success');
        }
      }
    });
    configDiv.appendChild(saveBtn);

    container.appendChild(configDiv);
  }

  /**
   * 渲染 MinerU OCR 配置界面
   * @param {HTMLElement} container - 配置容器元素（modelConfigColumn）
   */
  function renderMinerUConfig(container) {
    // 从 localStorage 加载配置
    const workerUrl = localStorage.getItem('ocrMinerUWorkerUrl') || '';
    const authKey = localStorage.getItem('ocrWorkerAuthKey') || '';
    const tokenMode = localStorage.getItem('ocrMinerUTokenMode') || 'frontend';
    const token = localStorage.getItem('ocrMinerUToken') || '';

    const configDiv = document.createElement('div');
    configDiv.className = 'space-y-4';

    // Worker URL
    const urlDiv = document.createElement('div');
    urlDiv.innerHTML = `
      <label class="block text-sm font-medium text-gray-700 mb-1">Worker URL</label>
      <input type="text" id="mineru-worker-url-km" value="${workerUrl}" placeholder="https://your-worker.workers.dev" class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500">
      <p class="mt-1 text-xs text-gray-500">Cloudflare Worker 代理地址</p>
    `;
    configDiv.appendChild(urlDiv);

    // Worker Auth Key (可选)
    const authKeyDiv = document.createElement('div');
    authKeyDiv.innerHTML = `
      <label class="block text-sm font-medium text-gray-700 mb-1">Worker Auth Key（可选）</label>
      <div class="flex items-center gap-2">
        <input type="password" id="mineru-auth-key-km" value="${authKey}" placeholder="如果 Worker 启用了访问控制，填写这里" class="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500">
        <button type="button" id="mineru-auth-key-toggle" class="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md transition-colors flex items-center gap-1">
          <iconify-icon icon="carbon:view" width="16"></iconify-icon>
          <span>显示</span>
        </button>
      </div>
      <p class="mt-1 text-xs text-gray-500">对应 Worker 环境变量 <code class="bg-gray-100 px-1 rounded">AUTH_SECRET</code>（如果启用了 <code class="bg-gray-100 px-1 rounded">ENABLE_AUTH</code>）</p>
    `;
    configDiv.appendChild(authKeyDiv);

    // Token 配置模式
    const tokenModeDiv = document.createElement('div');
    tokenModeDiv.className = 'border-t pt-4';
    tokenModeDiv.innerHTML = `
      <label class="block text-sm font-medium text-gray-700 mb-2">MinerU Token 配置模式</label>
      <div class="flex items-center gap-6">
        <label class="flex items-center cursor-pointer">
          <input type="radio" name="mineru-token-mode" value="frontend" ${tokenMode === 'frontend' ? 'checked' : ''} class="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500">
          <span class="ml-2 text-sm text-gray-700">前端透传模式（推荐）</span>
        </label>
        <label class="flex items-center cursor-pointer">
          <input type="radio" name="mineru-token-mode" value="worker" ${tokenMode === 'worker' ? 'checked' : ''} class="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500">
          <span class="ml-2 text-sm text-gray-700">Worker 配置模式</span>
        </label>
      </div>
    `;
    configDiv.appendChild(tokenModeDiv);

    // 前端透传 Token 输入框
    const frontendTokenDiv = document.createElement('div');
    frontendTokenDiv.id = 'mineru-frontend-token-div';
    frontendTokenDiv.style.display = tokenMode === 'frontend' ? 'block' : 'none';
    frontendTokenDiv.innerHTML = `
      <label class="block text-sm font-medium text-gray-700 mb-1">MinerU Token</label>
      <div class="flex items-center gap-2">
        <input type="password" id="mineru-token-km" value="${token}" placeholder="eyJ0eXBlIjoiSldUIi..." class="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500">
        <button type="button" id="mineru-token-toggle" class="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md transition-colors flex items-center gap-1">
          <iconify-icon icon="carbon:view" width="16"></iconify-icon>
          <span>显示</span>
        </button>
      </div>
      <p class="mt-1 text-xs text-gray-500">从 https://mineru.net 获取，格式：JWT（eyJ 开头）</p>
      <div class="mt-2 text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded p-2">
        💡 <strong>前端透传模式</strong>：通过请求头（<code class="bg-blue-100 px-1 rounded">X-MinerU-Key</code>）传递 Token，Worker 无需配置 <code class="bg-blue-100 px-1 rounded">MINERU_API_TOKEN</code>
      </div>
    `;
    configDiv.appendChild(frontendTokenDiv);

    // Worker 配置模式提示
    const workerTokenDiv = document.createElement('div');
    workerTokenDiv.id = 'mineru-worker-token-div';
    workerTokenDiv.style.display = tokenMode === 'worker' ? 'block' : 'none';
    workerTokenDiv.innerHTML = `
      <div class="text-xs text-orange-600 bg-orange-50 border border-orange-200 rounded p-2">
        💡 <strong>Worker 配置模式</strong>：MinerU Token 存储在 Worker 环境变量（MINERU_API_TOKEN）中，前端不需要提供
      </div>
    `;
    configDiv.appendChild(workerTokenDiv);

    // 选项
    const enableOcr = localStorage.getItem('ocrMinerUEnableOcr') !== 'false';
    const enableFormula = localStorage.getItem('ocrMinerUEnableFormula') !== 'false';
    const enableTable = localStorage.getItem('ocrMinerUEnableTable') !== 'false';

    const optionsDiv = document.createElement('div');
    optionsDiv.className = 'border-t pt-4';
    optionsDiv.innerHTML = `
      <label class="block text-sm font-medium text-gray-700 mb-2">OCR 选项</label>
      <div class="flex items-center gap-6">
        <div class="flex items-center gap-2">
          <input type="checkbox" id="mineru-enable-ocr-km" ${enableOcr ? 'checked' : ''} class="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500">
          <label for="mineru-enable-ocr-km" class="text-sm text-gray-700">启用 OCR</label>
        </div>
        <div class="flex items-center gap-2">
          <input type="checkbox" id="mineru-enable-formula-km" ${enableFormula ? 'checked' : ''} class="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500">
          <label for="mineru-enable-formula-km" class="text-sm text-gray-700">启用公式识别</label>
        </div>
        <div class="flex items-center gap-2">
          <input type="checkbox" id="mineru-enable-table-km" ${enableTable ? 'checked' : ''} class="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500">
          <label for="mineru-enable-table-km" class="text-sm text-gray-700">启用表格识别</label>
        </div>
      </div>
    `;
    configDiv.appendChild(optionsDiv);

    // 测试/保存/设为当前引擎按钮
    const buttonsDiv = document.createElement('div');
    buttonsDiv.className = 'pt-2 grid grid-cols-1 sm:grid-cols-3 gap-2';
    buttonsDiv.innerHTML = `
      <button id="mineru-test-km" class="px-4 py-2 border border-gray-300 bg-white text-gray-700 rounded-md hover:bg-gray-50">测试连接</button>
      <button id="mineru-save-km" class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">保存配置</button>
      <button id="mineru-set-engine-km" class="px-4 py-2 bg-emerald-600 text-white rounded-md hover:bg-emerald-700" title="将 MinerU 设为当前 OCR 引擎">设为当前引擎</button>
    `;
    configDiv.appendChild(buttonsDiv);

    // 测试结果显示
    const mineruResultDiv = document.createElement('div');
    mineruResultDiv.id = 'mineru-test-result-km';
    mineruResultDiv.className = 'text-sm mt-2';
    mineruResultDiv.style.display = 'none';
    configDiv.appendChild(mineruResultDiv);

    container.appendChild(configDiv);

    // Token 模式切换事件
    document.querySelectorAll('input[name="mineru-token-mode"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        const mode = e.target.value;
        document.getElementById('mineru-frontend-token-div').style.display = mode === 'frontend' ? 'block' : 'none';
        document.getElementById('mineru-worker-token-div').style.display = mode === 'worker' ? 'block' : 'none';
      });
    });

    // Auth Key 显示/隐藏切换
    const authKeyToggle = document.getElementById('mineru-auth-key-toggle');
    const authKeyInput = document.getElementById('mineru-auth-key-km');
    if (authKeyToggle && authKeyInput) {
      authKeyToggle.addEventListener('click', () => {
        const isPassword = authKeyInput.type === 'password';
        authKeyInput.type = isPassword ? 'text' : 'password';
        authKeyToggle.innerHTML = isPassword ?
          '<iconify-icon icon="carbon:view-off" width="16"></iconify-icon>隐藏' :
          '<iconify-icon icon="carbon:view" width="16"></iconify-icon>显示';
      });
    }

    // Token 显示/隐藏切换
    const tokenToggle = document.getElementById('mineru-token-toggle');
    const tokenInput = document.getElementById('mineru-token-km');
    if (tokenToggle && tokenInput) {
      tokenToggle.addEventListener('click', () => {
        const isPassword = tokenInput.type === 'password';
        tokenInput.type = isPassword ? 'text' : 'password';
        tokenToggle.innerHTML = isPassword ?
          '<iconify-icon icon="carbon:view-off" width="16"></iconify-icon>隐藏' :
          '<iconify-icon icon="carbon:view" width="16"></iconify-icon>显示';
      });
    }

    // 保存配置
    document.getElementById('mineru-save-km').onclick = () => {
      const selectedMode = document.querySelector('input[name="mineru-token-mode"]:checked').value;

      // 去掉末尾斜杠
      const workerUrl = document.getElementById('mineru-worker-url-km').value.trim().replace(/\/+$/, '');
      localStorage.setItem('ocrMinerUWorkerUrl', workerUrl);
      localStorage.setItem('ocrWorkerAuthKey', document.getElementById('mineru-auth-key-km').value.trim());
      localStorage.setItem('ocrMinerUTokenMode', selectedMode);

      if (selectedMode === 'frontend') {
        localStorage.setItem('ocrMinerUToken', document.getElementById('mineru-token-km').value.trim());
      }

      localStorage.setItem('ocrMinerUEnableOcr', document.getElementById('mineru-enable-ocr-km').checked.toString());
      localStorage.setItem('ocrMinerUEnableFormula', document.getElementById('mineru-enable-formula-km').checked.toString());
      localStorage.setItem('ocrMinerUEnableTable', document.getElementById('mineru-enable-table-km').checked.toString());

      if (typeof showNotification === 'function') {
        showNotification('MinerU OCR 配置已保存', 'success');
      } else {
        alert('配置已保存');
      }
      if (typeof window.renderModelList === 'function') window.renderModelList();
    };

    // 测试连接
    document.getElementById('mineru-test-km').onclick = async () => {
      const btn = document.getElementById('mineru-test-km');
      const result = document.getElementById('mineru-test-result-km');
      const wurl = document.getElementById('mineru-worker-url-km').value.trim();
      const akey = document.getElementById('mineru-auth-key-km').value.trim();
      const selectedMode = document.querySelector('input[name="mineru-token-mode"]:checked').value;
      const token = selectedMode === 'frontend' ? document.getElementById('mineru-token-km').value.trim() : '';

      result.style.display = 'none';
      btn.disabled = true; btn.textContent = '测试中...';
      try {
        if (!wurl) throw new Error('请先填写 Worker URL');

        const base = wurl.replace(/\/+$/, '');

        // 第一步：测试Worker可达性
        result.style.display = 'block';
        result.style.color = '#3b82f6';
        result.textContent = '🔄 正在测试Worker可达性...';

        const healthResp = await fetch(base + '/health', {
          headers: akey ? { 'X-Auth-Key': akey } : {}
        });

        if (!healthResp.ok) {
          throw new Error(`Worker不可达: ${healthResp.status} ${healthResp.statusText}`);
        }

        // 第二步：测试Token有效性（如果是前端模式）
        if (selectedMode === 'frontend') {
          if (!token) {
            throw new Error('前端模式下必须提供MinerU Token');
          }

          result.style.color = '#3b82f6';
          result.textContent = '🔄 正在验证Token有效性...';

          const tokenTestResp = await fetch(base + '/mineru/result/__health__', {
            headers: {
              'X-Auth-Key': akey || '',
              'X-MinerU-Key': token
            }
          });

          const tokenTestData = await tokenTestResp.json();

          if (!tokenTestResp.ok || !tokenTestData.success) {
            throw new Error(`Token无效: ${tokenTestData.message || tokenTestData.error || '未知错误'}`);
          }

          result.style.color = '#059669';
          result.textContent = '✅ Worker可达且Token有效';
        } else {
          // Worker模式：只需要验证Worker可达性
          result.style.color = '#059669';
          result.textContent = '✅ Worker可达（Worker模式，Token由Worker配置）';
        }
      } catch (e) {
        result.style.display = 'block';
        result.style.color = '#dc2626';
        result.textContent = `❌ 测试失败: ${e.message}`;
      } finally {
        btn.disabled = false; btn.textContent = '测试连接';
      }
    };

    // 设为当前 OCR 引擎
    document.getElementById('mineru-set-engine-km').onclick = () => {
      try {
        localStorage.setItem('ocrEngine', 'mineru');
        if (window.ocrSettingsManager && typeof window.ocrSettingsManager.loadSettings === 'function') {
          window.ocrSettingsManager.loadSettings();
        }
        if (typeof showNotification === 'function') {
          showNotification('已将 MinerU 设为当前 OCR 引擎', 'success');
        }
      } catch (e) {
        alert('设为当前引擎失败');
      }
    };
  }

  /**
   * 渲染 Doc2X OCR 配置界面
   * @param {HTMLElement} container - 配置容器元素（modelConfigColumn）
   */
  function renderDoc2XConfig(container) {
    // 从 localStorage 加载配置
    const workerUrl = localStorage.getItem('ocrDoc2XWorkerUrl') || '';
    const authKey = localStorage.getItem('ocrWorkerAuthKey') || '';
    const tokenMode = localStorage.getItem('ocrDoc2XTokenMode') || 'frontend';
    const token = localStorage.getItem('ocrDoc2XToken') || '';

    const configDiv = document.createElement('div');
    configDiv.className = 'space-y-4';

    // Worker URL
    const urlDiv = document.createElement('div');
    urlDiv.innerHTML = `
      <label class="block text-sm font-medium text-gray-700 mb-1">Worker URL</label>
      <input type="text" id="doc2x-worker-url-km" value="${workerUrl}" placeholder="https://your-worker.workers.dev" class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500">
      <p class="mt-1 text-xs text-gray-500">Cloudflare Worker 代理地址</p>
    `;
    configDiv.appendChild(urlDiv);

    // Worker Auth Key (可选)
    const authKeyDiv = document.createElement('div');
    authKeyDiv.innerHTML = `
      <label class="block text-sm font-medium text-gray-700 mb-1">Worker Auth Key（可选）</label>
      <div class="flex items-center gap-2">
        <input type="password" id="doc2x-auth-key-km" value="${authKey}" placeholder="如果 Worker 启用了访问控制，填写这里" class="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500">
        <button type="button" id="doc2x-auth-key-toggle" class="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md transition-colors flex items-center gap-1">
          <iconify-icon icon="carbon:view" width="16"></iconify-icon>
          <span>显示</span>
        </button>
      </div>
      <p class="mt-1 text-xs text-gray-500">对应 Worker 环境变量 <code class="bg-gray-100 px-1 rounded">AUTH_SECRET</code>（如果启用了 <code class="bg-gray-100 px-1 rounded">ENABLE_AUTH</code>）</p>
    `;
    configDiv.appendChild(authKeyDiv);

    // Token 配置模式选择
    const tokenModeDiv = document.createElement('div');
    tokenModeDiv.className = 'border-t pt-4';
    tokenModeDiv.innerHTML = `
      <label class="block text-sm font-medium text-gray-700 mb-2">Doc2X Token 配置模式</label>
      <div class="flex items-center gap-6">
        <label class="flex items-center cursor-pointer">
          <input type="radio" name="doc2x-token-mode" value="frontend" ${tokenMode === 'frontend' ? 'checked' : ''} class="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500">
          <span class="ml-2 text-sm text-gray-700">前端透传模式（推荐）</span>
        </label>
        <label class="flex items-center cursor-pointer">
          <input type="radio" name="doc2x-token-mode" value="worker" ${tokenMode === 'worker' ? 'checked' : ''} class="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500">
          <span class="ml-2 text-sm text-gray-700">Worker 配置模式</span>
        </label>
      </div>
    `;
    configDiv.appendChild(tokenModeDiv);

    // 前端透传模式 - Token 输入
    const frontendTokenDiv = document.createElement('div');
    frontendTokenDiv.id = 'doc2x-frontend-token-div';
    frontendTokenDiv.style.display = tokenMode === 'frontend' ? 'block' : 'none';
    frontendTokenDiv.innerHTML = `
      <label class="block text-sm font-medium text-gray-700 mb-1">Doc2X Token</label>
      <div class="flex items-center gap-2">
        <input type="password" id="doc2x-token-km" value="${token}" placeholder="your-doc2x-token" class="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500">
        <button type="button" id="doc2x-token-toggle" class="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md transition-colors flex items-center gap-1">
          <iconify-icon icon="carbon:view" width="16"></iconify-icon>
          <span>显示</span>
        </button>
      </div>
      <div class="mt-2 text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded p-2">
        💡 <strong>前端透传模式</strong>：通过请求头（<code class="bg-blue-100 px-1 rounded">X-Doc2X-Key</code>）传递 Token，Worker 无需配置 <code class="bg-blue-100 px-1 rounded">DOC2X_API_TOKEN</code>
      </div>
    `;
    configDiv.appendChild(frontendTokenDiv);

    // Worker 配置模式 - 提示
    const workerTokenDiv = document.createElement('div');
    workerTokenDiv.id = 'doc2x-worker-token-div';
    workerTokenDiv.style.display = tokenMode === 'worker' ? 'block' : 'none';
    workerTokenDiv.innerHTML = `
      <div class="text-xs text-orange-600 bg-orange-50 border border-orange-200 rounded p-2">
        💡 <strong>Worker 配置模式</strong>：Doc2X Token 存储在 Worker 环境变量（<code class="bg-orange-100 px-1 rounded">DOC2X_API_TOKEN</code>）中，前端不需要提供
      </div>
    `;
    configDiv.appendChild(workerTokenDiv);

    // 说明
    const noticeDiv = document.createElement('div');
    noticeDiv.className = 'bg-blue-50 border border-blue-200 rounded-md p-3 text-sm text-gray-700';
    noticeDiv.innerHTML = `
      <p class="text-xs">📝 <strong>Doc2X OCR 特性</strong>：支持图片和复杂排版识别，公式使用 Dollar 格式 ($...$)</p>
    `;
    configDiv.appendChild(noticeDiv);

    // 测试/保存/设为当前引擎按钮
    const buttonsDiv = document.createElement('div');
    buttonsDiv.className = 'pt-2 grid grid-cols-1 sm:grid-cols-3 gap-2';
    buttonsDiv.innerHTML = `
      <button id="doc2x-test-km" class="px-4 py-2 border border-gray-300 bg-white text-gray-700 rounded-md hover:bg-gray-50">测试连接</button>
      <button id="doc2x-save-km" class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">保存配置</button>
      <button id="doc2x-set-engine-km" class="px-4 py-2 bg-emerald-600 text-white rounded-md hover:bg-emerald-700" title="将 Doc2X 设为当前 OCR 引擎">设为当前引擎</button>
    `;
    configDiv.appendChild(buttonsDiv);

    // 测试结果显示
    const doc2xResultDiv = document.createElement('div');
    doc2xResultDiv.id = 'doc2x-test-result-km';
    doc2xResultDiv.className = 'text-sm mt-2';
    doc2xResultDiv.style.display = 'none';
    configDiv.appendChild(doc2xResultDiv);

    container.appendChild(configDiv);

    // 模式切换事件处理
    document.querySelectorAll('input[name="doc2x-token-mode"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        const mode = e.target.value;
        document.getElementById('doc2x-frontend-token-div').style.display = mode === 'frontend' ? 'block' : 'none';
        document.getElementById('doc2x-worker-token-div').style.display = mode === 'worker' ? 'block' : 'none';
      });
    });

    // Auth Key 显示/隐藏切换
    const authKeyToggle = document.getElementById('doc2x-auth-key-toggle');
    const authKeyInput = document.getElementById('doc2x-auth-key-km');
    if (authKeyToggle && authKeyInput) {
      authKeyToggle.addEventListener('click', () => {
        const isPassword = authKeyInput.type === 'password';
        authKeyInput.type = isPassword ? 'text' : 'password';
        authKeyToggle.innerHTML = isPassword ?
          '<iconify-icon icon="carbon:view-off" width="16"></iconify-icon>隐藏' :
          '<iconify-icon icon="carbon:view" width="16"></iconify-icon>显示';
      });
    }

    // Token 显示/隐藏切换
    const tokenToggle = document.getElementById('doc2x-token-toggle');
    const tokenInput = document.getElementById('doc2x-token-km');
    if (tokenToggle && tokenInput) {
      tokenToggle.addEventListener('click', () => {
        const isPassword = tokenInput.type === 'password';
        tokenInput.type = isPassword ? 'text' : 'password';
        tokenToggle.innerHTML = isPassword ?
          '<iconify-icon icon="carbon:view-off" width="16"></iconify-icon>隐藏' :
          '<iconify-icon icon="carbon:view" width="16"></iconify-icon>显示';
      });
    }

    // 保存配置
    document.getElementById('doc2x-save-km').onclick = () => {
      const selectedMode = document.querySelector('input[name="doc2x-token-mode"]:checked').value;

      // 去掉末尾斜杠
      const workerUrl = document.getElementById('doc2x-worker-url-km').value.trim().replace(/\/+$/, '');
      localStorage.setItem('ocrDoc2XWorkerUrl', workerUrl);
      localStorage.setItem('ocrWorkerAuthKey', document.getElementById('doc2x-auth-key-km').value.trim());
      localStorage.setItem('ocrDoc2XTokenMode', selectedMode);

      if (selectedMode === 'frontend') {
        localStorage.setItem('ocrDoc2XToken', document.getElementById('doc2x-token-km').value.trim());
      }

      if (typeof showNotification === 'function') {
        showNotification('Doc2X OCR 配置已保存', 'success');
      } else {
        alert('配置已保存');
      }
      if (typeof window.renderModelList === 'function') window.renderModelList();
    };

    // 测试连接
    document.getElementById('doc2x-test-km').onclick = async () => {
      const btn = document.getElementById('doc2x-test-km');
      const result = document.getElementById('doc2x-test-result-km');
      const wurl = document.getElementById('doc2x-worker-url-km').value.trim();
      const akey = document.getElementById('doc2x-auth-key-km').value.trim();
      const selectedMode = document.querySelector('input[name="doc2x-token-mode"]:checked').value;
      const token = selectedMode === 'frontend' ? document.getElementById('doc2x-token-km').value.trim() : '';

      result.style.display = 'none';
      btn.disabled = true; btn.textContent = '测试中...';
      try {
        if (!wurl) throw new Error('请先填写 Worker URL');

        const base = wurl.replace(/\/+$/, '');

        // 第一步：测试Worker可达性
        result.style.display = 'block';
        result.style.color = '#3b82f6';
        result.textContent = '🔄 正在测试Worker可达性...';

        const healthResp = await fetch(base + '/health', {
          headers: akey ? { 'X-Auth-Key': akey } : {}
        });

        if (!healthResp.ok) {
          throw new Error(`Worker不可达: ${healthResp.status} ${healthResp.statusText}`);
        }

        // 第二步：测试Token有效性（如果是前端模式）
        if (selectedMode === 'frontend') {
          if (!token) {
            throw new Error('前端模式下必须提供Doc2X Token');
          }

          result.style.color = '#3b82f6';
          result.textContent = '🔄 正在验证Token有效性...';

          const tokenTestResp = await fetch(base + '/doc2x/status/__health__', {
            headers: {
              'X-Auth-Key': akey || '',
              'X-Doc2X-Key': token
            }
          });

          const tokenTestData = await tokenTestResp.json();

          if (!tokenTestResp.ok || !tokenTestData.success) {
            throw new Error(`Token无效: ${tokenTestData.message || tokenTestData.error || '未知错误'}`);
          }

          result.style.color = '#059669';
          result.textContent = '✅ Worker可达且Token有效';
        } else {
          // Worker模式：只需要验证Worker可达性
          result.style.color = '#059669';
          result.textContent = '✅ Worker可达（Worker模式，Token由Worker配置）';
        }
      } catch (e) {
        result.style.display = 'block';
        result.style.color = '#dc2626';
        result.textContent = `❌ 测试失败: ${e.message}`;
      } finally {
        btn.disabled = false; btn.textContent = '测试连接';
      }
    };

    // 设为当前 OCR 引擎
    document.getElementById('doc2x-set-engine-km').onclick = () => {
      try {
        localStorage.setItem('ocrEngine', 'doc2x');
        if (window.ocrSettingsManager && typeof window.ocrSettingsManager.loadSettings === 'function') {
          window.ocrSettingsManager.loadSettings();
        }
        if (typeof showNotification === 'function') {
          showNotification('已将 Doc2X 设为当前 OCR 引擎', 'success');
        }
      } catch (e) {
        alert('设为当前引擎失败');
      }
    };
  }

  // 导出到全局作用域
  window.UIModelOcrConfigRenderer = {
    renderMistralOcrConfig,
    renderMinerUConfig,
    renderDoc2XConfig
  };

})(window);
