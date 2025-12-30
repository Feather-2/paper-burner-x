/**
 * Agents 事件接口声明
 *
 * 本文件定义 agents 层向 workflow/UI 层传递的所有事件及其 payload 结构。
 * workflow/UI 层应根据此声明进行适配。
 */

// ============================================================================
// 通用类型
// ============================================================================

/** Agent 状态（简化版，统一使用） */
export type AgentStatus = "idle" | "running" | "paused" | "completed" | "failed";

/**
 * EventBus 事件记录（最终形态）
 * - 与 `js/agents/runtime/events/event-bus.js` 的 `createEventRecord()` 对齐
 * - workflow/UI 层默认订阅到的就是这种结构
 */
export type EventSchemaVersion = "0.1";

/** 事件来源（actor） */
export type EventActor =
  | "system"
  | "agent"
  | "deepsearch"
  | "design"
  | "codesearch"
  | "ingest"
  | "textprep"
  | "evaluate";

/** 事件状态（status） */
export type EventStatus =
  | "started"
  | "progress"
  | "ended"
  | "completed"
  | "failed"
  | "cancelled"
  | "skipped"
  | "warn"
  | "warning"
  | "info"
  | "step";

/** 事件等级（level，可选） */
export type EventLevel = "debug" | "info" | "warn" | "error";

/** 事件记录基础结构 */
export interface EventRecord<T = unknown> {
  schemaVersion: EventSchemaVersion;
  eventId: string;
  runId: string;
  ts: string;
  name: string;
  actor: EventActor;
  level?: EventLevel;
  durationMs?: number;
  meta?: unknown;
  status?: EventStatus;
  payload?: T;
}

// ============================================================================
// 用户交互事件（UI → Agent）
// ============================================================================

/**
 * 用户可以通过以下事件介入 Agent 流程：
 */
export namespace UserActionEvents {
  /** user.action.pause - 请求暂停 Agent */
  export interface Pause {
    reason?: string;
  }

  /** user.action.resume - 请求恢复 Agent */
  export interface Resume {
    checkpointId?: string;
  }

  /** user.action.cancel - 请求取消 Agent */
  export interface Cancel {
    reason?: string;
  }

  /** user.input - 用户输入（响应 chat.ask） */
  export interface Input {
    text?: string;
    choice?: string;
    data?: unknown;
  }

  /** user.action.confirm - 用户确认（如大纲确认） */
  export interface Confirm {
    confirmed: boolean;
    feedback?: string;
  }

  /** user.action.edit - 用户编辑请求 */
  export interface Edit {
    target: "outline" | "slide" | "style";
    slideIndex?: number;
    content?: string;
  }

  // ============================================================================
  // Demo 相关用户交互事件
  // ============================================================================

  /** user.action.toggleView - 切换视图模式 */
  export interface ToggleView {
    from: "document" | "knowledgeGraph";
    to: "document" | "knowledgeGraph";
  }

  /** user.action.startDesignFlow - 启动设计流程 */
  export interface StartDesignFlow {
    outline?: unknown[];
    options?: Record<string, unknown>;
  }

  /** user.action.acceptDesign - 验收设计 */
  export interface AcceptDesign {
    slideCount: number;
    enterEditMode?: boolean;
  }
}

/** 用户交互事件映射表 */
export interface UserActionEventMap {
  "user.action.pause": UserActionEvents.Pause;
  "user.action.resume": UserActionEvents.Resume;
  "user.action.cancel": UserActionEvents.Cancel;
  "user.input": UserActionEvents.Input;
  "user.action.confirm": UserActionEvents.Confirm;
  "user.action.edit": UserActionEvents.Edit;
  "user.action.toggleView": UserActionEvents.ToggleView;
  "user.action.startDesignFlow": UserActionEvents.StartDesignFlow;
  "user.action.acceptDesign": UserActionEvents.AcceptDesign;
}

// ============================================================================
// 可交互阶段说明
// ============================================================================

/**
 * ## 用户可介入的流程节点
 *
 * ### DeepSearch Agent
 * | 阶段 | 可介入操作 | 触发事件 |
 * |------|-----------|---------|
 * | 任意时刻 | 暂停 | user.action.pause |
 * | 暂停后 | 恢复 | user.action.resume |
 * | 任意时刻 | 取消 | user.action.cancel |
 *
 * ### Design Agent
 * | 阶段 | 可介入操作 | 触发事件 | Agent 响应事件 |
 * |------|-----------|---------|---------------|
 * | outline_confirming | 确认/修改大纲 | user.action.confirm | design.phase.transition |
 * | generating | 实时预览 | - | design.deck.updated |
 * | reviewing | 查看 QA 结果 | - | design.qa.ended |
 * | visual_filling | 查看渲染错误 | - | design.visual.errors |
 * | 任意时刻 | 暂停 | user.action.pause | design.agent.status.changed |
 * | 暂停后 | 恢复 | user.action.resume | design.agent.status.changed |
 * | 任意时刻 | 取消 | user.action.cancel | - |
 * | chat_ask 工具调用 | 回复问题 | user.input | - |
 *
 * ### 暂停/恢复机制
 *
 * ```
 * UI 发送: eventBus.emit('user.action.pause', { reason: '用户请求' })
 *     ↓
 * Agent 响应: design.agent.status.changed { from: 'running', to: 'paused', checkpointId }
 *     ↓
 * UI 发送: eventBus.emit('user.action.resume', { checkpointId })
 *     ↓
 * Agent 响应: design.agent.status.changed { from: 'paused', to: 'running' }
 * ```
 *
 * ### 用户输入机制（chat_ask）
 *
 * ```
 * Agent 发送: design.chat.ask { question: '请选择配色方案', options: ['方案A', '方案B'] }
 *     ↓
 * UI 展示选项，等待用户选择
 *     ↓
 * UI 发送: eventBus.emit('user.input', { choice: '方案A' })
 *     ↓
 * Agent 继续执行
 * ```
 */

