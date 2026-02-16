/**
 * WASM Sandbox - QuickJS 沙箱核心实现
 *
 * 使用 quickjs-emscripten 提供真正的内存隔离。
 * 代码在 WASM 虚拟机中执行，无法访问宿主对象。
 */

import { SandboxCapability, ResourceLimits } from './constants.js';
import { validateDomainPattern, isUrlAllowed } from './network-policy-utils.js';
import { SourceMapRegistry, getAsyncWrapperOffset, getSyncWrapperOffset } from './source-map-support.js';

// 动态导入 quickjs-emscripten（支持 tree-shaking）
let _quickjsModule = null;
/** @type {boolean} */
let _isAsyncModule = false;

async function getQuickJS() {
  if (_quickjsModule) return _quickjsModule;

  // 1) 优先尝试 Asyncify 变体
  try {
    /** @ts-ignore */
    const { newQuickJSAsyncWASMModule } = await import('quickjs-emscripten');
    _quickjsModule = await newQuickJSAsyncWASMModule();
    _isAsyncModule = true;
    return _quickjsModule;
  } catch (_) { /* fall through */ }

  // 2) 降级到同步版本
  try {
    /** @ts-ignore */
    const { getQuickJS: getSyncQJS } = await import('quickjs-emscripten');
    _quickjsModule = await getSyncQJS();
    _isAsyncModule = false;
    return _quickjsModule;
  } catch (_) { /* fall through */ }

  // 3) 最终降级到 quickjs-emscripten-core
  try {
    /** @ts-ignore */
    const { newQuickJSWASMModule } = await import('quickjs-emscripten-core');
    _quickjsModule = await newQuickJSWASMModule();
    _isAsyncModule = false;
    return _quickjsModule;
  } catch (_) {
    throw new Error(
      'WASM sandbox requires quickjs-emscripten. Install with: npm install quickjs-emscripten'
    );
  }
}

/**
 * 查询是否成功加载了 Asyncify 变体
 * @returns {boolean}
 */
export function isAsyncifyEnabled() {
  return _isAsyncModule;
}

function tryJsonStringify(value) {
  try {
    return {
      ok: true,
      json: JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v)),
    };
  } catch {
    /* intentional: WASM unavailable returns failure */
    return { ok: false, json: "" };
  }
}

/**
 * 沙箱执行结果
 * @typedef {Object} SandboxResult
 * @property {boolean} ok - 是否成功
 * @property {*} [value] - 返回值
 * @property {string} [error] - 错误消息
 * @property {string} [stack] - 错误堆栈
 * @property {number} durationMs - 执行耗时
 */

/**
 * WasmSandbox - QuickJS WASM 沙箱
 */
export class WasmSandbox {
  /**
   * @param {Object} options
   * @param {string[]} [options.capabilities] - 允许的能力列表
   * @param {Object} [options.limits] - 资源限制
   * @param {Function} [options.onLog] - 日志回调
   * @param {Function} [options.onEmit] - 事件发射回调
   * @param {Object} [options.state] - 注入的状态
   * @param {{ allowedDomains?: string[], deniedDomains?: string[] }} [options.networkPolicy] - 网络策略
   */
  constructor(options = {}) {
    this.capabilities = new Set(options.capabilities || [SandboxCapability.CONSOLE]);
    this.limits = { ...ResourceLimits.STANDARD, ...options.limits };
    this.onLog = options.onLog || (() => {});
    this.onEmit = options.onEmit || (() => {});
    this.state = options.state || {};
    this.networkPolicy = options.networkPolicy || null;
    this._logSeq = 0; // P1: 日志序列号，用于异步传输重排序

    if (this.networkPolicy) {
      for (const list of [this.networkPolicy.allowedDomains, this.networkPolicy.deniedDomains]) {
        if (list) list.forEach(validateDomainPattern);
      }
    }

    this._vm = null;
    this._runtime = null;
    this._quickjs = null;
    this._initialized = false;
    this._disposed = false;

    // SourceMap 支持：降级安全，初始化失败不影响沙箱功能
    try {
      this._sourceMapRegistry = new SourceMapRegistry();
    } catch {
      this._sourceMapRegistry = null;
    }
  }

