/**
 * Skill Registry
 *
 * Central registry for all Skills in agent-burner-sdk.
 * Supports registration, lookup, matching, and catalog generation.
 *
 * Updated to support:
 * - priority, mutexKey, disableAutoActivation fields
 * - match(activationContext) for auto-activation with mutex filtering
 * - Handler-based execution
 */

import {
  SkillLayer,
  SkillStatus,
  validateSkillDefinition,
  createSkillDefinition,
  buildSkillCatalogPrompt,
} from "../shared/skill-definition.js";
import { matchSkills } from "./skill-matchers.js";

export { SkillLayer, SkillStatus };

/**
 * @typedef {Object} SkillDefinition
 * @property {string} name
 * @property {string} description
 * @property {number} [priority=0] - 越高越优先
 * @property {string} [mutexKey] - 互斥键（同组只激活一个）
 * @property {boolean} [disableAutoActivation=false] - 禁用自动激活
 * @property {Object} [metadata]
 * @property {Object} [activation] - 激活条件（keywords/tags/traits）
 */

/**
 * @typedef {Object} RegisteredSkill
 * @property {SkillDefinition} definition
 * @property {Function|null} handler - 执行处理器
 * @property {string} status
 * @property {any} instance - 加载后的实例
 * @property {Error|null} error - 加载错误
 * @property {number} registeredAt
 * @property {number|null} loadedAt
 */

/**
 * @typedef {Object} Activation
 * @property {RegisteredSkill} skill
 * @property {number} score
 * @property {string} reason
 */

export class SkillRegistry {
  constructor({ eventBus } = {}) {
    /** @type {Map<string, RegisteredSkill>} */
    this.skills = new Map();
    this.eventBus = eventBus || null;
  }

  _emit(name, payload) {
    if (this.eventBus && typeof this.eventBus.emit === "function") {
      this.eventBus.emit(name, { actor: "skill-registry", ...payload });
    }
  }

  /**
   * 注册 Skill
   * @param {SkillDefinition} definition
   * @param {Function} [handler] - 可选的执行处理器
   * @returns {boolean}
   */
  register(definition, handler = null) {
    const validation = validateSkillDefinition(definition);
    if (!validation.valid) {
      this._emit("skill.register.failed", {
        name: definition?.name || "unknown",
        errors: validation.errors,
      });
      return false;
    }

    const normalized = createSkillDefinition(definition);
    const existing = this.skills.get(normalized.name);

    if (existing) {
      // 更新已有注册
      existing.definition = normalized;
      existing.handler = handler || existing.handler;
      existing.status = SkillStatus.REGISTERED;
      existing.instance = null;
      existing.error = null;
      this._emit("skill.updated", { name: normalized.name });
    } else {
      this.skills.set(normalized.name, {
        definition: normalized,
        handler: handler,
        status: SkillStatus.REGISTERED,
        instance: null,
        error: null,
        registeredAt: Date.now(),
        loadedAt: null,
      });
      this._emit("skill.registered", { name: normalized.name, layer: normalized.layer });
    }

    return true;
  }

  /**
   * 批量注册
   * @param {Array<{definition: SkillDefinition, handler?: Function}>} registrations
   * @returns {{ success: number, failed: number }}
   */
  registerAll(registrations) {
    let success = 0;
    let failed = 0;
    for (const reg of registrations) {
      const def = reg.definition || reg;
      const handler = reg.handler || null;
      if (this.register(def, handler)) {
        success++;
      } else {
        failed++;
      }
    }
    return { success, failed };
  }

  /**
   * 获取 Skill
   * @param {string} name
   * @returns {RegisteredSkill|null}
   */
  get(name) {
    return this.skills.get(name) || null;
  }

  /**
   * 获取 Skill Definition
   * @param {string} name
   * @returns {SkillDefinition|null}
   */
  getDefinition(name) {
    const skill = this.skills.get(name);
    return skill ? skill.definition : null;
  }

  /**
   * 检查是否存在
   * @param {string} name
   * @returns {boolean}
   */
  has(name) {
    return this.skills.has(name);
  }

  /**
   * 获取所有 Skill 名称
   * @returns {string[]}
   */
  getAllNames() {
    return Array.from(this.skills.keys());
  }

  /**
   * 获取所有 Skill Definitions
   * @returns {SkillDefinition[]}
   */
  getAllDefinitions() {
    return Array.from(this.skills.values()).map((s) => s.definition);
  }

  /**
   * 按 Layer 筛选
   * @param {number} maxLayer
   * @returns {SkillDefinition[]}
   */
  getByMaxLayer(maxLayer) {
    return this.getAllDefinitions().filter((d) => d.layer <= maxLayer);
  }

  /**
   * 按状态筛选
   * @param {string} status
   * @returns {RegisteredSkill[]}
   */
  getByStatus(status) {
    return Array.from(this.skills.values()).filter((s) => s.status === status);
  }

