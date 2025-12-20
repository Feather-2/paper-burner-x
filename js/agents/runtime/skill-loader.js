/**
 * Skill Loader
 *
 * Lazy loads Skills with budget awareness and fallback support.
 * Integrates with:
 * - skill-fs-loader for filesystem-based skill discovery
 * - NexusSkillProvider for remote skill discovery via MCP Gateway
 */

import { SkillStatus } from "../shared/skill-definition.js";
import { matchSkills } from "./skill-matchers.js";
import { loadFromFS, loadSupportFiles } from "./skill-fs-loader.js";

export class SkillLoader {
  /**
   * @param {Object} options
   * @param {import('./skill-registry.js').SkillRegistry} options.registry
   * @param {string} [options.projectRoot] - 项目根路径
   * @param {number} [options.maxLayer=2] - 最大加载层级
   * @param {boolean} [options.mcpNexusEnabled=false] - MCP-Nexus 是否可用
   * @param {import('../mcp/nexus-skill-provider.js').NexusSkillProvider} [options.nexusProvider] - Nexus 提供者
   * @param {Object} [options.budgetManager] - 预算管理器
   * @param {Object} [options.mcpClient] - MCP 客户端
   * @param {Object} [options.eventBus] - 事件总线
   */
  constructor({
    registry,
    projectRoot,
    maxLayer = 2,
    mcpNexusEnabled = false,
    nexusProvider = null,
    budgetManager = null,
    mcpClient = null,
    eventBus = null,
  } = {}) {
    if (!registry) {
      throw new Error("SkillLoader requires a registry");
    }
    this.registry = registry;
    this.projectRoot = projectRoot || (typeof process !== "undefined" ? process.cwd() : ".");
    this.maxLayer = maxLayer;
    this.mcpNexusEnabled = mcpNexusEnabled;
    this.nexusProvider = nexusProvider;
    this.budgetManager = budgetManager;
    this.mcpClient = mcpClient;
    this.eventBus = eventBus;

    /** @type {Map<string, Promise<any>>} 加载中的 Promise */
    this.loadingPromises = new Map();
  }

  _emit(name, payload) {
    if (this.eventBus && typeof this.eventBus.emit === "function") {
      this.eventBus.emit(name, { actor: "skill-loader", ...payload });
    }
  }

  /**
   * 检查 Skill 是否可加载
   * @param {string} name
   * @returns {{ canLoad: boolean, reason?: string }}
   */
  canLoad(name) {
    const skill = this.registry.get(name);
    if (!skill) {
      return { canLoad: false, reason: "not_registered" };
    }

    const def = skill.definition;

    // Layer 检查
    if (def.layer > this.maxLayer) {
      return { canLoad: false, reason: "layer_exceeded" };
    }

    // MCP-Nexus 依赖检查
    if (def.requires?.mcpNexus && !this.mcpNexusEnabled) {
      return { canLoad: false, reason: "mcp_nexus_required" };
    }

    // 预算检查
    if (this.budgetManager && def.requires?.minBudget) {
      if (!this.budgetManager.canAfford(def.requires.minBudget)) {
        return { canLoad: false, reason: "budget_insufficient" };
      }
    }

    // 状态检查
    if (skill.status === SkillStatus.DISABLED) {
      return { canLoad: false, reason: "disabled" };
    }

    return { canLoad: true };
  }

