/**
 * Runtime Lifecycle - Sub-path export
 *
 * Usage: import { createLifecycleEmitter } from 'js/agents/runtime/lifecycle';
 */

export {
  createLifecycleEmitter,
  createEventPayload,
  createPhaseTransitionPayload,
  createStatusChangePayload,
  createStepPayload,
  LifecycleEventNames,
  canTransitionStatus,
  assertValidTransition,
} from "./core/lifecycle.js";
