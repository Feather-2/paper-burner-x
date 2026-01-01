let _wasmSupport = null;

function canInstantiateWasm() {
  try {
    if (typeof WebAssembly !== "object" || typeof WebAssembly.instantiate !== "function") return false;
    const moduleBytes = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
    const mod = new WebAssembly.Module(moduleBytes);
    if (!(mod instanceof WebAssembly.Module)) return false;
    const inst = new WebAssembly.Instance(mod);
    return inst instanceof WebAssembly.Instance;
  } catch {
    return false;
  }
}

/**
 * Best-effort WebAssembly feature detection.
 * @returns {boolean}
 */
export function isWasmSupported() {
  if (_wasmSupport !== null) return _wasmSupport;
  _wasmSupport = canInstantiateWasm();
  return _wasmSupport;
}

/**
 * WASM threads require SharedArrayBuffer + cross-origin isolation.
 * @returns {boolean}
 */
export function isWasmThreadsSupported() {
  try {
    if (!isWasmSupported()) return false;
    if (typeof SharedArrayBuffer === "undefined") return false;
    return typeof crossOriginIsolated === "boolean" ? crossOriginIsolated : false;
  } catch {
    return false;
  }
}

export default { isWasmSupported, isWasmThreadsSupported };
