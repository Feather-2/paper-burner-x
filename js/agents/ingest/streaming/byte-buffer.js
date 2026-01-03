function toUint8Array(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (Array.isArray(input)) return new Uint8Array(input);
  throw new TypeError("ByteBuffer: expected Uint8Array/ArrayBuffer/ArrayBufferView/number[]");
}

function toFiniteInt(value, fallback) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function normalizeSliceIndex(value, len, fallback) {
  const n = toFiniteInt(value, fallback);
  if (n < 0) return clamp(len + n, 0, len);
  return clamp(n, 0, len);
}

/**
 * A small Uint8Array-oriented buffer for incremental parsing.
 * - append(): grows the buffer with minimal copies (compacts when possible)
 * - slice(): copies a range as Uint8Array
 * - indexOf(): byte-level substring search (no string conversion)
 */
export class ByteBuffer {
  constructor(initial = undefined) {
    this._buf = new Uint8Array(0);
    this._start = 0;
    this._end = 0;
    if (initial !== undefined) this.append(initial);
  }

  get length() {
    return this._end - this._start;
  }

  /**
   * @param {Uint8Array|ArrayBuffer|ArrayBufferView|number[]} data
   * @returns {ByteBuffer}
   */
  append(data) {
    const chunk = toUint8Array(data);
    if (chunk.length === 0) return this;

    const curLen = this.length;
    const required = curLen + chunk.length;

    if (this._buf.length === 0) {
      const cap = Math.max(256, required);
      this._buf = new Uint8Array(cap);
      this._start = 0;
      this._end = 0;
    }

    // Ensure contiguous free space at the end; compact if possible.
    if (this._end + chunk.length > this._buf.length) {
      if (this._start > 0 && required <= this._buf.length) {
        this._buf.copyWithin(0, this._start, this._end);
        this._start = 0;
        this._end = curLen;
      } else {
        const nextCap = Math.max(this._buf.length * 2, required, 256);
        const next = new Uint8Array(nextCap);
        next.set(this._buf.subarray(this._start, this._end), 0);
        this._buf = next;
        this._start = 0;
        this._end = curLen;
      }
    }

    this._buf.set(chunk, this._end);
    this._end += chunk.length;
    return this;
  }

  /**
   * @param {number=} start 0-based, inclusive (supports negative indices)
   * @param {number=} end 0-based, exclusive (supports negative indices)
   * @returns {Uint8Array}
   */
  slice(start = 0, end = this.length) {
    const len = this.length;
    const s = normalizeSliceIndex(start, len, 0);
    const e = normalizeSliceIndex(end, len, len);
    if (e <= s || len === 0) return new Uint8Array(0);
    return this._buf.slice(this._start + s, this._start + e);
  }

  /**
   * @param {Uint8Array|ArrayBuffer|ArrayBufferView|number[]} needle
   * @param {number=} fromIndex
   * @returns {number} 0-based index or -1
   */
  indexOf(needle, fromIndex = 0) {
    const n = toUint8Array(needle);
    const nLen = n.length;
    if (nLen === 0) return 0;

    const len = this.length;
    if (len === 0 || nLen > len) return -1;

    let from = toFiniteInt(fromIndex, 0);
    if (from < 0) from = Math.max(0, len + from);
    if (from >= len) return -1;

    const hay = this._buf;
    const start = this._start + from;
    const end = this._end - nLen;

    const first = n[0];
    for (let i = start; i <= end; i++) {
      if (hay[i] !== first) continue;
      let matched = true;
      for (let j = 1; j < nLen; j++) {
        if (hay[i + j] !== n[j]) {
          matched = false;
          break;
        }
      }
      if (matched) return i - this._start;
    }
    return -1;
  }

  /**
   * Drop `count` bytes from the front of the buffer.
   * @param {number} count
   * @returns {ByteBuffer}
   */
  consume(count) {
    const n = Math.max(0, toFiniteInt(count, 0));
    const take = Math.min(n, this.length);
    this._start += take;
    if (this._start >= this._end) {
      this._start = 0;
      this._end = 0;
    }
    return this;
  }
}

