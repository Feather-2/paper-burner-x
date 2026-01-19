import { Deque } from "../../shared/index.js";
import { MessageManager } from "./message-manager.js";
import { getLimit } from "./constants/limits.js";

/**
 * @typedef {Record<string, any>} AnyRecord
 * @typedef {{ payload: any, ts: number }} UserInputEntry
 * @typedef {{ clear?: boolean }} ConsumeUserInputsOptions
 * @typedef {{ clear?: boolean }} DrainUserInputsOptions
 * @typedef {{ key?: string }} ApplyUserInputsOptions
 * @typedef {{ emit?: Function, subscribe?: (eventName: string, handler: (evt: any) => void, options?: { signal?: AbortSignal }) => (() => void) }} EventBusLike
 * @typedef {{ eventName?: string, signal?: AbortSignal }} AttachListenerOptions
 */

/**
 * @param {any} loop
 * @param {object} options
 * @param {AnyRecord | null} [options.contextConfig]
 * @param {any} [options.tokenCounter]
 * @param {any} [options.logger]
 * @param {Function | null} [options.emit]
 * @param {string} options.stageName
 * @param {string} options.actor
 * @param {number} [options.maxUserInputs]
 */
export function initMessageHandling(
  loop,
  { contextConfig, tokenCounter, logger, emit, stageName, actor, maxUserInputs } = {}
) {
  loop._messageManager = new MessageManager({
    contextConfig,
    tokenCounter,
    logger,
    emit,
    stageName,
    actor,
  });

  /** @type {Deque<UserInputEntry>} */
  loop._userInputs = new Deque();
  loop._maxUserInputs = getLimit("MAX_USER_INPUTS", maxUserInputs);
  loop._userInputUnsub = null;
  loop._userInputBus = null;
  loop._userInputEvent = "user.input";
  loop._pauseListenerUnsub = null;
}

class AgentLoopMessageHandling {
  // ===== Message handling (delegates to MessageManager) =====

  /** @returns {any[]} */
  get messages() {
    return this._messageManager.messages;
  }

  /** @returns {any} */
  get _contextConfig() {
    return this._messageManager._contextConfig;
  }

  /** @param {any} value */
  set _contextConfig(value) {
    this._messageManager._contextConfig = value;
  }

  /** @returns {{ input: number, output: number, total: number }} */
  get _tokenUsage() {
    return this._messageManager._tokenUsage;
  }

  /** @returns {any[]} */
  get _compressionHistory() {
    return this._messageManager._compressionHistory;
  }

  /** @returns {Promise<void> | null} */
  get _compressionPromise() {
    return this._messageManager._compressionPromise;
  }

  /** @returns {boolean} */
  get _compressionPending() {
    return this._messageManager._compressionPending;
  }

  /** @param {any} message */
  addMessage(message) {
    return this._messageManager.addMessage(message);
  }

  /** @param {any[]} messages */
  addMessages(messages) {
    return this._messageManager.addMessages(messages);
  }

  /** @param {{ clearCompressionHistory?: boolean } | null | undefined} [options] */
  async resetMessages(options = {}) {
    return this._messageManager.reset(options);
  }

  /** @returns {boolean} */
  _shouldCompress() {
    return this._messageManager._shouldCompress();
  }

  /** @param {{ force?: boolean } | null | undefined} [options] */
  _scheduleCompression(options) {
    return this._messageManager._scheduleCompression(options);
  }

  /** @param {{ maxRounds?: number } | null | undefined} [options] */
  async flushCompression(options) {
    return this._messageManager.flushCompression(options);
  }

  /** @returns {Promise<void>} */
  async _compressMessages() {
    return this._messageManager._compress();
  }

  /** @returns {any} */
  getContextStatus() {
    return this._messageManager.getStatus();
  }

  /** @param {AnyRecord} config */
  setContextConfig(config) {
    return this._messageManager.setContextConfig(config);
  }

  // ===== User input handling =====

  /**
   * @param {EventBusLike} eventBus
   * @param {AttachListenerOptions} [options]
   */
  _attachUserInputListener(eventBus, { eventName, signal } = {}) {
    if (!eventBus || typeof eventBus.subscribe !== "function") return;
    const resolvedEvent = typeof eventName === "string" && eventName ? eventName : this._userInputEvent;
    if (this._userInputBus === eventBus && this._userInputEvent === resolvedEvent) return;
    if (typeof this._userInputUnsub === "function") this._userInputUnsub();
    this._userInputBus = eventBus;
    this._userInputEvent = resolvedEvent;
    this._userInputUnsub = eventBus.subscribe(
      resolvedEvent,
      (evt) => {
        const payload = evt && typeof evt === "object" && "payload" in evt ? evt.payload : evt;
        this.recordUserInput(payload);
      },
      { ...(signal ? { signal } : {}) }
    );
  }

