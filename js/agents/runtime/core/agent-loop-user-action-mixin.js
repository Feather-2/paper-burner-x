const USER_ACTION_PREFIX = "user.action";

/**
 * Attach user-action and event-listener stubs to BaseAgentLoop.
 * @param {Function} BaseAgentLoop
 */
export function attachUserActionMixin(BaseAgentLoop) {
  const proto = BaseAgentLoop.prototype;

  /** @param {any} _eventBus @param {{ eventName?: string, signal?: AbortSignal }} [_options] */
  proto._attachUserInputListener = proto._attachUserInputListener || function _attachUserInputListener(_eventBus, _options = {}) {};

  /** @param {any} _eventBus @param {{ signal?: AbortSignal }} [_options] */
  proto._attachPauseListener = proto._attachPauseListener || function _attachPauseListener(_eventBus, _options = {}) {};

  /** Detach all event bus listeners. */
  proto._detachEventBusListeners = proto._detachEventBusListeners || function _detachEventBusListeners() {};

  /**
   * Wait for a user action event on the event bus.
   * @param {string} actionName
   * @param {{ timeout?: number, eventBus?: any, signal?: AbortSignal }} [options]
   * @returns {Promise<any>}
   */
  proto.waitForUserAction = async function waitForUserAction(actionName, { timeout = 300000, eventBus, signal } = {}) {
    const bus = eventBus || this.eventBus;
    if (!bus || typeof bus.subscribe !== "function") {
      throw new Error("waitForUserAction: eventBus with subscribe() is required");
    }

    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (err, payload) => {
        if (done) return;
        done = true;
        clearTimeout(timeoutId);
        off?.();
        if (signal && typeof signal.removeEventListener === "function") {
          signal.removeEventListener("abort", onAbort);
        }
        if (err) reject(err);
        else resolve(payload);
      };

      const onAbort = () => {
        finish(new Error("Run cancelled"));
      };

      if (signal && typeof signal.addEventListener === "function") {
        signal.addEventListener("abort", onAbort, { once: true });
      }

      const timeoutId = setTimeout(() => {
        finish(new Error(`Timeout waiting for user action: ${actionName}`));
      }, timeout);

      const off = bus.subscribe(`${USER_ACTION_PREFIX}.${actionName}`, (evt) => {
        const payload = evt && typeof evt === "object" && "payload" in evt ? evt.payload : evt;
        finish(null, payload);
      });
    });
  };
}
