/**
 * Skill Executor - 在沙箱中安全执行 Skills
 *
 * 替代原有的 js-sandbox-worker，提供真正的隔离。
 *
 * 降级策略：
 * - 默认 `fallbackMode: "none"`，WASM 不可用时直接报错。
 * - 可通过 `fallbackMode: "eval"` 启用受限 JS 执行（best-effort；不是强安全边界）。
 */

import { SandboxPool } from './pool.js';
import { SandboxPreset, ResourceLimits } from './constants.js';
import { createLogger } from '../../shared/index.js';
import { isNodeLike } from '../../shared/index.js';
import {
  ALLOWED_CAPABILITIES,
  createFallbackGlobals,
  createFallbackProxyGlobals,
  isAllowlistedSkill,
  isWasmSupported,
  normalizeCapabilityList,
  normalizeFallbackAllowlist,
  normalizeFallbackMode,
  validateFallbackCode,
} from './skill-executor-helpers.js';

export { isWasmSupported };

/**
 * SkillExecutor - 安全的 Skill 执行器
 */
export class SkillExecutor {
  /**
   * @param {Object} options
   * @param {Object} [options.kernel] - Kernel 实例（用于事件和状态）
   * @param {SandboxPool} [options.pool] - 沙箱池（可选，会自动创建）
   * @param {Function} [options.trustChecker] - 检查 Skill 是否可信
   * @param {Iterable<string>} [options.fallbackAllowlist] - 允许使用 fallback eval 的 skill id/name 列表
   * @param {'eval'|'none'} [options.fallbackMode='none'] - WASM 不可用时的降级策略
   * @param {{ debug?: Function, info?: Function, warn?: Function, error?: Function }} [options.logger] - 日志实例
   */
  constructor(options = {}) {
    this.kernel = options.kernel;
    this.wasmSupported = null; // 延迟检测
    this.fallbackMode = normalizeFallbackMode(options.fallbackMode ?? 'none'); // 'eval' | 'none'
    this.pool = options.pool;
    this.logger = options.logger || createLogger('core/sandbox/skill-executor');
    this.trustChecker = options.trustChecker || this._defaultTrustChecker;
    this.fallbackAllowlist = normalizeFallbackAllowlist(options.fallbackAllowlist);
    this._ownPool = !options.pool;
    this._poolInitPromise = null;
    this._fallbackWarned = false;
  }

  /**
   * 默认信任检查器
   * 只信任 system scope 的 Skills
   */
  _defaultTrustChecker(skill) {
    const scope = skill?.metadata?.scope;
    return scope === 'system';
  }

  /**
   * fallback eval 仅允许可信代码或显式 allowlist
   * @param {Object} skill
   * @param {Object} [context]
   * @returns {boolean}
   */
  _isFallbackAllowed(skill, context = {}) {
    if (this.trustChecker(skill)) return true;
    if (context?.trusted === true) return true;

    const allowlist = normalizeFallbackAllowlist(context?.fallbackAllowlist) || this.fallbackAllowlist;
    if (allowlist) return isAllowlistedSkill(allowlist, skill);

    // No explicit allowlist: do not allow fallback eval for untrusted skills.
    return false;
  }

  /**
   * 确定 Skill 的能力级别
   */
  _determineCapabilities(skill, context = {}) {
    const isTrusted = this.trustChecker(skill);

    if (isTrusted) {
      return SandboxPreset.TRUSTED;
    }

    // 基础能力
    const caps = [...SandboxPreset.SKILL];

    // 检查 Skill 声明的能力需求（声明本身不等于授权）
    const declared = normalizeCapabilityList(skill?.metadata?.capabilities);
    const approved = normalizeCapabilityList(context?.approvedCapabilities);

    /** @type {Set<string>} */
    const requestedCaps = new Set();
    for (const cap of declared) {
      const mapped = ALLOWED_CAPABILITIES[cap];
      if (!mapped) {
        // 未知能力声明仅告警，不授予
        this.logger.warn('[SkillExecutor] Unknown capability declared by skill', {
          skill: skill?.metadata?.name,
          capability: cap,
        });
        continue;
      }
      requestedCaps.add(mapped);
    }

    // 仅在显式批准的情况下授予声明能力（并且必须在白名单中）
    for (const cap of approved) {
      const mapped = ALLOWED_CAPABILITIES[cap];
      if (!mapped) {
        this.logger.warn('[SkillExecutor] Unknown capability approval ignored', {
          skill: skill?.metadata?.name,
          capability: cap,
        });
        continue;
      }
      if (requestedCaps.has(mapped) && !caps.includes(mapped)) {
        caps.push(mapped);
      }
    }

    return caps;
  }

