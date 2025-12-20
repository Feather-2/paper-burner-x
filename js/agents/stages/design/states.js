import { createStateMachine } from "../../runtime/state-machine.js";
import { StateMachineRegistry } from "../../runtime/state-machine-registry.js";

export const DesignPhase = Object.freeze({
  IDLE: "idle",
  OUTLINE_PARSING: "outline_parsing",
  OUTLINE_CONFIRMING: "outline_confirming",
  STYLE_EXTRACTING: "style_extracting",
  STYLE_CONFIRMING: "style_confirming",
  GENERATING: "generating",
  GENERATING_PAUSED: "generating_paused",
  REVIEWING: "reviewing",
  FIXING: "fixing",
  VISUAL_FILLING: "visual_filling",
  COMPLETED: "completed",
  FAILED: "failed",
  EDITING: "editing",
});

export const DESIGN_PHASE_TRANSITIONS = Object.freeze({
  [DesignPhase.IDLE]: [DesignPhase.OUTLINE_PARSING],
  [DesignPhase.OUTLINE_PARSING]: [DesignPhase.OUTLINE_CONFIRMING, DesignPhase.FAILED],
  [DesignPhase.OUTLINE_CONFIRMING]: [DesignPhase.STYLE_EXTRACTING, DesignPhase.OUTLINE_PARSING, DesignPhase.IDLE],
  [DesignPhase.STYLE_EXTRACTING]: [DesignPhase.STYLE_CONFIRMING, DesignPhase.FAILED],
  [DesignPhase.STYLE_CONFIRMING]: [DesignPhase.GENERATING, DesignPhase.STYLE_EXTRACTING],
  [DesignPhase.GENERATING]: [DesignPhase.REVIEWING, DesignPhase.GENERATING_PAUSED, DesignPhase.FAILED],
  [DesignPhase.GENERATING_PAUSED]: [DesignPhase.GENERATING, DesignPhase.REVIEWING, DesignPhase.IDLE],
  [DesignPhase.REVIEWING]: [DesignPhase.FIXING, DesignPhase.VISUAL_FILLING, DesignPhase.COMPLETED],
  [DesignPhase.FIXING]: [DesignPhase.REVIEWING, DesignPhase.FAILED],
  [DesignPhase.VISUAL_FILLING]: [DesignPhase.COMPLETED, DesignPhase.FAILED],
  [DesignPhase.COMPLETED]: [DesignPhase.EDITING, DesignPhase.IDLE],
  [DesignPhase.EDITING]: [DesignPhase.COMPLETED, DesignPhase.IDLE],
  [DesignPhase.FAILED]: [DesignPhase.IDLE, DesignPhase.OUTLINE_PARSING],
});

export const designPhaseMachine = createStateMachine(DESIGN_PHASE_TRANSITIONS, "DesignPhase");

export const SlideStatus = Object.freeze({
  PENDING: "pending",
  ASSIGNED: "assigned",
  GENERATING: "generating",
  GENERATED: "generated",
  REVIEWING: "reviewing",
  REVIEW_PASSED: "review_passed",
  REVIEW_FAILED: "review_failed",
  FIXING: "fixing",
  FIXED: "fixed",
  VISUAL_PENDING: "visual_pending",
  VISUAL_FILLING: "visual_filling",
  COMPLETED: "completed",
  FAILED: "failed",
  SKIPPED: "skipped",
});

export const SLIDE_STATUS_TRANSITIONS = Object.freeze({
  [SlideStatus.PENDING]: [SlideStatus.ASSIGNED, SlideStatus.SKIPPED],
  [SlideStatus.ASSIGNED]: [SlideStatus.GENERATING, SlideStatus.FAILED],
  [SlideStatus.GENERATING]: [SlideStatus.GENERATED, SlideStatus.FAILED],
  [SlideStatus.GENERATED]: [SlideStatus.REVIEWING, SlideStatus.VISUAL_PENDING],
  [SlideStatus.REVIEWING]: [SlideStatus.REVIEW_PASSED, SlideStatus.REVIEW_FAILED],
  [SlideStatus.REVIEW_PASSED]: [SlideStatus.VISUAL_PENDING, SlideStatus.COMPLETED],
  [SlideStatus.REVIEW_FAILED]: [SlideStatus.FIXING, SlideStatus.SKIPPED],
  [SlideStatus.FIXING]: [SlideStatus.FIXED, SlideStatus.FAILED],
  [SlideStatus.FIXED]: [SlideStatus.REVIEWING],
  [SlideStatus.VISUAL_PENDING]: [SlideStatus.VISUAL_FILLING, SlideStatus.COMPLETED],
  [SlideStatus.VISUAL_FILLING]: [SlideStatus.COMPLETED, SlideStatus.FAILED],
  [SlideStatus.COMPLETED]: [],
  [SlideStatus.FAILED]: [SlideStatus.PENDING],
  [SlideStatus.SKIPPED]: [],
});

export const slideStatusMachine = createStateMachine(SLIDE_STATUS_TRANSITIONS, "SlideStatus");

export const VisualSlotStatus = Object.freeze({
  PENDING: "pending",
  QUEUED: "queued",
  GENERATING: "generating",
  FILLED: "filled",
  FAILED: "failed",
  SKIPPED: "skipped",
  PLACEHOLDER: "placeholder",
});

