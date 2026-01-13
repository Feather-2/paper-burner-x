import { isPlainObject, toNonEmptyString } from "../../shared/utils/value-utils.js";

/**
 * Hook 实现类型 - 定义钩子如何执行
 */
export const HookType = Object.freeze({
  COMMAND: "command",
  PROMPT: "prompt",
  AGENT: "agent",
});

/**
 * Hook 事件名常量 - 定义钩子触发时机
 */
export const HookEvent = Object.freeze({
  // Agent 级别 (每次 execute 只执行一次)
  PRE_AGENT: "PreAgent",
  POST_AGENT: "PostAgent",
  // LLM 级别 (每次 LLM 调用)
  PRE_LLM_CALL: "PreLLMCall",
  POST_LLM_CALL: "PostLLMCall",
  // Tool 级别 (每次工具调用)
  PRE_TOOL_USE: "PreToolUse",
  POST_TOOL_USE: "PostToolUse",
});

/** @type {Set<string>} */
const VALID_HOOK_TYPES = new Set(Object.values(HookType));

/**
 * @typedef {object} HookDefinition
 * @property {string} type - HookType
 * @property {boolean=} blocking - Whether the hook can block execution (default true)
 * @property {string | string[]=} tools - Tool name wildcard(s) to match; omitted => match all
 * @property {string=} prompt - Prompt template (prompt/agent hooks)
 * @property {string=} usage - ModelRouter usage (prompt hooks)
 * @property {string=} agentType - Subagent type (agent hooks)
 * @property {string=} modelTier - fast/normal/advanced (agent hooks)
 */

function normalizeToolPatterns(input) {
  if (input === null || input === undefined) return null;
  const list = Array.isArray(input) ? input : [input];
  const out = [];
  const seen = new Set();
  for (const v of list) {
    const s = toNonEmptyString(v);
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out.length ? out : null;
}

// Two-pointer wildcard matching (safe, avoids RegExp backtracking).
function matchWildcard(pattern, value) {
  const p = toNonEmptyString(pattern);
  const v = toNonEmptyString(value);
  if (!p) return false;
  if (!p.includes("*")) return p === v;

  let pi = 0, vi = 0;
  let starIdx = -1, matchIdx = -1;

  while (vi < v.length) {
    if (pi < p.length && p[pi] !== "*" && p[pi] === v[vi]) {
      pi++;
      vi++;
    } else if (pi < p.length && p[pi] === "*") {
      starIdx = pi;
      matchIdx = vi;
      pi++;
    } else if (starIdx !== -1) {
      pi = starIdx + 1;
      matchIdx++;
      vi = matchIdx;
    } else {
      return false;
    }
  }

  while (pi < p.length && p[pi] === "*") pi++;
  return pi === p.length;
}

function matchesTool(def, toolName) {
  const patterns = normalizeToolPatterns(def?.tools ?? def?.tool ?? def?.toolPattern ?? def?.toolPatterns);
  if (!patterns) return true;
  for (const p of patterns) {
    if (matchWildcard(p, toolName)) return true;
  }
  return false;
}

function normalizeHookDefinition(def) {
  if (!isPlainObject(def)) throw new TypeError("HookDefinition must be an object");
  const type = toNonEmptyString(def.type)?.toLowerCase();
  if (!type || !VALID_HOOK_TYPES.has(type)) {
    throw new TypeError(`HookDefinition.type must be one of: ${Array.from(VALID_HOOK_TYPES).join(", ")}`);
  }

  const blocking = def.blocking !== false;
  const tools = normalizeToolPatterns(def.tools ?? def.tool ?? def.toolPattern ?? def.toolPatterns);

  const normalized = { ...def, type, blocking };
  if (tools) normalized.tools = tools;

  if (type === HookType.PROMPT) {
    const prompt = toNonEmptyString(def.prompt);
    if (!prompt) throw new TypeError("HookDefinition.prompt is required for type=prompt");
    normalized.prompt = prompt;
    const usage = toNonEmptyString(def.usage ?? def.model);
    if (usage) normalized.usage = usage;
  }

  if (type === HookType.AGENT) {
    const prompt = toNonEmptyString(def.prompt);
    if (prompt) normalized.prompt = prompt;
    const agentType = toNonEmptyString(def.agentType ?? def.subagent_type ?? def.subagentType);
    if (!agentType) throw new TypeError("HookDefinition.agentType is required for type=agent");
    normalized.agentType = agentType;
    const modelTier = toNonEmptyString(def.modelTier ?? def.model_tier);
    if (modelTier) normalized.modelTier = modelTier;
  }

  return normalized;
}

export class HookRegistry {
  constructor() {
    /** @type {Map<string, HookDefinition[]>} */
    this._hooksByEvent = new Map();
  }

  /**
   * @param {string} eventName
   * @param {HookDefinition} def
   * @returns {HookDefinition}
   */
  register(eventName, def) {
    const evt = toNonEmptyString(eventName);
    if (!evt) throw new TypeError("HookRegistry.register(eventName): eventName must be a non-empty string");
    const normalized = normalizeHookDefinition(def);

    const list = this._hooksByEvent.get(evt) || [];
    list.push(normalized);
    this._hooksByEvent.set(evt, list);
    return normalized;
  }

  /**
   * @param {string} eventName
   * @returns {HookDefinition[]}
   */
  list(eventName) {
    const evt = toNonEmptyString(eventName);
    if (!evt) return [];
    return (this._hooksByEvent.get(evt) || []).slice();
  }

  /**
   * @param {string | null | undefined} [eventName]
   * @returns {void}
   */
  clear(eventName) {
    const evt = toNonEmptyString(eventName);
    if (!evt) {
      this._hooksByEvent.clear();
      return;
    }
    this._hooksByEvent.delete(evt);
  }

  /**
   * @param {string} eventName
   * @param {string} toolName
   * @returns {HookDefinition[]}
   */
  match(eventName, toolName) {
    const hooks = this.list(eventName);
    const tool = toNonEmptyString(toolName) || "";
    return hooks.filter((h) => matchesTool(h, tool));
  }
}

export default HookRegistry;