  /**
   * 加载 Skill
   * @param {string} name
   * @param {Object} [options]
   * @param {boolean} [options.force=false] - 强制重新加载
   * @returns {Promise<any>}
   */
  async load(name, { force = false } = {}) {
    const skill = this.registry.get(name);
    if (!skill) {
      throw new Error(`Skill not registered: ${name}`);
    }

    // 已加载且不强制重载
    if (skill.status === SkillStatus.READY && skill.instance && !force) {
      return skill.instance;
    }

    // 正在加载中
    if (this.loadingPromises.has(name)) {
      return this.loadingPromises.get(name);
    }

    // 检查是否可加载
    const { canLoad, reason } = this.canLoad(name);
    if (!canLoad) {
      // 尝试 fallback
      const fallbackName = skill.definition.fallback;
      if (fallbackName && fallbackName !== name) {
        this._emit("skill.fallback", { from: name, to: fallbackName, reason });
        return this.load(fallbackName);
      }
      throw new Error(`Cannot load skill ${name}: ${reason}`);
    }

    // 开始加载
    const loadPromise = this._doLoad(name, skill);
    this.loadingPromises.set(name, loadPromise);

    try {
      const instance = await loadPromise;
      return instance;
    } finally {
      this.loadingPromises.delete(name);
    }
  }

  /**
   * 实际加载逻辑
   * @private
   */
  async _doLoad(name, skill) {
    const def = skill.definition;
    this.registry.setStatus(name, SkillStatus.LOADING);
    this._emit("skill.loading", { name, layer: def.layer });

    try {
      let instance = null;

      // 优先使用 handler（同步内联）
      if (def.handler && typeof def.handler === "function") {
        instance = { handler: def.handler };
      }
      // 否则使用 loader（异步懒加载）
      else if (def.loader && typeof def.loader === "function") {
        const module = await def.loader();
        instance = module.default || module;
      }
      // Layer 0 可以没有 loader/handler
      else if (def.layer === 0) {
        instance = { name: def.name, layer: 0 };
      }
      // 其他情况报错
      else {
        throw new Error(`No loader or handler for skill: ${name}`);
      }

      // 扣除预算
      if (this.budgetManager && def.estimatedCost > 0) {
        this.budgetManager.spend(def.estimatedCost);
      }

      this.registry.setStatus(name, SkillStatus.READY, { instance });
      this._emit("skill.loaded", { name, layer: def.layer });

      return instance;
    } catch (error) {
      this.registry.setStatus(name, SkillStatus.FAILED, { error });
      this._emit("skill.load.failed", { name, error: error.message });

      // 尝试 fallback
      const fallbackName = def.fallback;
      if (fallbackName && fallbackName !== name && this.registry.has(fallbackName)) {
        this._emit("skill.fallback", { from: name, to: fallbackName, reason: "load_failed" });
        return this.load(fallbackName);
      }

      throw error;
    }
  }

  /**
   * 批量加载
   * @param {string[]} names
   * @returns {Promise<Map<string, any>>}
   */
  async loadAll(names) {
    const results = new Map();
    const promises = names.map(async (name) => {
      try {
        const instance = await this.load(name);
        results.set(name, { success: true, instance });
      } catch (error) {
        results.set(name, { success: false, error });
      }
    });

    await Promise.all(promises);
    return results;
  }

  /**
   * 预加载指定层级的所有 Skill
   * @param {number} [layer=1]
   * @returns {Promise<{ loaded: string[], failed: string[] }>}
   */
  async preloadLayer(layer = 1) {
    const definitions = this.registry.getByMaxLayer(layer);
    const loaded = [];
    const failed = [];

    for (const def of definitions) {
      try {
        await this.load(def.name);
        loaded.push(def.name);
      } catch {
        failed.push(def.name);
      }
    }

    this._emit("skill.preload.complete", { layer, loaded: loaded.length, failed: failed.length });
    return { loaded, failed };
  }