export const VISUAL_SLOT_TRANSITIONS = Object.freeze({
  [VisualSlotStatus.PENDING]: [VisualSlotStatus.QUEUED, VisualSlotStatus.SKIPPED, VisualSlotStatus.PLACEHOLDER],
  [VisualSlotStatus.QUEUED]: [VisualSlotStatus.GENERATING, VisualSlotStatus.SKIPPED],
  [VisualSlotStatus.GENERATING]: [VisualSlotStatus.FILLED, VisualSlotStatus.FAILED],
  [VisualSlotStatus.FILLED]: [VisualSlotStatus.GENERATING],
  [VisualSlotStatus.FAILED]: [VisualSlotStatus.QUEUED, VisualSlotStatus.PLACEHOLDER],
  [VisualSlotStatus.SKIPPED]: [],
  [VisualSlotStatus.PLACEHOLDER]: [],
});

export const visualSlotMachine = createStateMachine(VISUAL_SLOT_TRANSITIONS, "VisualSlot");

export const EditSessionStatus = Object.freeze({
  IDLE: "idle",
  AWAITING_INPUT: "awaiting_input",
  PROCESSING: "processing",
  AWAITING_CONFIRM: "awaiting_confirm",
  EXECUTING: "executing",
  PAUSED: "paused",
});

export const EDIT_SESSION_TRANSITIONS = Object.freeze({
  [EditSessionStatus.IDLE]: [EditSessionStatus.AWAITING_INPUT],
  [EditSessionStatus.AWAITING_INPUT]: [EditSessionStatus.PROCESSING, EditSessionStatus.IDLE],
  [EditSessionStatus.PROCESSING]: [
    EditSessionStatus.AWAITING_CONFIRM,
    EditSessionStatus.EXECUTING,
    EditSessionStatus.AWAITING_INPUT,
  ],
  [EditSessionStatus.AWAITING_CONFIRM]: [EditSessionStatus.EXECUTING, EditSessionStatus.AWAITING_INPUT],
  [EditSessionStatus.EXECUTING]: [EditSessionStatus.AWAITING_INPUT, EditSessionStatus.PAUSED],
  [EditSessionStatus.PAUSED]: [EditSessionStatus.EXECUTING, EditSessionStatus.AWAITING_INPUT],
});

export const editSessionMachine = createStateMachine(EDIT_SESSION_TRANSITIONS, "EditSession");

export const SubAgentStatus = Object.freeze({
  IDLE: "idle",
  CREATED: "created",
  RUNNING: "running",
  AWAITING_MERGE: "awaiting_merge",
  MERGED: "merged",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

export const SUB_AGENT_TRANSITIONS = Object.freeze({
  [SubAgentStatus.IDLE]: [SubAgentStatus.CREATED],
  [SubAgentStatus.CREATED]: [SubAgentStatus.RUNNING, SubAgentStatus.CANCELLED],
  [SubAgentStatus.RUNNING]: [SubAgentStatus.AWAITING_MERGE, SubAgentStatus.FAILED, SubAgentStatus.CANCELLED],
  [SubAgentStatus.AWAITING_MERGE]: [SubAgentStatus.MERGED, SubAgentStatus.FAILED],
  [SubAgentStatus.MERGED]: [],
  [SubAgentStatus.FAILED]: [SubAgentStatus.CREATED],
  [SubAgentStatus.CANCELLED]: [],
});

export const subAgentMachine = createStateMachine(SUB_AGENT_TRANSITIONS, "SubAgent");

export const ReviewStatus = Object.freeze({
  PENDING: "pending",
  CAPTURING: "capturing",
  ANALYZING: "analyzing",
  AWAITING_DECISION: "awaiting_decision",
  PASSED: "passed",
  FAILED: "failed",
  SKIPPED: "skipped",
});

export const REVIEW_TRANSITIONS = Object.freeze({
  [ReviewStatus.PENDING]: [ReviewStatus.CAPTURING, ReviewStatus.SKIPPED],
  [ReviewStatus.CAPTURING]: [ReviewStatus.ANALYZING, ReviewStatus.FAILED],
  [ReviewStatus.ANALYZING]: [ReviewStatus.AWAITING_DECISION, ReviewStatus.PASSED, ReviewStatus.FAILED],
  [ReviewStatus.AWAITING_DECISION]: [ReviewStatus.PASSED, ReviewStatus.FAILED],
  [ReviewStatus.PASSED]: [],
  [ReviewStatus.FAILED]: [ReviewStatus.PENDING],
  [ReviewStatus.SKIPPED]: [],
});

export const reviewMachine = createStateMachine(REVIEW_TRANSITIONS, "Review");

export const SLIDE_TRANSITIONS = SLIDE_STATUS_TRANSITIONS;
export const slideMachine = slideStatusMachine;

const registry = StateMachineRegistry.getInstance();
registry.register("design.phase", designPhaseMachine, {
  module: "design",
  description: "Design phase lifecycle",
  states: Object.values(DesignPhase),
  transitions: DESIGN_PHASE_TRANSITIONS,
});
registry.register("design.slide", slideMachine, {
  module: "design",
  description: "Slide status lifecycle",
  states: Object.values(SlideStatus),
  transitions: SLIDE_STATUS_TRANSITIONS,
});
registry.register("design.visualSlot", visualSlotMachine, {
  module: "design",
  description: "Visual slot lifecycle",
  states: Object.values(VisualSlotStatus),
  transitions: VISUAL_SLOT_TRANSITIONS,
});
registry.register("design.editSession", editSessionMachine, {
  module: "design",
  description: "Edit session lifecycle",
  states: Object.values(EditSessionStatus),
  transitions: EDIT_SESSION_TRANSITIONS,
});
registry.register("design.subAgent", subAgentMachine, {
  module: "design",
  description: "Sub-agent lifecycle",
  states: Object.values(SubAgentStatus),
  transitions: SUB_AGENT_TRANSITIONS,
});
registry.register("design.review", reviewMachine, {
  module: "design",
  description: "Review lifecycle",
  states: Object.values(ReviewStatus),
  transitions: REVIEW_TRANSITIONS,
});
