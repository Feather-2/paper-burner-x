import { isPlainObject, toNonEmptyString } from "../../shared/utils/value-utils.js";

/**
 * @typedef {"session-evicted" | "session-accessed" | "leader-election" | "heartbeat"} TabCoordinatorMessageType
 */

/**
 * @typedef {Object} TabCoordinatorMessage
 * @property {TabCoordinatorMessageType} type
 * @property {string} tabId
 * @property {string} [sessionId]
 * @property {number} ts
 */

/**
 * @typedef {Object} TabCoordinatorOptions
 * @property {string} [channelName]
 * @property {number} [heartbeatMs]
 * @property {(sessionId: string) => void} [onEviction]
 * @property {(sessionId: string) => void} [onAccess]
 * @property {any} [logger]
 */

const DEFAULT_CHANNEL_NAME = "agent-sessions";
const DEFAULT_HEARTBEAT_MS = 5000;
const STALE_MULTIPLIER = 3;
const MESSAGE_TYPES = new Set(["session-evicted", "session-accessed", "leader-election", "heartbeat"]);

/**
 * @param {any} value
 * @param {number} fallback
 * @returns {number}
 */
function toPositiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * @returns {boolean}
 */
function isBroadcastChannelSupported() {
  return typeof BroadcastChannel !== "undefined";
}

/**
 * @returns {string}
 */
