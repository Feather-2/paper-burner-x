/**
 * Skills Manager - 管理 Skills 的加载和缓存
 *
 */

import { loadSkills } from "./loader.js";
import { buildSkillInjections, formatSkillInjections } from "./injection.js";

/**
 * Skills 管理器
 *
 * 功能：
 * - 按 CWD 缓存 Skills
 * - 支持强制重新加载
 * - 提供 Skill 注入构建
 */
export class SkillsManager {
  constructor(options = {}) {
    this.homeDir = options.homeDir || process.env.HOME || process.env.USERPROFILE;
    this.cacheByDir = new Map();
    this.remoteProvider = options.remoteProvider || null; // NexusSkillProvider
  }

  /**
   * 获取指定目录的 Skills
   *
   * @param {string} cwd - 当前工作目录
   * @param {boolean} [forceReload=false] - 强制重新加载
   * @returns {Promise<SkillLoadOutcome>}
   */
  async getSkillsForCwd(cwd, forceReload = false) {
    if (!forceReload && this.cacheByDir.has(cwd)) {
      return this.cacheByDir.get(cwd);
    }

    const outcome = await loadSkills({
      cwd,
      homeDir: this.homeDir,
    });

    // 如果有远程 Provider，合并远程 Skills
    if (this.remoteProvider) {
      try {
        const remoteSkills = await this.remoteProvider.listSkills();
        for (const remote of remoteSkills) {
          // 远程 Skills 优先级最低，不覆盖本地
          const exists = outcome.skills.some(s => s.metadata.name === remote.name);
          if (!exists) {
            outcome.skills.push({
              metadata: {
                name: remote.name,
                description: remote.description,
                path: `remote:${remote.name}`,
                scope: "remote",
                keywords: remote.keywords || [],
                priority: remote.priority || 200,
              },
              body: null, // 延迟加载
            });
          }
        }
      } catch (err) {
        console.warn(`[SkillsManager] Failed to load remote skills: ${err.message}`);
      }
    }

    this.cacheByDir.set(cwd, outcome);
    return outcome;
  }

  /**
   * 构建 Skill 注入
   *
   * @param {string} input - 用户输入
   * @param {string} cwd - 当前工作目录
   * @param {Object} options
   * @returns {Promise<SkillInjections>}
   */
  async buildInjections(input, cwd, options = {}) {
    const outcome = await this.getSkillsForCwd(cwd);
    return buildSkillInjections(input, outcome, options);
  }

  /**
   * 获取格式化的 Skill 注入 prompt
   */
  async getInjectionPrompt(input, cwd, options = {}) {
    const injections = await this.buildInjections(input, cwd, options);
    return formatSkillInjections(injections);
  }

  /**
   * 清除缓存
   */
  clearCache(cwd = null) {
    if (cwd) {
      this.cacheByDir.delete(cwd);
    } else {
      this.cacheByDir.clear();
    }
  }

  /**
   * 获取所有已加载的 Skills 元数据
   */
  async getAllSkillMetadata(cwd) {
    const outcome = await this.getSkillsForCwd(cwd);
    return outcome.skills.map(s => s.metadata);
  }
}

// 全局单例
let _globalManager = null;

/**
 * 获取全局 SkillsManager 实例
 */
export function getGlobalSkillsManager(options = {}) {
  if (!_globalManager) {
    _globalManager = new SkillsManager(options);
  }
  return _globalManager;
}

export default SkillsManager;