  /**
   * @param {EventBusLike} eventBus
   * @param {{ signal?: AbortSignal }} [options]
   */
  _attachPauseListener(eventBus, { signal } = {}) {
    if (!eventBus || typeof eventBus.subscribe !== "function") return;
    if (this._pauseListenerUnsub) return;
    this._pauseListenerUnsub = eventBus.subscribe(
      "user.action.pause",
      (evt) => {
        const payload = evt && typeof evt === "object" && "payload" in evt ? evt.payload : evt;
        const reason = payload?.reason || payload?.message || payload;
        this.pause(typeof reason === "string" ? reason : "user_requested");
      },
      { ...(signal ? { signal } : {}) }
    );
  }

  /** @returns {void} */
  _detachEventBusListeners() {
    if (typeof this._userInputUnsub === "function") {
      try {
        this._userInputUnsub();
      } catch {
        // ignore
      }
    }
    this._userInputUnsub = null;
    this._userInputBus = null;

    if (typeof this._pauseListenerUnsub === "function") {
      try {
        this._pauseListenerUnsub();
      } catch {
        // ignore
      }
    }
    this._pauseListenerUnsub = null;
  }

  /**
   * @param {any} payload
   * @returns {UserInputEntry}
   */
  recordUserInput(payload) {
    const entry = {
      payload,
      ts: Date.now(),
    };
    this._userInputs.push(entry);
    const limit = this._maxUserInputs;
    if (typeof limit === "number" && Number.isFinite(limit) && limit > 0) {
      while (this._userInputs.size > limit) {
        this._userInputs.shift();
      }
    }
    const emit = this.emit || this.eventBus?.emit;
    if (typeof emit === "function") {
      emit(`${this.stageName}.user.input`, { actor: this.actor, status: "info", payload: entry });
    }
    return entry;
  }

  /**
   * @param {ConsumeUserInputsOptions} [options]
   * @returns {UserInputEntry[]}
   */
  consumeUserInputs({ clear = true } = {}) {
    const items = this._userInputs.toArray();
    if (clear) this._userInputs.clear();
    return items;
  }

  /**
   * @param {DrainUserInputsOptions} [options]
   * @returns {{ items: UserInputEntry[], text: string }}
   */
  drainUserInputsAsText({ clear = true } = {}) {
    const items = this.consumeUserInputs({ clear });
    const text = this.formatUserInputs(items);
    return { items, text };
  }

  /**
   * @param {AnyRecord} userConfig
   * @param {ApplyUserInputsOptions} [options]
   * @returns {AnyRecord}
   */
  applyUserInputsToConfig(userConfig, { key = "userNotes" } = {}) {
    const { items, text } = this.drainUserInputsAsText({ clear: true });
    if (!text) return userConfig;
    const next = userConfig && typeof userConfig === "object" ? { ...userConfig } : {};
    const existing = Array.isArray(next[key]) ? next[key] : typeof next[key] === "string" ? [next[key]] : [];
    next[key] = [...existing, text];
    next._lastUserNote = text;
    next._lastUserNoteAt = Date.now();
    next._rawUserInputs = Array.isArray(next._rawUserInputs) ? [...next._rawUserInputs, ...items] : [...items];
    return next;
  }

  /** @returns {boolean} */
  hasPendingUserInputs() {
    return this._userInputs && this._userInputs.size > 0;
  }

  /**
   * @param {Array<UserInputEntry | any>} items
   * @returns {string}
   */
  formatUserInputs(items) {
    const list = Array.isArray(items) ? items : [];
    const lines = [];
    for (const item of list) {
      const payload = item?.payload ?? item;
      if (payload == null) continue;
      if (typeof payload === "string") {
        lines.push(payload.trim());
        continue;
      }
      if (typeof payload?.text === "string") {
        lines.push(payload.text.trim());
        continue;
      }
      if (typeof payload?.message === "string") {
        lines.push(payload.message.trim());
        continue;
      }
      try {
        lines.push(JSON.stringify(payload));
      } catch {
        lines.push(String(payload));
      }
    }
    return lines.filter(Boolean).join("\n");
  }
}

/** @param {new (...args: any[]) => any} BaseAgentLoop */
export function attachMessageHandling(BaseAgentLoop) {
  const descriptors = Object.getOwnPropertyDescriptors(AgentLoopMessageHandling.prototype);
  delete descriptors.constructor;
  Object.defineProperties(BaseAgentLoop.prototype, descriptors);
}