  /**
   * 根据上下文自动匹配并加载最佳 Skill
   * @param {import('./skill-matchers.js').ActivationContext} context
   * @param {Object} [options]
   * @param {number} [options.limit=3] - 最多加载数量
   * @param {boolean} [options.loadAll=false] - 是否加载所有匹配的
   * @returns {Promise<{ skill: any, instance: any }[]>}
   */
  async loadMatching(context, { limit = 3, loadAll = false } = {}) {
    // 获取可用的 Skill（受 maxLayer 限制）
    const definitions = this.registry.getByMaxLayer(this.maxLayer);

    // 添加预算到上下文
    const enrichedContext = {
      ...context,
      availableBudget: this.budgetManager?.getRemaining?.() ?? Infinity,
    };

    // 匹配
    const matches = matchSkills(definitions, enrichedContext, { requireAnyMatch: true });

    // 限制数量
    const toLoad = loadAll ? matches : matches.slice(0, limit);

    // 加载
    const results = [];
    for (const match of toLoad) {
      try {
        const instance = await this.load(match.skill.name);
        results.push({
          skill: match.skill,
          instance,
          score: match.score,
        });
      } catch {
        // 加载失败，跳过
      }
    }

    return results;
  }

  /**
   * 获取 Skill 实例（如果已加载）
   * @param {string} name
   * @returns {any|null}
   */
  getInstance(name) {
    const skill = this.registry.get(name);
    if (skill && skill.status === SkillStatus.READY) {
      return skill.instance;
    }
    return null;
  }

  /**
   * 执行 Skill
   * @param {string} name
   * @param {Object} params
   * @param {Object} [context]
   * @returns {Promise<any>}
   */
  async execute(name, params, context = {}) {
    const instance = await this.load(name);

    if (!instance) {
      throw new Error(`Skill ${name} has no instance`);
    }

    // 支持多种执行方式
    if (typeof instance.handler === "function") {
      return instance.handler(params, context);
    }
    if (typeof instance.execute === "function") {
      return instance.execute(params, context);
    }
    if (typeof instance.run === "function") {
      return instance.run(params, context);
    }
    if (typeof instance === "function") {
      return instance(params, context);
    }

    throw new Error(`Skill ${name} has no executable method`);
  }

  /**
   * 更新配置
   * @param {Object} options
   */
  updateConfig({ maxLayer, mcpNexusEnabled, projectRoot } = {}) {
    if (maxLayer !== undefined) this.maxLayer = maxLayer;
    if (mcpNexusEnabled !== undefined) this.mcpNexusEnabled = mcpNexusEnabled;
    if (projectRoot !== undefined) this.projectRoot = projectRoot;
  }

  /**
   * 从文件系统发现并注册 Skills
   * @param {Object} [options]
   * @param {string[]} [options.paths] - 额外扫描路径
   * @param {boolean} [options.loadConfig=true] - 是否从配置文件读取路径
   * @returns {Promise<{ registered: number, errors: Error[] }>}
   */
  async discoverAndRegister({ paths, loadConfig = true } = {}) {
    const { registrations, errors } = await loadFromFS({
      projectRoot: this.projectRoot,
      paths,
      loadConfig,
    });

    let registered = 0;
    for (const reg of registrations) {
      if (this.registry.register(reg.definition, reg.handler)) {
        registered++;
      }
    }

    this._emit("skill.discovery.complete", {
      discovered: registrations.length,
      registered,
      errorCount: errors.length,
    });

    return { registered, errors };
  }

  /**
   * 为指定 Skill 加载支持文件
   * @param {string} name
   * @returns {Promise<{ files: Object<string, string>, errors: Error[] }>}
   */
  async loadSkillSupportFiles(name) {
    const skill = this.registry.get(name);
    if (!skill) {
      return { files: {}, errors: [new Error(`Skill not found: ${name}`)] };
    }

    const source = skill.definition.metadata?.source;
    if (!source) {
      return { files: {}, errors: [new Error(`Skill ${name} has no source path`)] };
    }

    // 从 source 路径推导 skill 目录
    const skillDir = source.replace(/\/SKILL\.md$/, "");
    return loadSupportFiles(skillDir);
  }

