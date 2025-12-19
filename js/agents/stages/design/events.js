/**
 * Design-stage event names emitted during the design pipeline.
 *
 * @readonly
 * @enum {string}
 */
export const DesignEvents = Object.freeze({
  // Brainstorm events
  BRAINSTORM_STARTED: "design.brainstorm.started",
  BRAINSTORM_BATCH_STARTED: "design.brainstorm.batch.started",
  BRAINSTORM_BATCH_ERROR: "design.brainstorm.batch.error",
  BRAINSTORM_LLM_GENERATED: "design.brainstorm.llm.generated",
  BRAINSTORM_SLIDE_COMPLETED: "design.brainstorm.slide.completed",
  BRAINSTORM_CANDIDATES: "design.brainstorm.candidates",
  BRAINSTORM_COMPLETED: "design.brainstorm.completed",

  // Image generation events
  IMAGE_GENERATE_STARTED: "design.image.generate.started",
  IMAGE_GENERATE_SKIPPED: "design.image.generate.skipped",
  IMAGE_GENERATE_SUCCEEDED: "design.image.generate.succeeded",
  IMAGE_GENERATE_FAILED: "design.image.generate.failed",
  IMAGE_FILL_COMPLETED: "design.image.fill.completed",

  // Visual render events
  VISUAL_RENDER_STARTED: "design.visual.render.started",
  VISUAL_RENDER_COMPLETED: "design.visual.render.completed",
  VISUAL_RENDER_FAILED: "design.visual.render.failed",
});
