import { createStateMachine } from "../../runtime/state-machine.js";

export const SlideStatus = Object.freeze({
  PENDING: "pending",
  BRAINSTORMING: "brainstorming",
  GENERATING: "generating",
  VALIDATING: "validating",
  DEGRADED_L1: "degraded_l1",
  DEGRADED_L2: "degraded_l2",
  REFINING: "refining",
  IMAGE_PENDING: "image_pending",
  IMAGE_GENERATING: "image_generating",
  COMPLETED: "completed",
  FAILED: "failed",
});

export const SLIDE_TRANSITIONS = Object.freeze({
  [SlideStatus.PENDING]: [SlideStatus.BRAINSTORMING],
  [SlideStatus.BRAINSTORMING]: [SlideStatus.GENERATING, SlideStatus.FAILED],
  [SlideStatus.GENERATING]: [SlideStatus.VALIDATING, SlideStatus.FAILED],
  [SlideStatus.VALIDATING]: [
    SlideStatus.COMPLETED,
    SlideStatus.REFINING,
    SlideStatus.DEGRADED_L1,
    SlideStatus.IMAGE_PENDING,
  ],
  [SlideStatus.REFINING]: [SlideStatus.COMPLETED, SlideStatus.FAILED, SlideStatus.IMAGE_PENDING],
  [SlideStatus.IMAGE_PENDING]: [SlideStatus.IMAGE_GENERATING, SlideStatus.FAILED],
  [SlideStatus.IMAGE_GENERATING]: [SlideStatus.COMPLETED, SlideStatus.FAILED],
  [SlideStatus.DEGRADED_L1]: [SlideStatus.DEGRADED_L2, SlideStatus.COMPLETED],
  [SlideStatus.DEGRADED_L2]: [SlideStatus.COMPLETED],
  [SlideStatus.FAILED]: [SlideStatus.PENDING],
  [SlideStatus.COMPLETED]: [],
});

export const slideMachine = createStateMachine(SLIDE_TRANSITIONS, "Slide");

export const DesignPhase = Object.freeze({
  TOKENS: "tokens",
  BRAINSTORM: "brainstorm",
  GENERATE: "generate",
  IMAGE: "image",
  REFINE: "refine",
  QA: "qa",
  COMPLETED: "completed",
});
