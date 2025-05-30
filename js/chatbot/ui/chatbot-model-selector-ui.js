/**
 * ChatbotModelSelectorUI 模型选择器界面渲染与交互逻辑
 *
 * 主要功能：
 * 1. 渲染自定义模型选择界面，支持多模型、Batch模型、参数调节等。
 * 2. 负责模型、温度、最大token、并发等参数的选择与本地存储。
 * 3. 绑定所有相关交互事件（切换、参数同步、帮助提示、返回等）。
 * 4. 支持参数的本地持久化与回显。
 */
window.ChatbotModelSelectorUI = {
  /**
   * 渲染模型选择器主界面，并绑定所有交互事件。
   *
   * 主要逻辑：
   * 1. 隐藏 preset 区和聊天区，显示模型选择器。
   * 2. 渲染模型下拉、特殊模型、温度、并发、最大token等参数输入。
   * 3. 绑定所有输入、切换、帮助、返回等事件。
   * 4. 参数变更自动保存到 localStorage 或调用 saveSettings。
   *
   * @param {HTMLElement} mainContentArea - 主内容区容器。
   * @param {HTMLElement} chatBody - 聊天内容区。
   * @param {Array} availableModels - 可用模型列表。
   * @param {object} currentSettings - 当前设置。
   * @param {function} updateChatbotUI - UI刷新回调。
   */
  render: function(mainContentArea, chatBody, availableModels, currentSettings, updateChatbotUI) {
    // 隐藏预设和聊天区
    const presetContainer = document.getElementById('chatbot-preset-container');
    if (presetContainer) presetContainer.style.display = 'none';
    if (chatBody) chatBody.style.display = 'none';

    // 处理模型列表和默认选中
    let models = availableModels;
    if (!Array.isArray(models) || models.length === 0) models = [];
    let settings = currentSettings;
    let defaultModelId = settings.selectedCustomModelId || localStorage.getItem('lastSelectedCustomModel') || (models[0]?.id || models[0] || '');

    // 移除已存在的选择器，防止重复渲染
    let modelSelectorDiv = document.getElementById('chatbot-model-selector');
    if (modelSelectorDiv) modelSelectorDiv.remove();

    // 创建主容器
    modelSelectorDiv = document.createElement('div');
    modelSelectorDiv.id = 'chatbot-model-selector';
    modelSelectorDiv.style.margin = '-30px auto 0 auto';
    modelSelectorDiv.style.maxWidth = '340px';
    modelSelectorDiv.style.background = 'linear-gradient(135deg,#f0f9ff 80%,#e0f2fe 100%)';
    modelSelectorDiv.style.border = '2px dashed #93c5fd';
    modelSelectorDiv.style.borderRadius = '16px';
    modelSelectorDiv.style.padding = '20px 16px 16px 16px';
    modelSelectorDiv.style.maxHeight = '100%';
    modelSelectorDiv.style.overflowY = 'auto';

    // 读取默认参数
    let defaultTemperature = 0.5;
    let defaultMaxTokens = 8000;
    try {
      if (settings.customModelSettings) {
        defaultTemperature = typeof settings.customModelSettings.temperature === 'number' ? settings.customModelSettings.temperature : defaultTemperature;
        defaultMaxTokens = typeof settings.customModelSettings.max_tokens === 'number' ? settings.customModelSettings.max_tokens : defaultMaxTokens;
      }
    } catch (e) {
      console.error("Error accessing customModelSettings:", e);
    }
    const defaultConcurrency = (window.chatbotActiveOptions && Number.isInteger(window.chatbotActiveOptions.segmentConcurrency))
        ? window.chatbotActiveOptions.segmentConcurrency : 20;

    // 主体HTML结构
    modelSelectorDiv.innerHTML = `
      <div style="text-align:center;font-size:17px;font-weight:700;color:#2563eb;margin-bottom:8px;">选择自定义模型</div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <span style="font-size:14px;font-weight:500;">默认模型</span>
        <button id="chatbot-add-special-models-btn" style="width:24px;height:24px;border:none;background:transparent;font-size:18px;cursor:pointer;line-height:18px;">＋</button>
      </div>
      <div id="chatbot-special-models-container" style="display:none;flex-direction:column;gap:12px;margin-bottom:12px;">
        <div>
          <div style="font-size:14px;color:#1e3a8a;font-weight:500;margin-bottom:4px;">多模态模型</div>
          <select id="chatbot-multimodal-model-select" style="width:100%;padding:6px 8px;border-radius:6px;border:1px solid #93c5fd;">
            <option value="">使用默认模型</option>
            ${models.map(m => typeof m === 'string' ? `<option value="${m}">${m}</option>` : `<option value="${m.id}">${m.name || m.id}</option>`).join('')}
          </select>
        </div>
        <div>
          <div style="font-size:14px;color:#1e3a8a;font-weight:500;margin-bottom:4px;">Batch模型</div>
          <select id="chatbot-batch-model-select" style="width:100%;padding:6px 8px;border-radius:6px;border:1px solid #93c5fd;">
            <option value="">使用默认模型</option>
            ${models.map(m => typeof m === 'string' ? `<option value="${m}">${m}</option>` : `<option value="${m.id}">${m.name || m.id}</option>`).join('')}
          </select>
        </div>
      </div>
      <select id="chatbot-model-select" style="width:100%;margin-bottom:12px;padding:12px 16px;border-radius:10px;border:2px solid #93c5fd;background:white;color:#1e3a8a;font-size:15px;font-weight:600;outline:none;">
        ${models.length === 0 ? '<option value="">（无可用模型）</option>' : models.map(m => typeof m === 'string' ? `<option value="${m}"${m === defaultModelId ? ' selected' : ''}>${m}</option>` : `<option value="${m.id}"${m.id === defaultModelId ? ' selected' : ''}>${m.name || m.id}</option>`).join('')}
      </select>
      <div style="display:flex;justify-content:space-between;gap:16px;margin:4px 0;">
        <div style="flex:1;">
          <div style="font-size:14px;color:#1e3a8a;font-weight:500;display:flex;align-items:center;justify-content:space-between;">
            <div style="display:flex;align-items:center;gap:4px;">
              <span>温度 (0-1)</span><button id="chatbot-temp-help-btn" style="background:none;border:none;color:#2563eb;cursor:pointer;display:flex;align-items:center;justify-content:center;"><i class="fa-solid fa-circle-info"></i></button>
            </div>
            <input id="chatbot-temp-input" type="number" min="0" max="1" step="0.01" value="${defaultTemperature}" style="width:50px;padding:2px;border-radius:4px;border:1px solid #93c5fd;font-size:14px;" />
          </div>
          <input id="chatbot-temp-range" type="range" min="0" max="1" step="0.01" value="${defaultTemperature}" style="width:100%;margin-top:4px;height:20px;" />
        </div>
        <div style="flex:1;">
          <div style="font-size:14px;color:#1e3a8a;font-weight:500;display:flex;align-items:center;justify-content:space-between;">
            <div style="display:flex;align-items:center;gap:4px;">
              <span>并发上限</span><button id="chatbot-concurrency-help-btn" style="background:none;border:none;color:#2563eb;cursor:pointer;display:flex;align-items:center;justify-content:center;"><i class="fa-solid fa-circle-info"></i></button>
            </div>
            <input id="chatbot-concurrency-input" type="number" min="1" max="50" step="1" value="${defaultConcurrency}" style="width:50px;padding:2px;border-radius:4px;border:1px solid #93c5fd;font-size:14px;" />
          </div>
          <input id="chatbot-concurrency-range" type="range" min="1" max="50" step="1" value="${defaultConcurrency}" style="width:100%;margin-top:4px;height:20px;" />
        </div>
      </div>
      <div style="margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;font-size:14px;color:#1e3a8a;font-weight:500;">
          <div style="display:flex;align-items:center;gap:4px;">
            <span>回复长度</span><button id="chatbot-maxtokens-help-btn" style="background:none;border:none;color:#2563eb;cursor:pointer;display:flex;align-items:center;justify-content:center;"><i class="fa-solid fa-circle-info"></i></button>
          </div>
          <span style="font-size:12px;color:#64748b;">(max_tokens)</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
          <input id="chatbot-maxtokens-range" type="range" min="256" max="32768" step="64" value="${defaultMaxTokens}" style="flex:1;height:24px;" />
          <input id="chatbot-maxtokens-input" type="number" min="256" max="32768" step="1" value="${defaultMaxTokens}" style="width:70px;height:24px;padding:0 4px;border-radius:4px;border:1px solid #93c5fd;font-size:14px;" />
        </div>
      </div>
      <button id="chatbot-model-back-btn" style="margin-top:8px;width:100%;padding:8px 0;font-size:15px;font-weight:600;background:linear-gradient(90deg,#3b82f6,#2563eb);color:white;border:none;border-radius:8px;cursor:pointer;transition:all 0.2s;">返回</button>
    `;

    mainContentArea.insertBefore(modelSelectorDiv, chatBody);

    // 事件绑定区域
    // 展开/收起特殊模型
    const addSpecialBtn = modelSelectorDiv.querySelector('#chatbot-add-special-models-btn');
    const specialContainer = modelSelectorDiv.querySelector('#chatbot-special-models-container');
    if (addSpecialBtn && specialContainer) {
      addSpecialBtn.onclick = () => {
        if (specialContainer.style.display === 'none') {
          specialContainer.style.display = 'flex';
          addSpecialBtn.textContent = '－';
        } else {
          specialContainer.style.display = 'none';
          addSpecialBtn.textContent = '＋';
        }
      };
    }

    // 多模态模型选择
    const multiSelect = modelSelectorDiv.querySelector('#chatbot-multimodal-model-select');
    if (multiSelect) {
      multiSelect.onchange = e => {
        window.chatbotActiveOptions.multimodalModel = e.target.value;
        let settings = {};
        try { settings = typeof loadSettings === 'function' ? loadSettings() : JSON.parse(localStorage.getItem('paperBurnerSettings') || '{}'); } catch {}
        settings.multimodalModel = e.target.value;
        if (typeof saveSettings === 'function') {
            saveSettings(settings);
        } else {
            localStorage.setItem('paperBurnerSettings', JSON.stringify(settings));
        }
      };
      let userSettings = {};
      try { userSettings = typeof loadSettings === 'function' ? loadSettings() : JSON.parse(localStorage.getItem('paperBurnerSettings') || '{}'); } catch {}
      multiSelect.value = userSettings.multimodalModel || '';
      window.chatbotActiveOptions.multimodalModel = userSettings.multimodalModel || '';
    }

    // Batch模型选择
    const batchSelect = modelSelectorDiv.querySelector('#chatbot-batch-model-select');
    if (batchSelect) {
      batchSelect.onchange = e => {
        window.chatbotActiveOptions.batchModel = e.target.value;
        let settings = {};
        try { settings = typeof loadSettings === 'function' ? loadSettings() : JSON.parse(localStorage.getItem('paperBurnerSettings') || '{}'); } catch {}
        settings.batchModel = e.target.value;
        if (typeof saveSettings === 'function') {
            saveSettings(settings);
        } else {
            localStorage.setItem('paperBurnerSettings', JSON.stringify(settings));
        }
      };
      let userSettings = {};
      try { userSettings = typeof loadSettings === 'function' ? loadSettings() : JSON.parse(localStorage.getItem('paperBurnerSettings') || '{}'); } catch {}
      batchSelect.value = userSettings.batchModel || '';
      window.chatbotActiveOptions.batchModel = userSettings.batchModel || '';
    }

    // 并发参数绑定
    const concurrencyInput = modelSelectorDiv.querySelector('#chatbot-concurrency-input');
    const concurrencyRange = modelSelectorDiv.querySelector('#chatbot-concurrency-range');
    function saveConcurrency() {
      let v = parseInt(concurrencyInput.value);
      if (isNaN(v) || v < 1) v = 1;
      if (v > 50) v = 50;
      concurrencyInput.value = v;
      concurrencyRange.value = v;
      window.chatbotActiveOptions.segmentConcurrency = v;
      let settings = {};
      try { settings = typeof loadSettings === 'function' ? loadSettings() : JSON.parse(localStorage.getItem('paperBurnerSettings') || '{}'); } catch {};
      settings.segmentConcurrency = v;
      if (typeof saveSettings === 'function') saveSettings(settings);
      else localStorage.setItem('paperBurnerSettings', JSON.stringify(settings));
    }
    if (concurrencyInput && concurrencyRange) {
      concurrencyInput.oninput = saveConcurrency;
      concurrencyRange.oninput = saveConcurrency; // Should be oninput or onchange, not saveConcurrency directly
      concurrencyRange.oninput = () => { concurrencyInput.value = concurrencyRange.value; saveConcurrency(); };
      concurrencyInput.oninput = () => { concurrencyRange.value = concurrencyInput.value; saveConcurrency(); };
    }

    // 帮助按钮
    const tempHelpBtn = modelSelectorDiv.querySelector('#chatbot-temp-help-btn');
    if (tempHelpBtn) tempHelpBtn.onclick = () => ChatbotUtils.showToast('温度：调节模型生成的随机性，0表示最确定，1表示最随机', 'info', 3000);
    const concurrencyHelpBtn = modelSelectorDiv.querySelector('#chatbot-concurrency-help-btn');
    if (concurrencyHelpBtn) concurrencyHelpBtn.onclick = () => ChatbotUtils.showToast('并发上限：控制同时处理分段的最大并发请求数', 'info', 3000);
    const maxTokensHelpBtn = modelSelectorDiv.querySelector('#chatbot-maxtokens-help-btn');
    if (maxTokensHelpBtn) maxTokensHelpBtn.onclick = () => ChatbotUtils.showToast('回复长度：模型最大输出的token数量', 'info', 3000);

    // 主模型选择
    const select = document.getElementById('chatbot-model-select');
    if (select) {
      select.onchange = function() {
        localStorage.setItem('lastSelectedCustomModel', this.value);
        let settings = {};
        try {
          settings = typeof loadSettings === 'function' ? loadSettings() : JSON.parse(localStorage.getItem('paperBurnerSettings') || '{}');
        } catch (e) {}
        settings.selectedCustomModelId = this.value;
        if (typeof saveSettings === 'function') {
          saveSettings(settings);
        } else {
          localStorage.setItem('paperBurnerSettings', JSON.stringify(settings));
        }
      };
    }

    // 温度、最大token参数绑定
    const tempInput = document.getElementById('chatbot-temp-input');
    const tempRange = document.getElementById('chatbot-temp-range');
    const maxTokensInput = document.getElementById('chatbot-maxtokens-input');
    const maxTokensRange = document.getElementById('chatbot-maxtokens-range');

    function saveCustomModelParams() {
      let settings = {};
      try {
        settings = typeof loadSettings === 'function' ? loadSettings() : JSON.parse(localStorage.getItem('paperBurnerSettings') || '{}');
      } catch (e) {}
      if (!settings.customModelSettings) settings.customModelSettings = {};
      let t = parseFloat(tempInput.value);
      if (isNaN(t) || t < 0) t = 0;
      if (t > 1) t = 1;
      let m = parseInt(maxTokensInput.value);
      if (isNaN(m) || m < 256) m = 256;
      if (m > 32768) m = 32768;
      tempInput.value = t;
      tempRange.value = t;
      maxTokensInput.value = m;
      maxTokensRange.value = m;
      settings.customModelSettings.temperature = t;
      settings.customModelSettings.max_tokens = m;
      if (typeof saveSettings === 'function') {
        saveSettings(settings);
      } else {
        localStorage.setItem('paperBurnerSettings', JSON.stringify(settings));
      }
    }

    if (tempInput && tempRange) {
      tempInput.oninput = function() { tempRange.value = tempInput.value; saveCustomModelParams(); };
      tempRange.oninput = function() { tempInput.value = tempRange.value; saveCustomModelParams(); };
    }
    if (maxTokensInput && maxTokensRange) {
      maxTokensInput.oninput = function() { maxTokensRange.value = maxTokensInput.value; saveCustomModelParams(); };
      maxTokensRange.oninput = function() { maxTokensInput.value = maxTokensRange.value; saveCustomModelParams(); };
    }

    // 返回按钮
    const backBtn = document.getElementById('chatbot-model-back-btn');
    if (backBtn) {
      backBtn.onclick = function() {
        window.isModelSelectorOpen = false;
        updateChatbotUI();
      };
    }
  }
};