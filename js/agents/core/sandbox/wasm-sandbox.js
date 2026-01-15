/**
 * WASM Sandbox - QuickJS 沙箱核心实现
 *
 * 使用 quickjs-emscripten 提供真正的内存隔离。
 * 代码在 WASM 虚拟机中执行，无法访问宿主对象。
 */

import { SandboxCapability, ResourceLimits } from './constants.js';

// 动态导入 quickjs-emscripten（支持 tree-shaking）
let _quickjsModule = null;

async function getQuickJS() {
  if (_quickjsModule) return _quickjsModule;

  try {
    // 优先使用 quickjs-emscripten
    /** @ts-ignore - quickjs-emscripten 是可选依赖，类型定义可能不存在 */
    const { getQuickJS } = await import('quickjs-emscripten');
    _quickjsModule = await getQuickJS();
    return _quickjsModule;
  } catch (err) {
    // 回退到 quickjs-emscripten-core（更轻量）
    try {
      /** @ts-ignore - quickjs-emscripten-core 是可选依赖，类型定义可能不存在 */
      const { newQuickJSWASMModule } = await import('quickjs-emscripten-core');
      _quickjsModule = await newQuickJSWASMModule();
      return _quickjsModule;
    } catch (err2) {
      throw new Error(
        'WASM sandbox requires quickjs-emscripten. Install with: npm install quickjs-emscripten'
      );
    }
  }
}

function tryJsonStringify(value) {
  try {
    return {
      ok: true,
      json: JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v)),
    };
  } catch {
    return { ok: false, json: "" };
  }
}

/**
 * 沙箱执行结果
 * @typedef {Object} SandboxResult
 * @property {boolean} success
 * @property {*} data
 * @property {string} [error]
 * @property {Object} metrics
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
   */
  constructor(options = {}) {
    this.capabilities = new Set(options.capabilities || [SandboxCapability.CONSOLE]);
    this.limits = { ...ResourceLimits.STANDARD, ...options.limits };
    this.onLog = options.onLog || (() => {});
    this.onEmit = options.onEmit || (() => {});
    this.state = options.state || {};

    this._vm = null;
    this._runtime = null;
    this._quickjs = null;
    this._initialized = false;
    this._disposed = false;
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
          this.onLog(level, jsArgs);
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

    // fetch（如果有权限）- 返回 Promise 代理
    if (this.capabilities.has(SandboxCapability.FETCH)) {
      // 注意：真正的 fetch 需要通过宿主代理实现
      // 这里注入一个占位，实际实现需要 async 通道
      const fetchFn = vm.newFunction('__hostFetch', (urlHandle, optionsHandle) => {
        const url = vm.getString(urlHandle);
        // 返回一个标记，由宿主处理
        return vm.newString(JSON.stringify({ __hostCall: 'fetch', url }));
      });
      vm.setProp(vm.global, '__hostFetch', fetchFn);
      fetchFn.dispose();

      // 注入 fetch polyfill
      vm.evalCode(`
        globalThis.fetch = async (url, options) => {
          // 通过标记通道与宿主通信
          return Promise.resolve({ ok: false, status: 403, text: () => 'Sandboxed' });
        };
      `);
    }
  }

  /**
   * 执行代码
   * @param {string} code - 要执行的代码
   * @param {Object} [context] - 额外的上下文变量
   * @returns {Promise<SandboxResult>}
   */
  async execute(code, context = {}) {
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

    try {
      // 执行代码
      const result = vm.evalCode(code);

      const duration = performance.now() - startTime;

      if (result.error) {
        const error = vm.dump(result.error);
        result.error.dispose();

        return {
          success: false,
          data: null,
          error: interrupted ? 'Execution timeout' : String(error),
          metrics: {
            duration,
            memoryUsed: this._runtime.computeMemoryUsage().malloc_size,
          },
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
        success: true,
        data,
        metrics: {
          duration,
          memoryUsed: this._runtime.computeMemoryUsage().malloc_size,
        },
      };
    } catch (err) {
      return {
        success: false,
        data: null,
        error: err.message,
        metrics: {
          duration: performance.now() - startTime,
          memoryUsed: 0,
        },
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

    const result = await this.execute(wrappedCode, context);

    // 如果返回了 Promise，需要轮询 pending jobs
    if (result.success) {
      // 执行 pending jobs（Promise 回调）
      const maxIterations = 1000;
      for (let i = 0; i < maxIterations; i++) {
        const pending = this._runtime.executePendingJobs();
        if (pending.error) {
          const error = this._vm.dump(pending.error);
          pending.error.dispose();
          return {
            ...result,
            success: false,
            error: String(error),
          };
        }
        if (pending.value === 0) break;
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
   * 销毁沙箱
   */
  dispose() {
    if (this._disposed) return;

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
  }
}

/**
 * 快速创建沙箱
 */
export async function createSandbox(options = {}) {
  const sandbox = new WasmSandbox(options);
  await sandbox.init();
  return sandbox;
}

export default WasmSandbox;
