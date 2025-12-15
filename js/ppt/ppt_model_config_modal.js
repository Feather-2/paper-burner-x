/**
 * PPT 模型配置弹窗（独立于翻译/Chatbot）
 * - 文字模型：使用 translation/search 分组的模型列表（预设 + 自定义源站）
 * - 配图模型：使用 image 分组（通用 image / gemini-image 或自定义源站）
 * - 保存到 localStorage: pptModelConfigLanguage / pptModelConfigImage
 */
(function(global) {
  'use strict';

  const STORAGE_KEYS = {
    lang: 'pptModelConfigLanguage',
    img: 'pptModelConfigImage', 
    vision: 'pptModelConfigVision',
    modelTags: 'pptModelTags',        // Tab 1: 模型能力标签
    rolePriority: 'pptRolePriority',  // Tab 2: 角色优先级
    audio: 'pptAudioConfig'           // Tab 3: 音频配置
  };

  const CAPABILITY_TAGS = [
    { id: 'lang', name: '语言生成', icon: 'carbon:text-creation' },
    { id: 'vision', name: '视觉理解', icon: 'carbon:view' },
    { id: 'image', name: '图像生成', icon: 'carbon:image' },
    { id: 'audio', name: '音频处理', icon: 'carbon:microphone' }
  ];

  const ROLES = [
    // DeepSearch 角色
    { id: 'analyst', name: '分析师', desc: '扫描和理解文档', icon: 'carbon:analytics', group: 'deepsearch' },
    { id: 'planner', name: '规划师', desc: '研究规划和 Gap 识别', icon: 'carbon:plan', group: 'deepsearch' },
    { id: 'writer', name: '撰写者', desc: '内容生成和报告撰写', icon: 'carbon:edit', group: 'deepsearch' },
    { id: 'reviewer', name: '审阅者', desc: '质量检查和审阅', icon: 'carbon:checkmark-outline', group: 'deepsearch' },
    { id: 'vision', name: '视觉处理', desc: '图像理解和 OCR', icon: 'carbon:view', group: 'shared' },
    { id: 'worker', name: '通用执行', desc: '通用任务处理', icon: 'carbon:task', group: 'shared' },
    // Design 角色
    { id: 'design_tokens', name: '设计规范', desc: '提取设计系统 Tokens', icon: 'carbon:color-palette', group: 'design' },
    { id: 'design_brainstorm', name: '创意策划', desc: '脑暴视觉创意方案', icon: 'carbon:idea', group: 'design' },
    { id: 'design_layout', name: '布局排版', desc: '页面结构和元素布局', icon: 'carbon:grid', group: 'design' },
    { id: 'design_svg', name: 'SVG 绘制', desc: '矢量图形和图标生成', icon: 'carbon:svg', group: 'design' },
    { id: 'design_image', name: '图像生成', desc: 'AI 配图和素材生成', icon: 'carbon:image-search', group: 'design' },
    { id: 'design_review', name: '设计审阅', desc: '视觉质量检查和评审', icon: 'carbon:task-approved', group: 'design' }
  ];

  const ROLE_SHORT = {
    analyst: 'A', planner: 'P', writer: 'W', reviewer: 'R', vision: 'V', worker: 'K',
    design_tokens: 'T', design_brainstorm: 'B', design_layout: 'L', design_svg: 'S', design_image: 'I', design_review: 'Q'
  };
  const ROLE_DISPLAY_ORDER = [
    // Shared
    'worker', 'vision',
    // DeepSearch
    'analyst', 'planner', 'writer', 'reviewer',
    // Design
    'design_tokens', 'design_brainstorm', 'design_layout', 'design_svg', 'design_image', 'design_review'
  ];
  const ROLE_NAMES = {
    analyst: '分析师', planner: '规划师', writer: '撰写者', reviewer: '审阅者', vision: '视觉', worker: '通用',
    design_tokens: '规范', design_brainstorm: '脑暴', design_layout: '布局', design_svg: 'SVG', design_image: '配图', design_review: '审阅'
  };

  const ROLE_NAMES_TABLE = {
    analyst: '分析', planner: '规划', writer: '撰写', reviewer: '审阅', vision: '视觉', worker: '通用',
    design_tokens: '规范', design_brainstorm: '脑暴', design_layout: '布局', design_svg: 'SVG', design_image: '配图', design_review: '审阅'
  };

  const ROLE_GROUPS = {
    shared: { name: '通用', roles: ['worker', 'vision'] },
    deepsearch: { name: 'DeepSearch', roles: ['analyst', 'planner', 'writer', 'reviewer'] },
    design: { name: 'Design', roles: ['design_tokens', 'design_brainstorm', 'design_layout', 'design_svg', 'design_image', 'design_review'] }
  };

  const TRANSCRIPTION_PROVIDERS = [
    { id: 'groq', name: 'Groq (Whisper)', models: ['whisper-large-v3'] },
    { id: 'openai', name: 'OpenAI Whisper', models: ['whisper-1'] },
    { id: 'elevenlabs', name: 'ElevenLabs Scribe', models: ['scribe_v1'] },
    { id: 'openai-compatible', name: '兼容接口', models: [] }
  ];

  const SYNTHESIS_PROVIDERS = [
    { id: 'elevenlabs', name: 'ElevenLabs', models: ['eleven_turbo_v2_5', 'eleven_flash_v2_5'] },
    { id: 'openai', name: 'OpenAI TTS', models: ['tts-1', 'tts-1-hd'] }
  ];

  // 常见 API 提供商列表（扩展源站选择）
  const COMMON_API_PROVIDERS = [
    { key: 'openai', name: 'OpenAI', endpoint: 'https://api.openai.com' },
    { key: 'anthropic', name: 'Anthropic', endpoint: 'https://api.anthropic.com' },
    { key: 'deepseek', name: 'DeepSeek', endpoint: 'https://api.deepseek.com' },
    { key: 'groq', name: 'Groq', endpoint: 'https://api.groq.com/openai' },
    { key: 'mistral', name: 'Mistral', endpoint: 'https://api.mistral.ai' },
    { key: 'openrouter', name: 'OpenRouter', endpoint: 'https://openrouter.ai/api' },
    { key: 'together', name: 'Together AI', endpoint: 'https://api.together.xyz' },
    { key: 'gemini', name: 'Gemini (Google)', endpoint: 'https://generativelanguage.googleapis.com' },
    { key: 'tongyi', name: '通义百炼', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode' },
    { key: 'volcano', name: '火山引擎', endpoint: '' },
    { key: 'siliconflow', name: 'SiliconFlow', endpoint: 'https://api.siliconflow.cn' },
    { key: 'zhipu', name: '智谱 AI', endpoint: 'https://open.bigmodel.cn/api/paas' },
    { key: 'moonshot', name: 'Moonshot (Kimi)', endpoint: 'https://api.moonshot.cn' },
    { key: 'yi', name: '零一万物', endpoint: 'https://api.lingyiwanwu.com' },
    { key: 'baichuan', name: '百川智能', endpoint: 'https://api.baichuan-ai.com' }
  ];

  const MANUAL_MODEL_ID_PROVIDERS = {
    lang: ['volcano'], // 火山引擎模型 ID 需要手动填写
    img: [],
    vision: ['volcano']
  };

  // 缓存探测到的模型 ID 列表
  const modelIdCache = { lang: [], img: [], vision: [] };

  const uiState = {
    activeTab: 'tags',
    // Tab 1: 当前选中的模型（格式：`${sourceKey}:${modelId}`）
    tagsActiveModelKey: null,
    // Tab 1: 展开的源站 key 列表
    tagsExpandedSources: [],
    priorityActiveRole: ROLES[0]?.id || 'analyst',
    // Table View
    tableSearch: '',
    tableSourceKey: '',
    tableConfiguredOnly: false
  };

  function getSupportedModels() {
    const list = Array.isArray(global.supportedModelsForKeyManager) ? global.supportedModelsForKeyManager : [];
    return list;
  }

  function resolveStorageKey(key) {
    if (!key) return STORAGE_KEYS.lang;
    if (STORAGE_KEYS[key]) return STORAGE_KEYS[key];
    // 允许直接传 storage key 字符串
    const values = Object.values(STORAGE_KEYS);
    if (values.includes(key)) return key;
    return STORAGE_KEYS.lang;
  }

  function loadConfig(key) {
    try {
      const storageKey = resolveStorageKey(key);
      const raw = localStorage.getItem(storageKey);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return null;
  }

  function saveConfig(key, value) {
    const storageKey = resolveStorageKey(key);
    localStorage.setItem(storageKey, JSON.stringify(value));
  }

  function renderModal() {
    if (document.getElementById('ppt-model-config-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'ppt-model-config-modal';
    modal.className = 'pmc-modal-overlay';
    
    // 构建 HTML 结构
    modal.innerHTML = `
      <div id="ppt-model-config-overlay" class="pmc-overlay-bg"></div>
      <div class="pmc-modal-container">
        <!-- Header -->
        <div class="pmc-header">
          <div class="pmc-header-left">
            <div class="pmc-header-icon">
              <iconify-icon icon="carbon:settings-adjust" width="24"></iconify-icon>
            </div>
            <div>
              <div class="pmc-title">PPT 模型配置</div>
              <div class="pmc-subtitle">独立于翻译/聊天模型，专用于 PPT 文案与配图</div>
            </div>
          </div>
          <button id="ppt-model-config-close" class="pmc-close-btn" title="关闭">
            <iconify-icon icon="carbon:close" width="24"></iconify-icon>
          </button>
        </div>

        <!-- Scrollable Content -->
        <div class="pmc-scroll-content">
          <!-- 表格优先：统一模型视图 -->
          <div id="pmc-model-table-container"></div>

          <!-- 音频配置（折叠） -->
          <div class="pmc-audio-collapse">
            <button class="pmc-audio-collapse-header" type="button">
              <span style="display:flex; align-items:center; gap:8px;">
                <iconify-icon icon="carbon:microphone" width="16"></iconify-icon>
                音频配置
              </span>
              <iconify-icon class="pmc-audio-collapse-chevron" icon="carbon:chevron-down" width="18"></iconify-icon>
            </button>
            <div class="pmc-audio-collapse-body"></div>
          </div>

            <!-- Advanced Settings (Image Processor) -->
            <div id="pmc-image-settings-panel" class="pmc-advanced-settings">
                <div class="pmc-advanced-header">
                    <iconify-icon icon="carbon:settings-check" width="16"></iconify-icon>
                    图片智能处理参数
                </div>
                <div class="pmc-advanced-body">
                    <!-- Left Col -->
                    <div class="pmc-col" style="border:none; padding:0; background:transparent;">
                        <div class="pmc-form-group">
                            <label class="pmc-label">OCR 引擎优先级</label>
                            <div class="pmc-radio-group">
                                <label class="pmc-radio-item">
                                    <input type="radio" name="pmc-ocr-priority" value="mineru">
                                    <span>MinerU 优先 <span class="pmc-hint-text">(精确 bbox)</span></span>
                                </label>
                                <label class="pmc-radio-item">
                                    <input type="radio" name="pmc-ocr-priority" value="vlm">
                                    <span>视觉模型优先 <span class="pmc-hint-text">(复杂排版)</span></span>
                                </label>
                                <label class="pmc-radio-item">
                                    <input type="radio" name="pmc-ocr-priority" value="auto">
                                    <span>自动选择</span>
                                </label>
                            </div>
                            <div id="pmc-ocr-status" class="pmc-status-text"></div>
                        </div>
                    </div>
                    <!-- Right Col -->
                    <div class="pmc-col" style="border:none; padding:0; background:transparent;">
                        <div class="pmc-form-group">
                            <label class="pmc-label">矢量化预设</label>
                            <select id="pmc-vectorize-preset" class="pmc-select" style="width:100%;">
                                <option value="auto" selected>自动推荐</option>
                                <option value="logo">Logo / 图标</option>
                                <option value="illustration">插画</option>
                                <option value="lineart">线稿</option>
                                <option value="photo">照片</option>
                                <option value="simple">简化</option>
                            </select>
                        </div>
                        <div style="margin-top: 20px; display:flex; flex-direction:column; gap:16px;">
                            <div class="pmc-form-group">
                                <label class="pmc-label">
                                    边缘阈值
                                    <span id="pmc-edge-val" class="pmc-value-badge">30</span>
                                </label>
                                <div style="display:flex; align-items:center; gap:10px;">
                                    <span style="font-size:11px; color:#94a3b8;">10</span>
                                    <input type="range" id="pmc-edge-threshold" min="10" max="100" value="30" class="pmc-range">
                                    <span style="font-size:11px; color:#94a3b8;">100</span>
                                </div>
                            </div>
                            <div class="pmc-form-group">
                                <label class="pmc-label">
                                    颜色容差
                                    <span id="pmc-color-val" class="pmc-value-badge">25</span>
                                </label>
                                <div style="display:flex; align-items:center; gap:10px;">
                                    <span style="font-size:11px; color:#94a3b8;">5</span>
                                    <input type="range" id="pmc-color-tolerance" min="5" max="50" value="25" class="pmc-range">
                                    <span style="font-size:11px; color:#94a3b8;">50</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Footer -->
        <div class="pmc-footer">
          <button id="ppt-image-processor-settings" class="pmc-btn-secondary">
            <iconify-icon icon="carbon:chevron-down" width="16" id="pmc-settings-chevron"></iconify-icon>
            展开图片处理设置
          </button>
          <div id="ppt-image-gen-stats" class="pmc-stats"></div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // 图片处理设置按钮 - Toggle
    document.getElementById('ppt-image-processor-settings')?.addEventListener('click', () => {
        toggleAdvancedSettings();
    });
    
    // 绑定 Image Settings 事件
    bindImageSettingsEvents();

    // Table + Audio
    initModelTableView();
  }

  function getModalRoot() {
    return document.getElementById('ppt-model-config-modal');
  }

  function initTabSwitching() {
    const root = getModalRoot();
    if (!root) return;

    const nav = root.querySelector('.pmc-tabs-nav');
    if (!nav || nav.dataset.bound === '1') return;
    nav.dataset.bound = '1';

    nav.addEventListener('click', (e) => {
      const btn = e.target?.closest?.('.pmc-tab-btn');
      if (!btn) return;
      const tab = btn.getAttribute('data-tab');
      if (!tab) return;
      activateTab(tab);
    });

    // 初始渲染当前 active tab
    const initialBtn = nav.querySelector('.pmc-tab-btn.active') || nav.querySelector('.pmc-tab-btn');
    const tab = initialBtn?.getAttribute('data-tab') || 'tags';
    activateTab(tab);
  }

  function activateTab(tab) {
    const root = getModalRoot();
    if (!root) return;

    uiState.activeTab = tab;

    const btns = root.querySelectorAll('.pmc-tab-btn');
    btns.forEach((b) => b.classList.toggle('active', b.getAttribute('data-tab') === tab));

    const panels = root.querySelectorAll('.pmc-tab-panel');
    panels.forEach((p) => p.classList.toggle('active', p.getAttribute('data-panel') === tab));

    const panel = root.querySelector(`.pmc-tab-panel[data-panel="${tab}"]`);
    if (!panel) return;

    if (panel.dataset.rendered === '1') return;
    panel.dataset.rendered = '1';

    if (tab === 'tags') renderTab1Content(panel);
    else if (tab === 'priority') renderTab2Content(panel);
    else if (tab === 'audio') renderTab3Content(panel);
  }

  function normalizeObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value;
  }

  function uniqueByKey(list) {
    const out = [];
    const seen = new Set();
    for (const item of Array.isArray(list) ? list : []) {
      const key = item?.key;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out;
  }

  function getAllConfigurableModels() {
    const models = [];
    const seen = new Set();

    // 1. 首先添加常见 API 提供商
    for (const p of COMMON_API_PROVIDERS) {
      if (seen.has(p.key)) continue;
      seen.add(p.key);
      const keys = typeof loadModelKeys === 'function' ? (loadModelKeys(p.key) || []) : [];
      const validKeys = keys.filter(k => k && k.status !== 'invalid' && k.value);
      models.push({
        key: p.key,
        name: p.name + (validKeys.length ? ` (${validKeys.length} Key)` : ' (无 Key)'),
        group: 'api',
        endpoint: p.endpoint
      });
    }

    // 2. 然后添加 supportedModelsForKeyManager 中的其他模型（排除 OCR 和已添加的）
    const supported = getSupportedModels().filter(m => m && m.key && m.group !== 'ocr');
    for (const m of supported) {
      if (m.key === 'custom' || m.key === 'deeplx') continue;
      if (seen.has(m.key)) continue;
      seen.add(m.key);
      const keys = typeof loadModelKeys === 'function' ? (loadModelKeys(m.key) || []) : [];
      const validKeys = keys.filter(k => k && k.status !== 'invalid' && k.value);
      models.push({
        key: m.key,
        name: (m.name || m.key) + (validKeys.length ? ` (${validKeys.length} Key)` : ' (无 Key)'),
        group: m.group || 'unknown'
      });
    }

    // 3. 最后添加自定义源站
    if (typeof loadAllCustomSourceSites === 'function') {
      try {
        const sites = loadAllCustomSourceSites() || {};
        for (const id of Object.keys(sites)) {
          const site = sites[id] || {};
          const modelKey = `custom_source_${id}`;
          if (seen.has(modelKey)) continue;
          seen.add(modelKey);
          const keys = typeof loadModelKeys === 'function' ? (loadModelKeys(modelKey) || []) : [];
          const validKeys = keys.filter(k => k && k.status !== 'invalid' && k.value);
          models.push({
            key: modelKey,
            name: (site.displayName || site.name || '自定义源站') + (validKeys.length ? ` (${validKeys.length} Key)` : ' (无 Key)'),
            group: 'custom',
            endpoint: site.apiEndpoint || ''
          });
        }
      } catch (e) {
        console.error('[PPT Model Config] loadAllCustomSourceSites failed', e);
      }
    }

    return models;
  }

  // ========== Unified Table View (模型表格) ==========

  function notify(msg, type = 'info') {
    if (typeof global.showNotification === 'function') {
      global.showNotification(msg, type);
      return;
    }
    if (type === 'error') console.error(msg);
    else console.log(msg);
  }

  function splitFullModelKey(fullKey) {
    const s = String(fullKey || '');
    const idx = s.indexOf(':');
    if (idx <= 0 || idx === s.length - 1) return null;
    return { fullKey: s, sourceKey: s.slice(0, idx), modelId: s.slice(idx + 1) };
  }

  function getKeyStatsForSource(sourceKey) {
    if (!sourceKey || typeof loadModelKeys !== 'function') return { keyCount: 0, validKeyCount: 0 };
    try {
      const keys = (loadModelKeys(sourceKey) || []).filter((k) => k && k.value && String(k.value).trim());
      const keyCount = keys.length;
      const validKeyCount = keys.filter((k) => k.status !== 'invalid').length;
      return { keyCount, validKeyCount };
    } catch (_) {
      return { keyCount: 0, validKeyCount: 0 };
    }
  }

  function getAgentRolePrioritiesForModel(fullKey, roleCfg) {
    const out = {};
    const cfg = normalizeRolePriorityConfig(roleCfg);
    for (const r of ROLES) {
      const list = Array.isArray(cfg[r.id]) ? cfg[r.id] : [];
      const idx = list.indexOf(fullKey);
      out[r.id] = idx >= 0 ? idx + 1 : 0;
    }
    return out;
  }

  function formatAgentRoleSummary(agentRoles) {
    const parts = [];
    for (const roleId of ROLE_DISPLAY_ORDER) {
      const p = Number(agentRoles?.[roleId] || 0);
      if (!p) continue;
      parts.push(`${ROLE_SHORT[roleId] || roleId}${p}`);
    }
    return parts.join(' ');
  }

  function toCircledNumber(n) {
    const map = { 1: '①', 2: '②', 3: '③', 4: '④', 5: '⑤' };
    return map[Number(n)] || String(n || '');
  }

  function formatRoleAssignmentsReadable(agentRoles) {
    const pairs = [];
    for (const roleId of ROLE_DISPLAY_ORDER) {
      const p = Number(agentRoles?.[roleId] || 0);
      if (!p) continue;
      const name = ROLE_NAMES_TABLE[roleId] || ROLE_NAMES[roleId] || roleId;
      pairs.push({ roleId, p, text: `${name}${toCircledNumber(p)}` });
    }
    const orderIndex = new Map(ROLE_DISPLAY_ORDER.map((id, idx) => [id, idx]));
    pairs.sort((a, b) => (a.p - b.p) || ((orderIndex.get(a.roleId) ?? 999) - (orderIndex.get(b.roleId) ?? 999)));
    return pairs.map((x) => x.text).join('');
  }

  function getModelLabelForFullKey(fullKey, rowsById) {
    const r = rowsById?.get?.(fullKey);
    if (r) return { title: r.modelId, sub: r.sourceName };
    const parts = splitFullModelKey(fullKey);
    if (!parts) return { title: String(fullKey || ''), sub: '' };
    return { title: parts.modelId, sub: parts.sourceKey };
  }

  function openRoleAddPicker({ roleId, rows, roleCfg, onSave } = {}) {
    if (!roleId) return;

    const popup = document.createElement('div');
    popup.className = 'fixed inset-0 flex items-center justify-center';
    popup.style.zIndex = '9999';

    const rowsById = new Map((Array.isArray(rows) ? rows : []).map((r) => [r.id, r]));
    const current = new Set(Array.isArray(roleCfg?.[roleId]) ? roleCfg[roleId] : []);

    popup.innerHTML = `
      <div class="absolute inset-0 bg-black/40"></div>
      <div class="relative w-[min(720px,95vw)] max-h-[85vh] overflow-auto bg-white rounded-2xl shadow-2xl border border-slate-200">
        <div class="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
          <div class="text-sm font-semibold text-slate-900">添加到「${safe(ROLE_NAMES[roleId] || roleId)}」</div>
          <button class="w-9 h-9 inline-flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-500" data-action="close" type="button" title="关闭">
            <iconify-icon icon="carbon:close" width="20"></iconify-icon>
          </button>
        </div>
        <div class="p-5">
          <div class="pmc-form-group">
            <input class="pmc-input w-full" id="pmc-role-add-search" placeholder="搜索模型..." autocomplete="off">
          </div>
          <div id="pmc-role-add-list" class="mt-3 border border-slate-200 rounded-xl overflow-hidden"></div>
        </div>
      </div>
    `;

    const close = () => popup.remove();
    const backdrop = popup.querySelector('.absolute.inset-0');
    backdrop?.addEventListener('click', close);
    popup.querySelector('[data-action="close"]')?.addEventListener('click', close);

    const searchEl = popup.querySelector('#pmc-role-add-search');
    const listEl = popup.querySelector('#pmc-role-add-list');

    const renderList = () => {
      const q = String(searchEl?.value || '').trim().toLowerCase();
      const candidates = (Array.isArray(rows) ? rows : []).filter((r) => {
        if (!r?.id || current.has(r.id)) return false;
        if (!q) return true;
        return (
          String(r.modelId || '').toLowerCase().includes(q) ||
          String(r.sourceName || '').toLowerCase().includes(q) ||
          String(r.id || '').toLowerCase().includes(q)
        );
      });

      listEl.innerHTML = candidates.length
        ? candidates.slice(0, 200).map((r) => `
            <button class="w-full text-left px-4 py-3 hover:bg-slate-50 border-b border-slate-100 last:border-b-0" data-full-key="${safe(r.id)}" type="button">
              <div class="text-sm font-medium text-slate-900">${safe(r.modelId)}</div>
              <div class="text-xs text-slate-500">${safe(r.sourceName)} · <span class="font-mono">${safe(r.sourceKey)}</span></div>
            </button>
          `).join('')
        : `<div class="px-4 py-10 text-center text-sm text-slate-400">没有可添加的模型</div>`;
    };

    listEl?.addEventListener('click', (e) => {
      const btn = e.target?.closest?.('[data-full-key]');
      const fullKey = btn?.getAttribute?.('data-full-key');
      if (!fullKey) return;

      const next = Array.isArray(roleCfg[roleId]) ? roleCfg[roleId].slice() : [];
      next.push(fullKey);
      roleCfg[roleId] = Array.from(new Set(next));
      if (typeof onSave === 'function') onSave(roleCfg);
      close();
    });

    searchEl?.addEventListener('input', renderList);

    renderList();
    document.body.appendChild(popup);
  }

  function renderRoleOverview(container, rows, onChange) {
    if (!container) return;

    const roleCfg = normalizeRolePriorityConfig(loadConfig('rolePriority'));
    const rowsById = new Map((Array.isArray(rows) ? rows : []).map((r) => [r.id, r]));

    const renderRoleColumn = (r) => {
      const list = Array.isArray(roleCfg[r.id]) ? roleCfg[r.id] : [];
      const items = list.map((fullKey, idx) => {
        const label = getModelLabelForFullKey(fullKey, rowsById);
        return `
          <div class="pmc-drag-item pmc-role-column-item" draggable="true" data-model-key="${safe(fullKey)}">
            <span class="priority-num">${safe(String(idx + 1))}.</span>
            <span class="model-name">${safe(label.title || fullKey)}</span>
            <button class="pmc-drag-item-remove remove-btn" title="移除" data-remove-key="${safe(fullKey)}" type="button">
              <iconify-icon icon="carbon:trash-can" width="14"></iconify-icon>
            </button>
          </div>
        `;
      }).join('');

      return `
        <div class="pmc-role-column">
          <div class="pmc-role-column-header">
            <iconify-icon icon="${safe(r.icon)}" width="14"></iconify-icon>
            ${safe(ROLE_NAMES[r.id] || r.name)}
          </div>
          <div class="pmc-role-column-list pmc-role-dnd-list" data-role-id="${safe(r.id)}">
            ${items || `<div class="pmc-role-column-empty" data-action="add-to-role" data-role-id="${safe(r.id)}">（空） 点击添加</div>`}
          </div>
        </div>
      `;
    };

    const roleById = new Map(ROLES.map(r => [r.id, r]));

    container.innerHTML = `
      <div class="pmc-role-overview">
        <div class="pmc-role-overview-title">
          <iconify-icon icon="carbon:user-role" width="16"></iconify-icon>
          角色配置概览
        </div>
        ${Object.entries(ROLE_GROUPS).map(([groupKey, group]) => `
          <div class="pmc-role-group">
            <div class="pmc-role-group-header">${safe(group.name)}</div>
            <div class="pmc-role-columns">
              ${group.roles.map(rid => roleById.get(rid)).filter(Boolean).map(renderRoleColumn).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    `;

    const columns = Array.from(container.querySelectorAll('.pmc-role-dnd-list'));
    columns.forEach((col) => {
      const roleId = col.getAttribute('data-role-id');
      if (!roleId) return;
      setupDragAndDrop(col, () => {
        const next = Array.from(col.querySelectorAll('.pmc-drag-item'))
          .map((el) => el.getAttribute('data-model-key'))
          .filter(Boolean);
        const nextCfg = normalizeRolePriorityConfig(loadConfig('rolePriority'));
        nextCfg[roleId] = next;
        saveConfig('rolePriority', nextCfg);
        if (typeof onChange === 'function') onChange();
      });
    });

    container.querySelectorAll('[data-action="add-to-role"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const roleId = btn.getAttribute('data-role-id');
        if (!roleId) return;
        openRoleAddPicker({
          roleId,
          rows,
          roleCfg: normalizeRolePriorityConfig(loadConfig('rolePriority')),
          onSave: (nextCfg) => {
            saveConfig('rolePriority', nextCfg);
            if (typeof onChange === 'function') onChange();
          }
        });
      });
    });

    container.querySelectorAll('[data-remove-key]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // 从父级 .pmc-role-dnd-list 获取 roleId
        const roleList = btn.closest('.pmc-role-dnd-list');
        const roleId = roleList?.getAttribute?.('data-role-id') || '';

        const fullKey = btn.getAttribute('data-remove-key');
        if (!fullKey || !roleId) return;

        const nextCfg = normalizeRolePriorityConfig(loadConfig('rolePriority'));
        nextCfg[roleId] = (Array.isArray(nextCfg[roleId]) ? nextCfg[roleId] : []).filter((x) => x !== fullKey);
        saveConfig('rolePriority', nextCfg);
        if (typeof onChange === 'function') onChange();
      });
    });
  }

  function buildModelTableRows() {
    const sources = getAllConfigurableModels();
    const sourceMap = new Map(sources.map((s) => [s.key, s]));

    const tagsCfg = normalizeModelTagsConfig(loadConfig('modelTags'));
    const roleCfg = normalizeRolePriorityConfig(loadConfig('rolePriority'));

    const configuredFullKeys = new Set();
    for (const k of Object.keys(tagsCfg || {})) configuredFullKeys.add(k);
    for (const list of Object.values(roleCfg || {})) {
      for (const k of Array.isArray(list) ? list : []) configuredFullKeys.add(k);
    }

    for (const fullKey of configuredFullKeys) {
      const parts = splitFullModelKey(fullKey);
      if (!parts) continue;
      if (!sourceMap.has(parts.sourceKey)) {
        sourceMap.set(parts.sourceKey, { key: parts.sourceKey, name: parts.sourceKey, group: 'unknown' });
      }
    }

    const rows = [];
    const capIdSet = new Set(CAPABILITY_TAGS.map((t) => t.id));

    for (const [sourceKey, source] of sourceMap.entries()) {
      const fetched = Array.isArray(tab1ModelsSession.cache[sourceKey]) ? tab1ModelsSession.cache[sourceKey] : [];
      const modelIds = new Set(fetched);

      for (const fullKey of configuredFullKeys) {
        const parts = splitFullModelKey(fullKey);
        if (!parts || parts.sourceKey !== sourceKey) continue;
        modelIds.add(parts.modelId);
      }

      const { keyCount, validKeyCount } = getKeyStatsForSource(sourceKey);

      for (const modelId of Array.from(modelIds)) {
        const fullKey = `${sourceKey}:${modelId}`;
        const capabilitiesRaw = Array.isArray(tagsCfg[fullKey]) ? tagsCfg[fullKey] : [];
        const capabilities = Array.from(new Set(capabilitiesRaw.map((x) => String(x || '').trim()).filter((x) => capIdSet.has(x))));
        const agentRoles = getAgentRolePrioritiesForModel(fullKey, roleCfg);

        rows.push({
          id: fullKey,
          modelId,
          sourceKey,
          sourceName: source?.name || sourceKey,
          capabilities,
          keyCount,
          validKeyCount,
          agentRoles
        });
      }
    }

    rows.sort((a, b) => {
      const s = String(a.sourceName || '').localeCompare(String(b.sourceName || ''), 'zh');
      if (s !== 0) return s;
      return String(a.modelId || '').localeCompare(String(b.modelId || ''), 'zh');
    });

    return rows;
  }

  function renderModelRow(model) {
    const capabilityIcon = new Map(CAPABILITY_TAGS.map((t) => [t.id, t.icon]));
    const capabilityName = new Map(CAPABILITY_TAGS.map((t) => [t.id, t.name]));

    const capsHtml = (model.capabilities || []).length
      ? model.capabilities.map((c) => `
          <span class="inline-flex items-center justify-center w-7 h-7 rounded-lg border border-slate-200 bg-white" title="${safe(capabilityName.get(c) || c)}">
            <iconify-icon icon="${safe(capabilityIcon.get(c) || 'carbon:dot-mark')}" width="16"></iconify-icon>
          </span>
        `).join('')
      : `<span class="text-slate-400 text-xs">—</span>`;

    const keyIcon = (() => {
      if (!model.keyCount) return { icon: 'carbon:warning-filled', style: 'color:#ef4444' };
      if (model.validKeyCount >= model.keyCount) return { icon: 'carbon:checkmark-filled', style: 'color:#10b981' };
      if (model.validKeyCount > 0) return { icon: 'carbon:warning-filled', style: 'color:#f59e0b' };
      return { icon: 'carbon:warning-filled', style: 'color:#ef4444' };
    })();

    const rolesReadable = formatRoleAssignmentsReadable(model.agentRoles);

    return `
      <tr class="pmc-model-row hover:bg-slate-50" data-model-full-key="${safe(model.id)}">
        <td class="px-4 py-3 font-medium text-slate-900 whitespace-nowrap">${safe(model.modelId)}</td>
        <td class="px-4 py-3 text-slate-600 whitespace-nowrap">${safe(model.sourceName)}</td>
        <td class="px-4 py-3">
          <div class="flex items-center gap-1">${capsHtml}</div>
        </td>
        <td class="px-4 py-3 whitespace-nowrap">
          <div class="inline-flex items-center gap-2 text-slate-700">
            <span class="font-mono text-xs">${safe(String(model.validKeyCount))}/${safe(String(model.keyCount))}</span>
            <iconify-icon icon="${safe(keyIcon.icon)}" width="16" style="${safe(keyIcon.style)}"></iconify-icon>
          </div>
        </td>
        <td class="px-4 py-3 text-slate-700 whitespace-nowrap">
          ${rolesReadable ? `<span class="text-xs">${safe(rolesReadable)}</span>` : `<span class="text-slate-400 text-xs">-</span>`}
        </td>
        <td class="px-4 py-3 text-right whitespace-nowrap">
          <button class="pmc-model-config-btn inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs" data-action="open-config" type="button">
            <iconify-icon icon="carbon:settings" width="16"></iconify-icon>
            配置
          </button>
        </td>
      </tr>
    `;
  }

  function renderModelTable(container) {
    if (!container) return;

    const sources = getAllConfigurableModels();
    const selectedSourceKey = String(uiState.tableSourceKey || '');

    container.className = 'px-4 pt-4';
    container.innerHTML = `
      <div class="space-y-4">
        <div id="pmc-role-overview-container"></div>

        <div class="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div class="p-4 border-b border-slate-200 bg-white">
            <div class="flex flex-wrap items-center gap-2">
              <div class="text-sm font-semibold text-slate-800 mr-auto">
                全部模型 (<span id="pmc-model-total-count">0</span>)
              </div>
              <input id="pmc-model-search" class="pmc-input w-[240px]" placeholder="搜索模型..." autocomplete="off" value="${safe(uiState.tableSearch || '')}">
              <select id="pmc-model-source-filter" class="pmc-select w-[180px]">
                <option value="">全部来源</option>
                ${sources.map((s) => `<option value="${safe(s.key)}" ${selectedSourceKey === s.key ? 'selected' : ''}>${safe(s.name || s.key)}</option>`).join('')}
              </select>
              <label class="inline-flex items-center gap-2 text-xs text-slate-600 px-2 py-2 rounded-lg border border-slate-200 bg-white">
                <input id="pmc-model-configured-only" type="checkbox" ${uiState.tableConfiguredOnly ? 'checked' : ''}>
                仅显示已配置
              </label>
              <button id="pmc-model-refresh" class="pmc-btn-secondary" type="button">
                <iconify-icon icon="carbon:renew" width="16"></iconify-icon>
                刷新
              </button>
            </div>
          </div>

          <div class="overflow-auto">
            <table class="min-w-full text-sm">
              <thead class="bg-slate-50 text-slate-700">
                <tr class="border-b border-slate-200">
                  <th class="px-4 py-3 text-left font-semibold whitespace-nowrap">模型名称</th>
                  <th class="px-4 py-3 text-left font-semibold whitespace-nowrap">来源</th>
                  <th class="px-4 py-3 text-left font-semibold whitespace-nowrap">能力</th>
                  <th class="px-4 py-3 text-left font-semibold whitespace-nowrap">Key状态</th>
                  <th class="px-4 py-3 text-left font-semibold whitespace-nowrap">角色分配</th>
                  <th class="px-4 py-3 text-right font-semibold whitespace-nowrap">操作</th>
                </tr>
              </thead>
              <tbody id="pmc-model-table-body" class="divide-y divide-slate-100 bg-white"></tbody>
            </table>
          </div>

          <div id="pmc-model-table-footer" class="px-4 py-3 border-t border-slate-200 bg-white text-xs text-slate-500"></div>
        </div>
      </div>
    `;

    const roleOverviewEl = container.querySelector('#pmc-role-overview-container');
    const totalCountEl = container.querySelector('#pmc-model-total-count');
    const searchEl = container.querySelector('#pmc-model-search');
    const sourceFilterEl = container.querySelector('#pmc-model-source-filter');
    const configuredOnlyEl = container.querySelector('#pmc-model-configured-only');
    const bodyEl = container.querySelector('#pmc-model-table-body');
    const footerEl = container.querySelector('#pmc-model-table-footer');
    const refreshBtn = container.querySelector('#pmc-model-refresh');

    const rerender = () => {
      const rows = buildModelTableRows();
      if (totalCountEl) totalCountEl.textContent = String(rows.length);

      const q = String(uiState.tableSearch || '').trim().toLowerCase();
      const sourceKey = String(uiState.tableSourceKey || '');
      const configuredOnly = !!uiState.tableConfiguredOnly;

      const filtered = rows.filter((r) => {
        if (sourceKey && r.sourceKey !== sourceKey) return false;
        if (configuredOnly && !Object.values(r.agentRoles || {}).some((x) => Number(x) > 0)) return false;
        if (!q) return true;
        return (
          String(r.modelId || '').toLowerCase().includes(q) ||
          String(r.sourceName || '').toLowerCase().includes(q) ||
          String(r.id || '').toLowerCase().includes(q)
        );
      });

      renderRoleOverview(roleOverviewEl, rows, rerender);

      bodyEl.innerHTML = filtered.length
        ? filtered.map(renderModelRow).join('')
        : `<tr><td class="px-4 py-8 text-center text-slate-400" colspan="6">没有匹配的模型</td></tr>`;

      const inflightCount = Object.keys(tab1ModelsSession.inflight || {}).length;
      const errCount = Object.values(tab1ModelsSession.error || {}).filter(Boolean).length;
      const hint = [];
      hint.push(`显示 ${filtered.length}/${rows.length}`);
      if (inflightCount) hint.push(`预加载中：${inflightCount}`);
      if (errCount) hint.push(`获取失败：${errCount}`);
      footerEl.textContent = hint.join(' · ');

      uiState._refreshModelTable = rerender;
    };

    const onRefresh = async () => {
      const sourceKey = String(uiState.tableSourceKey || '');
      const sourcesToRefresh = sourceKey ? [sourceKey] : getAllConfigurableModels().map((s) => s.key);

      for (const k of sourcesToRefresh) {
        delete tab1ModelsSession.cache[k];
        delete tab1ModelsSession.error[k];
      }

      rerender();
      await Promise.allSettled(sourcesToRefresh.map((k) => fetchModelsForSource(k)));
      rerender();
      showSaveSuccess('模型列表已刷新');
    };

    const openConfigForFullKey = (fullKey) => {
      const all = buildModelTableRows();
      const model = all.find((r) => r.id === fullKey);
      if (!model) return;
      renderModelConfigPopup(model);
    };

    searchEl?.addEventListener('input', () => {
      uiState.tableSearch = String(searchEl.value || '');
      rerender();
    });

    sourceFilterEl?.addEventListener('change', () => {
      uiState.tableSourceKey = String(sourceFilterEl.value || '');
      rerender();
    });

    configuredOnlyEl?.addEventListener('change', () => {
      uiState.tableConfiguredOnly = !!configuredOnlyEl.checked;
      rerender();
    });

    refreshBtn?.addEventListener('click', onRefresh);

    bodyEl?.addEventListener('click', (e) => {
      const actionBtn = e.target?.closest?.('[data-action="open-config"]');
      if (!actionBtn) return;
      const row = actionBtn?.closest?.('tr[data-model-full-key]');
      const fullKey = row?.getAttribute?.('data-model-full-key');
      if (!fullKey) return;
      openConfigForFullKey(fullKey);
    });

    rerender();
  }

  let activeModelConfigPopupEl = null;

  function renderModelConfigPopup(model) {
    if (!model?.id) return;

    if (activeModelConfigPopupEl) {
      activeModelConfigPopupEl.remove();
      activeModelConfigPopupEl = null;
    }

    const fullKey = model.id;
    const modelTagsCfg = normalizeModelTagsConfig(loadConfig('modelTags'));
    const roleCfg = normalizeRolePriorityConfig(loadConfig('rolePriority'));

    const selectedTags = new Set(Array.isArray(modelTagsCfg[fullKey]) ? modelTagsCfg[fullKey] : []);
    const priorities = getAgentRolePrioritiesForModel(fullKey, roleCfg);

    const popup = document.createElement('div');
    popup.className = 'fixed inset-0 flex items-center justify-center';
    popup.style.zIndex = '9999';

    popup.innerHTML = `
      <div class="absolute inset-0 bg-black/40"></div>
      <div class="relative w-[min(760px,95vw)] max-h-[90vh] overflow-auto bg-white rounded-2xl shadow-2xl border border-slate-200">
        <div class="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-4">
          <div>
            <div class="text-base font-semibold text-slate-900">模型配置</div>
            <div class="text-xs text-slate-500 mt-1 font-mono">${safe(model.sourceKey)}:${safe(model.modelId)}</div>
          </div>
          <button class="w-9 h-9 inline-flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-500" data-action="close" type="button" title="关闭">
            <iconify-icon icon="carbon:close" width="20"></iconify-icon>
          </button>
        </div>

        <div class="p-5 space-y-6">
          <div>
            <div class="text-sm font-semibold text-slate-800 mb-3">能力</div>
            <div class="flex flex-wrap gap-2">
              ${CAPABILITY_TAGS.map((t) => {
                const active = selectedTags.has(t.id);
                return `
                  <button
                    class="pmc-cap-btn ${active ? 'selected' : ''}"
                    data-action="toggle-cap"
                    data-cap="${safe(t.id)}"
                    type="button"
                  >
                    <iconify-icon icon="${safe(t.icon)}" width="18"></iconify-icon>
                    <span class="text-sm font-medium">${safe(t.name)}</span>
                  </button>
                `;
              }).join('')}
            </div>
          </div>

          <div>
            <div class="text-sm font-semibold text-slate-800 mb-3">角色分配</div>
            <div class="pmc-role-assign-list">
              ${ROLES.map((r) => {
                const v = Math.min(5, Math.max(0, Number(priorities?.[r.id] || 0)));
                const checked = v > 0;
                return `
                  <div class="pmc-role-assign-item">
                    <label>
                      <input class="pmc-role-check" type="checkbox" data-role="${safe(r.id)}" ${checked ? 'checked' : ''}>
                      <span>${safe(ROLE_NAMES[r.id] || r.name)}</span>
                    </label>
                    <input class="pmc-role-priority priority-input" type="number" min="1" max="5" step="1" data-role-priority="${safe(r.id)}" value="${safe(String(checked ? v : 1))}" ${checked ? '' : 'disabled'}>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        </div>

        <div class="px-5 py-4 border-t border-slate-200 bg-white flex items-center justify-end gap-2">
          <button class="pmc-btn-secondary" data-action="cancel" type="button">取消</button>
          <button class="pmc-btn-save" data-action="save" type="button">
            <iconify-icon icon="carbon:save" width="16"></iconify-icon>
            保存
          </button>
        </div>
      </div>
    `;

    const close = () => {
      popup.remove();
      if (activeModelConfigPopupEl === popup) activeModelConfigPopupEl = null;
    };

    const backdrop = popup.querySelector('.absolute.inset-0');
    backdrop?.addEventListener('click', close);

    popup.querySelectorAll('[data-action="close"], [data-action="cancel"]').forEach((el) => {
      el.addEventListener('click', close);
    });

    popup.querySelectorAll('[data-action="toggle-cap"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cap = btn.getAttribute('data-cap');
        if (!cap) return;
        if (selectedTags.has(cap)) selectedTags.delete(cap);
        else selectedTags.add(cap);
        btn.classList.toggle('selected', selectedTags.has(cap));
      });
    });

    popup.querySelectorAll('.pmc-role-check').forEach((ck) => {
      ck.addEventListener('change', () => {
        const roleId = ck.getAttribute('data-role');
        if (!roleId) return;
        const input = popup.querySelector(`.pmc-role-priority[data-role-priority="${roleId}"]`);
        if (!input) return;
        input.disabled = !ck.checked;
        if (ck.checked && !Number(input.value)) input.value = '1';
      });
    });

    popup.querySelector('[data-action="save"]')?.addEventListener('click', () => {
      const nextTags = Array.from(selectedTags).filter(Boolean);
      modelTagsCfg[fullKey] = nextTags;
      saveConfig('modelTags', modelTagsCfg);

      const nextRoleCfg = normalizeRolePriorityConfig(roleCfg);
      for (const r of ROLES) {
        const ck = popup.querySelector(`.pmc-role-check[data-role="${r.id}"]`);
        const enabled = !!ck?.checked;
        const input = popup.querySelector(`.pmc-role-priority[data-role-priority="${r.id}"]`);
        const nRaw = enabled ? Number(input?.value || 1) : 0;
        const n = enabled ? Math.min(5, Math.max(1, Math.floor(nRaw || 1))) : 0;

        const list = Array.isArray(nextRoleCfg[r.id]) ? nextRoleCfg[r.id].filter((x) => x !== fullKey) : [];
        if (n > 0) {
          const idx = Math.max(0, Math.min(list.length, n - 1));
          list.splice(idx, 0, fullKey);
        }
        nextRoleCfg[r.id] = Array.from(new Set(list));
      }
      saveConfig('rolePriority', nextRoleCfg);

      showSaveSuccess('模型配置已保存');
      close();
      if (typeof uiState._refreshModelTable === 'function') uiState._refreshModelTable();
    });

    document.body.appendChild(popup);
    activeModelConfigPopupEl = popup;
  }

  function initModelTableView({ forceRender = false } = {}) {
    const root = getModalRoot();
    if (!root) return;

    const container = root.querySelector('#pmc-model-table-container');
    if (container && (forceRender || container.dataset.rendered !== '1')) {
      renderModelTable(container);
      container.dataset.rendered = '1';
    }

    const collapse = root.querySelector('.pmc-audio-collapse');
    if (collapse && collapse.dataset.bound !== '1') {
      const header = collapse.querySelector('.pmc-audio-collapse-header');
      const body = collapse.querySelector('.pmc-audio-collapse-body');
      const chevron = collapse.querySelector('.pmc-audio-collapse-chevron');
      collapse.dataset.bound = '1';

      const setOpen = (open) => {
        collapse.classList.toggle('open', !!open);
        if (chevron) chevron.style.transform = open ? 'rotate(180deg)' : '';
      };
      setOpen(false);

      header?.addEventListener('click', () => {
        const isOpen = collapse.classList.contains('open');
        setOpen(!isOpen);
      });
    }

    // 每次打开都刷新音频区内容（保留现有 renderTab3Content 实现）
    const audioBody = root.querySelector('.pmc-audio-collapse-body');
    if (audioBody) {
      renderTab3Content(audioBody);
      // 默认折叠（每次打开重置）
      const collapseEl = root.querySelector('.pmc-audio-collapse');
      if (collapseEl) collapseEl.classList.remove('open');
      const chevron = root.querySelector('.pmc-audio-collapse-chevron');
      if (chevron) chevron.style.transform = '';
    }
  }

  function preloadAllSourcesModels() {
    const root = getModalRoot();
    if (!root) return;

    const sources = getAllConfigurableModels();
    if (!sources.length) return;

    Promise.allSettled(sources.map((s) => fetchModelsForSource(s.key)))
      .finally(() => {
        if (typeof uiState._refreshModelTable === 'function') uiState._refreshModelTable();
      });
  }

  // ========== Tab 1: 模型标签 ==========

  // Tab1 会话级缓存：源站 -> 模型列表
  const tab1ModelsSession = {
    cache: {},     // sourceKey -> string[]
    inflight: {},  // sourceKey -> Promise<string[]>
    error: {}      // sourceKey -> string
  };

  function normalizeApiBaseUrl(url) {
    return String(url || '').trim().replace(/\/+$/, '').replace(/\/v1$/, '');
  }

  function getDefaultApiBaseUrlForSource(sourceKey) {
    const provider = COMMON_API_PROVIDERS.find(p => p.key === sourceKey);
    if (provider?.endpoint) return provider.endpoint;
    return '';
  }

  function resolveApiBaseUrlForSource(sourceKey) {
    if (!sourceKey) return '';

    // 自定义源站
    if (String(sourceKey).startsWith('custom_source_') && typeof loadAllCustomSourceSites === 'function') {
      const sites = loadAllCustomSourceSites() || {};
      const siteId = String(sourceKey).replace('custom_source_', '');
      const site = sites?.[siteId] || {};
      return normalizeApiBaseUrl(site.apiBaseUrl || site.apiEndpoint || site.baseUrl || '');
    }

    const cfg = typeof loadModelConfig === 'function' ? (loadModelConfig(sourceKey) || {}) : {};
    return normalizeApiBaseUrl(cfg.apiBaseUrl || getDefaultApiBaseUrlForSource(sourceKey));
  }

  function resolveFirstUsableApiKeyForSource(sourceKey) {
    if (!sourceKey || typeof loadModelKeys !== 'function') return '';
    try {
      const keys = loadModelKeys(sourceKey) || [];
      const usable = keys.filter((k) => k && k.value && (k.status === 'valid' || k.status === 'untested'));
      return usable[0]?.value || '';
    } catch (_) {
      return '';
    }
  }

  function parseOpenAICompatibleModelIds(payload) {
    const pickArray = (v) => (Array.isArray(v) ? v : []);
    const candidates = [
      ...pickArray(payload),
      ...pickArray(payload?.data),
      ...pickArray(payload?.models),
      ...pickArray(payload?.result?.data),
      ...pickArray(payload?.data?.data),
      ...pickArray(payload?.data?.models),
      ...pickArray(payload?.data?.result?.data)
    ];

    const out = [];
    const seen = new Set();
    for (const item of candidates) {
      if (!item || typeof item !== 'object') continue;
      const rawId = item.id || item.model || item.name || '';
      let id = String(rawId || '').trim();
      if (!id) continue;
      // 一些兼容实现会返回 "models/<id>" 或 "publishers/<p>/models/<id>"
      if (id.includes('/')) id = id.split('/').pop();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  }

  // 新增：实时获取某源站的模型列表（会话级缓存）
  async function fetchModelsForSource(sourceKey) {
    if (!sourceKey) return [];
    if (Array.isArray(tab1ModelsSession.cache[sourceKey])) return tab1ModelsSession.cache[sourceKey];
    if (tab1ModelsSession.inflight[sourceKey]) return tab1ModelsSession.inflight[sourceKey];

    tab1ModelsSession.error[sourceKey] = '';
    const task = (async () => {
      const apiKey = resolveFirstUsableApiKeyForSource(sourceKey);
      if (!apiKey) throw new Error('NO_API_KEY');

      const baseUrl = resolveApiBaseUrlForSource(sourceKey);
      if (!baseUrl) throw new Error('NO_BASE_URL');

      // 优先走 OpenAI 兼容的 /v1/models，失败时回退到 /models
      const tryFetch = async (endpoint) => {
        const resp = await fetch(endpoint, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Accept': 'application/json'
          }
        });
        if (!resp.ok) throw new Error(`HTTP_${resp.status}`);
        const data = await resp.json();
        const ids = parseOpenAICompatibleModelIds(data);
        if (!ids.length) throw new Error('EMPTY_MODELS');
        return ids;
      };

      const endpointV1 = `${normalizeApiBaseUrl(baseUrl)}/v1/models`;
      try {
        return await tryFetch(endpointV1);
      } catch (e) {
        const endpointFallback = `${normalizeApiBaseUrl(baseUrl)}/models`;
        return await tryFetch(endpointFallback);
      }
    })()
      .then((ids) => {
        const unique = Array.from(new Set((ids || []).map((x) => String(x || '').trim()).filter(Boolean)));
        unique.sort((a, b) => a.localeCompare(b));
        tab1ModelsSession.cache[sourceKey] = unique;
        return unique;
      })
      .catch((err) => {
        const msg = String(err?.message || err || '').trim();
        if (msg === 'NO_API_KEY') tab1ModelsSession.error[sourceKey] = '未配置可用 Key，无法获取模型列表';
        else if (msg === 'NO_BASE_URL') tab1ModelsSession.error[sourceKey] = '未配置 API Base URL';
        else if (msg.startsWith('HTTP_')) tab1ModelsSession.error[sourceKey] = `请求失败（${msg.replace('HTTP_', '')}）`;
        else tab1ModelsSession.error[sourceKey] = '获取失败';
        delete tab1ModelsSession.cache[sourceKey];
        return [];
      })
      .finally(() => {
        delete tab1ModelsSession.inflight[sourceKey];
      });

    tab1ModelsSession.inflight[sourceKey] = task;
    return task;
  }

  function normalizeModelTagsConfig(raw) {
    const obj = normalizeObject(raw);
    const out = {};
    for (const [modelKey, tags] of Object.entries(obj)) {
      if (!modelKey) continue;
      const arr = Array.isArray(tags) ? tags : [];
      const cleaned = [];
      const seen = new Set();
      for (const t of arr) {
        const id = String(t || '').trim();
        if (!id || seen.has(id)) continue;
        if (!CAPABILITY_TAGS.some((x) => x.id === id)) continue;
        seen.add(id);
        cleaned.push(id);
      }
      out[modelKey] = cleaned;
    }
    return out;
  }

  function renderTab1Content(panel) {
    panel.innerHTML = `
      <div class="pmc-tab-layout pmc-tab-layout-60-40">
        <div class="pmc-tab-left">
          <div class="pmc-panel-title">
            <iconify-icon icon="carbon:catalog" width="18"></iconify-icon>
            源站 / 模型列表
          </div>
          <div class="pmc-form-group">
            <input id="pmc-tags-search" class="pmc-input" placeholder="搜索模型..." autocomplete="off">
          </div>
          <div id="pmc-tags-source-list" class="pmc-accordion"></div>
        </div>
        <div class="pmc-tab-right">
          <div class="pmc-panel-title">
            <iconify-icon icon="carbon:tag-group" width="18"></iconify-icon>
            能力标签
            <span id="pmc-tags-selected-name" class="pmc-panel-subtitle">未选择模型</span>
          </div>
          <div id="pmc-tags-icons" class="pmc-tags-icons"></div>
          <div class="pmc-tab-actions">
            <button id="pmc-tags-clear" class="pmc-btn-secondary" disabled>
              <iconify-icon icon="carbon:trash-can" width="16"></iconify-icon>
              清空当前模型标签
            </button>
          </div>
          <div class="pmc-helper-text">提示：为每个具体模型打上能力标签（存储格式：<code>{ "openai:gpt-4o": ["lang"] }</code>）。</div>
        </div>
      </div>
    `;

    const sourceListEl = panel.querySelector('#pmc-tags-source-list');
    const searchEl = panel.querySelector('#pmc-tags-search');
    const iconsEl = panel.querySelector('#pmc-tags-icons');
    const selectedNameEl = panel.querySelector('#pmc-tags-selected-name');
    const clearBtn = panel.querySelector('#pmc-tags-clear');

    const sources = getAllConfigurableModels();
    console.log('[PPT Model Config] Tab1 sources:', sources);
    const cfg = normalizeModelTagsConfig(loadConfig('modelTags'));

    const expandedSet = new Set(Array.isArray(uiState.tagsExpandedSources) ? uiState.tagsExpandedSources : []);

    const getSourceName = (sourceKey) => sources.find((s) => s.key === sourceKey)?.name || sourceKey;

    const getActiveModelParts = () => {
      const fullKey = uiState.tagsActiveModelKey;
      if (!fullKey || !String(fullKey).includes(':')) return null;
      const idx = String(fullKey).indexOf(':');
      const sourceKey = String(fullKey).slice(0, idx);
      const modelId = String(fullKey).slice(idx + 1);
      if (!sourceKey || !modelId) return null;
      return { fullKey, sourceKey, modelId };
    };

    const getSelectedTags = () => {
      const active = getActiveModelParts();
      if (!active) return [];
      return Array.isArray(cfg[active.fullKey]) ? cfg[active.fullKey] : [];
    };

    const countTaggedModelsForSource = (sourceKey) => {
      const prefix = `${sourceKey}:`;
      let count = 0;
      for (const [k, v] of Object.entries(cfg)) {
        if (!k.startsWith(prefix)) continue;
        if (Array.isArray(v) && v.length) count += 1;
      }
      return count;
    };

    const ensureModelsLoaded = async (sourceKey) => {
      if (!sourceKey) return;
      if (Array.isArray(tab1ModelsSession.cache[sourceKey])) return;
      await fetchModelsForSource(sourceKey);
    };

    const renderSourceList = () => {
      const q = String(searchEl?.value || '').trim().toLowerCase();

      sourceListEl.innerHTML = sources.length
        ? sources.map((s) => {
            const open = expandedSet.has(s.key);
            const loading = !!tab1ModelsSession.inflight[s.key];
            const models = Array.isArray(tab1ModelsSession.cache[s.key]) ? tab1ModelsSession.cache[s.key] : null;
            const error = tab1ModelsSession.error[s.key] || '';
            const taggedCount = countTaggedModelsForSource(s.key);

            const visibleModels = Array.isArray(models)
              ? models.filter((id) => !q || String(id || '').toLowerCase().includes(q))
              : [];

            const headerRight = Array.isArray(models)
              ? `<span class="pmc-badge" title="模型数">${models.length}</span>`
              : `<span class="pmc-badge pmc-badge-muted" title="未加载">-</span>`;

            const taggedBadge = taggedCount
              ? `<span class="pmc-badge pmc-badge-primary" title="已标注模型">${taggedCount}</span>`
              : `<span class="pmc-badge pmc-badge-muted" title="已标注模型">0</span>`;

            const bodyHtml = !open
              ? ''
              : loading
                ? `<div class="pmc-loading">加载中…</div>`
                : error
                  ? `<div class="pmc-empty">${safe(error)}</div>`
                  : Array.isArray(models) && models.length
                    ? `
                      <div class="pmc-model-list">
                        ${visibleModels.length
                          ? visibleModels.map((modelId) => {
                              const fullKey = `${s.key}:${modelId}`;
                              const active = uiState.tagsActiveModelKey === fullKey ? 'active' : '';
                              const tags = Array.isArray(cfg[fullKey]) ? cfg[fullKey] : [];
                              const tagIcons = CAPABILITY_TAGS.map((t) => {
                                const on = tags.includes(t.id) ? 'on' : '';
                                return `<iconify-icon class="${on}" icon="${safe(t.icon)}" width="14" title="${safe(t.name)}"></iconify-icon>`;
                              }).join('');
                              return `
                                <button class="pmc-model-item ${active}" data-action="select-model" data-model-full-key="${safe(fullKey)}" title="${safe(fullKey)}">
                                  <div class="pmc-model-item-main">
                                    <div class="pmc-model-item-title">${safe(modelId)}</div>
                                    <div class="pmc-model-item-sub">${safe(s.key)}</div>
                                  </div>
                                  <div class="pmc-model-tags">${tagIcons}</div>
                                </button>
                              `;
                            }).join('')
                          : `<div class="pmc-empty">没有匹配的模型</div>`
                        }
                      </div>
                    `
                    : `<div class="pmc-empty">未获取到模型</div>`;

            return `
              <div class="pmc-acc-item" data-source-key="${safe(s.key)}">
                <button class="pmc-acc-header" data-action="toggle-source" data-source-key="${safe(s.key)}" title="${safe(s.key)}">
                  <iconify-icon class="pmc-acc-chevron ${open ? 'open' : ''}" icon="carbon:chevron-right" width="16"></iconify-icon>
                  <div class="pmc-acc-title">
                    <div class="pmc-acc-title-main">${safe(s.name || s.key)}</div>
                    <div class="pmc-acc-title-sub">${safe(s.key)}</div>
                  </div>
                  <div class="pmc-acc-meta">
                    ${taggedBadge}
                    ${headerRight}
                  </div>
                </button>
                ${open ? `<div class="pmc-acc-body">${bodyHtml}</div>` : ''}
              </div>
            `;
          }).join('')
        : `<div class="pmc-empty">未发现可配置源站</div>`;
    };

    const renderTagIcons = () => {
      const active = getActiveModelParts();
      const selectedTags = getSelectedTags();
      selectedNameEl.textContent = active ? `${getSourceName(active.sourceKey)} · ${active.modelId}` : '未选择模型';
      clearBtn.disabled = !active || selectedTags.length === 0;

      iconsEl.innerHTML = CAPABILITY_TAGS.map((t) => {
        const selected = selectedTags.includes(t.id);
        return `
          <button
            class="pmc-tag-icon-btn ${selected ? 'selected' : ''}"
            data-action="toggle-tag"
            data-tag-id="${safe(t.id)}"
            title="${safe(t.name)}"
            ${active ? '' : 'disabled'}
          >
            <iconify-icon icon="${safe(t.icon)}" width="22"></iconify-icon>
          </button>
        `;
      }).join('');
    };

    const persist = () => {
      saveConfig('modelTags', cfg);
      showSaveSuccess('模型标签已保存');
      renderSourceList();
      renderTagIcons();
    };

    const selectModel = (fullKey) => {
      uiState.tagsActiveModelKey = fullKey;
      renderSourceList();
      renderTagIcons();
    };

    sourceListEl.addEventListener('click', async (e) => {
      const actionEl = e.target?.closest?.('[data-action]');
      const action = actionEl?.getAttribute?.('data-action');
      if (!action) return;

      if (action === 'toggle-source') {
        const sourceKey = actionEl.getAttribute('data-source-key');
        if (!sourceKey) return;
        const nextOpen = !expandedSet.has(sourceKey);
        if (nextOpen) expandedSet.add(sourceKey);
        else expandedSet.delete(sourceKey);
        uiState.tagsExpandedSources = Array.from(expandedSet);
        renderSourceList();
        if (nextOpen) {
          await ensureModelsLoaded(sourceKey);
          renderSourceList();
        }
      } else if (action === 'select-model') {
        const fullKey = actionEl.getAttribute('data-model-full-key');
        if (!fullKey) return;
        selectModel(fullKey);
      }
    });

    searchEl?.addEventListener('input', () => renderSourceList());

    iconsEl.addEventListener('click', (e) => {
      const btn = e.target?.closest?.('[data-action="toggle-tag"]');
      const tagId = btn?.getAttribute?.('data-tag-id');
      if (!tagId) return;

      const active = getActiveModelParts();
      if (!active) return;

      const current = Array.isArray(cfg[active.fullKey]) ? cfg[active.fullKey] : [];
      const next = new Set(current);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      cfg[active.fullKey] = Array.from(next);
      persist();
    });

    clearBtn.addEventListener('click', () => {
      const active = getActiveModelParts();
      if (!active) return;
      cfg[active.fullKey] = [];
      persist();
    });

    // 默认展开第一项并拉取模型列表（不强制默认选中具体模型）
    if (sources.length && expandedSet.size === 0) {
      expandedSet.add(sources[0].key);
      uiState.tagsExpandedSources = Array.from(expandedSet);
      fetchModelsForSource(sources[0].key).finally(() => renderSourceList());
    }
    renderSourceList();
    renderTagIcons();
  }

  // ========== Tab 2: 角色优先级 ==========

  function normalizeRolePriorityConfig(raw) {
    const obj = normalizeObject(raw);
    const out = {};
    for (const r of ROLES) {
      const list = obj[r.id];
      out[r.id] = Array.isArray(list) ? list.map((x) => String(x || '').trim()).filter(Boolean) : [];
    }
    return out;
  }

  function renderTab2Content(panel) {
    panel.innerHTML = `
      <div class="pmc-tab-layout">
        <div class="pmc-tab-left">
          <div class="pmc-panel-title">
            <iconify-icon icon="carbon:user-role" width="18"></iconify-icon>
            角色列表
          </div>
          <div id="pmc-roles-list" class="pmc-list"></div>
        </div>
        <div class="pmc-tab-right">
          <div class="pmc-panel-title">
            <iconify-icon icon="carbon:list-numbered" width="18"></iconify-icon>
            <span id="pmc-role-title">模型优先级</span>
          </div>
          <div class="pmc-two-col">
            <div>
              <div class="pmc-subheading">可用模型</div>
              <div class="pmc-form-group">
                <input id="pmc-available-search" class="pmc-input" placeholder="搜索可用模型..." autocomplete="off">
              </div>
              <div id="pmc-available-models" class="pmc-list pmc-list-compact"></div>
            </div>
            <div>
              <div class="pmc-subheading">当前优先级（拖拽排序）</div>
              <div id="pmc-priority-list" class="pmc-dnd-list"></div>
            </div>
          </div>
          <div class="pmc-helper-text">提示：拖动排序后会自动保存。</div>
        </div>
      </div>
    `;

    const rolesListEl = panel.querySelector('#pmc-roles-list');
    const roleTitleEl = panel.querySelector('#pmc-role-title');
    const availableSearchEl = panel.querySelector('#pmc-available-search');
    const availableListEl = panel.querySelector('#pmc-available-models');
    const priorityListEl = panel.querySelector('#pmc-priority-list');

    const allModels = getAllConfigurableModels();
    const roleCfg = normalizeRolePriorityConfig(loadConfig('rolePriority'));

    const persist = () => {
      saveConfig('rolePriority', roleCfg);
      showSaveSuccess('角色优先级已保存');
      renderAvailableModels();
    };

    const renderRoles = () => {
      rolesListEl.innerHTML = ROLES.map((r) => {
        const active = uiState.priorityActiveRole === r.id ? 'active' : '';
        return `
          <button class="pmc-list-item ${active}" data-role-id="${safe(r.id)}">
            <div class="pmc-list-item-main">
              <div class="pmc-list-item-title">
                <iconify-icon icon="${safe(r.icon)}" width="16"></iconify-icon>
                ${safe(r.name)}
              </div>
              <div class="pmc-list-item-sub">${safe(r.desc)}</div>
            </div>
          </button>
        `;
      }).join('');
    };

    const renderPriorityList = () => {
      const roleId = uiState.priorityActiveRole;
      const order = Array.isArray(roleCfg[roleId]) ? roleCfg[roleId] : [];
      const label = ROLES.find((r) => r.id === roleId)?.name || roleId;
      roleTitleEl.textContent = `${label} · 模型优先级`;

      const keyToName = new Map(allModels.map((m) => [m.key, m.name || m.key]));

      priorityListEl.innerHTML = order.length
        ? order.map((k) => `
            <div class="pmc-drag-item" draggable="true" data-model-key="${safe(k)}">
              <div class="pmc-drag-item-title">${safe(keyToName.get(k) || k)}</div>
              <div class="pmc-drag-item-sub">${safe(k)}</div>
              <button class="pmc-drag-item-remove" title="移除" data-remove-key="${safe(k)}">
                <iconify-icon icon="carbon:trash-can" width="16"></iconify-icon>
              </button>
            </div>
          `).join('')
        : `<div class="pmc-empty">暂无优先级配置，可从左侧添加</div>`;

      setupDragAndDrop(priorityListEl, () => {
        const next = Array.from(priorityListEl.querySelectorAll('.pmc-drag-item'))
          .map((el) => el.getAttribute('data-model-key'))
          .filter(Boolean);
        roleCfg[roleId] = next;
        persist();
      });
    };

    const renderAvailableModels = () => {
      const q = String(availableSearchEl?.value || '').trim().toLowerCase();
      const roleId = uiState.priorityActiveRole;
      const chosen = new Set(Array.isArray(roleCfg[roleId]) ? roleCfg[roleId] : []);

      const filtered = allModels.filter((m) => {
        if (!q) return true;
        return String(m.name || '').toLowerCase().includes(q) || String(m.key || '').toLowerCase().includes(q);
      });

      availableListEl.innerHTML = filtered.length
        ? filtered.map((m) => {
            const disabled = chosen.has(m.key);
            return `
              <div class="pmc-list-row">
                <div class="pmc-list-row-main">
                  <div class="pmc-list-row-title">${safe(m.name || m.key)}</div>
                  <div class="pmc-list-row-sub">${safe(m.key)}</div>
                </div>
                <button class="pmc-btn-mini" data-add-key="${safe(m.key)}" ${disabled ? 'disabled' : ''}>
                  <iconify-icon icon="carbon:add" width="14"></iconify-icon>
                  添加
                </button>
              </div>
            `;
          }).join('')
        : `<div class="pmc-empty">没有可用模型</div>`;
    };

    rolesListEl.addEventListener('click', (e) => {
      const btn = e.target?.closest?.('.pmc-list-item');
      const roleId = btn?.getAttribute('data-role-id');
      if (!roleId) return;
      uiState.priorityActiveRole = roleId;
      renderRoles();
      renderPriorityList();
      renderAvailableModels();
    });

    availableSearchEl?.addEventListener('input', () => renderAvailableModels());

    availableListEl.addEventListener('click', (e) => {
      const addKey = e.target?.closest?.('[data-add-key]')?.getAttribute('data-add-key');
      if (!addKey) return;
      const roleId = uiState.priorityActiveRole;
      const list = Array.isArray(roleCfg[roleId]) ? roleCfg[roleId] : [];
      if (list.includes(addKey)) return;
      list.push(addKey);
      roleCfg[roleId] = list;
      renderPriorityList();
      persist();
    });

    priorityListEl.addEventListener('click', (e) => {
      const removeKey = e.target?.closest?.('[data-remove-key]')?.getAttribute('data-remove-key');
      if (!removeKey) return;
      const roleId = uiState.priorityActiveRole;
      roleCfg[roleId] = (roleCfg[roleId] || []).filter((k) => k !== removeKey);
      renderPriorityList();
      persist();
    });

    if (!uiState.priorityActiveRole) uiState.priorityActiveRole = ROLES[0]?.id || 'analyst';
    renderRoles();
    renderPriorityList();
    renderAvailableModels();
  }

  function setupDragAndDrop(container, onReorder) {
    if (!container) return;
    container.__pmcOnReorder = onReorder;
    if (container.dataset.dndBound === '1') return;
    container.dataset.dndBound = '1';

    let dragging = null;

    const clearIndicators = () => {
      container.querySelectorAll('.drag-above, .drag-below').forEach((el) => {
        el.classList.remove('drag-above', 'drag-below');
      });
    };

    container.addEventListener('dragstart', (e) => {
      const item = e.target?.closest?.('.pmc-drag-item');
      if (!item) return;
      dragging = item;
      item.classList.add('dragging');
      e.dataTransfer?.setData?.('text/plain', item.getAttribute('data-model-key') || '');
      e.dataTransfer?.setDragImage?.(item, 12, 12);
    });

    container.addEventListener('dragend', () => {
      if (dragging) dragging.classList.remove('dragging');
      dragging = null;
      clearIndicators();
      const cb = container.__pmcOnReorder;
      if (typeof cb === 'function') cb();
    });

    container.addEventListener('dragover', (e) => {
      if (!dragging) return;
      e.preventDefault();

      const target = e.target?.closest?.('.pmc-drag-item');
      if (!target || target === dragging) return;

      const rect = target.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;

      clearIndicators();
      target.classList.add(before ? 'drag-above' : 'drag-below');

      if (before) {
        container.insertBefore(dragging, target);
      } else {
        container.insertBefore(dragging, target.nextSibling);
      }
    });

    container.addEventListener('drop', (e) => {
      if (!dragging) return;
      e.preventDefault();
      clearIndicators();
    });
  }

  // ========== Tab 3: 音频配置 ==========

  function normalizeAudioConfig(raw) {
    const obj = normalizeObject(raw);
    const t = normalizeObject(obj.transcription);
    const s = normalizeObject(obj.synthesis);
    return {
      transcription: {
        provider: String(t.provider || 'groq'),
        apiKey: String(t.apiKey || ''),
        model: String(t.model || '')
      },
      synthesis: {
        provider: String(s.provider || 'elevenlabs'),
        apiKey: String(s.apiKey || ''),
        model: String(s.model || ''),
        voice: String(s.voice || '')
      }
    };
  }

  function renderTab3Content(panel) {
    const cfg = normalizeAudioConfig(loadConfig('audio'));

    panel.innerHTML = `
      <div class="pmc-audio-grid">
        <div class="pmc-audio-section">
          <div class="pmc-panel-title">
            <iconify-icon icon="carbon:audio-console" width="18"></iconify-icon>
            转录配置（Speech-to-Text）
          </div>
          <div class="pmc-form-group">
            <label class="pmc-label">Provider</label>
            <select id="pmc-stt-provider" class="pmc-select"></select>
          </div>
          <div class="pmc-form-group">
            <label class="pmc-label">API Key</label>
            <input id="pmc-stt-api-key" class="pmc-input" type="password" placeholder="输入转录 API Key">
          </div>
          <div class="pmc-form-group">
            <label class="pmc-label">Model</label>
            <select id="pmc-stt-model-select" class="pmc-select"></select>
            <input id="pmc-stt-model-input" class="pmc-input" placeholder="输入模型 ID" style="display:none;">
          </div>
        </div>

        <div class="pmc-audio-section">
          <div class="pmc-panel-title">
            <iconify-icon icon="carbon:volume-up" width="18"></iconify-icon>
            合成配置（Text-to-Speech）
          </div>
          <div class="pmc-form-group">
            <label class="pmc-label">Provider</label>
            <select id="pmc-tts-provider" class="pmc-select"></select>
          </div>
          <div class="pmc-form-group">
            <label class="pmc-label">API Key</label>
            <input id="pmc-tts-api-key" class="pmc-input" type="password" placeholder="输入合成 API Key">
          </div>
          <div class="pmc-form-group">
            <label class="pmc-label">Model</label>
            <select id="pmc-tts-model-select" class="pmc-select"></select>
          </div>
          <div class="pmc-form-group">
            <label class="pmc-label">Voice</label>
            <input id="pmc-tts-voice" class="pmc-input" placeholder="例如: alloy / aria / 自定义 voice">
          </div>
        </div>

        <div class="pmc-audio-actions">
          <button id="pmc-audio-save" class="pmc-btn-save">
            <iconify-icon icon="carbon:save" width="16"></iconify-icon>
            保存音频配置
          </button>
        </div>
      </div>
    `;

    const sttProviderEl = panel.querySelector('#pmc-stt-provider');
    const sttApiKeyEl = panel.querySelector('#pmc-stt-api-key');
    const sttModelSelectEl = panel.querySelector('#pmc-stt-model-select');
    const sttModelInputEl = panel.querySelector('#pmc-stt-model-input');

    const ttsProviderEl = panel.querySelector('#pmc-tts-provider');
    const ttsApiKeyEl = panel.querySelector('#pmc-tts-api-key');
    const ttsModelSelectEl = panel.querySelector('#pmc-tts-model-select');
    const ttsVoiceEl = panel.querySelector('#pmc-tts-voice');

    const saveBtn = panel.querySelector('#pmc-audio-save');

    sttProviderEl.innerHTML = TRANSCRIPTION_PROVIDERS.map((p) => `<option value="${safe(p.id)}">${safe(p.name)}</option>`).join('');
    ttsProviderEl.innerHTML = SYNTHESIS_PROVIDERS.map((p) => `<option value="${safe(p.id)}">${safe(p.name)}</option>`).join('');

    const applySttModels = () => {
      const providerId = sttProviderEl.value;
      const provider = TRANSCRIPTION_PROVIDERS.find((p) => p.id === providerId) || TRANSCRIPTION_PROVIDERS[0];
      const models = Array.isArray(provider?.models) ? provider.models : [];

      if (models.length) {
        sttModelSelectEl.style.display = '';
        sttModelInputEl.style.display = 'none';
        sttModelSelectEl.innerHTML = models.map((m) => `<option value="${safe(m)}">${safe(m)}</option>`).join('');
        sttModelSelectEl.value = cfg.transcription.model && models.includes(cfg.transcription.model) ? cfg.transcription.model : models[0];
      } else {
        sttModelSelectEl.style.display = 'none';
        sttModelInputEl.style.display = '';
        sttModelInputEl.value = cfg.transcription.model || '';
      }
    };

    const applyTtsModels = () => {
      const providerId = ttsProviderEl.value;
      const provider = SYNTHESIS_PROVIDERS.find((p) => p.id === providerId) || SYNTHESIS_PROVIDERS[0];
      const models = Array.isArray(provider?.models) ? provider.models : [];
      ttsModelSelectEl.innerHTML = models.map((m) => `<option value="${safe(m)}">${safe(m)}</option>`).join('');
      ttsModelSelectEl.value = cfg.synthesis.model && models.includes(cfg.synthesis.model) ? cfg.synthesis.model : (models[0] || '');
    };

    sttProviderEl.value = TRANSCRIPTION_PROVIDERS.some((p) => p.id === cfg.transcription.provider) ? cfg.transcription.provider : TRANSCRIPTION_PROVIDERS[0].id;
    ttsProviderEl.value = SYNTHESIS_PROVIDERS.some((p) => p.id === cfg.synthesis.provider) ? cfg.synthesis.provider : SYNTHESIS_PROVIDERS[0].id;

    sttApiKeyEl.value = cfg.transcription.apiKey || '';
    ttsApiKeyEl.value = cfg.synthesis.apiKey || '';
    ttsVoiceEl.value = cfg.synthesis.voice || '';

    applySttModels();
    applyTtsModels();

    sttProviderEl.addEventListener('change', () => {
      cfg.transcription.provider = sttProviderEl.value;
      applySttModels();
    });

    ttsProviderEl.addEventListener('change', () => {
      cfg.synthesis.provider = ttsProviderEl.value;
      applyTtsModels();
    });

    saveBtn.addEventListener('click', () => {
      const sttProvider = sttProviderEl.value;
      const ttsProvider = ttsProviderEl.value;

      const sttModel = sttModelSelectEl.style.display === 'none'
        ? String(sttModelInputEl.value || '').trim()
        : String(sttModelSelectEl.value || '').trim();

      const out = {
        transcription: {
          provider: sttProvider,
          apiKey: String(sttApiKeyEl.value || '').trim(),
          model: sttModel
        },
        synthesis: {
          provider: ttsProvider,
          apiKey: String(ttsApiKeyEl.value || '').trim(),
          model: String(ttsModelSelectEl.value || '').trim(),
          voice: String(ttsVoiceEl.value || '').trim()
        }
      };

      saveConfig('audio', out);
      showSaveSuccess('音频模型配置已保存');
    });
  }

  function safe(str) {
    return (str || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] || c));
  }

  function getModelIdElements(type) {
    const idMap = { lang: 'lang', img: 'img', vision: 'vision' };
    const t = idMap[type] || 'lang';
    return {
      search: document.getElementById(`ppt-model-${t}-id-search`),
      dropdown: document.getElementById(`ppt-model-${t}-dropdown`),
      refresh: document.getElementById(`ppt-model-${t}-refresh-models`)
    };
  }

  function shouldUseManualModelId(type, providerKey) {
    return (MANUAL_MODEL_ID_PROVIDERS[type] || []).includes(providerKey);
  }

  function setModelIdField(type, providerKey, value) {
    const { search, refresh } = getModelIdElements(type);
    const manual = shouldUseManualModelId(type, providerKey);

    if (refresh) refresh.style.display = manual ? 'none' : '';

    if (search) {
      search.value = value || '';
      if (manual && providerKey === 'volcano') {
        search.placeholder = '请输入火山模型 ID，例如 doubao-1-5-pro-32k-250115';
      } else {
        search.placeholder = '输入或探测模型 ID...';
      }
    }
  }

  function getModelIdValue(type, providerKey) {
    const { search } = getModelIdElements(type);
    return search ? search.value.trim() : '';
  }
  
  function showModelDropdown(type, ids, filter = '') {
    const { dropdown, search } = getModelIdElements(type);
    if (!dropdown) return;
    
    // 如果传入了 ids，更新缓存
    if (ids && ids.length > 0) {
        modelIdCache[type] = ids;
    }
    
    const cachedIds = modelIdCache[type] || [];
    const filterLower = filter.toLowerCase().trim();
    
    // 过滤匹配
    const filtered = filterLower 
        ? cachedIds.filter(id => id.toLowerCase().includes(filterLower))
        : cachedIds;
    
    dropdown.innerHTML = '';
    
    if (cachedIds.length === 0) {
        dropdown.innerHTML = '<div class="pmc-dropdown-empty">点击“探测”按钮获取模型列表</div>';
    } else if (filtered.length === 0) {
        dropdown.innerHTML = '<div class="pmc-dropdown-empty">无匹配结果</div>';
    } else {
        filtered.forEach(id => {
            const item = document.createElement('div');
            item.className = 'pmc-dropdown-item';
            // 高亮匹配部分
            if (filterLower) {
                const idx = id.toLowerCase().indexOf(filterLower);
                if (idx >= 0) {
                    item.innerHTML = id.substring(0, idx) + 
                        '<strong style="color:var(--pmc-primary)">' + id.substring(idx, idx + filterLower.length) + '</strong>' +
                        id.substring(idx + filterLower.length);
                } else {
                    item.textContent = id;
                }
            } else {
                item.textContent = id;
            }
            item.onclick = () => selectModelId(type, id);
            dropdown.appendChild(item);
        });
    }

    // 动态计算位置，使用 fixed 定位避免被裁剪
    if (search) {
        const rect = search.getBoundingClientRect();
        dropdown.style.position = 'fixed';
        dropdown.style.top = (rect.bottom + 6) + 'px';
        dropdown.style.left = rect.left + 'px';
        dropdown.style.width = rect.width + 'px';
        dropdown.style.right = 'auto';
    }

    // Show
    dropdown.classList.add('active');

    // Click outside to close
    const closeHandler = (e) => {
        if (!dropdown.contains(e.target) && e.target !== search) {
            hideModelDropdown(type);
            document.removeEventListener('click', closeHandler);
        }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
  }
  
  function filterModelDropdown(type) {
    const { search } = getModelIdElements(type);
    const filter = search ? search.value : '';
    if (modelIdCache[type].length > 0) {
        showModelDropdown(type, null, filter);
    }
  }

  function hideModelDropdown(type) {
    const { dropdown } = getModelIdElements(type);
    if (dropdown) dropdown.classList.remove('active');
  }

  function selectModelId(type, id) {
      const { search } = getModelIdElements(type);
      if (search) search.value = id;
      hideModelDropdown(type);
  }

  function getDefaultModelId(providerKey) {
    const map = {
      deepseek: 'deepseek-chat',
      gemini: 'gemini-2.0-flash',
      'gemini-pro': 'gemini-2.0-flash',
      mistral: 'mistral-large-latest',
      tongyi: 'qwen-turbo-latest',
      volcano: 'doubao-1-5-pro-32k-250115',
      'gemini-image': 'gemini-2.5-flash-image',
      image: 'gpt-image-1',
      'openai-image': 'gpt-image-1',
      openai: 'gpt-image-1',
      'sora-image': 'gpt-image-1',
      'jimeng-image': 'gpt-image-1'
    };
    return map[providerKey] || '';
  }

  function populateModal() {
    const langSelect = document.getElementById('ppt-model-lang-select');
    const imgSelect = document.getElementById('ppt-model-img-select');
    const visionSelect = document.getElementById('ppt-model-vision-select');
    const langHint = document.getElementById('ppt-model-lang-hint');
    const imgHint = document.getElementById('ppt-model-img-hint');
    const visionHint = document.getElementById('ppt-model-vision-hint');
    if (!langSelect || !imgSelect) return;

    const langSources = gatherLanguageSources();
    const imgSources = gatherImageSources();
    const visionSources = gatherVisionSources();

    langSelect.innerHTML = langSources.length ? langSources.map(m => `<option value="${safe(m.key)}">${safe(m.name || m.key)}</option>`).join('') : `<option value="">未找到文字模型源</option>`;
    imgSelect.innerHTML = imgSources.length ? imgSources.map(m => `<option value="${safe(m.key)}">${safe(m.name || m.key)}</option>`).join('') : `<option value="">未找到配图模型源</option>`;
    if (visionSelect) {
      visionSelect.innerHTML = visionSources.length ? visionSources.map(m => `<option value="${safe(m.key)}">${safe(m.name || m.key)}</option>`).join('') : `<option value="">未找到视觉模型源</option>`;
    }

    const savedLang = loadConfig('lang');
    const savedImg = loadConfig('img');
    const savedVision = loadConfig('vision');
    if (savedLang && savedLang.modelKey && langSources.some(s => s.key === savedLang.modelKey)) {
      langSelect.value = savedLang.modelKey;
    }
    if (savedImg && savedImg.modelKey && imgSources.some(s => s.key === savedImg.modelKey)) {
      imgSelect.value = savedImg.modelKey;
    }
    if (visionSelect && savedVision && savedVision.modelKey && visionSources.some(s => s.key === savedVision.modelKey)) {
      visionSelect.value = savedVision.modelKey;
    }

    populateModelIds('lang', langSelect.value, savedLang?.modelId);
    populateModelIds('img', imgSelect.value, savedImg?.modelId);
    if (visionSelect) {
      populateModelIds('vision', visionSelect.value, savedVision?.modelId);
    }

    // Key 状态提示
    const checker = (key) => {
      try {
        if (global.modelManager && typeof global.modelManager.checkModelHasValidKey === 'function') {
          return global.modelManager.checkModelHasValidKey(key);
        }
      } catch (_) {}
      return true;
    };
    if (langHint) {
      const ok = langSelect.value ? checker(langSelect.value) : false;
      const icon = ok ? 'carbon:checkmark-filled' : 'carbon:warning-filled';
      const text = ok ? 'Key 可用' : 'Key 未配置/不可用';
      const color = ok ? '#10b981' : '#f97316';
      
      langHint.innerHTML = `<iconify-icon icon="${icon}" style="color:${color}"></iconify-icon> <span style="color:${color}">${text}</span>`;
      langHint.style.background = ok ? '#ecfdf5' : '#fff7ed';
    }
    if (imgHint) {
      const ok = imgSelect.value ? checker(imgSelect.value) : false;
      const icon = ok ? 'carbon:checkmark-filled' : 'carbon:warning-filled';
      const text = ok ? 'Key 可用' : 'Key 未配置/不可用';
      const color = ok ? '#10b981' : '#f97316';
      
      imgHint.innerHTML = `<iconify-icon icon="${icon}" style="color:${color}"></iconify-icon> <span style="color:${color}">${text}</span>`;
      imgHint.style.background = ok ? '#ecfdf5' : '#fff7ed';
    }
    if (visionHint && visionSelect) {
      const ok = visionSelect.value ? checker(visionSelect.value) : false;
      const icon = ok ? 'carbon:checkmark-filled' : 'carbon:warning-filled';
      const text = ok ? 'Key 可用' : 'Key 未配置/不可用';
      const color = ok ? '#10b981' : '#f97316';
      
      visionHint.innerHTML = `<iconify-icon icon="${icon}" style="color:${color}"></iconify-icon> <span style="color:${color}">${text}</span>`;
      visionHint.style.background = ok ? '#ecfdf5' : '#fff7ed';
    }

    // Load Advanced Settings
    loadImageSettings();
  }

  /**
   * 刷新指定类型的源站列表，保持当前选择
   */
  function refreshSourceList(type) {
    const selectId = type === 'lang' ? 'ppt-model-lang-select' 
                   : type === 'img' ? 'ppt-model-img-select' 
                   : 'ppt-model-vision-select';
    const select = document.getElementById(selectId);
    if (!select) return;
    
    // 记住当前选择
    const currentValue = select.value;
    
    // 获取新的源站列表
    const sources = type === 'lang' ? gatherLanguageSources() 
                  : type === 'img' ? gatherImageSources() 
                  : gatherVisionSources();
    
    // 重新填充
    select.innerHTML = sources.length 
      ? sources.map(m => `<option value="${safe(m.key)}">${safe(m.name || m.key)}</option>`).join('') 
      : `<option value="">未找到模型源</option>`;
    
    // 恢复选择（如果还存在）
    if (currentValue && sources.some(s => s.key === currentValue)) {
      select.value = currentValue;
    }
    
    console.log(`[PPT Model Config] 刷新 ${type} 源站列表，共 ${sources.length} 个`);
  }

  function openModal() {
    renderModal();

    // 每次打开都刷新表格/音频配置（避免源站列表/配置变更后不更新）
    initModelTableView({ forceRender: true });

    // 保持图片处理设置可用
    loadImageSettings();
    updateStatsDisplay();
    const modal = document.getElementById('ppt-model-config-modal');
    if (modal) modal.style.display = 'flex';

    // 预加载：并发拉取所有源站模型列表（会话缓存）
    preloadAllSourcesModels();
  }

  function closeModal() {
    const modal = document.getElementById('ppt-model-config-modal');
    if (modal) modal.style.display = 'none';
  }
  
  function showSaveSuccess(msg) {
    // 创建提示元素
    let toast = document.getElementById('pmc-save-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'pmc-save-toast';
      toast.style.cssText = `
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        background: #10b981;
        color: white;
        padding: 12px 24px;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 500;
        box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
        z-index: 99999;
        display: flex;
        align-items: center;
        gap: 8px;
        transition: opacity 0.3s, transform 0.3s;
      `;
      document.body.appendChild(toast);
    }
    
    toast.innerHTML = `<iconify-icon icon="carbon:checkmark-filled" width="18"></iconify-icon> ${msg}`;
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
    
    // 2秒后淡出
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50%) translateY(10px)';
    }, 2000);
  }

  function bindModalEvents() {
    document.addEventListener('click', (e) => {
      // 使用 closest 确保点击按钮内的图标也能触发
      if (e.target.closest('#ppt-model-config-close')) closeModal();
      if (e.target && e.target.id === 'ppt-model-config-overlay') closeModal();
      if (e.target.closest('#ppt-model-lang-save')) {
        const sel = document.getElementById('ppt-model-lang-select');
        const modelKey = sel ? sel.value : '';
        if (modelKey) {
          saveConfig('lang', { modelKey, modelId: getModelIdValue('lang', modelKey) });
          showSaveSuccess('文字模型配置已保存');
        } else {
          alert('请选择文字模型');
        }
      }
      if (e.target.closest('#ppt-model-img-save')) {
        const sel = document.getElementById('ppt-model-img-select');
        const modelKey = sel ? sel.value : '';
        if (modelKey) {
          saveConfig('img', { modelKey, modelId: getModelIdValue('img', modelKey) });
          showSaveSuccess('配图模型配置已保存');
        } else {
          alert('请选择配图模型');
        }
      }
      if (e.target.closest('#ppt-model-vision-save')) {
        const sel = document.getElementById('ppt-model-vision-select');
        const modelKey = sel ? sel.value : '';
        if (modelKey) {
          saveConfig('vision', { modelKey, modelId: getModelIdValue('vision', modelKey) });
          showSaveSuccess('视觉模型配置已保存');
        } else {
          alert('请选择视觉模型');
        }
      }
      if (e.target && e.target.id === 'ppt-model-lang-refresh') {
          refreshSourceList('lang');
      }
      if (e.target && e.target.id === 'ppt-model-img-refresh') {
        refreshSourceList('img');
      }
      if (e.target && e.target.id === 'ppt-model-vision-refresh') {
        refreshSourceList('vision');
      }
      if (e.target && e.target.id === 'ppt-model-lang-refresh-models') {
        const sel = document.getElementById('ppt-model-lang-select');
        fetchAndPopulateModelIds('lang', sel ? sel.value : '');
      }
      if (e.target && e.target.id === 'ppt-model-img-refresh-models') {
        const sel = document.getElementById('ppt-model-img-select');
        fetchAndPopulateModelIds('img', sel ? sel.value : '');
      }
      if (e.target && e.target.id === 'ppt-model-vision-refresh-models') {
        const sel = document.getElementById('ppt-model-vision-select');
        fetchAndPopulateModelIds('vision', sel ? sel.value : '');
      }
    });

    document.addEventListener('change', (e) => {
      if (e.target && e.target.id === 'ppt-model-lang-select') {
        populateModelIds('lang', e.target.value);
      }
      if (e.target && e.target.id === 'ppt-model-img-select') {
        populateModelIds('img', e.target.value);
      }
      if (e.target && e.target.id === 'ppt-model-vision-select') {
        populateModelIds('vision', e.target.value);
      }
    });

    // 模型 ID 输入框的实时搜索
    document.addEventListener('input', (e) => {
      if (e.target && e.target.id === 'ppt-model-lang-id-search') {
        filterModelDropdown('lang');
      }
      if (e.target && e.target.id === 'ppt-model-img-id-search') {
        filterModelDropdown('img');
      }
      if (e.target && e.target.id === 'ppt-model-vision-id-search') {
        filterModelDropdown('vision');
      }
    });

    // 聚焦时显示下拉
    document.addEventListener('focus', (e) => {
      if (e.target && e.target.id === 'ppt-model-lang-id-search' && modelIdCache.lang.length > 0) {
        filterModelDropdown('lang');
      }
      if (e.target && e.target.id === 'ppt-model-img-id-search' && modelIdCache.img.length > 0) {
        filterModelDropdown('img');
      }
      if (e.target && e.target.id === 'ppt-model-vision-id-search' && modelIdCache.vision.length > 0) {
        filterModelDropdown('vision');
      }
    }, true);
  }

  function getStyles() {
    return `
      /* Tabs */
      .pmc-tabs-nav {
        display: flex; gap: 8px;
        padding: 12px 16px;
        background: #fff;
        border-bottom: 1px solid var(--pmc-border);
      }
      .pmc-tab-btn {
        display: inline-flex; align-items: center; gap: 8px;
        padding: 10px 12px;
        border: 1px solid var(--pmc-border);
        background: #fff;
        border-radius: 10px;
        color: #334155;
        font-size: 13px;
        cursor: pointer;
        transition: all 0.15s;
      }
      .pmc-tab-btn:hover { border-color: #cbd5e1; background: #f8fafc; }
      .pmc-tab-btn.active {
        border-color: rgba(99, 102, 241, 0.5);
        background: rgba(99, 102, 241, 0.08);
        color: #312e81;
      }
      .pmc-tab-btn iconify-icon { pointer-events: none; }

      .pmc-tabs-content {
        padding: 16px;
      }
      .pmc-tab-panel { display: none; }
      .pmc-tab-panel.active { display: block; }

      /* Tab Layout Helpers */
      .pmc-tab-layout {
        display: grid;
        grid-template-columns: 360px 1fr;
        gap: 16px;
        align-items: start;
      }
      .pmc-tab-layout.pmc-tab-layout-60-40 {
        grid-template-columns: 3fr 2fr;
      }
      .pmc-tab-left, .pmc-tab-right {
        background: #fff;
        border: 1px solid var(--pmc-border);
        border-radius: 12px;
        padding: 16px;
        min-height: 400px;
        max-height: 65vh;
        overflow-y: auto;
      }
      .pmc-panel-title {
        display: flex; align-items: center; gap: 8px;
        font-size: 14px; font-weight: 700; color: var(--pmc-text-main);
        margin-bottom: 12px;
      }
      .pmc-panel-subtitle {
        margin-left: auto;
        font-size: 12px;
        font-weight: 500;
        color: #94a3b8;
      }
      .pmc-subheading {
        font-size: 12px;
        font-weight: 700;
        color: #334155;
        margin: 2px 0 10px 0;
      }
      .pmc-helper-text {
        font-size: 12px;
        color: var(--pmc-text-sub);
        margin-top: 12px;
        line-height: 1.5;
      }
      .pmc-empty {
        padding: 12px;
        font-size: 12px;
        color: #94a3b8;
        text-align: center;
        background: #f8fafc;
        border: 1px dashed #e2e8f0;
        border-radius: 10px;
      }

      .pmc-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-height: 52vh;
        overflow: auto;
        padding-right: 4px;
      }
      .pmc-list-compact { max-height: 42vh; }

      /* Tab1: Source accordion + model list */
      .pmc-accordion {
        display: flex;
        flex-direction: column;
        gap: 12px;
        overflow: visible;
        padding-right: 4px;
      }
      .pmc-acc-item {
        border: 1px solid var(--pmc-border);
        border-radius: 12px;
        background: #fff;
        overflow: visible;
        min-height: 48px;
      }
      .pmc-acc-header {
        width: 100%;
        border: none;
        background: #fff;
        padding: 14px 16px;
        display: flex;
        align-items: center;
        gap: 12px;
        cursor: pointer;
        text-align: left;
        transition: all 0.15s;
        min-height: 48px;
      }
      .pmc-acc-header:hover { background: #f8fafc; }
      .pmc-acc-chevron { color: #94a3b8; transition: transform 0.15s; }
      .pmc-acc-chevron.open { transform: rotate(90deg); }
      .pmc-acc-title { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
      .pmc-acc-title-main { font-size: 14px; font-weight: 600; color: #0f172a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .pmc-acc-title-sub { font-size: 12px; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .pmc-acc-meta { margin-left: auto; display: flex; align-items: center; gap: 8px; }
      .pmc-badge {
        font-size: 11px;
        font-weight: 700;
        color: #334155;
        background: #f1f5f9;
        border: 1px solid #e2e8f0;
        border-radius: 999px;
        padding: 2px 8px;
        line-height: 16px;
      }
      .pmc-badge-muted { color: #94a3b8; background: #f8fafc; }
      .pmc-badge-primary { color: #312e81; background: rgba(99, 102, 241, 0.12); border-color: rgba(99, 102, 241, 0.35); }
      .pmc-acc-body {
        border-top: 1px solid var(--pmc-border);
        background: #fafbfc;
        padding: 14px 16px 16px;
      }
      .pmc-loading {
        font-size: 12px;
        color: #64748b;
        padding: 8px 10px;
        border: 1px dashed #e2e8f0;
        border-radius: 10px;
        background: #fff;
      }
      .pmc-model-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        overflow: visible;
        padding-right: 4px;
      }
      .pmc-model-item {
        width: 100%;
        border: 1px solid var(--pmc-border);
        background: #fff;
        border-radius: 10px;
        padding: 12px 14px;
        cursor: pointer;
        text-align: left;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
        transition: all 0.15s;
      }
      .pmc-model-item:hover { background: #f8fafc; border-color: #cbd5e1; }
      .pmc-model-item.active { border-color: rgba(99, 102, 241, 0.55); background: rgba(99, 102, 241, 0.06); }
      .pmc-model-item-main { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
      .pmc-model-item-title { font-size: 14px; font-weight: 600; color: #0f172a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .pmc-model-item-sub { font-size: 12px; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .pmc-model-tags { display: flex; align-items: center; gap: 6px; flex-shrink: 0; color: #94a3b8; }
      .pmc-model-tags iconify-icon { opacity: 0.22; }
      .pmc-model-tags iconify-icon.on { opacity: 1; color: var(--pmc-primary); }

      /* Tab1: Tag icons (right panel) */
      .pmc-tags-icons {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
      }
      .pmc-tag-icon-btn {
        border: 1px solid var(--pmc-border);
        background: #fff;
        border-radius: 14px;
        padding: 14px 10px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        color: #94a3b8;
        transition: all 0.15s;
      }
      .pmc-tag-icon-btn:hover { background: #f8fafc; border-color: #cbd5e1; color: #334155; }
      .pmc-tag-icon-btn.selected {
        color: var(--pmc-primary);
        border-color: rgba(99, 102, 241, 0.55);
        background: rgba(99, 102, 241, 0.10);
        box-shadow: inset 0 0 0 1px rgba(99, 102, 241, 0.15);
      }
      .pmc-tag-icon-btn:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }

      .pmc-list-item {
        width: 100%;
        border: 1px solid var(--pmc-border);
        background: #fff;
        border-radius: 10px;
        padding: 10px 10px;
        cursor: pointer;
        text-align: left;
        display: flex;
        justify-content: space-between;
        gap: 10px;
        transition: all 0.15s;
      }
      .pmc-list-item:hover { background: #f8fafc; border-color: #cbd5e1; }
      .pmc-list-item.active { border-color: rgba(99, 102, 241, 0.55); background: rgba(99, 102, 241, 0.06); }
      .pmc-list-item-main { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
      .pmc-list-item-title { font-size: 13px; font-weight: 700; color: #0f172a; display:flex; align-items:center; gap:8px; }
      .pmc-list-item-sub { font-size: 11px; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .pmc-list-item-meta { font-size: 11px; color: #64748b; flex: 0 0 auto; align-self: center; }

      .pmc-two-col {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
      }

      .pmc-list-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        border: 1px solid var(--pmc-border);
        border-radius: 10px;
        padding: 10px;
        background: #fff;
      }
      .pmc-list-row-main { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
      .pmc-list-row-title { font-size: 12px; font-weight: 700; color: #0f172a; }
      .pmc-list-row-sub { font-size: 11px; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

      .pmc-btn-mini {
        border: 1px solid var(--pmc-border);
        background: #fff;
        border-radius: 8px;
        font-size: 12px;
        padding: 6px 10px;
        cursor: pointer;
        display: inline-flex; align-items: center; gap: 6px;
        color: #334155;
        transition: all 0.15s;
        flex: 0 0 auto;
      }
      .pmc-btn-mini:hover { border-color: rgba(99, 102, 241, 0.55); color: #312e81; background: rgba(99, 102, 241, 0.06); }
      .pmc-btn-mini:disabled { cursor: not-allowed; opacity: 0.55; }
      .pmc-btn-mini iconify-icon { pointer-events: none; }

      .pmc-tags-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }

      /* Required: tag chips */
      .pmc-tag-chip {
        display: inline-flex; align-items: center; gap: 8px;
        padding: 8px 10px;
        border: 1px solid var(--pmc-border);
        border-radius: 999px;
        background: #fff;
        color: #334155;
        cursor: pointer;
        user-select: none;
        transition: all 0.15s;
      }
      .pmc-tag-chip input { display: none; }
      .pmc-tag-chip.selected {
        border-color: rgba(99, 102, 241, 0.55);
        background: rgba(99, 102, 241, 0.08);
        color: #312e81;
      }

      /* Required: drag items */
      .pmc-dnd-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
        min-height: 180px;
        padding: 10px;
        border: 1px dashed #e2e8f0;
        border-radius: 12px;
        background: #f8fafc;
      }
      .pmc-drag-item {
        border: 1px solid var(--pmc-border);
        background: #fff;
        border-radius: 12px;
        padding: 10px 10px;
        cursor: grab;
        display: grid;
        grid-template-columns: 1fr auto;
        grid-template-rows: auto auto;
        gap: 4px 10px;
        align-items: center;
      }
      .pmc-drag-item:active { cursor: grabbing; }
      .pmc-drag-item.dragging { opacity: 0.6; }
      .pmc-drag-item.drag-above { border-top: 2px solid var(--pmc-primary); }
      .pmc-drag-item.drag-below { border-bottom: 2px solid var(--pmc-primary); }
      .drag-above { border-top: 2px solid var(--pmc-primary) !important; }
      .drag-below { border-bottom: 2px solid var(--pmc-primary) !important; }
      .pmc-drag-item-title { font-size: 12px; font-weight: 700; color: #0f172a; grid-column: 1 / 2; }
      .pmc-drag-item-sub { font-size: 11px; color: #94a3b8; grid-column: 1 / 2; }
      .pmc-drag-item-remove {
        grid-column: 2 / 3;
        grid-row: 1 / 3;
        border: 1px solid var(--pmc-border);
        background: #fff;
        width: 36px; height: 36px;
        border-radius: 10px;
        cursor: pointer;
        color: #ef4444;
        display: flex; align-items: center; justify-content: center;
        transition: all 0.15s;
      }
      .pmc-drag-item-remove:hover { background: #fef2f2; border-color: #fecaca; }
      .pmc-drag-item-remove iconify-icon { pointer-events: none; }

      /* Audio */
      .pmc-audio-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
        align-items: start;
      }
      .pmc-audio-section {
        background: #fff;
        border: 1px solid var(--pmc-border);
        border-radius: 12px;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .pmc-audio-actions {
        grid-column: 1 / -1;
      }

      @media (max-width: 1024px) {
        .pmc-tab-layout { grid-template-columns: 1fr; }
        .pmc-two-col { grid-template-columns: 1fr; }
        .pmc-audio-grid { grid-template-columns: 1fr; }
        .pmc-list { max-height: 40vh; }
        .pmc-accordion { max-height: 40vh; }
      }
    `;
  }

  // 样式注入
  function injectStyles() {
    let style = document.getElementById('ppt-model-config-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'ppt-model-config-style';
      document.head.appendChild(style);
    }
    style.textContent = `
      :root {
        --pmc-primary: #6366f1;
        --pmc-primary-hover: #4f46e5;
        --pmc-bg: #f8fafc;
        --pmc-text-main: #0f172a;
        --pmc-text-sub: #64748b;
        --pmc-border: #e2e8f0;
        --pmc-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
        --pmc-radius: 12px;
      }

      .pmc-modal-overlay {
        position: fixed; inset: 0; z-index: 70;
        display: none; align-items: center; justify-content: center;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      .pmc-overlay-bg {
        position: absolute; inset: 0;
        background: rgba(15, 23, 42, 0.5);
        backdrop-filter: blur(4px);
      }

      .pmc-modal-container {
        position: relative; z-index: 1;
        width: 95vw; max-width: 1200px; height: auto; max-height: 90vh;
        background: #fff;
        border-radius: var(--pmc-radius);
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
        display: flex; flex-direction: column;
        overflow: hidden;
        border: 1px solid rgba(255,255,255,0.1);
      }

      /* Header */
      .pmc-header {
        padding: 20px 24px;
        background: #fff;
        border-bottom: 1px solid var(--pmc-border);
        display: flex; justify-content: space-between; align-items: flex-start;
      }

      .pmc-header-left {
        display: flex; align-items: center; gap: 16px;
      }

      .pmc-header-icon {
        width: 48px; height: 48px;
        border-radius: 12px;
        background: linear-gradient(135deg, #e0e7ff 0%, #eef2ff 100%);
        color: var(--pmc-primary);
        display: flex; align-items: center; justify-content: center;
        box-shadow: inset 0 0 0 1px rgba(99, 102, 241, 0.1);
      }

      .pmc-title {
        font-size: 18px; font-weight: 700; color: var(--pmc-text-main);
        line-height: 1.2; margin-bottom: 4px;
      }

      .pmc-subtitle {
        font-size: 13px; color: var(--pmc-text-sub);
      }

      .pmc-close-btn {
        width: 32px; height: 32px;
        border-radius: 8px; border: none; background: transparent;
        color: #94a3b8; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        transition: all 0.2s;
      }
      .pmc-close-btn:hover { background: #f1f5f9; color: #ef4444; }

      /* Body */
      .pmc-scroll-content {
        flex: 1; overflow-y: auto; overflow-x: hidden;
        background: #f8fafc;
        display: flex; flex-direction: column;
        min-height: 0; /* 确保 flex 子元素可以收缩并触发滚动 */
      }

      .pmc-body {
        display: flex; flex-direction: column;
        flex-shrink: 0;
        background: #f8fafc;
        overflow: visible; /* 确保下拉菜单不被裁剪 */
      }

      .pmc-col {
        padding: 24px;
        border-right: 1px solid var(--pmc-border);
        background: #fff;
        display: flex; flex-direction: column; gap: 20px;
        overflow: visible; /* 确保下拉菜单不被裁剪 */
      }
      .pmc-col:last-child { border-right: none; }
      .pmc-col:nth-child(even) { background: #fafbfc; }

      .pmc-section-header {
        display: flex; align-items: center; gap: 10px;
      }

      .pmc-section-icon {
        width: 36px; height: 36px;
        border-radius: 10px;
        background: #f1f5f9;
        display: flex; align-items: center; justify-content: center;
      }
      .text-indigo { color: #6366f1; background: #e0e7ff; }
      .text-purple { color: #a855f7; background: #f3e8ff; }
      .text-cyan { color: #06b6d4; background: #cffafe; }

      .pmc-section-title {
        font-size: 16px; font-weight: 600; color: var(--pmc-text-main);
      }

      .pmc-section-desc {
        font-size: 12px; color: var(--pmc-text-sub); line-height: 1.5;
        margin: -8px 0 0 0; min-height: 36px;
      }

      /* Forms */
      .pmc-form-group {
        display: flex; flex-direction: column; gap: 8px;
      }

      .pmc-label {
        font-size: 13px; font-weight: 500; color: #475569;
        display: flex; justify-content: space-between;
      }
      .pmc-label-sub { color: #94a3b8; font-weight: 400; font-size: 12px; }

      .pmc-input-row {
        display: flex; gap: 8px;
      }

      .pmc-select, .pmc-input {
        flex: 1;
        padding: 10px 12px;
        border: 1px solid var(--pmc-border);
        border-radius: 8px;
        font-size: 14px; color: #1e293b;
        outline: none; background: #fff;
        transition: all 0.2s;
        min-width: 0; /* flex fix */
        width: 100%;
      }
      .pmc-select:focus, .pmc-input:focus {
        border-color: var(--pmc-primary);
        box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
      }
      .pmc-select:disabled, .pmc-input:disabled {
        background: #f1f5f9; color: #94a3b8;
      }

      .pmc-btn-icon {
        width: 42px; padding: 0;
        border: 1px solid var(--pmc-border);
        background: #fff;
        border-radius: 8px;
        color: #64748b; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        transition: all 0.2s;
      }
      .pmc-btn-icon:hover {
        border-color: var(--pmc-primary); color: var(--pmc-primary); background: #f8fafc;
      }

      /* Status & Actions */
      .pmc-status-bar {
        min-height: 24px; display: flex; align-items: center;
      }
      .pmc-model-hint {
        display: flex; align-items: center; gap: 6px;
        font-size: 12px; color: #64748b;
        background: #f1f5f9; padding: 4px 8px; border-radius: 6px;
      }

      .pmc-btn-save {
        margin-top: auto;
        width: 100%; padding: 12px;
        background: var(--pmc-text-main);
        color: #fff;
        border: none; border-radius: 10px;
        font-size: 14px; font-weight: 600;
        cursor: pointer;
        display: flex; align-items: center; justify-content: center; gap: 8px;
        transition: all 0.2s;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
      }
      .pmc-btn-save:hover {
        background: #1e293b; transform: translateY(-1px);
        box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
      }
      .pmc-btn-save:active { transform: translateY(0); }
      .pmc-btn-save iconify-icon, .pmc-btn-icon iconify-icon { pointer-events: none; }

      /* Footer */
      .pmc-footer {
        padding: 16px 24px;
        border-top: 1px solid var(--pmc-border);
        background: #fff;
        display: flex; justify-content: space-between; align-items: center;
      }

      .pmc-btn-secondary {
        background: #fff;
        border: 1px solid var(--pmc-border);
        color: #475569;
        padding: 8px 16px; border-radius: 8px;
        font-size: 13px; font-weight: 500;
        cursor: pointer;
        display: flex; align-items: center; gap: 8px;
        transition: all 0.2s;
      }
      .pmc-btn-secondary:hover {
        border-color: #cbd5e1; background: #f8fafc; color: #1e293b;
      }
      .pmc-btn-secondary iconify-icon { pointer-events: none; }

      .pmc-stats {
        font-size: 12px; color: #94a3b8; font-family: monospace;
      }

      /* Advanced Settings */
      .pmc-advanced-settings {
        border-top: 1px solid var(--pmc-border);
        background: #fafbfc;
        display: none; /* 默认隐藏 */
        animation: slideDown 0.3s ease;
      }
      @keyframes slideDown { from { opacity:0; transform:translateY(-10px); } to { opacity:1; transform:translateY(0); } }

      .pmc-advanced-header {
        padding: 12px 24px;
        font-size: 13px; font-weight: 600; color: #475569;
        background: #f1f5f9; border-bottom: 1px solid var(--pmc-border);
        display: flex; align-items: center; gap: 8px;
      }

      .pmc-advanced-body {
        padding: 24px;
        display: grid; grid-template-columns: 1fr 1fr; gap: 32px;
      }

      .pmc-radio-group { display: flex; flex-direction: column; gap: 10px; margin-top: 8px; }
      .pmc-radio-item { display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; color: #334155; }
      .pmc-radio-item input[type="radio"] { accent-color: var(--pmc-primary); }
      .pmc-hint-text { color: #94a3b8; font-size: 12px; }
      
      .pmc-status-text { 
        font-size: 12px; color: #64748b; margin-top: 12px; 
        padding: 8px 12px; background: #fff; border: 1px solid var(--pmc-border); border-radius: 6px;
      }

      .pmc-form-row { display: flex; gap: 20px; margin-top: 8px; }
      .pmc-range { width: 100%; height: 4px; background: #e2e8f0; border-radius: 2px; outline: none; -webkit-appearance: none; }
      .pmc-range::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; background: var(--pmc-primary); border-radius: 50%; cursor: pointer; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
      .pmc-value-badge { background: #e0e7ff; color: #4338ca; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-family: monospace; }

      /* Custom Dropdown */
      .pmc-dropdown-wrapper { position: relative; flex: 1; display: flex; }
      .pmc-dropdown-list {
        position: absolute; top: 100%; left: 0; right: 0;
        background: #fff; border: 1px solid var(--pmc-border);
        border-radius: 8px; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.15);
        max-height: 280px; overflow-y: auto; z-index: 9999;
        margin-top: 6px;
        display: none;
      }
      .pmc-dropdown-list.active { display: block; animation: fadeIn 0.15s ease; }
      .pmc-dropdown-item {
        padding: 10px 12px; font-size: 13px; color: #334155; cursor: pointer;
        border-bottom: 1px solid #f8fafc; transition: all 0.1s;
      }
      .pmc-dropdown-item:hover { background: #f1f5f9; color: var(--pmc-primary); padding-left: 16px; }
      .pmc-dropdown-item:last-child { border-bottom: none; }
      .pmc-dropdown-empty { padding: 12px; text-align: center; color: #94a3b8; font-size: 12px; }

      /* Responsive */
      @media (max-width: 1024px) {
        .pmc-modal-container { max-height: 90vh; }
        .pmc-advanced-body { grid-template-columns: 1fr; gap: 20px; }
      }

      ${getStyles()}
    `;
    document.head.appendChild(style);
  }

  function gatherLanguageSources() {
    // 排除通用"自定义翻译模型"，只展示具体源站/预设
    const baseModels = getSupportedModels().filter(m => m.group === 'translation' && m.key !== 'custom' && m.key !== 'deeplx');
    const models = [
      // Auto 选项：自动选择第一个可用模型
      { key: 'auto', name: '🔄 自动选择 (推荐)', description: '自动使用第一个可用的模型' }
    ];

    // 为预设模型标记 Key 状态
    baseModels.forEach(m => {
      const keys = typeof loadModelKeys === 'function' ? (loadModelKeys(m.key) || []) : [];
      const validKeys = keys.filter(k => k.status !== 'invalid' && k.value);
      models.push({
        key: m.key,
        name: (m.name || m.key) + (validKeys.length ? ` (${validKeys.length} Key)` : ' (无 Key)'),
        description: ''
      });
    });
    
    // 追加自定义源站点
    if (typeof loadAllCustomSourceSites === 'function') {
      try {
        const sites = loadAllCustomSourceSites() || {};
        console.log('[PPT Model Config] 自定义源站:', Object.keys(sites).length, '个');
        Object.keys(sites).forEach(id => {
          const site = sites[id];
          const keys = typeof loadModelKeys === 'function' ? (loadModelKeys(`custom_source_${id}`) || []) : [];
          const validKeys = keys.filter(k => k.status !== 'invalid' && k.value);
          models.push({
            key: `custom_source_${id}`,
            name: (site.displayName || site.name || `自定义源站`) + (validKeys.length ? ` (${validKeys.length} Key)` : ' (无 Key)'),
            description: site.apiBaseUrl || site.apiEndpoint || ''
          });
        });
      } catch (e) { console.error('[PPT] gatherLanguageSources error:', e); }
    }
    
    // 兜底
    if (models.length === 0) {
      return [
        { key: 'gemini', name: 'Google Gemini (无 Key)', description: '' },
        { key: 'deepseek', name: 'DeepSeek (无 Key)', description: '' }
      ];
    }
    return models;
  }

  function gatherImageSources() {
    const models = [
      { key: 'auto', name: '🔄 自动选择 (推荐)', description: '自动使用第一个可用的模型' }
    ];

    // 从 supportedModelsForKeyManager 获取 image 分组的模型
    const imageModels = getSupportedModels().filter(m => m.group === 'image');
    imageModels.forEach(m => {
      // 检查是否有 Key（有则标记）
      const keys = typeof loadModelKeys === 'function' ? (loadModelKeys(m.key) || []) : [];
      const validKeys = keys.filter(k => k.status !== 'invalid' && k.value);
      models.push({ 
        key: m.key, 
        name: m.name + (validKeys.length ? ` (${validKeys.length} Key)` : ' ⚠️'), 
        description: '' 
      });
    });
    
    // 追加自定义源站点
    if (typeof loadAllCustomSourceSites === 'function') {
      try {
        const sites = loadAllCustomSourceSites() || {};
        Object.keys(sites).forEach(id => {
          const siteKeys = typeof loadModelKeys === 'function' ? (loadModelKeys(`custom_source_${id}`) || []) : [];
          const validKeys = siteKeys.filter(k => k.status !== 'invalid' && k.value);
          models.push({
            key: `custom_source_${id}`,
            name: (sites[id].displayName || sites[id].name || `自定义源站`) + (validKeys.length ? ` (${validKeys.length} Key)` : ' (无 Key)'),
            description: sites[id].apiBaseUrl || ''
          });
        });
      } catch (_) {}
    }
    
    // 兜底
    if (models.length === 0) {
      return [
        { key: 'image', name: '通用生图 (无 Key)', description: '' },
        { key: 'gemini-image', name: 'Gemini 生图 (无 Key)', description: '' }
      ];
    }
    return models;
  }

  function gatherVisionSources() {
    // 和文字模型使用相同逻辑，从 supportedModelsForKeyManager 获取
    const baseModels = getSupportedModels().filter(m => m.group === 'translation' && m.key !== 'custom' && m.key !== 'deeplx');
    const models = [
      { key: 'auto', name: '🔄 自动选择 (推荐)', description: '自动使用第一个可用的模型' }
    ];

    // 为预设模型标记 Key 状态
    baseModels.forEach(m => {
      const keys = typeof loadModelKeys === 'function' ? (loadModelKeys(m.key) || []) : [];
      const validKeys = keys.filter(k => k.status !== 'invalid' && k.value);
      models.push({
        key: m.key,
        name: (m.name || m.key) + (validKeys.length ? ` (${validKeys.length} Key)` : ' (无 Key)'),
        description: ''
      });
    });
    
    // 追加自定义源站点
    if (typeof loadAllCustomSourceSites === 'function') {
      try {
        const sites = loadAllCustomSourceSites() || {};
        Object.keys(sites).forEach(id => {
          const site = sites[id];
          const keys = typeof loadModelKeys === 'function' ? (loadModelKeys(`custom_source_${id}`) || []) : [];
          const validKeys = keys.filter(k => k.status !== 'invalid' && k.value);
          models.push({
            key: `custom_source_${id}`,
            name: (site.displayName || site.name || `自定义源站`) + (validKeys.length ? ` (${validKeys.length} Key)` : ' (无 Key)'),
            description: site.apiBaseUrl || site.apiEndpoint || ''
          });
        });
      } catch (e) { console.error('[PPT] gatherVisionSources error:', e); }
    }
    
    // 兜底
    if (models.length === 0) {
      return [
        { key: 'gemini', name: 'Google Gemini (无 Key)', description: '' },
        { key: 'tongyi', name: '通义千问 (无 Key)', description: '' }
      ];
    }
    
    return models;
  }

  async function populateModelIds(type, modelKey, presetId) {
    const controls = getModelIdElements(type);
    if (!controls.search) return;

    const cfg = typeof loadModelConfig === 'function' ? (loadModelConfig(modelKey) || {}) : {};
    const customSite = (modelKey || '').startsWith('custom_source_') && typeof loadAllCustomSourceSites === 'function'
      ? (loadAllCustomSourceSites() || {})[modelKey.replace('custom_source_', '')]
      : null;

    const existingId = presetId
      || cfg.preferredModelId
      || cfg.modelId
      || (customSite ? (customSite.modelId || (Array.isArray(customSite.availableModels) && customSite.availableModels[0]?.id) || '') : '')
      || getDefaultModelId(modelKey);

    setModelIdField(type, modelKey, existingId);
  }

  async function fetchAndPopulateModelIds(type, modelKey) {
    const controls = getModelIdElements(type);
    if (!controls.search || !modelKey) return;

    if (shouldUseManualModelId(type, modelKey)) {
      alert('火山引擎模型 ID 请手动填写');
      populateModelIds(type, modelKey);
      return;
    }

    // 配图模型也支持探测
    // if (type === 'img') return;

    // 取第一个可用 Key
    let apiKey = '';
    if (typeof loadModelKeys === 'function') {
      const keys = loadModelKeys(modelKey) || [];
      const usable = keys.filter(k => k.status === 'valid' || k.status === 'untested');
      if (usable.length > 0) apiKey = usable[0].value;
    }
    if (!apiKey) {
      alert(`请先为 ${modelKey} 配置有效的 API Key`);
      return;
    }

    // 显示加载状态
    if (controls.search) {
      controls.search.placeholder = '获取中...';
      controls.search.disabled = true;
    }

    try {
      const ids = await fetchModelIdsByProvider(modelKey, apiKey);
      if (!ids || !ids.length) {
        // 探测失败时退回已保存/默认模型 ID
        populateModelIds(type, modelKey);
        if (controls.search) {
          controls.search.placeholder = '未探测到模型，可手动输入';
        }
      } else {
        // 显示 Dropdown
        showModelDropdown(type, ids);
        
        // 如果当前没有值，选择第一个
        if (controls.search && !controls.search.value) {
          controls.search.value = ids[0];
        }
        if (controls.search) {
          controls.search.placeholder = `已探测到 ${ids.length} 个模型`;
        }
        console.log(`[PPT Model Config] 探测到 ${ids.length} 个模型:`, ids.slice(0, 5));
      }
    } catch (e) {
      console.error('[PPT] fetchModelIdsByProvider error:', e);
      if (controls.search) {
          controls.search.placeholder = '探测失败，请手动输入';
      }
    } finally {
      if (controls.search) {
        controls.search.disabled = false;
      }
    }
  }

  /**
   * 探测模型列表（参考 chatbot 行为）
   */
  async function fetchModelIdsByProvider(providerKey, apiKey) {
    if (!providerKey || !apiKey) return [];

    const normalizeBase = (url) => (url || '').trim().replace(/\/+$/, '').replace(/\/v1$/, '');
    const isGeminiFormat = (fmt, baseUrl) => {
      const lower = (fmt || '').toLowerCase();
      return lower.includes('gemini') || /generativelanguage\.googleapis\.com/i.test(baseUrl || '');
    };
    const tryDetector = async (baseUrl, requestFormat, endpointMode) => {
      if (!baseUrl || !global.modelDetector || typeof global.modelDetector.detectModelsForSite !== 'function') return null;
      try {
        const list = await global.modelDetector.detectModelsForSite(baseUrl, apiKey, requestFormat || 'openai', endpointMode || 'auto');
        if (Array.isArray(list) && list.length) {
          return list.map(m => m.id).filter(Boolean);
        }
      } catch (err) {
        console.warn('[PPT] detectModelsForSite failed', err);
      }
      return null;
    };

    // 自定义源站：优先使用已保存的可用模型或 modelDetector
    if (providerKey.startsWith('custom_source_') || providerKey === 'custom') {
      const sites = typeof loadAllCustomSourceSites === 'function' ? (loadAllCustomSourceSites() || {}) : {};
      const siteId = providerKey.replace('custom_source_', '');
      const site = sites[siteId] || (providerKey === 'custom' ? (typeof loadModelConfig === 'function' ? (loadModelConfig('custom') || null) : null) : null);
      if (!site) return [];

      if (Array.isArray(site.availableModels) && site.availableModels.length) {
        return site.availableModels.map(m => m.id || m.name || '').filter(Boolean);
      }

      const baseUrl = normalizeBase(site.apiBaseUrl || site.apiEndpoint || '');
      if (!baseUrl) return [];

      const requestFormat = site.requestFormat || 'openai';
      const endpointMode = site.endpointMode || 'auto';
      const detected = await tryDetector(baseUrl, requestFormat, endpointMode);
      if (Array.isArray(detected) && detected.length) return detected;

      try {
        const treatAsGemini = isGeminiFormat(requestFormat, baseUrl);
        const endpoint = treatAsGemini
          ? `${baseUrl}/v1beta/models?key=${encodeURIComponent(apiKey)}`
          : `${normalizeBase(baseUrl)}/v1/models`;
        const headers = treatAsGemini ? {} : { 'Authorization': `Bearer ${apiKey}` };
        const resp = await fetch(endpoint, { headers });
        if (!resp.ok) throw new Error(`${resp.status}`);
        const data = await resp.json();
        if (treatAsGemini) {
          const items = Array.isArray(data.models || data.data) ? (data.models || data.data) : [];
          return items.map(m => (m.name ? String(m.name).split('/').pop() : (m.id || ''))).filter(Boolean);
        }
        return Array.isArray(data.data) ? data.data.map(m => m.id).filter(Boolean) : [];
      } catch (e) {
        console.error('[PPT] fetchModelIdsByProvider (custom) failed', e);
        return [];
      }
    }

    try {
      if (providerKey === 'gemini-image' || providerKey === 'gemini' || providerKey === 'gemini-pro') {
        const cfg = typeof loadModelConfig === 'function' ? (loadModelConfig(providerKey) || loadModelConfig('gemini') || {}) : {};
        const baseUrl = normalizeBase(cfg.apiBaseUrl || 'https://generativelanguage.googleapis.com');
        const resp = await fetch(`${baseUrl}/v1beta/models?key=${encodeURIComponent(apiKey)}`);
        if (!resp.ok) throw new Error(`${resp.status}`);
        const data = await resp.json();
        const items = Array.isArray(data.models || data.data) ? (data.models || data.data) : [];
        return items.map(m => (m.name ? String(m.name).split('/').pop() : (m.id || ''))).filter(Boolean);
      } else if (providerKey === 'deepseek') {
        const cfg = typeof loadModelConfig === 'function' ? (loadModelConfig(providerKey) || {}) : {};
        const baseUrl = normalizeBase(cfg.apiBaseUrl || 'https://api.deepseek.com');
        const resp = await fetch(`${baseUrl}/v1/models`, { headers: { 'Authorization': `Bearer ${apiKey}` } });
        if (!resp.ok) throw new Error(`${resp.status}`);
        const data = await resp.json();
        return Array.isArray(data.data) ? data.data.map(m => m.id).filter(Boolean) : [];
      } else if (providerKey === 'mistral') {
        const cfg = typeof loadModelConfig === 'function' ? (loadModelConfig(providerKey) || {}) : {};
        const baseUrl = normalizeBase(cfg.apiBaseUrl || 'https://api.mistral.ai');
        const resp = await fetch(`${baseUrl}/v1/models`, { headers: { 'Authorization': `Bearer ${apiKey}` } });
        if (!resp.ok) throw new Error(`${resp.status}`);
        const data = await resp.json();
        return Array.isArray(data.data) ? data.data.map(m => m.id).filter(Boolean) : [];
      } else if (providerKey === 'tongyi') {
        const cfg = typeof loadModelConfig === 'function' ? (loadModelConfig(providerKey) || {}) : {};
        const baseUrl = normalizeBase(cfg.apiBaseUrl || 'https://dashscope.aliyuncs.com/compatible-mode');
        const resp = await fetch(`${baseUrl}/v1/models`, { headers: { 'Authorization': `Bearer ${apiKey}` } });
        if (!resp.ok) throw new Error(`${resp.status}`);
        const data = await resp.json();
        const items = Array.isArray(data.data) ? data.data : (Array.isArray(data.models) ? data.models : (Array.isArray(data?.data?.models) ? data.data.models : []));
        return items.map(m => m.model || m.id || m.name).filter(Boolean);
      } else if (providerKey === 'volcano') {
        const cfg = typeof loadModelConfig === 'function' ? (loadModelConfig(providerKey) || {}) : {};
        const baseUrl = normalizeBase(cfg.apiBaseUrl || 'https://ark.cn-beijing.volces.com/api/v3');
        const resp = await fetch(`${baseUrl}/models`, { headers: { 'Authorization': `Bearer ${apiKey}` } });
        if (!resp.ok) throw new Error(`${resp.status}`);
        const data = await resp.json();
        const items = Array.isArray(data.data) ? data.data : (Array.isArray(data.models) ? data.models : []);
        return items.map(m => m.model || m.id || m.name).filter(Boolean);
      } else {
        // 默认 OpenAI 兼容
        const base = (typeof loadModelConfig === 'function' ? (loadModelConfig(providerKey) || {}).apiBaseUrl : '') || 'https://api.openai.com';
        const endpoint = `${normalizeBase(base)}/v1/models`;
        const resp = await fetch(endpoint, { headers: { 'Authorization': `Bearer ${apiKey}` } });
        if (!resp.ok) throw new Error(`${resp.status}`);
        const data = await resp.json();
        return Array.isArray(data.data) ? data.data.map(m => m.id).filter(Boolean) : [];
      }
    } catch (e) {
      console.error('[PPT] fetchModelIdsByProvider failed', e);
      return [];
    }
  }

  // ========== 生图统计功能 ==========
  const IMAGE_GEN_STATS_KEY = 'pptImageGenStats';
  
  function loadImageGenStats() {
    try {
      const raw = localStorage.getItem(IMAGE_GEN_STATS_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return { count: 0, lastTime: null, history: [] };
  }
  
  function saveImageGenStats(stats) {
    localStorage.setItem(IMAGE_GEN_STATS_KEY, JSON.stringify(stats));
  }
  
  /**
   * 记录一次生图
   * @param {Object} options - { model, modelId, prompt, success }
   */
  function recordImageGeneration(options = {}) {
    const stats = loadImageGenStats();
    const now = Date.now();
    
    stats.count = (stats.count || 0) + 1;
    stats.lastTime = now;
    
    // 保留最近 100 条记录
    if (!Array.isArray(stats.history)) stats.history = [];
    stats.history.unshift({
      time: now,
      model: options.model || '',
      modelId: options.modelId || '',
      prompt: (options.prompt || '').substring(0, 100),
      success: options.success !== false
    });
    if (stats.history.length > 100) {
      stats.history = stats.history.slice(0, 100);
    }
    
    saveImageGenStats(stats);
    return stats;
  }
  
  function formatStatsDisplay(stats) {
    if (!stats || !stats.count) return '';
    
    const lastTimeStr = stats.lastTime 
      ? new Date(stats.lastTime).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '无';
    
    return `已生成 ${stats.count} 张图片 · 上次: ${lastTimeStr}`;
  }
  
  function updateStatsDisplay() {
    const el = document.getElementById('ppt-image-gen-stats');
    if (el) {
      el.textContent = formatStatsDisplay(loadImageGenStats());
    }
  }

  // ========== 高级设置 & 交互助手 ==========

  function toggleAdvancedSettings() {
      const panel = document.getElementById('pmc-image-settings-panel');
      const chevron = document.getElementById('pmc-settings-chevron');
      const btn = document.getElementById('ppt-image-processor-settings');
      
      if (!panel) return;
      const computedDisplay = window.getComputedStyle(panel).display;
      const isVisible = computedDisplay !== 'none';
      
      if (isVisible) {
          panel.style.display = 'none';
          if (chevron) chevron.setAttribute('icon', 'carbon:chevron-down');
          if (btn) btn.innerHTML = '<iconify-icon icon="carbon:chevron-down" width="16" id="pmc-settings-chevron"></iconify-icon> 展开图片处理设置';
      } else {
          panel.style.display = 'block';
          if (chevron) chevron.setAttribute('icon', 'carbon:chevron-up');
          if (btn) btn.innerHTML = '<iconify-icon icon="carbon:chevron-up" width="16" id="pmc-settings-chevron"></iconify-icon> 收起图片处理设置';
          
          // Smooth scroll to show the panel
          setTimeout(() => {
              panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }, 50);
      }
  }

  function bindImageSettingsEvents() {
      // Inputs
      const edgeSlider = document.getElementById('pmc-edge-threshold');
      const colorSlider = document.getElementById('pmc-color-tolerance');
      const presetSelect = document.getElementById('pmc-vectorize-preset');
      const ocrRadios = document.querySelectorAll('input[name="pmc-ocr-priority"]');

      if (edgeSlider) {
          edgeSlider.oninput = () => document.getElementById('pmc-edge-val').textContent = edgeSlider.value;
          edgeSlider.onchange = () => saveImageSettings();
      }
      if (colorSlider) {
          colorSlider.oninput = () => document.getElementById('pmc-color-val').textContent = colorSlider.value;
          colorSlider.onchange = () => saveImageSettings();
      }
      if (presetSelect) {
          presetSelect.onchange = () => saveImageSettings();
      }
      ocrRadios.forEach(r => r.onchange = () => saveImageSettings());
  }

  function loadImageSettings() {
      const config = (window.imageProcessor && window.imageProcessor.config) || (() => {
          try { return JSON.parse(localStorage.getItem('imageProcessorConfig')) || {}; } catch(e) { return {}; }
      })();
      
      // Defaults
      const ocrPriority = config.ocrPriority || 'mineru';
      const vectorizePreset = config.vectorizePreset || 'auto';
      const edgeThreshold = (config.bgRemover && config.bgRemover.edgeThreshold) || 30;
      const colorTolerance = (config.bgRemover && config.bgRemover.colorTolerance) || 25;

      // Set Values
      const radio = document.querySelector(`input[name="pmc-ocr-priority"][value="${ocrPriority}"]`);
      if (radio) radio.checked = true;

      const presetSel = document.getElementById('pmc-vectorize-preset');
      if (presetSel) presetSel.value = vectorizePreset;

      const edgeSlider = document.getElementById('pmc-edge-threshold');
      if (edgeSlider) { edgeSlider.value = edgeThreshold; document.getElementById('pmc-edge-val').textContent = edgeThreshold; }

      const colorSlider = document.getElementById('pmc-color-tolerance');
      if (colorSlider) { colorSlider.value = colorTolerance; document.getElementById('pmc-color-val').textContent = colorTolerance; }

      updateOcrStatus();
  }

  function saveImageSettings() {
      const ocrPriority = document.querySelector('input[name="pmc-ocr-priority"]:checked')?.value || 'mineru';
      const vectorizePreset = document.getElementById('pmc-vectorize-preset')?.value || 'auto';
      const edgeThreshold = parseInt(document.getElementById('pmc-edge-threshold')?.value || 30);
      const colorTolerance = parseInt(document.getElementById('pmc-color-tolerance')?.value || 25);

      const config = {
          ocrPriority,
          vectorizePreset,
          bgRemover: { edgeThreshold, colorTolerance }
      };

      // Save to ImageProcessor global instance if available
      if (window.imageProcessor && typeof window.imageProcessor.saveConfig === 'function') {
          window.imageProcessor.saveConfig(config);
      }
      // Save to LocalStorage
      localStorage.setItem('imageProcessorConfig', JSON.stringify(config));
  }

  function updateOcrStatus() {
      const el = document.getElementById('pmc-ocr-status');
      if (!el) return;

      if (!window.imageProcessor) {
          el.innerHTML = '<span style="color:#64748b">进入图片编辑器后可用</span>';
          return;
      }
      
      const avail = typeof window.imageProcessor.getOcrAvailability === 'function' 
          ? window.imageProcessor.getOcrAvailability() 
          : { mineru: false, vlm: false };

      const mStatus = avail.mineru ? '<span style="color:#10b981">● 可用</span>' : '<span style="color:#ef4444">● 未配置</span>';
      const vStatus = avail.vlm ? '<span style="color:#10b981">● 可用</span>' : '<span style="color:#ef4444">● 未配置</span>';

      el.innerHTML = `MinerU: ${mStatus} &nbsp;&nbsp; 视觉模型: ${vStatus}`;
  }

  injectStyles();
  bindModalEvents();
  
  global.PPTModelConfigModal = { 
    openModal, 
    closeModal, 
    loadConfig,
    // 暴露统计功能
    recordImageGeneration,
    loadImageGenStats
  };

})(typeof window !== 'undefined' ? window : this);