  /**
   * 确定资源限制
   */
  _determineLimits(skill) {
    const weight = skill?.metadata?.weight || 'standard';

    switch (weight) {
      case 'light':
        return ResourceLimits.LIGHT;
      case 'heavy':
        return ResourceLimits.HEAVY;
      default:
        return ResourceLimits.STANDARD;
    }
  }

  /**
   * 确保 WASM 沙箱池已初始化（若当前环境不支持 WASM，则返回 null）。
   *
   * 降级行为：
   * - `fallbackMode = "eval"`：使用受限的 JS 执行（best-effort；不是强安全边界）
   * - `fallbackMode = "none"`：直接报错，不执行 Skill
   *
   * @returns {Promise<SandboxPool | null>}
   */
  async _ensurePool() {
    if (this.pool) return this.pool;
    if (this._poolInitPromise) return this._poolInitPromise;

    this._poolInitPromise = (async () => {
      if (this.wasmSupported === null) {
        this.wasmSupported = await isWasmSupported();
      }

      if (!this.wasmSupported) {
        if (!this._fallbackWarned) {
          this._fallbackWarned = true;
          this.logger.warn('WASM not supported, falling back to', { mode: this.fallbackMode });
        }
        return null;
      }

      this.pool = new SandboxPool({
        maxSize: 4,
        defaultCapabilities: SandboxPreset.SKILL,
      });
      this._ownPool = true;
      return this.pool;
    })();

    try {
      return await this._poolInitPromise;
    } finally {
      this._poolInitPromise = null;
    }
  }

  /**
   * 执行 Skill
   * @param {Object} skill - Skill 对象（含 metadata 和 body）
   * @param {Object} context - 执行上下文
   * @returns {Promise<Object>}
   */
  async execute(skill, context = {}) {
    if (!skill?.body) {
      return {
        success: false,
        error: 'Skill has no body',
        data: null,
        metrics: {},
      };
    }

    const capabilities = this._determineCapabilities(skill, context);
    const limits = this._determineLimits(skill);

    // 构建状态
    const state = {
      skill: {
        name: skill.metadata?.name,
        scope: skill.metadata?.scope,
      },
      args: context.args || {},
      ...(context.state || {}),
    };

    // 日志收集
    const logs = [];
    const emits = [];

    const onLog = (level, args) => {
      logs.push({ level, args, ts: Date.now() });

      // 转发到 kernel
      if (this.kernel) {
        this.kernel.events.emit('skill:log', {
          skill: skill.metadata?.name,
          level,
          args,
        });
      }
    };

    const onEmit = (name, payload) => {
      emits.push({ name, payload, ts: Date.now() });

      // 转发到 kernel
      if (this.kernel) {
        this.kernel.events.emit(`skill:${name}`, {
          skill: skill.metadata?.name,
          payload,
        });
      }
    };

    try {
      const pool = await this._ensurePool();

      // WASM 不可用时降级
      if (!pool) {
        if (this.fallbackMode === 'none') {
          throw new Error('WASM sandbox unavailable and fallback disabled');
        }

        const result = await this._executeFallback(skill, context, { state, limits, onLog, onEmit });
        return {
          ...result,
          logs,
          emits,
          skill: skill.metadata?.name,
        };
      }

      let result;
      try {
        result = await pool.withSandbox(
          {
            capabilities,
            limits,
            state,
            onLog,
            onEmit,
          },
          async sandbox => {
            return sandbox.executeAsync(skill.body, context.args);
          }
        );
      } catch (err) {
        // WASM 沙箱初始化失败（例如缺少 quickjs-emscripten 或环境不支持 WASM）时允许降级
        if (this.fallbackMode === 'none') throw err;

        this.logger.warn('WASM sandbox failed, falling back to eval', { error: err?.message });
        this.wasmSupported = false;
        if (this._ownPool && this.pool) {
          try {
            this.pool.dispose();
          } catch {
            // ignore
          }
        }
        this.pool = null;

        const fallbackResult = await this._executeFallback(skill, context, { state, limits, onLog, onEmit });
        return {
          ...fallbackResult,
          logs,
          emits,
          skill: skill.metadata?.name,
        };
      }

      return {
        ...result,
        logs,
        emits,
        skill: skill.metadata?.name,
      };
    } catch (err) {
      return {
        success: false,
        error: err?.message || String(err),
        data: null,
        logs,
        emits,
        skill: skill.metadata?.name,
        metrics: {},
      };
    }
  }

