/**
 * UI V2 Modal Manager
 * Replaces legacy PPTUIActions-based modals with V2 action binder.
 */

import { bindActionEvents } from '../core/action-binder.js';
import { escapeHtml, escapeAttr } from '../core/ui-utils.js';
import { getUIEventBus } from '../core/event-bus.js';
import { getStateStore } from '../core/state-store.js';

function formatSize(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(value) / Math.log(k));
  return `${parseFloat((value / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function getModalHost(generator) {
  if (generator?.elements?.overlay) return generator.elements.overlay;
  if (typeof document === 'undefined') return null;
  return document.getElementById('pptGeneratorOverlay') || document.body;
}

export class ModalManager {
  constructor({ adapter, eventBus, stateStore, generator } = {}) {
    this.adapter = adapter || null;
    this.eventBus = eventBus || getUIEventBus();
    this.stateStore = stateStore || getStateStore();
    this.generator = generator || this.adapter?.generator || null;

    this._historySelected = new Set();
    this._pendingUrls = [];
    this._selectedUrlIndex = -1;
    this._plannerOutline = [];
    this._pasteDocumentModalTimer = null;
    this._pasteDocumentModalKeyHandler = null;
    this._subscriptions = [];
    this._bindEventBus();
  }

  dispose() {
    this._subscriptions.forEach((off) => {
      if (typeof off === 'function') off();
    });
    this._subscriptions = [];
  }

  setGenerator(generator) {
    this.generator = generator;
    return this;
  }

  patchGenerator(generator = this._ensureGenerator()) {
    if (!generator) return;

    if (!generator.__uiV2ModalBackup) {
      generator.__uiV2ModalBackup = {
        openHistorySelector: generator.openHistorySelector,
        openUrlInput: generator.openUrlInput,
        openPasteDocumentModal: generator.openPasteDocumentModal,
        openOutlinePlanner: generator.openOutlinePlanner,
        confirmDialog: generator.confirmDialog
      };
    }

    if (generator.__uiV2ModalPatched) {
      generator.__uiV2ModalManager = this;
      this.setGenerator(generator);
      return;
    }

    generator.__uiV2ModalPatched = true;
    generator.__uiV2ModalManager = this;
    this.setGenerator(generator);

    generator.openHistorySelector = (...args) => this.openHistorySelector(...args);
    generator.openUrlInput = (...args) => this.openUrlInput(...args);
    generator.openPasteDocumentModal = (...args) => this.openPasteDocumentModal(...args);
    generator.openOutlinePlanner = (...args) => this.openOutlinePlanner(...args);
    generator.confirmDialog = (...args) => this.confirmDialog(...args);
  }

  openHistorySelector() {
    const generator = this._ensureGenerator();
    if (!generator || typeof document === 'undefined') return;

    const data = this._ensureWorkflowData();
    if (!Array.isArray(data.files)) data.files = [];

    const modalId = 'pptHistorySelectorModal';
    let overlay = document.getElementById(modalId);
    if (overlay && overlay.dataset.uiV2 !== '1') {
      overlay.remove();
      overlay = null;
    }
    if (overlay) {
      overlay.classList.add('open');
      if (overlay.dataset.actionsBound !== '1') {
        overlay.dataset.actionsBound = '1';
        bindActionEvents(overlay, (action) => {
          if (action === 'closeHistoryModal') {
            return () => overlay.classList.remove('open');
          }
          return null;
        });
      }
      this._loadHistoryData();
      return;
    }

    overlay = document.createElement('div');
    overlay.id = modalId;
    overlay.className = 'ppt-modal-overlay';
    overlay.dataset.uiV2 = '1';
    overlay.innerHTML = `
      <div class="ppt-modal ppt-history-selector-modal">
        <div class="ppt-modal-header">
          <div class="ppt-modal-title">
            <iconify-icon icon="solar:history-bold-duotone"></iconify-icon>
            <span>历史项目</span>
          </div>
          <button class="ppt-modal-close" data-action="closeHistoryModal">
            <iconify-icon icon="carbon:close"></iconify-icon>
          </button>
        </div>
        <div class="ppt-modal-body">
          <div class="ppt-history-tabs">
            <button class="ppt-history-tab active" data-tab="deepsearch">
              <iconify-icon icon="solar:magnifer-bold-duotone"></iconify-icon>
              深度研究项目
            </button>
            <button class="ppt-history-tab" data-tab="documents">
              <iconify-icon icon="solar:document-bold-duotone"></iconify-icon>
              历史文档
            </button>
          </div>
          <div class="ppt-history-content">
            <div class="ppt-history-panel active" data-panel="deepsearch">
              <div class="ppt-history-list" id="pptHistoryDeepsearchList">
                <div class="ppt-history-loading">
                  <iconify-icon icon="svg-spinners:180-ring"></iconify-icon>
                  加载中...
                </div>
              </div>
            </div>
            <div class="ppt-history-panel" data-panel="documents">
              <div class="ppt-history-list" id="pptHistoryDocumentsList">
                <div class="ppt-history-loading">
                  <iconify-icon icon="svg-spinners:180-ring"></iconify-icon>
                  加载中...
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="ppt-modal-footer">
          <button class="ppt-btn ppt-btn-secondary" data-action="closeHistoryModal">取消</button>
          <button class="ppt-btn ppt-btn-primary" id="pptHistoryImportBtn" disabled>
            导入选中项目
          </button>
        </div>
      </div>
    `;

    const host = getModalHost(generator);
    host?.appendChild(overlay);

    if (overlay.dataset.actionsBound !== '1') {
      overlay.dataset.actionsBound = '1';
      bindActionEvents(overlay, (action) => {
        if (action === 'closeHistoryModal') {
          return () => overlay.classList.remove('open');
        }
        return null;
      });
    }

    overlay.querySelectorAll('.ppt-history-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        overlay.querySelectorAll('.ppt-history-tab').forEach((t) => t.classList.remove('active'));
        overlay.querySelectorAll('.ppt-history-panel').forEach((p) => p.classList.remove('active'));
        tab.classList.add('active');
        overlay.querySelector(`[data-panel="${tab.dataset.tab}"]`)?.classList.add('active');
      });
    });

    const importBtn = overlay.querySelector('#pptHistoryImportBtn');
    importBtn?.addEventListener('click', () => {
      this._importSelectedHistoryItems();
      overlay.classList.remove('open');
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('open');
    });

    overlay.classList.add('open');
    this._loadHistoryData();
  }

  async _loadHistoryData() {
    if (typeof document === 'undefined') return;
    this._historySelected.clear();
    const importBtn = document.getElementById('pptHistoryImportBtn');
    if (importBtn) importBtn.disabled = true;

    const dsListEl = document.getElementById('pptHistoryDeepsearchList');
    try {
      const checkpoints = this._getAllCheckpoints();
      if (dsListEl) {
        if (checkpoints.length === 0) {
          dsListEl.innerHTML = '<div class="ppt-history-empty"><iconify-icon icon="solar:folder-open-linear" style="font-size:32px;margin-bottom:8px;display:block;"></iconify-icon>暂无深度研究项目</div>';
        } else {
          dsListEl.innerHTML = checkpoints.map((cp) => this._renderHistoryItem(cp, 'checkpoint')).join('');
        }
      }
    } catch {
      if (dsListEl) dsListEl.innerHTML = '<div class="ppt-history-empty">加载失败</div>';
    }

    const docListEl = document.getElementById('pptHistoryDocumentsList');
    try {
      const results = typeof window !== 'undefined' && typeof window.getAllResultsFromDB === 'function'
        ? await window.getAllResultsFromDB()
        : [];
      if (docListEl) {
        if (!results || results.length === 0) {
          docListEl.innerHTML = '<div class="ppt-history-empty"><iconify-icon icon="solar:folder-open-linear" style="font-size:32px;margin-bottom:8px;display:block;"></iconify-icon>暂无历史文档</div>';
        } else {
          const sorted = results.slice().sort((a, b) => new Date(b.time) - new Date(a.time));
          docListEl.innerHTML = sorted.map((doc) => this._renderHistoryItem(doc, 'document')).join('');
        }
      }
    } catch {
      if (docListEl) docListEl.innerHTML = '<div class="ppt-history-empty">加载失败</div>';
    }

    document.querySelectorAll('.ppt-history-item').forEach((item) => {
      item.addEventListener('click', () => {
        const key = item.dataset.key;
        if (!key) return;
        if (this._historySelected.has(key)) {
          this._historySelected.delete(key);
          item.classList.remove('selected');
        } else {
          this._historySelected.add(key);
          item.classList.add('selected');
        }
        const btn = document.getElementById('pptHistoryImportBtn');
        if (btn) btn.disabled = this._historySelected.size === 0;
      });
    });
  }

  _getAllCheckpoints() {
    if (typeof localStorage === 'undefined') return [];
    const checkpoints = [];
    const prefix = 'ppt_checkpoint_';
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) {
        try {
          const data = JSON.parse(localStorage.getItem(key));
          if (Array.isArray(data) && data.length > 0) {
            const latest = data[data.length - 1];
            const projectId = key.replace(prefix, '');
            checkpoints.push({
              projectId,
              storageKey: key,
              ...latest,
              title: latest.metadata?.title || latest.state?.userConfig?.taskGoal || `项目 ${projectId}`
            });
          }
        } catch {
          // ignore
        }
      }
    }
    return checkpoints.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  _renderHistoryItem(item, type) {
    const key = type === 'checkpoint' ? `cp:${item.storageKey}` : `doc:${item.id}`;
    const title = type === 'checkpoint'
      ? escapeHtml(item.title || '未命名项目')
      : escapeHtml(item.name || '未命名文档');
    const time = type === 'checkpoint' ? item.timestamp : item.time;
    const timeStr = time ? new Date(time).toLocaleString() : '';
    const badge = type === 'checkpoint'
      ? (item.stage || 'unknown').replace('deepsearch.', '').replace('design.', '')
      : (item.type || 'document');

    return `
      <div class="ppt-history-item" data-key="${escapeAttr(key)}" data-type="${type}">
        <div class="ppt-history-item-check">
          <iconify-icon icon="carbon:checkmark" width="12"></iconify-icon>
        </div>
        <div class="ppt-history-item-info">
          <div class="ppt-history-item-title">${title}</div>
          <div class="ppt-history-item-meta">
            <span><iconify-icon icon="carbon:time"></iconify-icon>${escapeHtml(timeStr)}</span>
            <span class="ppt-history-item-badge">${escapeHtml(badge)}</span>
          </div>
        </div>
      </div>
    `;
  }

  async _importSelectedHistoryItems() {
    const data = this._ensureWorkflowData();
    if (!Array.isArray(data.files)) data.files = [];

    for (const key of this._historySelected) {
      const [type, id] = String(key).split(':');
      if (type === 'cp') {
        try {
          const raw = localStorage.getItem(id);
          const parsed = raw ? JSON.parse(raw) : null;
          const latest = Array.isArray(parsed) ? parsed[parsed.length - 1] : null;
          if (latest?.state) {
            const title = latest.metadata?.title || latest.state?.userConfig?.taskGoal || '深度研究项目';
            const report = latest.state?.report?.markdown || latest.state?.L1?.report?.markdown || '';

            if (report) {
              data.files.push({
                name: `${title} - 研究报告`,
                type: 'history-report',
                size: '参考报告',
                content: report,
                checkpointKey: id
              });
            }

            const sources = Array.isArray(latest.state?.L0?.sources) ? latest.state.L0.sources : [];
            for (const src of sources) {
              const text = src?.sourceTextNormalized || '';
              if (!text || text.length < 100) continue;
              const srcTitle = src?.title || src?.uri || '未知来源';
              const srcUri = src?.uri || '';

              let sizeLabel = '历史来源';
              try {
                if (srcUri) sizeLabel = `来源: ${new URL(srcUri).hostname}`;
              } catch {
                // ignore
              }

              data.files.push({
                name: srcTitle,
                type: 'history-source',
                size: sizeLabel,
                content: text,
                sourceUri: srcUri,
                sourceId: src?.sourceId
              });
            }

            if (!report && sources.length === 0) {
              data.files.push({
                name: title,
                type: 'history-checkpoint',
                size: '研究项目',
                content: JSON.stringify(latest.state, null, 2).slice(0, 5000),
                checkpointKey: id
              });
            }
          }
        } catch (err) {
          console.warn('[HistoryImport] checkpoint parse error:', err);
        }
      } else if (type === 'doc') {
        try {
          const doc = typeof window !== 'undefined' && typeof window.getResultFromDB === 'function'
            ? await window.getResultFromDB(id)
            : null;
          if (doc) {
            data.files.push({
              name: doc.name || '历史文档',
              type: 'history-document',
              size: '历史文档',
              content: doc.result || doc.text || '',
              documentId: id
            });
          }
        } catch {
          // ignore
        }
      }
    }

    this._historySelected.clear();
    this._syncWorkflowField('files', data.files);
    this._syncGenerator();
  }

  openUrlInput() {
    const generator = this._ensureGenerator();
    if (!generator || typeof document === 'undefined') return;

    const modalId = 'pptUrlInputModal';
    let overlay = document.getElementById(modalId);
    if (overlay && overlay.dataset.uiV2 !== '1') {
      overlay.remove();
      overlay = null;
    }

    const bindActions = (modal) => {
      if (!modal || modal.dataset.actionsBound === '1') return;
      modal.dataset.actionsBound = '1';
      bindActionEvents(modal, (action) => {
        switch (action) {
          case 'closeUrlModal':
            return () => this.closeUrlModal();
          case 'switchUrlTab':
            return ({ payload }) => {
              const tab = payload?.tabValue || payload?.tab;
              if (tab) this._switchUrlTab(tab);
            };
          case 'fetchUrlPreview':
            return ({ event }) => {
              if (event?.type === 'keydown' && event.key !== 'Enter') return;
              this._fetchUrlPreview();
            };
          case 'batchFetchUrls':
            return () => this._batchFetchUrls();
          case 'deleteCurrentUrl':
            return () => this._deleteCurrentUrl();
          case 'saveCurrentUrl':
            return () => this._saveCurrentUrl();
          case 'selectUrl':
            return ({ payload }) => {
              if (Number.isFinite(payload?.index)) this._selectUrl(payload.index);
            };
          case 'confirmUrlImport':
            return () => this._confirmUrlImport();
          default:
            return null;
        }
      });
    };

    if (overlay) {
      overlay.classList.add('open');
      this._pendingUrls = [];
      this._selectedUrlIndex = -1;
      this._renderUrlSidebar();
      bindActions(overlay);
      return;
    }

    overlay = document.createElement('div');
    overlay.id = modalId;
    overlay.className = 'ppt-modal-overlay';
    overlay.dataset.uiV2 = '1';
    overlay.innerHTML = `
      <div class="ppt-modal ppt-url-parser-modal">
        <div class="ppt-modal-header">
          <div class="ppt-modal-title">
            <iconify-icon icon="solar:link-circle-bold-duotone"></iconify-icon>
            <span>网页链接解析</span>
          </div>
          <button class="ppt-modal-close" data-action="closeUrlModal">
            <iconify-icon icon="carbon:close"></iconify-icon>
          </button>
        </div>
        <div class="ppt-url-parser-body">
          <div class="ppt-url-sidebar">
            <div class="ppt-url-sidebar-header">
              <span>已添加链接</span>
              <span class="ppt-url-count" id="pptUrlCount">0</span>
            </div>
            <div class="ppt-url-sidebar-list" id="pptUrlSidebarList">
              <div class="ppt-url-sidebar-empty">
                <iconify-icon icon="solar:link-broken-linear"></iconify-icon>
                <span>暂无链接</span>
              </div>
            </div>
          </div>
          <div class="ppt-url-main">
            <div class="ppt-url-input-area">
              <div class="ppt-url-input-tabs">
                <button class="ppt-url-input-tab active" data-tab="single" data-action="switchUrlTab" data-tab-value="single">
                  单个链接
                </button>
                <button class="ppt-url-input-tab" data-tab="batch" data-action="switchUrlTab" data-tab-value="batch">
                  批量导入
                </button>
              </div>
              <div class="ppt-url-input-panel active" data-panel="single">
                <div class="ppt-url-input-row">
                  <input type="url" id="pptUrlInputField" class="ppt-url-input"
                    placeholder="https://example.com/article"
                    data-action="fetchUrlPreview" data-event="keydown">
                  <button class="ppt-btn ppt-btn-primary" data-action="fetchUrlPreview">
                    <iconify-icon icon="solar:magnifer-linear"></iconify-icon>
                    解析
                  </button>
                </div>
              </div>
              <div class="ppt-url-input-panel" data-panel="batch">
                <textarea id="pptUrlBatchInput" class="ppt-url-batch-input"
                  placeholder="每行一个链接，例如：&#10;https://example.com/article1&#10;https://example.com/article2&#10;https://example.com/article3"></textarea>
                <button class="ppt-btn ppt-btn-primary" style="margin-top:8px;" data-action="batchFetchUrls">
                  <iconify-icon icon="solar:play-bold"></iconify-icon>
                  批量解析
                </button>
              </div>
            </div>
            <div class="ppt-url-editor-area" id="pptUrlEditorArea">
              <div class="ppt-url-editor-empty" id="pptUrlEditorEmpty">
                <iconify-icon icon="solar:document-add-linear"></iconify-icon>
                <p>输入链接并点击解析，或从左侧选择已添加的链接进行编辑</p>
              </div>
              <div class="ppt-url-editor-content" id="pptUrlEditorContent" style="display:none;">
                <div class="ppt-url-editor-header">
                  <input type="text" id="pptUrlEditorTitle" class="ppt-url-editor-title" placeholder="标题">
                  <div class="ppt-url-editor-meta">
                    <span id="pptUrlEditorUrl"></span>
                    <span id="pptUrlEditorWordCount"></span>
                  </div>
                </div>
                <textarea id="pptUrlEditorText" class="ppt-url-editor-text" placeholder="解析的内容..."></textarea>
                <div class="ppt-url-editor-actions">
                  <button class="ppt-btn ppt-btn-secondary" data-action="deleteCurrentUrl">
                    <iconify-icon icon="carbon:trash-can"></iconify-icon>
                    删除
                  </button>
                  <button class="ppt-btn ppt-btn-primary" data-action="saveCurrentUrl">
                    <iconify-icon icon="carbon:checkmark"></iconify-icon>
                    保存修改
                  </button>
                </div>
              </div>
              <div class="ppt-url-loading" id="pptUrlLoading" style="display:none;">
                <iconify-icon icon="svg-spinners:180-ring"></iconify-icon>
                <span id="pptUrlLoadingText">正在解析...</span>
              </div>
            </div>
          </div>
        </div>
        <div class="ppt-modal-footer">
          <button class="ppt-btn ppt-btn-secondary" data-action="closeUrlModal">取消</button>
          <button class="ppt-btn ppt-btn-primary" id="pptUrlConfirmBtn" data-action="confirmUrlImport">
            确认添加 (<span id="pptUrlConfirmCount">0</span> 个)
          </button>
        </div>
      </div>
    `;

    const host = getModalHost(generator);
    host?.appendChild(overlay);
    bindActions(overlay);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('open');
    });

    overlay.classList.add('open');
    this._pendingUrls = [];
    this._selectedUrlIndex = -1;
    document.getElementById('pptUrlInputField')?.focus();
  }

  closeUrlModal() {
    const modal = typeof document !== 'undefined' ? document.getElementById('pptUrlInputModal') : null;
    if (modal) modal.classList.remove('open');
  }

  _switchUrlTab(tab) {
    document.querySelectorAll('.ppt-url-input-tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.ppt-url-input-panel').forEach((p) => p.classList.remove('active'));
    document.querySelector(`.ppt-url-input-tab[data-tab="${tab}"]`)?.classList.add('active');
    document.querySelector(`.ppt-url-input-panel[data-panel="${tab}"]`)?.classList.add('active');
  }

  async _fetchUrlPreview() {
    const input = document.getElementById('pptUrlInputField');
    const url = input?.value?.trim();
    if (!url) return;

    try { new URL(url); } catch {
      alert('请输入有效的网址');
      return;
    }

    await this._parseAndAddUrl(url);
    input.value = '';
    input.focus();
  }

  async _batchFetchUrls() {
    const textarea = document.getElementById('pptUrlBatchInput');
    const text = textarea?.value?.trim();
    if (!text) return;

    const urls = text.split(/[\n,]/).map((s) => s.trim()).filter((s) => {
      try { new URL(s); return true; } catch { return false; }
    });

    if (urls.length === 0) {
      alert('未找到有效的链接');
      return;
    }

    for (let i = 0; i < urls.length; i++) {
      const loadingText = document.getElementById('pptUrlLoadingText');
      if (loadingText) loadingText.textContent = `正在解析 ${i + 1}/${urls.length}...`;
      await this._parseAndAddUrl(urls[i]);
    }

    textarea.value = '';
  }

  async _parseAndAddUrl(url) {
    const loading = document.getElementById('pptUrlLoading');
    if (loading) loading.style.display = 'flex';

    const newItem = {
      url,
      title: new URL(url).hostname,
      text: '',
      wordCount: 0,
      status: 'parsing'
    };
    this._pendingUrls.push(newItem);
    const itemIndex = this._pendingUrls.length - 1;
    this._renderUrlSidebar();

    try {
      const { LocalMcpProvider } = await import('../../agents/mcp/local-mcp-provider.js');
      const provider = new LocalMcpProvider({
        workerEndpoint: typeof window !== 'undefined' ? window.CF_WORKER_ENDPOINT || null : null
      });

      const result = await provider.callTool('fetch_content', { url });
      if (!result.success) throw new Error(result.error || '解析失败');

      const jsonContent = result.content.find((c) => c?.type === 'json');
      const textContent = result.content.find((c) => c?.type === 'text');
      const metadata = jsonContent?.data?.metadata || {};
      const text = textContent?.text || jsonContent?.data?.text || '';

      this._pendingUrls[itemIndex] = {
        url,
        title: metadata.title || new URL(url).hostname,
        text: text.slice(0, 15000),
        wordCount: text.length,
        status: 'success'
      };
    } catch (err) {
      this._pendingUrls[itemIndex] = {
        url,
        title: new URL(url).hostname,
        text: '',
        wordCount: 0,
        status: 'error',
        error: err?.message || '解析失败'
      };
    }

    if (loading) loading.style.display = 'none';
    this._renderUrlSidebar();
    this._selectUrl(itemIndex);
  }

  _renderUrlSidebar() {
    const list = document.getElementById('pptUrlSidebarList');
    const count = document.getElementById('pptUrlCount');
    const confirmCount = document.getElementById('pptUrlConfirmCount');

    if (!list) return;

    const successCount = this._pendingUrls.filter((u) => u.status === 'success').length;
    if (count) count.textContent = this._pendingUrls.length;
    if (confirmCount) confirmCount.textContent = successCount;

    if (this._pendingUrls.length === 0) {
      list.innerHTML = `
        <div class="ppt-url-sidebar-empty">
          <iconify-icon icon="solar:link-broken-linear"></iconify-icon>
          <span>暂无链接</span>
        </div>
      `;
      return;
    }

    list.innerHTML = this._pendingUrls.map((item, i) => {
      const statusIcon = item.status === 'success'
        ? 'solar:check-circle-bold'
        : item.status === 'error'
          ? 'solar:close-circle-bold'
          : 'svg-spinners:180-ring';
      const statusClass = item.status || 'pending';
      return `
        <div class="ppt-url-sidebar-item ${i === this._selectedUrlIndex ? 'active' : ''} ${item.status === 'parsing' ? 'parsing' : ''}"
          data-action="selectUrl" data-index="${i}">
          <div class="ppt-url-sidebar-item-title">${escapeHtml(item.title)}</div>
          <div class="ppt-url-sidebar-item-url">${escapeHtml(new URL(item.url).hostname)}</div>
          <div class="ppt-url-sidebar-item-status ${statusClass}">
            <iconify-icon icon="${statusIcon}"></iconify-icon>
            ${item.status === 'success' ? `${item.wordCount} 字符` : item.status === 'error' ? '解析失败' : '解析中...'}
          </div>
        </div>
      `;
    }).join('');
  }

  _selectUrl(index) {
    this._selectedUrlIndex = index;
    this._renderUrlSidebar();

    const item = this._pendingUrls[index];
    const empty = document.getElementById('pptUrlEditorEmpty');
    const content = document.getElementById('pptUrlEditorContent');

    if (!item || item.status === 'parsing') {
      if (empty) empty.style.display = 'flex';
      if (content) content.style.display = 'none';
      return;
    }

    if (empty) empty.style.display = 'none';
    if (content) content.style.display = 'flex';

    const titleInput = document.getElementById('pptUrlEditorTitle');
    const urlEl = document.getElementById('pptUrlEditorUrl');
    const countEl = document.getElementById('pptUrlEditorWordCount');
    const textEl = document.getElementById('pptUrlEditorText');

    if (titleInput) titleInput.value = item.title || '';
    if (urlEl) urlEl.textContent = item.url;
    if (countEl) countEl.textContent = `${item.wordCount} 字符`;
    if (textEl) {
      textEl.value = item.status === 'error'
        ? `解析失败: ${item.error || '未知错误'}\n\n您可以手动粘贴内容到此处。`
        : (item.text || '');
    }
  }

  _saveCurrentUrl() {
    if (this._selectedUrlIndex < 0) return;
    const item = this._pendingUrls[this._selectedUrlIndex];
    if (!item) return;

    const titleInput = document.getElementById('pptUrlEditorTitle');
    const textEl = document.getElementById('pptUrlEditorText');
    item.title = titleInput?.value?.trim() || item.title;
    item.text = textEl?.value || '';
    item.wordCount = item.text.length;
    if (item.text.length > 0) item.status = 'success';

    this._renderUrlSidebar();
  }

  _deleteCurrentUrl() {
    if (this._selectedUrlIndex < 0) return;
    this._pendingUrls.splice(this._selectedUrlIndex, 1);
    this._selectedUrlIndex = Math.min(this._selectedUrlIndex, this._pendingUrls.length - 1);
    this._renderUrlSidebar();

    if (this._selectedUrlIndex >= 0) {
      this._selectUrl(this._selectedUrlIndex);
    } else {
      const empty = document.getElementById('pptUrlEditorEmpty');
      const content = document.getElementById('pptUrlEditorContent');
      if (empty) empty.style.display = 'flex';
      if (content) content.style.display = 'none';
    }
  }

  _confirmUrlImport() {
    const data = this._ensureWorkflowData();
    if (!Array.isArray(data.files)) data.files = [];

    const successUrls = this._pendingUrls.filter((u) => u.status === 'success' && u.text);
    for (const item of successUrls) {
      data.files.push({
        name: item.title || item.url,
        type: 'link',
        size: `${item.wordCount} 字符`,
        url: item.url,
        content: item.text
      });
    }

    this._pendingUrls = [];
    this._selectedUrlIndex = -1;
    document.getElementById('pptUrlInputModal')?.classList.remove('open');
    this._syncWorkflowField('files', data.files);
    this._syncGenerator();
  }

  openPasteDocumentModal() {
    if (typeof document === 'undefined') return;

    const modalId = 'pptPasteDocumentModal';
    let existing = document.getElementById(modalId);
    if (existing && existing.dataset.uiV2 !== '1') {
      existing.remove();
      existing = null;
    }
    const bindActions = (modal) => {
      if (!modal || modal.dataset.actionsBound === '1') return;
      modal.dataset.actionsBound = '1';
      bindActionEvents(modal, (action) => {
        switch (action) {
          case 'closePasteDocumentModal':
            return () => this.closePasteDocumentModal();
          case 'confirmPasteDocument':
            return () => this.confirmPasteDocument();
          default:
            return null;
        }
      });
    };

    if (existing) {
      existing.classList.add('open');
      bindActions(existing);
      return;
    }

    const overlay = document.createElement('div');
    overlay.id = modalId;
    overlay.className = 'ppt-modal-overlay open';
    overlay.dataset.uiV2 = '1';
    overlay.innerHTML = `
      <div class="ppt-modal" style="width: min(800px, 90vw); max-height: 80vh; display: flex; flex-direction: column;">
        <div class="ppt-modal-header">
          <div class="ppt-modal-title">
            <iconify-icon icon="carbon:paste"></iconify-icon>
            粘贴文档内容
          </div>
          <button class="ppt-modal-close" data-action="closePasteDocumentModal" aria-label="关闭">
            <iconify-icon icon="carbon:close"></iconify-icon>
          </button>
        </div>
        <div class="ppt-modal-body" style="flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 12px;">
          <div class="ppt-paste-hint" style="display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: var(--ppt-primary-subtle, #eef2ff); border-radius: 8px; font-size: 13px; color: var(--ppt-text-secondary, #64748b);">
            <iconify-icon icon="carbon:information" style="font-size: 16px; color: var(--ppt-primary, #4f46e5);"></iconify-icon>
            粘贴 Markdown 或纯文本，将作为素材添加到文件列表。可多次粘贴。
          </div>
          <div style="flex-shrink: 0;">
            <input type="text" id="pasteDocumentTitle" class="ppt-input-field" style="width: 100%; padding: 10px 14px; font-size: 14px;" placeholder="文档标题（可选，留空将自动提取）">
          </div>
          <div style="flex: 1; min-height: 0;">
            <div id="pasteDocumentEditor" style="min-height: 280px; height: 100%;"></div>
            <div id="pasteDocumentFallback" style="display: none;">
              <textarea id="pasteDocumentTextarea" class="ppt-input-field" style="width: 100%; min-height: 280px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; line-height: 1.5;" placeholder="在此粘贴 Markdown/纯文本内容..."></textarea>
            </div>
          </div>
        </div>
        <div class="ppt-modal-footer">
          <button class="ppt-btn-secondary" data-action="closePasteDocumentModal">取消</button>
          <button class="ppt-btn-primary" data-action="confirmPasteDocument">
            <iconify-icon icon="carbon:add"></iconify-icon> 添加到素材
          </button>
        </div>
      </div>
    `;

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.closePasteDocumentModal();
    });

    this._pasteDocumentModalKeyHandler = (e) => {
      if (e.key === 'Escape') this.closePasteDocumentModal();
    };
    document.addEventListener('keydown', this._pasteDocumentModalKeyHandler);

    const host = getModalHost(this._ensureGenerator());
    host?.appendChild(overlay);
    bindActions(overlay);

    this._pasteDocumentModalTimer = setTimeout(() => {
      const fallback = document.getElementById('pasteDocumentFallback');
      const textarea = document.getElementById('pasteDocumentTextarea');

      if (typeof VditorAdapter !== 'undefined' && VditorAdapter.isAvailable()) {
        const mounted = VditorAdapter.mount({
          container: 'pasteDocumentEditor',
          value: '',
          onInput: () => {},
          mode: 'ir'
        });
        if (mounted) {
          if (fallback) fallback.style.display = 'none';
        } else if (fallback && textarea) {
          fallback.style.display = 'block';
          textarea.focus?.();
        }
      } else if (fallback && textarea) {
        fallback.style.display = 'block';
        textarea.focus?.();
      }
    }, 100);
  }

  closePasteDocumentModal() {
    if (this._pasteDocumentModalTimer) {
      clearTimeout(this._pasteDocumentModalTimer);
      this._pasteDocumentModalTimer = null;
    }

    if (this._pasteDocumentModalKeyHandler) {
      document.removeEventListener('keydown', this._pasteDocumentModalKeyHandler);
      this._pasteDocumentModalKeyHandler = null;
    }

    if (typeof VditorAdapter !== 'undefined') {
      try {
        VditorAdapter.destroy?.();
      } catch {
        // ignore
      }
    }

    const modal = document.getElementById('pptPasteDocumentModal');
    if (modal) {
      modal.classList.remove('open');
      setTimeout(() => modal.remove(), 300);
    }
  }

  confirmPasteDocument() {
    let content = '';

    if (typeof VditorAdapter !== 'undefined' && VditorAdapter.isAvailable()) {
      content = VditorAdapter.getValue();
    } else {
      content = document.getElementById('pasteDocumentTextarea')?.value || '';
    }

    if (!content || !content.trim()) {
      alert('请输入文档内容');
      return;
    }

    let title = document.getElementById('pasteDocumentTitle')?.value?.trim();
    if (!title) {
      const match = content.match(/^#\s+(.+)/m);
      title = match ? match[1].trim() : content.slice(0, 50).split('\n')[0].trim();
      if (!title) title = '粘贴文档';
    }

    const data = this._ensureWorkflowData();
    if (!Array.isArray(data.files)) data.files = [];

    const generator = this._ensureGenerator();
    const sizeLabel = typeof generator?._formatSize === 'function'
      ? generator._formatSize(content.length)
      : formatSize(content.length);

    const pasteItem = {
      name: title,
      size: sizeLabel,
      rawSize: content.length,
      mimeType: 'text/markdown',
      type: 'paste',
      content,
      timestamp: Date.now()
    };

    data.files.push(pasteItem);
    this._syncWorkflowField('files', data.files);
    this._syncGenerator();

    if (typeof this.adapter?.startFromPastedText === 'function') {
      this.adapter.startFromPastedText(content);
    } else if (typeof generator?.startFromPastedText === 'function') {
      generator.startFromPastedText(content);
    }

    this.closePasteDocumentModal();

    if (typeof generator?.addChatMessage === 'function') {
      generator.addChatMessage('ai', `已添加文档「${title}」到素材列表。您可以继续添加更多素材，或进入下一步配置。`);
    }
  }

  openOutlinePlanner(suggestedOutline) {
    if (typeof document === 'undefined') return;
    const modalId = 'pptOutlinePlannerModal';
    const existing = document.getElementById(modalId);
    if (existing) existing.remove();

    this._plannerOutline = Array.isArray(suggestedOutline) ? suggestedOutline.slice() : [];

    const renderSectionItem = (section, idx) => `
      <div class="ppt-planner-section" data-index="${idx}">
        <div class="ppt-planner-section-header">
          <div class="ppt-planner-section-drag">
            <iconify-icon icon="carbon:draggable"></iconify-icon>
          </div>
          <div class="ppt-planner-section-num">${idx + 1}</div>
          <input type="text" class="ppt-planner-section-title" value="${escapeAttr(section.title)}" placeholder="章节标题">
          <div class="ppt-planner-pages">
            <label>页数:</label>
            <input type="number" class="ppt-planner-page-count" value="${section.suggestedPages || 1}" min="1" max="10">
          </div>
          <button class="ppt-planner-section-delete" title="删除章节">
            <iconify-icon icon="carbon:trash-can"></iconify-icon>
          </button>
        </div>
        <div class="ppt-planner-section-body">
          <div class="ppt-planner-content-preview">${escapeHtml((section.content || '').slice(0, 200))}${(section.content || '').length > 200 ? '...' : ''}</div>
          <div class="ppt-planner-files-zone" data-section="${idx}">
            <div class="ppt-planner-files-label">
              <iconify-icon icon="carbon:document-add"></iconify-icon>
              拖入参考资料 (可选)
            </div>
            <div class="ppt-planner-files-list">${this._renderSectionFiles(section.sourceFiles)}</div>
          </div>
          <textarea class="ppt-planner-notes" placeholder="补充说明 (可选)...">${escapeHtml(section.notes || '')}</textarea>
        </div>
      </div>
    `;

    const overlay = document.createElement('div');
    overlay.id = modalId;
    overlay.className = 'ppt-modal-overlay open';
    overlay.innerHTML = `
      <div class="ppt-modal ppt-planner-modal">
        <div class="ppt-modal-header">
          <div class="ppt-modal-title">
            <iconify-icon icon="carbon:list-checked"></iconify-icon>
            大纲规划
          </div>
          <button class="ppt-modal-close" data-action="closeOutlinePlanner" aria-label="关闭">
            <iconify-icon icon="carbon:close"></iconify-icon>
          </button>
        </div>
        <div class="ppt-modal-body ppt-planner-body">
          <div class="ppt-planner-info">
            <iconify-icon icon="carbon:information"></iconify-icon>
            AI 已识别以下章节结构。您可以调整每个章节的页数、添加参考资料，或修改内容后再生成。
          </div>
          <div class="ppt-planner-sections" id="pptPlannerSections">
            ${this._plannerOutline.map(renderSectionItem).join('')}
          </div>
          <button class="ppt-planner-add-section" data-action="addPlannerSection">
            <iconify-icon icon="carbon:add"></iconify-icon>
            添加章节
          </button>
        </div>
        <div class="ppt-modal-footer">
          <div class="ppt-planner-summary">
            共 <span id="pptPlannerTotalPages">${this._plannerOutline.reduce((sum, s) => sum + (s.suggestedPages || 1), 0)}</span> 页
          </div>
          <button class="ppt-btn-secondary" data-action="closeOutlinePlanner">取消</button>
          <button class="ppt-btn-primary" data-action="confirmOutlinePlanner">
            <iconify-icon icon="carbon:rocket"></iconify-icon>
            开始生成
          </button>
        </div>
      </div>
    `;

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.closeOutlinePlanner();
    });

    const host = getModalHost(this._ensureGenerator());
    host?.appendChild(overlay);

    if (overlay.dataset.actionsBound !== '1') {
      overlay.dataset.actionsBound = '1';
      bindActionEvents(overlay, (action) => {
        switch (action) {
          case 'closeOutlinePlanner':
            return () => this.closeOutlinePlanner();
          case 'addPlannerSection':
            return () => this.addPlannerSection();
          case 'confirmOutlinePlanner':
            return () => this.confirmOutlinePlanner();
          default:
            return null;
        }
      });
    }

    this._bindPlannerEvents();
  }

  _bindPlannerEvents() {
    const container = document.getElementById('pptPlannerSections');
    if (!container) return;

    if (!container.dataset.bound) {
      container.dataset.bound = '1';

      container.addEventListener('change', (e) => {
        if (e.target.classList.contains('ppt-planner-page-count')) {
          this._updatePlannerTotalPages();
        }
      });

      container.addEventListener('input', (e) => {
        if (e.target.classList.contains('ppt-planner-section-title')) {
          const section = e.target.closest('.ppt-planner-section');
          const idx = parseInt(section?.dataset.index, 10);
          if (!Number.isNaN(idx) && this._plannerOutline[idx]) {
            this._plannerOutline[idx].title = e.target.value;
          }
        }
        if (e.target.classList.contains('ppt-planner-notes')) {
          const section = e.target.closest('.ppt-planner-section');
          const idx = parseInt(section?.dataset.index, 10);
          if (!Number.isNaN(idx) && this._plannerOutline[idx]) {
            this._plannerOutline[idx].notes = e.target.value;
          }
        }
      });

      container.addEventListener('click', (e) => {
        const deleteBtn = e.target.closest('.ppt-planner-section-delete');
        if (deleteBtn) {
          const section = deleteBtn.closest('.ppt-planner-section');
          const idx = parseInt(section?.dataset.index, 10);
          if (!Number.isNaN(idx)) {
            this.deletePlannerSection(idx);
          }
        }
      });
    }

    this._bindPlannerFileZones(container);
    this._updatePlannerTotalPages();
  }

  _bindPlannerFileZones(container) {
    container.querySelectorAll('.ppt-planner-files-zone').forEach((zone) => {
      if (zone.dataset.bound === '1') return;
      zone.dataset.bound = '1';

      zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        zone.classList.add('drag-over');
      });
      zone.addEventListener('dragleave', () => {
        zone.classList.remove('drag-over');
      });
      zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('drag-over');
        const sectionIdx = parseInt(zone.dataset.section, 10);
        const files = Array.from(e.dataTransfer?.files || []);
        this._addFilesToPlannerSection(sectionIdx, files);
      });
      zone.addEventListener('click', () => {
        const sectionIdx = parseInt(zone.dataset.section, 10);
        this._openFilePicker(sectionIdx);
      });
    });
  }

  _updatePlannerTotalPages() {
    const container = document.getElementById('pptPlannerSections');
    const totalEl = document.getElementById('pptPlannerTotalPages');
    if (!container || !totalEl) return;

    let total = 0;
    container.querySelectorAll('.ppt-planner-page-count').forEach((input) => {
      total += parseInt(input.value, 10) || 1;
    });
    totalEl.textContent = total;
  }

  addPlannerSection() {
    const newSection = {
      id: `section_${Date.now()}`,
      title: '新章节',
      suggestedPages: 1,
      content: '',
      sourceFiles: [],
      notes: ''
    };
    this._plannerOutline.push(newSection);
    this._rerenderPlannerSections();
  }

  deletePlannerSection(idx) {
    if (this._plannerOutline.length <= 1) {
      alert('至少保留一个章节');
      return;
    }
    this._plannerOutline.splice(idx, 1);
    this._rerenderPlannerSections();
  }

  _rerenderPlannerSections() {
    const container = document.getElementById('pptPlannerSections');
    if (!container) return;

    const renderSectionItem = (section, idx) => `
      <div class="ppt-planner-section" data-index="${idx}">
        <div class="ppt-planner-section-header">
          <div class="ppt-planner-section-drag">
            <iconify-icon icon="carbon:draggable"></iconify-icon>
          </div>
          <div class="ppt-planner-section-num">${idx + 1}</div>
          <input type="text" class="ppt-planner-section-title" value="${escapeAttr(section.title)}" placeholder="章节标题">
          <div class="ppt-planner-pages">
            <label>页数:</label>
            <input type="number" class="ppt-planner-page-count" value="${section.suggestedPages || 1}" min="1" max="10">
          </div>
          <button class="ppt-planner-section-delete" title="删除章节">
            <iconify-icon icon="carbon:trash-can"></iconify-icon>
          </button>
        </div>
        <div class="ppt-planner-section-body">
          <div class="ppt-planner-content-preview">${escapeHtml((section.content || '').slice(0, 200))}${(section.content || '').length > 200 ? '...' : ''}</div>
          <div class="ppt-planner-files-zone" data-section="${idx}">
            <div class="ppt-planner-files-label">
              <iconify-icon icon="carbon:document-add"></iconify-icon>
              拖入参考资料 (可选)
            </div>
            <div class="ppt-planner-files-list">${this._renderSectionFiles(section.sourceFiles)}</div>
          </div>
          <textarea class="ppt-planner-notes" placeholder="补充说明 (可选)...">${escapeHtml(section.notes || '')}</textarea>
        </div>
      </div>
    `;

    container.innerHTML = this._plannerOutline.map(renderSectionItem).join('');
    this._bindPlannerEvents();
  }

  _renderSectionFiles(files) {
    if (!files || files.length === 0) return '';
    return files.map((f, i) => `
      <div class="ppt-planner-file-item">
        <iconify-icon icon="carbon:document"></iconify-icon>
        <span>${escapeHtml(f.name)}</span>
        <button class="ppt-planner-file-remove" data-file-idx="${i}">
          <iconify-icon icon="carbon:close"></iconify-icon>
        </button>
      </div>
    `).join('');
  }

  _addFilesToPlannerSection(sectionIdx, files) {
    if (!this._plannerOutline[sectionIdx]) return;
    if (!this._plannerOutline[sectionIdx].sourceFiles) {
      this._plannerOutline[sectionIdx].sourceFiles = [];
    }
    files.forEach((f) => {
      this._plannerOutline[sectionIdx].sourceFiles.push({
        name: f.name,
        file: f,
        type: f.type
      });
    });
    this._rerenderPlannerSections();
  }

  _openFilePicker(sectionIdx) {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.pdf,.docx,.txt,.md,.pptx,image/*';
    input.onchange = (e) => {
      const files = Array.from(e.target.files || []);
      this._addFilesToPlannerSection(sectionIdx, files);
    };
    input.click();
  }

  closeOutlinePlanner() {
    const modal = document.getElementById('pptOutlinePlannerModal');
    if (modal) {
      modal.classList.remove('open');
      setTimeout(() => modal.remove(), 300);
    }
  }

  confirmOutlinePlanner() {
    const container = document.getElementById('pptPlannerSections');
    if (!container) return;

    const sections = [];
    container.querySelectorAll('.ppt-planner-section').forEach((el, idx) => {
      const title = el.querySelector('.ppt-planner-section-title')?.value || `章节 ${idx + 1}`;
      const pages = parseInt(el.querySelector('.ppt-planner-page-count')?.value, 10) || 1;
      const notes = el.querySelector('.ppt-planner-notes')?.value || '';
      const original = this._plannerOutline[idx] || {};

      sections.push({
        ...original,
        title,
        suggestedPages: pages,
        notes
      });
    });

    const data = this._ensureWorkflowData();
    data.plannedOutline = sections;
    data._mode = 'planned';
    this._syncWorkflowField('plannedOutline', sections);
    this._syncWorkflowField('_mode', 'planned');
    this._syncGenerator();

    this.closeOutlinePlanner();

    if (typeof this.adapter?.executePlannedGeneration === 'function') {
      this.adapter.executePlannedGeneration(sections);
    } else if (typeof this._ensureGenerator()?._executePlannedGeneration === 'function') {
      this._ensureGenerator()._executePlannedGeneration(sections);
    } else if (typeof this._ensureGenerator()?._startPlannedBatchGeneration === 'function') {
      this._ensureGenerator()._startPlannedBatchGeneration(sections);
    }
  }

  confirmDialog({ title = '确认', message = '确定继续？', confirmText = '确认', cancelText = '取消' } = {}) {
    return new Promise((resolve) => {
      const id = `pptConfirmModal_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const footer = `
        <button class="ppt-btn ppt-btn-secondary" data-action="resolveConfirm" data-ok="false">${escapeHtml(cancelText)}</button>
        <button class="ppt-btn ppt-btn-primary" data-action="resolveConfirm" data-ok="true">${escapeHtml(confirmText)}</button>
      `;

      const handleResolve = (ok) => {
        this._closeModalById(id);
        resolve(Boolean(ok));
      };

      this._openOrCreateModal({
        id,
        className: 'ppt-confirm-modal',
        titleHtml: escapeHtml(title),
        bodyHtml: `<div style="padding: 4px 0; line-height: 1.6;">${escapeHtml(message)}</div>`,
        footerHtml: footer,
        actions: {
          resolveConfirm: ({ payload }) => handleResolve(payload?.ok)
        }
      });
    });
  }

  _bindEventBus() {
    if (!this.eventBus) return;
    const off = this.eventBus.on('ui.action', (_name, payload) => {
      const type = payload?.type;
      switch (type) {
        case 'openHistorySelector':
          this.openHistorySelector();
          break;
        case 'openUrlInput':
          this.openUrlInput();
          break;
        case 'openPasteDocumentModal':
          this.openPasteDocumentModal();
          break;
        case 'openOutlinePlanner':
          this.openOutlinePlanner(payload?.suggestedOutline || payload?.outline);
          break;
        default:
          break;
      }
    });
    this._subscriptions.push(off);
  }

  _ensureGenerator() {
    return this.generator || this.adapter?.generator || null;
  }

  _ensureWorkflowData() {
    const generator = this._ensureGenerator();
    if (!generator) return {};
    if (!generator.workflowData) generator.workflowData = {};
    return generator.workflowData;
  }

  _syncWorkflowField(field, value) {
    const generator = this._ensureGenerator();
    if (!generator) return;
    const data = this._ensureWorkflowData();
    data[field] = value;
    if (generator.currentProject?.workflowData) {
      generator.currentProject.workflowData[field] = value;
    }
    generator.setAutoSaveNeeded?.();
  }

  _syncGenerator() {
    const generator = this._ensureGenerator();
    this.adapter?.setGenerator?.(generator);
    this.adapter?.syncFromGenerator?.();
    if (generator && !generator._uiV2Instance) {
      generator.renderPreviewArea?.();
    }
  }

  _openOrCreateModal({ id, className = '', titleHtml = '', bodyHtml = '', footerHtml = '', onMount, actions } = {}) {
    if (!id || typeof document === 'undefined') return null;
    let overlay = document.getElementById(id);
    if (overlay) {
      overlay.classList.add('open');
      try { onMount?.(overlay); } catch {
        // ignore
      }
      return overlay;
    }

    overlay = document.createElement('div');
    overlay.id = id;
    overlay.className = `ppt-modal-overlay open ${className}`.trim();
    overlay.innerHTML = `
      <div class="ppt-modal">
        <div class="ppt-modal-header">
          <div class="ppt-modal-title">${titleHtml}</div>
          <button class="ppt-modal-close" aria-label="关闭" data-action="closeModal" data-modal-id="${escapeAttr(id)}">
            <iconify-icon icon="carbon:close"></iconify-icon>
          </button>
        </div>
        <div class="ppt-modal-body">${bodyHtml}</div>
        ${footerHtml ? `<div class="ppt-modal-footer">${footerHtml}</div>` : ''}
      </div>
    `;

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('open');
    });

    const host = getModalHost(this._ensureGenerator());
    host?.appendChild(overlay);

    const mergedActions = {
      closeModal: () => this._closeModalById(id),
      ...(actions && typeof actions === 'object' ? actions : {})
    };
    bindActionEvents(overlay, (action) => mergedActions[action] || null);

    try { onMount?.(overlay); } catch {
      // ignore
    }
    return overlay;
  }

  _closeModalById(id) {
    if (typeof document === 'undefined') return;
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('open');
    setTimeout(() => el.remove(), 280);
  }
}

export function createModalManager(options) {
  return new ModalManager(options);
}

export default ModalManager;