  /**
   * 初始化沙箱
   */
  async init() {
    if (this._initialized) return;
    if (this._disposed) throw new Error('Sandbox has been disposed');

    this._quickjs = await getQuickJS();

    // 创建带资源限制的 runtime
    this._runtime = this._quickjs.newRuntime();
    this._runtime.setMemoryLimit(this.limits.memoryLimit);
    this._runtime.setMaxStackSize(this.limits.maxStackDepth * 1024); // 转换为字节

    // 创建 VM 上下文
    this._vm = this._runtime.newContext();

    // 注入能力
    this._injectCapabilities();

    this._initialized = true;
  }

  /**
   * 注入能力到 VM
   */
  _injectCapabilities() {
    const vm = this._vm;

    // console（如果有权限）
    if (this.capabilities.has(SandboxCapability.CONSOLE)) {
      const consoleObj = vm.newObject();

      for (const level of ['log', 'warn', 'error', 'info', 'debug']) {
        const fn = vm.newFunction(level, (...args) => {
          const jsArgs = args.map(arg => vm.dump(arg));
          // P1: 附加序列号和时间戳，支持异步传输重排序
          this.onLog(level, jsArgs, { seq: ++this._logSeq, ts: Date.now() });
        });
        vm.setProp(consoleObj, level, fn);
        fn.dispose();
      }

      vm.setProp(vm.global, 'console', consoleObj);
      consoleObj.dispose();
    }

    // state（如果有权限）
    if (this.capabilities.has(SandboxCapability.STATE)) {
      // 深冻结状态，防止篡改
      const stateJson = (() => {
        const out = tryJsonStringify(this.state);
        return out.ok ? out.json : "{}";
      })();
      const result = vm.evalCode(`(${stateJson})`);
      if (result.error) {
        result.error.dispose();
      } else {
        vm.setProp(vm.global, 'state', result.value);
        result.value.dispose();
      }
    }

    // emit（如果有权限）
    if (this.capabilities.has(SandboxCapability.EMIT)) {
      const emitFn = vm.newFunction('emit', (nameHandle, payloadHandle) => {
        const name = vm.getString(nameHandle);
        let payload;
        try {
          payload = vm.dump(payloadHandle);
        } catch {
          payload = null;
        }
        this.onEmit(name, payload);
      });
      vm.setProp(vm.global, 'emit', emitFn);
      emitFn.dispose();
    }

    // fetch（如果有权限）- 通过宿主代理真实 fetch + NetworkPolicy 过滤
    if (this.capabilities.has(SandboxCapability.FETCH)) {
      const sandbox = this;

      const fetchFn = vm.newFunction('__hostFetch', (urlHandle, methodHandle, headersJsonHandle, bodyHandle) => {
        const url = vm.getString(urlHandle);
        const method = vm.getString(methodHandle);
        const headersJson = vm.getString(headersJsonHandle);
        const body = vm.getString(bodyHandle);

        // NetworkPolicy 检查
        if (!isUrlAllowed(url, sandbox.networkPolicy)) {
          const errJson = JSON.stringify({ __fetchError: true, message: `Network request blocked by policy: ${url}`, code: 'ERR_NETWORK_POLICY' });
          return vm.newString(errJson);
        }

        // 构建 fetch 选项
        const fetchOptions = { method };
        try {
          const parsed = JSON.parse(headersJson);
          if (parsed && typeof parsed === 'object') fetchOptions.headers = parsed;
        } catch { /* ignore */ }
        if (body && method !== 'GET' && method !== 'HEAD') {
          fetchOptions.body = body;
        }

        // 创建 QuickJS Promise 并桥接宿主 fetch
        const promise = vm.newPromise();

        fetch(url, fetchOptions).then(async (resp) => {
          let text;
          try { text = await resp.text(); } catch { text = ''; }
          const result = JSON.stringify({
            ok: resp.ok,
            status: resp.status,
            statusText: resp.statusText || '',
            headers: Object.fromEntries(resp.headers.entries()),
            body: text,
          });
          const handle = vm.newString(result);
          promise.resolve(handle);
          handle.dispose();
        }).catch((err) => {
          const errJson = JSON.stringify({ __fetchError: true, message: err.message || 'Fetch failed', code: 'ERR_FETCH' });
          const handle = vm.newString(errJson);
          promise.resolve(handle);
          handle.dispose();
        }).finally(() => {
          sandbox._runtime?.executePendingJobs();
        });

        return promise.handle;
      });
      vm.setProp(vm.global, '__hostFetch', fetchFn);
      fetchFn.dispose();

      // 注入 VM 内的 fetch polyfill：序列化参数 → 调用 __hostFetch → 解析响应
      vm.evalCode(`
        globalThis.fetch = function(url, options) {
          var opts = options || {};
          var method = (opts.method || 'GET').toUpperCase();
          var headers = '{}';
          if (opts.headers) {
            try {
              headers = JSON.stringify(opts.headers);
            } catch(e) {
              console.warn('Failed to stringify fetch headers:', e.message);
            }
          }
          var body = opts.body || '';
          var resultPromise = __hostFetch(String(url), method, headers, String(body));
          return resultPromise.then(function(raw) {
            var data = JSON.parse(raw);
            if (data.__fetchError) {
              var err = new Error(data.message);
              err.code = data.code;
              throw err;
            }
            return {
              ok: data.ok,
              status: data.status,
              statusText: data.statusText,
              headers: data.headers || {},
              text: function() { return Promise.resolve(data.body); },
              json: function() { return Promise.resolve(JSON.parse(data.body)); }
            };
          });
        };
      `);
    }
  }

