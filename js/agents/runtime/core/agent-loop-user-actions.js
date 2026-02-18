const USER_ACTION_PREFIX = "user.action";

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function normalizeUserActionTimeout(value, fallback) {
  if (!Number.isFinite(value)) return fallback;
  const timeout = Math.floor(Number(value));
  return timeout > 0 ? timeout : fallback;
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
    if (signal?.aborted) {
      throw new Error("Run cancelled");
    }

    const timeoutMs = normalizeUserActionTimeout(timeout, 300000);

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
      }, timeoutMs);

      const off = bus.subscribe(`${USER_ACTION_PREFIX}.${actionName}`, (evt) => {
        const payload = evt && typeof evt === "object" && "payload" in evt ? evt.payload : evt;
        finish(null, payload);
      });
    });
  }
}
