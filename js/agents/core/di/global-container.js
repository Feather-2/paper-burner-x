/**
 * Global DI Container (compatibility layer)
 *
 * Provides a process-wide container used by legacy "getGlobalX()" accessors.
 * New code should prefer passing an explicit container and resolving via ServiceId.
 */

import { Container } from "./container.js";

const GLOBAL_CONTAINER_KEY = Symbol.for("pb.agents.di.globalContainer");

/**
 * @returns {boolean}
 */
function isTestEnvironment() {
  try {
    const g = /** @type {{ process?: { env?: Record<string, unknown> } }} */ (
      typeof globalThis !== "undefined" ? globalThis : {}
    );
    const env = g?.process?.env ?? null;
    if (env && typeof env.NODE_ENV === "string") return env.NODE_ENV === "test";
  } catch {
    // ignore
  }
  try {
    const meta = /** @type {ImportMeta & { env?: { MODE?: unknown } }} */ (import.meta);
    const mode = meta?.env?.MODE;
    if (typeof mode === "string") return mode === "test";
  } catch {
    // ignore
  }
  return false;
}

/**
 * Get (or create) the global DI container.
 *
 * @returns {Container}
 */
export function getGlobalContainer() {
  const root = /** @type {Record<symbol, unknown>} */ (globalThis);
  const existing = root[GLOBAL_CONTAINER_KEY];
  if (existing && (typeof existing === "object" || typeof existing === "function")) {
    const maybeGet = /** @type {{ get?: unknown }} */ (existing).get;
    if (typeof maybeGet === "function") return /** @type {Container} */ (existing);
  }

  const created = new Container();
  root[GLOBAL_CONTAINER_KEY] = created;
  return created;
}

/**
 * Override the global DI container (useful for tests).
 *
 * @param {Container | null | undefined} container
 * @returns {void}
 */
export function setGlobalContainer(container) {
  if (!isTestEnvironment()) {
    throw new Error("setGlobalContainer is only allowed in test environments");
  }
  const root = /** @type {Record<symbol, unknown>} */ (globalThis);
  if (!container) {
    Reflect.deleteProperty(root, GLOBAL_CONTAINER_KEY);
    return;
  }
  root[GLOBAL_CONTAINER_KEY] = container;
}
