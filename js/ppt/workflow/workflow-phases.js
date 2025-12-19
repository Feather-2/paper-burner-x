/**
 * Workflow Phases Mixin
 * 阶段函数、状态转换、报告配置
 */

import { WorkflowState, transitionWorkflow, forceWorkflowState } from './workflow-states.js';
import {
    ReportAudience,
    ReportLanguage,
    ReportLength,
    ReportTone,
    WorkflowTodoStatus,
    normalizeReportAudience,
    normalizeReportLanguage,
    normalizeReportLength,
    normalizeReportTone,
} from '../../agents/runtime/constants.js';

const REPORT_LENGTHS = new Set(Object.values(ReportLength));
const REPORT_TONES = new Set(Object.values(ReportTone));
const REPORT_AUDIENCES = new Set(Object.values(ReportAudience));
const REPORT_LANGUAGES = new Set(Object.values(ReportLanguage));

export const phasesMixin = {
    async phase2_Scripting() {
        console.log('[Workflow] phase2_Scripting 开始');
        const reportMd = this.workflowData?.report?.markdown || '';
        this.workflowData.reportMarkdown = reportMd;
        const iter = typeof this.workflowData?.deepsearchViz?.iteration === 'number' ? this.workflowData.deepsearchViz.iteration : null;
        this._onReportUpdated?.(reportMd, iter !== null ? `DeepSearch 报告（第 ${iter + 1} 轮）` : 'DeepSearch 报告');

        if (this.state === WorkflowState.RESEARCHING) {
            transitionWorkflow(this, WorkflowState.DEEPSEARCH_REVIEW);
        }
        transitionWorkflow(this, WorkflowState.SCRIPT_REVIEW);
        console.log('[Workflow] 进入 script_review 状态');
        this.addChatMessage('ai', '研究报告已生成。请在中间区域审阅并编辑脚本内容，确认后进入页面规划。');
        this.updateTodos(this._runtimeTodoTexts.map((text, i) => {
            if (i < 2) return { text, status: WorkflowTodoStatus.COMPLETED };
            if (i === 2) return { text, status: WorkflowTodoStatus.ACTIVE };
            return { text, status: WorkflowTodoStatus.PENDING };
        }));
        this.renderPreviewArea();
    },

    updateReportMarkdown(value) {
        if (typeof value !== 'string') return;
        this.workflowData.reportMarkdown = value;
        if (this.workflowData.contentPackage?.report) {
            this.workflowData.contentPackage.report = { ...(this.workflowData.contentPackage.report || {}), markdown: value };
        }
    },

    _setReportConfig(patch = {}) {
        if (!this.workflowData) this.workflowData = {};
        const prev = this.workflowData.reportConfig && typeof this.workflowData.reportConfig === 'object'
            ? this.workflowData.reportConfig
            : {};

        const nextReportLengthCandidate = normalizeReportLength(patch.reportLength) ?? normalizeReportLength(prev.reportLength);
        const nextToneCandidate = normalizeReportTone(patch.tone) ?? normalizeReportTone(prev.tone);
        const nextAudienceCandidate = normalizeReportAudience(patch.audience) ?? normalizeReportAudience(prev.audience);
        const nextLanguageCandidate = normalizeReportLanguage(patch.language) ?? normalizeReportLanguage(prev.language);

        const next = {
            reportLength: REPORT_LENGTHS.has(nextReportLengthCandidate) ? nextReportLengthCandidate : ReportLength.STANDARD,
            tone: REPORT_TONES.has(nextToneCandidate) ? nextToneCandidate : ReportTone.BUSINESS,
            audience: REPORT_AUDIENCES.has(nextAudienceCandidate) ? nextAudienceCandidate : ReportAudience.GENERAL,
            language: REPORT_LANGUAGES.has(nextLanguageCandidate) ? nextLanguageCandidate : ReportLanguage.AUTO,
            enableReviewer: typeof patch.enableReviewer === 'boolean'
                ? patch.enableReviewer
                : (typeof prev.enableReviewer === 'boolean' ? prev.enableReviewer : false),
        };

        this.workflowData.reportConfig = next;

        const applyToUserConfig = (userConfig) => {
            if (!userConfig || typeof userConfig !== 'object') return;
            const write = userConfig.write && typeof userConfig.write === 'object' ? userConfig.write : {};
            userConfig.write = { ...write, writerMode: write.writerMode || 'react', ...next };
        };

        applyToUserConfig(this.workflowData?._deepsearchInput?.userConfig);
        applyToUserConfig(this._deepsearchState?.userConfig);

        this.setAutoSaveNeeded?.();
    },

    updateReportLength(value) {
        const v = normalizeReportLength(value);
        if (!v) return;
        this._setReportConfig({ reportLength: v });
    },

    updateWriteTone(value) {
        const v = normalizeReportTone(value);
        if (!v) return;
        this._setReportConfig({ tone: v });
    },

    updateWriteAudience(value) {
        const v = normalizeReportAudience(value);
        if (!v) return;
        this._setReportConfig({ audience: v });
    },

    updateWriteLanguage(value) {
        const v = normalizeReportLanguage(value);
        if (!v) return;
        this._setReportConfig({ language: v });
    },

    updateEnableReviewer(checked) {
        this._setReportConfig({ enableReviewer: !!checked });
    },

    confirmScript() {
        const md = typeof this.workflowData?.reportMarkdown === 'string'
            ? this.workflowData.reportMarkdown
            : (this.workflowData?.report?.markdown || '');

        this._onReportUpdated?.(md, '当前编辑稿');

        const panel = this._ensureReportReviewPanel?.();
        if (!panel) {
            this._confirmScriptToPageLayout();
            return;
        }

        if (panel.versions.length > 0) {
            panel.selectedVersionIndex = panel.versions.length - 1;
            const v = panel.versions[panel.selectedVersionIndex];
            if (v) v.isNew = false;
            panel.updateBadge();
        }
        panel.open();
    },

    autoFillAnswers() {
        this.submitAnswers();
    },

    async submitAnswers() {
        transitionWorkflow(this, WorkflowState.OUTLINE_REVIEW);
        this.renderPreviewArea();
        this.updateTodos(this._runtimeTodoTexts.map((text, i) => {
            if (i < 2) return { text, status: WorkflowTodoStatus.COMPLETED };
            if (i === 2) return { text, status: WorkflowTodoStatus.ACTIVE };
            return { text, status: WorkflowTodoStatus.PENDING };
        }));
    },

    confirmOutline() {
        transitionWorkflow(this, WorkflowState.OUTLINE_PLANNING);
        this.renderPreviewArea();
        this.phase3_Scripting();
    },

    regenerateOutline() {
        this.addChatMessage('ai', '正在重新生成大纲，请稍候...');
        setTimeout(() => {
            this.renderPreviewArea();
        }, 1000);
    },

    updateOutlineTitle(index, value) {
        if (!this.workflowData.outline) return;
        if (this.workflowData.outline[index]) {
            this.workflowData.outline[index].title = value;
        }
    },

    updateOutlineSub(parentIndex, subIndex, value) {
        if (!this.workflowData.outline) return;
        if (this.workflowData.outline[parentIndex]?.subs?.[subIndex] !== undefined) {
            this.workflowData.outline[parentIndex].subs[subIndex] = value;
        }
    },

    addOutlineSub(parentIndex) {
        if (!this.workflowData.outline) return;
        if (this.workflowData.outline[parentIndex]) {
            this.workflowData.outline[parentIndex].subs.push("新子项");
            this._debouncedRenderOutline();
        }
    },

    removeOutlineSub(parentIndex, subIndex) {
        if (!this.workflowData.outline) return;
        if (this.workflowData.outline[parentIndex]?.subs?.[subIndex] !== undefined) {
            this.workflowData.outline[parentIndex].subs.splice(subIndex, 1);
            this._debouncedRenderOutline();
        }
    },

    _debouncedRenderOutline() {
        clearTimeout(this._outlineRenderTimer);
        this._outlineRenderTimer = setTimeout(() => {
            this.renderPreviewArea();
        }, 100);
    },

    async phase3_Scripting() {
        await this._orchestrator.runStage('textprep.slideplan');
        this.phase4_Segmentation();
    },

    async phase3_PageLayout() {
        console.log('[Workflow] phase3_PageLayout 开始');
        try {
            if (this.workflowData?._needsTextPrep) {
                console.log('[Workflow] 执行 textprep.slideplan');
                await this._orchestrator.runStage('textprep.slideplan');
                this.workflowData._needsTextPrep = false;
            }
            console.log('[Workflow] 执行 textprep.align');
            await this._orchestrator.runStage('textprep.align', { contentPackage: this.workflowData.contentPackage });

            const contentPackage = this.workflowData?.contentPackage;
            await this._saveCheckpoint?.('design.layout', {
                slideCount: Array.isArray(contentPackage?.slideIntents) ? contentPackage.slideIntents.length : undefined,
            });

            transitionWorkflow(this, WorkflowState.PAGE_LAYOUT);
            this.renderPreviewArea?.();
            this.addChatMessage?.('ai', '页面规划完成。请审阅并编辑页面结构，确认后点击「继续设计」。');
        } catch (err) {
            console.error('[Workflow] phase3_PageLayout 失败:', err);
            const recovered = await this._tryRecoverFromCheckpoint?.('design.script');
            if (recovered) {
                const msg = err instanceof Error ? err.message : String(err || 'unknown error');
                this.addChatMessage?.('ai', `页面规划失败，已恢复到上一个检查点。错误: ${msg}`);
                return;
            }
            this._abortWorkflow(err);
        }
    },

    async phase4_Segmentation() {
        await this._orchestrator.runStage('textprep.align');
        this.phase5_DesignOptimization();
    },

    async phase5_DesignOptimization() {
        console.log('[Workflow] phase5_DesignOptimization 开始');
        try {
            this._ensureDesignSystemInitialized();
            console.log('[Workflow] 执行 design.batch');
            const baseContentPackage = this.workflowData?.contentPackage;
            const brainstormCandidates = this.workflowData?.brainstormCandidates;
            const contentPackage =
                baseContentPackage && typeof baseContentPackage === 'object' && brainstormCandidates && typeof brainstormCandidates === 'object'
                    ? { ...baseContentPackage, brainstormCandidates }
                    : baseContentPackage;

            const deckPackage = await this._orchestrator.runStage('design.batch', { contentPackage, brainstormCandidates });

            await this._saveCheckpoint?.('design.batch', {
                slideCount: Array.isArray(deckPackage?.slidesMeta) ? deckPackage.slidesMeta.length : undefined,
                degradedCount: typeof deckPackage?.editHints?.degradedCount === 'number' ? deckPackage.editHints.degradedCount : undefined,
            });

            this.phase6_FinalReview();
        } catch (err) {
            console.error('[Workflow] phase5_DesignOptimization 失败:', err);
            const recovered = await this._tryRecoverFromCheckpoint?.('design.layout');
            if (recovered) {
                const msg = err instanceof Error ? err.message : String(err || 'unknown error');
                this.addChatMessage?.('ai', `视觉设计失败，已恢复到上一个检查点。错误: ${msg}`);
                return;
            }
            this._abortWorkflow(err);
        }
    },

    async phase6_FinalReview() {
        console.log('[Workflow] phase6_FinalReview 开始');
        try {
            console.log('[Workflow] 执行 evaluate.hardgates');
            await this._orchestrator.runStage('evaluate.hardgates');
            this._orchestrator.end();
        } catch (err) {
            console.error('[Workflow] phase6_FinalReview 失败:', err);
            this._abortWorkflow(err);
            return;
        }

        console.log('[Workflow] 工作流完成，进入 completed 状态');
        transitionWorkflow(this, WorkflowState.COMPLETED);
        this.currentProject.status = 'completed';
        this._saveProject();

        this.addChatMessage('ai', '任务完成。演示文稿已生成。');
        setTimeout(() => this.renderPreviewArea(), 1000);
    },

    _setAgentStatus(id, status, activity) {
        this.agents[id] = { status, activity };
        this.renderPreviewArea();
    },

    _renderFileGrid(files) {
        const grid = document.getElementById('fileProcessingGrid');
        if (!grid) return;

        grid.innerHTML = files.map((f, i) => `
            <div class="gen-file-item" id="file-node-${i}">
                <div class="gen-file-icon">
                    <iconify-icon icon="carbon:document"></iconify-icon>
                </div>
                <div class="gen-file-name">${f.name}</div>
                <div class="gen-file-status">
                    <span class="file-percent">0%</span>
                </div>
            </div>
        `).join('');
    },

    async _simulateParallelReading(files, targetProgress = 100) {
        const updates = files.map(() => ({ progress: 0 }));

        return new Promise(resolve => {
            const interval = setInterval(() => {
                let allReached = true;
                files.forEach((_, i) => {
                    if (updates[i].progress < targetProgress) {
                        updates[i].progress += Math.random() * 5;
                        if (updates[i].progress > targetProgress) updates[i].progress = targetProgress;

                        const node = document.getElementById(`file-node-${i}`);
                        if (node) {
                            node.querySelector('.file-percent').innerText = `${Math.floor(updates[i].progress)}%`;
                            if (updates[i].progress === 100) {
                                node.querySelector('.gen-file-status').innerHTML = '<iconify-icon icon="carbon:checkmark-filled" style="color: var(--ppt-success)"></iconify-icon>';
                            }
                        }
                        allReached = false;
                    }
                });

                if (allReached) {
                    clearInterval(interval);
                    resolve();
                }
            }, 100);
        });
    },

    async logTerminal(agent, msg, type = 'normal') {
        const entry = { time: new Date().toLocaleTimeString(), agent, msg, type };
        this.processLogs.push(entry);
        this.currentProject.logs = this.processLogs;
        this._saveProject();
        this._appendLogToTerminal(entry);

        if (typeof this.addProcessPanelStep === 'function') {
            this.addProcessPanelStep({
                name: `log.${type}`,
                text: msg,
                details: { agent }
            });
        }

        await new Promise(r => setTimeout(r, 300));
    },

    _appendLogToTerminal(log) {
        const term = document.getElementById('agentTerminal');
        if (!term) return;

        term.innerHTML = `
            <div class="gen-log-dot"></div>
            <div class="gen-log-content">
                <span style="font-weight: 600; color: var(--ppt-accent);">${log.agent}:</span>
                <span>${log.msg}</span>
            </div>
        `;
    },

    _abortWorkflow(err) {
        const msg = err instanceof Error ? err.message : String(err || 'unknown error');
        try {
            this._orchestrator?.stop?.('workflow_failed');
        } catch {
            // ignore
        }
        forceWorkflowState(this, WorkflowState.FAILED);
        this.currentProject.status = 'failed';
        this._saveProject?.();
        this.addChatMessage('ai', `流程已中止：${msg}`);
        this.renderPreviewArea();
    }
};
