import { createLogger } from "../../../shared/index.js";
import { deepClone } from "../../../shared/utils/value-utils.js";
import { Watchdog } from "../../../plugins/compression/index.js";
import {
  DESIGN_LOOP_DEFAULTS,
  buildDesignWatchdogAdvice,
  emitStage,
  resolveWatchdogSettings,
  summarizeRefineEventForWatchdog,
} from "../design-helpers.js";
import { VisualHandler } from "./visual-handler.js";

const logger = createLogger("stages/design/agent-loop");

export class DeckOperations {
  constructor(loop, { imageConcurrency } = /** @type {{ imageConcurrency?: number }} */ ({}) ) {
    this._loop = loop;
    this._visualHandler = new VisualHandler({ imageConcurrency });
  }

  initDesignSystem(contentPackage, context, constraints, userConfig) {
    return this._visualHandler.initDesignSystem(contentPackage, context, constraints, userConfig);
  }

  buildVisualSlots(brainstormResult, imageSlots, imageProvider, hasModelCapability = true) {
    return this._visualHandler.buildVisualSlots(brainstormResult, imageSlots, imageProvider, hasModelCapability);
  }

  async renderVisuals(
    visualSlotsForRender,
    contentPackage,
    designSystem,
    slideHtmls,
    context,
    runContext,
    constraints,
    imageSlots,
    aiImageSlotIds
  ) {
    if (this._loop.state && typeof this._loop.state === "object") {
      this._loop.state.visualSlots = Array.isArray(visualSlotsForRender) ? deepClone(visualSlotsForRender) : [];
    }
    return this._visualHandler.renderVisuals(
      visualSlotsForRender,
      contentPackage,
      designSystem,
      slideHtmls,
      context,
      runContext,
      constraints,
      imageSlots,
      aiImageSlotIds
    );
  }
}

export function installDeckOperations(ctor) {
  Object.assign(ctor.prototype, {
    /**
     * @this {{ _deckOps: DeckOperations }}
     */
    _initDesignSystem(contentPackage, context, constraints, userConfig) {
      return this._deckOps.initDesignSystem(contentPackage, context, constraints, userConfig);
    },
    /**
     * @this {{ _deckOps: DeckOperations }}
     */
    _buildVisualSlots(brainstormResult, imageSlots, imageProvider, hasModelCapability = true) {
      return this._deckOps.buildVisualSlots(brainstormResult, imageSlots, imageProvider, hasModelCapability);
    },
    /**
     * @this {{ _deckOps: DeckOperations }}
     */
    _renderVisuals(
      visualSlotsForRender,
      contentPackage,
      designSystem,
      slideHtmls,
      context,
      runContext,
      constraints,
      imageSlots,
      aiImageSlotIds
    ) {
      return this._deckOps.renderVisuals(
        visualSlotsForRender,
        contentPackage,
        designSystem,
        slideHtmls,
        context,
        runContext,
        constraints,
        imageSlots,
        aiImageSlotIds
      );
    },
  });
}

