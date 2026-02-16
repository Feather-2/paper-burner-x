const USER_ACTION_PREFIX = "user.action";

/**
 * @param {any} loop
 * @param {Record<string, any>} [options]
 * @returns {UserActionHandler}
 */
function ensureUserActionHandler(loop, options = {}) {
  if (!loop || typeof loop !== "object") {
    throw new Error("UserActionHandler requires a loop instance");
  }
  if (loop._userActionMixin instanceof UserActionHandler) return loop._userActionMixin;
  const component = new UserActionHandler(loop, options);
  loop._userActionMixin = component;
  return component;
}

export class UserActionHandler {
  /**
   * @param {any} loop
   * @param {Record<string, any>} [_options]
   */
  constructor(loop, _options = {}) {
    this._loop = loop;
  }

  /** @param {any} _eventBus @param {{ eventName?: string, signal?: AbortSignal }} [_options] */
  _attachUserInputListener(_eventBus, _options = {}) {}

  /** @param {any} _eventBus @param {{ signal?: AbortSignal }} [_options] */
  _attachPauseListener(_eventBus, _options = {}) {}

  /** Detach all event bus listeners. */
  _detachEventBusListeners() {}

  /**
   * Wait for a user action event on the event bus.
   * @param {string} actionName
   * @param {{ timeout?: number, eventBus?: any, signal?: AbortSignal }} [options]
   * @returns {Promise<any>}
   */
  async waitForUserAction(actionName, { timeout = 300000, eventBus, signal } = {}) {
    const loop = this._loop;
    const bus = eventBus || loop.eventBus;
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
  }
}

/**
 * @deprecated BaseAgentLoop now delegates explicitly; this exists for legacy callers.
 * @param {Function} BaseAgentLoop
 */
export function attachUserActionMixin(BaseAgentLoop) {
  const proto = BaseAgentLoop.prototype;

  if (!proto._attachUserInputListener) {
    proto._attachUserInputListener = function _attachUserInputListener(_eventBus, _options = {}) {
      return ensureUserActionHandler(this)._attachUserInputListener(_eventBus, _options);
    };
  }

  if (!proto._attachPauseListener) {
    proto._attachPauseListener = function _attachPauseListener(_eventBus, _options = {}) {
      return ensureUserActionHandler(this)._attachPauseListener(_eventBus, _options);
    };
  }

  if (!proto._detachEventBusListeners) {
    proto._detachEventBusListeners = function _detachEventBusListeners() {
      return ensureUserActionHandler(this)._detachEventBusListeners();
    };
  }

  proto.waitForUserAction = function waitForUserAction(actionName, options = {}) {
    return ensureUserActionHandler(this).waitForUserAction(actionName, options);
  };
}
