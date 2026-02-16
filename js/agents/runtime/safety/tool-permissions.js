/**
 * Tool Permissions - 工具权限管理 API
 *
 * 提供高层级的工具白名单/黑名单 API，封装底层 tool-restrictions 逻辑。
 * 支持预定义权限级别和自定义配置。
 */

import { normalizeToolRestrictions, evaluateToolRestrictions } from './tool-restrictions.js';
import { toNonEmptyString, isPlainObject } from '../../shared/index.js';

/**
 * @typedef {'readonly' | 'standard' | 'elevated' | 'custom'} PermissionLevel
 *
 * @typedef {import('./tool-restrictions.js').ToolRestrictions} ToolRestrictions
 *
 * @typedef {object} ToolPermissionsConfig
 * @property {PermissionLevel} [level] - 权限级别
 * @property {ToolRestrictions} [restrictions] - 自定义限制
 * @property {boolean} [strict] - 严格模式 (未知工具默认拒绝)
 */

/**
 * 权限级别枚举
 */
export const PermissionLevel = /** @type {const} */ ({
  READONLY: 'readonly',
  STANDARD: 'standard',
  ELEVATED: 'elevated',
  CUSTOM: 'custom',
});

/**
 * 只读模式：禁止写入操作
 */
const READONLY_BLOCKED_TOOLS = [
  'write',
  'edit',
  'multiedit',
  'multi_edit',
  'write_file',
  'apply_patch',
  'delete_file',
  'remove_file',
  'create_file',
  'move_file',
  'rename_file',
  'notebookedit',
];

const READONLY_ALLOWED_BASH = [
  'ls',
  'cat',
  'head',
  'tail',
  'grep',
  'pwd',
  'git log',
  'git status',
  'git diff',
  'git show',
  'git branch',
];

/**
 * 标准模式：允许大部分操作，禁止危险命令
 */
const STANDARD_BLOCKED_BASH = [
  'rm -rf /',
  'rm -rf /*',
  'dd if=/dev/zero',
  'mkfs',
  'format',
  ':(){:|:&};:',
  'chmod -R 777 /',
  'chown -R',
  'sudo rm',
  '> /dev/sda',
  'curl * | bash',
  'wget * | bash',
];

/**
 * 提升模式：允许更多操作，仅禁止极端危险命令
 */
const ELEVATED_BLOCKED_BASH = [
  'rm -rf /',
  'dd if=/dev/zero of=/dev/sda',
  'mkfs.*',
  ':(){:|:&};:',
];

/**
 * 获取预定义权限级别的限制配置
 *
 * @param {PermissionLevel | string} level
 * @returns {ToolRestrictions | null}
 */
export function getPresetRestrictions(level) {
  const normalized = toNonEmptyString(level)?.toLowerCase() || 'standard';

  switch (normalized) {
    case 'readonly':
    case 'read-only':
      return {
        blockedTools: READONLY_BLOCKED_TOOLS,
        bash: {
          allowedCommands: READONLY_ALLOWED_BASH,
          toolNames: ['bash', 'shell', 'exec'],
        },
      };

    case 'standard':
    case 'default':
      return {
        bash: {
          blockedCommands: STANDARD_BLOCKED_BASH,
          toolNames: ['bash', 'shell', 'exec'],
        },
      };

    case 'elevated':
    case 'admin':
      return {
        bash: {
          blockedCommands: ELEVATED_BLOCKED_BASH,
          toolNames: ['bash', 'shell', 'exec'],
        },
      };

    case 'custom':
    case 'none':
      return null;

    default:
      return {
        bash: {
          blockedCommands: STANDARD_BLOCKED_BASH,
          toolNames: ['bash', 'shell', 'exec'],
        },
      };
  }
}

/**
 * 合并两个限制配置
 *
 * @param {ToolRestrictions | null | undefined} base
 * @param {ToolRestrictions | null | undefined} override
 * @returns {ToolRestrictions | null}
 */
export function mergeRestrictions(base, override) {
  const left = normalizeToolRestrictions(base) || {};
  const right = normalizeToolRestrictions(override) || {};

  const allowedTools = [...(left.allowedTools || []), ...(right.allowedTools || [])];
  const blockedTools = [...(left.blockedTools || []), ...(right.blockedTools || [])];

  const leftBash = left.bash || {};
  const rightBash = right.bash || {};

  // Override 优先：如果 right 有 allowedCommands 则替换，否则合并
  const bashAllowed = rightBash.allowedCommands?.length
    ? rightBash.allowedCommands
    : leftBash.allowedCommands || [];
  const bashBlocked = [...(leftBash.blockedCommands || []), ...(rightBash.blockedCommands || [])];
  const bashToolNames = [...new Set([...(leftBash.toolNames || []), ...(rightBash.toolNames || [])])];

  const merged = {
    ...(allowedTools.length ? { allowedTools } : {}),
    ...(blockedTools.length ? { blockedTools } : {}),
    ...(bashAllowed.length || bashBlocked.length || bashToolNames.length
      ? {
          bash: {
            ...(bashAllowed.length ? { allowedCommands: bashAllowed } : {}),
            ...(bashBlocked.length ? { blockedCommands: bashBlocked } : {}),
            toolNames: bashToolNames.length ? bashToolNames : ['bash'],
          },
        }
      : {}),
  };

  return Object.keys(merged).length > 0 ? merged : null;
}