// ============================================================================
// Runtime / Workflow 通用事件（Run / Ingest / Compression / Iteration）
// ============================================================================

export namespace RunEvents {
  /** run.started - Run 启动 */
  export interface Started {
    runId?: string;
    mode?: string;
    scenario?: string;
    todos?: unknown;
  }

  /** run.ended - Run 结束（可能是正常结束，也可能是由上层主动结束） */
  export interface Ended {
    runId?: string;
    reason?: string;
  }

  /** run.cancelled - Run 被取消 */
  export interface Cancelled {
    runId?: string;
    reason: string;
  }

  /** run.failed - Run 失败（如果有上层聚合事件） */
  export interface Failed {
    runId?: string;
    error: string;
    stage?: string;
  }

  /**
   * run.completed - 兼容事件（部分旧 workflow 会监听）
   * 建议新代码使用 run.ended。
   */
  export interface Completed {
    runId?: string;
    reason?: string;
  }
}

export interface RunEventMap {
  "run.started": EventRecord<RunEvents.Started>;
  "run.ended": EventRecord<RunEvents.Ended>;
  "run.cancelled": EventRecord<RunEvents.Cancelled>;
  "run.failed": EventRecord<RunEvents.Failed>;
  "run.completed": EventRecord<RunEvents.Completed>;
}

export namespace IngestEvents {
  /** ingest.started - 摄取开始 */
  export interface Started {
    inputCount: number;
    runId?: string;
  }

  /** ingest.completed - 摄取完成 */
  export interface Completed {
    runId?: string;
    sourceCount?: number;
    successDocs?: number;
    failedDocs?: number;
    durationMs?: number;
    parseErrors?: Array<{ origin: string; error: string }>;
  }

  /** ingest.doc.started - 单个输入开始解析 */
  export interface DocStarted {
    origin: string;
    historyId?: string;
    url?: string;
    fileName?: string;
  }

  /** ingest.doc.completed - 单个输入解析完成 */
  export interface DocCompleted {
    docId: string;
    chunkCount: number;
    assetCount?: number;
  }

  /** ingest.doc.failed - 单个输入解析失败 */
  export interface DocFailed {
    origin: string;
    error: string;
  }

  /** ingest.assets.understanding.started - 资产理解开始 */
  export interface AssetsUnderstandingStarted {
    steps?: number;
  }

  /** ingest.assets.understanding.progress - 资产理解进度 */
  export interface AssetsUnderstandingProgress {
    current?: number;
    total?: number;
    step?: number;
    steps?: number;
  }

  /** ingest.assets.understanding.completed - 资产理解完成 */
  export interface AssetsUnderstandingCompleted {
    assetsCount?: number;
  }

  /** ingest.assets.understanding.failed - 资产理解失败 */
  export interface AssetsUnderstandingFailed {
    error: string;
  }
}

export interface IngestEventMap {
  "ingest.started": EventRecord<IngestEvents.Started>;
  "ingest.completed": EventRecord<IngestEvents.Completed>;
  "ingest.doc.started": EventRecord<IngestEvents.DocStarted>;
  "ingest.doc.completed": EventRecord<IngestEvents.DocCompleted>;
  "ingest.doc.failed": EventRecord<IngestEvents.DocFailed>;
  "ingest.assets.understanding.started": EventRecord<IngestEvents.AssetsUnderstandingStarted>;
  "ingest.assets.understanding.progress": EventRecord<IngestEvents.AssetsUnderstandingProgress>;
  "ingest.assets.understanding.completed": EventRecord<IngestEvents.AssetsUnderstandingCompleted>;
  "ingest.assets.understanding.failed": EventRecord<IngestEvents.AssetsUnderstandingFailed>;
}

export namespace CompressionEvents {
  /** compression.* - 上下文压力与压缩事件（Cicada/压缩器） */
  export interface Notice {
    stageId?: string;
    pressure?: number;
    predictedTokens?: number;
    budgetTokens?: number;
    headroomTokens?: number;
    growthTokens?: number;
    maxContextTokens?: number;
    suggestedLayers?: string[];
  }

  /** compression.failed - 压缩失败 */
  export interface Failed extends Notice {
    error: string;
  }
}

export interface CompressionEventMap {
  "compression.scheduled": EventRecord<CompressionEvents.Notice>;
  "compression.applied": EventRecord<CompressionEvents.Notice>;
  "compression.advised": EventRecord<CompressionEvents.Notice>;
  "compression.forced": EventRecord<CompressionEvents.Notice>;
  "compression.failed": EventRecord<CompressionEvents.Failed>;
}

