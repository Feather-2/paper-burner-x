/**
 * Per-session concurrency gate.
 *
 * Provides Promise-chain-based mutual exclusion keyed by session ID.
 * Two modes:
 * - `'queue'` (default): concurrent callers wait in FIFO order
 * - `'reject'`: concurrent callers receive ErrConcurrentExecution
 *
 * Cross-platform: works in both Browser and Node.js.
 *
 * @module runtime/session-gate
 */

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

/**
 * Thrown when a session is already locked and mode is 'reject'.
 * @extends {Error}
 */
export class ErrConcurrentExecution extends Error {
  /** @param {string} sessionId */
  constructor(sessionId) {
    super(`Concurrent execution rejected for session: ${sessionId}`);
    this.name = 'ErrConcurrentExecution';
    this.code = 'ERR_CONCURRENT_EXECUTION';
    /** @type {string} */
    this.sessionId = sessionId;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** @typedef {'reject' | 'queue'} SessionGateMode */

/**
 * @typedef {object} SessionGateOptions
 * @property {SessionGateMode} [mode='queue']
 * @property {number} [timeout=0]  Default timeout in ms (0 = no timeout)
 */

/**
 * @typedef {object} AcquireOptions
 * @property {AbortSignal} [signal]
 * @property {number} [timeout]  Override default timeout (ms)
 */

// ---------------------------------------------------------------------------
// SessionGate
// ---------------------------------------------------------------------------

/**
 * @typedef {object} GateEntry
 * @property {Promise<void>} chain
 * @property {number} count  Number of holders + waiters
 */

export class SessionGate {
  /**
   * @param {SessionGateOptions} [options]
   */
  constructor(options = {}) {
    /** @type {SessionGateMode} */
    this._mode = options.mode || 'queue';
    /** @type {number} */
    this._defaultTimeout = options.timeout || 0;
    /** @type {Map<string, GateEntry>} */
    this._gates = new Map();
    /** @type {boolean} */
    this._disposed = false;
  }

  /**
   * Acquire exclusive access to a session.
   *
   * @param {string} sessionId
   * @param {AcquireOptions} [options]
   * @returns {Promise<() => void>}  Release function
   */
  async acquire(sessionId, options = {}) {
    if (this._disposed) throw new Error('SessionGate disposed');
    if (!sessionId) throw new Error('sessionId is required');

    const entry = this._gates.get(sessionId);

    // reject mode: if already locked, throw immediately
    if (this._mode === 'reject' && entry && entry.count > 0) {
      throw new ErrConcurrentExecution(sessionId);
    }

    // Build the waiter promise
    /** @type {() => void} */
    let releaseResolve;
    const releasePromise = new Promise((resolve) => { releaseResolve = /** @type {() => void} */ (resolve); });

    // The previous chain we must wait on
    const prevChain = entry ? entry.chain : Promise.resolve();

    // Update or create the gate entry — point chain to our release
    if (entry) {
      entry.chain = entry.chain.then(() => releasePromise);
      entry.count += 1;
    } else {
      this._gates.set(sessionId, { chain: releasePromise, count: 1 });
    }

    // Build release function (idempotent)
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const g = this._gates.get(sessionId);
      if (g) {
        g.count -= 1;
        if (g.count <= 0) this._gates.delete(sessionId);
      }
      releaseResolve();
    };

    // Wait for previous holder(s) to release
    const timeoutMs = options.timeout ?? this._defaultTimeout;
    const signal = options.signal;

    // Fast path: no previous holder
    if (!entry || entry.count <= 1) {
      // Check signal before returning
      if (signal?.aborted) {
        release();
        throw signal.reason || new DOMException('Aborted', 'AbortError');
      }
      return release;
    }

    // Slow path: wait for previous chain
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer;

      const settle = (fn) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (abortHandler && signal) {
          signal.removeEventListener('abort', abortHandler);
        }
        fn();
      };

      // Abort handler
      let abortHandler;
      if (signal) {
        if (signal.aborted) {
          release();
          reject(signal.reason || new DOMException('Aborted', 'AbortError'));
          return;
        }
        abortHandler = () => {
          settle(() => {
            release();
            reject(signal.reason || new DOMException('Aborted', 'AbortError'));
          });
        };
        signal.addEventListener('abort', abortHandler, { once: true });
      }

      // Timeout handler
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          settle(() => {
            release();
            reject(new Error(`SessionGate timeout after ${timeoutMs}ms for session: ${sessionId}`));
          });
        }, timeoutMs);
      }

      // Wait for previous chain
      prevChain.then(() => {
        settle(() => resolve(release));
      });
    });
  }

  /**
   * Convenience: acquire → run fn → auto-release.
   *
   * @template T
   * @param {string} sessionId
   * @param {() => T | Promise<T>} fn
   * @param {AcquireOptions} [options]
   * @returns {Promise<T>}
   */
  async withSession(sessionId, fn, options) {
    const release = await this.acquire(sessionId, options);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /**
   * Check if a session is currently locked.
   * @param {string} sessionId
   * @returns {boolean}
   */
  isLocked(sessionId) {
    const entry = this._gates.get(sessionId);
    return !!(entry && entry.count > 0);
  }

  /** @returns {number} Number of sessions with active locks */
  get activeCount() {
    return this._gates.size;
  }

  /** Release all waiters and prevent further acquisition. */
  dispose() {
    this._disposed = true;
    this._gates.clear();
  }
}