/**
 * 工具权限管理器
 */
export class ToolPermissions {
  /**
   * @param {ToolPermissionsConfig} [config]
   */
  constructor(config = {}) {
    const cfg = isPlainObject(config) ? config : {};

    /** @type {PermissionLevel} */
    this._level = this._normalizeLevel(cfg.level);

    /** @type {ToolRestrictions | null} */
    this._baseRestrictions = getPresetRestrictions(this._level);

    /** @type {ToolRestrictions | null} */
    this._customRestrictions = normalizeToolRestrictions(cfg.restrictions);

    /** @type {boolean} */
    this._strict = cfg.strict === true;

    /** @type {{ evaluate: (req: any) => any } | null} */
    this._policyEngine = cfg.policyEngine || null;

    /** @type {ToolRestrictions | null} */
    this._mergedRestrictions = mergeRestrictions(this._baseRestrictions, this._customRestrictions);
  }

  /**
   * Attach a PolicyEngine (AUDIT C2: single evaluation pipeline).
   * @param {{ evaluate: (req: any) => any }} engine
   * @returns {ToolPermissions}
   */
  setPolicyEngine(engine) {
    this._policyEngine = engine || null;
    return this;
  }

  /**
   * @private
   * @param {PermissionLevel | string | null | undefined} level
   * @returns {PermissionLevel}
   */
  _normalizeLevel(level) {
    const s = toNonEmptyString(level)?.toLowerCase();
    if (s === 'readonly' || s === 'read-only') return 'readonly';
    if (s === 'elevated' || s === 'admin') return 'elevated';
    if (s === 'custom' || s === 'none') return 'custom';
    return 'standard';
  }

  /**
   * 获取当前权限级别
   * @returns {PermissionLevel}
   */
  getLevel() {
    return this._level;
  }

  /**
   * 获取合并后的限制配置
   * @returns {ToolRestrictions | null}
   */
  getRestrictions() {
    return this._mergedRestrictions;
  }

  /**
   * 检查工具调用是否允许
   *
   * @param {string} toolName - 工具名称
   * @param {string | string[] | null} [command] - Bash 命令 (可选)
   * @returns {{ allowed: boolean, reason?: string, policy?: Record<string, unknown> }}
   */
  check(toolName, command) {
    // AUDIT C2: PolicyEngine takes priority when available
    if (this._policyEngine) {
      try {
        const decision = this._policyEngine.evaluate({
          type: 'tool:use',
          tool: toolName,
          ...(command ? { resource: command } : {}),
        });
        if (decision && !decision.requiresApproval) {
          if (decision.allowed === false) return { allowed: false, reason: decision.reason || 'policy_deny', policy: decision };
          if (decision.allowed === true) return { allowed: true, reason: 'policy_allow', policy: decision };
        }
      } catch { /* PolicyEngine error: fall through to local restrictions */ }
    }

    if (!this._mergedRestrictions && !this._strict) {
      return { allowed: true };
    }

    const result = evaluateToolRestrictions({
      toolName,
      command,
      restrictions: this._mergedRestrictions,
    });

    // 严格模式：如果没有明确允许，则拒绝未知工具
    if (this._strict && result.allowed && this._mergedRestrictions?.allowedTools?.length) {
      const allowed = this._mergedRestrictions.allowedTools;
      const name = toNonEmptyString(toolName)?.toLowerCase() || '';
      const isExplicitlyAllowed = allowed.some((pattern) => {
        if (pattern instanceof RegExp) return pattern.test(name);
        const p = toNonEmptyString(pattern)?.toLowerCase() || '';
        return p === name || (p.includes('*') && this._wildcardMatch(p, name));
      });

      if (!isExplicitlyAllowed) {
        return {
          allowed: false,
          reason: 'tool_not_in_allowlist',
          policy: { type: 'strict', tool: name },
        };
      }
    }

    return result;
  }

  /**
   * @private
   * @param {string} pattern
   * @param {string} text
   * @returns {boolean}
   */
  _wildcardMatch(pattern, text) {
    let pi = 0;
    let ti = 0;
    let starIdx = -1;
    let matchIdx = -1;

    while (ti < text.length) {
      if (pi < pattern.length && (pattern[pi] === text[ti] || pattern[pi] === '?')) {
        pi++;
        ti++;
        continue;
      }
      if (pi < pattern.length && pattern[pi] === '*') {
        starIdx = pi;
        matchIdx = ti;
        pi++;
        continue;
      }
      if (starIdx !== -1) {
        pi = starIdx + 1;
        matchIdx++;
        ti = matchIdx;
        continue;
      }
      return false;
    }

    while (pi < pattern.length && pattern[pi] === '*') pi++;
    return pi === pattern.length;
  }

