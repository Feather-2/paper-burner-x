/**
 * Workflow DeepSearch Mixin
 * DeepSearch 执行流程、可视化状态同步
 */

import { WorkflowState, transitionWorkflow, forceWorkflowState } from './workflow-states.js';
import { ReportAudience, ReportLength, ReportTone } from '../../agents/runtime/constants.js';
import { DEFAULT_TASK_GOAL } from './workflow-constants.js';

const REPORT_LENGTHS = new Set(Object.values(ReportLength));
const REPORT_TONES = new Set(Object.values(ReportTone));
const REPORT_AUDIENCES = new Set(Object.values(ReportAudience));

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

    _upsertDeepSearchVizTodo(detail) {
        if (!detail || typeof detail !== 'object') return;
        const tid = typeof detail.todoId === 'string' ? detail.todoId : String(detail.todoId || '').trim();
        if (!tid) return;

        const viz = this.workflowData.deepsearchViz;
        const todos = Array.isArray(viz.todos) ? viz.todos : [];
        const idx = todos.findIndex(t => t?.todoId === tid);
        const next = {
            ...(idx >= 0 && todos[idx] && typeof todos[idx] === 'object' ? todos[idx] : {}),
            todoId: tid,
            ...(detail.text ? { text: detail.text } : {}),
            ...(detail.priority ? { priority: detail.priority } : {}),
            ...(detail.status ? { status: detail.status } : {}),
            ...(detail.source ? { source: detail.source } : {}),
        };
        if (idx >= 0) todos[idx] = next;
        else todos.push(next);
        viz.todos = todos;
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

        // 获取生成模式
        const generationMode = this.workflowData?.generationMode || 'deepsearch';
        console.log('[Workflow] startMultiAgentWorkflow 生成模式:', generationMode);

        // 根据生成模式分流
        if (generationMode === 'simple') {
            // 快速生成：跳过深度研究，直接读取内容生成
            await this._startSimpleGeneration();
            return;
        }

        if (generationMode === 'planned') {
            // 规划模式：扫描内容，打开大纲规划器
            await this._startPlannedGeneration();
            return;
        }

        // 深度研究模式（默认）
        // 设置锁
        this._workflowLock = true;
        console.log('[Workflow] startMultiAgentWorkflow 开始执行 (deepsearch)');

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

    /**
     * 快速生成模式：直接读取素材内容，生成 slideIntents，调用设计引擎
     */
    async _startSimpleGeneration() {
        this._workflowLock = true;
        console.log('[Workflow] _startSimpleGeneration 开始');

        try {
            transitionWorkflow(this, WorkflowState.READING);
            this.renderPreviewArea?.();
            this.addChatMessage?.('ai', '正在读取素材内容...');

            // 合并所有素材内容
            const files = Array.isArray(this.workflowData?.files) ? this.workflowData.files : [];
            let combinedContent = '';
            let title = '';

            for (const file of files) {
                if (file.type === 'paste' && file.content) {
                    combinedContent += file.content + '\n\n';
                    if (!title && file.name) title = file.name;
                } else if (file.file && typeof file.file.text === 'function') {
                    try {
                        const text = await file.file.text();
                        combinedContent += text + '\n\n';
                        if (!title && file.name) title = file.name;
                    } catch (e) {
                        console.warn('[SimpleGeneration] 读取文件失败:', file.name, e);
                    }
                }
            }

            if (!combinedContent.trim()) {
                this.addChatMessage?.('ai', '未能读取到有效内容，请检查素材文件。');
                transitionWorkflow(this, WorkflowState.IDLE);
                this.renderPreviewArea?.();
                return;
            }

            // 生成 slideIntents
            const slideIntents = this._generateSlideIntentsFromMarkdown?.(combinedContent) || [];
            if (!slideIntents.length) {
                slideIntents.push({
                    slideIntentId: 'si_0',
                    index: 0,
                    pageType: 'content',
                    title: title || '内容',
                    content: combinedContent,
                    keyPoints: []
                });
            }

            // 设置 contentPackage
            this.workflowData.contentPackage = {
                schemaVersion: '0.1',
                title: title || '演示文稿',
                slideIntents
            };
            this.workflowData.slideIntents = slideIntents;

            this.addChatMessage?.('ai', `已解析 ${slideIntents.length} 个页面，正在调用设计引擎...`);

            // 调用设计引擎
            await this._ensureRuntime?.({ mode: 'textprep' });
            transitionWorkflow(this, WorkflowState.SCRIPT_REVIEW);
            transitionWorkflow(this, WorkflowState.PAGE_LAYOUT);
            transitionWorkflow(this, WorkflowState.DESIGNER);
            this.renderPreviewArea?.();

            await this._orchestrator?.runStage?.('design.batch', {
                contentPackage: this.workflowData.contentPackage
            });

            transitionWorkflow(this, WorkflowState.COMPLETED);
            this.renderPreviewArea?.();
            this.addChatMessage?.('ai', '快速生成完成！');

        } catch (err) {
            console.error('[SimpleGeneration] 错误:', err);
            this.addChatMessage?.('ai', `生成出错: ${err.message}`);
            const ok = transitionWorkflow(this, WorkflowState.FAILED, { reason: 'simple_generation', error: err?.message });
            if (!ok) forceWorkflowState(this, WorkflowState.FAILED);
            transitionWorkflow(this, WorkflowState.IDLE, { reason: 'simple_generation' });
            this.renderPreviewArea?.();
        } finally {
            this._workflowLock = false;
        }
    },

    /**
     * 规划模式：扫描素材，生成大纲建议，打开规划器
     */
    async _startPlannedGeneration() {
        this._workflowLock = true;
        console.log('[Workflow] _startPlannedGeneration 开始');

        try {
            transitionWorkflow(this, WorkflowState.SCANNING);
            this.renderPreviewArea?.();
            this.addChatMessage?.('ai', '正在扫描素材结构...');

            // 合并所有素材内容
            const files = Array.isArray(this.workflowData?.files) ? this.workflowData.files : [];
            let combinedContent = '';

            for (const file of files) {
                if (file.type === 'paste' && file.content) {
                    combinedContent += `\n\n## ${file.name || '粘贴内容'}\n\n${file.content}`;
                } else if (file.file && typeof file.file.text === 'function') {
                    try {
                        const text = await file.file.text();
                        combinedContent += `\n\n## ${file.name || '文件'}\n\n${text}`;
                    } catch (e) {
                        console.warn('[PlannedGeneration] 读取文件失败:', file.name, e);
                    }
                }
            }

            if (!combinedContent.trim()) {
                this.addChatMessage?.('ai', '未能读取到有效内容，请检查素材文件。');
                transitionWorkflow(this, WorkflowState.IDLE);
                this.renderPreviewArea?.();
                this._workflowLock = false;
                return;
            }

            // 提取章节结构
            const sections = this._extractSectionsFromMarkdown?.(combinedContent) || [];
            if (!sections.length) {
                sections.push({
                    level: 1,
                    title: '内容',
                    content: combinedContent.trim()
                });
            }

            // 生成建议大纲
            const suggestedOutline = sections.map((sec, idx) => ({
                id: `section_${idx}`,
                title: sec.title || `第 ${idx + 1} 部分`,
                suggestedPages: Math.max(1, Math.ceil((sec.content || '').length / 1500)),
                content: sec.content || '',
                sourceFiles: [],
                notes: ''
            }));

            // 存储到 workflowData
            this.workflowData.plannedOutline = suggestedOutline;
            this.workflowData.reportMarkdown = combinedContent;
            this.workflowData._mode = 'planned';

            this.addChatMessage?.('ai', `已识别 ${suggestedOutline.length} 个章节，请在规划器中配置每页内容。`);

            // 进入规划界面
            transitionWorkflow(this, WorkflowState.OUTLINE_PLANNING);
            this.renderPreviewArea?.();

            // 释放锁（规划器是用户交互阶段）
            this._workflowLock = false;

            // 打开规划器 modal
            if (typeof this.openOutlinePlanner === 'function') {
                this.openOutlinePlanner(suggestedOutline);
            }

        } catch (err) {
            console.error('[PlannedGeneration] 错误:', err);
            this.addChatMessage?.('ai', `扫描出错: ${err.message}`);
            const ok = transitionWorkflow(this, WorkflowState.FAILED, { reason: 'planned_generation', error: err?.message });
            if (!ok) forceWorkflowState(this, WorkflowState.FAILED);
            transitionWorkflow(this, WorkflowState.IDLE, { reason: 'planned_generation' });
            this.renderPreviewArea?.();
            this._workflowLock = false;
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
        let assets = [];
        if (hasPrebuiltSources && !ingestInput.files.length && !ingestInput.urls.length && !ingestInput.rawTexts.length && !ingestInput.historyIds.length) {
            // 只有预构建的 sources，跳过 ingest 阶段
            sources = prebuiltSources;
            this.workflowData.ingest = { sources, assets: [], skipped: true };
            if (typeof this.logTerminal === 'function') {
                this.logTerminal('系统', '使用已解析的文档内容，跳过文件读取阶段', 'normal');
            }
        } else {
            // 正常运行 ingest 阶段
            const ingestOut = await this._orchestrator.runStage('deepsearch.ingest', ingestInput);
            this.workflowData.ingest = ingestOut;
            sources = Array.isArray(ingestOut?.sources) ? ingestOut.sources : [];
            assets = Array.isArray(ingestOut?.assets) ? ingestOut.assets : [];
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
                reportLength: REPORT_LENGTHS.has(reportConfig.reportLength) ? reportConfig.reportLength : ReportLength.STANDARD,
                tone: REPORT_TONES.has(reportConfig.tone) ? reportConfig.tone : ReportTone.BUSINESS,
                audience: REPORT_AUDIENCES.has(reportConfig.audience) ? reportConfig.audience : ReportAudience.GENERAL,
                enableReviewer: !!reportConfig.enableReviewer,
            },
        };

        this.workflowData._deepsearchInput = { sources, assets, taskGoal, userConfig };

        const { DeepSearchState } = await import('../../agents/stages/deepsearch/state.js');
        const runId = this._orchestrator?.runContext?.runId || `run_${Date.now()}`;
        const state = new DeepSearchState({ runId, taskGoal, userConfig, L0: { sources, assets } });
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

        if (pkg?.paused) {
            const reason = pkg.reason || 'Awaiting user input';
            this.workflowData.deepsearchPaused = { reason, checkpointId: pkg.checkpointId, pausedAt: Date.now() };
            transitionWorkflow(this, WorkflowState.DEEPSEARCH_REVIEW);
            this.addChatMessage('ai', `DeepSearch 已暂停：${reason}。请补充待办后继续。`);
            this.renderPreviewArea();
            return;
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
        transitionWorkflow(this, WorkflowState.DEEPSEARCH_REVIEW);
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
            reportLength: REPORT_LENGTHS.has(writeCfg.reportLength)
                ? writeCfg.reportLength
                : (REPORT_LENGTHS.has(reportConfig.reportLength) ? reportConfig.reportLength : ReportLength.STANDARD),
            tone: REPORT_TONES.has(writeCfg.tone)
                ? writeCfg.tone
                : (REPORT_TONES.has(reportConfig.tone) ? reportConfig.tone : ReportTone.BUSINESS),
            audience: REPORT_AUDIENCES.has(writeCfg.audience)
                ? writeCfg.audience
                : (REPORT_AUDIENCES.has(reportConfig.audience) ? reportConfig.audience : ReportAudience.GENERAL),
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

        transitionWorkflow(this, WorkflowState.RESEARCHING);
        this.renderPreviewArea();

        try {
            const pkg = await this._orchestrator.runStage('deepsearch.pipeline', { state });
            if (pkg?.paused) {
                const reason = pkg.reason || 'Awaiting user input';
                this.workflowData.deepsearchPaused = { reason, checkpointId: pkg.checkpointId, pausedAt: Date.now() };
                transitionWorkflow(this, WorkflowState.DEEPSEARCH_REVIEW);
                this.addChatMessage('ai', `DeepSearch 已暂停：${reason}。请补充待办后继续。`);
                this.renderPreviewArea();
                return;
            }
            this.workflowData.contentPackage = pkg;
            this.workflowData.report = pkg?.report || null;
            this.workflowData.slideIntents = pkg?.slideIntents || [];
            this._onReportUpdated?.(pkg?.report?.markdown || '', `DeepSearch 报告（第 ${state.iteration + 1} 轮）`);
            this._syncDeepSearchVizFromState(state);
            transitionWorkflow(this, WorkflowState.DEEPSEARCH_REVIEW);
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
            totalTodos: 0,
            openTodoCount: 0,
            completedTodoCount: 0,
            blockedTodoCount: 0,
            openGapCount: 0,
            gaps: [],
            todos: [],
            updatedAt: Date.now(),
            // 新增：阶段追踪
            currentPhase: null,          // 当前阶段: scan, gaps, retrieve, understand, write, condense
            phaseHistory: [],             // 阶段历史记录
            stageMetrics: {               // 每个阶段的指标
                scan: { status: 'pending', startedAt: null, completedAt: null, detail: null },
                todos: { status: 'pending', startedAt: null, completedAt: null, detail: null },
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
        const todos = Array.isArray(state?.todos) ? state.todos : [];
        const gaps = Array.isArray(state?.L1?.gaps) ? state.L1.gaps : [];
        viz.todos = todos.map(t => ({
            todoId: t?.todoId,
            text: t?.text,
            priority: t?.priority,
            status: t?.status,
            source: t?.source,
            relatedGapId: t?.relatedGapId,
        }));
        viz.gaps = gaps.map(g => ({
            gapId: g?.gapId,
            type: g?.type,
            question: g?.question,
            priority: g?.priority,
            status: g?.status,
            missCount: g?.missCount,
            blockedReason: g?.blockedReason,
        }));
        const statusOf = (todo) => {
            const raw = String(todo?.status || 'open').toLowerCase();
            if (raw === 'completed') return 'completed';
            if (raw === 'cancelled') return 'blocked';
            if (raw === 'pending') return 'open';
            return 'open';
        };
        viz.totalTodos = todos.length;
        viz.openTodoCount = todos.filter(t => statusOf(t) === 'open').length;
        viz.completedTodoCount = todos.filter(t => statusOf(t) === 'completed').length;
        viz.blockedTodoCount = todos.filter(t => statusOf(t) === 'blocked').length;
        viz.openGapCount = gaps.length
            ? gaps.filter(g => (g?.status ? String(g.status) : 'open') === 'open').length
            : viz.openTodoCount;
        viz.updatedAt = Date.now();
    },
};
