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

function escapeCssSelector(value) {
  const s = typeof value === 'string' ? value : String(value ?? '');
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(s);
  return s.replace(/[^a-zA-Z0-9_-]/g, (m) => `\\${m}`);
}

function parseUnifiedDiffText(diffText) {
  const text = typeof diffText === 'string' ? diffText : '';
  if (!text) return { hunks: [] };

  const hunks = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let current = null;

  for (const raw of lines) {
    const line = typeof raw === 'string' ? raw : '';
    if (!line) continue;
    if (line.startsWith('--- ') || line.startsWith('+++ ')) continue;

    const header = line.match(/^@@ -(\d+),(\d+) \+(\d+),(\d+) @@/);
    if (header) {
      current = {
        aStart: Number(header[1]),
        aCount: Number(header[2]),
        bStart: Number(header[3]),
        bCount: Number(header[4]),
        lines: [],
      };
      hunks.push(current);
      continue;
    }

    if (!current) continue;
    const tag = line[0];
    if (tag === ' ' || tag === '-' || tag === '+') {
      current.lines.push({ tag, line: line.slice(1) });
    }
  }

  return { hunks };
}

function buildSideBySideRowsFromUnifiedHunk(hunk) {
  const rows = [];
  const lines = Array.isArray(hunk?.lines) ? hunk.lines : [];
  let aLineNo = Number(hunk?.aStart) || 1;
  let bLineNo = Number(hunk?.bStart) || 1;

  for (let i = 0; i < lines.length; i++) {
    const item = lines[i];
    const tag = item?.tag;
    const content = typeof item?.line === 'string' ? item.line : String(item?.line ?? '');

    if (tag === ' ') {
      rows.push({
        kind: 'context',
        old: { no: aLineNo, text: content },
        next: { no: bLineNo, text: content },
      });
      aLineNo += 1;
      bLineNo += 1;
      continue;
    }

    if (tag === '-' || tag === '+') {
      const deletes = [];
      const inserts = [];

      while (i < lines.length && lines[i]?.tag === '-') {
        const text = typeof lines[i]?.line === 'string' ? lines[i].line : String(lines[i]?.line ?? '');
        deletes.push({ no: aLineNo, text });
        aLineNo += 1;
        i += 1;
      }

      while (i < lines.length && lines[i]?.tag === '+') {
        const text = typeof lines[i]?.line === 'string' ? lines[i].line : String(lines[i]?.line ?? '');
        inserts.push({ no: bLineNo, text });
        bLineNo += 1;
        i += 1;
      }

      const max = Math.max(deletes.length, inserts.length);
      for (let j = 0; j < max; j++) {
        const del = deletes[j] || null;
        const ins = inserts[j] || null;
        const kind = del && ins ? 'modify' : (del ? 'delete' : 'add');
        rows.push({
          kind,
          old: del ? { no: del.no, text: del.text } : { no: null, text: '' },
          next: ins ? { no: ins.no, text: ins.text } : { no: null, text: '' },
        });
      }

      i -= 1;
      continue;
    }
  }

  return rows;
}

