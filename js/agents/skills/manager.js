/**
 * Skills Manager - 管理 Skills 的加载和缓存
 *
 */

import { loadSkills } from "./loader.js";
import { renderSkillsList } from "./render.js";

/**
 * @typedef {import("./model.js").SkillMetadata} SkillMetadata
 * @typedef {{ metadata: SkillMetadata, body: (string | null), supportFiles?: Record<string, string> }} SkillContent
 * @typedef {{ skills: SkillContent[], errors: Array<{ path: string, message: string }> }} SkillLoadOutcome
 */

/**
 * Skills 管理器
 *
 * 功能：
 * - 按 CWD 缓存 Skills
 * - 支持强制重新加载
 * - 提供 Skills Catalog（元数据）
 */
export class SkillsManager {
  constructor(options = {}) {
    const nodeProcess = /** @type {any} */ (globalThis).process;
    const envHome =
      nodeProcess?.env
        ? (nodeProcess.env.HOME || nodeProcess.env.USERPROFILE)
        : null;

    this.homeDir = options.homeDir || envHome || null;
    this.manifestUrl = typeof options.manifestUrl === "string" && options.manifestUrl.trim()
      ? options.manifestUrl.trim()
      : null;
    this.cacheByDir = new Map();
    this.remoteProvider = options.remoteProvider || null; // NexusSkillProvider
    this.cacheTtlMs = Number.isFinite(Number(options.cacheTtlMs)) ? Math.max(0, Math.floor(Number(options.cacheTtlMs))) : 5 * 60_000;
    this.cacheMaxEntries = Number.isFinite(Number(options.cacheMaxEntries)) ? Math.max(1, Math.floor(Number(options.cacheMaxEntries))) : 32;
  }

  /**
   * 获取指定目录的 Skills
   *
   * @param {string} cwd - 当前工作目录
   * @param {boolean} [forceReload=false] - 强制重新加载
   * @returns {Promise<SkillLoadOutcome>}
   */
  async getSkillsForCwd(cwd, forceReload = false) {
    const cacheKey = typeof cwd === "string" && cwd ? cwd : "__default__";
    const cached = this.cacheByDir.get(cacheKey);
    const now = Date.now();
    if (!forceReload && cached && typeof cached === "object") {
      const ts = typeof cached.ts === "number" ? cached.ts : 0;
      if (!this.cacheTtlMs || now - ts < this.cacheTtlMs) {
        return cached.outcome;
      }
    }

    const outcome = await loadSkills({
      cwd,
      homeDir: this.homeDir,
      ...(this.manifestUrl ? { manifestUrl: this.manifestUrl } : {}),
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
        outcome.errors.push({
          path: "remote://",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    this.cacheByDir.set(cacheKey, { outcome, ts: now });
    // Best-effort LRU eviction (Map insertion order).
    while (this.cacheByDir.size > this.cacheMaxEntries) {
      const oldest = this.cacheByDir.keys().next().value;
      this.cacheByDir.delete(oldest);
    }
    return outcome;
  }

  /**
   * 获取 Skills Catalog（仅元数据，适合 Browser 端保持 prompt cache）
   */
  async getCatalogPrompt(cwd, { header = true } = {}) {
    const outcome = await this.getSkillsForCwd(cwd);
    const list = renderSkillsList(outcome.skills);
    if (!list) return "";
    if (!header) return list;
    return `## Skills Catalog\n\n${list}`;
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

export default SkillsManager;
