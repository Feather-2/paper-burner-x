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

/** 事件记录基础结构 */
export interface EventRecord<T = unknown> {
  actor: "deepsearch" | "design" | "codesearch";
  status?: "started" | "progress" | "ended" | "completed" | "warn" | "error" | "info" | "step";
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

  /** design.generate.ended - 幻灯片生成完成 */
  export interface GenerateEnded {
    slides: number;
  }

  /** design.qa.ended - QA 检查完成 */
  export interface QaEnded {
    slides: number;
    degradedCount: number;
  }

  /** design.visual.errors - 视觉渲染错误 */
  export interface VisualErrors {
    errors: Array<{ slideIndex: number; error: string }>;
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
    iterations: number;
    terminationReason: "quality_met" | "hard_limit" | "error";
    finalScore?: number;
  }

  /** design.degraded - 降级警告 */
  export interface Degraded {
    degradedCount: number;
  }

  /** design.chat.ask - 需要用户输入 */
  export interface ChatAsk {
    question: string;
    options?: string[];
  }

  // ============================================================================
  // 批次/幻灯片级别事件（Timeline Demo 需要）
  // ============================================================================

  /** design.batch.started - 批次开始 */
  export interface BatchStarted {
    runId: string;
    batchIndex: number;
    batchSize: number;
    slideIds: string[];
  }

  /** design.batch.completed - 批次完成 */
  export interface BatchCompleted {
    runId: string;
    batchIndex: number;
    slidesGenerated: number;
    duration?: number;
  }

  /** design.slide.started - 单张幻灯片开始生成 */
  export interface SlideStarted {
    slideId?: string;
    slideIndex: number;
    slideIntentId?: string;
    title?: string;
  }

  /** design.slide.completed - 单张幻灯片完成 */
  export interface SlideCompleted {
    slideId: string;
    slideIndex: number;
    status: "success" | "degraded" | "failed";
  }
}

/** Design 阶段枚举 */
export type DesignPhase =
  | "idle"
  | "outline_parsing"
  | "outline_confirming"
  | "style_extracting"
  | "generating"
  | "reviewing"
  | "visual_filling"
  | "completed";

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
  "design.tokens.ended": EventRecord<DesignEvents.TokensEnded>;
  "design.generate.ended": EventRecord<DesignEvents.GenerateEnded>;
  "design.qa.ended": EventRecord<DesignEvents.QaEnded>;
  "design.visual.errors": EventRecord<DesignEvents.VisualErrors>;
  "design.image.planning.completed": EventRecord<DesignEvents.ImagePlanningCompleted>;
  "design.refine.step": EventRecord<DesignEvents.RefineStep>;
  "design.refine.ended": EventRecord<DesignEvents.RefineEnded>;
  "design.degraded": EventRecord<DesignEvents.Degraded>;
  "design.chat.ask": EventRecord<DesignEvents.ChatAsk>;
  // 批次/幻灯片级别事件
  "design.batch.started": EventRecord<DesignEvents.BatchStarted>;
  "design.batch.completed": EventRecord<DesignEvents.BatchCompleted>;
  "design.slide.started": EventRecord<DesignEvents.SlideStarted>;
  "design.slide.completed": EventRecord<DesignEvents.SlideCompleted>;
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
export interface AgentEventMap extends DeepSearchEventMap, DesignEventMap, CodeSearchEventMap { }

/** 事件名称类型 */
export type AgentEventName = keyof AgentEventMap;

/** 类型安全的事件处理器 */
export type AgentEventHandler<K extends AgentEventName> = (event: AgentEventMap[K]) => void;
