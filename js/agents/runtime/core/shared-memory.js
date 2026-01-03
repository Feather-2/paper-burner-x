/**
 * SharedArrayBuffer Zero-Copy Bridge
 * 
 * 针对海量科研数据 (矩阵/表格) 的零拷贝传输方案。
 * 原理：
 * 1. 在主线程分配 SharedArrayBuffer (SAB)。
 * 2. 将数据写入 SAB。
 * 3. 将 SAB 句柄传给 Worker。
 * 4. Worker 直接通过 TypedArray 操作同一块内存，Python 通过 Buffer Protocol 读取。
 */

export class SharedMemoryBridge {
  /**
   * 将 JS 的 TypedArray 或 ArrayBuffer 包装为可共享的 SharedArrayBuffer
   * @param {TypedArray|ArrayBuffer} data 
   */
  static wrap(data) {
    if (data instanceof SharedArrayBuffer) return data;
    
    const buffer = new SharedArrayBuffer(data.byteLength);
    const view = new Uint8Array(buffer);
    
    if (data instanceof Uint8Array) {
      view.set(data);
    } else if (data.buffer instanceof ArrayBuffer) {
      view.set(new Uint8Array(data.buffer));
    } else {
      view.set(new Uint8Array(data));
    }
    
    return buffer;
  }

  /**
   * 在 Python Worker 中，将 SharedArrayBuffer 转为 Python 对象
   * (由 Worker 逻辑调用)
   */
  static async toPython(pyodide, sharedBuffer, dtype = 'u1') {
    // pyodide.toPy 支持直接包装 JS 缓存
    const jsView = new Uint8Array(sharedBuffer);
    const pyMemory = pyodide.toPy(jsView);
    
    // 在 Python 中转换为 numpy array (如果可用)
    return pyodide.runPython(`
      import numpy as np
      def wrap_shared(buffer_view):
        return np.frombuffer(buffer_view, dtype='uint8')
      wrap_shared
    `)(pyMemory);
  }
}