  /**
   * 使用受限 JS 执行作为降级方案（best-effort）。
   *
   * 优先使用 Worker（js-sandbox-worker 协议），否则回退到主线程 eval。
   *
   * @param {Object} skill
   * @param {Object} context
   * @param {Object} exec
   * @param {Object} exec.state
   * @param {Object} exec.limits
   * @param {(level: string, args: any[]) => void} exec.onLog
   * @param {(name: string, payload: any) => void} exec.onEmit
   * @returns {Promise<{ success: boolean, data: any, error?: string, metrics: any }>}
   */
  async _executeFallback(skill, context, exec) {
    const skillId = skill?.id || skill?.metadata?.name;
    this.logger.debug('Executing skill in fallback mode', { skillId });

    if (!this._isFallbackAllowed(skill, context)) {
      try {
        this.logger.warn('Fallback eval blocked for untrusted skill', {
          skillId,
          scope: skill?.metadata?.scope,
        });
      } catch {
        // ignore
      }
      return {
        success: false,
        data: null,
        error: 'Security: fallback eval blocked for untrusted skill',
        metrics: { duration: 0, blocked: true, mode: 'eval' },
      };
    }

    const code = String(skill?.body || '');
    const timeoutMs = exec?.limits?.timeoutMs ?? ResourceLimits.STANDARD.timeoutMs;

    const validation = validateFallbackCode(code);
    if (!validation.valid) {
      try {
        this.logger.warn('Sandbox blocked code (fallback)', { skillId, reason: validation.reason });
      } catch {
        // ignore
      }
      return {
        success: false,
        data: null,
        error: `Security: ${validation.reason}`,
        metrics: { duration: 0, blocked: true, mode: 'eval' },
      };
    }

    // Try Worker-based restricted execution first.
    // Node.js: use worker_threads with dedicated worker file
    // Browser: use Web Worker
    if (isNodeLike()) {
      try {
        return await this._executeFallbackInNodeWorker({
          code,
          state: exec?.state,
          globals: context?.args,
          timeoutMs,
          onLog: exec?.onLog,
          onEmit: exec?.onEmit,
        });
      } catch (err) {
        this.logger.warn('Node worker unavailable, using main-thread eval', { error: err?.message });
      }
    } else if (typeof Worker !== 'undefined') {
      try {
        const workerUrl = new URL('../../runtime/core/js-sandbox-worker.js', import.meta.url);
        return await this._executeFallbackInWorker(workerUrl, {
          code,
          state: exec?.state,
          globals: context?.args,
          timeoutMs,
          onLog: exec?.onLog,
          onEmit: exec?.onEmit,
        });
      } catch (err) {
        this.logger.warn('Fallback worker unavailable, using main-thread eval', { error: err?.message });
      }
    }

    // Main-thread fallback (no isolation; best-effort).
    return await this._executeFallbackInMainThread({
      code,
      state: exec?.state,
      globals: context?.args,
      timeoutMs,
      onLog: exec?.onLog,
      onEmit: exec?.onEmit,
    });
  }

