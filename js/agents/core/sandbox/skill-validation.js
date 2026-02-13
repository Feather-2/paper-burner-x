/**
 * Skill Validation - 参数验证与安全检查
 */

import { SandboxPreset, ResourceLimits } from './constants.js';
import {
  ALLOWED_CAPABILITIES,
  isAllowlistedSkill,
  normalizeCapabilityList,
  normalizeFallbackAllowlist,
} from './skill-executor-helpers.js';

/**
 * 默认信任检查器
 * 只信任 system scope 的 Skills
 * @param {Object} skill
 * @returns {boolean}
 */
export function defaultTrustChecker(skill) {
  const scope = skill?.metadata?.scope;
  return scope === 'system';
}

/**
 * fallback eval 仅允许可信代码或显式 allowlist
 * @param {Object} skill
 * @param {Object} [context]
 * @param {Function} trustChecker
 * @param {Set<string>} fallbackAllowlist
 * @param {Object} logger
 * @returns {boolean}
 */
export function isFallbackAllowed(skill, context, trustChecker, fallbackAllowlist, logger) {
  if (trustChecker(skill)) return true;
  if (context?.trusted === true) return true;

  const allowlist = normalizeFallbackAllowlist(context?.fallbackAllowlist) || fallbackAllowlist;
  if (allowlist) {
    // 禁止使用通配符放开 fallback eval（例如 '*' / '**'）。
    if (allowlist.has('*') || allowlist.has('**')) {
      logger.warn('Fallback allowlist wildcard is forbidden', {
        skill: skill?.metadata?.name,
      });
      return false;
    }
    return isAllowlistedSkill(allowlist, skill);
  }

  // No explicit allowlist: do not allow fallback eval for untrusted skills.
  return false;
}

/**
 * 确定 Skill 的能力级别
 * @param {Object} skill
 * @param {Object} [context]
 * @param {Function} trustChecker
 * @param {Object} logger
 * @returns {string[]}
 */
export function determineCapabilities(skill, context, trustChecker, logger) {
  const isTrusted = trustChecker(skill);

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
      logger.warn('[SkillExecutor] Unknown capability declared by skill', {
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
      logger.warn('[SkillExecutor] Unknown capability approval ignored', {
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
 * @param {Object} skill
 * @returns {Object}
 */
export function determineLimits(skill) {
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
