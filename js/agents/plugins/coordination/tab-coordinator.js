import { isPlainObject, toNonEmptyString, protoSafeReviver} from "../../shared/index.js";

/**
 * Concurrency scope note:
 * - Leader election is best-effort within the same browser profile + origin.
 * - BroadcastChannel does not provide a global total order across tabs.
 * - `_checkLeader()` and `_handleHeartbeat()` may interleave, so transient split-brain
 *   (multiple tabs briefly believing they are leader) can occur under timer skew,
 *   background tab throttling, or delayed message delivery.
 * - Split-brain detection: When a tab receives a heartbeat from another leader with
 *   a smaller tabId, it will step down and trigger re-election.
 * - Consumers should treat leader-triggered side effects as idempotent and eventually
 *   consistent, not as a strict lock/mutex guarantee.
 */

/**
 * @typedef {"session-evicted" | "session-accessed" | "leader-election" | "heartbeat"} TabCoordinatorMessageType
 */

/**
 * @typedef {Object} TabCoordinatorMessage
 * @property {TabCoordinatorMessageType} type
 * @property {string} tabId
 * @property {string} [sessionId]
 * @property {number} ts
 * @property {boolean} [isLeader]
 */

/**
 * @typedef {Object} LoggerLike
 * @property {(...args: unknown[]) => void} [warn]
 */

/**
 * @typedef {Object} TabCoordinatorOptions
 * @property {string} [channelName]
 * @property {number} [heartbeatMs]
 * @property {number} [staleMultiplier]
 * @property {number} [staleGraceMs]
 * @property {"lexicographic" | "last-seen"} [leaderSelection]
 * @property {(sessionId: string) => void} [onEviction]
 * @property {(sessionId: string) => void} [onAccess]
 * @property {LoggerLike} [logger]
 */

const DEFAULT_CHANNEL_NAME = "agent-sessions";
const DEFAULT_HEARTBEAT_MS = 5000;
const STALE_MULTIPLIER = 3;
const DEFAULT_STALE_GRACE_MS = 0;
const MESSAGE_TYPES = new Set(["session-evicted", "session-accessed", "leader-election", "heartbeat"]);

/**
 * @param {unknown} value
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

/**
 * @param {string} strategy
 * @returns {"lexicographic" | "last-seen"}
 */
function normalizeLeaderSelection(strategy) {
  return strategy === "lexicographic" ? "lexicographic" : "last-seen";
}

export class TabCoordinator {
  /** @type {string} */
  _channelName;

  /** @type {number} */
  _heartbeatMs;

  /** @type {number} */
  _staleMs;

  /** @type {number} */
  _staleGraceMs;

  /** @type {"lexicographic" | "last-seen"} */
  _leaderSelection;

  /** @type {((sessionId: string) => void) | null} */
  _onEviction;

  /** @type {((sessionId: string) => void) | null} */
  _onAccess;

  /** @type {LoggerLike | null} */
  _logger;

  /** @type {boolean} */
  _supported;

  /** @type {BroadcastChannel | null} */
  _channel;

  /** @type {boolean} */
  _initialized;

  /** @type {boolean} */
  _disposed;

  /** @type {string} */
  _tabId;

  /** @type {Map<string, number>} */
  _tabSeen;

  /** @type {string} */
  _leaderId;

  /** @type {boolean} */
  _isLeader;

  /** @type {number} */
  _activeTabCount;

  /** @type {number} */
  _splitBrainCount;

  /** @type {ReturnType<typeof setInterval> | null} */
  _heartbeatTimer;

  /**
   * @param {TabCoordinatorOptions} [options]
   */
  constructor(options = {}) {
    const opts = isPlainObject(options) ? options : {};
    this._channelName = toNonEmptyString(opts.channelName) || DEFAULT_CHANNEL_NAME;
    this._heartbeatMs = toPositiveNumber(opts.heartbeatMs, DEFAULT_HEARTBEAT_MS);
    const staleMultiplier = toPositiveNumber(opts.staleMultiplier, STALE_MULTIPLIER);
    this._staleMs = this._heartbeatMs * staleMultiplier;
    this._staleGraceMs = toPositiveNumber(opts.staleGraceMs, DEFAULT_STALE_GRACE_MS);
    this._leaderSelection = normalizeLeaderSelection(toNonEmptyString(opts.leaderSelection)?.toLowerCase());
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
    this._splitBrainCount = 0;
    this._heartbeatTimer = null;
    this._handleMessage = this._handleMessage.bind(this);
  }

