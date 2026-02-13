/**
 * Skill Executor Core - 核心执行逻辑
 */

import { createLogger } from '../../shared/index.js';
import { normalizeFallbackMode, normalizeFallbackAllowlist } from './skill-executor-helpers.js';
import {
  defaultTrustChecker,
  isFallbackAllowed as checkFallbackAllowed,
  determineCapabilities,
  determineLimits,
} from './skill-validation.js';
import {
  ensurePool,
  executeFallback,
} from './skill-sandbox.js';

/**
 * SkillExecutor - 安全的 Skill 执行器
 */
export class SkillExecutor {
  /**
   * @param {Object} options
   * @param {Object} [options.kernel] - Kernel 实例（用于事件和状态）
   * @param {import('./pool.js').SandboxPool} [options.pool] - 沙箱池（可选，会自动创建）
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
    this.trustChecker = options.trustChecker || defaultTrustChecker;
    this.fallbackAllowlist = normalizeFallbackAllowlist(options.fallbackAllowlist);
    this._ownPool = !options.pool;
    this._poolInitPromise = null;
    this._fallbackWarned = false;
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
        ok: false,
        error: 'Skill has no body',
        value: null,
      };
    }

    const capabilities = determineCapabilities(skill, context, this.trustChecker, this.logger);
    const limits = determineLimits(skill);

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
      const poolState = {
        pool: this.pool,
        wasmSupported: this.wasmSupported,
        fallbackMode: this.fallbackMode,
        _ownPool: this._ownPool,
        _poolInitPromise: this._poolInitPromise,
        _fallbackWarned: this._fallbackWarned,
      };

      const pool = await ensurePool(poolState, this.logger);

      // 同步状态变更
      this.pool = poolState.pool;
      this.wasmSupported = poolState.wasmSupported;
      this._ownPool = poolState._ownPool;
      this._poolInitPromise = poolState._poolInitPromise;
      this._fallbackWarned = poolState._fallbackWarned;

      // WASM 不可用时降级
      if (!pool) {
        if (this.fallbackMode === 'none') {
          throw new Error('WASM sandbox unavailable and fallback disabled');
        }

        const isFallbackAllowedFn = (s, c) => checkFallbackAllowed(
          s,
          c,
          this.trustChecker,
          this.fallbackAllowlist,
          this.logger
        );

        const result = await executeFallback(
          skill,
          context,
          { state, limits, onLog, onEmit },
          isFallbackAllowedFn,
          this.logger
        );
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

        const isFallbackAllowedFn = (s, c) => checkFallbackAllowed(
          s,
          c,
          this.trustChecker,
          this.fallbackAllowlist,
          this.logger
        );

        const fallbackResult = await executeFallback(
          skill,
          context,
          { state, limits, onLog, onEmit },
          isFallbackAllowedFn,
          this.logger
        );
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
        ok: false,
        error: err?.message || String(err),
        value: null,
        logs,
        emits,
        skill: skill.metadata?.name,
      };
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