  /**
   * 执行代码
   * @param {string} code - 要执行的代码
   * @param {Object} [context] - 额外的上下文变量
   * @param {{ _lineOffset?: number }} [_internal] - 内部参数，不属于公开 API
   * @returns {Promise<SandboxResult>}
   */
  async execute(code, context = {}, _internal = {}) {
    if (!this._initialized) await this.init();
    if (this._disposed) throw new Error('Sandbox has been disposed');

    const startTime = performance.now();
    const vm = this._vm;

    // 注入额外上下文
    for (const [key, value] of Object.entries(context)) {
      const out = tryJsonStringify(value);
      if (!out.ok) continue;
      const json = out.json;
      const result = vm.evalCode(`(${json})`);
      if (!result.error) {
        vm.setProp(vm.global, key, result.value);
        result.value.dispose();
      } else {
        result.error.dispose();
      }
    }

    // 设置中断处理器（超时）
    let interrupted = false;
    const timeoutId = setTimeout(() => {
      interrupted = true;
      this._runtime.setInterruptHandler(() => true);
    }, this.limits.timeoutMs);

    // 注册 source map（使用调用方指定的偏移，默认 0 = 同步执行无包装）
    const scriptId = '<sandbox>';
    if (this._sourceMapRegistry) {
      const offset = typeof _internal._lineOffset === 'number' ? _internal._lineOffset : getSyncWrapperOffset();
      this._sourceMapRegistry.register(scriptId, code, offset);
    }

    try {
      // 执行代码
      const result = vm.evalCode(code);

      const duration = performance.now() - startTime;

      if (result.error) {
        const error = vm.dump(result.error);
        result.error.dispose();

        const errorStr = interrupted ? 'Execution timeout' : String(error);
        return {
          ok: false,
          value: null,
          error: this._mapError(errorStr, scriptId),
          durationMs: duration,
        };
      }

      // 提取返回值
      let data;
      try {
        data = vm.dump(result.value);
      } catch {
        data = undefined;
      }
      result.value.dispose();

      return {
        ok: true,
        value: data,
        durationMs: duration,
      };
    } catch (err) {
      return {
        ok: false,
        value: null,
        error: this._mapError(err.message, scriptId),
        durationMs: performance.now() - startTime,
      };
    } finally {
      clearTimeout(timeoutId);
      try {
        this._runtime.setInterruptHandler(() => false);
      } catch {
        // ignore
      }
    }
  }