  /**
   * 自动激活匹配
   * 返回匹配的 Skills，按 priority → score → name 排序，并应用 mutexKey 互斥
   *
   * @param {Object} activationContext
   * @param {string} activationContext.prompt - 用户输入
   * @param {string[]} [activationContext.channels] - 渠道列表
   * @param {Object<string,string>} [activationContext.tags] - 标签
   * @param {string[]} [activationContext.traits] - 特征列表
   * @param {Object} [activationContext.metadata] - 其他元数据
   * @returns {Activation[]}
   */
  match(activationContext) {
    // 获取可用于自动激活的 Skills
    const candidates = [];
    for (const skill of this.skills.values()) {
      // 跳过禁用的
      if (skill.status === SkillStatus.DISABLED) continue;
      // 跳过禁用自动激活的
      if (skill.definition.disableAutoActivation) continue;
      candidates.push(skill.definition);
    }

    if (candidates.length === 0) {
      return [];
    }

    // 使用 matchSkills 进行匹配
    const matches = matchSkills(candidates, activationContext, { requireAnyMatch: true });

    // 按 priority → score → name 排序
    matches.sort((a, b) => {
      const priorityA = a.skill.priority || 0;
      const priorityB = b.skill.priority || 0;
      if (priorityA !== priorityB) return priorityB - priorityA;
      if (a.score !== b.score) return b.score - a.score;
      return a.skill.name.localeCompare(b.skill.name);
    });

    // 应用 mutexKey 互斥（同组只取第一个）
    const selected = [];
    const seenMutexKeys = new Set();

    for (const match of matches) {
      const mutexKey = match.skill.mutexKey;
      if (mutexKey) {
        if (seenMutexKeys.has(mutexKey)) {
          continue; // 同组已有，跳过
        }
        seenMutexKeys.add(mutexKey);
      }
      selected.push({
        skill: this.skills.get(match.skill.name),
        score: match.score,
        reason: match.details?.reason || "matched",
      });
    }

    this._emit("skill.match.completed", {
      candidateCount: candidates.length,
      matchedCount: selected.length,
    });

    return selected;
  }

  /**
   * 执行 Skill
   * @param {Object} ctx - 上下文
   * @param {string} name - Skill 名称
   * @param {Object} [activationContext] - 激活上下文
   * @returns {Promise<any>}
   */
  async execute(ctx, name, activationContext = {}) {
    const skill = this.skills.get(name);
    if (!skill) {
      throw new Error(`Skill not found: ${name}`);
    }

    if (!skill.handler) {
      throw new Error(`Skill has no handler: ${name}`);
    }

    const enrichedContext = {
      ...activationContext,
      skillName: name,
    };

    try {
      const result = await skill.handler(ctx, enrichedContext);
      this._emit("skill.executed", { name, success: true });
      return result;
    } catch (error) {
      this._emit("skill.executed", { name, success: false, error: error.message });
      throw error;
    }
  }

  /**
   * 设置 Skill 状态
   * @param {string} name
   * @param {string} status
   * @param {Object} [extras]
   */
  setStatus(name, status, extras = {}) {
    const skill = this.skills.get(name);
    if (!skill) return false;

    skill.status = status;
    if (extras.instance !== undefined) skill.instance = extras.instance;
    if (extras.error !== undefined) skill.error = extras.error;
    if (status === SkillStatus.READY) skill.loadedAt = Date.now();

    this._emit("skill.status.changed", { name, status });
    return true;
  }

  /**
   * 禁用 Skill
   * @param {string} name
   * @returns {boolean}
   */
  disable(name) {
    return this.setStatus(name, SkillStatus.DISABLED);
  }

  /**
   * 启用 Skill
   * @param {string} name
   * @returns {boolean}
   */
  enable(name) {
    const skill = this.skills.get(name);
    if (!skill) return false;
    if (skill.status === SkillStatus.DISABLED) {
      skill.status = skill.instance ? SkillStatus.READY : SkillStatus.REGISTERED;
      return true;
    }
    return false;
  }

  /**
   * 移除 Skill
   * @param {string} name
   * @returns {boolean}
   */
  unregister(name) {
    const existed = this.skills.delete(name);
    if (existed) {
      this._emit("skill.unregistered", { name });
    }
    return existed;
  }

  /**
   * 清空注册表
   */
  clear() {
    this.skills.clear();
    this._emit("skill.registry.cleared", {});
  }

  /**
   * 生成 AI 可读目录
   * @param {Object} [options]
   * @param {number} [options.maxLayer]
   * @param {boolean} [options.enabledOnly]
   * @returns {string}
   */
  buildCatalogPrompt({ maxLayer = 4, enabledOnly = true } = {}) {
    let definitions = this.getAllDefinitions().filter((d) => d.layer <= maxLayer);

    if (enabledOnly) {
      const enabledNames = new Set(
        Array.from(this.skills.entries())
          .filter(([_, s]) => s.status !== SkillStatus.DISABLED)
          .map(([name]) => name)
      );
      definitions = definitions.filter((d) => enabledNames.has(d.name));
    }

    return buildSkillCatalogPrompt(definitions);
  }

  /**
   * 导出快照
   * @returns {Object}
   */
  exportSnapshot() {
    const snapshot = {};
    for (const [name, skill] of this.skills) {
      snapshot[name] = {
        layer: skill.definition.layer,
        priority: skill.definition.priority || 0,
        mutexKey: skill.definition.mutexKey || null,
        status: skill.status,
        registeredAt: skill.registeredAt,
        loadedAt: skill.loadedAt,
        hasHandler: !!skill.handler,
        hasInstance: !!skill.instance,
        error: skill.error ? skill.error.message : null,
      };
    }
    return snapshot;
  }

  /**
   * 获取统计信息
   * @returns {Object}
   */
  getStats() {
    const stats = {
      total: this.skills.size,
      byLayer: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 },
      byStatus: {},
      withHandler: 0,
    };

    for (const skill of this.skills.values()) {
      const layer = skill.definition.layer;
      stats.byLayer[layer] = (stats.byLayer[layer] || 0) + 1;
      stats.byStatus[skill.status] = (stats.byStatus[skill.status] || 0) + 1;
      if (skill.handler) stats.withHandler++;
    }

    return stats;
  }
}

// 单例导出（可选使用）
let _instance = null;

export function getSkillRegistry(options) {
  if (!_instance) {
    _instance = new SkillRegistry(options);
  }
  return _instance;
}

export function resetSkillRegistry() {
  _instance = null;
}

export default SkillRegistry;
