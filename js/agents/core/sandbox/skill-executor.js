/**
 * Skill Executor - 在沙箱中安全执行 Skills
 *
 * 替代原有的 js-sandbox-worker，提供真正的隔离。
 */

import { SandboxPool } from './pool.js';
import { SandboxPreset, ResourceLimits, SandboxCapability } from './constants.js';

// Skill metadata 中允许声明的能力（白名单，声明 != 授权）
// 注意：这里的 key 为 Skill 声明用的字符串，value 为实际沙箱能力常量。
const ALLOWED_CAPABILITIES = Object.freeze({
  // Network
  network: SandboxCapability.FETCH,
  fetch: SandboxCapability.FETCH,
});

function normalizeCapabilityName(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeCapabilityList(value) {
  if (Array.isArray(value)) return value.map(normalizeCapabilityName).filter(Boolean);
  if (typeof value === 'string') {
    return value
      .split(',')
      .map(normalizeCapabilityName)
      .filter(Boolean);
  }
  return [];
}

/**
 * SkillExecutor - 安全的 Skill 执行器
 */
export class SkillExecutor {
  /**
   * @param {Object} options
   * @param {Object} [options.kernel] - Kernel 实例（用于事件和状态）
   * @param {SandboxPool} [options.pool] - 沙箱池（可选，会自动创建）
   * @param {Function} [options.trustChecker] - 检查 Skill 是否可信
   */
  constructor(options = {}) {
    this.kernel = options.kernel;
    this.pool = options.pool || new SandboxPool({
      maxSize: 4,
      defaultCapabilities: SandboxPreset.SKILL,
    });
    this.trustChecker = options.trustChecker || this._defaultTrustChecker;
    this._ownPool = !options.pool;
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
        // eslint-disable-next-line no-console
        console.warn?.('[SkillExecutor] Unknown capability declared by skill', {
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
        // eslint-disable-next-line no-console
        console.warn?.('[SkillExecutor] Unknown capability approval ignored', {
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

    try {
      const result = await this.pool.withSandbox(
        {
          capabilities,
          limits,
          state,
          onLog: (level, args) => {
            logs.push({ level, args, ts: Date.now() });

            // 转发到 kernel
            if (this.kernel) {
              this.kernel.events.emit('skill:log', {
                skill: skill.metadata?.name,
                level,
                args,
              });
            }
          },
          onEmit: (name, payload) => {
            emits.push({ name, payload, ts: Date.now() });

            // 转发到 kernel
            if (this.kernel) {
              this.kernel.events.emit(`skill:${name}`, {
                skill: skill.metadata?.name,
                payload,
              });
            }
          },
        },
        async sandbox => {
          return sandbox.executeAsync(skill.body, context.args);
        }
      );

      return {
        ...result,
        logs,
        emits,
        skill: skill.metadata?.name,
      };
    } catch (err) {
      return {
        success: false,
        error: err.message,
        data: null,
        logs,
        emits,
        skill: skill.metadata?.name,
        metrics: {},
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
    if (this._ownPool) {
      this.pool.dispose();
    }
  }
}

/**
 * 创建执行器
 */
export function createSkillExecutor(options = {}) {
  return new SkillExecutor(options);
}

export default SkillExecutor;
