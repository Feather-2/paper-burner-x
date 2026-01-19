import { parseCompoundCommand } from "./command-classifier.js";
import { toNonEmptyString } from "../../shared/index.js";

/**
 * @typedef {RegExp | string} ToolPattern
 *
 * @typedef {object} BashRestrictions
 * @property {ToolPattern[]} [allowedCommands]
 * @property {ToolPattern[]} [blockedCommands]
 * @property {string[]} [toolNames]
 *
 * @typedef {object} ToolRestrictions
 * @property {ToolPattern[]} [allowedTools]
 * @property {ToolPattern[]} [blockedTools]
 * @property {BashRestrictions} [bash]
 */

function normalizeList(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (typeof raw === "string") {
    return raw
      .split(/[,\n]/)
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeToolName(name) {
  return toNonEmptyString(name)?.toLowerCase() || "";
}

function wildcardMatch(pattern, text) {
  let pi = 0;
  let ti = 0;
  let starIdx = -1;
  let matchIdx = -1;
  const pLen = pattern.length;
  const tLen = text.length;

  while (ti < tLen) {
    if (pi < pLen && (pattern[pi] === text[ti] || pattern[pi] === "?")) {
      pi += 1;
      ti += 1;
      continue;
    }
    if (pi < pLen && pattern[pi] === "*") {
      starIdx = pi;
      matchIdx = ti;
      pi += 1;
      continue;
    }
    if (starIdx !== -1) {
      pi = starIdx + 1;
      matchIdx += 1;
      ti = matchIdx;
      continue;
    }
    return false;
  }

  while (pi < pLen && pattern[pi] === "*") pi += 1;
  return pi === pLen;
}

function matchToolPattern(pattern, toolName) {
  if (!pattern) return false;
  if (pattern instanceof RegExp) return pattern.test(toolName);
  const raw = normalizeToolName(pattern);
  if (!raw) return false;
  const name = normalizeToolName(toolName);
  if (raw.includes("*") || raw.includes("?")) {
    return wildcardMatch(raw, name);
  }
  return raw === name;
}

function matchCommandPattern(pattern, command) {
  if (!pattern) return false;
  if (pattern instanceof RegExp) return pattern.test(command);
  const raw = toNonEmptyString(pattern)?.toLowerCase() || "";
  const cmd = toNonEmptyString(command)?.toLowerCase() || "";
  if (!raw || !cmd) return false;
  if (cmd === raw) return true;
  return cmd.startsWith(`${raw} `);
}

/**
 * @param {ToolRestrictions | null | undefined | false} raw
 * @returns {ToolRestrictions | null}
 */
export function normalizeToolRestrictions(raw) {
  if (!raw || typeof raw !== "object") return null;
  const restrictions = /** @type {ToolRestrictions} */ (raw);

  const allowedTools = normalizeList(restrictions.allowedTools);
  const blockedTools = normalizeList(restrictions.blockedTools);

  const bash = restrictions.bash && typeof restrictions.bash === "object" ? restrictions.bash : null;
  const allowedCommands = normalizeList(bash?.allowedCommands);
  const blockedCommands = normalizeList(bash?.blockedCommands);
  const toolNames = normalizeList(bash?.toolNames).map((v) => normalizeToolName(v)).filter(Boolean);

  const normalized = {
    ...(allowedTools.length ? { allowedTools } : {}),
    ...(blockedTools.length ? { blockedTools } : {}),
    ...(allowedCommands.length || blockedCommands.length || toolNames.length
      ? {
          bash: {
            ...(allowedCommands.length ? { allowedCommands } : {}),
            ...(blockedCommands.length ? { blockedCommands } : {}),
            toolNames: toolNames.length ? toolNames : ["bash"],
          },
        }
      : {}),
  };

  if (!normalized.allowedTools && !normalized.blockedTools && !normalized.bash) return null;
  return normalized;
}

/**
 * @param {{ toolName: string, command?: string | string[] | null, restrictions?: ToolRestrictions | null }} input
 * @returns {{ allowed: boolean, reason?: string, policy?: any }}
 */
export function evaluateToolRestrictions({ toolName, command, restrictions }) {
  const normalized = normalizeToolRestrictions(restrictions);
  if (!normalized) return { allowed: true };

  const name = normalizeToolName(toolName);
  const allow = normalized.allowedTools || [];
  const block = normalized.blockedTools || [];

  if (allow.length > 0 && !allow.some((pattern) => matchToolPattern(pattern, name))) {
    return { allowed: false, reason: "tool_not_allowed", policy: { type: "allowlist", tool: name } };
  }
  if (block.length > 0 && block.some((pattern) => matchToolPattern(pattern, name))) {
    return { allowed: false, reason: "tool_blocked", policy: { type: "blocklist", tool: name } };
  }

  if (normalized.bash && Array.isArray(normalized.bash.toolNames)) {
    const toolNames = normalized.bash.toolNames;
    if (toolNames.includes(name)) {
      const parsed = parseCompoundCommand(command);
      if (!parsed.length) {
        if (normalized.bash.allowedCommands?.length) {
          return { allowed: false, reason: "command_not_allowed", policy: { type: "bash", tool: name } };
        }
        return { allowed: true };
      }

      for (const argv of parsed) {
        const cmd = argv.join(" ");
        if (normalized.bash.blockedCommands?.some((pattern) => matchCommandPattern(pattern, cmd))) {
          return { allowed: false, reason: "command_blocked", policy: { type: "bash", tool: name } };
        }
        if (normalized.bash.allowedCommands?.length) {
          const ok = normalized.bash.allowedCommands.some((pattern) => matchCommandPattern(pattern, cmd));
          if (!ok) {
            return { allowed: false, reason: "command_not_allowed", policy: { type: "bash", tool: name } };
          }
        }
      }
    }
  }

  return { allowed: true };
}

export default {
  normalizeToolRestrictions,
  evaluateToolRestrictions,
};
