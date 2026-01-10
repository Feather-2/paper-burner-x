import { HookRegistry } from "./hook-registry.js";

const REGISTRY_SYMBOL = Symbol.for("paperburner.hookRegistry.v1");

/**
 * Attach a HookRegistry to an EventBus-like object.
 *
 * This is intentionally a runtime-layer enhancement to avoid adding hook state to
 * the core EventBus implementation.
 *
 * @param {any} eventBus
 * @returns {any}
 */
export function enhanceEventBusWithHooks(eventBus) {
  const bus = eventBus && typeof eventBus === "object" ? eventBus : null;
  if (!bus) return eventBus;

  if (bus[REGISTRY_SYMBOL]) return eventBus;

  const registry = new HookRegistry();
  Object.defineProperty(bus, REGISTRY_SYMBOL, { value: registry, enumerable: false });

  if (typeof bus.registerHook !== "function") {
    bus.registerHook = (eventName, hookDef) => registry.register(eventName, hookDef);
  }
  if (typeof bus.getHooks !== "function") {
    bus.getHooks = (eventName) => registry.list(eventName);
  }
  if (typeof bus.clearHooks !== "function") {
    bus.clearHooks = (eventName) => registry.clear(eventName);
  }

  return eventBus;
}

/**
 * @param {any} eventBus
 * @returns {HookRegistry | null}
 */
export function getHookRegistry(eventBus) {
  const bus = eventBus && typeof eventBus === "object" ? eventBus : null;
  const reg = bus ? bus[REGISTRY_SYMBOL] : null;
  return reg instanceof HookRegistry ? reg : null;
}

export default { enhanceEventBusWithHooks, getHookRegistry };