  /**
   * 完整的 Skill 执行（包含支持文件）
   * @param {string} name
   * @param {Object} [context]
   * @returns {Promise<{ body: string, supportFiles?: Object, metadata: Object }>}
   */
  async executeWithSupportFiles(name, context = {}) {
    const skill = this.registry.get(name);
    if (!skill) {
      throw new Error(`Skill not found: ${name}`);
    }

    // 执行 handler 获取 body
    const result = await this.registry.execute(context, name, context);

    // 加载支持文件
    const { files: supportFiles } = await this.loadSkillSupportFiles(name);

    return {
      skill: name,
      body: result.output?.body || "",
      supportFiles: Object.keys(supportFiles).length > 0 ? supportFiles : undefined,
      metadata: {
        ...result.metadata,
        supportFileCount: Object.keys(supportFiles).length,
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // Nexus Integration
  // ─────────────────────────────────────────────────────────────────

  /**
   * Check if Nexus Gateway is available
   * @returns {Promise<boolean>}
   */
  async checkNexusAvailable() {
    if (!this.nexusProvider) {
      return false;
    }
    try {
      const available = await this.nexusProvider.isAvailable();
      this.mcpNexusEnabled = available;
      return available;
    } catch {
      this.mcpNexusEnabled = false;
      return false;
    }
  }

  /**
   * Discover and register Skills from Nexus Gateway
   * @param {Object} [options]
   * @param {boolean} [options.skipDuplicates=true] - 跳过本地已存在的 Skills
   * @returns {Promise<{ registered: number, skipped: number, errors: Error[] }>}
   */
  async discoverFromNexus({ skipDuplicates = true } = {}) {
    if (!this.nexusProvider) {
      return { registered: 0, skipped: 0, errors: [new Error("No Nexus provider configured")] };
    }

    const errors = [];
    let registered = 0;
    let skipped = 0;

    try {
      const registrations = await this.nexusProvider.createRegistrations();

      for (const reg of registrations) {
        // 检查本地是否已存在
        if (skipDuplicates && this.registry.has(reg.definition.name)) {
          skipped++;
          continue;
        }

        if (this.registry.register(reg.definition, reg.handler)) {
          registered++;
        }
      }

      this._emit("skill.nexus.discovery.complete", {
        discovered: registrations.length,
        registered,
        skipped,
      });
    } catch (error) {
      errors.push(error);
      this._emit("skill.nexus.discovery.failed", { error: error.message });
    }

    return { registered, skipped, errors };
  }

  /**
   * Full discovery: local filesystem + Nexus (local first)
   * @param {Object} [options]
   * @param {string[]} [options.paths] - 额外本地路径
   * @param {boolean} [options.includeNexus=true] - 是否包含 Nexus Skills
   * @returns {Promise<{ local: number, nexus: number, errors: Error[] }>}
   */
  async discoverAll({ paths, includeNexus = true } = {}) {
    const errors = [];
    let localCount = 0;
    let nexusCount = 0;

    // 1. Local filesystem first
    const localResult = await this.discoverAndRegister({ paths });
    localCount = localResult.registered;
    errors.push(...localResult.errors);

    // 2. Nexus (if available and enabled)
    if (includeNexus && this.nexusProvider) {
      const available = await this.checkNexusAvailable();
      if (available) {
        const nexusResult = await this.discoverFromNexus({ skipDuplicates: true });
        nexusCount = nexusResult.registered;
        errors.push(...nexusResult.errors);
      }
    }

    this._emit("skill.discovery.all.complete", {
      local: localCount,
      nexus: nexusCount,
      total: localCount + nexusCount,
    });

    return { local: localCount, nexus: nexusCount, errors };
  }

  /**
   * Execute tool via Nexus Gateway
   * @param {string} toolId
   * @param {Object} params
   * @returns {Promise<any>}
   */
  async executeViaNexus(toolId, params) {
    if (!this.nexusProvider) {
      throw new Error("No Nexus provider configured");
    }
    if (!this.mcpNexusEnabled) {
      throw new Error("Nexus not available");
    }
    return this.nexusProvider.executeTool(toolId, params);
  }
}

export default SkillLoader;