  /**
   * 当前异步执行模式
   * @returns {'asyncify' | 'polling'}
   */
  get asyncMode() {
    return _isAsyncModule ? 'asyncify' : 'polling';
  }

  /**
   * 执行异步代码（处理 Promise）
   */
  async executeAsync(code, context = {}) {
    if (!this._initialized) await this.init();

    // 包装代码为 async IIFE
    const wrappedCode = `
      (async () => {
        ${code}
      })()
    `;

    // 通过 _internal 参数传递 async 偏移给 execute，避免被同步偏移覆盖
    const result = await this.execute(wrappedCode, context, { _lineOffset: getAsyncWrapperOffset() });

    if (result.ok) {
      const timeoutMs = 5000;
      const startTime = Date.now();

      if (_isAsyncModule) {
        // Asyncify 路径：await executePendingJobs，自动 yield 回事件循环
        const perCallTimeout = 2000; // 单次 await 上限
        while (true) {
          if (Date.now() - startTime > timeoutMs) {
            return {
              ...result,
              ok: false,
              error: `[WasmSandbox] Async job timeout after ${timeoutMs}ms (asyncify mode).`,
            };
          }
          const pending = this._runtime.executePendingJobs();
          // 对 Promise 加单次超时保护，防止永远不 resolve
          let resolved;
          if (pending instanceof Promise) {
            const timer = new Promise((_, reject) =>
              setTimeout(() => reject(new Error('executePendingJobs hung')), perCallTimeout)
            );
            try {
              resolved = await Promise.race([pending, timer]);
            } catch {
              return {
                ...result,
                ok: false,
                error: `[WasmSandbox] executePendingJobs did not resolve within ${perCallTimeout}ms.`,
              };
            }
          } else {
            resolved = pending;
          }
          if (resolved.error) {
            const error = this._vm.dump(resolved.error);
            resolved.error.dispose();
            return { ...result, ok: false, error: String(error) };
          }
          if (resolved.value === 0) break;
        }
      } else {
        // 降级路径：同步轮询（向后兼容）
        const maxIterations = 1000;
        for (let i = 0; i < maxIterations; i++) {
          if (Date.now() - startTime > timeoutMs) {
            return {
              ...result,
              ok: false,
              error: `[WasmSandbox] Async job polling timeout after ${timeoutMs}ms. ` +
                     `Possible infinite Promise chain or excessive async operations. ` +
                     `Consider simplifying async logic or increasing timeout.`,
            };
          }
          const pending = this._runtime.executePendingJobs();
          if (pending.error) {
            const error = this._vm.dump(pending.error);
            pending.error.dispose();
            return { ...result, ok: false, error: String(error) };
          }
          if (pending.value === 0) break;
          if (i === maxIterations - 1) {
            return {
              ...result,
              ok: false,
              error: `[WasmSandbox] Exceeded maximum async job iterations (${maxIterations}). ` +
                     `Possible infinite Promise chain. Consider simplifying async logic.`,
            };
          }
        }
      }
    }

    return result;
  }