function createTabId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const suffix = Math.random().toString(36).slice(2, 10);
  return `tab_${Date.now().toString(36)}_${suffix}`;
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function compareTabIds(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export class TabCoordinator {
  /**
   * @param {TabCoordinatorOptions} [options]
   */
  constructor(options = {}) {
    const opts = isPlainObject(options) ? options : {};
    this._channelName = toNonEmptyString(opts.channelName) || DEFAULT_CHANNEL_NAME;
    this._heartbeatMs = toPositiveNumber(opts.heartbeatMs, DEFAULT_HEARTBEAT_MS);
    this._staleMs = this._heartbeatMs * STALE_MULTIPLIER;
    this._onEviction = typeof opts.onEviction === "function" ? opts.onEviction : null;
    this._onAccess = typeof opts.onAccess === "function" ? opts.onAccess : null;
    this._logger = opts.logger || null;

    this._supported = isBroadcastChannelSupported();
    this._channel = null;
    this._initialized = false;
    this._disposed = false;

    this._tabId = createTabId();
    this._tabSeen = new Map();
    this._leaderId = this._tabId;
    this._isLeader = true;
    this._activeTabCount = 1;
    this._heartbeatTimer = null;
    this._handleMessage = this._handleMessage.bind(this);
  }

  /**
   * @returns {Promise<void>}
   */
  async init() {
    if (this._initialized || this._disposed) return;
    this._initialized = true;

    if (!this._supported) return;

    try {
      this._channel = new BroadcastChannel(this._channelName);
    } catch (err) {
      this._supported = false;
      this._channel = null;
      this._logWarn("[TabCoordinator] Failed to init BroadcastChannel:", err);
      return;
    }

    this._channel.addEventListener("message", this._handleMessage);
    this._noteTabSeen(this._tabId);
    this._broadcast("leader-election");
    this._sendHeartbeat();

    this._heartbeatTimer = setInterval(() => {
      if (this._disposed) return;
      this._sendHeartbeat();
      this._refreshPresence();
    }, this._heartbeatMs);
  }

  /**
   * @returns {boolean}
   */
  get isLeader() {
    return this._isLeader;
  }

  /**
   * @returns {number}
   */
  get activeTabCount() {
    return this._activeTabCount;
  }

  /**
   * @param {string} sessionId
   */
  broadcastEviction(sessionId) {
    this._broadcastWithSession("session-evicted", sessionId);
  }

  /**
   * @param {string} sessionId
   */
  broadcastAccess(sessionId) {
    this._broadcastWithSession("session-accessed", sessionId);
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;

    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }

    if (this._channel) {
      this._channel.removeEventListener("message", this._handleMessage);
      try {
        this._channel.close();
      } catch (err) {
        this._logWarn("[TabCoordinator] Failed to close BroadcastChannel:", err);
      }
      this._channel = null;
    }

    this._tabSeen.clear();
    this._leaderId = this._tabId;
    this._isLeader = true;
    this._activeTabCount = 1;
  }

  /**
   * @param {TabCoordinatorMessageType} type
   * @param {string} sessionId
   */
  _broadcastWithSession(type, sessionId) {
    const resolved = toNonEmptyString(sessionId);
    if (!resolved) return;
    this._broadcast(type, resolved);
  }

  /**
   * @param {TabCoordinatorMessageType} type
   * @param {string} [sessionId]
   */
  _broadcast(type, sessionId) {
    if (!this._supported || !this._channel || this._disposed) return;
    if (!MESSAGE_TYPES.has(type)) return;

    /** @type {TabCoordinatorMessage} */
    const message = {
      type,
      tabId: this._tabId,
      ts: Date.now(),
      ...(sessionId ? { sessionId } : {}),
    };

    try {
      this._channel.postMessage(message);
    } catch (err) {
      this._logWarn("[TabCoordinator] Failed to post message:", err);
    }
  }

  _sendHeartbeat() {
    if (this._disposed) return;
    this._noteTabSeen(this._tabId);
    this._broadcast("heartbeat");
  }

  /**
   * @param {MessageEvent} event
   */
  _handleMessage(event) {
    if (this._disposed) return;
    const message = this._parseMessage(event?.data);
    if (!message) return;
    if (message.tabId === this._tabId) return;

    this._noteTabSeen(message.tabId);

    if (message.type === "session-evicted") {
      if (!message.sessionId) return;
      this._safeCall(this._onEviction, message.sessionId, "onEviction");
      return;
    }

    if (message.type === "session-accessed") {
      if (!message.sessionId) return;
      this._safeCall(this._onAccess, message.sessionId, "onAccess");
      return;
    }

    if (message.type === "leader-election") {
      this._refreshPresence();
    }
  }

  /**
   * @param {any} raw
   * @returns {TabCoordinatorMessage | null}
   */
  _parseMessage(raw) {
    let data = raw;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch (err) {
        this._logWarn("[TabCoordinator] Failed to parse message:", err);
        return null;
      }
    }

    if (!isPlainObject(data)) return null;

    const type = toNonEmptyString(data.type);
    const tabId = toNonEmptyString(data.tabId);
    const ts = Number(data.ts);

    if (!type || !MESSAGE_TYPES.has(type)) return null;
    if (!tabId) return null;
    if (!Number.isFinite(ts)) return null;

    const sessionId = toNonEmptyString(data.sessionId);

    return {
      type,
      tabId,
      ts,
      ...(sessionId ? { sessionId } : {}),
    };
  }

  /**
   * @param {string} tabId
   */
  _noteTabSeen(tabId) {
    const resolved = toNonEmptyString(tabId);
    if (!resolved) return;
    this._tabSeen.set(resolved, Date.now());
    this._refreshPresence();
  }

  _refreshPresence() {
    const now = Date.now();
    if (!this._tabSeen.has(this._tabId)) {
      this._tabSeen.set(this._tabId, now);
    }

    for (const [tabId, lastSeen] of this._tabSeen.entries()) {
      if (tabId === this._tabId) continue;
      if (now - lastSeen > this._staleMs) {
        this._tabSeen.delete(tabId);
      }
    }

    this._activeTabCount = Math.max(this._tabSeen.size, 1);
    this._updateLeader();
  }

  _updateLeader() {
    let leaderId = null;
    for (const tabId of this._tabSeen.keys()) {
      if (!leaderId || compareTabIds(tabId, leaderId) < 0) {
        leaderId = tabId;
      }
    }

    if (!leaderId) leaderId = this._tabId;
    this._leaderId = leaderId;
    this._isLeader = leaderId === this._tabId;
  }

  /**
   * @param {Function|null} handler
   * @param {string} sessionId
   * @param {string} label
   */
  _safeCall(handler, sessionId, label) {
    if (typeof handler !== "function") return;
    try {
      handler(sessionId);
    } catch (err) {
      this._logWarn(`[TabCoordinator] ${label} handler failed:`, err);
    }
  }

  /**
   * @param {...any} args
   */
  _logWarn(...args) {
    if (this._logger && typeof this._logger.warn === "function") {
      this._logger.warn(...args);
    }
  }
}