  async _executeFallbackInWorker(workerUrl, options) {
    const startTime = Date.now();
    const timeoutMs = Math.max(0, Number(options?.timeoutMs ?? 30000));

    /** @type {Worker | null} */
    let worker = null;
    try {
      worker = new Worker(workerUrl, { type: 'module' });
    } catch {
      // Older browsers may not support module workers.
      worker = new Worker(workerUrl);
    }

    const id = 1;

    return await new Promise((resolve) => {
      let done = false;
      /** @type {ReturnType<typeof setTimeout> | null} */
      let timeoutId = null;

      const finish = (result) => {
        if (done) return;
        done = true;
        resolve(result);
      };

      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        try {
          worker?.terminate?.();
        } catch {
          // ignore
        }
        worker = null;
      };

      // Host-side timeout: handles sync infinite loops (worker event loop blocked).
      if (timeoutMs > 0) {
        timeoutId = setTimeout(() => {
          cleanup();
          finish({
            success: false,
            data: null,
            error: 'Worker execution timeout',
            metrics: { duration: Date.now() - startTime, timedOut: true, mode: 'worker' },
          });
        }, timeoutMs + 1000);
      }

      worker.onmessage = (evt) => {
        const { type, success, data, error, metrics, name, payload, level, args, event } = evt.data || {};

        if (type === 'emit') {
          options?.onEmit?.(name, payload);
          return;
        }

        if (type === 'audit') {
          try {
            this.logger.debug('Sandbox audit', { mode: 'worker', event, payload });
          } catch {
            // ignore
          }
          return;
        }

        if (type === 'log') {
          options?.onLog?.(level, args);
          return;
        }

        if (type === 'result') {
          cleanup();
          const nextMetrics = metrics && typeof metrics === "object" ? { ...metrics } : { duration: Date.now() - startTime };
          nextMetrics.mode = 'worker';
          finish({
            success: Boolean(success),
            data: success ? data : null,
            error: success ? undefined : String(error || 'Unknown error'),
            metrics: nextMetrics,
          });
        }
      };

      worker.onerror = (err) => {
        cleanup();
        finish({
          success: false,
          data: null,
          error: err?.message || String(err),
          metrics: { duration: Date.now() - startTime, mode: 'worker' },
        });
      };

      try {
        worker.postMessage({
          type: 'execute',
          id,
          code: options.code,
          state: options.state,
          globals: options.globals,
          timeout: timeoutMs,
        });
      } catch (err) {
        cleanup();
        finish({
          success: false,
          data: null,
          error: err?.message || String(err),
          metrics: { duration: Date.now() - startTime, mode: 'worker' },
        });
      }
    });
  }

  /**
   * Node.js worker_threads 执行
   * @param {Object} options
   * @returns {Promise<{ success: boolean, data: any, error?: string, metrics: any }>}
   */
  async _executeFallbackInNodeWorker(options) {
    const startTime = Date.now();
    const timeoutMs = Math.max(0, Number(options?.timeoutMs ?? 30000));

    // Dynamic import for Node.js worker_threads
    // @ts-ignore - Node-only module; this package is type-checked without Node types.
    const { Worker } = await import(/* @vite-ignore */ 'node:worker_threads');
    const workerPath = new URL('../../runtime/core/js-sandbox-worker.node.js', import.meta.url);

    // @ts-ignore - Node-only type; this package is type-checked without Node types.
    /** @type {import('node:worker_threads').Worker | null} */
    let worker = null;
    try {
      worker = new Worker(workerPath);
    } catch (err) {
      throw new Error(`Failed to create Node worker: ${err?.message}`);
    }

    const id = 1;

    return await new Promise((resolve) => {
      let done = false;
      /** @type {ReturnType<typeof setTimeout> | null} */
      let timeoutId = null;

      const finish = (result) => {
        if (done) return;
        done = true;
        resolve(result);
      };

      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        try {
          worker?.terminate?.();
        } catch {
          // ignore
        }
        worker = null;
      };

      // Host-side timeout
      if (timeoutMs > 0) {
        timeoutId = setTimeout(() => {
          cleanup();
          finish({
            success: false,
            data: null,
            error: 'Worker execution timeout',
            metrics: { duration: Date.now() - startTime, timedOut: true, mode: 'node-worker' },
          });
        }, timeoutMs + 1000);
      }

      worker.on('message', (data) => {
        const { type, success, data: resultData, error, metrics, name, payload, level, args, event } = data || {};

        if (type === 'emit') {
          options?.onEmit?.(name, payload);
          return;
        }

        if (type === 'audit') {
          try {
            this.logger.debug('Sandbox audit', { mode: 'node-worker', event, payload });
          } catch {
            // ignore
          }
          return;
        }

        if (type === 'log') {
          options?.onLog?.(level, args);
          return;
        }

        if (type === 'result') {
          cleanup();
          const nextMetrics = metrics && typeof metrics === 'object' ? { ...metrics } : { duration: Date.now() - startTime };
          nextMetrics.mode = 'node-worker';
          finish({
            success: Boolean(success),
            data: success ? resultData : null,
            error: success ? undefined : String(error || 'Unknown error'),
            metrics: nextMetrics,
          });
        }
      });

      worker.on('error', (err) => {
        cleanup();
        finish({
          success: false,
          data: null,
          error: err?.message || String(err),
          metrics: { duration: Date.now() - startTime, mode: 'node-worker' },
        });
      });

      worker.on('exit', (code) => {
        if (!done && code !== 0) {
          cleanup();
          finish({
            success: false,
            data: null,
            error: `Worker exited with code ${code}`,
            metrics: { duration: Date.now() - startTime, mode: 'node-worker' },
          });
        }
      });

      try {
        worker.postMessage({
          type: 'execute',
          id,
          code: options.code,
          state: options.state,
          globals: options.globals,
          timeout: timeoutMs,
        });
      } catch (err) {
        cleanup();
        finish({
          success: false,
          data: null,
          error: err?.message || String(err),
          metrics: { duration: Date.now() - startTime, mode: 'node-worker' },
        });
      }
    });
  }

  async _executeFallbackInMainThread(options) {
    const startTime = Date.now();
    const timeoutMs = Math.max(0, Number(options?.timeoutMs ?? 30000));

    const baseGlobals = createFallbackGlobals({
      state: options.state,
      args: options.globals,
      onLog: options.onLog || (() => {}),
      onEmit: options.onEmit || (() => {}),
    });
    const audit = { blockedAccesses: new Set() };
    const sandbox = createFallbackProxyGlobals(baseGlobals, audit);

    try {
      this.logger.debug('Sandbox audit', {
        mode: 'eval',
        event: 'start',
        timeoutMs,
        codeLength: typeof options?.code === 'string' ? options.code.length : 0,
      });

      // 构建受限执行函数（best-effort；不是强安全边界）
      // SECURITY: Fallback sandbox via new Function/with - TRUSTED-ONLY.
      // This path is only reached when WASM sandbox is unavailable.
      // Do not route untrusted input here; prefer WASM/Worker sandbox.
      const userCode = typeof options?.code === 'string' ? options.code : '';
      const nonStrictUserCode = userCode.replace(
        /^\s*(?:["']use strict["'];?\s*)+/,
        ''
      );

      const wrappedCode = `
        with (sandbox) {
          return (async function () {
            ${nonStrictUserCode}
          }).call(this);
        }
      `;

      // eslint-disable-next-line no-new-func -- trusted-only fallback
      const fn = new Function('sandbox', wrappedCode);

      /** @type {ReturnType<typeof setTimeout> | null} */
      let timeoutId = null;
      const execPromise = fn.call(sandbox, sandbox);
      const timeoutPromise =
        timeoutMs > 0
          ? new Promise((_, reject) => {
              timeoutId = setTimeout(() => reject(new Error('Execution timeout')), timeoutMs);
            })
          : null;

      let result;
      try {
        result = timeoutPromise ? await Promise.race([execPromise, timeoutPromise]) : await execPromise;
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }

      return {
        success: true,
        data: result,
        metrics: {
          duration: Date.now() - startTime,
          mode: 'eval',
          blockedGlobals: Array.from(audit.blockedAccesses),
        },
      };
    } catch (err) {
      return {
        success: false,
        data: null,
        error: err?.message || String(err),
        metrics: {
          duration: Date.now() - startTime,
          mode: 'eval',
          blockedGlobals: Array.from(audit.blockedAccesses),
        },
      };
    } finally {
      try {
        this.logger.debug('Sandbox audit', {
          mode: 'eval',
          event: 'end',
          duration: Date.now() - startTime,
          blockedGlobals: Array.from(audit.blockedAccesses),
        });
      } catch {
        // ignore
      }
    }
  }

  /**
   * 批量执行（并行）
   */
  async executeMany(skills, context = {}) {
    return Promise.all(
      skills.map(skill => this.execute(skill, context))
    );
  }

  /**
   * 销毁执行器
   */
  dispose() {
    if (this._ownPool && this.pool) {
      this.pool.dispose();
    }
    this.pool = null;
  }
}

/**
 * 创建执行器
 * @param {Object} [options] - SkillExecutor options
 * @returns {SkillExecutor}
 */
export function createSkillExecutor(options = {}) {
  return new SkillExecutor(options);
}

export default SkillExecutor;
