/**
 * plan - 计划管理入口
 */

export {
  PLAN_SCHEMA_VERSION,
  PLAN_ARTIFACT_TYPE,
  PlanLifecycleStatus,
  isValidPlanLifecycleStatus,
  canTransitionPlanLifecycle,
  setPlanLifecycleStatus,
  createPlan,
  normalizePlanStep,
  findPlanStepIndex,
  setPlanStepStatus,
  savePlan,
} from './plan-store.js';

export {
  STRUCTURED_PLAN_SCHEMA_VERSION,
  createRequirementsAnalysis,
  createRequirement,
  createArchitecturalDecision,
  createPlanStep,
  createRisk,
  createCriticalFile,
  createStructuredPlan,
  validateStructuredPlan,
  structuredPlanToMarkdown,
} from './structured-plan.js';
