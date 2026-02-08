import { toNonEmptyString } from "./utils.js";
import { protoSafeReviver } from "../../../shared/utils/safe-json.js";

const TAB_COORDINATOR_HOOKS_KEY = "__l3StorageHooks";

export function encodeTabCoordinatorSession(runId, snapshotId) {
  const resolvedRunId = toNonEmptyString(runId);
  const resolvedSnapshotId = toNonEmptyString(snapshotId);
  if (!resolvedRunId || !resolvedSnapshotId) return null;
  return JSON.stringify({ runId: resolvedRunId, snapshotId: resolvedSnapshotId });
}

export function decodeTabCoordinatorSession(sessionId) {
  const raw = toNonEmptyString(sessionId);
  if (!raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw, protoSafeReviver);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const runId = toNonEmptyString(parsed.runId);
  const snapshotId = toNonEmptyString(parsed.snapshotId);
  if (!runId || !snapshotId) return null;
  return { runId, snapshotId };
}

/** @private */
function callTabCoordinatorHandler(handler, sessionId, label, logger) {
  if (typeof handler !== "function") return;
  try {
    handler(sessionId);
  } catch (err) {
    logger?.warn?.(`[L3Storage] tabCoordinator ${label} handler error:`, err);
  }
}

/** @private */
function callTabCoordinatorHandlers(handlers, sessionId, label, logger) {
  for (const handler of handlers) {
    callTabCoordinatorHandler(handler, sessionId, label, logger);
  }
}

export function ensureTabCoordinatorHooks(tabCoordinator, logger) {
  const coordinator = tabCoordinator && typeof tabCoordinator === "object" ? tabCoordinator : null;
  if (!coordinator) return null;

  const existing = coordinator[TAB_COORDINATOR_HOOKS_KEY];
  if (existing && existing.eviction && existing.access) {
    return existing;
  }

  const hooks = {
    eviction: new Set(),
    access: new Set(),
    originalEviction: typeof coordinator._onEviction === "function" ? coordinator._onEviction : null,
    originalAccess: typeof coordinator._onAccess === "function" ? coordinator._onAccess : null,
  };

  coordinator[TAB_COORDINATOR_HOOKS_KEY] = hooks;

  coordinator._onEviction = (sessionId) => {
    callTabCoordinatorHandler(hooks.originalEviction, sessionId, "onEviction", logger);
    callTabCoordinatorHandlers(hooks.eviction, sessionId, "onEviction", logger);
  };

  coordinator._onAccess = (sessionId) => {
    callTabCoordinatorHandler(hooks.originalAccess, sessionId, "onAccess", logger);
    callTabCoordinatorHandlers(hooks.access, sessionId, "onAccess", logger);
  };

  return hooks;
}

export function releaseTabCoordinatorHooks(tabCoordinator, hooks) {
  const coordinator = tabCoordinator && typeof tabCoordinator === "object" ? tabCoordinator : null;
  if (!coordinator || !hooks) return;
  if (coordinator[TAB_COORDINATOR_HOOKS_KEY] !== hooks) return;

  if (hooks.eviction.size === 0 && hooks.access.size === 0) {
    coordinator._onEviction = hooks.originalEviction || null;
    coordinator._onAccess = hooks.originalAccess || null;
    delete coordinator[TAB_COORDINATOR_HOOKS_KEY];
  }
}