export namespace IterationEvents {
  /** iteration.completed / deepsearch.iteration.completed - 单轮迭代完成（用于可视化/统计） */
  export interface Completed {
    iteration: number;
    openTodoCount?: number;
    completedTodoCount?: number;
    blockedTodoCount?: number;
    totalTodos?: number;
    openGapCount?: number;
  }
}

export interface IterationEventMap {
  "iteration.completed": EventRecord<IterationEvents.Completed>;
  "deepsearch.iteration.completed": EventRecord<IterationEvents.Completed>;
}

export namespace AgentLogEvents {
  /** *.log.* - 结构化日志（由 createLogger 发射） */
  export interface LogPayload {
    level: EventLevel;
    message: string;
    timestamp: string;
    stage?: string;
    iteration?: number;
    trajectoryId?: string;
    data?: unknown;
  }
}

export interface AgentLogEventMap {
  "deepsearch.log.debug": EventRecord<AgentLogEvents.LogPayload>;
  "deepsearch.log.info": EventRecord<AgentLogEvents.LogPayload>;
  "deepsearch.log.warn": EventRecord<AgentLogEvents.LogPayload>;
  "deepsearch.log.error": EventRecord<AgentLogEvents.LogPayload>;
  "design.log.debug": EventRecord<AgentLogEvents.LogPayload>;
  "design.log.info": EventRecord<AgentLogEvents.LogPayload>;
  "design.log.warn": EventRecord<AgentLogEvents.LogPayload>;
  "design.log.error": EventRecord<AgentLogEvents.LogPayload>;
  "codesearch.log.debug": EventRecord<AgentLogEvents.LogPayload>;
  "codesearch.log.info": EventRecord<AgentLogEvents.LogPayload>;
  "codesearch.log.warn": EventRecord<AgentLogEvents.LogPayload>;
  "codesearch.log.error": EventRecord<AgentLogEvents.LogPayload>;
}

// ============================================================================
// DeepSearch Agent 事件（新 Agent Loop + Skills 架构）
// ============================================================================

export namespace DeepSearchEvents {
  // ─────────────────────────────────────────────────────────────────────────
  // Agent Loop 生命周期
  // ─────────────────────────────────────────────────────────────────────────

  /** deepsearch.agent.status.changed - 状态变更 */
  export interface StatusChanged {
    from: AgentStatus;
    to: AgentStatus;
    timestamp?: number;
  }

  /** deepsearch.agent.started - Agent 启动 */
  export interface AgentStarted {
    runId: string;
    mode?: string;
  }

  /** deepsearch.agent.completed - Agent 完成 */
  export interface AgentCompleted {
    runId: string;
    iterations: number;
  }

  /** deepsearch.agent.failed - Agent 失败 */
  export interface AgentFailed {
    runId?: string;
    error: string;
  }

  /** deepsearch.agent.paused - Agent 暂停 */
  export interface AgentPaused {
    runId?: string;
    reason?: string;
    checkpointId?: string;
  }

  /** deepsearch.agent.iteration - 迭代进度 */
  export interface AgentIteration {
    iteration: number;
    retry?: number;
    systemRetry?: number;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // write-report skill 事件
  // ─────────────────────────────────────────────────────────────────────────

  /** deepsearch.section.written - 单个章节写入完成 */
  export interface SectionWritten {
    sectionId: string;
    title: string;
  }

  /** deepsearch.report.generated - 报告生成完成 */
  export interface ReportGenerated {
    runId?: string;
    hasReport: boolean;
    claimCount: number;
  }

  /** deepsearch.evidence.synthesized - 证据/知识节点生成 (Forge demo) */
  export interface EvidenceSynthesized {
    evidenceId?: string;
    source: string;
    content: string;
  }

  /** deepsearch.draft.updated - 草稿实时更新 (Forge demo) */
  export interface DraftUpdated {
    sectionId?: string;
    phrase: string;
    isComplete?: boolean;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // manage-todos skill 事件
  // ─────────────────────────────────────────────────────────────────────────

  /** deepsearch.todo.created - Todo 创建 */
  export interface TodoCreated {
    todoId: string;
    text: string;
    visibility?: TodoVisibility;
    activeForm?: string; // 进行时描述，如 "Researching backend"
  }

  /** deepsearch.todo.updated - Todo 更新 */
  export interface TodoUpdated {
    todoId: string;
    status: string;
    visibility?: TodoVisibility;
    text?: string;
  }

  /** deepsearch.todo.completed - Todo 完成 */
  export interface TodoCompleted {
    todoId: string;
  }

  /** deepsearch.todo.cancelled - Todo 取消 */
  export interface TodoCancelled {
    todoId: string;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // search-docs skill 事件
  // ─────────────────────────────────────────────────────────────────────────

  /** deepsearch.search.completed - 搜索完成 */
  export interface SearchCompleted {
    query: string;
    resultCount: number;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DeepSearch legacy/stage 事件（workflow/ui-v2 仍在消费）
  // ─────────────────────────────────────────────────────────────────────────

  /** deepsearch.started - DeepSearch 流程开始（兼容） */
  export interface Started {
    runId?: string;
  }