  /**
   * 添加工具到白名单
   *
   * @param {string | string[]} tools
   * @returns {ToolPermissions}
   */
  allow(tools) {
    const list = Array.isArray(tools) ? tools : [tools];
    const current = this._mergedRestrictions || {};
    const allowedTools = [...(current.allowedTools || []), ...list.filter(Boolean)];

    this._mergedRestrictions = { ...current, allowedTools };
    return this;
  }

  /**
   * 添加工具到黑名单
   *
   * @param {string | string[]} tools
   * @returns {ToolPermissions}
   */
  block(tools) {
    const list = Array.isArray(tools) ? tools : [tools];
    const current = this._mergedRestrictions || {};
    const blockedTools = [...(current.blockedTools || []), ...list.filter(Boolean)];

    this._mergedRestrictions = { ...current, blockedTools };
    return this;
  }

  /**
   * 允许特定 Bash 命令
   *
   * @param {string | string[]} commands
   * @returns {ToolPermissions}
   */
  allowBash(commands) {
    const list = Array.isArray(commands) ? commands : [commands];
    const current = this._mergedRestrictions || {};
    const bash = current.bash || {};
    const allowedCommands = [...(bash.allowedCommands || []), ...list.filter(Boolean)];

    this._mergedRestrictions = {
      ...current,
      bash: { ...bash, allowedCommands, toolNames: bash.toolNames || ['bash'] },
    };
    return this;
  }

  /**
   * 阻止特定 Bash 命令
   *
   * @param {string | string[]} commands
   * @returns {ToolPermissions}
   */
  blockBash(commands) {
    const list = Array.isArray(commands) ? commands : [commands];
    const current = this._mergedRestrictions || {};
    const bash = current.bash || {};
    const blockedCommands = [...(bash.blockedCommands || []), ...list.filter(Boolean)];

    this._mergedRestrictions = {
      ...current,
      bash: { ...bash, blockedCommands, toolNames: bash.toolNames || ['bash'] },
    };
    return this;
  }

  /**
   * 创建 ToolRegistry before hook
   *
   * @returns {(ctx: { tool: string, params: Record<string, unknown> | string | null | undefined, context: Record<string, unknown> | null | undefined }) => { skip?: boolean, value?: { ok: boolean, error: string, policy?: Record<string, unknown> } } | null}
   */
  createHook() {
    return ({ tool, params }) => {
      const command = this._extractCommand(params);
      const result = this.check(tool, command);

      if (!result.allowed) {
        return {
          skip: true,
          value: {
            ok: false,
            error: result.reason || 'Permission denied',
            policy: result.policy,
          },
        };
      }

      return null;
    };
  }

  /**
   * @private
   * @param {Record<string, unknown> | string | null | undefined} params
   * @returns {string | null}
   */
  _extractCommand(params) {
    if (typeof params === 'string') return params;
    if (!isPlainObject(params)) return null;
    return toNonEmptyString(params.command) || toNonEmptyString(params.cmd) || null;
  }

  /**
   * 导出配置 (可序列化)
   *
   * @returns {{ level: PermissionLevel, restrictions: ToolRestrictions | null, strict: boolean }}
   */
  toJSON() {
    return {
      level: this._level,
      restrictions: this._mergedRestrictions,
      strict: this._strict,
    };
  }

  /**
   * 从配置创建实例
   *
   * @param {Record<string, unknown> | null | undefined} json
   * @returns {ToolPermissions}
   */
  static fromJSON(json) {
    if (!isPlainObject(json)) return new ToolPermissions();
    return new ToolPermissions({
      level: /** @type {PermissionLevel} */ (json.level),
      restrictions: json.restrictions,
      strict: /** @type {boolean} */ (json.strict),
    });
  }

  /**
   * 创建只读权限
   * @returns {ToolPermissions}
   */
  static readonly() {
    return new ToolPermissions({ level: 'readonly' });
  }

  /**
   * 创建标准权限
   * @returns {ToolPermissions}
   */
  static standard() {
    return new ToolPermissions({ level: 'standard' });
  }

  /**
   * 创建提升权限
   * @returns {ToolPermissions}
   */
  static elevated() {
    return new ToolPermissions({ level: 'elevated' });
  }

  /**
   * 创建自定义权限 (无预设限制)
   * @param {ToolRestrictions} [restrictions]
   * @returns {ToolPermissions}
   */
  static custom(restrictions) {
    return new ToolPermissions({ level: 'custom', restrictions });
  }
}

export default ToolPermissions;
