/**
 * SharedArrayBuffer Memory Bridge
 *
 * 针对海量科研数据 (矩阵/表格) 的跨线程传输方案。
 *
 * **重要说明**：
 * - `copyToShared()` 将数据**拷贝**到 SharedArrayBuffer（一次性开销）
 * - 后续 Worker 访问是真正的零拷贝（直接操作同一块内存）
 * - 如需全程零拷贝，应在一开始就使用 `allocate()` 分配 SharedArrayBuffer
 *
 * 典型使用场景：
 * 1. 一次拷贝模式: `copyToShared(existingData)` → Worker 零拷贝访问
 * 2. 全程零拷贝: `allocate(size)` → 主线程写入 → Worker 零拷贝访问
 */

export class SharedMemoryBridge {
  /**
   * 分配指定大小的 SharedArrayBuffer（真正零拷贝的起点）
   * @param {number} byteLength 字节大小
   * @returns {SharedArrayBuffer}
   */
  static allocate(byteLength) {
    const size = Number.isFinite(byteLength) && byteLength > 0 ? Math.floor(byteLength) : 0;
    if (size <= 0) throw new Error("SharedMemoryBridge.allocate: byteLength must be positive");
    return new SharedArrayBuffer(size);
  }

  /**
   * 检测当前环境是否支持 SharedArrayBuffer
   * @returns {boolean}
   */
  static isSupported() {
    try {
      return typeof SharedArrayBuffer !== "undefined" && new SharedArrayBuffer(1).byteLength === 1;
    } catch {
      return false;
    }
  }

  /**
   * 将数据**拷贝**到 SharedArrayBuffer
   *
   * 注意：这不是零拷贝，会发生一次内存拷贝。
   * 如果数据已经是 SharedArrayBuffer，则直接返回（无拷贝）。
   *
   * @param {TypedArray|ArrayBuffer|SharedArrayBuffer} data
   * @returns {SharedArrayBuffer}
   */
  static copyToShared(data) {
    if (data instanceof SharedArrayBuffer) return data;

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
   * @deprecated 使用 copyToShared() 代替，命名更准确
   */
  static wrap(data) {
    return SharedMemoryBridge.copyToShared(data);
  }

  /**
   * 创建指定类型的视图
   * @param {SharedArrayBuffer} sharedBuffer
   * @param {string} dtype - 'u1', 'i4', 'f4', 'f8' 等
   * @returns {TypedArray}
   */
  static createView(sharedBuffer, dtype = "u1") {
    if (!(sharedBuffer instanceof SharedArrayBuffer)) {
      throw new TypeError("SharedMemoryBridge.createView: sharedBuffer must be SharedArrayBuffer");
    }

    switch (dtype) {
      case "u1":
      case "uint8":
        return new Uint8Array(sharedBuffer);
      case "i1":
      case "int8":
        return new Int8Array(sharedBuffer);
      case "u2":
      case "uint16":
        return new Uint16Array(sharedBuffer);
      case "i2":
      case "int16":
        return new Int16Array(sharedBuffer);
      case "u4":
      case "uint32":
        return new Uint32Array(sharedBuffer);
      case "i4":
      case "int32":
        return new Int32Array(sharedBuffer);
      case "f4":
      case "float32":
        return new Float32Array(sharedBuffer);
      case "f8":
      case "float64":
        return new Float64Array(sharedBuffer);
      default:
        return new Uint8Array(sharedBuffer);
    }
  }

  /**
   * 在 Python Worker 中，将 SharedArrayBuffer 转为 numpy array
   * @param {PyodideInterface} pyodide
   * @param {SharedArrayBuffer} sharedBuffer
   * @param {string} dtype - numpy dtype ('uint8', 'float32', etc.)
   * @returns {Promise<PyProxy>}
   */
  static async toPython(pyodide, sharedBuffer, dtype = "uint8") {
    if (!(sharedBuffer instanceof SharedArrayBuffer)) {
      throw new TypeError("SharedMemoryBridge.toPython: sharedBuffer must be SharedArrayBuffer");
    }

    const jsView = new Uint8Array(sharedBuffer);
    const pyMemory = pyodide.toPy(jsView);

    return pyodide.runPython(`
def _wrap_shared_buffer(buffer_view, dtype_str):
    import numpy as np
    return np.frombuffer(buffer_view, dtype=dtype_str)
_wrap_shared_buffer
    `)(pyMemory, dtype);
  }

  /**
   * 计算实际传输开销（用于监控）
   * @param {any} data
   * @returns {{ byteLength: number, needsCopy: boolean, supported: boolean }}
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
        : `Already SharedArrayBuffer, zero-copy access`,
    };
  }
}

export default SharedMemoryBridge;