  /** deepsearch.completed - DeepSearch 流程结束（兼容） */
  export interface Completed {
    runId?: string;
    iterations?: number;
  }

  /** deepsearch.failed - DeepSearch 流程失败（兼容） */
  export interface Failed {
    runId?: string;
    error: string;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 外部搜索事件（workflow-runtime.js 使用）
  // ─────────────────────────────────────────────────────────────────────────

  /** deepsearch.external.triggered - 外部搜索触发 */
  export interface ExternalTriggered {
    runId?: string;
    reason?: string;
    localHitCount?: number;
    minLocalHits?: number;
  }

  /** deepsearch.external.started - 外部搜索开始 */
  export interface ExternalStarted {
    runId?: string;
    providers?: string[];
    gapCount?: number;
  }

  /** deepsearch.external.completed - 外部搜索完成 */
  export interface ExternalCompleted {
    runId?: string;
    providers?: string[];
    chunksCount?: number;
    documentsCount?: number;
    evidencesCount?: number;
  }

  /** deepsearch.external.error - 外部搜索错误 */
  export interface ExternalError {
    runId?: string;
    message: string;
  }

  /** deepsearch.external.skipped - 外部搜索跳过 */
  export interface ExternalSkipped {
    runId?: string;
    reason?: string;
    localHitCount?: number;
  }

  /** deepsearch.todos.started - Todo 阶段开始（legacy stage） */
  export interface TodosStarted {
    runId?: string;
    existingTodoCount?: number;
    hasUserTodos?: boolean;
  }

  /** deepsearch.todos.completed - Todo 阶段完成（legacy stage） */
  export interface TodosCompleted {
    runId?: string;
    todoCount: number;
    createdCount?: number;
    skippedLLM?: boolean;
    source?: string;
  }

  /** deepsearch.gaps.completed - Gaps 阶段完成（部分 UI 仍依赖） */
  export interface GapsCompleted {
    runId?: string;
    gapCount?: number;
    totalGaps?: number;
    todoCount?: number;
    gaps?: unknown[];
  }

  /** deepsearch.todo.status.changed - Todo 状态变化（与 todo.updated 并存） */
  export interface TodoStatusChanged {
    todoId: string;
    from: string;
    to: string;
    ts?: string;
  }

  /** deepsearch.checkpoint.saved - 检查点已保存 */
  export interface CheckpointSaved {
    runId?: string;
    checkpointId: string;
    iteration?: number;
    trajectoryId?: string;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 报告写作阶段事件（report-generator.js 使用）
  // ─────────────────────────────────────────────────────────────────────────

  /** deepsearch.write.progress - 写作进度 */
  export interface WriteProgress {
    phase?: string;
    step?: string;
    current?: number;
    total?: number;
    progress?: number;
    msg?: string;
    detail?: unknown;
  }

  /** deepsearch.write.toc.planned - 目录/章节规划 */
  export interface WriteTocPlanned {
    runId?: string;
    iteration?: number;
    sectionCount: number;
    maxParallel?: number;
    sections?: Array<{
      sectionId: string;
      title: string;
      targetWords?: number;
      claimIds?: string[];
    }>;
  }

  /** deepsearch.write.section.started - 单章节开始 */
  export interface WriteSectionStarted {
    sectionId: string;
    sectionTitle?: string;
    sectionIndex: number;
    sectionCount: number;
    workerIndex?: number;
    claimCount?: number;
    targetWords?: number;
  }

  /** deepsearch.write.section.completed - 单章节完成 */
  export interface WriteSectionCompleted extends WriteSectionStarted {
    sectionStatus?: string;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Backtrack 事件 (from backtrack-manager)
  // ─────────────────────────────────────────────────────────────────────────

  /** deepsearch.agent.backtracked - 回溯完成 */
  export interface AgentBacktracked {
    runId?: string;
    checkpointId: string;
    reason?: string;
  }

  /** deepsearch.agent.backtrack_limit - 达到回溯上限 */
  export interface AgentBacktrackLimit {
    runId?: string;
    count: number;
    limit: number;
  }
}

/** Todo 可见性 */
export type TodoVisibility = "public" | "private";

// ============================================================================
// Design Agent 事件
// ============================================================================

export namespace DesignEvents {
  /** design.agent.status.changed - 状态变更 */
  export interface StatusChanged {
    from: AgentStatus;
    to: AgentStatus;
    timestamp: number;
    pausedReason?: string;
    runId?: string;
    checkpointId?: string;
  }

  /** design.started - 设计流程启动 */
  export interface Started {
    runId: string;
    taskGoal?: string;
  }

  /** design.ended - 设计流程结束 */
  export interface Ended {
    slides: number;
    degradedCount: number;
  }

  /** design.phase.transition - 阶段转换 */
  export interface PhaseTransition {
    runId: string;
    from: DesignPhase;
    to: DesignPhase;
  }

  /** design.step.started / design.step.completed - 步骤进度 */
  export interface StepProgress {
    runId: string;
    step: string;
    iteration: number;
  }

  /** design.deck.updated - Deck 内容更新 */
  export interface DeckUpdated {
    runId: string;
    slideCount: number;
    source?: string;
    deckHtmlDsl?: string;
    slidesMeta?: SlideMeta[];
  }