function renderSideBySideDiffHtml({ hunks, maxRows = 1800 } = {}) {
  const rowsLimit = Number.isFinite(maxRows) ? Math.max(50, Math.floor(maxRows)) : 1800;
  const list = Array.isArray(hunks) ? hunks : [];
  const parts = [];

  let renderedRows = 0;

  const headerStyle = [
    'padding: 8px 10px',
    'border-top: 1px solid rgba(148,163,184,0.25)',
    'border-bottom: 1px solid rgba(148,163,184,0.25)',
    'background: rgba(15,23,42,0.03)',
    'font-weight: 800',
    'font-size: 12px',
    'color: var(--ppt-text-main)',
    'font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace',
  ].join(';');

  const rowGridStyle = [
    'display: grid',
    'grid-template-columns: 56px 1fr 1px 56px 1fr',
    'gap: 0',
    'align-items: stretch',
    'font-size: 12px',
    'line-height: 1.45',
    'font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace',
  ].join(';');

  const numberCellStyle = [
    'padding: 2px 8px',
    'text-align: right',
    'user-select: none',
    'white-space: pre',
  ].join(';');

  const codeCellStyle = [
    'padding: 2px 8px',
    'white-space: pre-wrap',
    'word-break: break-word',
  ].join(';');

  const dividerStyle = 'background: rgba(148,163,184,0.25);';

  const safeLineNo = (no) => (Number.isFinite(no) && no > 0 ? String(no) : '');
  const safeText = (value) => (typeof value === 'string' ? value : String(value ?? ''));

  const legendStyle = [
    rowGridStyle,
    'border-bottom: 1px solid rgba(148,163,184,0.25)',
    'background: rgba(15,23,42,0.02)',
    'font-weight: 800',
    'color: var(--ppt-text-secondary)',
  ].join(';');

  parts.push(
    `<div style="${legendStyle}">` +
    `<div style="${numberCellStyle}">${escapeHtml('Ln')}</div>` +
    `<div style="${codeCellStyle}">${escapeHtml('Before')}</div>` +
    `<div style="${dividerStyle}"></div>` +
    `<div style="${numberCellStyle}">${escapeHtml('Ln')}</div>` +
    `<div style="${codeCellStyle}">${escapeHtml('After')}</div>` +
    `</div>`
  );

  for (const hunk of list) {
    if (renderedRows >= rowsLimit) break;
    const aStart = Number.isFinite(Number(hunk?.aStart)) ? Number(hunk.aStart) : 0;
    const aCount = Number.isFinite(Number(hunk?.aCount)) ? Number(hunk.aCount) : 0;
    const bStart = Number.isFinite(Number(hunk?.bStart)) ? Number(hunk.bStart) : 0;
    const bCount = Number.isFinite(Number(hunk?.bCount)) ? Number(hunk.bCount) : 0;
    const header = `@@ -${aStart},${aCount} +${bStart},${bCount} @@`;

    parts.push(`<div style="${headerStyle}">${escapeHtml(header)}</div>`);

    const rows = buildSideBySideRowsFromUnifiedHunk(hunk);
    for (const row of rows) {
      if (renderedRows >= rowsLimit) break;
      renderedRows += 1;

      const kind = row?.kind;
      const oldNo = safeLineNo(row?.old?.no);
      const newNo = safeLineNo(row?.next?.no);
      const oldText = safeText(row?.old?.text);
      const newText = safeText(row?.next?.text);

      const oldBg = kind === 'delete' || kind === 'modify' ? 'rgba(248,113,113,0.10)' : 'transparent';
      const newBg = kind === 'add' || kind === 'modify' ? 'rgba(34,197,94,0.10)' : 'transparent';

      const oldNumColor = kind === 'delete' || kind === 'modify'
        ? '#ef4444'
        : (oldNo ? 'rgba(100,116,139,0.9)' : 'rgba(148,163,184,0.6)');
      const newNumColor = kind === 'add' || kind === 'modify'
        ? '#22c55e'
        : (newNo ? 'rgba(100,116,139,0.9)' : 'rgba(148,163,184,0.6)');

      parts.push(
        `<div style="${rowGridStyle}">` +
        `<div style="${numberCellStyle} color:${oldNumColor};">${escapeHtml(oldNo)}</div>` +
        `<div style="${codeCellStyle} background:${oldBg};">${escapeHtml(oldText)}</div>` +
        `<div style="${dividerStyle}"></div>` +
        `<div style="${numberCellStyle} color:${newNumColor};">${escapeHtml(newNo)}</div>` +
        `<div style="${codeCellStyle} background:${newBg};">${escapeHtml(newText)}</div>` +
        `</div>`
      );
    }
  }

  if (renderedRows >= rowsLimit) {
    parts.push(`<div style="padding:10px; font-size: 12px; color: var(--ppt-text-secondary);">...(truncated)</div>`);
  }

  return parts.join('');
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
    this._briefingFormTimer = null;
    this._pasteDocumentModalTimer = null;
    this._pasteDocumentModalKeyHandler = null;
    this._subscriptions = [];

    // Policy/Approval queue (agent -> UI)
    this._pendingPolicyApprovals = [];
    this._activePolicyApproval = null;
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
        openArtifactsBrowser: generator.openArtifactsBrowser,
        openPlansManager: generator.openPlansManager,
        openPolicyRulesManager: generator.openPolicyRulesManager,
        openSkillsManager: generator.openSkillsManager,
        openApprovalsModal: generator.openApprovalsModal,
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
    generator.openBriefingModal = (...args) => this.openBriefingModal(...args);
    generator.openArtifactsBrowser = (...args) => this.openArtifactsBrowser(...args);
    generator.openPlansManager = (...args) => this.openPlansManager(...args);
    generator.openPolicyRulesManager = (...args) => this.openPolicyRulesManager(...args);
    generator.openSkillsManager = (...args) => this.openSkillsManager(...args);
    generator.openApprovalsModal = (...args) => this.openApprovalsModal(...args);
    generator.confirmDialog = (...args) => this.confirmDialog(...args);
  }

  openBriefingModal() {
    const generator = this._ensureGenerator();
    if (!generator || typeof document === 'undefined') return;

    const modalId = 'pptBriefingModal';
    const existing = document.getElementById(modalId);
    if (existing) existing.remove();

    const brief = this.stateStore.get('data.projectBrief') || {};
    const taskGoal = typeof brief.taskGoal === 'string' ? brief.taskGoal : '';
    const projectSummary = typeof brief.projectSummary === 'string' ? brief.projectSummary : '';
    const audience = typeof brief.audience === 'string' ? brief.audience : '';
    const tone = typeof brief.tone === 'string' ? brief.tone : '';
    const workflowMode = this.stateStore.get('data.workflowMode') || 'auto';
    const modeLabel = workflowMode === 'auto'
      ? 'Auto-pilot'
      : (workflowMode === 'guided' ? 'Guided' : 'Manual');

    const overlay = document.createElement('div');
    overlay.id = modalId;
    overlay.className = 'ppt-modal-overlay open';
    overlay.innerHTML = `
      <div class="ppt-modal" style="width: min(800px, 95vw); max-height: 90vh; display: flex; flex-direction: column; border-radius: 24px; overflow: hidden; border: 1px solid rgba(0,0,0,0.1); box-shadow: 0 20px 50px -12px rgba(0,0,0,0.15);">
        <div class="ppt-modal-header" style="padding: 20px 24px; background: #fff; border-bottom: 1px solid rgba(0,0,0,0.05);">
          <div class="ppt-modal-title" style="display: flex; align-items: center; gap: 10px; font-size: 18px; font-weight: 750; color: var(--ppt-text-main);">
            <div style="width: 36px; height: 36px; border-radius: 10px; background: rgba(79, 70, 229, 0.08); color: var(--ppt-primary); display: flex; align-items: center; justify-content: center; font-size: 20px;">
              <iconify-icon icon="solar:target-bold-duotone"></iconify-icon>
            </div>
            <span>项目需求配置</span>
          </div>
          <button class="ppt-modal-close" data-action="closeBriefingModal" style="width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; transition: all 0.2s; border: none; background: transparent; cursor: pointer; color: var(--ppt-text-muted);">
            <iconify-icon icon="solar:close-circle-linear" style="font-size: 22px;"></iconify-icon>
          </button>
        </div>
        <div class="ppt-modal-body custom-scrollbar" style="flex: 1; padding: 28px 32px; overflow-y: auto; background: #fcfcfd;">
          <div style="margin-bottom: 24px; padding: 12px 16px; background: rgba(79, 70, 229, 0.04); border-radius: 12px; border: 1px solid rgba(79, 70, 229, 0.08); font-size: 13px; color: var(--ppt-primary); display: flex; align-items: center; gap: 10px;">
            <iconify-icon icon="solar:info-circle-bold-duotone" style="font-size: 18px;"></iconify-icon>
            <span>用于约束 DeepSearch 与 PPT 生成方向（当前模式：<strong>${modeLabel}</strong>）。</span>
          </div>

          <div class="form-group" style="margin-bottom: 24px; background: transparent; border: none; padding: 0; box-shadow: none;">
            <label style="display: block; font-size: 14px; font-weight: 700; color: var(--ppt-text-main); margin-bottom: 10px; display: flex; align-items: center; gap: 6px;">
              <span style="width: 6px; height: 6px; border-radius: 50%; background: var(--ppt-primary);"></span>
              1. 任务目标
              <span style="font-weight: 500; font-size: 11px; color: #ef4444; background: #fef2f2; padding: 1px 6px; border-radius: 4px; margin-left: 4px;">必填</span>
            </label>
            <input id="pptBriefTaskGoal" type="text" class="ppt-input-field" 
              style="width: 100%; height: 46px; padding: 0 16px; border-radius: 12px; border: 1.5px solid var(--ppt-border); font-size: 14px; transition: all 0.2s; box-shadow: none;" 
              placeholder="例如：生成一份面向高管的市场分析汇报，突出竞争格局与关键指标" value="${escapeAttr(taskGoal)}">
          </div>

          <div class="form-group" style="margin-bottom: 24px; background: transparent; border: none; padding: 0; box-shadow: none;">
            <label style="display: block; font-size: 14px; font-weight: 700; color: var(--ppt-text-main); margin-bottom: 10px; display: flex; align-items: center; gap: 6px;">
              <span style="width: 6px; height: 6px; border-radius: 50%; background: #94a3b8;"></span>
              2. 侧重点 / 项目摘要
            </label>
            <textarea id="pptBriefProjectSummary" class="ppt-input-field" 
              style="width: 100%; min-height: 140px; padding: 14px 16px; border-radius: 12px; border: 1.5px solid var(--ppt-border); font-size: 14px; line-height: 1.6; transition: all 0.2s; resize: vertical; box-shadow: none;" 
              placeholder="希望重点关注哪些结论、证据、结构或风格？">${escapeHtml(projectSummary)}</textarea>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
            <div class="form-group" style="background: transparent; border: none; padding: 0; box-shadow: none;">
              <label style="display: block; font-size: 14px; font-weight: 700; color: var(--ppt-text-main); margin-bottom: 10px; display: flex; align-items: center; gap: 6px;">
                <span style="width: 6px; height: 6px; border-radius: 50%; background: #94a3b8;"></span>
                3. 受众（可选）
              </label>
              <input id="pptBriefAudience" type="text" class="ppt-input-field" 
                style="width: 100%; height: 42px; padding: 0 14px; border-radius: 10px; border: 1.5px solid var(--ppt-border); font-size: 13.5px; box-shadow: none;" 
                placeholder="例如：非技术高管 / 技术团队" value="${escapeAttr(audience)}">
            </div>
            <div class="form-group" style="background: transparent; border: none; padding: 0; box-shadow: none;">
              <label style="display: block; font-size: 14px; font-weight: 700; color: var(--ppt-text-main); margin-bottom: 10px; display: flex; align-items: center; gap: 6px;">
                <span style="width: 6px; height: 6px; border-radius: 50%; background: #94a3b8;"></span>
                4. 语气（可选）
              </label>
              <input id="pptBriefTone" type="text" class="ppt-input-field" 
                style="width: 100%; height: 42px; padding: 0 14px; border-radius: 10px; border: 1.5px solid var(--ppt-border); font-size: 13.5px; box-shadow: none;" 
                placeholder="例如：商务严谨 / 科技感" value="${escapeAttr(tone)}">
            </div>
          </div>
        </div>
        <div class="ppt-modal-footer" style="padding: 18px 24px; background: #fff; border-top: 1px solid rgba(0,0,0,0.05); display: flex; justify-content: flex-end; gap: 12px;">
          <button class="rd-btn rd-btn-ghost" data-action="closeBriefingModal" type="button" style="padding: 10px 20px;">取消</button>
          <button class="rd-btn rd-btn-primary" data-action="submitBriefingModal" type="button" style="padding: 10px 24px; border-radius: 12px; gap: 8px;">
            <span>保存修改</span>
            <iconify-icon icon="solar:check-read-linear" style="font-size: 18px;"></iconify-icon>
          </button>
        </div>
      </div>
    `;

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.closeBriefingModal();
    });

    const host = getModalHost(generator);
    host?.appendChild(overlay);

    this._briefingFormTimer = setTimeout(() => {
      document.getElementById('pptBriefTaskGoal')?.focus();
    }, 100);

    bindActionEvents(overlay, (action) => {
      switch (action) {
        case 'closeBriefingModal':
          return () => this.closeBriefingModal();
        case 'submitBriefingModal':
          return () => this.submitBriefingModal();
        default:
          return null;
      }
    });
  }

  closeBriefingModal() {
    if (this._briefingFormTimer) {
      clearTimeout(this._briefingFormTimer);
      this._briefingFormTimer = null;
    }
    const modal = document.getElementById('pptBriefingModal');
    if (modal) {
      modal.classList.remove('open');
      setTimeout(() => modal.remove(), 300);
    }
  }

  submitBriefingModal() {
    const taskGoal = document.getElementById('pptBriefTaskGoal')?.value?.trim() || '';
    if (!taskGoal) {
      alert('请填写「任务目标」(taskGoal)，否则无法开始。');
      return;
    }

    const projectSummary = document.getElementById('pptBriefProjectSummary')?.value?.trim() || '';
    const audience = document.getElementById('pptBriefAudience')?.value?.trim() || '';
    const tone = document.getElementById('pptBriefTone')?.value?.trim() || '';

    const brief = { taskGoal, projectSummary, audience, tone };
    
    this.stateStore.set('data.projectBrief', brief);
    this.stateStore.set('data.taskGoal', brief.taskGoal || '');
    this.adapter?.setProjectBrief?.(brief);

    this.closeBriefingModal();
    
    // If we were pending start, trigger it
    if (this.stateStore.get('ui.pendingStart')) {
      this.stateStore.set('ui.pendingStart', false);
      this.adapter?.startWorkflow?.({ skipBriefCheck: true });
    }
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
	            <button class="ppt-history-tab" data-tab="runs">
	              <iconify-icon icon="solar:server-square-bold-duotone"></iconify-icon>
	              Runs
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
	            <div class="ppt-history-panel" data-panel="runs">
	              <div class="ppt-history-list" id="pptHistoryRunsList">
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
		                    <button class="ppt-btn ppt-btn-secondary" data-action="openArtifactsBrowser">
		                        <iconify-icon icon="solar:box-bold-duotone"></iconify-icon>
		                        Artifacts
		                    </button>
		                    <button class="ppt-btn ppt-btn-secondary" data-action="openPlansManager">
		                        <iconify-icon icon="solar:clipboard-list-bold-duotone"></iconify-icon>
		                        Plans
	                    </button>
	                    <button class="ppt-btn ppt-btn-secondary" data-action="openPolicyRulesManager">
	                        <iconify-icon icon="solar:shield-check-bold-duotone"></iconify-icon>
	                        Policy
	                    </button>
	                    <button class="ppt-btn ppt-btn-secondary" data-action="openSkillsManager">
	                        <iconify-icon icon="solar:book-2-bold-duotone"></iconify-icon>
		                        Skills
		                    </button>
	                    <button class="ppt-btn ppt-btn-secondary" data-action="exportCurrentRunZip">
	                        <iconify-icon icon="solar:download-minimalistic-bold-duotone"></iconify-icon>
	                        导出 Run
	                    </button>
	                    <button class="ppt-btn ppt-btn-secondary" data-action="editSelectedRunMeta" id="pptHistoryEditRunBtn" disabled>
	                        <iconify-icon icon="solar:pen-new-square-bold-duotone"></iconify-icon>
	                        编辑 Run
	                    </button>
	                    <button class="ppt-btn ppt-btn-secondary" data-action="importRunZip">
	                        <iconify-icon icon="solar:upload-minimalistic-bold-duotone"></iconify-icon>
	                        导入 Run Zip
	                    </button>
	                    <button class="ppt-btn ppt-btn-secondary" data-action="deleteSelectedRun" id="pptHistoryDeleteRunBtn" disabled>
	                        <iconify-icon icon="solar:trash-bin-trash-bold-duotone"></iconify-icon>
	                        删除 Run
	                    </button>
	                    <button class="ppt-btn ppt-btn-primary" id="pptHistoryImportBtn" disabled>
	                        打开选中项
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
	        if (action === 'exportCurrentRunZip') {
	          return () => this.exportCurrentRunZip({ runId: this._getSelectedRunIdFromHistorySelection?.() || null });
	        }
	        if (action === 'editSelectedRunMeta') {
	          return () => void this.editSelectedRunMeta();
	        }
	        if (action === 'importRunZip') {
	          return () => this.importRunZip();
	        }
	        if (action === 'deleteSelectedRun') {
	          return () => void this.deleteSelectedRun();
	        }
		        if (action === 'openArtifactsBrowser') {
		          return () => this.openArtifactsBrowser({ runId: this._getSelectedRunIdFromHistorySelection?.() || undefined });
		        }
		        if (action === 'openPlansManager') {
		          return () => this.openPlansManager({ runId: this._getSelectedRunIdFromHistorySelection?.() || undefined });
		        }
	        if (action === 'openPolicyRulesManager') {
	          return () => this.openPolicyRulesManager();
	        }
	        if (action === 'openSkillsManager') {
	          return () => this.openSkillsManager();
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
	      void this._importSelectedHistoryItems();
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
	    this._syncHistoryRunActionButtons?.();

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

	    const runsListEl = document.getElementById('pptHistoryRunsList');
	    try {
	      const generator = this._ensureGenerator();
	      const runs = generator && typeof generator.listRuns === 'function' ? await generator.listRuns() : [];
	      if (runsListEl) {
	        if (!runs || runs.length === 0) {
	          runsListEl.innerHTML = '<div class="ppt-history-empty"><iconify-icon icon="solar:folder-open-linear" style="font-size:32px;margin-bottom:8px;display:block;"></iconify-icon>暂无 Runs</div>';
	        } else {
	          const sorted = runs
	            .slice()
	            .sort((a, b) => String(b?.createdAt || b?.startedAt || '').localeCompare(String(a?.createdAt || a?.startedAt || '')));
	          runsListEl.innerHTML = sorted.map((run) => this._renderHistoryItem(run, 'run')).join('');
	        }
	      }
	    } catch {
	      if (runsListEl) runsListEl.innerHTML = '<div class="ppt-history-empty">加载失败</div>';
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
	        this._syncHistoryRunActionButtons?.();
	      });
	    });
	  }

	  _syncHistoryRunActionButtons() {
	    if (typeof document === 'undefined') return;
	    const runId = this._getSelectedRunIdFromHistorySelection?.();
	    const editBtn = document.getElementById('pptHistoryEditRunBtn');
	    const delBtn = document.getElementById('pptHistoryDeleteRunBtn');
	    const enabled = !!runId;
	    if (editBtn) editBtn.disabled = !enabled;
	    if (delBtn) delBtn.disabled = !enabled;
	  }

	  async exportCurrentRunZip({ runId } = {}) {
	    const generator = this._ensureGenerator();
	    if (!generator) return;

	    if (typeof generator.downloadRunZip !== 'function') {
	      alert('当前环境不支持 Run 导出（downloadRunZip 不可用）。');
	      return;
	    }

	    try {
	      await generator.downloadRunZip(typeof runId === 'string' && runId.trim() ? runId.trim() : undefined);
	    } catch (err) {
	      const msg = err instanceof Error ? err.message : String(err);
	      alert(`Run 导出失败: ${msg}`);
	    }
	  }

	  async importRunZip() {
    const generator = this._ensureGenerator();
    if (!generator) return;

    if (typeof generator.importRunZip !== 'function') {
      alert('当前环境不支持 Run 导入（importRunZip 不可用）。');
      return;
    }

    if (typeof document === 'undefined') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip,application/zip';
    input.style.display = 'none';
    document.body.appendChild(input);

    const cleanup = () => {
      try { input.remove(); } catch { /* ignore */ }
    };

    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      cleanup();
      if (!file) return;
      try {
        const runId = await generator.importRunZip(file, { overwrite: true });
        alert(`Run 导入成功: ${runId}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        alert(`Run 导入失败: ${msg}`);
      }
    }, { once: true });

    input.click();
  }

  async editSelectedRunMeta() {
    const generator = this._ensureGenerator();
    if (!generator) return;
    const runId = this._getSelectedRunIdFromHistorySelection?.();
    if (!runId) {
      alert('请先在 Runs 列表中选中一个 Run。');
      return;
    }

    if (typeof generator.getRunContext !== 'function' || typeof generator.updateRunContext !== 'function') {
      alert('当前环境不支持编辑 Run（缺少 RunStore 接口）。');
      return;
    }

    let run = null;
    try {
      run = await generator.getRunContext(runId);
    } catch {
      run = null;
    }
    const title = typeof run?.title === 'string' ? run.title : (typeof run?.taskGoal === 'string' ? run.taskGoal : '');
    const tags = Array.isArray(run?.tags) ? run.tags : [];
    const tagsText = tags.filter((t) => typeof t === 'string' && t.trim()).join(', ');

    const modalId = `pptRunMetaEditor_${runId}`;
    const titleInputId = `${modalId}_title`;
    const tagsInputId = `${modalId}_tags`;

    this._openOrCreateModal({
      id: modalId,
      className: 'ppt-run-meta-editor-modal',
      titleHtml: `
        <iconify-icon icon="solar:pen-new-square-bold-duotone"></iconify-icon>
        <span>编辑 Run</span>
      `,
      bodyHtml: `
        <div style="display:flex; flex-direction:column; gap:12px;">
          <div style="font-size:12px; color: var(--ppt-text-secondary);">Run ID: <code>${escapeHtml(runId)}</code></div>
          <div>
            <div style="font-size:12px; color: var(--ppt-text-secondary); margin-bottom:6px;">标题</div>
            <input id="${escapeAttr(titleInputId)}" class="ppt-input" style="width:100%;" value="${escapeAttr(title || '')}" placeholder="可选：为这个 run 取个名字" />
          </div>
          <div>
            <div style="font-size:12px; color: var(--ppt-text-secondary); margin-bottom:6px;">标签（逗号分隔）</div>
            <input id="${escapeAttr(tagsInputId)}" class="ppt-input" style="width:100%;" value="${escapeAttr(tagsText)}" placeholder="例如：research, v2, demo" />
          </div>
        </div>
      `,
      footerHtml: `
        <button class="ppt-btn ppt-btn-secondary" data-action="closeRunMetaEditor">取消</button>
        <button class="ppt-btn ppt-btn-primary" data-action="saveRunMetaEditor">保存</button>
      `,
      actions: {
        closeRunMetaEditor: () => this._closeModalById(modalId),
        saveRunMetaEditor: async () => {
          const titleEl = typeof document !== 'undefined' ? document.getElementById(titleInputId) : null;
          const tagsEl = typeof document !== 'undefined' ? document.getElementById(tagsInputId) : null;
          const nextTitle = typeof titleEl?.value === 'string' ? titleEl.value.trim() : '';
          const rawTags = typeof tagsEl?.value === 'string' ? tagsEl.value : '';
          const nextTags = rawTags
            .split(/[,，]/g)
            .map((t) => String(t || '').trim().replace(/^#/, ''))
            .filter(Boolean);
          const uniq = [];
          const seen = new Set();
          for (const t of nextTags) {
            const key = t.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            uniq.push(t);
          }

          try {
            await generator.updateRunContext(runId, {
              title: nextTitle || null,
              tags: uniq,
              updatedAt: new Date().toISOString(),
            });
            this._closeModalById(modalId);
            await this._loadHistoryData();
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            alert(`Run 更新失败: ${msg}`);
          }
        }
      },
    });
  }

  async deleteSelectedRun() {
    const generator = this._ensureGenerator();
    if (!generator) return;
    const runId = this._getSelectedRunIdFromHistorySelection?.();
    if (!runId) {
      alert('请先在 Runs 列表中选中一个 Run。');
      return;
    }

    if (typeof generator.deleteRun !== 'function') {
      alert('当前环境不支持删除 Run（缺少 RunStore 接口）。');
      return;
    }

    const ok = await this.confirmDialog({
      title: '删除 Run',
      message: `确定删除这个 Run 吗？\n\n${runId}\n\n（将删除 events + artifacts，无法撤销）`,
      confirmText: '删除',
      cancelText: '取消'
    });
    if (!ok) return;

    try {
      await generator.deleteRun(runId);
      this._historySelected.delete(`run:${runId}`);
      this._syncHistoryRunActionButtons?.();
      await this._loadHistoryData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`Run 删除失败: ${msg}`);
    }
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
	    const key =
	      type === 'checkpoint'
	        ? `cp:${item.storageKey}`
	        : type === 'run'
	          ? `run:${item.runId}`
	          : `doc:${item.id}`;
	    const title =
	      type === 'checkpoint'
	        ? escapeHtml(item.title || '未命名项目')
	        : type === 'run'
	          ? escapeHtml(item.title || item.taskGoal || item.runId || 'Run')
	          : escapeHtml(item.name || '未命名文档');
	    const time =
	      type === 'checkpoint'
	        ? item.timestamp
	        : type === 'run'
	          ? (item.createdAt || item.startedAt)
	          : item.time;
	    const timeStr = time ? new Date(time).toLocaleString() : '';
	    const badge =
	      type === 'checkpoint'
	        ? (item.stage || 'unknown').replace('deepsearch.', '').replace('design.', '')
	        : type === 'run'
	          ? (item.mode || 'run')
	          : (item.type || 'document');
	    const meta = (() => {
	      if (type !== 'run') return '';
	      const scenario = typeof item.scenario === 'string' ? item.scenario : '';
	      const id = typeof item.runId === 'string' ? item.runId : '';
	      const rawTags = Array.isArray(item.tags) ? item.tags : [];
	      const tags = rawTags
	        .map((t) => (typeof t === 'string' ? t.trim().replace(/^#/, '') : ''))
	        .filter(Boolean)
	        .slice(0, 6);
	      const tagStr = tags.length ? ` · ${tags.map((t) => `#${t}`).join(' ')}` : '';
	      return `${escapeHtml(String(scenario || ''))}${scenario ? ' · ' : ''}${escapeHtml(String(id || ''))}${escapeHtml(tagStr)}`;
	    })();

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
	            ${meta ? `<span style="color:var(--ppt-text-secondary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${meta}</span>` : ''}
	          </div>
	        </div>
	      </div>
	    `;
	  }

	  _getSelectedRunIdFromHistorySelection() {
	    if (!this._historySelected || this._historySelected.size !== 1) return null;
	    const only = Array.from(this._historySelected)[0];
	    const [kind, id] = String(only || '').split(':');
	    if (kind !== 'run') return null;
	    return id || null;
	  }

	  async _importSelectedHistoryItems() {
	    const data = this._ensureWorkflowData();
	    if (!Array.isArray(data.files)) data.files = [];

	    for (const key of this._historySelected) {
	      const [type, id] = String(key).split(':');
	      if (type === 'run') {
	        const generator = this._ensureGenerator();
	        const runId = String(id || '').trim();
	        if (!runId) continue;
	        try {
	          if (typeof generator?.startReplay === 'function') {
	            await generator.startReplay(runId, {});
	          }
	        } catch {
	          // ignore
	        }
	        continue;
	      }
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
	        case 'openArtifactsBrowser':
	          this.openArtifactsBrowser(payload);
	          break;
	        case 'openPlansManager':
	          this.openPlansManager(payload);
	          break;
	        case 'openPolicyRulesManager':
	          this.openPolicyRulesManager(payload);
	          break;
	        case 'openSkillsManager':
	          this.openSkillsManager(payload);
	          break;
		        case 'openApprovalsModal':
		          this.openApprovalsModal(payload);
	          break;
	        case 'undoLastVfsCheckpoint':
	          void this.undoLastVfsCheckpoint(payload);
	          break;
	        case 'startReplay':
	          void this.startReplay(payload);
	          break;
	        case 'resumeWorkflowFromPlan':
	          void this.resumeWorkflowFromPlan(payload);
	          break;
	        default:
	          break;
	      }
	    });
	    this._subscriptions.push(off);

    // Agent -> UI Policy approval prompt
    this._subscriptions.push(this.eventBus.on('policy.approval.requested', (_name, payload) => {
      this._enqueuePolicyApproval(payload);
    }));
  }

  _getAgentEventBus() {
    const generator = this._ensureGenerator();
    return generator?._orchestrator?.eventBus || null;
  }

  _enqueuePolicyApproval(payload) {
    const req = payload && typeof payload === 'object' ? payload : {};
    const requestId = typeof req.requestId === 'string' ? req.requestId.trim() : '';
    if (!requestId) return;

    const isSame = (r) => typeof r?.requestId === 'string' && r.requestId === requestId;
    if (this._activePolicyApproval && isSame(this._activePolicyApproval)) return;
    if (this._pendingPolicyApprovals.some(isSame)) return;

    this._pendingPolicyApprovals.push(req);
    if (!this._activePolicyApproval) this._activePolicyApproval = this._pendingPolicyApprovals.shift() || null;

    // Auto-open modal
    this.openApprovalsModal();
  }

  _renderPolicyApprovalBody(req) {
    const type = escapeHtml(req?.type || 'unknown');
    const tool = escapeHtml(req?.tool || '');
    const resource = escapeHtml(req?.resource || '');
    const argsSummary = req?.argsSummary ? escapeHtml(JSON.stringify(req.argsSummary, null, 2)) : '';
    const id = escapeHtml(req?.requestId || '');
    return `
      <div style="display:flex; flex-direction:column; gap:12px;">
        <div style="font-size:12px; color: var(--ppt-text-secondary);">Request ID: <code>${id}</code></div>
        <div style="display:grid; grid-template-columns: 110px 1fr; gap: 8px 12px; font-size: 13px;">
          <div style="color: var(--ppt-text-secondary);">Type</div><div><code>${type}</code></div>
          ${tool ? `<div style="color: var(--ppt-text-secondary);">Tool</div><div><code>${tool}</code></div>` : ''}
          ${resource ? `<div style="color: var(--ppt-text-secondary);">Resource</div><div><code>${resource}</code></div>` : ''}
        </div>
        ${argsSummary ? `
          <div>
            <div style="font-size:12px; color: var(--ppt-text-secondary); margin-bottom:6px;">Args Summary</div>
            <pre class="custom-scrollbar" style="max-height: 240px; overflow:auto; background: rgba(15,23,42,0.04); border:1px solid rgba(148,163,184,0.25); padding:10px; border-radius: 12px; font-size: 12px; line-height: 1.4;">${argsSummary}</pre>
          </div>
        ` : ''}
      </div>
    `;
  }

  _refreshApprovalsModal() {
    if (typeof document === 'undefined') return;
    const overlay = document.getElementById('pptPolicyApprovalModal');
    if (!overlay) return;
    const req = this._activePolicyApproval;
    if (!req) {
      overlay.classList.remove('open');
      setTimeout(() => overlay.remove(), 280);
      return;
    }
    overlay.querySelector('.ppt-modal-body')?.replaceChildren();
    const body = overlay.querySelector('.ppt-modal-body');
    if (body) body.innerHTML = this._renderPolicyApprovalBody(req);
  }

  _respondPolicyApproval({ requestId, decision, remember }) {
    const id = typeof requestId === 'string' ? requestId.trim() : '';
    if (!id) return;
    const bus = this._getAgentEventBus();
    if (bus && typeof bus.emit === 'function') {
      bus.emit('policy.approval.response', { requestId: id, decision, remember });
    }

    // Advance queue
    this._activePolicyApproval = null;
    this._activePolicyApproval = this._pendingPolicyApprovals.shift() || null;
    this._refreshApprovalsModal();
  }

  openApprovalsModal() {
    const req = this._activePolicyApproval || this._pendingPolicyApprovals[0] || null;
    if (!req) return;

    const modalId = 'pptPolicyApprovalModal';
    const overlay = this._openOrCreateModal({
      id: modalId,
      className: 'ppt-policy-approval-modal',
      titleHtml: `
        <iconify-icon icon="solar:shield-keyhole-bold-duotone"></iconify-icon>
        <span>需要授权</span>
      `,
      bodyHtml: this._renderPolicyApprovalBody(req),
      footerHtml: `
        <button class="ppt-btn ppt-btn-secondary" data-action="policyDeny">拒绝</button>
        <button class="ppt-btn ppt-btn-secondary" data-action="policyAllowOnce">允许一次</button>
        <button class="ppt-btn ppt-btn-primary" data-action="policyAllowAlways">始终允许</button>
      `,
      onMount: (el) => {
        el.classList.add('open');
      },
      actions: {
        policyDeny: () => this._respondPolicyApproval({ requestId: this._activePolicyApproval?.requestId || req.requestId, decision: 'deny', remember: 'none' }),
        policyAllowOnce: () => this._respondPolicyApproval({ requestId: this._activePolicyApproval?.requestId || req.requestId, decision: 'allow', remember: 'none' }),
        policyAllowAlways: () => this._respondPolicyApproval({ requestId: this._activePolicyApproval?.requestId || req.requestId, decision: 'allow', remember: 'always' }),
      },
    });

    if (overlay) {
      this._activePolicyApproval = req;
      this._refreshApprovalsModal();
    }
  }

	  async openArtifactsBrowser({ runId } = {}) {
	    const generator = this._ensureGenerator();
	    const store = generator?._runStore;
	    const id = typeof runId === 'string' && runId.trim()
	      ? runId.trim()
	      : (typeof generator?._currentRunId === 'string' ? generator._currentRunId : null);

    const modalId = 'pptArtifactsBrowserModal';
    const overlay = this._openOrCreateModal({
      id: modalId,
      className: 'ppt-artifacts-browser-modal',
      titleHtml: `
        <iconify-icon icon="solar:box-bold-duotone"></iconify-icon>
        <span>Run Artifacts</span>
      `,
      bodyHtml: `<div class="ppt-history-loading"><iconify-icon icon="svg-spinners:180-ring"></iconify-icon> 加载中...</div>`,
      footerHtml: `
        <button class="ppt-btn ppt-btn-secondary" data-action="refreshArtifacts">刷新</button>
        <button class="ppt-btn ppt-btn-secondary" data-action="closeModal" data-modal-id="${escapeAttr(modalId)}">关闭</button>
      `,
      actions: {
        refreshArtifacts: () => this.openArtifactsBrowser({ runId: id }),
        selectArtifact: ({ payload }) => this._selectArtifact?.(modalId, payload?.artifactId),
        restoreVfsCheckpoint: ({ payload }) => this._restoreVfsCheckpoint?.(modalId, payload?.artifactId),
      },
    });

    if (!overlay) return;

    if (!store || !id) {
      overlay.querySelector('.ppt-modal-body').innerHTML = `<div style="padding:12px;color:var(--ppt-text-secondary);">RunStore 或 runId 不可用，无法浏览 artifacts。</div>`;
      return;
    }

    let artifacts = [];
    try {
      artifacts = await store.listArtifacts(id);
    } catch {
      artifacts = [];
    }

    // Synthetic events.jsonl entry (always available via getArtifact)
    artifacts.push({
      artifactId: `art_${id}_events.jsonl_001`,
      runId: id,
      type: 'events.jsonl',
      seq: 0,
      createdAt: '',
      mime: 'application/x-ndjson',
      bytes: null,
      sha256: null,
      storageKey: `runs/${id}/events.jsonl`,
      synthetic: true,
    });

    artifacts = artifacts
      .filter((a) => a && typeof a === 'object' && typeof a.type === 'string')
      .sort((a, b) => String(a.type).localeCompare(String(b.type)) || (Number(a.seq || 0) - Number(b.seq || 0)));

    const stateKey = `__artifacts_${modalId}`;
    this[stateKey] = {
      runId: id,
      artifacts,
      selected: this[stateKey]?.selected || artifacts[0]?.artifactId || null,
    };

    const renderListItem = (a) => {
      const selected = a.artifactId === this[stateKey].selected ? 'style="background: rgba(79,70,229,0.10); border-color: rgba(79,70,229,0.35);"' : '';
      const bytes = typeof a.bytes === 'number' ? formatSize(a.bytes) : '';
      const sha = typeof a.sha256 === 'string' && a.sha256 ? a.sha256.slice(0, 8) : '';
      return `
        <button class="ppt-btn ppt-btn-secondary" data-action="selectArtifact" data-artifact-id="${escapeAttr(a.artifactId)}" ${selected}
          style="width:100%; text-align:left; justify-content:flex-start; gap:10px; padding:10px 12px; border-radius: 12px; display:flex; flex-direction:column; align-items:flex-start;">
          <div style="display:flex; width:100%; align-items:center; justify-content:space-between; gap:8px;">
            <div style="font-weight:700; font-size: 13px; color: var(--ppt-text-main);">${escapeHtml(a.type)}</div>
            <div style="font-size: 12px; color: var(--ppt-text-secondary);">${bytes}</div>
          </div>
          <div style="font-size: 12px; color: var(--ppt-text-secondary);">
            <code>${escapeHtml(a.artifactId)}</code>${sha ? ` · <code>${escapeHtml(sha)}</code>` : ''}
          </div>
        </button>
      `;
    };

    overlay.querySelector('.ppt-modal-body').innerHTML = `
      <div style="display:grid; grid-template-columns: 320px 1fr; gap: 12px; min-height: 420px;">
        <div class="custom-scrollbar" style="overflow:auto; max-height: 70vh; padding-right: 4px;">
          ${artifacts.map(renderListItem).join('')}
        </div>
        <div id="${escapeAttr(modalId)}_preview" class="custom-scrollbar" style="overflow:auto; max-height: 70vh; border: 1px solid rgba(148,163,184,0.25); border-radius: 14px; padding: 12px; background: rgba(15,23,42,0.02);">
          <div style="color: var(--ppt-text-secondary); font-size: 12px;">选择一个 artifact 以预览</div>
        </div>
      </div>
    `;

	    await this._selectArtifact(modalId, this[stateKey].selected);
	  }

		  async openPlansManager({ runId } = {}) {
		    const generator = this._ensureGenerator();
		    const store = generator?._runStore;
		    const id = typeof runId === 'string' && runId.trim()
		      ? runId.trim()
		      : (typeof generator?._currentRunId === 'string' ? generator._currentRunId : null);

	    const modalId = 'pptPlansManagerModal';
	    const overlay = this._openOrCreateModal({
	      id: modalId,
	      className: 'ppt-plans-manager-modal',
	      titleHtml: `
	        <iconify-icon icon="solar:clipboard-list-bold-duotone"></iconify-icon>
	        <span>Plans</span>
	      `,
	      bodyHtml: `<div class="ppt-history-loading"><iconify-icon icon="svg-spinners:180-ring"></iconify-icon> 加载中...</div>`,
	      footerHtml: `
	        <button class="ppt-btn ppt-btn-primary" data-action="resumeSelectedPlan">继续执行</button>
	        <button class="ppt-btn ppt-btn-secondary" data-action="restoreSelectedPlan">仅恢复</button>
	        <button class="ppt-btn ppt-btn-secondary" data-action="refreshPlans">刷新</button>
	        <button class="ppt-btn ppt-btn-secondary" data-action="openArtifactsBrowser">打开 Artifacts</button>
	        <button class="ppt-btn ppt-btn-secondary" data-action="closeModal" data-modal-id="${escapeAttr(modalId)}">关闭</button>
	      `,
	      actions: {
	        restoreSelectedPlan: () => this._restorePlanArtifact?.(modalId, this[`__plans_${modalId}`]?.selected),
	        resumeSelectedPlan: () => this._resumePlanArtifact?.(modalId, this[`__plans_${modalId}`]?.selected),
	        refreshPlans: () => this.openPlansManager({ runId: id }),
	        openArtifactsBrowser: () => this.openArtifactsBrowser({ runId: id }),
	        selectPlanArtifact: ({ payload }) => this._selectPlanArtifact?.(modalId, payload?.artifactId),
	      },
	    });

	    if (!overlay) return;

	    if (!store || !id) {
	      overlay.querySelector('.ppt-modal-body').innerHTML = `<div style="padding:12px;color:var(--ppt-text-secondary);">RunStore 或 runId 不可用，无法浏览 plans。</div>`;
	      return;
	    }

	    let artifacts = [];
	    try {
	      artifacts = await store.listArtifacts(id);
	    } catch {
	      artifacts = [];
	    }

	    const plans = artifacts
	      .filter((a) => a && typeof a === 'object' && a.type === 'plan.json')
	      .sort((a, b) => Number(b.seq || 0) - Number(a.seq || 0));

	    const stateKey = `__plans_${modalId}`;
	    this[stateKey] = {
	      runId: id,
	      artifacts: plans,
	      selected: this[stateKey]?.selected || plans[0]?.artifactId || null,
	    };

	    const renderListItem = (a) => {
	      const selected = a.artifactId === this[stateKey].selected ? 'style="background: rgba(79,70,229,0.10); border-color: rgba(79,70,229,0.35);"' : '';
	      const createdAt = typeof a.createdAt === 'string' ? a.createdAt : '';
	      const bytes = typeof a.bytes === 'number' ? formatSize(a.bytes) : '';
	      return `
	        <button class="ppt-btn ppt-btn-secondary" data-action="selectPlanArtifact" data-artifact-id="${escapeAttr(a.artifactId)}" ${selected}
	          style="width:100%; text-align:left; justify-content:flex-start; gap:10px; padding:10px 12px; border-radius: 12px; display:flex; flex-direction:column; align-items:flex-start;">
	          <div style="display:flex; width:100%; align-items:center; justify-content:space-between; gap:8px;">
	            <div style="font-weight:700; font-size: 13px; color: var(--ppt-text-main);">plan.json · #${escapeHtml(String(a.seq ?? ''))}</div>
	            <div style="font-size: 12px; color: var(--ppt-text-secondary);">${escapeHtml(bytes)}</div>
	          </div>
	          <div style="font-size: 12px; color: var(--ppt-text-secondary);">
	            <code>${escapeHtml(a.artifactId)}</code>${createdAt ? ` · ${escapeHtml(createdAt)}` : ''}
	          </div>
	        </button>
	      `;
	    };

	    overlay.querySelector('.ppt-modal-body').innerHTML = `
	      <div style="display:grid; grid-template-columns: 320px 1fr; gap: 12px; min-height: 420px;">
	        <div class="custom-scrollbar" style="overflow:auto; max-height: 70vh; padding-right: 4px;">
	          ${plans.length ? plans.map(renderListItem).join('') : `<div style="padding:12px;color:var(--ppt-text-secondary);">暂无 plan.json artifacts。</div>`}
	        </div>
	        <div id="${escapeAttr(modalId)}_preview" class="custom-scrollbar" style="overflow:auto; max-height: 70vh; border: 1px solid rgba(148,163,184,0.25); border-radius: 14px; padding: 12px; background: rgba(15,23,42,0.02);">
	          <div style="color: var(--ppt-text-secondary); font-size: 12px;">选择一个 plan artifact 以预览</div>
	        </div>
	      </div>
	    `;

	    if (this[stateKey].selected) {
	      await this._selectPlanArtifact(modalId, this[stateKey].selected);
	    }
	  }

	  async _selectPlanArtifact(modalId, artifactId) {
	    if (!modalId || typeof document === 'undefined') return;
	    const overlay = document.getElementById(modalId);
	    if (!overlay) return;
	    const generator = this._ensureGenerator();
	    const store = generator?._runStore;
	    const stateKey = `__plans_${modalId}`;
	    const state = this[stateKey];
	    if (!state || !store) return;
	    const id = typeof artifactId === 'string' ? artifactId : null;
	    if (!id) return;
	    state.selected = id;

	    overlay.querySelectorAll('[data-action="selectPlanArtifact"]').forEach((btn) => {
	      if (btn.dataset.artifactId === id) {
	        btn.style.background = 'rgba(79,70,229,0.10)';
	        btn.style.borderColor = 'rgba(79,70,229,0.35)';
	      } else {
	        btn.style.background = '';
	        btn.style.borderColor = '';
	      }
	    });

	    const previewEl = overlay.querySelector(`#${escapeCssSelector(modalId)}_preview`);
	    if (!previewEl) return;

	    let data = null;
	    try {
	      if (typeof store.getArtifactById === 'function') {
	        data = await store.getArtifactById(id);
	      } else {
	        data = await store.getArtifact(state.runId, 'plan.json');
	      }
	    } catch (err) {
	      data = { error: err instanceof Error ? err.message : String(err) };
	    }

	    const plan = data && typeof data === 'object' && !Array.isArray(data) ? data : null;
	    const title = typeof plan?.title === 'string' ? plan.title : '';
	    const planId = typeof plan?.planId === 'string' ? plan.planId : '';
	    const updatedAt = typeof plan?.updatedAt === 'string' ? plan.updatedAt : '';
	    const lifecycleStatus = typeof plan?.lifecycleStatus === 'string' ? plan.lifecycleStatus : '';
	    const selectedIdx = typeof plan?.selectedStepIndex === 'number' ? plan.selectedStepIndex : null;
	    const steps = Array.isArray(plan?.steps) ? plan.steps : [];

	    let jsonText = '';
	    try { jsonText = JSON.stringify(data, null, 2); } catch { jsonText = String(data); }
	    if (jsonText.length > 20000) jsonText = jsonText.slice(0, 20000) + '\n...(truncated)';

	    const renderStep = (s, idx) => {
	      const stepId = typeof s?.stepId === 'string' ? s.stepId : `step_${idx + 1}`;
	      const stepTitle = typeof s?.title === 'string' ? s.title : stepId;
	      const status = typeof s?.status === 'string' ? s.status : '';
	      const isSelected = selectedIdx === idx;
	      const dot = status === 'completed'
	        ? '#22c55e'
	        : (status === 'failed' ? '#ef4444' : (status === 'in_progress' ? '#6366f1' : '#94a3b8'));
	      return `
	        <div style="display:flex; align-items:flex-start; gap:10px; padding:8px 10px; border-radius: 12px; border: 1px solid rgba(148,163,184,0.25); background: ${isSelected ? 'rgba(99,102,241,0.08)' : 'rgba(255,255,255,0.7)'};">
	          <span style="width:10px; height:10px; border-radius:50%; margin-top:4px; background:${dot}; flex:0 0 auto;"></span>
	          <div style="display:flex; flex-direction:column; gap:2px;">
	            <div style="font-size: 13px; font-weight: 700; color: var(--ppt-text-main);">${escapeHtml(stepTitle)}</div>
	            <div style="font-size: 12px; color: var(--ppt-text-secondary);"><code>${escapeHtml(stepId)}</code>${status ? ` · <code>${escapeHtml(status)}</code>` : ''}</div>
	          </div>
	        </div>
	      `;
	    };

		    previewEl.innerHTML = `
		      <div style="display:flex; flex-direction:column; gap: 12px;">
		        <div>
		          <div style="font-size: 13px; font-weight: 800; color: var(--ppt-text-main);">${escapeHtml(title || 'Plan')}</div>
		          <div style="font-size: 12px; color: var(--ppt-text-secondary);">
	            ${planId ? `planId: <code>${escapeHtml(planId)}</code>` : ''}
	            ${updatedAt ? `${planId ? ' · ' : ''}updatedAt: <code>${escapeHtml(updatedAt)}</code>` : ''}
	            ${lifecycleStatus ? `${(planId || updatedAt) ? ' · ' : ''}lifecycle: <code>${escapeHtml(lifecycleStatus)}</code>` : ''}
	          </div>
	        </div>
	        ${steps.length ? `
	          <div style="display:flex; flex-direction:column; gap: 8px;">
	            ${steps.map(renderStep).join('')}
	          </div>
	        ` : `<div style="color: var(--ppt-text-secondary); font-size: 12px;">无 steps</div>`}
	        <details>
	          <summary style="cursor:pointer; font-size: 12px; color: var(--ppt-text-secondary);">Raw JSON</summary>
	          <pre class="custom-scrollbar" style="margin-top:10px; max-height: 320px; overflow:auto; background: rgba(15,23,42,0.04); border:1px solid rgba(148,163,184,0.25); padding:10px; border-radius: 12px; font-size: 12px; line-height: 1.4;">${escapeHtml(jsonText)}</pre>
	        </details>
		      </div>
		    `;
		  }

		  async undoLastVfsCheckpoint({ steps, reason, requestId } = {}) {
		    const generator = this._ensureGenerator();
		    const sideEffects = generator?._sideEffects || (typeof window !== 'undefined' ? window.pbSideEffects : null);
		    if (!sideEffects || typeof sideEffects.getCursor !== 'function' || typeof sideEffects.rollbackToCursor !== 'function') {
		      console.warn('[UI] undoLastVfsCheckpoint skipped: SideEffectJournal unavailable.');
		      const out = { ok: false, reason: 'missing_side_effect_journal' };
		      this.eventBus?.emit?.('ui.undo.result', { requestId, ...out });
		      return out;
		    }

		    const n = Number.isFinite(Number(steps)) ? Math.max(1, Math.floor(Number(steps))) : 1;
		    const cursor = sideEffects.getCursor();
		    if (!Number.isFinite(cursor) || cursor <= 0) {
		      const out = { ok: true, rolledBack: 0, cursor: 0 };
		      this.eventBus?.emit?.('ui.undo.result', { requestId, ...out });
		      return out;
		    }

		    const target = Math.max(0, cursor - n);
		    try {
		      const out = await sideEffects.rollbackToCursor(target, {
		        reason: typeof reason === 'string' && reason.trim() ? reason.trim() : 'ui:/undo',
		      });
		      this.eventBus?.emit?.('ui.undo.result', { requestId, ...out });
		      return out;
		    } catch (err) {
		      const msg = err instanceof Error ? err.message : String(err);
		      console.warn('[UI] undoLastVfsCheckpoint failed:', msg);
		      const out = { ok: false, reason: 'rollback_failed', error: msg };
		      this.eventBus?.emit?.('ui.undo.result', { requestId, ...out });
		      return out;
		    }
		  }

		  async startReplay({ runId } = {}) {
		    const generator = this._ensureGenerator();
		    const id = typeof runId === 'string' ? runId.trim() : '';
		    if (!generator || typeof generator.startReplay !== 'function') {
		      console.warn('[UI] startReplay skipped: generator.startReplay unavailable.');
		      return { ok: false, reason: 'missing_startReplay' };
		    }
		    if (!id) return { ok: false, reason: 'missing_runId' };

		    try {
		      await generator.startReplay(id, {});
		      return { ok: true, runId: id };
		    } catch (err) {
		      const msg = err instanceof Error ? err.message : String(err);
		      console.warn('[UI] startReplay failed:', msg);
		      return { ok: false, reason: 'replay_failed', error: msg };
		    }
		  }

		  async resumeWorkflowFromPlan({ runId, stepIdOrIndex } = {}) {
		    const generator = this._ensureGenerator();
		    const id = typeof runId === 'string' ? runId.trim() : '';
		    const step = stepIdOrIndex;
		    if (!generator || typeof generator.resumeWorkflowFromPlan !== 'function') {
		      console.warn('[UI] resumeWorkflowFromPlan skipped: generator.resumeWorkflowFromPlan unavailable.');
		      return { ok: false, reason: 'missing_resumeWorkflowFromPlan' };
		    }

		    try {
		      const out = await generator.resumeWorkflowFromPlan({
		        ...(id ? { runId: id } : {}),
		        ...(step !== undefined ? { stepIdOrIndex: step } : {}),
		      });
		      return { ok: true, ...(out && typeof out === 'object' ? out : {}) };
		    } catch (err) {
		      const msg = err instanceof Error ? err.message : String(err);
		      console.warn('[UI] resumeWorkflowFromPlan failed:', msg);
		      return { ok: false, reason: 'resume_failed', error: msg };
		    }
		  }
	
		  async _restorePlanArtifact(modalId, artifactId) {
		    const generator = this._ensureGenerator();
		    const store = generator?._runStore;
		    const id = typeof artifactId === 'string' ? artifactId.trim() : '';
	    if (!id) return;

	    const overlay = typeof document !== 'undefined' ? document.getElementById(modalId) : null;
	    const previewEl = overlay?.querySelector?.(`#${escapeCssSelector(modalId)}_preview`) || null;
	    const stateKey = `__plans_${modalId}`;
	    const runId = this[stateKey]?.runId || generator?._currentRunId || null;

	    if (!store || typeof store.getArtifactById !== 'function' || !runId) {
	      if (previewEl) {
	        previewEl.insertAdjacentHTML('afterbegin', `<div style="padding:8px 10px; border:1px solid rgba(248,113,113,0.35); background: rgba(248,113,113,0.08); border-radius: 12px; color: var(--ppt-text-main); margin-bottom: 10px;">恢复失败：RunStore/runId 不可用。</div>`);
	      }
	      return;
	    }

	    const ok = await this.confirmDialog({
	      title: '恢复 Plan',
	      message: `确认将所选计划设为当前执行计划？这会创建一个新的 plan.json 版本（保留历史）。\n\nartifactId: ${id}`,
	      confirmText: '恢复',
	      cancelText: '取消',
	    });
	    if (!ok) return;

	    let raw = null;
	    try {
	      raw = await store.getArtifactById(id);
	    } catch (err) {
	      raw = { error: err instanceof Error ? err.message : String(err) };
	    }

	    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
	      if (previewEl) {
	        previewEl.insertAdjacentHTML('afterbegin', `<div style="padding:8px 10px; border:1px solid rgba(248,113,113,0.35); background: rgba(248,113,113,0.08); border-radius: 12px; color: var(--ppt-text-main); margin-bottom: 10px;">恢复失败：artifact 内容不是有效 plan 对象。</div>`);
	      }
	      return;
	    }

	    try {
	      const { createPlan, PlanLifecycleStatus } = await import('../../../agents/runtime/plan/plan-store.js');
	      const ts = new Date().toISOString();
	      const restored = createPlan({
	        runId,
	        planId: raw.planId,
	        kind: raw.kind,
	        title: raw.title,
	        steps: raw.steps,
	        selectedStepIndex: raw.selectedStepIndex,
	        lifecycleStatus: PlanLifecycleStatus.DRAFT,
	        meta: {
	          ...(raw.meta && typeof raw.meta === 'object' && !Array.isArray(raw.meta) ? raw.meta : {}),
	          restoredFromArtifactId: id,
	          restoredFromLifecycleStatus: typeof raw.lifecycleStatus === 'string' ? raw.lifecycleStatus : null,
	          restoredAt: ts,
	        },
	      });

	      generator._workflowPlan = restored;

	      let newArtifactId = null;
	      if (typeof generator._persistWorkflowPlan === 'function') {
	        newArtifactId = await generator._persistWorkflowPlan({ reason: `restore:${id}`, eventName: 'ui.plan.restore' });
	      } else {
	        newArtifactId = await store.saveArtifact(runId, 'plan.json', restored, { mime: 'application/json' });
	      }
	      if (newArtifactId && generator) generator._workflowPlanLatestArtifactId = newArtifactId;

	      if (this[stateKey]) this[stateKey].selected = newArtifactId || this[stateKey].selected;

	      if (previewEl) {
	        previewEl.insertAdjacentHTML(
	          'afterbegin',
	          `<div style="padding:8px 10px; border:1px solid rgba(34,197,94,0.35); background: rgba(34,197,94,0.08); border-radius: 12px; color: var(--ppt-text-main); margin-bottom: 10px;">恢复成功：已写入新版本 <code>${escapeHtml(newArtifactId || '')}</code></div>`
	        );
	      }

	      // Refresh list to surface the new version.
	      await this.openPlansManager({ runId });
	    } catch (err) {
	      const msg = err instanceof Error ? err.message : String(err);
	      if (previewEl) {
	        previewEl.insertAdjacentHTML('afterbegin', `<div style="padding:8px 10px; border:1px solid rgba(248,113,113,0.35); background: rgba(248,113,113,0.08); border-radius: 12px; color: var(--ppt-text-main); margin-bottom: 10px;">恢复失败：${escapeHtml(msg)}</div>`);
	      }
	    }
	  }

	  async _resumePlanArtifact(modalId, artifactId) {
	    const generator = this._ensureGenerator();
	    const store = generator?._runStore;
	    const id = typeof artifactId === 'string' ? artifactId.trim() : '';
	    if (!id) return;

	    const overlay = typeof document !== 'undefined' ? document.getElementById(modalId) : null;
	    const previewEl = overlay?.querySelector?.(`#${escapeCssSelector(modalId)}_preview`) || null;
	    const stateKey = `__plans_${modalId}`;
	    const runId = this[stateKey]?.runId || generator?._currentRunId || null;

	    if (!store || typeof store.getArtifactById !== 'function' || !runId) {
	      if (previewEl) {
	        previewEl.insertAdjacentHTML('afterbegin', `<div style="padding:8px 10px; border:1px solid rgba(248,113,113,0.35); background: rgba(248,113,113,0.08); border-radius: 12px; color: var(--ppt-text-main); margin-bottom: 10px;">继续执行失败：RunStore/runId 不可用。</div>`);
	      }
	      return;
	    }

	    if (generator?._currentRunId && generator._currentRunId !== runId) {
	      if (previewEl) {
	        previewEl.insertAdjacentHTML('afterbegin', `<div style="padding:8px 10px; border:1px solid rgba(248,113,113,0.35); background: rgba(248,113,113,0.08); border-radius: 12px; color: var(--ppt-text-main); margin-bottom: 10px;">继续执行失败：当前会话 runId 与所选 runId 不一致（${escapeHtml(generator._currentRunId)} vs ${escapeHtml(runId)}）。</div>`);
	      }
	      return;
	    }

	    const ok = await this.confirmDialog({
	      title: '继续执行',
	      message: `确认从所选 Plan 的 selected step 继续执行？这会创建一个新的 plan.json 版本（保留历史），并尝试从已落盘的 artifacts 进行恢复。\n\nartifactId: ${id}`,
	      confirmText: '继续',
	      cancelText: '取消',
	    });
	    if (!ok) return;

	    let raw = null;
	    try {
	      raw = await store.getArtifactById(id);
	    } catch (err) {
	      raw = { error: err instanceof Error ? err.message : String(err) };
	    }

	    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
	      if (previewEl) {
	        previewEl.insertAdjacentHTML('afterbegin', `<div style="padding:8px 10px; border:1px solid rgba(248,113,113,0.35); background: rgba(248,113,113,0.08); border-radius: 12px; color: var(--ppt-text-main); margin-bottom: 10px;">继续执行失败：artifact 内容不是有效 plan 对象。</div>`);
	      }
	      return;
	    }

	    try {
	      const { createPlan, PlanLifecycleStatus } = await import('../../../agents/runtime/plan/plan-store.js');
	      const ts = new Date().toISOString();
	      const restored = createPlan({
	        runId,
	        planId: raw.planId,
	        kind: raw.kind,
	        title: raw.title,
	        steps: raw.steps,
	        selectedStepIndex: raw.selectedStepIndex,
	        lifecycleStatus: PlanLifecycleStatus.APPROVED,
	        meta: {
	          ...(raw.meta && typeof raw.meta === 'object' && !Array.isArray(raw.meta) ? raw.meta : {}),
	          restoredFromArtifactId: id,
	          restoredFromLifecycleStatus: typeof raw.lifecycleStatus === 'string' ? raw.lifecycleStatus : null,
	          restoredAt: ts,
	          resumedAt: ts,
	        },
	      });

	      generator._workflowPlan = restored;

	      let newArtifactId = null;
	      if (typeof generator._persistWorkflowPlan === 'function') {
	        newArtifactId = await generator._persistWorkflowPlan({ reason: `resume:restore:${id}`, eventName: 'ui.plan.resume' });
	      } else {
	        newArtifactId = await store.saveArtifact(runId, 'plan.json', restored, { mime: 'application/json' });
	      }
	      if (newArtifactId && generator) generator._workflowPlanLatestArtifactId = newArtifactId;
	      if (this[stateKey]) this[stateKey].selected = newArtifactId || this[stateKey].selected;

	      if (typeof generator?.resumeWorkflowFromPlan === 'function') {
	        await generator.resumeWorkflowFromPlan({ runId });
	      } else {
	        throw new Error('generator.resumeWorkflowFromPlan() not available');
	      }

	      if (previewEl) {
	        previewEl.insertAdjacentHTML(
	          'afterbegin',
	          `<div style="padding:8px 10px; border:1px solid rgba(34,197,94,0.35); background: rgba(34,197,94,0.08); border-radius: 12px; color: var(--ppt-text-main); margin-bottom: 10px;">已开始继续执行：<code>${escapeHtml(newArtifactId || '')}</code></div>`
	        );
	      }

	      await this.openPlansManager({ runId });
	    } catch (err) {
	      const msg = err instanceof Error ? err.message : String(err);
	      if (previewEl) {
	        previewEl.insertAdjacentHTML('afterbegin', `<div style="padding:8px 10px; border:1px solid rgba(248,113,113,0.35); background: rgba(248,113,113,0.08); border-radius: 12px; color: var(--ppt-text-main); margin-bottom: 10px;">继续执行失败：${escapeHtml(msg)}</div>`);
	      }
	    }
	  }

	  async openPolicyRulesManager() {
	    const generator = this._ensureGenerator();
	    const modalId = 'pptPolicyRulesModal';
	    const stateKey = `__policy_rules_${modalId}`;

	    const ensureRuleId = (rule) => {
	      const r = rule && typeof rule === 'object' && !Array.isArray(rule) ? { ...rule } : {};
	      const id = typeof r.ruleId === 'string' && r.ruleId.trim()
	        ? r.ruleId.trim()
	        : (typeof r.id === 'string' && r.id.trim() ? r.id.trim() : '');
	      if (id) return { ...r, ruleId: id };
	      return { ...r, ruleId: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` };
	    };

	    const overlay = this._openOrCreateModal({
	      id: modalId,
	      className: 'ppt-policy-rules-modal',
	      titleHtml: `
	        <iconify-icon icon="solar:shield-check-bold-duotone"></iconify-icon>
	        <span>Policy Rules</span>
	      `,
	      bodyHtml: `<div class="ppt-history-loading"><iconify-icon icon="svg-spinners:180-ring"></iconify-icon> 加载中...</div>`,
	      footerHtml: `
	        <button class="ppt-btn ppt-btn-secondary" data-action="addPolicyRule">新增规则</button>
	        <button class="ppt-btn ppt-btn-secondary" data-action="duplicatePolicyRule">复制所选</button>
	        <button class="ppt-btn ppt-btn-secondary" data-action="deletePolicyRule">删除所选</button>
	        <button class="ppt-btn ppt-btn-primary" data-action="savePolicyRules">保存</button>
	        <button class="ppt-btn ppt-btn-secondary" data-action="exportPolicyRules">导出</button>
	        <button class="ppt-btn ppt-btn-secondary" data-action="importPolicyRules">导入</button>
	        <button class="ppt-btn ppt-btn-secondary" data-action="clearPolicyRules">清空</button>
	        <button class="ppt-btn ppt-btn-secondary" data-action="closeModal" data-modal-id="${escapeAttr(modalId)}">关闭</button>
	      `,
	      actions: {
	        addPolicyRule: () => this._addPolicyRule?.(modalId),
	        duplicatePolicyRule: () => this._duplicatePolicyRule?.(modalId),
	        deletePolicyRule: () => this._deletePolicyRule?.(modalId),
	        savePolicyRules: () => this._savePolicyRules?.(modalId),
	        exportPolicyRules: () => this._exportPolicyRules?.(modalId),
	        importPolicyRules: () => this._importPolicyRules?.(modalId),
	        clearPolicyRules: () => this._clearPolicyRules?.(modalId),
	        selectPolicyRule: ({ payload }) => this._selectPolicyRule?.(modalId, payload?.ruleId),
	        updatePolicyRuleField: ({ payload, value, checked }) => this._updatePolicyRuleField?.(modalId, { ...payload, value, checked }),
	        updatePolicyRuleMatch: ({ payload, value }) => this._updatePolicyRuleMatch?.(modalId, payload?.ruleId, value),
	        testPolicyRules: () => this._testPolicyRules?.(modalId),
	      },
	    });

	    if (!overlay) return;

	    // Load rules once per modal instance (subsequent opens keep local edits until Save/Close).
	    if (!this[stateKey] || this[stateKey]?.loaded !== true) {
	      let rules = [];
	      try {
	        const policy = generator?._orchestrator?._services?.policy || null;
	        if (policy && typeof policy.getRules === 'function') {
	          rules = policy.getRules();
	        } else {
	          const { PolicyRuleStore } = await import('../../../agents/runtime/policy/store.js');
	          const store = new PolicyRuleStore();
	          rules = store.load();
	        }
	      } catch {
	        rules = [];
	      }

	      const normalized = (Array.isArray(rules) ? rules : []).map(ensureRuleId);
	      this[stateKey] = {
	        loaded: true,
	        rules: normalized,
	        selectedRuleId: normalized[0]?.ruleId || null,
	        dirty: false,
	        matchDraftByRuleId: {},
	        lastTest: null,
	      };
	    }

	    this._renderPolicyRulesManager?.(modalId);
	  }

	  _getPolicyRulesState(modalId) {
	    const key = `__policy_rules_${modalId}`;
	    return this[key] && typeof this[key] === 'object' ? this[key] : null;
	  }

	  _renderPolicyRulesManager(modalId) {
	    if (typeof document === 'undefined') return;
	    const overlay = document.getElementById(modalId);
	    if (!overlay) return;
	    const state = this._getPolicyRulesState(modalId);
	    if (!state) return;

	    const rules = Array.isArray(state.rules) ? state.rules : [];
	    const selectedId = typeof state.selectedRuleId === 'string' ? state.selectedRuleId : null;
	    const selected = rules.find((r) => r?.ruleId === selectedId) || rules[0] || null;
	    if (selected && selected.ruleId !== state.selectedRuleId) state.selectedRuleId = selected.ruleId;

	    const effect = typeof selected?.effect === 'string' ? selected.effect : 'allow';
	    const enabled = selected?.enabled !== false;
	    const priority = Number.isFinite(Number(selected?.priority)) ? Number(selected.priority) : 0;
	    const types = Array.isArray(selected?.types) ? selected.types : (typeof selected?.type === 'string' ? [selected.type] : []);
	    const tool = typeof selected?.tool === 'string' ? selected.tool : '';
	    const resource = typeof selected?.resource === 'string' ? selected.resource : '';
	    const path = typeof selected?.path === 'string' ? selected.path : '';
	    const domainSuffixes = Array.isArray(selected?.domainSuffixes) ? selected.domainSuffixes : (typeof selected?.domainSuffix === 'string' ? [selected.domainSuffix] : []);

	    const timeRange = selected?.timeRange && typeof selected.timeRange === 'object' && !Array.isArray(selected.timeRange) ? selected.timeRange : null;
	    const timeStart = typeof timeRange?.start === 'string' ? timeRange.start : '';
	    const timeEnd = typeof timeRange?.end === 'string' ? timeRange.end : '';
	    const timeTz = typeof timeRange?.timezone === 'string' ? timeRange.timezone : 'local';

	    const matchDraft = (selectedId && state.matchDraftByRuleId && typeof state.matchDraftByRuleId[selectedId] === 'string')
	      ? state.matchDraftByRuleId[selectedId]
	      : (() => {
	          try { return selected?.match ? JSON.stringify(selected.match, null, 2) : ''; } catch { return ''; }
	        })();

	    const renderRuleRow = (r) => {
	      const rid = typeof r?.ruleId === 'string' ? r.ruleId : '';
	      const isSelected = rid && rid === state.selectedRuleId;
	      const rEnabled = r?.enabled !== false;
	      const rEffect = typeof r?.effect === 'string' ? r.effect : 'allow';
	      const rPriority = Number.isFinite(Number(r?.priority)) ? Number(r.priority) : 0;
	      const badge = rEffect === 'deny'
	        ? `<span style="font-size:11px; padding:2px 8px; border-radius:999px; background: rgba(239,68,68,0.12); color: #ef4444;">deny</span>`
	        : `<span style="font-size:11px; padding:2px 8px; border-radius:999px; background: rgba(34,197,94,0.12); color: #22c55e;">allow</span>`;
	      const disabledBadge = rEnabled ? '' : `<span style="font-size:11px; padding:2px 8px; border-radius:999px; background: rgba(148,163,184,0.18); color: var(--ppt-text-secondary);">disabled</span>`;
	      const label = typeof r?.title === 'string' && r.title.trim() ? r.title.trim() : (typeof r?.ruleId === 'string' ? r.ruleId : 'rule');
	      const summary = [
	        Array.isArray(r?.types) && r.types.length ? `type=${r.types.join(',')}` : '',
	        typeof r?.tool === 'string' && r.tool ? `tool=${r.tool}` : '',
	        typeof r?.resource === 'string' && r.resource ? `res=${r.resource}` : '',
	        typeof r?.path === 'string' && r.path ? `path=${r.path}` : '',
	      ].filter(Boolean).join(' · ');
	      return `
	        <button class="ppt-btn ppt-btn-secondary" data-action="selectPolicyRule" data-rule-id="${escapeAttr(rid)}"
	          style="width:100%; text-align:left; justify-content:flex-start; gap:10px; padding:10px 12px; border-radius: 12px; display:flex; flex-direction:column; align-items:flex-start; ${isSelected ? 'background: rgba(79,70,229,0.10); border-color: rgba(79,70,229,0.35);' : ''}">
	          <div style="display:flex; width:100%; align-items:center; justify-content:space-between; gap:8px;">
	            <div style="font-weight:800; font-size: 13px; color: var(--ppt-text-main);">${escapeHtml(label)}</div>
	            <div style="display:flex; align-items:center; gap:6px;">${badge}${disabledBadge}</div>
	          </div>
	          <div style="font-size: 12px; color: var(--ppt-text-secondary);">
	            <code>${escapeHtml(rid)}</code> · priority: <code>${escapeHtml(String(rPriority))}</code>
	          </div>
	          ${summary ? `<div style="font-size: 12px; color: var(--ppt-text-secondary);">${escapeHtml(summary)}</div>` : ''}
	        </button>
	      `;
	    };

	    const headerLine = `
	      <div style="display:flex; align-items:center; justify-content:space-between; gap: 10px; margin-bottom: 10px;">
	        <div style="font-weight: 800; color: var(--ppt-text-main);">Rules <span style="font-size:12px; color: var(--ppt-text-secondary);">(${rules.length})</span></div>
	        <div id="${escapeAttr(modalId)}_dirty" style="font-size: 12px; color: ${state.dirty ? '#f59e0b' : 'var(--ppt-text-secondary)'};">${state.dirty ? '未保存更改' : '已保存'}</div>
	      </div>
	    `;

	    const editor = selected ? `
	      <div style="display:flex; flex-direction:column; gap: 12px;">
	        <div style="display:flex; align-items:center; justify-content:space-between; gap: 10px;">
	          <div style="font-weight: 850; color: var(--ppt-text-main);">Rule Editor</div>
	          <div style="font-size: 12px; color: var(--ppt-text-secondary);"><code>${escapeHtml(selected.ruleId)}</code></div>
	        </div>

	        <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px;">
	          <label style="display:flex; align-items:center; gap: 8px; font-size: 12px; color: var(--ppt-text-secondary);">
	            <input type="checkbox" ${enabled ? 'checked' : ''} data-action="updatePolicyRuleField" data-event="change" data-rule-id="${escapeAttr(selected.ruleId)}" data-field="enabled" />
	            Enabled
	          </label>

	          <label style="display:flex; flex-direction:column; gap: 6px; font-size: 12px; color: var(--ppt-text-secondary);">
	            Effect
	            <select class="ppt-input" data-action="updatePolicyRuleField" data-event="change" data-rule-id="${escapeAttr(selected.ruleId)}" data-field="effect">
	              <option value="allow" ${effect === 'allow' ? 'selected' : ''}>allow</option>
	              <option value="deny" ${effect === 'deny' ? 'selected' : ''}>deny</option>
	            </select>
	          </label>

	          <label style="display:flex; flex-direction:column; gap: 6px; font-size: 12px; color: var(--ppt-text-secondary);">
	            Priority
	            <input class="ppt-input" type="number" value="${escapeAttr(String(priority))}" data-action="updatePolicyRuleField" data-event="input" data-rule-id="${escapeAttr(selected.ruleId)}" data-field="priority" />
	          </label>
	        </div>

	        <label style="display:flex; flex-direction:column; gap: 6px; font-size: 12px; color: var(--ppt-text-secondary);">
	          Types (comma-separated, supports *)
	          <input class="ppt-input" type="text" value="${escapeAttr(types.join(', '))}" placeholder="e.g. vfs.write, tool.call" data-action="updatePolicyRuleField" data-event="input" data-rule-id="${escapeAttr(selected.ruleId)}" data-field="types" />
	        </label>

	        <label style="display:flex; flex-direction:column; gap: 6px; font-size: 12px; color: var(--ppt-text-secondary);">
	          Tool (wildcard)
	          <input class="ppt-input" type="text" value="${escapeAttr(tool)}" placeholder="e.g. vfs.writeText" data-action="updatePolicyRuleField" data-event="input" data-rule-id="${escapeAttr(selected.ruleId)}" data-field="tool" />
	        </label>

	        <label style="display:flex; flex-direction:column; gap: 6px; font-size: 12px; color: var(--ppt-text-secondary);">
	          Resource (wildcard)
	          <input class="ppt-input" type="text" value="${escapeAttr(resource)}" placeholder="e.g. **/*.md or https://example.com/*" data-action="updatePolicyRuleField" data-event="input" data-rule-id="${escapeAttr(selected.ruleId)}" data-field="resource" />
	        </label>

	        <label style="display:flex; flex-direction:column; gap: 6px; font-size: 12px; color: var(--ppt-text-secondary);">
	          Path (glob)
	          <input class="ppt-input" type="text" value="${escapeAttr(path)}" placeholder="e.g. docs/**" data-action="updatePolicyRuleField" data-event="input" data-rule-id="${escapeAttr(selected.ruleId)}" data-field="path" />
	        </label>

	        <label style="display:flex; flex-direction:column; gap: 6px; font-size: 12px; color: var(--ppt-text-secondary);">
	          Domain Suffixes (comma-separated)
	          <input class="ppt-input" type="text" value="${escapeAttr(domainSuffixes.join(', '))}" placeholder="e.g. github.com, openai.com" data-action="updatePolicyRuleField" data-event="input" data-rule-id="${escapeAttr(selected.ruleId)}" data-field="domainSuffixes" />
	        </label>

	        <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px;">
	          <label style="display:flex; flex-direction:column; gap: 6px; font-size: 12px; color: var(--ppt-text-secondary);">
	            Time Start (HH:MM)
	            <input class="ppt-input" type="text" value="${escapeAttr(timeStart)}" placeholder="09:00" data-action="updatePolicyRuleField" data-event="input" data-rule-id="${escapeAttr(selected.ruleId)}" data-field="timeStart" />
	          </label>
	          <label style="display:flex; flex-direction:column; gap: 6px; font-size: 12px; color: var(--ppt-text-secondary);">
	            Time End (HH:MM)
	            <input class="ppt-input" type="text" value="${escapeAttr(timeEnd)}" placeholder="18:00" data-action="updatePolicyRuleField" data-event="input" data-rule-id="${escapeAttr(selected.ruleId)}" data-field="timeEnd" />
	          </label>
	          <label style="display:flex; flex-direction:column; gap: 6px; font-size: 12px; color: var(--ppt-text-secondary);">
	            Timezone
	            <select class="ppt-input" data-action="updatePolicyRuleField" data-event="change" data-rule-id="${escapeAttr(selected.ruleId)}" data-field="timeTz">
	              <option value="local" ${timeTz !== 'utc' ? 'selected' : ''}>local</option>
	              <option value="utc" ${timeTz === 'utc' ? 'selected' : ''}>utc</option>
	            </select>
	          </label>
	        </div>

	        <details>
	          <summary style="cursor:pointer; font-size: 12px; color: var(--ppt-text-secondary);">Advanced match (JSON: all/any/not)</summary>
	          <textarea class="ppt-input" style="min-height: 160px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace;"
	            data-action="updatePolicyRuleMatch" data-event="input" data-rule-id="${escapeAttr(selected.ruleId)}"
	          >${escapeHtml(matchDraft)}</textarea>
	        </details>

	        <details>
	          <summary style="cursor:pointer; font-size: 12px; color: var(--ppt-text-secondary);">Test request</summary>
	          <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px;">
	            <label style="display:flex; flex-direction:column; gap: 6px; font-size: 12px; color: var(--ppt-text-secondary);">
	              type
	              <input id="${escapeAttr(modalId)}_testType" class="ppt-input" type="text" placeholder="e.g. vfs.write" />
	            </label>
	            <label style="display:flex; flex-direction:column; gap: 6px; font-size: 12px; color: var(--ppt-text-secondary);">
	              tool
	              <input id="${escapeAttr(modalId)}_testTool" class="ppt-input" type="text" placeholder="e.g. vfs.writeText" />
	            </label>
	            <label style="display:flex; flex-direction:column; gap: 6px; font-size: 12px; color: var(--ppt-text-secondary);">
	              resource
	              <input id="${escapeAttr(modalId)}_testResource" class="ppt-input" type="text" placeholder="e.g. docs/readme.md or https://example.com" />
	            </label>
	            <label style="display:flex; flex-direction:column; gap: 6px; font-size: 12px; color: var(--ppt-text-secondary);">
	              ts (optional, ISO)
	              <input id="${escapeAttr(modalId)}_testTs" class="ppt-input" type="text" placeholder="e.g. 2025-01-01T12:00:00Z" />
	            </label>
	          </div>
	          <div style="display:flex; gap: 10px; margin-top: 10px;">
	            <button class="ppt-btn ppt-btn-primary" data-action="testPolicyRules">Test</button>
	          </div>
	          <div id="${escapeAttr(modalId)}_testResult" style="margin-top: 10px; font-size: 12px; color: var(--ppt-text-secondary);"></div>
	        </details>
	      </div>
	    ` : `<div style="padding:12px;color:var(--ppt-text-secondary);">暂无规则。点击「新增规则」开始。</div>`;

	    overlay.querySelector('.ppt-modal-body').innerHTML = `
	      <div style="display:grid; grid-template-columns: 340px 1fr; gap: 12px; min-height: 420px;">
	        <div class="custom-scrollbar" style="overflow:auto; max-height: 70vh; padding-right: 4px;">
	          ${headerLine}
	          ${rules.length ? rules.map(renderRuleRow).join('') : `<div style="padding:12px;color:var(--ppt-text-secondary);">暂无规则</div>`}
	        </div>
	        <div class="custom-scrollbar" style="overflow:auto; max-height: 70vh; border: 1px solid rgba(148,163,184,0.25); border-radius: 14px; padding: 12px; background: rgba(15,23,42,0.02);">
	          ${editor}
	        </div>
	      </div>
	    `;

	    // Render last test (if any).
	    const testEl = overlay.querySelector(`#${escapeCssSelector(modalId)}_testResult`);
	    if (testEl && state.lastTest) {
	      let json = '';
	      try { json = JSON.stringify(state.lastTest, null, 2); } catch { json = String(state.lastTest); }
	      testEl.innerHTML = `<pre class="custom-scrollbar" style="margin:0; max-height: 220px; overflow:auto; white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.45;">${escapeHtml(json)}</pre>`;
	    }
	  }

	  _selectPolicyRule(modalId, ruleId) {
	    const state = this._getPolicyRulesState(modalId);
	    if (!state) return;
	    const id = typeof ruleId === 'string' ? ruleId.trim() : '';
	    if (!id) return;
	    state.selectedRuleId = id;
	    this._renderPolicyRulesManager(modalId);
	  }

	  _updatePolicyRuleMatch(modalId, ruleId, value) {
	    const state = this._getPolicyRulesState(modalId);
	    if (!state) return;
	    const id = typeof ruleId === 'string' ? ruleId.trim() : '';
	    if (!id) return;
	    if (!state.matchDraftByRuleId || typeof state.matchDraftByRuleId !== 'object') state.matchDraftByRuleId = {};
	    state.matchDraftByRuleId[id] = typeof value === 'string' ? value : String(value ?? '');
	    state.dirty = true;
	    const overlay = typeof document !== 'undefined' ? document.getElementById(modalId) : null;
	    const dirtyEl = overlay?.querySelector?.(`#${escapeCssSelector(modalId)}_dirty`) || null;
	    if (dirtyEl) {
	      dirtyEl.style.color = '#f59e0b';
	      dirtyEl.textContent = '未保存更改';
	    }
	  }

	  _updatePolicyRuleField(modalId, payload) {
	    const state = this._getPolicyRulesState(modalId);
	    if (!state) return;
	    const ruleId = typeof payload?.ruleId === 'string' ? payload.ruleId.trim() : '';
	    const field = typeof payload?.field === 'string' ? payload.field.trim() : '';
	    if (!ruleId || !field) return;

	    const idx = Array.isArray(state.rules) ? state.rules.findIndex((r) => r?.ruleId === ruleId) : -1;
	    if (idx < 0) return;

	    const prev = state.rules[idx] && typeof state.rules[idx] === 'object' ? state.rules[idx] : { ruleId };
	    const next = { ...prev };
	    const value = payload?.value;
	    const checked = payload?.checked;

	    const nowIso = new Date().toISOString();

	    if (field === 'enabled') {
	      next.enabled = Boolean(checked);
	    } else if (field === 'effect') {
	      next.effect = typeof value === 'string' ? value : String(value ?? '');
	    } else if (field === 'priority') {
	      const n = parseInt(String(value ?? ''), 10);
	      next.priority = Number.isFinite(n) ? n : 0;
	    } else if (field === 'types') {
	      const raw = typeof value === 'string' ? value : String(value ?? '');
	      const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
	      next.types = parts;
	      delete next.type;
	    } else if (field === 'tool') {
	      next.tool = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
	    } else if (field === 'resource') {
	      next.resource = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
	    } else if (field === 'path') {
	      next.path = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
	    } else if (field === 'domainSuffixes') {
	      const raw = typeof value === 'string' ? value : String(value ?? '');
	      const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
	      next.domainSuffixes = parts;
	      delete next.domainSuffix;
	    } else if (field === 'timeStart') {
	      const raw = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
	      const tr = next.timeRange && typeof next.timeRange === 'object' && !Array.isArray(next.timeRange) ? { ...next.timeRange } : {};
	      tr.start = raw;
	      next.timeRange = tr;
	    } else if (field === 'timeEnd') {
	      const raw = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
	      const tr = next.timeRange && typeof next.timeRange === 'object' && !Array.isArray(next.timeRange) ? { ...next.timeRange } : {};
	      tr.end = raw;
	      next.timeRange = tr;
	    } else if (field === 'timeTz') {
	      const raw = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
	      const tr = next.timeRange && typeof next.timeRange === 'object' && !Array.isArray(next.timeRange) ? { ...next.timeRange } : {};
	      tr.timezone = raw === 'utc' ? 'utc' : 'local';
	      next.timeRange = tr;
	    }

	    next.updatedAt = nowIso;
	    if (!next.createdAt) next.createdAt = nowIso;

	    state.rules[idx] = next;
	    state.dirty = true;

	    const overlay = typeof document !== 'undefined' ? document.getElementById(modalId) : null;
	    const dirtyEl = overlay?.querySelector?.(`#${escapeCssSelector(modalId)}_dirty`) || null;
	    if (dirtyEl) {
	      dirtyEl.style.color = '#f59e0b';
	      dirtyEl.textContent = '未保存更改';
	    }
	  }

	  _addPolicyRule(modalId) {
	    const state = this._getPolicyRulesState(modalId);
	    if (!state) return;
	    const nowIso = new Date().toISOString();
	    const ruleId = `rule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
	    const rule = {
	      ruleId,
	      effect: 'allow',
	      enabled: true,
	      priority: 0,
	      types: [],
	      tool: 'CHANGE_ME_TOOL',
	      resource: '',
	      path: '',
	      domainSuffixes: [],
	      createdAt: nowIso,
	      updatedAt: nowIso,
	    };
	    if (!Array.isArray(state.rules)) state.rules = [];
	    state.rules.unshift(rule);
	    state.selectedRuleId = ruleId;
	    state.dirty = true;
	    this._renderPolicyRulesManager(modalId);
	  }

	  _duplicatePolicyRule(modalId) {
	    const state = this._getPolicyRulesState(modalId);
	    if (!state) return;
	    const selectedId = typeof state.selectedRuleId === 'string' ? state.selectedRuleId : '';
	    if (!selectedId) return;
	    const idx = Array.isArray(state.rules) ? state.rules.findIndex((r) => r?.ruleId === selectedId) : -1;
	    if (idx < 0) return;
	    const src = state.rules[idx];
	    if (!src || typeof src !== 'object') return;
	    const nowIso = new Date().toISOString();
	    const ruleId = `rule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
	    const copy = { ...src, ruleId, createdAt: nowIso, updatedAt: nowIso };
	    state.rules.splice(idx + 1, 0, copy);
	    state.selectedRuleId = ruleId;
	    state.dirty = true;
	    this._renderPolicyRulesManager(modalId);
	  }

	  async _deletePolicyRule(modalId) {
	    const state = this._getPolicyRulesState(modalId);
	    if (!state) return;
	    const selectedId = typeof state.selectedRuleId === 'string' ? state.selectedRuleId : '';
	    if (!selectedId) return;

	    const ok = await this.confirmDialog({
	      title: '删除规则',
	      message: `确定删除规则？\n\nruleId: ${selectedId}`,
	      confirmText: '删除',
	      cancelText: '取消',
	    });
	    if (!ok) return;

	    state.rules = Array.isArray(state.rules) ? state.rules.filter((r) => r?.ruleId !== selectedId) : [];
	    state.selectedRuleId = state.rules[0]?.ruleId || null;
	    state.dirty = true;
	    this._renderPolicyRulesManager(modalId);
	  }

	  async _savePolicyRules(modalId) {
	    const state = this._getPolicyRulesState(modalId);
	    if (!state) return;
	    const generator = this._ensureGenerator();

	    // Apply match drafts (validate JSON).
	    const drafts = state.matchDraftByRuleId && typeof state.matchDraftByRuleId === 'object' ? state.matchDraftByRuleId : {};
	    for (const r of Array.isArray(state.rules) ? state.rules : []) {
	      const rid = typeof r?.ruleId === 'string' ? r.ruleId : '';
	      if (!rid) continue;
	      if (!Object.prototype.hasOwnProperty.call(drafts, rid)) continue;
	      const raw = typeof drafts[rid] === 'string' ? drafts[rid].trim() : '';
	      if (!raw) {
	        delete r.match;
	        continue;
	      }
	      try {
	        r.match = JSON.parse(raw);
	      } catch (err) {
	        const msg = err instanceof Error ? err.message : String(err);
	        await this.confirmDialog({
	          title: '保存失败',
	          message: `match JSON 解析失败（ruleId=${rid}）：${msg}`,
	          confirmText: '知道了',
	          cancelText: '关闭',
	        });
	        return;
	      }
	    }

	    // Clean empty timeRange stubs.
	    for (const r of Array.isArray(state.rules) ? state.rules : []) {
	      const tr = r?.timeRange && typeof r.timeRange === 'object' && !Array.isArray(r.timeRange) ? r.timeRange : null;
	      if (!tr) continue;
	      const s = typeof tr.start === 'string' ? tr.start.trim() : '';
	      const e = typeof tr.end === 'string' ? tr.end.trim() : '';
	      if (!s && !e) delete r.timeRange;
	    }

	    try {
	      const policy = generator?._orchestrator?._services?.policy || null;
	      if (policy && typeof policy.saveRules === 'function') {
	        policy.saveRules(state.rules);
	      } else {
	        const { PolicyRuleStore } = await import('../../../agents/runtime/policy/store.js');
	        const store = new PolicyRuleStore();
	        store.save(state.rules);
	      }
	      state.dirty = false;
	      this._renderPolicyRulesManager(modalId);
	    } catch (err) {
	      const msg = err instanceof Error ? err.message : String(err);
	      await this.confirmDialog({
	        title: '保存失败',
	        message: msg,
	        confirmText: '知道了',
	        cancelText: '关闭',
	      });
	    }
	  }

	  async _clearPolicyRules(modalId) {
	    const state = this._getPolicyRulesState(modalId);
	    if (!state) return;
	    const generator = this._ensureGenerator();

	    const ok = await this.confirmDialog({
	      title: '清空规则',
	      message: '确定清空所有 Policy rules？这会立即保存到本地存储。',
	      confirmText: '清空',
	      cancelText: '取消',
	    });
	    if (!ok) return;

	    state.rules = [];
	    state.selectedRuleId = null;
	    state.matchDraftByRuleId = {};
	    state.lastTest = null;

	    try {
	      const policy = generator?._orchestrator?._services?.policy || null;
	      if (policy && typeof policy.saveRules === 'function') {
	        policy.saveRules([]);
	      } else {
	        const { PolicyRuleStore } = await import('../../../agents/runtime/policy/store.js');
	        const store = new PolicyRuleStore();
	        store.clear();
	      }
	    } catch {
	      // ignore
	    }

	    state.dirty = false;
	    this._renderPolicyRulesManager(modalId);
	  }

	  async _exportPolicyRules(modalId) {
	    const state = this._getPolicyRulesState(modalId);
	    if (!state) return;
	    const payload = { schemaVersion: '0.1', rules: Array.isArray(state.rules) ? state.rules : [] };
	    let text = '';
	    try { text = JSON.stringify(payload, null, 2); } catch { text = String(payload); }

	    if (typeof document === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined') return;
	    const blob = new Blob([text], { type: 'application/json' });
	    const url = URL.createObjectURL(blob);
	    try {
	      const a = document.createElement('a');
	      a.href = url;
	      a.download = `paper-burner-policy-rules-${Date.now()}.json`;
	      a.style.display = 'none';
	      document.body.appendChild(a);
	      a.click();
	      a.remove();
	    } finally {
	      setTimeout(() => URL.revokeObjectURL(url), 3000);
	    }
	  }

	  async _importPolicyRules(modalId) {
	    const state = this._getPolicyRulesState(modalId);
	    if (!state) return;
	    if (typeof document === 'undefined') return;

	    const input = document.createElement('input');
	    input.type = 'file';
	    input.accept = '.json,application/json';
	    input.onchange = async (e) => {
	      const file = e?.target?.files?.[0];
	      if (!file) return;
	      let text = '';
	      try {
	        text = await file.text();
	      } catch (err) {
	        const msg = err instanceof Error ? err.message : String(err);
	        await this.confirmDialog({ title: '导入失败', message: msg, confirmText: '知道了', cancelText: '关闭' });
	        return;
	      }

	      let parsed = null;
	      try {
	        parsed = JSON.parse(text);
	      } catch (err) {
	        const msg = err instanceof Error ? err.message : String(err);
	        await this.confirmDialog({ title: '导入失败', message: `JSON 解析失败：${msg}`, confirmText: '知道了', cancelText: '关闭' });
	        return;
	      }

	      const rules = Array.isArray(parsed)
	        ? parsed
	        : (Array.isArray(parsed?.rules) ? parsed.rules : []);

	      const ensureRuleId = (rule) => {
	        const r = rule && typeof rule === 'object' && !Array.isArray(rule) ? { ...rule } : {};
	        const id = typeof r.ruleId === 'string' && r.ruleId.trim()
	          ? r.ruleId.trim()
	          : (typeof r.id === 'string' && r.id.trim() ? r.id.trim() : '');
	        if (id) return { ...r, ruleId: id };
	        return { ...r, ruleId: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` };
	      };

	      state.rules = (Array.isArray(rules) ? rules : []).filter((r) => r && typeof r === 'object').map(ensureRuleId);
	      state.selectedRuleId = state.rules[0]?.ruleId || null;
	      state.dirty = true;
	      state.matchDraftByRuleId = {};
	      state.lastTest = null;

	      this._renderPolicyRulesManager(modalId);
	    };
	    input.click();
	  }

	  async _testPolicyRules(modalId) {
	    if (typeof document === 'undefined') return;
	    const state = this._getPolicyRulesState(modalId);
	    if (!state) return;
	    const generator = this._ensureGenerator();
	    const overlay = document.getElementById(modalId);
	    if (!overlay) return;

	    const type = overlay.querySelector(`#${escapeCssSelector(modalId)}_testType`)?.value?.trim?.() || '';
	    const tool = overlay.querySelector(`#${escapeCssSelector(modalId)}_testTool`)?.value?.trim?.() || '';
	    const resource = overlay.querySelector(`#${escapeCssSelector(modalId)}_testResource`)?.value?.trim?.() || '';
	    const ts = overlay.querySelector(`#${escapeCssSelector(modalId)}_testTs`)?.value?.trim?.() || '';

	    try {
	      const { PolicyEngine } = await import('../../../agents/runtime/policy/engine.js');
	      const policy = generator?._orchestrator?._services?.policy || null;
	      const defaultEffect = typeof policy?.engine?.defaultEffect === 'string' ? policy.engine.defaultEffect : 'prompt';
	      const engine = new PolicyEngine({ rules: state.rules, defaultEffect });
	      const decision = engine.evaluate({ type, tool, resource, ...(ts ? { ts } : {}) });
	      state.lastTest = { request: { type, tool, resource, ...(ts ? { ts } : {}) }, decision };
	      const el = overlay.querySelector(`#${escapeCssSelector(modalId)}_testResult`);
	      if (el) {
	        let json = '';
	        try { json = JSON.stringify(state.lastTest, null, 2); } catch { json = String(state.lastTest); }
	        el.innerHTML = `<pre class="custom-scrollbar" style="margin:0; max-height: 220px; overflow:auto; white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.45;">${escapeHtml(json)}</pre>`;
	      }
	    } catch (err) {
	      const msg = err instanceof Error ? err.message : String(err);
	      const el = overlay.querySelector(`#${escapeCssSelector(modalId)}_testResult`);
	      if (el) el.textContent = `Test failed: ${msg}`;
	    }
	  }

  async _selectArtifact(modalId, artifactId) {
    if (!modalId || typeof document === 'undefined') return;
    const overlay = document.getElementById(modalId);
    if (!overlay) return;
    const generator = this._ensureGenerator();
    const store = generator?._runStore;
    const stateKey = `__artifacts_${modalId}`;
    const state = this[stateKey];
    if (!state || !store) return;
    const id = typeof artifactId === 'string' ? artifactId : null;
    if (!id) return;
    state.selected = id;

    overlay.querySelectorAll('[data-action="selectArtifact"]').forEach((btn) => {
      if (btn.dataset.artifactId === id) {
        btn.style.background = 'rgba(79,70,229,0.10)';
        btn.style.borderColor = 'rgba(79,70,229,0.35)';
      } else {
        btn.style.background = '';
        btn.style.borderColor = '';
      }
    });

    const previewEl = overlay.querySelector(`#${escapeCssSelector(modalId)}_preview`);
    if (!previewEl) return;

    const artifact = state.artifacts.find((a) => a.artifactId === id);
    if (!artifact) {
      previewEl.innerHTML = `<div style="color: var(--ppt-text-secondary); font-size: 12px;">Artifact not found.</div>`;
      return;
    }

    let data = null;
    try {
      if (artifact.type === 'events.jsonl') {
        data = await store.getArtifact(state.runId, 'events.jsonl');
      } else if (typeof store.getArtifactById === 'function') {
        data = await store.getArtifactById(id);
      } else {
        data = artifact.data;
      }
    } catch (err) {
      data = { error: err instanceof Error ? err.message : String(err) };
    }

    let text = '';
    if (typeof data === 'string') text = data;
    else {
      try { text = JSON.stringify(data, null, 2); } catch { text = String(data); }
    }

    if (text.length > 20000) text = text.slice(0, 20000) + '\n...(truncated)';

	    if (artifact.type === 'vfs_checkpoint.json' && data && typeof data === 'object' && !Array.isArray(data)) {
	      const canRestore = !!generator?._vfs && typeof store?.getArtifactById === 'function';
	      const checkpointPath = typeof data.path === 'string' ? data.path : '';
	      const diffText = typeof data?.diff?.text === 'string' ? data.diff.text : '';
	
	      const beforePreview = typeof data?.before?.preview === 'string' ? data.before.preview : '';
	      const afterPreview = typeof data?.after?.preview === 'string' ? data.after.preview : '';
	      const beforeText = typeof data?.before?.text === 'string' ? data.before.text : null;
	      const afterText = typeof data?.after?.text === 'string' ? data.after.text : null;
	      const canSideBySide = typeof beforeText === 'string' && typeof afterText === 'string';
	
	      const diffModeKey = 'vfsDiffModeByArtifactId';
	      if (!state[diffModeKey] || typeof state[diffModeKey] !== 'object') state[diffModeKey] = {};
	      const savedMode = state[diffModeKey][artifact.artifactId];
	      const initialMode = (savedMode === 'unified' || savedMode === 'side-by-side')
	        ? savedMode
	        : (canSideBySide ? 'side-by-side' : 'unified');
	
	      const metaLine = checkpointPath ? ` · <code>${escapeHtml(checkpointPath)}</code>` : '';
	      const restoreBtn = canRestore
	        ? `<button class="ppt-btn ppt-btn-primary" data-action="restoreVfsCheckpoint" data-artifact-id="${escapeAttr(artifact.artifactId)}">Restore</button>`
	        : `<button class="ppt-btn ppt-btn-secondary" disabled>Restore (VFS unavailable)</button>`;
	
	      const modeButton = (mode, label, enabled) => {
	        const isActive = initialMode === mode;
	        const disabledAttr = enabled ? '' : 'disabled';
	        const activeStyle = isActive ? 'background: rgba(79,70,229,0.10); border-color: rgba(79,70,229,0.35);' : '';
	        return `<button class="ppt-btn ppt-btn-secondary" type="button" data-diff-mode="${escapeAttr(mode)}" ${disabledAttr} style="${activeStyle}">${label}</button>`;
	      };
	
	      previewEl.innerHTML = `
	        <div style="display:flex; align-items:center; justify-content:space-between; gap: 10px; margin-bottom: 10px;">
	          <div style="font-weight: 750; color: var(--ppt-text-main);">${escapeHtml(artifact.type)}</div>
	          <div style="font-size: 12px; color: var(--ppt-text-secondary);"><code>${escapeHtml(artifact.artifactId)}</code>${metaLine}</div>
        </div>
        <div style="display:flex; align-items:center; justify-content:space-between; gap: 10px; margin-bottom: 10px;">
          <div style="font-size: 12px; color: var(--ppt-text-secondary);">before/after preview</div>
          <div style="display:flex; align-items:center; gap: 8px;">${restoreBtn}</div>
        </div>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;">
          <div style="border: 1px solid rgba(148,163,184,0.25); border-radius: 12px; padding: 10px; background: rgba(15,23,42,0.02);">
            <div style="font-weight: 700; font-size: 12px; color: var(--ppt-text-main); margin-bottom: 6px;">Before</div>
            <pre class="custom-scrollbar" style="white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.45; margin: 0; max-height: 140px; overflow:auto;">${escapeHtml(beforePreview || '(no preview)')}</pre>
          </div>
          <div style="border: 1px solid rgba(148,163,184,0.25); border-radius: 12px; padding: 10px; background: rgba(15,23,42,0.02);">
	            <div style="font-weight: 700; font-size: 12px; color: var(--ppt-text-main); margin-bottom: 6px;">After</div>
	            <pre class="custom-scrollbar" style="white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.45; margin: 0; max-height: 140px; overflow:auto;">${escapeHtml(afterPreview || '(no preview)')}</pre>
	          </div>
	        </div>
	        <div style="display:flex; align-items:center; justify-content:space-between; gap: 10px; margin-bottom: 10px;">
	          <div style="font-size: 12px; color: var(--ppt-text-secondary);">diff</div>
	          <div style="display:flex; align-items:center; gap: 8px;">
	            ${modeButton('unified', 'Unified', true)}
	            ${modeButton('side-by-side', 'Side-by-side', canSideBySide)}
	          </div>
	        </div>
	        <div id="${escapeAttr(modalId)}_checkpointDiff" style="border: 1px solid rgba(148,163,184,0.25); border-radius: 12px; background: rgba(255,255,255,0.7); overflow-x:auto;">
	          <div style="padding:10px; color: var(--ppt-text-secondary); font-size: 12px;">Loading diff...</div>
	        </div>
	      `;
	
	      const diffHost = previewEl.querySelector(`#${escapeCssSelector(modalId)}_checkpointDiff`);
	      const modeButtons = Array.from(previewEl.querySelectorAll('[data-diff-mode]'));
	      let currentMode = initialMode;
	
	      const updateModeButtons = (active) => {
	        for (const btn of modeButtons) {
	          const mode = btn?.dataset?.diffMode;
	          const isActive = mode === active;
	          if (isActive) {
	            btn.style.background = 'rgba(79,70,229,0.10)';
	            btn.style.borderColor = 'rgba(79,70,229,0.35)';
	          } else {
	            btn.style.background = '';
	            btn.style.borderColor = '';
	          }
	        }
	      };
	
	      const renderUnified = () => {
	        if (!diffHost) return;
	        if (diffText) {
	          const shown = diffText.length > 20000 ? diffText.slice(0, 20000) + '\n...(truncated)' : diffText;
	          diffHost.innerHTML = `<pre class="custom-scrollbar" style="white-space: pre; word-break: break-word; font-size: 12px; line-height: 1.45; margin: 0; padding: 10px;">${escapeHtml(shown)}</pre>`;
	          return;
	        }
	        diffHost.innerHTML = `<pre class="custom-scrollbar" style="white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.45; margin: 0; padding: 10px;">${escapeHtml(text)}</pre>`;
	      };
	
	      const renderSideBySide = async () => {
	        if (!diffHost) return;
	        diffHost.innerHTML = `<div style="padding:10px; color: var(--ppt-text-secondary); font-size: 12px;">Computing side-by-side diff...</div>`;
	
	        const hunksCacheKey = 'vfsCheckpointHunksByArtifactId';
	        if (!state[hunksCacheKey] || typeof state[hunksCacheKey] !== 'object') state[hunksCacheKey] = {};
	
	        let hunks = state[hunksCacheKey][artifact.artifactId] || null;
	        if (!Array.isArray(hunks) || hunks.length === 0) {
	          try {
	            const parsed = parseUnifiedDiffText(diffText);
	            hunks = Array.isArray(parsed?.hunks) ? parsed.hunks : [];
	          } catch {
	            hunks = [];
	          }
	        }
	
	        if ((!Array.isArray(hunks) || hunks.length === 0) && canSideBySide) {
	          try {
	            const { createUnifiedDiff } = await import('../../../agents/vfs/diff.js');
	            const path = checkpointPath || 'file';
	            const diff = createUnifiedDiff({ path, beforeText, afterText, context: 3 });
	            hunks = Array.isArray(diff?.hunks) ? diff.hunks : [];
	          } catch {
	            hunks = [];
	          }
	        }
	
	        if (!Array.isArray(hunks) || hunks.length === 0) {
	          diffHost.innerHTML = `<div style="padding:10px; color: var(--ppt-text-secondary); font-size: 12px;">No diff available for side-by-side view.</div>`;
	          return;
	        }
	
	        state[hunksCacheKey][artifact.artifactId] = hunks;
	        diffHost.innerHTML = renderSideBySideDiffHtml({ hunks });
	      };
	
	      updateModeButtons(currentMode);
	      if (currentMode === 'side-by-side' && canSideBySide) {
	        await renderSideBySide();
	      } else {
	        renderUnified();
	      }
	
	      for (const btn of modeButtons) {
	        if (!btn || btn.dataset.bound === '1') continue;
	        btn.dataset.bound = '1';
	        btn.addEventListener('click', async () => {
	          const mode = btn?.dataset?.diffMode;
	          if (mode !== 'unified' && mode !== 'side-by-side') return;
	          if (mode === 'side-by-side' && !canSideBySide) return;
	          currentMode = mode;
	          state[diffModeKey][artifact.artifactId] = mode;
	          updateModeButtons(mode);
	          if (mode === 'side-by-side') {
	            await renderSideBySide();
	          } else {
	            renderUnified();
	          }
	        });
	      }
	      return;
	    }

    previewEl.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; gap: 10px; margin-bottom: 10px;">
        <div style="font-weight: 750; color: var(--ppt-text-main);">${escapeHtml(artifact.type)}</div>
        <div style="font-size: 12px; color: var(--ppt-text-secondary);"><code>${escapeHtml(artifact.artifactId)}</code></div>
      </div>
      <pre class="custom-scrollbar" style="white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.45; margin: 0;">${escapeHtml(text)}</pre>
    `;
  }

  async _restoreVfsCheckpoint(modalId, artifactId) {
    const generator = this._ensureGenerator();
    const store = generator?._runStore;
    const vfs = generator?._vfs;
    const id = typeof artifactId === 'string' ? artifactId.trim() : '';
    if (!id) return;

    const overlay = typeof document !== 'undefined' ? document.getElementById(modalId) : null;
    const previewEl = overlay?.querySelector?.(`#${escapeCssSelector(modalId)}_preview`) || null;

    if (!store || !vfs) {
      if (previewEl) {
        previewEl.insertAdjacentHTML('afterbegin', `<div style="padding:8px 10px; border:1px solid rgba(248,113,113,0.35); background: rgba(248,113,113,0.08); border-radius: 12px; color: var(--ppt-text-main); margin-bottom: 10px;">Restore failed: RunStore/VFS unavailable.</div>`);
      }
      return;
    }

    try {
      const { restoreVfsCheckpoint } = await import('../../../agents/vfs/checkpoints.js');
      const res = await restoreVfsCheckpoint({ vfs, runStore: store, artifactId: id });
      if (previewEl) {
        const ok = !!res?.ok;
        previewEl.insertAdjacentHTML(
          'afterbegin',
          `<div style="padding:8px 10px; border:1px solid ${ok ? 'rgba(34,197,94,0.35)' : 'rgba(248,113,113,0.35)'}; background: ${ok ? 'rgba(34,197,94,0.08)' : 'rgba(248,113,113,0.08)'}; border-radius: 12px; color: var(--ppt-text-main); margin-bottom: 10px;">${escapeHtml(ok ? `Restored: ${res.path}` : `Restore failed: ${res.error || 'unknown error'}`)}</div>`
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (previewEl) {
        previewEl.insertAdjacentHTML('afterbegin', `<div style="padding:8px 10px; border:1px solid rgba(248,113,113,0.35); background: rgba(248,113,113,0.08); border-radius: 12px; color: var(--ppt-text-main); margin-bottom: 10px;">Restore failed: ${escapeHtml(msg)}</div>`);
      }
    }
  }

  async openSkillsManager() {
    const modalId = 'pptSkillsManagerModal';
    const overlay = this._openOrCreateModal({
      id: modalId,
      className: 'ppt-skills-manager-modal',
      titleHtml: `
        <iconify-icon icon="solar:book-2-bold-duotone"></iconify-icon>
        <span>Skills 管理</span>
      `,
      bodyHtml: `<div class="ppt-history-loading"><iconify-icon icon="svg-spinners:180-ring"></iconify-icon> 加载中...</div>`,
      footerHtml: `
        <input id="${escapeAttr(modalId)}_file" type="file" accept=".zip" style="display:none" />
        <button class="ppt-btn ppt-btn-secondary" data-action="importSkillZip">导入 SkillPack Zip</button>
        <button class="ppt-btn ppt-btn-secondary" data-action="refreshSkills">刷新</button>
        <button class="ppt-btn ppt-btn-secondary" data-action="closeModal" data-modal-id="${escapeAttr(modalId)}">关闭</button>
      `,
      actions: {
        importSkillZip: async () => {
          const input = document.getElementById(`${modalId}_file`);
          input?.click?.();
        },
        refreshSkills: () => this.openSkillsManager(),
      },
      onMount: (el) => {
        const input = el.querySelector(`#${escapeCssSelector(modalId)}_file`);
        if (input && input.dataset.bound !== '1') {
          input.dataset.bound = '1';
          input.addEventListener('change', async (e) => {
            const file = e?.target?.files?.[0];
            if (!file) return;
            try {
              await this._importSkillPackZip(file);
            } catch (err) {
              alert(`导入失败: ${err instanceof Error ? err.message : String(err)}`);
            } finally {
              try { e.target.value = ''; } catch { /* ignore */ }
              this.openSkillsManager();
            }
          });
        }
      },
    });

    if (!overlay) return;

    const { listUserSkills, getUserSkillBody, deleteUserSkill } = await import('../../../agents/skills/user-store.js');

    // Built-in manifest (best-effort)
    let systemSkills = [];
    try {
      const candidates = ['/skills/manifest.json', 'skills/manifest.json', '/public/skills/manifest.json', 'public/skills/manifest.json'];
      let json = null;
      for (const url of candidates) {
        try {
          const resp = await fetch(url, { cache: 'no-store' });
          if (!resp.ok) continue;
          json = await resp.json();
          break;
        } catch {
          // try next
        }
      }
      systemSkills = Array.isArray(json?.skills) ? json.skills : [];
    } catch {
      systemSkills = [];
    }

    const userSkills = listUserSkills();

    const renderSkillRow = (skill, { kind } = {}) => {
      const name = escapeHtml(skill?.name || '');
      const desc = escapeHtml(skill?.description || '');
      const scopeLabel = kind === 'user' ? 'user' : 'system';
      const canDelete = kind === 'user';
      return `
        <div style="border: 1px solid rgba(148,163,184,0.25); border-radius: 14px; padding: 12px; display:flex; gap: 10px; align-items:flex-start; justify-content: space-between;">
          <div style="flex:1;">
            <div style="display:flex; align-items:center; gap: 8px; margin-bottom: 6px;">
              <div style="font-weight: 800; color: var(--ppt-text-main);">${name}</div>
              <span style="font-size: 12px; color: var(--ppt-text-secondary); border: 1px solid rgba(148,163,184,0.25); padding: 2px 8px; border-radius: 999px;">${scopeLabel}</span>
            </div>
            <div style="font-size: 12px; color: var(--ppt-text-secondary); line-height: 1.5;">${desc}</div>
          </div>
          <div style="display:flex; gap: 8px;">
            <button class="ppt-btn ppt-btn-secondary" data-action="viewSkill" data-skill-name="${escapeAttr(skill?.name || '')}" data-skill-kind="${escapeAttr(scopeLabel)}">查看</button>
            ${canDelete ? `<button class="ppt-btn ppt-btn-secondary" data-action="deleteSkill" data-skill-name="${escapeAttr(skill?.name || '')}">删除</button>` : ''}
          </div>
        </div>
      `;
    };

    overlay.querySelector('.ppt-modal-body').innerHTML = `
      <div style="display:flex; flex-direction:column; gap: 14px;">
        <div style="font-size: 12px; color: var(--ppt-text-secondary);">
          提示：导入后的 Skills 会以 <code>user:</code> 形式加入 Catalog，并在下一次 DeepSearch 运行时可用。
        </div>
        <div style="display:grid; grid-template-columns: 1fr; gap: 10px;">
          <div style="font-weight: 800; color: var(--ppt-text-main);">User Skills</div>
          ${userSkills.length ? userSkills.map((s) => renderSkillRow(s, { kind: 'user' })).join('') : `<div style="padding:12px;color:var(--ppt-text-secondary);">暂无 User Skills</div>`}
        </div>
        <div style="display:grid; grid-template-columns: 1fr; gap: 10px; margin-top: 8px;">
          <div style="font-weight: 800; color: var(--ppt-text-main);">System Skills</div>
          ${systemSkills.length ? systemSkills.map((s) => renderSkillRow(s, { kind: 'system' })).join('') : `<div style="padding:12px;color:var(--ppt-text-secondary);">无法加载系统 Skills manifest</div>`}
        </div>
        <div id="${escapeAttr(modalId)}_skillPreview" style="margin-top: 6px; border: 1px solid rgba(148,163,184,0.25); border-radius: 14px; padding: 12px; background: rgba(15,23,42,0.02);">
          <div style="color: var(--ppt-text-secondary); font-size: 12px;">选择 “查看” 以预览 SKILL.md</div>
        </div>
      </div>
    `;

    bindActionEvents(overlay, (action) => {
      if (action === 'viewSkill') {
        return ({ payload }) => {
          const name = typeof payload?.skillName === 'string' ? payload.skillName : '';
          const kind = typeof payload?.skillKind === 'string' ? payload.skillKind : 'system';
          const el = overlay.querySelector(`#${escapeCssSelector(modalId)}_skillPreview`);
          if (!el || !name) return;
          if (kind === 'user') {
            const body = getUserSkillBody(name) || '';
            const preview = body.length > 8000 ? body.slice(0, 8000) + '\n...(truncated)' : body;
            el.innerHTML = `<div style="font-weight:800;margin-bottom:8px;">${escapeHtml(name)} <span style="font-size:12px;color:var(--ppt-text-secondary);">user</span></div><pre class="custom-scrollbar" style="max-height: 260px; overflow:auto; white-space: pre-wrap; word-break: break-word; margin:0; font-size:12px; line-height:1.45;">${escapeHtml(preview)}</pre>`;
            return;
          }
          // system: best-effort fetch path from manifest list
          const sys = systemSkills.find((s) => s?.name === name);
          const path = typeof sys?.path === 'string' ? sys.path : '';
          if (!path) return;
          const urls = [
            path,
            path.replace(/^public\//, ''),
            path.startsWith('/') ? path : `/${path}`,
            path.startsWith('/') ? path : `/${path.replace(/^public\//, '')}`,
          ].filter(Boolean);
          (async () => {
            for (const url of Array.from(new Set(urls))) {
              try {
                const r = await fetch(url, { cache: 'no-store' });
                if (!r.ok) continue;
                const body = await r.text();
                const preview = body.length > 8000 ? body.slice(0, 8000) + '\n...(truncated)' : body;
                el.innerHTML = `<div style="font-weight:800;margin-bottom:8px;">${escapeHtml(name)} <span style="font-size:12px;color:var(--ppt-text-secondary);">system</span></div><pre class="custom-scrollbar" style="max-height: 260px; overflow:auto; white-space: pre-wrap; word-break: break-word; margin:0; font-size:12px; line-height:1.45;">${escapeHtml(preview)}</pre>`;
                return;
              } catch {
                // try next
              }
            }
          })();
        };
      }
      if (action === 'deleteSkill') {
        return ({ payload }) => {
          const name = typeof payload?.skillName === 'string' ? payload.skillName : '';
          if (!name) return;
          const ok = typeof window !== 'undefined' && typeof window.confirm === 'function'
            ? window.confirm(`确定删除 user skill: ${name} ?`)
            : true;
          if (!ok) return;
          deleteUserSkill(name);
          this.openSkillsManager();
        };
      }
      return null;
    });
  }

  async _importSkillPackZip(file) {
    const blob = file;
    const mod = await import('jszip');
    const JSZip = mod.default || mod;
    const zip = await JSZip.loadAsync(blob);

    const manifestText = await zip.file('manifest.json')?.async('string');
    if (!manifestText) throw new Error('缺少 manifest.json');
    const manifest = JSON.parse(manifestText);
    const skills = Array.isArray(manifest?.skills) ? manifest.skills : [];
    if (!skills.length) throw new Error('manifest.json 中缺少 skills');

    const { upsertUserSkill } = await import('../../../agents/skills/user-store.js');

    const errors = [];
    let imported = 0;

    const resolveZipPath = (p) => {
      const raw = typeof p === 'string' ? p.replace(/^\//, '') : '';
      if (!raw) return [];
      const candidates = [raw];
      if (raw.startsWith('public/')) candidates.push(raw.slice('public/'.length));
      candidates.push(raw.replace(/^\.\//, ''));
      return Array.from(new Set(candidates));
    };

    for (const s of skills) {
      const name = typeof s?.name === 'string' ? s.name.trim() : '';
      if (!name) continue;
      const description = typeof s?.description === 'string' ? s.description.trim() : '';
      const paths = resolveZipPath(s?.path).concat([`skills/${name}/SKILL.md`, `${name}/SKILL.md`, `SKILL.md`]);

      let body = '';
      for (const p of paths) {
        const f = zip.file(p);
        if (!f) continue;
        body = await f.async('string');
        if (body) break;
      }
      if (!body) {
        errors.push(`Skill "${name}" 缺少 SKILL.md (${paths[0] || 'unknown'})`);
        continue;
      }

      upsertUserSkill({
        metadata: {
          name,
          description: description || '(no description)',
          shortDescription: s?.shortDescription ?? null,
          keywords: Array.isArray(s?.keywords) ? s.keywords : [],
          keywordsAll: Array.isArray(s?.keywordsAll) ? s.keywordsAll : [],
          allowedTools: s?.allowedTools ?? null,
          tags: s?.tags ?? null,
          traits: s?.traits ?? null,
          priority: s?.priority ?? 100,
        },
        body,
      });
      imported += 1;
    }

    if (errors.length) {
      console.warn('[Skills] Import errors:', errors);
    }

    if (imported <= 0) throw new Error(errors[0] || '未导入任何 Skill');
    return { imported, errors };
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
