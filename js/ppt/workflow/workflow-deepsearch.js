/**
 * Workflow DeepSearch Mixin
 * DeepSearch 执行流程、可视化状态同步
 */

import { DEFAULT_TASK_GOAL } from './workflow-constants.js';

export const deepsearchMixin = {
    _ensureDeepSearchViz() {
        if (!this.workflowData) this.workflowData = {};
        if (!this.workflowData.deepsearchViz) this._resetDeepSearchViz();
    },

    _upsertDeepSearchVizGap(detail) {
        if (!detail || typeof detail !== 'object') return;
        const gid = typeof detail.gapId === 'string' ? detail.gapId : String(detail.gapId || '').trim();
        if (!gid) return;

        const viz = this.workflowData.deepsearchViz;
        const gaps = Array.isArray(viz.gaps) ? viz.gaps : [];
        const idx = gaps.findIndex(g => g?.gapId === gid);
        const next = {
            ...(idx >= 0 && gaps[idx] && typeof gaps[idx] === 'object' ? gaps[idx] : {}),
            gapId: gid,
            ...(detail.type ? { type: detail.type } : {}),
            ...(detail.question ? { question: detail.question } : {}),
            ...(detail.priority ? { priority: detail.priority } : {}),
            ...(detail.status ? { status: detail.status } : {}),
            ...(typeof detail.missCount === 'number' ? { missCount: detail.missCount } : {}),
            ...(detail.blockedReason ? { blockedReason: detail.blockedReason } : {}),
        };
        if (idx >= 0) gaps[idx] = next;
        else gaps.push(next);
        viz.gaps = gaps;
    },

    _scheduleVizRerender() {
        if (this._vizRerenderTimer) return;
        this._vizRerenderTimer = setTimeout(() => {
            this._vizRerenderTimer = null;
            if (this._deepsearchFlowViz) return;
            if (this.state === 'researching' || this.state === 'deepsearch_review') {
                this.renderPreviewArea?.();
            }
        }, 200);
    },
    async startMultiAgentWorkflow({ skipBriefCheck = false } = {}) {
        // 防止重复触发
        if (this._workflowLock) {
            console.warn('[Workflow] startMultiAgentWorkflow 已在运行中，忽略重复调用');
            if (typeof this.logTerminal === 'function') {
                this.logTerminal('系统', '工作流已在运行中，请勿重复点击', 'warning');
            }
            return;
        }

        const files = Array.isArray(this.workflowData?.files) ? this.workflowData.files : [];
        if (!files.length) {
            this.addChatMessage('ai', '请先上传至少一个文档或粘贴文本素材。');
            return;
        }

        this._ensureDesignSystemInitialized();
        const taskGoal = this._deriveTaskGoal();
        if (!skipBriefCheck && (!taskGoal || taskGoal === DEFAULT_TASK_GOAL)) {
            this._pendingStartAfterBrief = true;
            this.openProjectBriefForm();
            return;
        }

        // 设置锁
        this._workflowLock = true;
        console.log('[Workflow] startMultiAgentWorkflow 开始执行');

        const brief = this.workflowData?.projectBrief || {};
        const constraints = {
            ...(typeof brief?.audience === 'string' && brief.audience.trim() ? { audience: brief.audience.trim() } : {}),
            ...(typeof brief?.tone === 'string' && brief.tone.trim() ? { tone: brief.tone.trim() } : {}),
        };

        await this._ensureRuntime({ constraints });
        this._orchestrator.start();
        this._resetDeepSearchViz();

        try {
            await this.phase1_DeepReading();
        } catch (err) {
            this._abortWorkflow(err);
        } finally {
            // 释放锁
            this._workflowLock = false;
            console.log('[Workflow] startMultiAgentWorkflow 执行完毕');
        }
    },
    async phase1_DeepReading() {
        const files = Array.isArray(this.workflowData.files) ? this.workflowData.files : [];
        if (!files.length) {
            this.addChatMessage('ai', '请先上传至少一个文档或粘贴文本素材。');
            return;
        }

        const taskGoal = this._deriveTaskGoal();
        if (!taskGoal || taskGoal === DEFAULT_TASK_GOAL) {
            this._pendingStartAfterBrief = true;
            this.openProjectBriefForm();
            return;
        }

        this._renderFileGrid(files);

        const ingestInput = this._buildIngestInputFromWorkflowFiles(files);

        // 如果有预构建的 sources（来自粘贴的长文本），直接使用
        const prebuiltSources = Array.isArray(ingestInput.sources) ? ingestInput.sources : [];
        const hasPrebuiltSources = prebuiltSources.length > 0;

        let sources = [];
        if (hasPrebuiltSources && !ingestInput.files.length && !ingestInput.urls.length && !ingestInput.rawTexts.length && !ingestInput.historyIds.length) {
            // 只有预构建的 sources，跳过 ingest 阶段
            sources = prebuiltSources;
            this.workflowData.ingest = { sources, skipped: true };
            if (typeof this.logTerminal === 'function') {
                this.logTerminal('系统', '使用已解析的文档内容，跳过文件读取阶段', 'normal');
            }
        } else {
            // 正常运行 ingest 阶段
            const ingestOut = await this._orchestrator.runStage('deepsearch.ingest', ingestInput);
            this.workflowData.ingest = ingestOut;
            sources = Array.isArray(ingestOut?.sources) ? ingestOut.sources : [];
            // 合并预构建的 sources
            if (prebuiltSources.length) {
                sources = [...prebuiltSources, ...sources];
            }
        }

        const mode = this.workflowMode || this.workflowData?.workflowMode || 'auto';
        const stepping = mode !== 'auto';

        // DeepSearch 优化参数配置
        const reportConfig = this.workflowData?.reportConfig && typeof this.workflowData.reportConfig === 'object'
            ? this.workflowData.reportConfig
            : {};
        const allowedReportLengths = new Set(['brief', 'standard', 'detailed', 'comprehensive']);
        const allowedWriteTones = new Set(['academic', 'business', 'casual']);
        const allowedWriteAudiences = new Set(['expert', 'general', 'executive']);
        const userConfig = {
            title: this.currentProject?.title || 'New Mission',
            ...(stepping ? { maxIterations: 1 } : {}),
            // Task 1: 工具链配置
            retrieval: {
                enableToolChain: true,  // 启用工具链
                minGrepHits: 15,        // 提高阈值，减少 BM25 调用
                bm25MinScore: 0.5,      // BM25 结果质量阈值
            },
            // Task 3: 迭代策略配置
            gaps: {
                blockAfterMisses: 5,    // 允许更多轮次尝试
            },
            // ReAct Writer: 问题驱动的渐进式写作
            write: {
                writerMode: 'react',
                reportLength: allowedReportLengths.has(reportConfig.reportLength) ? reportConfig.reportLength : 'standard',
                tone: allowedWriteTones.has(reportConfig.tone) ? reportConfig.tone : 'business',
                audience: allowedWriteAudiences.has(reportConfig.audience) ? reportConfig.audience : 'general',
                enableReviewer: !!reportConfig.enableReviewer,
            },
        };

        this.workflowData._deepsearchInput = { sources, taskGoal, userConfig };

        const { DeepSearchState } = await import('../../agents/stages/deepsearch/state.js');
        const runId = this._orchestrator?.runContext?.runId || `run_${Date.now()}`;
        const state = new DeepSearchState({ runId, taskGoal, userConfig, L0: { sources } });
        this._deepsearchState = state;
        this._syncDeepSearchVizFromState(state);

        let pkg = null;
        try {
            pkg = await this._orchestrator.runStage('deepsearch.pipeline', { state });
            console.log('[Workflow] deepsearch.pipeline 完成，准备转换状态', { mode, hasPkg: !!pkg });
        } catch (err) {
            console.error('[Workflow] deepsearch.pipeline 失败:', err);
            const recovered = await this._tryRecoverFromCheckpoint?.('deepsearch.complete');
            if (recovered) {
                const msg = err instanceof Error ? err.message : String(err || 'unknown error');
                this.addChatMessage?.('ai', `DeepSearch 执行失败，已恢复到最近检查点。错误: ${msg}`);
                return;
            }
            throw err;
        }

        this.workflowData.contentPackage = pkg;
        this.workflowData.report = pkg?.report || null;
        this.workflowData.slideIntents = pkg?.slideIntents || [];
        this._onReportUpdated?.(pkg?.report?.markdown || '', `DeepSearch 报告（第 ${(typeof state?.iteration === 'number' ? state.iteration : 0) + 1} 轮）`);

        this._syncDeepSearchVizFromState(state);

        await this._saveCheckpoint?.('deepsearch.complete', {
            reportTitle: pkg?.report?.title,
            slideCount: Array.isArray(pkg?.slideIntents) ? pkg.slideIntents.length : undefined,
        });

        if (mode === 'auto') {
            console.log('[Workflow] Auto 模式，继续执行 phase2_Scripting');
            await this.phase2_Scripting();
            return;
        }

        console.log('[Workflow] 非 Auto 模式，进入 deepsearch_review 状态');
        this.state = 'deepsearch_review';
        this.addChatMessage('ai', 'DeepSearch 已完成当前轮次。您可以继续下一轮迭代，或进入脚本编辑。');
        this.renderPreviewArea();
    },
    _deriveTaskGoal() {
        const briefGoal = typeof this.workflowData?.projectBrief?.taskGoal === 'string' ? this.workflowData.projectBrief.taskGoal.trim() : '';
        if (briefGoal) return briefGoal;

        // Legacy fallback: older UI may write taskGoal directly.
        const legacy = typeof this.workflowData?.taskGoal === 'string' ? this.workflowData.taskGoal.trim() : '';
        if (legacy) return legacy;

        return DEFAULT_TASK_GOAL;
    },
    async continueDeepSearchIteration() {
        const mode = this.workflowMode || this.workflowData?.workflowMode || 'auto';
        if (mode === 'auto') {
            this.addChatMessage('ai', '当前为 Auto-pilot 模式，无需手动触发下一轮。');
            return;
        }

        if (!this._orchestrator || this._orchestrator.state !== 'running') {
            const brief = this.workflowData?.projectBrief || {};
            const constraints = {
                ...(typeof brief?.audience === 'string' && brief.audience.trim() ? { audience: brief.audience.trim() } : {}),
                ...(typeof brief?.tone === 'string' && brief.tone.trim() ? { tone: brief.tone.trim() } : {}),
            };
            await this._ensureRuntime({ constraints });
            this._orchestrator.start();
        }

        const input = this.workflowData?._deepsearchInput || {};
        const taskGoal = typeof input.taskGoal === 'string' ? input.taskGoal : this._deriveTaskGoal();
        const sources = Array.isArray(input.sources) ? input.sources : Array.isArray(this.workflowData?.ingest?.sources) ? this.workflowData.ingest.sources : [];

        // 优化参数配置（与 phase1_DeepReading 保持一致）
        const reportConfig = this.workflowData?.reportConfig && typeof this.workflowData.reportConfig === 'object'
            ? this.workflowData.reportConfig
            : {};
        const allowedReportLengths = new Set(['brief', 'standard', 'detailed', 'comprehensive']);
        const allowedWriteTones = new Set(['academic', 'business', 'casual']);
        const allowedWriteAudiences = new Set(['expert', 'general', 'executive']);
        const baseUserConfig = input.userConfig && typeof input.userConfig === 'object'
            ? input.userConfig
            : {
                title: this.currentProject?.title || 'New Mission',
                retrieval: { enableToolChain: true, minGrepHits: 15, bm25MinScore: 0.5 },
                gaps: { blockAfterMisses: 5 },
                write: { writerMode: 'react' },
            };

        const writeCfg = baseUserConfig.write && typeof baseUserConfig.write === 'object' ? baseUserConfig.write : {};
        baseUserConfig.write = {
            ...writeCfg,
            writerMode: writeCfg.writerMode || 'react',
            reportLength: allowedReportLengths.has(writeCfg.reportLength)
                ? writeCfg.reportLength
                : (allowedReportLengths.has(reportConfig.reportLength) ? reportConfig.reportLength : 'standard'),
            tone: allowedWriteTones.has(writeCfg.tone)
                ? writeCfg.tone
                : (allowedWriteTones.has(reportConfig.tone) ? reportConfig.tone : 'business'),
            audience: allowedWriteAudiences.has(writeCfg.audience)
                ? writeCfg.audience
                : (allowedWriteAudiences.has(reportConfig.audience) ? reportConfig.audience : 'general'),
            enableReviewer: typeof writeCfg.enableReviewer === 'boolean'
                ? writeCfg.enableReviewer
                : !!reportConfig.enableReviewer,
        };

        if (!this._deepsearchState) {
            const { DeepSearchState } = await import('../../agents/stages/deepsearch/state.js');
            const runId = this._orchestrator?.runContext?.runId || `run_${Date.now()}`;
            this._deepsearchState = new DeepSearchState({ runId, taskGoal, userConfig: baseUserConfig, L0: { sources } });
        }

        const state = this._deepsearchState;
        state.taskGoal = taskGoal;
        state.userConfig = { ...(state.userConfig || {}), ...(baseUserConfig || {}) };
        state.L0 = { ...(state.L0 || {}), sources };

        // Guided/Manual: run exactly one extra iteration each time.
        state.maxIterations = Math.max(1, (typeof state.iteration === 'number' ? state.iteration : 0) + 1);
        this._syncDeepSearchVizFromState(state);

        this.state = 'researching';
        this.renderPreviewArea();

        try {
            const pkg = await this._orchestrator.runStage('deepsearch.pipeline', { state });
            this.workflowData.contentPackage = pkg;
            this.workflowData.report = pkg?.report || null;
            this.workflowData.slideIntents = pkg?.slideIntents || [];
            this._onReportUpdated?.(pkg?.report?.markdown || '', `DeepSearch 报告（第 ${state.iteration + 1} 轮）`);
            this._syncDeepSearchVizFromState(state);
            this.state = 'deepsearch_review';
            this.renderPreviewArea();
            await this._saveCheckpoint?.('deepsearch.complete', {
                reportTitle: pkg?.report?.title,
                slideCount: Array.isArray(pkg?.slideIntents) ? pkg.slideIntents.length : undefined,
            });
        } catch (err) {
            const recovered = await this._tryRecoverFromCheckpoint?.('deepsearch.complete');
            if (recovered) {
                const msg = err instanceof Error ? err.message : String(err || 'unknown error');
                this.addChatMessage?.('ai', `DeepSearch 执行失败，已恢复到最近检查点。错误: ${msg}`);
                return;
            }
            this._abortWorkflow(err);
        }
    },
    proceedToScriptReview() {
        this.phase2_Scripting();
    },
    _resetDeepSearchViz() {
        if (!this.workflowData) this.workflowData = {};
        this.workflowData.deepsearchViz = {
            iteration: 0,
            maxIterations: 1,
            lastCompletedIteration: null,
            openGapCount: 0,
            gaps: [],
            updatedAt: Date.now(),
            // 新增：阶段追踪
            currentPhase: null,          // 当前阶段: scan, gaps, retrieve, understand, write, condense
            phaseHistory: [],             // 阶段历史记录
            stageMetrics: {               // 每个阶段的指标
                scan: { status: 'pending', startedAt: null, completedAt: null, detail: null },
                gaps: { status: 'pending', startedAt: null, completedAt: null, detail: null },
                retrieve: { status: 'pending', startedAt: null, completedAt: null, detail: null },
                understand: { status: 'pending', startedAt: null, completedAt: null, detail: null },
                write: { status: 'pending', startedAt: null, completedAt: null, detail: null },
            },
        };
    },
    _syncDeepSearchVizFromState(state) {
        if (!this.workflowData) this.workflowData = {};
        if (!this.workflowData.deepsearchViz) this._resetDeepSearchViz();
        const viz = this.workflowData.deepsearchViz;

        viz.iteration = typeof state?.iteration === 'number' ? state.iteration : 0;
        viz.maxIterations = typeof state?.maxIterations === 'number' ? state.maxIterations : viz.maxIterations;
        const gaps = Array.isArray(state?.L1?.gaps) ? state.L1.gaps : [];
        viz.gaps = gaps.map(g => ({
            gapId: g?.gapId,
            type: g?.type,
            question: g?.question,
            priority: g?.priority,
            status: g?.status,
            missCount: g?.missCount,
            blockedReason: g?.blockedReason,
        }));
        viz.openGapCount = gaps.filter(g => (g?.status ? String(g.status) : 'open') === 'open').length;
        viz.updatedAt = Date.now();
    },
};
