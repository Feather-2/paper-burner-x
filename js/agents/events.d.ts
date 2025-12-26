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
// DeepSearch Agent 事件
// ============================================================================

export namespace DeepSearchEvents {
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

  /** deepsearch.progress - 通用进度 */
  export interface Progress {
    msg?: string;
    message?: string;
    step?: string;
  }
}

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

/** DeepSearch 事件映射表 */
export interface DeepSearchEventMap {
  "deepsearch.agent.status.changed": EventRecord<DeepSearchEvents.StatusChanged>;
  "deepsearch.agent.started": EventRecord<DeepSearchEvents.AgentStarted>;
  "deepsearch.agent.completed": EventRecord<DeepSearchEvents.AgentCompleted>;
  "deepsearch.agent.failed": EventRecord<DeepSearchEvents.AgentFailed>;
  "deepsearch.agent.paused": EventRecord<DeepSearchEvents.AgentPaused>;
  "deepsearch.agent.iteration": EventRecord<DeepSearchEvents.AgentIteration>;
  "deepsearch.progress": EventRecord<DeepSearchEvents.Progress>;
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
export interface AgentEventMap extends DeepSearchEventMap, DesignEventMap, CodeSearchEventMap {}

/** 事件名称类型 */
export type AgentEventName = keyof AgentEventMap;

/** 类型安全的事件处理器 */
export type AgentEventHandler<K extends AgentEventName> = (event: AgentEventMap[K]) => void;