  /**
   * @returns {Promise<void>}
   */
  async init() {
    if (this._initialized || this._disposed || this._channel) return;
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
    this._splitBrainCount = 0;
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

    if (!this._supported || !this._channel) return;

    /** @type {TabCoordinatorMessage} */
    const message = {
      type: "heartbeat",
      tabId: this._tabId,
      ts: Date.now(),
      isLeader: this._isLeader,
    };

    try {
      this._channel.postMessage(message);
    } catch (err) {
      this._logWarn("[TabCoordinator] Failed to post heartbeat:", err);
    }
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

    if (message.type === "heartbeat") {
      if (message.isLeader && !this._tabSeen.has(message.tabId)) {
        this._leaderId = message.tabId;
      }
      if (message.isLeader && this._isLeader) {
        const remoteIsPreferred = this._isCandidatePreferred(
          message.tabId,
          message.ts,
          this._tabId,
          this._tabSeen.get(this._tabId) || 0
        );
        if (remoteIsPreferred) {
          this._splitBrainCount += 1;
          this._logWarn("[TabCoordinator] Split-brain detected, stepping down");
          this._isLeader = false;
          this._triggerReelection();
        }
      }
      return;
    }

    if (message.type === "leader-election") {
      this._refreshPresence();
    }
  }

  /**
   * @param {unknown} raw
   * @returns {TabCoordinatorMessage | null}
   */
  _parseMessage(raw) {
    let data = raw;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data, protoSafeReviver);
      } catch (err) {
        this._logWarn("[TabCoordinator] Failed to parse message:", err);
        return null;
      }
    }

    if (!isPlainObject(data)) return null;

    const obj = /** @type {Record<string, unknown>} */ (data);

    const type = toNonEmptyString(obj.type);
    const tabId = toNonEmptyString(obj.tabId);
    const ts = Number(obj.ts);

    if (!type || !MESSAGE_TYPES.has(type)) return null;
    if (!tabId) return null;
    if (!Number.isFinite(ts)) return null;

    const sessionId = toNonEmptyString(obj.sessionId);
    const isLeader = typeof obj.isLeader === "boolean" ? obj.isLeader : undefined;

    return {
      type: /** @type {TabCoordinatorMessageType} */ (type),
      tabId,
      ts,
      ...(isLeader === undefined ? {} : { isLeader }),
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
      if (now - lastSeen > (this._staleMs + this._staleGraceMs)) {
        this._tabSeen.delete(tabId);
      }
    }

    this._activeTabCount = Math.max(this._tabSeen.size, 1);
    this._updateLeader();
  }

  _updateLeader() {
    let leaderId = null;
    let leaderSeen = -Infinity;
    for (const tabId of this._tabSeen.keys()) {
      const seen = this._tabSeen.get(tabId) || 0;
      if (!leaderId || this._isCandidatePreferred(tabId, seen, leaderId, leaderSeen)) {
        leaderId = tabId;
        leaderSeen = seen;
      }
    }

    if (!leaderId) leaderId = this._tabId;
    this._leaderId = leaderId;
    this._isLeader = leaderId === this._tabId;
  }

  /**
   * @param {string} candidateId
   * @param {number} candidateSeen
   * @param {string} incumbentId
   * @param {number} incumbentSeen
   * @returns {boolean}
   */
  _isCandidatePreferred(candidateId, candidateSeen, incumbentId, incumbentSeen) {
    if (this._leaderSelection === "last-seen") {
      if (candidateSeen !== incumbentSeen) return candidateSeen > incumbentSeen;
    }
    return compareTabIds(candidateId, incumbentId) < 0;
  }

  _triggerReelection() {
    this._broadcast("leader-election");
    this._refreshPresence();
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
   * @param {...unknown} args
   */
  _logWarn(...args) {
    if (this._logger && typeof this._logger.warn === "function") {
      this._logger.warn(...args);
    }
  }
}
