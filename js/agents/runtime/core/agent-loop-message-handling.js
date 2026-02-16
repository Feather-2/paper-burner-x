import { Deque } from "../../shared/index.js";
import { MessageManager } from "./message-manager.js";
import { getLimit } from "./constants/limits.js";

/**
 * @typedef {Record<string, any>} AnyRecord
 * @typedef {import("./message-manager.js").EmitFn} EmitFn
 * @typedef {{ payload: any, ts: number }} UserInputEntry
 * @typedef {{ clear?: boolean }} ConsumeUserInputsOptions
 * @typedef {{ clear?: boolean }} DrainUserInputsOptions
 * @typedef {{ key?: string }} ApplyUserInputsOptions
 * @typedef {{ emit?: EmitFn, subscribe?: (eventName: string, handler: (evt: any) => void, options?: { signal?: AbortSignal }) => (() => void) }} EventBusLike
 * @typedef {{ eventName?: string, signal?: AbortSignal }} AttachListenerOptions
 *
 * @typedef {object} InitMessageHandlingOptions
 * @property {AnyRecord | null} [contextConfig]
 * @property {any} [tokenCounter]
 * @property {any} [logger]
 * @property {EmitFn | null} [emit]
 * @property {string} [stageName]
 * @property {string} [actor]
 * @property {number} [maxUserInputs]
 */

export class MessageHandling {
  /**
   * @param {any} loop
   * @param {InitMessageHandlingOptions} [options]
   */
  constructor(loop, { contextConfig, tokenCounter, logger, emit, stageName, actor, maxUserInputs } = {}) {
    this._loop = loop;
    this._loop._messageManager = new MessageManager({
      contextConfig,
      tokenCounter,
      logger,
      emit,
      stageName,
      actor,
    });

    /** @type {Deque<UserInputEntry>} */
    this._loop._userInputs = new Deque();
    this._loop._maxUserInputs = getLimit("MAX_USER_INPUTS", maxUserInputs);
    this._loop._userInputUnsub = null;
    this._loop._userInputBus = null;
    this._loop._userInputEvent = "user.input";
    this._loop._pauseListenerUnsub = null;
  }

  // ===== Message handling (delegates to MessageManager) =====

  /** @returns {any[]} */
  get messages() {
    return this._loop._messageManager.messages;
  }

  /** @returns {any} */
  get _contextConfig() {
    return this._loop._messageManager._contextConfig;
  }

  /** @param {any} value */
  set _contextConfig(value) {
    this._loop._messageManager._contextConfig = value;
  }

  /** @returns {{ input: number, output: number, total: number }} */
  get _tokenUsage() {
    return this._loop._messageManager._tokenUsage;
  }

  /** @returns {any[]} */
  get _compressionHistory() {
    return this._loop._messageManager._compressionHistory;
  }

  /** @returns {Promise<void> | null} */
  get _compressionPromise() {
    return this._loop._messageManager._compressionPromise;
  }

  /** @returns {boolean} */
  get _compressionPending() {
    return this._loop._messageManager._compressionPending;
  }

  /** @param {any} message */
  addMessage(message) {
    return this._loop._messageManager.addMessage(message);
  }

  /** @param {any[]} messages */
  addMessages(messages) {
    return this._loop._messageManager.addMessages(messages);
  }

  /** @param {{ clearCompressionHistory?: boolean } | null | undefined} [options] */
  async resetMessages(options = {}) {
    return this._loop._messageManager.reset(options);
  }

  /** @returns {boolean} */
  _shouldCompress() {
    return this._loop._messageManager._shouldCompress();
  }

  /** @param {{ force?: boolean } | null | undefined} [options] */
  _scheduleCompression(options) {
    return this._loop._messageManager._scheduleCompression(options);
  }

  /** @param {{ maxRounds?: number } | null | undefined} [options] */
  async flushCompression(options) {
    return this._loop._messageManager.flushCompression(options);
  }

  /** @returns {Promise<void>} */
  async _compressMessages() {
    return this._loop._messageManager._compress();
  }

  /** @returns {any} */
  getContextStatus() {
    return this._loop._messageManager.getStatus();
  }

  /** @param {AnyRecord} config */
  setContextConfig(config) {
    return this._loop._messageManager.setContextConfig(config);
  }

  // ===== User input handling =====

  /**
   * @param {EventBusLike} eventBus
   * @param {AttachListenerOptions} [options]
   */
  _attachUserInputListener(eventBus, { eventName, signal } = {}) {
    if (!eventBus || typeof eventBus.subscribe !== "function") return;
    const loop = this._loop;
    const resolvedEvent = typeof eventName === "string" && eventName ? eventName : loop._userInputEvent;
    if (loop._userInputBus === eventBus && loop._userInputEvent === resolvedEvent) return;
    if (typeof loop._userInputUnsub === "function") loop._userInputUnsub();
    loop._userInputBus = eventBus;
    loop._userInputEvent = resolvedEvent;
    loop._userInputUnsub = eventBus.subscribe(
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
    const loop = this._loop;
    if (loop._pauseListenerUnsub) return;
    loop._pauseListenerUnsub = eventBus.subscribe(
      "user.action.pause",
      (evt) => {
        const payload = evt && typeof evt === "object" && "payload" in evt ? evt.payload : evt;
        const reason = payload?.reason || payload?.message || payload;
        loop.pause(typeof reason === "string" ? reason : "user_requested");
      },
      { ...(signal ? { signal } : {}) }
    );
  }

  /** @returns {void} */
  _detachEventBusListeners() {
    const loop = this._loop;
    if (typeof loop._userInputUnsub === "function") {
      try {
        loop._userInputUnsub();
      } catch {
        // ignore
      }
    }
    loop._userInputUnsub = null;
    loop._userInputBus = null;

    if (typeof loop._pauseListenerUnsub === "function") {
      try {
        loop._pauseListenerUnsub();
      } catch {
        // ignore
      }
    }
    loop._pauseListenerUnsub = null;
  }

  /**
   * @param {any} payload
   * @returns {UserInputEntry}
   */
  recordUserInput(payload) {
    const loop = this._loop;
    const entry = {
      payload,
      ts: Date.now(),
    };
    loop._userInputs.push(entry);
    const limit = loop._maxUserInputs;
    if (typeof limit === "number" && Number.isFinite(limit) && limit > 0) {
      while (loop._userInputs.size > limit) {
        loop._userInputs.shift();
      }
    }
    const emit = loop.emit || loop.eventBus?.emit;
    if (typeof emit === "function") {
      emit(`${loop.stageName}.user.input`, { actor: loop.actor, status: "info", payload: entry });
    }
    return entry;
  }

  /**
   * @param {ConsumeUserInputsOptions} [options]
   * @returns {UserInputEntry[]}
   */
  consumeUserInputs({ clear = true } = {}) {
    const items = this._loop._userInputs.toArray();
    if (clear) this._loop._userInputs.clear();
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
    return this._loop._userInputs && this._loop._userInputs.size > 0;
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