  /** design.tokens.ended - 设计 Token 提取完成 */
  export interface TokensEnded {
    theme?: string;
  }

  /** design.tokens.started - 设计 Token 提取开始（部分 UI 仍在监听） */
  export interface TokensStarted {
    runId?: string;
  }

  /** design.generate.ended - 幻灯片生成完成 */
  export interface GenerateEnded {
    slides: number;
  }

  /** design.qa.ended - QA 检查完成 */
  export interface QaEnded {
    slides: number;
    qaFailed?: number;
    degradedCount: number;
  }

  /** design.visual.errors - 视觉渲染错误 */
  export interface VisualErrors {
    errors: Array<{ renderer?: string; error: string; slideIndex?: number }>;
    hasFatalError?: boolean;
    svgReport?: unknown;
  }

  /** design.image.planning.completed - 图片规划完成 */
  export interface ImagePlanningCompleted {
    slots: number;
  }

  /** design.refine.step - Refine 迭代步骤 */
  export interface RefineStep {
    iteration: number;
    action?: string;
    thought?: string;
  }

  /** design.refine.ended - Refine 结束 */
  export interface RefineEnded {
    qualityScore?: number;
    stepCount?: number;
    terminationReason?: "quality_met" | "hard_limit" | "error" | string;
  }

  /** design.degraded - 降级警告 */
  export interface Degraded {
    degradedCount: number;
    reason?: string;
  }

  /** design.chat.ask - 需要用户输入 */
  export interface ChatAsk {
    question: string;
    options?: string[];
  }

  // ============================================================================
  // 预览/确认事件（浏览器端交互）
  // ============================================================================

  /** design.style.preview - 设计规范预览（等待确认） */
  export interface StylePreview {
    runId: string;
    designSystem?: unknown;
    designTokens?: unknown;
    slideCount?: number;
  }

  /** design.plan.preview - 方案预览（等待确认） */
  export interface PlanPreview {
    runId: string;
    plans: unknown[];
    dialogFormat?: string;
    slideCount: number;
    summary?: unknown;
  }

  /** design.plan.confirmed - 方案已确认 */
  export interface PlanConfirmed {
    runId: string;
    plans: unknown[];
    slideCount: number;
  }

  /** design.layout.preview - 线框布局预览（等待确认） */
  export interface LayoutPreview {
    runId: string;
    layouts: unknown[];
    previewHtml?: string;
    slideCount: number;
  }

  /** design.layout.confirmed - 线框布局已确认 */
  export interface LayoutConfirmed {
    runId: string;
    layouts: unknown[];
    slideCount: number;
  }

  // ============================================================================
  // Repair / Review / Visual Render
  // ============================================================================

  /** design.repair.skipped - 跳过修复 */
  export interface RepairSkipped {
    reason: string;
  }

  /** design.repair.started - 开始修复 */
  export interface RepairStarted {
    qaIssueCount?: number;
    styleIssueCount?: number;
    consistencyScore?: number;
  }

  /** design.repair.failed - 修复失败 */
  export interface RepairFailed {
    error: string;
  }

  /** design.repair.ended - 修复完成 */
  export interface RepairEnded {
    finalScore?: number;
    steps?: number;
  }

  /** design.review.started - 全局审阅开始 */
  export interface ReviewStarted {
    runId?: string;
    slideCount?: number;
  }

  /** design.review.ended - 全局审阅结束 */
  export interface ReviewEnded {
    runId?: string;
    score?: number;
    pass?: boolean;
    issueCount?: number;
    summary?: string;
  }

  /** design.visual.render.started - 视觉渲染开始 */
  export interface VisualRenderStarted {
    runId: string;
    planned: { total: number; "ai-image": number; svg: number; asset: number };
  }

  /** design.visual.render.completed - 视觉渲染完成 */
  export interface VisualRenderCompleted {
    runId: string;
    planned: { total: number; "ai-image": number; svg: number; asset: number };
    pendingImages?: string[];
    report?: unknown;
  }

  /** design.visual.render.failed - 视觉渲染失败 */
  export interface VisualRenderFailed extends VisualRenderCompleted {
    error?: string;
  }

  // ============================================================================
  // 批次/幻灯片级别事件（Timeline Demo 需要）
  // ============================================================================

  /** design.batch.started - 批次开始 */
  export interface BatchStarted {
    batchIndex: number;
    slideIndexes: number[];
    styleLock?: boolean;
    runId?: string;
  }

  /** design.batch.completed - 批次完成 */
  export interface BatchCompleted {
    batchIndex: number;
    slideIndexes: number[];
    duration?: number;
    runId?: string;
  }

  /** design.slide.started - 单张幻灯片开始生成 */
  export interface SlideStarted {
    slideIndex: number;
    slideIntent?: {
      id?: string;
      title?: string;
      pageType?: string;
      objective?: string;
      keyPoints?: unknown;
      claimIds?: string[];
      dataTableIds?: string[];
    };
    slideIntentId?: string; // compat
    title?: string; // compat
  }

  /** design.slide.completed - 单张幻灯片完成 */
  export interface SlideCompleted {
    slideIndex: number;
    html?: string;
    duration?: number;
    source?: string;
    status?: "success" | "degraded" | "failed" | string;
  }

