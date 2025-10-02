// js/chatbot/ui/embedding-config-ui.js
// Embedding API 配置面板
(function(window, document) {
  'use strict';

  if (window.EmbeddingConfigUILoaded) return;

  const PRESETS = {
    openai: {
      name: 'OpenAI',
      endpoint: 'https://api.openai.com/v1/embeddings',
      models: [
        { id: 'text-embedding-3-small', name: 'text-embedding-3-small (推荐)', dims: 1536 },
        { id: 'text-embedding-3-large', name: 'text-embedding-3-large (高精度)', dims: 3072 },
        { id: 'text-embedding-ada-002', name: 'text-embedding-ada-002 (旧版)', dims: 1536 }
      ]
    },
    jina: {
      name: 'Jina AI',
      endpoint: 'https://api.jina.ai/v1/embeddings',
      models: [
        { id: 'jina-embeddings-v2-base-zh', name: 'jina-v2-base-zh (中文优化)', dims: 768 },
        { id: 'jina-embeddings-v2-base-en', name: 'jina-v2-base-en (英文)', dims: 768 }
      ]
    },
    custom: {
      name: '自定义',
      endpoint: '',
      models: [{ id: '', name: '自定义模型', dims: 1536 }]
    }
  };

  function createModal() {
    let modal = document.getElementById('embedding-config-modal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'embedding-config-modal';
    modal.style.cssText = `
      position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
      width: 520px; max-width: 90vw; max-height: 80vh;
      background: #fff; border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      display: none; z-index: 100001; padding: 0;
      overflow: hidden;
    `;

    modal.innerHTML = `
      <div style="padding: 20px 24px; border-bottom: 1px solid #e5e7eb;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <h3 style="margin: 0; font-size: 18px; font-weight: 600; color: #111827;">向量搜索配置</h3>
          <button id="emb-close-btn" style="border: none; background: none; font-size: 24px; color: #6b7280; cursor: pointer;">&times;</button>
        </div>
      </div>

      <div style="padding: 24px; max-height: calc(80vh - 70px); overflow-y: auto;">
        <!-- 启用开关 -->
        <div style="margin-bottom: 20px;">
          <label style="display: flex; align-items: center; cursor: pointer;">
            <input type="checkbox" id="emb-enabled" style="width: 18px; height: 18px; margin-right: 10px; cursor: pointer;">
            <span style="font-weight: 600; color: #111827;">启用向量搜索</span>
          </label>
          <p style="margin: 8px 0 0 28px; font-size: 13px; color: #6b7280;">启用后将使用语义相似度检索，提升检索准确率</p>
        </div>

        <!-- 服务商选择 -->
        <div style="margin-bottom: 20px;">
          <label style="display: block; margin-bottom: 8px; font-weight: 600; color: #374151;">服务商</label>
          <select id="emb-provider" style="width: 100%; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; background: #fff;">
            <option value="openai">OpenAI</option>
            <option value="jina">Jina AI (多语言优化)</option>
            <option value="custom">自定义 (兼容OpenAI格式)</option>
          </select>
        </div>

        <!-- API Key -->
        <div style="margin-bottom: 20px;">
          <label style="display: block; margin-bottom: 8px; font-weight: 600; color: #374151;">API Key</label>
          <input type="password" id="emb-api-key" placeholder="sk-..." style="width: 100%; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; box-sizing: border-box;">
        </div>

        <!-- API端点 -->
        <div id="emb-endpoint-wrap" style="margin-bottom: 20px; display: none;">
          <label style="display: block; margin-bottom: 8px; font-weight: 600; color: #374151;">
            Base URL
            <span style="font-weight: normal; color: #6b7280; font-size: 12px;">(如 https://api.openai.com/v1)</span>
          </label>
          <input type="text" id="emb-endpoint" placeholder="https://api.openai.com/v1" style="width: 100%; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; box-sizing: border-box;">
        </div>

        <!-- 模型选择 -->
        <div style="margin-bottom: 20px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <label style="font-weight: 600; color: #374151;">模型</label>
            <button id="emb-fetch-models-btn" style="padding: 4px 12px; border: 1px solid #d1d5db; background: #fff; color: #374151; border-radius: 6px; font-size: 12px; font-weight: 500; cursor: pointer; transition: all 0.2s; display: none;">
              获取模型列表
            </button>
          </div>
          <select id="emb-model" style="width: 100%; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; background: #fff;">
            <!-- 动态填充 -->
          </select>
          <div id="emb-model-loading" style="margin-top: 6px; font-size: 12px; color: #6b7280; display: none;">
            正在获取模型列表...
          </div>
        </div>

        <!-- 向量维度 (OpenAI可选) -->
        <div id="emb-dims-wrap" style="margin-bottom: 20px; display: none;">
          <label style="display: block; margin-bottom: 8px; font-weight: 600; color: #374151;">
            向量维度
            <span style="font-weight: normal; color: #6b7280; font-size: 12px;">(可选，留空使用默认)</span>
          </label>
          <input type="number" id="emb-dimensions" placeholder="1536" style="width: 100%; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; box-sizing: border-box;">
          <p style="margin: 6px 0 0 0; font-size: 12px; color: #6b7280;">降低维度可减少存储和计算，但可能影响精度</p>
        </div>

        <!-- 测试按钮 -->
        <div style="margin-bottom: 20px;">
          <button id="emb-test-btn" style="width: 100%; padding: 10px; border: 1px solid #d1d5db; background: #fff; color: #374151; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.2s;">
            测试连接
          </button>
          <div id="emb-test-result" style="margin-top: 8px; font-size: 13px; display: none;"></div>
        </div>

        <!-- 保存按钮 -->
        <div style="display: flex; gap: 12px;">
          <button id="emb-save-btn" style="flex: 1; padding: 12px; border: none; background: linear-gradient(135deg, #3b82f6, #2563eb); color: #fff; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s;">
            保存配置
          </button>
          <button id="emb-cancel-btn" style="flex: 1; padding: 12px; border: 1px solid #d1d5db; background: #fff; color: #374151; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s;">
            取消
          </button>
        </div>

        <!-- 索引管理 -->
        <div style="margin-top: 24px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
          <h4 style="margin: 0 0 12px 0; font-size: 14px; font-weight: 600; color: #374151;">索引管理</h4>
          <div id="emb-index-status" style="padding: 10px 12px; background: #f9fafb; border-radius: 6px; font-size: 13px; color: #6b7280; margin-bottom: 12px;">
            未建立索引
          </div>
          <div style="display: flex; gap: 8px;">
            <button id="emb-build-index-btn" style="flex: 1; padding: 8px; border: 1px solid #d1d5db; background: #fff; color: #374151; border-radius: 6px; font-size: 13px; cursor: pointer;">
              建立索引
            </button>
            <button id="emb-rebuild-index-btn" style="flex: 1; padding: 8px; border: 1px solid #d1d5db; background: #fff; color: #374151; border-radius: 6px; font-size: 13px; cursor: pointer;">
              重建索引
            </button>
          </div>
        </div>
      </div>
    `;

    // 遮罩层
    const overlay = document.createElement('div');
    overlay.id = 'embedding-config-overlay';
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.5); display: none; z-index: 9999;
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(modal);

    // 绑定事件
    bindEvents(modal, overlay);

    return modal;
  }

  function bindEvents(modal, overlay) {
    const $ = (id) => document.getElementById(id);

    // 关闭
    $('emb-close-btn').onclick = () => close();
    $('emb-cancel-btn').onclick = () => close();
    overlay.onclick = () => close();

    // 服务商切换
    $('emb-provider').onchange = function() {
      const provider = this.value;
      updateProviderUI(provider);
    };

    // 获取模型列表
    $('emb-fetch-models-btn').onclick = async () => {
      await fetchModels();
    };

    // 测试连接
    $('emb-test-btn').onclick = async () => {
      await testConnection();
    };

    // 保存
    $('emb-save-btn').onclick = () => {
      saveConfig();
    };

    // 建立索引
    $('emb-build-index-btn').onclick = async () => {
      await buildIndex(false);
    };

    // 重建索引
    $('emb-rebuild-index-btn').onclick = async () => {
      if (confirm('重建索引将删除现有索引，确定继续吗?')) {
        await buildIndex(true);
      }
    };
  }

  function updateProviderUI(provider) {
    const $ = (id) => document.getElementById(id);
    const preset = PRESETS[provider];

    // 更新模型列表
    const modelSelect = $('emb-model');
    modelSelect.innerHTML = preset.models.map(m =>
      `<option value="${m.id}">${m.name}</option>`
    ).join('');

    // 更新端点和获取模型按钮
    const fetchBtn = $('emb-fetch-models-btn');
    if (provider === 'custom') {
      $('emb-endpoint-wrap').style.display = 'block';
      $('emb-endpoint').value = window.EmbeddingClient?.config.endpoint || '';
      fetchBtn.style.display = 'inline-block';
    } else {
      $('emb-endpoint-wrap').style.display = 'block';  // 预设也显示，允许修改
      $('emb-endpoint').value = preset.endpoint;
      fetchBtn.style.display = 'inline-block';
    }

    // OpenAI支持自定义维度
    $('emb-dims-wrap').style.display = provider === 'openai' ? 'block' : 'none';
  }

  async function fetchModels() {
    const $ = (id) => document.getElementById(id);
    const btn = $('emb-fetch-models-btn');
    const loadingDiv = $('emb-model-loading');
    const modelSelect = $('emb-model');

    const baseUrl = $('emb-endpoint').value?.trim();
    const apiKey = $('emb-api-key').value?.trim();

    if (!baseUrl) {
      alert('请先输入Base URL');
      return;
    }

    if (!apiKey) {
      alert('请先输入API Key');
      return;
    }

    btn.disabled = true;
    btn.textContent = '获取中...';
    loadingDiv.style.display = 'block';

    try {
      // 构建 /models 端点
      let modelsUrl = baseUrl.replace(/\/+$/, '') + '/models';

      const response = await fetch(modelsUrl, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      // 过滤出embedding相关模型
      let models = [];
      if (data.data && Array.isArray(data.data)) {
        models = data.data.filter(m => {
          const id = m.id || m.model || '';
          return id.includes('embed') || id.includes('bge') || id.includes('rerank');
        }).map(m => ({
          id: m.id || m.model,
          name: m.id || m.model
        }));
      }

      if (models.length === 0) {
        throw new Error('未找到embedding或rerank相关模型');
      }

      // 更新模型选择框
      modelSelect.innerHTML = models.map(m =>
        `<option value="${m.id}">${m.name}</option>`
      ).join('');

      loadingDiv.style.display = 'none';
      loadingDiv.style.color = '#059669';
      loadingDiv.textContent = `✅ 成功获取 ${models.length} 个模型`;
      setTimeout(() => { loadingDiv.style.display = 'none'; }, 3000);

    } catch (error) {
      console.error('[EmbeddingConfigUI] 获取模型失败:', error);
      loadingDiv.style.color = '#dc2626';
      loadingDiv.textContent = `❌ 获取失败: ${error.message}`;
      setTimeout(() => { loadingDiv.style.display = 'none'; }, 5000);
    } finally {
      btn.disabled = false;
      btn.textContent = '获取模型列表';
    }
  }

  async function testConnection() {
    const $ = (id) => document.getElementById(id);
    const resultDiv = $('emb-test-result');
    const btn = $('emb-test-btn');

    const config = {
      provider: $('emb-provider').value,
      apiKey: $('emb-api-key').value,
      endpoint: $('emb-endpoint').value || PRESETS[$('emb-provider').value].endpoint,
      model: $('emb-model').value,
      dimensions: parseInt($('emb-dimensions').value) || null
    };

    if (!config.apiKey) {
      resultDiv.style.display = 'block';
      resultDiv.style.color = '#dc2626';
      resultDiv.textContent = '❌ 请输入API Key';
      return;
    }

    btn.textContent = '测试中...';
    btn.disabled = true;
    resultDiv.style.display = 'none';

    try {
      // 临时保存配置
      window.EmbeddingClient.saveConfig({ ...config, enabled: true });

      // 测试调用
      const testText = '测试文本';
      const vector = await window.EmbeddingClient.embed(testText);

      resultDiv.style.display = 'block';
      resultDiv.style.color = '#059669';
      resultDiv.textContent = `✅ 连接成功！向量维度: ${vector.length}`;

    } catch (error) {
      resultDiv.style.display = 'block';
      resultDiv.style.color = '#dc2626';
      resultDiv.textContent = `❌ 连接失败: ${error.message}`;
    } finally {
      btn.textContent = '测试连接';
      btn.disabled = false;
    }
  }

  function saveConfig() {
    const $ = (id) => document.getElementById(id);

    const config = {
      enabled: $('emb-enabled').checked,
      provider: $('emb-provider').value,
      apiKey: $('emb-api-key').value,
      endpoint: $('emb-endpoint').value || PRESETS[$('emb-provider').value].endpoint,
      model: $('emb-model').value,
      dimensions: parseInt($('emb-dimensions').value) || null
    };

    window.EmbeddingClient.saveConfig(config);

    if (window.ChatbotUtils?.showToast) {
      window.ChatbotUtils.showToast('配置已保存', 'success', 2000);
    }

    close();
  }

  async function buildIndex(forceRebuild) {
    const groups = window.data?.semanticGroups;
    if (!groups || groups.length === 0) {
      alert('当前文档没有意群数据，请先生成意群');
      return;
    }

    const docId = window.ChatbotCore?.getCurrentDocId() || window.data?.id || 'default';

    try {
      await window.SemanticVectorSearch.indexGroups(groups, docId, {
        showProgress: true,
        forceRebuild
      });
      await updateIndexStatus();
    } catch (error) {
      alert(`建立索引失败: ${error.message}`);
    }
  }

  async function updateIndexStatus() {
    const $ = (id) => document.getElementById(id);
    const statusDiv = $('emb-index-status');

    if (!window.SemanticVectorSearch) {
      statusDiv.textContent = '向量搜索模块未加载';
      return;
    }

    const docId = window.ChatbotCore?.getCurrentDocId() || window.data?.id || 'default';

    try {
      const status = await window.SemanticVectorSearch.getIndexStatus(docId);
      if (status.indexed) {
        statusDiv.innerHTML = `
          <div style="color: #059669; font-weight: 500;">✓ 已建立索引</div>
          <div style="margin-top: 4px; color: #6b7280;">
            意群数: ${status.count} | 维度: ${status.dimensions} | 大小: ${status.size}
          </div>
        `;
      } else {
        statusDiv.textContent = '未建立索引';
      }
    } catch (error) {
      statusDiv.textContent = '无法获取索引状态';
    }
  }

  function open() {
    const modal = createModal();
    const overlay = document.getElementById('embedding-config-overlay');
    const $ = (id) => document.getElementById(id);

    // 加载配置
    const config = window.EmbeddingClient?.config || {};
    $('emb-enabled').checked = config.enabled || false;
    $('emb-provider').value = config.provider || 'openai';
    $('emb-api-key').value = config.apiKey || '';
    $('emb-model').value = config.model || 'text-embedding-3-small';
    $('emb-dimensions').value = config.dimensions || '';

    updateProviderUI(config.provider || 'openai');
    updateIndexStatus();

    overlay.style.display = 'block';
    modal.style.display = 'block';
  }

  function close() {
    const modal = document.getElementById('embedding-config-modal');
    const overlay = document.getElementById('embedding-config-overlay');
    if (modal) modal.style.display = 'none';
    if (overlay) overlay.style.display = 'none';
  }

  // 导出
  window.EmbeddingConfigUI = { open, close };
  window.EmbeddingConfigUILoaded = true;

  console.log('[EmbeddingConfigUI] 配置面板已加载');

})(window, document);
