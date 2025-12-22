/**
 * EventHandlerRegistry - modular event handling
 *
 * Solves:
 * 1. 100+ line conditional branches in workflow-runtime.js
 * 2. Adding new events touches multiple files
 * 3. Event logic is hard to test
 */

/**
 * Event handler registry.
 */
export class EventHandlerRegistry {
  constructor(context = {}) {
    this.context = context;
    this.handlers = new Map();
    this.wildcardHandlers = [];
  }

  /**
   * Register an event handler.
   * @param {string} pattern - Event pattern (supports wildcard * like 'design.*')
   * @param {Function} handler - (eventName, payload, context) => void
   */
  register(pattern, handler) {
    if (typeof handler !== "function") {
      throw new TypeError("handler must be a function");
    }

    if (pattern.includes("*")) {
      const regex = this._patternToRegex(pattern);
      this.wildcardHandlers.push({ pattern, regex, handler });
    } else {
      if (!this.handlers.has(pattern)) {
        this.handlers.set(pattern, []);
      }
      this.handlers.get(pattern).push(handler);
    }

    return this;
  }

  /**
   * Dispatch event to matching handlers.
   * @param {string} eventName - Event name
   * @param {object} payload - Event payload
   */
  dispatch(eventName, payload) {
    let handled = false;

    const exactHandlers = this.handlers.get(eventName);
    if (exactHandlers) {
      for (const handler of exactHandlers) {
        try {
          handler.call(this.context, eventName, payload, this.context);
          handled = true;
        } catch (err) {
          console.error(`[EventHandlerRegistry] Handler error for ${eventName}:`, err?.message);
        }
      }
    }

    for (const { regex, handler } of this.wildcardHandlers) {
      if (regex.test(eventName)) {
        try {
          handler.call(this.context, eventName, payload, this.context);
          handled = true;
        } catch (err) {
          console.error(`[EventHandlerRegistry] Wildcard handler error for ${eventName}:`, err?.message);
        }
      }
    }

    return handled;
  }

  /**
   * Remove event handler(s).
   * @param {string} pattern - Event pattern
   * @param {Function} handler - Optional handler to remove
   */
  unregister(pattern, handler) {
    if (pattern.includes("*")) {
      if (handler) {
        this.wildcardHandlers = this.wildcardHandlers.filter(
          (h) => h.pattern !== pattern || h.handler !== handler
        );
      } else {
        this.wildcardHandlers = this.wildcardHandlers.filter(
          (h) => h.pattern !== pattern
        );
      }
    } else {
      if (handler) {
        const handlers = this.handlers.get(pattern);
        if (handlers) {
          const idx = handlers.indexOf(handler);
          if (idx >= 0) handlers.splice(idx, 1);
        }
      } else {
        this.handlers.delete(pattern);
      }
    }

    return this;
  }

  /**
   * Clear all handlers.
   */
  clear() {
    this.handlers.clear();
    this.wildcardHandlers = [];
    return this;
  }

  _patternToRegex(pattern) {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    const regex = escaped.replace(/\*/g, ".*");
    return new RegExp(`^${regex}$`);
  }
}

/**
 * Predefined event handler collection.
 */
export const DeepSearchEventHandlers = {
  /**
   * Run status event handler.
   */
  runStatus: (eventName, payload, ctx) => {
    if (eventName === "run.started") {
      ctx.updateTodos?.(payload.todos);
    }
    if (eventName === "run.completed") {
      ctx.onRunCompleted?.(payload);
    }
    if (eventName === "run.failed") {
      ctx.onRunFailed?.(payload);
    }
  },

  /**
   * DeepSearch progress event handler.
   */
  deepsearchProgress: (eventName, payload, ctx) => {
    const stage = eventName.split(".")[1];
    const status = payload?.status || "progress";

    if (status === "started") {
      ctx.logTerminal?.("system", `[DeepSearch] ${stage} started`);
    }
    if (status === "ended" || status === "completed") {
      ctx.logTerminal?.("system", `[DeepSearch] ${stage} completed`);
    }
    if (status === "warn") {
      ctx.logTerminal?.("warning", `[DeepSearch] ${stage}: ${payload?.message || "warning"}`);
    }
  },

  /**
   * Design phase event handler.
   */
  designPhase: (eventName, payload, ctx) => {
    if (eventName === "design.phase.transition") {
      ctx.onDesignPhaseChange?.(payload.from, payload.to);
    }
    if (eventName === "design.degraded") {
      ctx.logTerminal?.("warning", `[Design] Slide degraded: ${payload?.slideNo || "?"}`);
    }
  },

  /**
   * Error event handler.
   */
  errors: (eventName, payload, ctx) => {
    if (eventName.endsWith(".failed") || eventName.endsWith(".error")) {
      const error = payload?.error || payload?.message || "Unknown error";
      ctx.logTerminal?.("error", `[Error] ${eventName}: ${error}`);
      ctx.onError?.(eventName, error);
    }
  },
};

/**
 * Create a registry with predefined handlers.
 */
export function createWorkflowEventRegistry(context) {
  const registry = new EventHandlerRegistry(context);

  registry.register("run.*", DeepSearchEventHandlers.runStatus);
  registry.register("deepsearch.*", DeepSearchEventHandlers.deepsearchProgress);
  registry.register("design.*", DeepSearchEventHandlers.designPhase);
  registry.register("*.failed", DeepSearchEventHandlers.errors);
  registry.register("*.error", DeepSearchEventHandlers.errors);

  return registry;
}

export default EventHandlerRegistry;