  /** design.slide.failed - 单张幻灯片失败 */
  export interface SlideFailed {
    slideIndex: number;
    error: { message: string; stack?: string } | string;
    attempt?: number;
  }

  /** design.slide.retrying - 单张幻灯片重试 */
  export interface SlideRetrying {
    slideIndex: number;
    attempt: number;
  }

  /** design.slide.progress - 单张幻灯片进度 */
  export interface SlideProgress {
    slideIndex: number;
    step?: string;
    msg?: string;
  }
}

/** Design 阶段枚举 */
export type DesignPhase =
  | "idle"
  | "outline_parsing"
  | "outline_confirming"
  | "style_extracting"
  | "style_confirming"
  | "deck_planning"
  | "plan_confirming"
  | "layout_analyzing"
  | "layout_generating"
  | "layout_developing"
  | "layout_confirming"
  | "generating"
  | "generating_paused"
  | "reviewing"
  | "fixing"
  | "repair"
  | "visual_filling"
  | "completed"
  | "failed"
  | "editing";

/** 幻灯片元数据 */
export interface SlideMeta {
  index: number;
  title?: string;
  layout?: string;
}

// ============================================================================
// CodeSearch Agent 事件
// ============================================================================

export namespace CodeSearchEvents {
  /** codesearch.agent.status.changed - 状态变更 */
  export interface StatusChanged {
    from: AgentStatus;
    to: AgentStatus;
  }

  /** codesearch.started - 搜索启动 */
  export interface Started {
    query: string;
    maxSteps: number;
  }

  /** codesearch.completed - 搜索完成 */
  export interface Completed {
    totalSteps: number;
  }

  /** codesearch.step.started - 步骤开始 */
  export interface StepStarted {
    step: number;
    total: number;
  }

  /** codesearch.step.completed - 步骤完成 */
  export interface StepCompleted {
    step: number;
    action: string;
    createdTodos?: number;
  }

  /** codesearch.step.failed - 步骤失败 */
  export interface StepFailed {
    step: number;
    error: string;
  }

