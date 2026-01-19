import { createLogger } from "../../shared/index.js";
import { diffLayers } from "./state-diff.js";
import { getActionLayer, BATCH } from "./action-types.js";

const logger = createLogger("runtime/memory/state-engine");

/**
 * Notify all listeners
 * @param {Set<Function>} listeners
 * @param {Map<string, Set<Function>>} layerListeners
 * @param {object} action
 * @param {object} prevState
 * @param {object} nextState
 */
export function notifyListeners(listeners, layerListeners, action, prevState, nextState) {
  // Global listeners
  for (const listener of listeners) {
    try {
      listener(action, prevState, nextState);
    } catch (err) {
      logger.error("[StateEngine] Listener error:", { error: err?.message || String(err), stack: err?.stack });
    }
  }

  // Layer listeners
  const diff = diffLayers(prevState, nextState);
  for (const [layer, changed] of Object.entries(diff)) {
    if (!changed) continue;
    const set = layerListeners.get(layer);
    if (!set) continue;
    for (const listener of set) {
      try {
        listener(action, prevState[layer], nextState[layer]);
      } catch (err) {
        logger.error(`[StateEngine] Layer ${layer} listener error:`, { error: err?.message || String(err) });
      }
    }
  }
}

/**
 * Notify listeners for batch dispatch (single notification for multiple actions)
 * @param {Set<Function>} listeners
 * @param {Map<string, Set<Function>>} layerListeners
 * @param {object[]} actions
 * @param {object} prevState
 * @param {object} nextState
 */
export function notifyListenersBatch(listeners, layerListeners, actions, prevState, nextState) {
  // Create synthetic batch action for global listeners
  const batchAction = {
    type: BATCH,
    payload: { actions, count: actions.length },
    meta: actions[0]?.meta || {},
  };

  // Global listeners receive batch summary
  for (const listener of listeners) {
    try {
      listener(batchAction, prevState, nextState);
    } catch (err) {
      logger.error("[StateEngine] Listener error (batch):", { error: err?.message || String(err) });
    }
  }

  // Layer listeners - only notify for layers that actually changed
  const diff = diffLayers(prevState, nextState);
  for (const [layer, changed] of Object.entries(diff)) {
    if (!changed) continue;
    const set = layerListeners.get(layer);
    if (!set) continue;
    for (const listener of set) {
      try {
        listener(batchAction, prevState[layer], nextState[layer]);
      } catch (err) {
        logger.error(`[StateEngine] Layer ${layer} listener error (batch):`, { error: err?.message || String(err) });
      }
    }
  }
}

/**
 * Emit state change to EventBus
 * @param {object|null} eventBus
 * @param {object} action
 * @param {object} nextState
 */
export function emitStateChange(eventBus, action, nextState) {
  if (!eventBus?.emit) return;

  const layer = getActionLayer(action.type);
  eventBus.emit("state:changed", {
    action: {
      type: action.type,
      layer,
      seq: action.meta?.seq,
      ts: action.meta?.ts,
    },
    runId: nextState.runId,
  });
}

/**
 * Emit batch state change to EventBus (single emit for multiple actions)
 * @param {object|null} eventBus
 * @param {object[]} actions
 * @param {object} nextState
 */
export function emitBatchStateChange(eventBus, actions, nextState) {
  if (!eventBus?.emit) return;

  // Collect affected layers
  const layers = new Set();
  for (const action of actions) {
    const layer = getActionLayer(action.type);
    if (layer) layers.add(layer);
  }

  eventBus.emit("state:batchChanged", {
    actions: actions.map((action) => ({
      type: action.type,
      layer: getActionLayer(action.type),
    })),
    layers: Array.from(layers),
    count: actions.length,
    seq: actions[0]?.meta?.seq,
    ts: actions[0]?.meta?.ts,
    runId: nextState.runId,
  });
}
