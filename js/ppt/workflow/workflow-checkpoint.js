/**
 * Workflow Checkpoint Mixin
 * 检查点保存/恢复、进度恢复 UI
 */

import { WorkflowState, transitionWorkflow, forceWorkflowState } from './workflow-states.js';
import { WorkflowTodoStatus } from '../../agents/runtime/core/constants.js';

let _CheckpointModule = null;
async function getCheckpointModule() {
    if (_CheckpointModule) return _CheckpointModule;
    const mod = await import('../storage/checkpoint-manager.js');
    _CheckpointModule = mod;
    return mod;
}

export const checkpointMixin = {
    _getCheckpointProjectId() {
        const id = this.currentProject?.id;
        if (typeof id === 'string' && id.trim()) return id.trim();
        return 'default';
    },

    async _ensureCheckpointManager() {
        if (this._checkpointManager && this._checkpointProjectId === this._getCheckpointProjectId()) return this._checkpointManager;

        const hasWindow = typeof window !== 'undefined';
        const hasLocalStorage = hasWindow && typeof window.localStorage !== 'undefined' && window.localStorage;
        if (!hasLocalStorage) return null;

        try {
            const { CheckpointManager } = await getCheckpointModule();
            const projectId = this._getCheckpointProjectId();
            this._checkpointManager = new CheckpointManager(projectId);
            this._checkpointProjectId = projectId;
            return this._checkpointManager;
        } catch (e) {
            console.warn('[Checkpoint] Init failed:', e);
            return null;
        }
    },

    _buildCheckpointStateSnapshot(stage) {
        const state = this._deepsearchState;
        const snapshot = state && typeof state.toJSON === 'function' ? state.toJSON() : (state && typeof state === 'object' ? state : {});

        const contentPackage = this.workflowData?.contentPackage;
        const reportMarkdown = this.workflowData?.reportMarkdown;
        const designPhase = this.workflowData?.designPhase;
        const slideStatuses = this.workflowData?.slideStatuses;
        const includeDeck = stage === 'design.batch';
        const deckPackage = includeDeck ? this.workflowData?.deckPackage : null;

        return {
            ...(snapshot && typeof snapshot === 'object' ? snapshot : {}),
            ...(contentPackage ? { contentPackage } : {}),
            ...(deckPackage ? { deckPackage } : {}),
            ...(typeof reportMarkdown === 'string' ? { reportMarkdown } : {}),
            ...(designPhase && typeof designPhase === 'object' ? { designPhase } : {}),
            ...(slideStatuses && typeof slideStatuses === 'object' ? { slideStatuses } : {}),
            workflowUiState: this.state,
        };
    },

    async _saveCheckpoint(stage, metadata = {}) {
        const mgr = await this._ensureCheckpointManager();
        if (!mgr) return null;

        // 语义存证：如果 metadata 中包含 failureReason，则存入 state
        if (metadata.failureReason && this._deepsearchState) {
            if (!this._deepsearchState.L2) this._deepsearchState.L2 = {};
            if (!Array.isArray(this._deepsearchState.L2.thoughtHistory)) {
                this._deepsearchState.L2.thoughtHistory = [];
            }
            this._deepsearchState.L2.thoughtHistory.push({
                ts: new Date().toISOString(),
                stage,
                reason: metadata.failureReason
            });
        }

        const snapshot = this._buildCheckpointStateSnapshot(stage);
        const cp = mgr.save(stage, snapshot, metadata);
        this._refreshRecoveryButton?.();
        return cp;
    },

    async _applyCheckpoint(checkpoint) {
        if (!checkpoint?.state || typeof checkpoint.state !== 'object') return false;

        const { DeepSearchState } = await import('../../agents/stages/deepsearch/state.js');
        try {
            this._deepsearchState = DeepSearchState.fromJSON(checkpoint.state);
        } catch (e) {
            console.warn('[Workflow] DeepSearchState.fromJSON failed:', e);
            return false;
        }

        if (!this.workflowData) this.workflowData = {};
        const st = checkpoint.state;

        if (st.contentPackage) this.workflowData.contentPackage = st.contentPackage;
        if (st.contentPackage?.report) this.workflowData.report = st.contentPackage.report;
        if (Array.isArray(st.contentPackage?.slideIntents)) this.workflowData.slideIntents = st.contentPackage.slideIntents;

        if (st.deckPackage) this.workflowData.deckPackage = st.deckPackage;
        if (typeof st.deckPackage?.deckHtmlDsl === 'string') this.workflowData.deckHtmlDsl = st.deckPackage.deckHtmlDsl;
        if (typeof st.deckHtmlDsl === 'string' && typeof this.workflowData.deckHtmlDsl !== 'string') this.workflowData.deckHtmlDsl = st.deckHtmlDsl;
        if (typeof st.reportMarkdown === 'string') this.workflowData.reportMarkdown = st.reportMarkdown;
        if (st.designPhase && typeof st.designPhase === 'object') this.workflowData.designPhase = st.designPhase;
        if (st.slideStatuses && typeof st.slideStatuses === 'object') this.workflowData.slideStatuses = st.slideStatuses;

        this._syncDeepSearchVizFromState?.(this._deepsearchState);
        return true;
    },

    async _tryRecoverFromCheckpoint(preferredStage) {
        const mgr = await this._ensureCheckpointManager();
        if (!mgr) return false;

        const checkpoint = (preferredStage && mgr.getLatestByStage(preferredStage)) || mgr.getLatest();
        if (!checkpoint) return false;

        const ok = await this._applyCheckpoint(checkpoint);
        if (!ok) return false;

        try {
            const brief = this.workflowData?.projectBrief || {};
            const constraints = {
                ...(typeof brief?.audience === 'string' && brief.audience.trim() ? { audience: brief.audience.trim() } : {}),
                ...(typeof brief?.tone === 'string' && brief.tone.trim() ? { tone: brief.tone.trim() } : {}),
            };
            if (!this._orchestrator || (this._orchestrator.state !== 'running' && this._orchestrator.state !== 'idle')) {
                await this._ensureRuntime?.({ constraints });
            }
        } catch {
            // ignore
        }

        const stage = checkpoint.stage || '';
        if (stage === 'deepsearch.complete') {
            forceWorkflowState(this, WorkflowState.SCRIPT_REVIEW);
            this.updateTodos?.(this._runtimeTodoTexts.map((text, i) => {
                if (i < 2) return { text, status: WorkflowTodoStatus.COMPLETED };
                if (i === 2) return { text, status: WorkflowTodoStatus.ACTIVE };
                return { text, status: WorkflowTodoStatus.PENDING };
            }));
        } else if (stage.startsWith('deepsearch')) {
            forceWorkflowState(this, WorkflowState.DEEPSEARCH_REVIEW);
        } else if (stage === 'design.script') {
            forceWorkflowState(this, WorkflowState.SCRIPT_REVIEW);
        } else if (stage === 'design.layout') {
            forceWorkflowState(this, WorkflowState.PAGE_LAYOUT);
        } else if (stage.startsWith('design')) {
            forceWorkflowState(this, WorkflowState.DESIGNER);
        }

        this.renderPreviewArea?.();
        console.log('[Workflow] Recovered from checkpoint:', checkpoint.stage, { id: checkpoint.id });
        return true;
    },

    hasRecoverableProgress() {
        return this._checkpointManager?.hasRecoverable?.() || false;
    },

    getRecoverySummary() {
        return this._checkpointManager?.getRecoverySummary?.() || null;
    },

    async recoverProgress() {
        const mgr = await this._ensureCheckpointManager();
        const latest = mgr?.getLatest?.();
        if (!latest) return false;

        const ok = await this._tryRecoverFromCheckpoint(latest.stage);
        if (ok) {
            const stage = latest.stage || 'unknown';
            let stageName = stage;
            try {
                const { getStageName } = await getCheckpointModule();
                stageName = getStageName(stage);
            } catch {
                // ignore
            }
            this.addChatMessage?.('ai', `已恢复上次进度：${stageName}`);
        }
        return ok;
    },

    _ensureRecoveryButton() {
        if (typeof document === 'undefined') return;
        if (document.getElementById('pptRecoveryButton')) return;
        const host = this.elements?.overlay || document.getElementById('pptGeneratorOverlay') || document.body;
        if (!host) return;

        const btn = document.createElement('button');
        btn.id = 'pptRecoveryButton';
        btn.type = 'button';
        btn.style.cssText = [
            'position: fixed',
            'right: 16px',
            'bottom: 16px',
            'z-index: 99999',
            'padding: 10px 12px',
            'border-radius: 10px',
            'border: 1px solid rgba(148,163,184,0.35)',
            'background: rgba(15,23,42,0.92)',
            'color: #e2e8f0',
            'font-size: 13px',
            'cursor: pointer',
            'display: none',
            'backdrop-filter: blur(6px)',
            '-webkit-backdrop-filter: blur(6px)',
        ].join(';');
        btn.textContent = '恢复上次进度';
        btn.addEventListener('click', async () => {
            const summary = await this._getRecoverySummaryAsync?.();
            const stageLabel = summary?.stageName ? `（${summary.stageName}）` : '';
            const ok = typeof window !== 'undefined' && typeof window.confirm === 'function'
                ? window.confirm(`恢复上次进度${stageLabel}？这将覆盖当前未保存的操作。`)
                : true;
            if (!ok) return;
            await this.recoverProgress?.();
        });

        host.appendChild(btn);
    },

    async _getRecoverySummaryAsync() {
        const mgr = await this._ensureCheckpointManager();
        const summary = mgr?.getRecoverySummary?.();
        if (!summary) return null;

        let stageName = summary.stage;
        try {
            const { getStageName } = await getCheckpointModule();
            stageName = getStageName(summary.stage);
        } catch {
            // ignore
        }

        return { ...summary, stageName };
    },

    _refreshRecoveryButton() {
        Promise.resolve().then(async () => {
            if (typeof document === 'undefined') return;
            const btn = document.getElementById('pptRecoveryButton');
            if (!btn) return;

            const summary = await this._getRecoverySummaryAsync?.();
            if (!summary?.canRecover) {
                btn.style.display = 'none';
                return;
            }

            btn.style.display = 'block';
            const ts = summary.timestamp ? new Date(summary.timestamp).toLocaleString() : '';
            btn.title = ts ? `${summary.stageName || summary.stage}\n${ts}` : (summary.stageName || summary.stage);
        });
    },
};