export async function initWatchdogManager({ loop, context, runContext, contentPackage, runId, emit, eventBus }) {
  const initialUserConfig =
    (runContext && typeof runContext === "object" ? runContext.userConfig : undefined) ||
    (contentPackage && typeof contentPackage === "object" ? contentPackage.userConfig : undefined) ||
    (context && typeof context === "object" ? context.userConfig : undefined) ||
    {};
  const watchdogSettings = resolveWatchdogSettings(initialUserConfig);
  let watchdog = await loop.phaseRunner._resolveDependency("watchdog", context, null);
  if (watchdog && typeof watchdog.reset === "function") watchdog.reset();
  if (!watchdog) {
    watchdog = new Watchdog({
      eventBus: loop.eventBus,
      maxRecentOutputs: watchdogSettings.maxRecentOutputs,
      oscillationThreshold: watchdogSettings.similarityThreshold,
    });
  } else if (typeof watchdog.configure === "function") {
    watchdog.configure({
      maxRecentOutputs: watchdogSettings.maxRecentOutputs,
      oscillationThreshold: watchdogSettings.similarityThreshold,
    });
  }
  loop._watchdog = watchdog;
  let lastInterventionAt = 0;

  const handleWatchdogHealth = (health, meta = {}) => {
    if (!health || health.healthy) return;
    const now = Date.now();
    if (now - lastInterventionAt < 1500) return;
    lastInterventionAt = now;

    const advice = buildDesignWatchdogAdvice(health.issues);
    logger.warn("[design] Watchdog intervention", { runId, ...meta, issues: health.issues, stats: health.stats, advice });
    emitStage(emit, "design.watchdog.intervention", "warn", { runId, ...meta, issues: health.issues, stats: health.stats, advice });
    loop._blackboard?.logDecision?.("watchdog_intervention", advice, { runId, ...meta, issues: health.issues, stats: health.stats });

    if (typeof watchdog?.resetOscillation === "function") watchdog.resetOscillation();
  };

  const offRefineWatchdog =
    eventBus && typeof eventBus.on === "function"
      ? eventBus.on("design:refine:step", (evt) => {
          if (evt?.runId && evt.runId !== runId) return;
          if (!watchdog) return;

          const summary = summarizeRefineEventForWatchdog(evt);
          if (!summary) return;
          watchdog.tick?.();
          watchdog.recordOutput?.(summary);
          const health = watchdog.checkHealth?.({
            maxIterations: 200,
            maxTimeMs: watchdogSettings.maxTimeMs,
            stuckThresholdMs: watchdogSettings.stuckThresholdMs,
            oscillationConsecutiveThreshold: watchdogSettings.maxConsecutiveSimilar,
          });
          if (health && !health.healthy) {
            handleWatchdogHealth(health, { phase: loop.phase?.status, source: "refine_step", refineStep: evt?.payload?.stepIndex });
          }
        })
      : null;

  return { watchdog, watchdogSettings, handleWatchdogHealth, offRefineWatchdog };
}

function buildDeckSignature(deckHtmlDsl) {
  if (typeof deckHtmlDsl !== "string") return null;
  const sigLen = DESIGN_LOOP_DEFAULTS.signatureLength;
  const head = deckHtmlDsl.slice(0, sigLen);
  const tail = deckHtmlDsl.slice(-sigLen);
  return `${deckHtmlDsl.length}:${head}:${tail}`;
}

export function createDeckUpdateEmitter({ loop, emit, runId, watchdog, watchdogSettings, handleWatchdogHealth }) {
  let lastDeckSignature = null;
  return (deckHtmlDsl, slidesMeta, { source } = /** @type {{ source?: string }} */ ({}) ) => {
    if (!emit || typeof deckHtmlDsl !== "string") return;
    if (!deckHtmlDsl.includes("<section")) return;
    const signature = buildDeckSignature(deckHtmlDsl);

    if (watchdog && signature) {
      watchdog.recordOutput?.(`deck_update | source=${source || "update"} | sig=${signature}`);
      const health = watchdog.checkHealth?.({
        maxIterations: 200,
        maxTimeMs: watchdogSettings.maxTimeMs,
        stuckThresholdMs: watchdogSettings.stuckThresholdMs,
        oscillationConsecutiveThreshold: watchdogSettings.maxConsecutiveSimilar,
      });
      if (health && !health.healthy) {
        handleWatchdogHealth(health, { phase: loop.phase?.status, source: source || "update" });
      }
    }

    if (signature && signature === lastDeckSignature) return;
    lastDeckSignature = signature;
    loop._blackboard?.setDeck?.({ deckHtmlDsl, slidesMeta: Array.isArray(slidesMeta) ? slidesMeta : [] });
    emitStage(emit, "design.deck.updated", "progress", {
      runId,
      source: source || "update",
      phase: loop.phase?.status,
      slides: Array.isArray(slidesMeta) ? slidesMeta.length : undefined,
      deckHtmlDsl,
      slidesMeta: Array.isArray(slidesMeta) ? slidesMeta : undefined,
    });
  };
}

export function finalizeDeck(loop) {
  if (!loop?._blackboard) return;
  loop._blackboard.setSummary("generation", `${loop.state.slideHtmls.length} slides generated`);
  loop._blackboard.saveVersion("final", {
    deckHtmlDsl: loop.state.deckHtmlDsl,
    designSystem: loop.state.designSystem,
    slidesMeta: loop.state.slidesMeta,
  });
  loop._blackboard.setDeck({ deckHtmlDsl: loop.state.deckHtmlDsl, slidesMeta: loop.state.slidesMeta });
}
