/**
 * Skills Sandbox Adapter
 *
 * 为现有的 SkillsManager 提供沙箱执行能力。
 * 可作为 drop-in replacement 替代 js-sandbox-worker。
 */

import { SkillExecutor } from '../core/sandbox/skill-executor.js';

/** @typedef {import("./manager.js").SkillsManager} SkillsManager */
/** @typedef {SkillsManager & Record<string, any>} SkillsManagerWithSandbox */

/**
 * 增强 SkillsManager 的沙箱执行能力
 *
 * @param {SkillsManagerWithSandbox} manager
 * @param {Object} options
 * @param {Object} [options.kernel] - Kernel instance
 * @param {Function} [options.trustChecker] - Trust checker function
 * @param {Object} [options.packageManager] - PackageManager for npm install in sandbox
 * @returns {SkillsManagerWithSandbox} 增强后的 manager
 */
export function enhanceWithSandbox(manager, options = {}) {
  const executor = new SkillExecutor({
    kernel: options.kernel,
    trustChecker: options.trustChecker,
  });

  // Expose packageManager for skill sandbox npm installs
  if (options.packageManager) {
    manager.packageManager = options.packageManager;
  }

  // 添加执行方法
  manager.executeSkill = async function(skillNameOrObj, context = {}) {
    let skill = skillNameOrObj;

    // 如果传入的是名称，先查找 skill
    if (typeof skillNameOrObj === 'string') {
      const outcome = await this.getSkillsForCwd(context.cwd);
      skill = outcome.skills.find(s => s.metadata.name === skillNameOrObj);

      if (!skill) {
        return {
          success: false,
          error: `Skill not found: ${skillNameOrObj}`,
          data: null,
          metrics: {},
        };
      }

      // 如果是远程 skill 且 body 为 null，需要加载
      if (skill.body === null && skill.metadata.scope === 'remote') {
        if (this.remoteProvider?.loadSkillBody) {
          try {
            skill.body = await this.remoteProvider.loadSkillBody(skill.metadata.name);
          } catch (err) {
            return {
              success: false,
              error: `Failed to load remote skill: ${err instanceof Error ? err.message : String(err)}`,
              data: null,
              metrics: {},
            };
          }
        }
      }
    }

    return executor.execute(skill, context);
  };

  // 添加批量执行方法
  manager.executeSkills = async function(skillNames, context = {}) {
    const outcome = await this.getSkillsForCwd(context.cwd);

    const skills = skillNames
      .map(name => outcome.skills.find(s => s.metadata.name === name))
      .filter(Boolean);

    return executor.executeMany(skills, context);
  };

  // 添加获取执行器的方法
  manager.getExecutor = function() {
    return executor;
  };

  // 添加销毁方法
  manager.dispose = function() {
    executor.dispose();
  };

  return manager;
}

/**
 * 创建一个带沙箱的 SkillsManager
 *
 * @param {Object} [options] - Configuration options
 * @param {string} [options.homeDir] - User home directory
 * @param {string} [options.manifestUrl] - Skills manifest URL
 * @param {Object} [options.remoteProvider] - Remote skills provider
 * @param {number} [options.cacheTtlMs] - Cache TTL in milliseconds
 * @param {number} [options.cacheMaxEntries] - Maximum cache entries
 * @param {Object} [options.kernel] - Kernel instance for sandbox
 * @param {Function} [options.trustChecker] - Trust checker function
 * @param {Object} [options.packageManager] - PackageManager for npm install
 * @returns {Promise<SkillsManagerWithSandbox>} Enhanced manager with sandbox execution
 */
export async function createSandboxedSkillsManager(options = {}) {
  const { SkillsManager } = await import('./manager.js');

  const manager = new SkillsManager({
    homeDir: options.homeDir,
    manifestUrl: options.manifestUrl,
    remoteProvider: options.remoteProvider,
    cacheTtlMs: options.cacheTtlMs,
    cacheMaxEntries: options.cacheMaxEntries,
  });

  return enhanceWithSandbox(manager, {
    kernel: options.kernel,
    trustChecker: options.trustChecker,
    packageManager: options.packageManager,
  });
}

/**
 * Heuristic risk analysis — NOT a security boundary.
 * Regex patterns can be trivially bypassed (bracket notation, string concatenation, etc.).
 * The actual security boundary is the WASM sandbox (SkillExecutor).
 * This function only influences the capability set granted to the sandbox.
 *
 * @param {string} skillBody - Skill body content to analyze
 * @returns {{ overallRisk: 'safe' | 'low' | 'medium' | 'high' | 'critical', risks: Array<{ risk: string, desc: string, pattern: string }>, safe: boolean }}
 */
export function analyzeSkillRisk(skillBody) {
  const risks = [];

  // 检查危险模式（正则启发式，非 AST，存在少量误报/漏报）
  const dangerousPatterns = [
    { pattern: /eval\s*\(/, risk: 'high', desc: 'Uses eval()' },
    { pattern: /new\s+Function\s*\(/, risk: 'high', desc: 'Creates dynamic functions' },
    { pattern: /(?:^|[=(:,;\[\{]\s*|(?:await|return)\s+)import\s*\(/m, risk: 'medium', desc: 'Uses dynamic import (heuristic, non-AST)' },
    { pattern: /require\s*\(/, risk: 'medium', desc: 'Uses require()' },
    { pattern: /process\./, risk: 'high', desc: 'Accesses process object' },
    { pattern: /child_process/, risk: 'critical', desc: 'Uses child_process' },
    { pattern: /fs\.(read|write|unlink|rmdir)/, risk: 'high', desc: 'File system access' },
    { pattern: /fetch\s*\(/, risk: 'low', desc: 'Makes HTTP requests' },
    { pattern: /XMLHttpRequest/, risk: 'low', desc: 'Uses XMLHttpRequest' },
    { pattern: /WebSocket/, risk: 'medium', desc: 'Uses WebSocket' },
    { pattern: /__proto__|prototype\s*=/, risk: 'high', desc: 'Prototype manipulation' },
    { pattern: /constructor\s*\[/, risk: 'high', desc: 'Constructor access' },
  ];

  for (const { pattern, risk, desc } of dangerousPatterns) {
    if (pattern.test(skillBody)) {
      risks.push({ risk, desc, pattern: pattern.source });
    }
  }

  // 计算总体风险等级
  const riskLevels = { critical: 4, high: 3, medium: 2, low: 1 };
  const maxRisk = risks.reduce((max, r) => Math.max(max, riskLevels[r.risk] || 0), 0);

  /** @type {'safe' | 'low' | 'medium' | 'high' | 'critical'} */
  let overallRisk = 'safe';
  if (maxRisk >= 4) overallRisk = 'critical';
  else if (maxRisk >= 3) overallRisk = 'high';
  else if (maxRisk >= 2) overallRisk = 'medium';
  else if (maxRisk >= 1) overallRisk = 'low';

  return {
    overallRisk,
    risks,
    safe: maxRisk === 0,
  };
}

export default {
  enhanceWithSandbox,
  createSandboxedSkillsManager,
  analyzeSkillRisk,
};
