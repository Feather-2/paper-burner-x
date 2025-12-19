import { PhaseStatus } from "./states.js";
import { DeepSearchEvents } from "./events.js";

/**
 * Create phase handler registry.
 */
export function createPhaseHandlers(state, stageApi, helpers) {
  const { runScan, runGaps, runRound, runWrite, runCondense } = helpers;

  return {
    [PhaseStatus.SCAN]: async (context) => {
      await runScan(state, stageApi, context);
    },
    [PhaseStatus.GAPS]: async (context) => {
      await runGaps(state, stageApi, context);
    },
    [PhaseStatus.ROUND]: async (context) => {
      await runRound(state, stageApi, context);
    },
    [PhaseStatus.WRITE]: async (context) => {
      await runWrite(state, stageApi, context);
    },
    [PhaseStatus.CONDENSE]: async (context) => {
      await runCondense(state, stageApi, context);
    },
  };
}

/**
 * Subscribe phase transition events.
 */
export function subscribePhaseTransitions(eventBus, handlers, { onComplete, onError }) {
  return eventBus.subscribe(
    DeepSearchEvents.PHASE_TRANSITION,
    async ({ record }) => {
      const { to, context } = record?.payload ?? {};
      if (!to) return;

      const handler = handlers[to];
      if (!handler) {
        if (to === PhaseStatus.COMPLETED) {
          onComplete?.(context);
        }
        return;
      }

      try {
        await handler(context);
      } catch (err) {
        onError?.(err, { phase: to, context });
      }
    },
    { priority: 5 }
  );
}
