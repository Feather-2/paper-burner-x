/**
 * Lightweight Dependency Injection Container
 *
 * Features:
 * - Singleton and transient scopes
 * - Lazy instantiation
 * - Child containers for testing
 * - No external dependencies
 */

export const SINGLETON = Symbol("singleton");
export const TRANSIENT = Symbol("transient");

/**
 * @typedef {Object} ServiceEntry
 * @property {Function} factory - Factory function (container) => instance
 * @property {Symbol} scope - SINGLETON or TRANSIENT
 */

export class Container {
  /** @type {Map<string, ServiceEntry>} */
  #factories = new Map();

  /** @type {Map<string, any>} */
  #singletons = new Map();

  /** @type {Container|null} */
  #parent = null;

  /**
   * @param {Container} [parent] - Parent container for hierarchical resolution
   */
  constructor(parent = null) {
    this.#parent = parent;
  }

  /**
   * Register a service factory.
   *
   * @param {string} id - Service identifier
   * @param {Function} factory - Factory function (container) => instance
   * @param {Object} [options]
   * @param {Symbol} [options.scope=SINGLETON] - SINGLETON or TRANSIENT
   * @returns {this}
   */
  register(id, factory, { scope = SINGLETON } = {}) {
    if (typeof id !== "string" || !id) {
      throw new Error("Service id must be a non-empty string");
    }
    if (typeof factory !== "function") {
      throw new Error(`Factory for "${id}" must be a function`);
    }
    this.#factories.set(id, { factory, scope });
    return this;
  }

  /**
   * Register a constant value (shorthand for singleton factory).
   *
   * @param {string} id - Service identifier
   * @param {*} value - Constant value
   * @returns {this}
   */
  registerValue(id, value) {
    return this.register(id, () => value, { scope: SINGLETON });
  }

  /**
   * Check if a service is registered (including parent).
   *
   * @param {string} id - Service identifier
   * @returns {boolean}
   */
  has(id) {
    return this.#factories.has(id) || (this.#parent?.has(id) ?? false);
  }

  /**
   * Get a service instance.
   *
   * @param {string} id - Service identifier
   * @returns {*} Service instance
   * @throws {Error} If service is not registered
   */
  get(id) {
    // Check singleton cache first
    if (this.#singletons.has(id)) {
      return this.#singletons.get(id);
    }

    // Check local factory
    const entry = this.#factories.get(id);
    if (entry) {
      const instance = entry.factory(this);
      if (entry.scope === SINGLETON) {
        this.#singletons.set(id, instance);
      }
      return instance;
    }

    // Delegate to parent
    if (this.#parent) {
      return this.#parent.get(id);
    }

    throw new Error(`Service not registered: ${id}`);
  }

  /**
   * Try to get a service, return null if not registered.
   *
   * @param {string} id - Service identifier
   * @returns {*|null}
   */
  tryGet(id) {
    try {
      return this.has(id) ? this.get(id) : null;
    } catch {
      return null;
    }
  }

  /**
   * Override a service (useful for testing).
   * Clears any cached singleton for this id.
   *
   * @param {string} id - Service identifier
   * @param {Function} factory - New factory function
   * @returns {this}
   */
  override(id, factory) {
    this.#singletons.delete(id);
    return this.register(id, factory, { scope: SINGLETON });
  }

  /**
   * Reset all singleton instances (useful for testing).
   */
  reset() {
    this.#singletons.clear();
  }

  /**
   * Create a child container that inherits from this one.
   * Child can override services without affecting parent.
   *
   * @returns {Container}
   */
  createChild() {
    return new Container(this);
  }

  /**
   * Get all registered service ids (including parent).
   *
   * @returns {string[]}
   */
  getServiceIds() {
    const ids = new Set(this.#factories.keys());
    if (this.#parent) {
      for (const id of this.#parent.getServiceIds()) {
        ids.add(id);
      }
    }
    return [...ids];
  }
}

/**
 * Create a new container with optional initial registrations.
 *
 * @param {Object.<string, Function>} [registrations] - Initial registrations
 * @returns {Container}
 */
export function createContainer(registrations = {}) {
  const container = new Container();
  for (const [id, factory] of Object.entries(registrations)) {
    container.register(id, factory);
  }
  return container;
}
