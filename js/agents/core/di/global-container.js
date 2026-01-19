/**
 * Global DI Container (compatibility layer)
 *
 * Provides a process-wide container used by legacy "getGlobalX()" accessors.
 * New code should prefer passing an explicit container and resolving via ServiceId.
 */

import { Container } from "./container.js";

const GLOBAL_CONTAINER_KEY = Symbol.for("pb.agents.di.globalContainer");

/**
 * Get (or create) the global DI container.
 *
 * @returns {Container}
 */
export function getGlobalContainer() {
  const root = /** @type {any} */ (globalThis);
  const existing = root[GLOBAL_CONTAINER_KEY];
  if (existing && typeof existing.get === "function") return existing;

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
  const root = /** @type {any} */ (globalThis);
  if (!container) {
    Reflect.deleteProperty(root, GLOBAL_CONTAINER_KEY);
    return;
  }
  root[GLOBAL_CONTAINER_KEY] = container;
}