  /**
   * Reset VM/runtime state for reuse (keeps the instance, recreates the context on next init).
   * This is used by SandboxPool to ensure cross-run isolation.
   *
   * @param {Object} [options]
   * @param {Object} [options.state]
   * @param {Function} [options.onLog]
   * @param {Function} [options.onEmit]
   * @param {Object} [options.limits]
   * @returns {boolean} true if recycled, false if already disposed
   */
  recycle(options = {}) {
    if (this._disposed) return false;

    const nextState = options && typeof options === "object" && "state" in options ? options.state : undefined;
    if (nextState !== undefined) this.state = nextState || {};
    if (typeof options?.onLog === "function") this.onLog = options.onLog;
    if (typeof options?.onEmit === "function") this.onEmit = options.onEmit;
    if (options?.limits && typeof options.limits === "object") this.limits = { ...this.limits, ...options.limits };

    if (this._vm) {
      this._vm.dispose();
      this._vm = null;
    }
    if (this._runtime) {
      this._runtime.dispose();
      this._runtime = null;
    }

    this._initialized = false;
    return true;
  }

  /**
   * 更新状态
   */
  updateState(newState) {
    this.state = { ...this.state, ...newState };

    if (this._initialized && this.capabilities.has(SandboxCapability.STATE)) {
      const out = tryJsonStringify(this.state);
      if (!out.ok) return;
      const result = this._vm.evalCode(`globalThis.state = ${out.json};`);
      if (result.error) {
        result.error.dispose();
      } else {
        result.value.dispose();
      }
    }
  }

  /**
   * 获取内存使用情况
   */
  getMemoryUsage() {
    if (!this._runtime) return null;
    return this._runtime.computeMemoryUsage();
  }

  /**
   * 映射错误字符串中的堆栈行号（降级安全）
   * @param {string} errorStr
   * @param {string} [scriptId]
   * @returns {string}
   */
  _mapError(errorStr, scriptId) {
    if (!this._sourceMapRegistry || !errorStr) return errorStr;
    try {
      return this._sourceMapRegistry.mapStackTrace(errorStr, scriptId);
    } catch {
      /* intentional: JSON.parse failure returns raw string */
      return errorStr;
    }
  }

  /**
   * 销毁沙箱（带超时保护）
   * @param {Object} [options]
   * @param {number} [options.timeoutMs=2000] - 清理超时时间
   */
  dispose(options = {}) {
    if (this._disposed) return;

    const timeoutMs = options.timeoutMs || 2000;
    const startTime = Date.now();

    try {
      // 第一阶段：尝试正常清理
      if (this._vm) {
        this._vm.dispose();
        this._vm = null;
      }

      if (this._runtime) {
        this._runtime.dispose();
        this._runtime = null;
      }

      this._disposed = true;
      this._initialized = false;
      if (this._sourceMapRegistry) this._sourceMapRegistry.clear();
    } catch (err) {
      // 清理失败，强制标记为已销毁
      const elapsed = Date.now() - startTime;

      if (elapsed > timeoutMs) {
        // 超时，强制清理
        this._vm = null;
        this._runtime = null;
        this._disposed = true;
        this._initialized = false;
        if (this._sourceMapRegistry) this._sourceMapRegistry.clear();
        throw new Error(`Sandbox dispose timeout after ${timeoutMs}ms: ${err.message}`);
      }

      // 第二阶段：强制清理
      this._vm = null;
      this._runtime = null;
      this._disposed = true;
      this._initialized = false;
      if (this._sourceMapRegistry) this._sourceMapRegistry.clear();
      throw err;
    }
  }
}

/**
 * 快速创建沙箱
 * @param {Object} [options]
 * @param {string[]} [options.capabilities] - 允许的能力列表
 * @param {Object} [options.limits] - 资源限制
 * @param {Function} [options.onLog] - 日志回调
 * @param {Function} [options.onEmit] - 事件发射回调
 * @param {Object} [options.state] - 注入的状态
 * @returns {Promise<WasmSandbox>}
 */
export async function createSandbox(options = {}) {
  const sandbox = new WasmSandbox(options);
  await sandbox.init();
  return sandbox;
}

export default WasmSandbox;