  /** codesearch.summarizing - 正在总结 */
  export interface Summarizing {
    steps: number;
  }
}

// ============================================================================
// 事件流程图
// ============================================================================

/**
 * DeepSearch 事件流程:
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                      DeepSearch Agent                           │
 * ├─────────────────────────────────────────────────────────────────┤
 * │                                                                 │
 * │  [启动]                                                         │
 * │    ├─► deepsearch.agent.status.changed {from:"idle",to:"running"}│
 * │    └─► deepsearch.agent.started {runId}                         │
 * │                                                                 │
 * │  [迭代] (循环)                                                   │
 * │    └─► deepsearch.agent.iteration {iteration}                   │
 * │                                                                 │
 * │  [完成]                                                         │
 * │    ├─► deepsearch.agent.status.changed {from:"running",to:"completed"}│
 * │    └─► deepsearch.agent.completed {runId, iterations}           │
 * │                                                                 │
 * │  [失败]                                                         │
 * │    ├─► deepsearch.agent.status.changed {from:"running",to:"failed"}│
 * │    └─► deepsearch.agent.failed {error}                          │
 * │                                                                 │
 * └─────────────────────────────────────────────────────────────────┘
 *
 *
 * Design 事件流程:
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                       Design Agent                              │
 * ├─────────────────────────────────────────────────────────────────┤
 * │                                                                 │
 * │  [启动]                                                         │
 * │    ├─► design.agent.status.changed {from:"idle",to:"running"}   │
 * │    └─► design.started {runId, taskGoal}                         │
 * │                                                                 │
 * │  [阶段转换] (按顺序)                                             │
 * │    └─► design.phase.transition {from, to}                       │
 * │        │                                                        │
 * │        ├─ idle → outline_parsing                                │
 * │        ├─ outline_parsing → outline_confirming                  │
 * │        ├─ outline_confirming → style_extracting                 │
 * │        │   └─► design.tokens.ended {theme}                      │
 * │        ├─ style_extracting → generating                         │
 * │        │   └─► design.generate.ended {slides}                   │
 * │        ├─ generating → reviewing                                │
 * │        │   └─► design.qa.ended {slides, degradedCount}          │
 * │        ├─ reviewing → visual_filling                            │
 * │        │   └─► design.visual.errors? {errors}                   │
 * │        └─ visual_filling → completed                            │
 * │                                                                 │
 * │  [步骤进度] (每个阶段内)                                         │
 * │    ├─► design.step.started {runId, step, iteration}             │
 * │    └─► design.step.completed {runId, step, iteration}           │
 * │                                                                 │
 * │  [Deck 更新] (生成/修改时)                                       │
 * │    └─► design.deck.updated {slideCount, deckHtmlDsl, slidesMeta}│
 * │                                                                 │
 * │  [Refine] (可选，userConfig.refine.enabled=true)                │
 * │    ├─► design.refine.step {iteration, action, thought}          │
 * │    └─► design.refine.ended {iterations, terminationReason}      │
 * │                                                                 │
 * │  [完成]                                                         │
 * │    ├─► design.agent.status.changed {from:"running",to:"completed"}│
 * │    └─► design.ended {slides, degradedCount}                     │
 * │                                                                 │
 * │  [暂停]                                                         │
 * │    └─► design.agent.status.changed {from:"running",to:"paused", │
 * │                                     pausedReason, checkpointId} │
 * │                                                                 │
 * │  [失败]                                                         │
 * │    └─► design.agent.status.changed {from:"running",to:"failed"} │
 * │                                                                 │
 * └─────────────────────────────────────────────────────────────────┘
 */

// ============================================================================
// 事件订阅示例
// ============================================================================

/**
 * Workflow/UI 层订阅示例:
 *
 * ```javascript
 * // 订阅所有 deepsearch 事件
 * eventBus.subscribe('deepsearch.*', (event) => {
 *   const { actor, status, payload } = event;
 *   // 处理事件...
 * });
 *
 * // 订阅所有 design 事件
 * eventBus.subscribe('design.*', (event) => {
 *   const { actor, status, payload } = event;
 *   // 处理事件...
 * });
 *
 * // 订阅特定事件
 * eventBus.subscribe('design.agent.status.changed', (event) => {
 *   const { from, to, timestamp } = event.payload;
 *   if (to === 'completed') {
 *     // 设计完成
 *   }
 * });
 *
 * // 订阅 deck 更新
 * eventBus.subscribe('design.deck.updated', (event) => {
 *   const { deckHtmlDsl, slidesMeta } = event.payload;
 *   // 更新 UI 预览
 * });
 * ```
 */

// ============================================================================
// 状态映射参考
// ============================================================================

/**
 * AgentStatus → WorkflowState 映射:
 *
 * DeepSearch:
 *   - idle     → null (不触发转换)
 *   - running  → RESEARCHING
 *   - paused   → DEEPSEARCH_REVIEW
 *   - completed → SCRIPT_REVIEW
 *   - failed   → FAILED
 *
 * Design:
 *   - idle     → null (不触发转换)
 *   - running  → DESIGNER
 *   - paused   → DESIGNER
 *   - completed → COMPLETED
 *   - failed   → FAILED
 */

// ============================================================================
// 事件名 → Payload 类型映射
// ============================================================================

/** DeepSearch 事件映射表 (新 Agent Loop + Skills 架构) */
export interface DeepSearchEventMap {
  // Agent Loop 生命周期
  "deepsearch.agent.status.changed": EventRecord<DeepSearchEvents.StatusChanged>;
  "deepsearch.agent.started": EventRecord<DeepSearchEvents.AgentStarted>;
  "deepsearch.agent.completed": EventRecord<DeepSearchEvents.AgentCompleted>;
  "deepsearch.agent.failed": EventRecord<DeepSearchEvents.AgentFailed>;
  "deepsearch.agent.paused": EventRecord<DeepSearchEvents.AgentPaused>;
  "deepsearch.agent.iteration": EventRecord<DeepSearchEvents.AgentIteration>;
  // 兼容/legacy DeepSearch 流程事件
  "deepsearch.started": EventRecord<DeepSearchEvents.Started>;
  "deepsearch.completed": EventRecord<DeepSearchEvents.Completed>;
  "deepsearch.failed": EventRecord<DeepSearchEvents.Failed>;
  // external search
  "deepsearch.external.triggered": EventRecord<DeepSearchEvents.ExternalTriggered>;
  "deepsearch.external.started": EventRecord<DeepSearchEvents.ExternalStarted>;
  "deepsearch.external.completed": EventRecord<DeepSearchEvents.ExternalCompleted>;
  "deepsearch.external.error": EventRecord<DeepSearchEvents.ExternalError>;
  "deepsearch.external.skipped": EventRecord<DeepSearchEvents.ExternalSkipped>;
  // legacy stage
  "deepsearch.todos.started": EventRecord<DeepSearchEvents.TodosStarted>;
  "deepsearch.todos.completed": EventRecord<DeepSearchEvents.TodosCompleted>;
  "deepsearch.gaps.completed": EventRecord<DeepSearchEvents.GapsCompleted>;
  // checkpoints + todo status
  "deepsearch.checkpoint.saved": EventRecord<DeepSearchEvents.CheckpointSaved>;
  "deepsearch.todo.status.changed": EventRecord<DeepSearchEvents.TodoStatusChanged>;
  // writing/report generator
  "deepsearch.write.progress": EventRecord<DeepSearchEvents.WriteProgress>;
  "deepsearch.write.toc.planned": EventRecord<DeepSearchEvents.WriteTocPlanned>;
  "deepsearch.write.section.started": EventRecord<DeepSearchEvents.WriteSectionStarted>;
  "deepsearch.write.section.completed": EventRecord<DeepSearchEvents.WriteSectionCompleted>;
  // write-report skill
  "deepsearch.section.written": EventRecord<DeepSearchEvents.SectionWritten>;
  "deepsearch.report.generated": EventRecord<DeepSearchEvents.ReportGenerated>;
  "deepsearch.evidence.synthesized": EventRecord<DeepSearchEvents.EvidenceSynthesized>;
  "deepsearch.draft.updated": EventRecord<DeepSearchEvents.DraftUpdated>;
  // manage-todos skill
  "deepsearch.todo.created": EventRecord<DeepSearchEvents.TodoCreated>;
  "deepsearch.todo.updated": EventRecord<DeepSearchEvents.TodoUpdated>;
  "deepsearch.todo.completed": EventRecord<DeepSearchEvents.TodoCompleted>;
  "deepsearch.todo.cancelled": EventRecord<DeepSearchEvents.TodoCancelled>;
  // search-docs skill
  "deepsearch.search.completed": EventRecord<DeepSearchEvents.SearchCompleted>;
  // Backtrack
  "deepsearch.agent.backtracked": EventRecord<DeepSearchEvents.AgentBacktracked>;
  "deepsearch.agent.backtrack_limit": EventRecord<DeepSearchEvents.AgentBacktrackLimit>;
}

/** Design 事件映射表 */
export interface DesignEventMap {
  "design.agent.status.changed": EventRecord<DesignEvents.StatusChanged>;
  "design.started": EventRecord<DesignEvents.Started>;
  "design.ended": EventRecord<DesignEvents.Ended>;
  "design.phase.transition": EventRecord<DesignEvents.PhaseTransition>;
  "design.step.started": EventRecord<DesignEvents.StepProgress>;
  "design.step.completed": EventRecord<DesignEvents.StepProgress>;
  "design.deck.updated": EventRecord<DesignEvents.DeckUpdated>;
  "design.tokens.started": EventRecord<DesignEvents.TokensStarted>;
  "design.tokens.ended": EventRecord<DesignEvents.TokensEnded>;
  "design.style.preview": EventRecord<DesignEvents.StylePreview>;
  "design.plan.preview": EventRecord<DesignEvents.PlanPreview>;
  "design.plan.confirmed": EventRecord<DesignEvents.PlanConfirmed>;
  "design.layout.preview": EventRecord<DesignEvents.LayoutPreview>;
  "design.layout.confirmed": EventRecord<DesignEvents.LayoutConfirmed>;
  "design.generate.ended": EventRecord<DesignEvents.GenerateEnded>;
  "design.qa.ended": EventRecord<DesignEvents.QaEnded>;
  "design.visual.errors": EventRecord<DesignEvents.VisualErrors>;
  "design.visual.render.started": EventRecord<DesignEvents.VisualRenderStarted>;
  "design.visual.render.completed": EventRecord<DesignEvents.VisualRenderCompleted>;
  "design.visual.render.failed": EventRecord<DesignEvents.VisualRenderFailed>;
  "design.image.planning.completed": EventRecord<DesignEvents.ImagePlanningCompleted>;
  "design.repair.skipped": EventRecord<DesignEvents.RepairSkipped>;
  "design.repair.started": EventRecord<DesignEvents.RepairStarted>;
  "design.repair.failed": EventRecord<DesignEvents.RepairFailed>;
  "design.repair.ended": EventRecord<DesignEvents.RepairEnded>;
  "design.review.started": EventRecord<DesignEvents.ReviewStarted>;
  "design.review.ended": EventRecord<DesignEvents.ReviewEnded>;
  "design.refine.step": EventRecord<DesignEvents.RefineStep>;
  "design.refine.ended": EventRecord<DesignEvents.RefineEnded>;
  "design.degraded": EventRecord<DesignEvents.Degraded>;
  "design.chat.ask": EventRecord<DesignEvents.ChatAsk>;
  // 批次/幻灯片级别事件
  "design.batch.started": EventRecord<DesignEvents.BatchStarted>;
  "design.batch.completed": EventRecord<DesignEvents.BatchCompleted>;
  "design.slide.started": EventRecord<DesignEvents.SlideStarted>;
  "design.slide.completed": EventRecord<DesignEvents.SlideCompleted>;
  "design.slide.failed": EventRecord<DesignEvents.SlideFailed>;
  "design.slide.retrying": EventRecord<DesignEvents.SlideRetrying>;
  "design.slide.progress": EventRecord<DesignEvents.SlideProgress>;
}

/** CodeSearch 事件映射表 */
export interface CodeSearchEventMap {
  "codesearch.agent.status.changed": EventRecord<CodeSearchEvents.StatusChanged>;
  "codesearch.started": EventRecord<CodeSearchEvents.Started>;
  "codesearch.completed": EventRecord<CodeSearchEvents.Completed>;
  "codesearch.step.started": EventRecord<CodeSearchEvents.StepStarted>;
  "codesearch.step.completed": EventRecord<CodeSearchEvents.StepCompleted>;
  "codesearch.step.failed": EventRecord<CodeSearchEvents.StepFailed>;
  "codesearch.summarizing": EventRecord<CodeSearchEvents.Summarizing>;
}

/** 所有 Agent 事件映射表 */
export interface AgentEventMap
  extends RunEventMap,
    IngestEventMap,
    CompressionEventMap,
    IterationEventMap,
    AgentLogEventMap,
    DeepSearchEventMap,
    DesignEventMap,
    CodeSearchEventMap { }

/** 事件名称类型 */
export type AgentEventName = keyof AgentEventMap;

/** 类型安全的事件处理器 */
export type AgentEventHandler<K extends AgentEventName> = (event: AgentEventMap[K]) => void;
