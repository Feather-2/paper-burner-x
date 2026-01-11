/**
 * SharedArrayBuffer Memory Bridge
 *
 * 针对海量科研数据的跨线程传输方案，支持：
 * - SAB 模式: 真正零拷贝（需要 crossOriginIsolated）
 * - MessagePort 模式: 256KB 分块传输回退
 *
 * 典型使用场景：
 * 1. SAB 模式: allocate() → 直接操作 → Worker 零拷贝访问
 * 2. 回退模式: pack() → MessagePort 传输 → unpack()
 */

/**
 * @typedef {Int8Array|Uint8Array|Uint8ClampedArray|Int16Array|Uint16Array|Int32Array|Uint32Array|Float32Array|Float64Array|BigInt64Array|BigUint64Array} TypedArray
 */

/**
 * @typedef {{ kind: 'messageport', id: string, byteLength: number }} MessagePortPacket
 */

/**
 * @typedef {{ kind: 'sab', buffer: SharedArrayBuffer }} SabPacket
 */

/**
 * @typedef {{ kind: 'unknown' }} UnknownPacket
 */

/**
 * @typedef {MessagePortPacket | SabPacket | UnknownPacket} SharedMemoryPacket
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_CHUNK_BYTES = 256 * 1024; // 256KB
const DEFAULT_MAX_TRANSFER_BYTES = 64 * 1024 * 1024; // 64MB

// ─────────────────────────────────────────────────────────────────────────────
// Support Detection
// ─────────────────────────────────────────────────────────────────────────────

function isCrossOriginIsolatedInternal() {
  try {
    return globalThis.crossOriginIsolated === true;
  } catch {
    return false;
  }
}

function getCrossOriginIsolatedStatus() {
  try {
    const value = globalThis.crossOriginIsolated;
    return { known: value !== undefined, value: value === true };
  } catch {
    return { known: false, value: false };
  }
}

function isSharedArrayBufferAvailable() {
  try {
    return typeof SharedArrayBuffer !== "undefined" && new SharedArrayBuffer(1).byteLength === 1;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ID Generation
// ─────────────────────────────────────────────────────────────────────────────

function makeTransferId() {
  try {
    const arr = new Uint8Array(8);
    crypto.getRandomValues(arr);
    return "sm_" + Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    // Fallback when crypto unavailable
    return "sm_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MessagePortFallback
// ─────────────────────────────────────────────────────────────────────────────

export class MessagePortFallback {
  /**
   * @param {MessagePort} port
   * @param {object} [options]
   * @param {number} [options.chunkBytes=256*1024]
   * @param {number} [options.maxByteLength=64*1024*1024]
   */
  constructor(port, options = {}) {
    if (!port) {
      throw new Error("port must be a MessagePort");
    }
    this._port = port;
    this._chunkBytes = options.chunkBytes ?? DEFAULT_CHUNK_BYTES;
    this._maxByteLength = options.maxByteLength ?? DEFAULT_MAX_TRANSFER_BYTES;
    this._transfers = new Map(); // id → { byteLength, buffer?, received, resolve?, reject?, error?, result? }
    this._boundOnMessage = this._handleMessage.bind(this);

    // Prefer addEventListener if available
    if (typeof port.addEventListener === "function") {
      port.addEventListener("message", this._boundOnMessage);
    } else {
      port.onmessage = this._boundOnMessage;
    }

    if (typeof port.start === "function") {
      port.start();
    }
  }

  /**
   * Get chunk size
   */
  get chunkBytes() {
    return this._chunkBytes;
  }

  /**
   * Handle incoming messages
   * @private
   */
  _handleMessage(event) {
    const msg = event?.data;
    if (!msg || typeof msg !== "object") return;

    const { type, id } = msg;

    if (type === "shared-memory:port-fallback:start") {
      this._handleStart(id, msg.byteLength, msg.chunkBytes);
    } else if (type === "shared-memory:port-fallback:chunk") {
      this._handleChunk(id, msg.offset, msg.chunk);
    }
  }

  /**
   * Handle start message
   * @private
   */
  _handleStart(id, byteLength, chunkBytes) {
    const declared = Number.isFinite(byteLength) ? Math.floor(byteLength) : 0;
    if (declared < 0) {
      this._fail(id, new Error("byteLength must be non-negative"));
      return;
    }
    const limit = Number.isFinite(this._maxByteLength) ? Math.max(0, Math.floor(this._maxByteLength)) : Infinity;
    if (declared > limit) {
      this._fail(id, new Error(`byteLength exceeds limit (${declared} > ${limit})`));
      return;
    }

    const existing = this._transfers.get(id);

    if (existing) {
      // Validate byteLength matches
      if (existing.byteLength !== declared) {
        this._fail(id, new Error(`byteLength mismatch: expected ${existing.byteLength}, got ${declared}`));
        return;
      }
    }

    const buffer = new ArrayBuffer(declared);
    const entry = existing || {};
    entry.byteLength = declared;
    entry.buffer = buffer;
    entry.received = 0;
    entry.chunkBytes = chunkBytes;
    this._transfers.set(id, entry);

    // Check if already complete (0-byte transfer)
    if (declared === 0) {
      entry.result = buffer;
      if (entry.resolve) {
        entry.resolve(buffer);
      }
    }
  }

  /**
   * Handle chunk message
   * @private
   */
  _handleChunk(id, offset, chunk) {
    const entry = this._transfers.get(id);
    if (!entry) return;

    if (!(chunk instanceof ArrayBuffer)) {
      this._fail(id, new Error("chunk must be an ArrayBuffer"));
      return;
    }

    // Check for overflow
    if (offset + chunk.byteLength > entry.byteLength) {
      this._fail(id, new Error("chunk overflow"));
      return;
    }

    // Copy chunk to buffer
    const view = new Uint8Array(entry.buffer);
    view.set(new Uint8Array(chunk), offset);
    entry.received += chunk.byteLength;

    // Check if complete
    if (entry.received >= entry.byteLength) {
      entry.result = entry.buffer;
      if (entry.resolve) {
        entry.resolve(entry.buffer);
      }
    }
  }

  /**
   * Fail a transfer
   * @private
   */
  _fail(id, error) {
    const entry = this._transfers.get(id);
    if (!entry) return;

    entry.error = error;
    if (entry.reject) {
      entry.reject(error);
    }
  }

  /**
   * Pack data for transfer
   * @param {TypedArray|ArrayBuffer|SharedArrayBuffer} data
   * @returns {{ kind: 'messageport', id: string, byteLength: number }}
   */
  pack(data) {
    const bytes = toUint8View(data);
    const id = makeTransferId();
    const byteLength = bytes.length;

    // Send start message
    this._port.postMessage({
      type: "shared-memory:port-fallback:start",
      id,
      byteLength,
      chunkBytes: this._chunkBytes,
    });

    // Send chunks
    let offset = 0;
    while (offset < byteLength) {
      const end = Math.min(offset + this._chunkBytes, byteLength);
      const chunk = bytes.slice(offset, end).buffer;
      this._port.postMessage(
        {
          type: "shared-memory:port-fallback:chunk",
          id,
          offset,
          chunk,
        },
        [chunk]
      );
      offset = end;
    }

    return { kind: "messageport", id, byteLength };
  }

  /**
   * Unpack received data
   * @param {{ kind: 'messageport', id: string, byteLength: number }} packet
   * @returns {Promise<ArrayBuffer>}
   */
  unpack(packet) {
    if (!packet?.id) {
      return Promise.reject(new Error("packet.id is required"));
    }

    const id = packet.id;
    const byteLength = packet.byteLength;
    const declared = Number.isFinite(byteLength) ? Math.floor(byteLength) : 0;
    const limit = Number.isFinite(this._maxByteLength) ? Math.max(0, Math.floor(this._maxByteLength)) : Infinity;
    if (declared < 0) {
      return Promise.reject(new Error("byteLength must be non-negative"));
    }
    if (declared > limit) {
      return Promise.reject(new Error(`byteLength exceeds limit (${declared} > ${limit})`));
    }

    return new Promise((resolve, reject) => {
      const existing = this._transfers.get(id);

      if (existing?.error) {
        this._transfers.delete(id);
        reject(existing.error);
        return;
      }

      if (existing?.result) {
        this._transfers.delete(id);
        resolve(existing.result);
        return;
      }

      const entry = existing || { byteLength: declared, received: 0 };
      entry.byteLength = declared;
      entry.resolve = (buffer) => {
        this._transfers.delete(id);
        resolve(buffer);
      };
      entry.reject = (error) => {
        this._transfers.delete(id);
        reject(error);
      };
      this._transfers.set(id, entry);
    });
  }

  /**
   * Close the port
   */
  close() {
    try {
      if (typeof this._port.removeEventListener === "function") {
        this._port.removeEventListener("message", this._boundOnMessage);
      } else if (this._port.onmessage === this._boundOnMessage) {
        this._port.onmessage = null;
      }
    } catch {
      // Swallow removeEventListener errors
    }
    this._transfers.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert data to Uint8Array view
 * @param {TypedArray|ArrayBuffer|SharedArrayBuffer} data
 * @returns {Uint8Array}
 */
function toUint8View(data) {
  if (data instanceof Uint8Array) {
    return data;
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (data instanceof ArrayBuffer || data instanceof SharedArrayBuffer) {
    return new Uint8Array(data);
  }
  throw new TypeError("data must be TypedArray, ArrayBuffer, or SharedArrayBuffer");
}

// ─────────────────────────────────────────────────────────────────────────────
// SharedMemoryBridge
// ─────────────────────────────────────────────────────────────────────────────

export class SharedMemoryBridge {
  /**
   * Get detailed support information
   */
  static getSupport() {
    const sabAvailable = isSharedArrayBufferAvailable();
    const coiStatus = getCrossOriginIsolatedStatus();

    // SAB is only "enabled" when both SAB is available AND COI is true (or unknown)
    const sabEnabled = sabAvailable && (coiStatus.value || !coiStatus.known);

    return {
      sharedArrayBuffer: sabAvailable,
      crossOriginIsolatedKnown: coiStatus.known,
      crossOriginIsolated: coiStatus.value,
      sharedArrayBufferEnabled: sabEnabled,
      mode: sabEnabled ? "sab" : "messageport",
    };
  }

  /**
   * Check if crossOriginIsolated
   */
  static isCrossOriginIsolated() {
    return isCrossOriginIsolatedInternal();
  }

  /**
   * Check if SharedArrayBuffer is supported
   */
  static isSupported() {
    return isSharedArrayBufferAvailable();
  }

  /**
   * Allocate SharedArrayBuffer
   * @param {number} byteLength
   * @returns {SharedArrayBuffer}
   */
  static allocate(byteLength) {
    if (!isSharedArrayBufferAvailable()) {
      throw new Error("SharedArrayBuffer is not available");
    }
    const size = Number.isFinite(byteLength) && byteLength > 0 ? Math.floor(byteLength) : 0;
    if (size <= 0) throw new Error("SharedMemoryBridge.allocate: byteLength must be positive");
    return new SharedArrayBuffer(size);
  }

  /**
   * Copy data to SharedArrayBuffer
   * @param {TypedArray|ArrayBuffer|SharedArrayBuffer} data
   * @returns {SharedArrayBuffer}
   */
  static copyToShared(data) {
    // Check if already SAB (safely, since SAB may be undefined)
    if (isSharedArrayBufferAvailable() && data instanceof SharedArrayBuffer) return data;

    // Check if SAB is enabled
    const support = SharedMemoryBridge.getSupport();
    if (!support.sharedArrayBufferEnabled) {
      throw new Error("SharedArrayBuffer is not enabled (crossOriginIsolated required)");
    }

    const byteLength = data?.byteLength ?? 0;
    if (byteLength <= 0) return new SharedArrayBuffer(0);

    const buffer = new SharedArrayBuffer(byteLength);
    const view = new Uint8Array(buffer);

    if (data instanceof Uint8Array) {
      view.set(data);
    } else if (ArrayBuffer.isView(data)) {
      view.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    } else if (data instanceof ArrayBuffer) {
      view.set(new Uint8Array(data));
    } else {
      throw new TypeError("SharedMemoryBridge.copyToShared: data must be TypedArray, ArrayBuffer, or SharedArrayBuffer");
    }

    return buffer;
  }

  /**
   * @deprecated Use copyToShared()
   */
  static wrap(data) {
    return SharedMemoryBridge.copyToShared(data);
  }

  /**
   * Create typed view
   * @param {SharedArrayBuffer|ArrayBuffer} buffer
   * @param {string} dtype
   * @returns {TypedArray}
   */
  static createView(buffer, dtype = "u1") {
    if (!(buffer instanceof SharedArrayBuffer) && !(buffer instanceof ArrayBuffer)) {
      throw new TypeError("SharedMemoryBridge.createView: buffer must be SharedArrayBuffer or ArrayBuffer");
    }

    switch (dtype) {
      case "u1":
      case "uint8":
        return new Uint8Array(buffer);
      case "i1":
      case "int8":
        return new Int8Array(buffer);
      case "u2":
      case "uint16":
        return new Uint16Array(buffer);
      case "i2":
      case "int16":
        return new Int16Array(buffer);
      case "u4":
      case "uint32":
        return new Uint32Array(buffer);
      case "i4":
      case "int32":
        return new Int32Array(buffer);
      case "f4":
      case "float32":
        return new Float32Array(buffer);
      case "f8":
      case "float64":
        return new Float64Array(buffer);
      default:
        return new Uint8Array(buffer);
    }
  }

  /**
   * Convert to Python numpy array
   * @param {object} pyodide
   * @param {SharedArrayBuffer|ArrayBuffer} buffer
   * @param {string} dtype
   * @returns {Promise<any>}
   */
  static async toPython(pyodide, buffer, dtype = "uint8") {
    if (!(buffer instanceof SharedArrayBuffer) && !(buffer instanceof ArrayBuffer)) {
      throw new TypeError("SharedMemoryBridge.toPython: buffer must be SharedArrayBuffer or ArrayBuffer");
    }

    const jsView = new Uint8Array(buffer);
    const pyMemory = pyodide.toPy(jsView);

    return pyodide.runPython(`
def _wrap_shared_buffer(buffer_view, dtype_str):
    import numpy as np
    return np.frombuffer(buffer_view, dtype=dtype_str)
_wrap_shared_buffer
    `)(pyMemory, dtype);
  }

  /**
   * Estimate overhead
   * @param {any} data
   * @returns {{ byteLength: number, needsCopy: boolean, supported: boolean, description: string }}
   */
  static estimateOverhead(data) {
    const supported = SharedMemoryBridge.isSupported();
    const byteLength = data?.byteLength ?? 0;
    const needsCopy = !(data instanceof SharedArrayBuffer);

    return {
      byteLength,
      needsCopy,
      supported,
      description: needsCopy
        ? `Will copy ${byteLength} bytes to SharedArrayBuffer (one-time overhead)`
        : "Already SharedArrayBuffer, zero-copy access",
    };
  }

  /**
   * Pack data for transfer
   * @param {TypedArray|ArrayBuffer|SharedArrayBuffer} data
   * @param {object} [options]
   * @param {'auto'|'sab'|'messageport'} [options.mode='auto']
   * @param {MessagePort} [options.port]
   * @returns {SharedMemoryPacket}
   */
  static pack(data, options = {}) {
    const { mode = "auto", port } = options;
    const support = SharedMemoryBridge.getSupport();

    // Determine actual mode
    let actualMode = mode;
    if (mode === "auto") {
      actualMode = support.sharedArrayBufferEnabled ? "sab" : "messageport";
    }

    if (actualMode === "sab") {
      if (!support.sharedArrayBufferEnabled) {
        throw new Error("SharedArrayBuffer is not enabled (crossOriginIsolated required)");
      }
      const sab = SharedMemoryBridge.copyToShared(data);
      return { kind: "sab", buffer: sab };
    }

    if (actualMode === "messageport") {
      if (!port) {
        throw new Error("MessagePort required for mode='messageport'");
      }
      const fallback = new MessagePortFallback(port);
      return fallback.pack(data);
    }

    throw new Error(`unsupported mode: ${mode}`);
  }

  /**
   * Unpack received data
   * @param {SharedMemoryPacket} packet
   * @param {object} [options]
   * @param {MessagePort} [options.port]
   * @returns {Promise<ArrayBuffer|SharedArrayBuffer>}
   */
  static async unpack(packet, options = {}) {
    const { port } = options;

    if (!packet || typeof packet !== "object") {
      throw new TypeError("unpack() requires a packet object");
    }

    if (packet.kind === "sab") {
      if (!(packet.buffer instanceof SharedArrayBuffer)) {
        throw new Error("invalid SAB packet.buffer");
      }
      return packet.buffer;
    }

    if (packet.kind === "messageport") {
      if (!port) {
        throw new Error("MessagePort required for kind='messageport'");
      }
      const fallback = new MessagePortFallback(port);
      return fallback.unpack(packet);
    }

    throw new Error(`unsupported packet kind: ${packet.kind}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pack/Unpack Convenience Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pack data for transfer (convenience function)
 * @param {TypedArray|ArrayBuffer|SharedArrayBuffer} data
 * @param {object} [options]
 * @returns {SharedMemoryPacket}
 */
export function pack(data, options = {}) {
  return SharedMemoryBridge.pack(data, options);
}

/**
 * Unpack received data (convenience function)
 * @param {SharedMemoryPacket} packet
 * @param {object} [options]
 * @returns {Promise<ArrayBuffer|SharedArrayBuffer>}
 */
export function unpack(packet, options = {}) {
  return SharedMemoryBridge.unpack(packet, options);
}

export default SharedMemoryBridge;
