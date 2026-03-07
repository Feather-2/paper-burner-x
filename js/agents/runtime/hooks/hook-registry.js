import { isPlainObject, toNonEmptyString } from "../../shared/index.js";

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
  // Compression 级别 (每次上下文压缩)
  PRE_COMPRESSION: "PreCompression",
  POST_COMPRESSION: "PostCompression",
});

/** @type {Set<string>} */
const VALID_HOOK_TYPES = new Set(Object.values(HookType));
const VALID_SCOPES = new Set(["run", "session", "permanent"]);
const VALID_GATE_TYPES = new Set(["llm", "user", "agent"]);
const VALID_AUTHORITIES = new Set(["system", "config", "agent"]);

/**
 * @typedef {object} HookLifecycle
 * @property {number=} maxExecutions - Max times this hook can fire (default Infinity)
 * @property {'run'|'session'|'permanent'=} scope - Lifecycle scope (default 'run')
 * @property {number=} cooldown - Min ms between executions (default 0)
 */

/**
 * @typedef {object} HookGate
 * @property {'llm'|'user'|'agent'} type - Soft constraint evaluator
 * @property {string=} prompt - Prompt for llm/agent gate
 * @property {'allow'|'deny'=} fallback - Default on timeout (default 'deny')
 */

/**
 * @typedef {object} HookDefinition
 * @property {string} type - HookType (command/prompt/agent)
 * @property {boolean=} blocking - Whether the hook can block execution (default true)
 * @property {string | string[]=} tools - Tool name wildcard(s) to match; omitted => match all
 * @property {string=} tool - Alias for tools (single tool name)
 * @property {string=} toolPattern - Alias for tools (single pattern)
 * @property {string | string[]=} toolPatterns - Alias for tools (multiple patterns)
 * @property {((ctx: object) => Promise<{skip?: boolean, reason?: string, value?: any} | null | void>) =} handler - Custom handler function (command hooks)
 * @property {string=} prompt - Prompt template (prompt/agent hooks)
 * @property {string=} usage - ModelRouter usage (prompt hooks)
 * @property {string=} agentType - Subagent type (agent hooks)
 * @property {string=} modelTier - fast/normal/advanced (agent hooks)
 * @property {Record<string, any>=} when - StateBus predicates (AND logic)
 * @property {HookLifecycle=} lifecycle - Execution history constraints
 * @property {HookGate=} gate - Soft constraint gate (async)
 * @property {boolean=} protected - If true, Agent cannot disable/remove this hook
 * @property {'system'|'config'|'agent'=} authority - Who can control this hook (default 'agent')
 * @property {number=} _execCount - Internal execution counter
 * @property {number=} _lastExecTime - Internal last execution timestamp
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

  // --- When: State predicates ---
  if (def.when != null) {
    if (!isPlainObject(def.when)) throw new TypeError("HookDefinition.when must be a plain object");
    normalized.when = def.when;
  }

  // --- When: Lifecycle ---
  if (def.lifecycle != null) {
    if (!isPlainObject(def.lifecycle)) throw new TypeError("HookDefinition.lifecycle must be a plain object");
    const lc = {};
    if (def.lifecycle.maxExecutions != null) {
      const n = Number(def.lifecycle.maxExecutions);
      if (!Number.isFinite(n) || n < 1) throw new TypeError("lifecycle.maxExecutions must be a positive integer");
      lc.maxExecutions = Math.floor(n);
    }
    if (def.lifecycle.scope != null) {
      const s = toNonEmptyString(def.lifecycle.scope);
      if (!s || !VALID_SCOPES.has(s)) throw new TypeError(`lifecycle.scope must be one of: ${[...VALID_SCOPES].join(", ")}`);
      lc.scope = s;
    }
    if (def.lifecycle.cooldown != null) {
      const cd = Number(def.lifecycle.cooldown);
      if (!Number.isFinite(cd) || cd < 0) throw new TypeError("lifecycle.cooldown must be a non-negative number");
      lc.cooldown = cd;
    }
    normalized.lifecycle = lc;
    // Runtime state for lifecycle tracking
    normalized._execCount = 0;
    normalized._lastExecTime = 0;
  }

  // --- How: Soft gate ---
  if (def.gate != null) {
    if (!isPlainObject(def.gate)) throw new TypeError("HookDefinition.gate must be a plain object");
    const gt = toNonEmptyString(def.gate.type);
    if (!gt || !VALID_GATE_TYPES.has(gt)) throw new TypeError(`gate.type must be one of: ${[...VALID_GATE_TYPES].join(", ")}`);
    normalized.gate = { type: gt };
    const gp = toNonEmptyString(def.gate.prompt);
    if (gp) normalized.gate.prompt = gp;
    const fb = toNonEmptyString(def.gate.fallback) || "deny";
    normalized.gate.fallback = fb === "allow" ? "allow" : "deny";
  }

  // --- Who: Mutability ---
  normalized.protected = def.protected === true;
  if (def.authority != null) {
    const auth = toNonEmptyString(def.authority);
    if (!auth || !VALID_AUTHORITIES.has(auth)) throw new TypeError(`authority must be one of: ${[...VALID_AUTHORITIES].join(", ")}`);
    normalized.authority = auth;
  } else {
    normalized.authority = "agent";
  }

  return normalized;
}

export class HookRegistry {
  constructor() {
    /** @type {Map<string, HookDefinition[]>} */
    this._hooksByEvent = new Map();
    /** @type {Set<HookDefinition>} disabled hooks (agent-level only) */
    this._disabled = new Set();
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
    return hooks.filter((h) => !this._disabled.has(h) && matchesTool(h, tool));
  }

  /**
   * Disable a hook at runtime. Protected hooks cannot be disabled.
   * @param {HookDefinition} hook
   * @returns {boolean} true if disabled, false if protected
   */
  disable(hook) {
    if (hook?.protected) return false;
    this._disabled.add(hook);
    return true;
  }

  /**
   * Re-enable a previously disabled hook.
   * @param {HookDefinition} hook
   */
  enable(hook) {
    this._disabled.delete(hook);
  }

  /**
   * Reset lifecycle counters for all hooks (e.g. on new run).
   * @param {'run'|'session'=} scope - Only reset hooks with this scope (default: 'run')
   */
  resetLifecycle(scope = "run") {
    for (const hooks of this._hooksByEvent.values()) {
      for (const h of hooks) {
        if (!h.lifecycle) continue;
        const s = h.lifecycle.scope || "run";
        if (s === scope || (scope === "session" && s === "run")) {
          h._execCount = 0;
          h._lastExecTime = 0;
        }
      }
    }
  }
}

// ===== Stage -> HookEvent mapping =====

/**
 * MiddlewareChain Stage value -> HookEvent name mapping.
 * Uses string literals to avoid hooks <-> middleware circular dependency.
 * @type {Readonly<Record<string, string>>}
 */
const STAGE_TO_HOOK_EVENT = Object.freeze({
  beforeAgent: HookEvent.PRE_AGENT,
  afterAgent: HookEvent.POST_AGENT,
  beforeTool: HookEvent.PRE_TOOL_USE,
  afterTool: HookEvent.POST_TOOL_USE,
  beforeModel: HookEvent.PRE_LLM_CALL,
  afterModel: HookEvent.POST_LLM_CALL,
  beforeCompression: HookEvent.PRE_COMPRESSION,
  afterCompression: HookEvent.POST_COMPRESSION,
});

const BEFORE_STAGES = new Set(["beforeAgent", "beforeTool", "beforeModel", "beforeCompression"]);

// ===== Three-dimension evaluation helpers =====

/** Check lifecycle constraints (maxExecutions + cooldown). Returns false if hook should skip. */
function checkLifecycle(hook) {
  const lc = hook.lifecycle;
  if (!lc) return true;
  if (lc.maxExecutions != null && hook._execCount >= lc.maxExecutions) return false;
  if (lc.cooldown > 0 && hook._lastExecTime > 0) {
    if (Date.now() - hook._lastExecTime < lc.cooldown) return false;
  }
  return true;
}

/** Record a lifecycle execution tick. */
function tickLifecycle(hook) {
  if (!hook.lifecycle) return;
  hook._execCount = (hook._execCount || 0) + 1;
  hook._lastExecTime = Date.now();
}

/**
 * Evaluate soft gate constraint (Dim 2: How).
 * Calls ctx.confirm(prompt, gateType) and returns boolean.
 * On error/timeout, falls back to gate.fallback ('allow' | 'deny').
 * @param {HookGate|undefined} gate
 * @param {object} ctx
 * @returns {Promise<boolean>} true = proceed, false = skip
 */
async function evaluateGate(gate, ctx) {
  if (!gate) return true;
  const confirm = ctx?.confirm ?? ctx?.gate;
  if (typeof confirm !== "function") {
    // No confirm provider → use fallback
    return gate.fallback === "allow";
  }
  try {
    const result = await confirm(gate.prompt || "", gate.type);
    return !!result;
  } catch {
    return gate.fallback === "allow";
  }
}

/**
 * Evaluate StateBus predicates against ctx.state (or ctx.stateBus).
 * Supports: exact match, $gt, $gte, $lt, $lte, $ne, $in.
 */
function evaluateStatePredicate(when, ctx) {
  if (!when) return true;
  const state = ctx?.state ?? ctx?.stateBus;
  if (!state) return true; // no state bus → skip predicate (permissive)
  const get = typeof state.get === "function" ? (k) => state.get(k) : (k) => state[k];
  for (const [key, expected] of Object.entries(when)) {
    const actual = get(key);
    if (isPlainObject(expected)) {
      for (const [op, val] of Object.entries(expected)) {
        switch (op) {
          case "$gt":  if (!(actual > val)) return false; break;
          case "$gte": if (!(actual >= val)) return false; break;
          case "$lt":  if (!(actual < val)) return false; break;
          case "$lte": if (!(actual <= val)) return false; break;
          case "$ne":  if (actual === val) return false; break;
          case "$in":  if (!Array.isArray(val) || !val.includes(actual)) return false; break;
          default: break; // unknown op → ignore (permissive)
        }
      }
    } else if (actual !== expected) {
      return false;
    }
  }
  return true;
}

/**
 * Convert a HookRegistry into a MiddlewareChain-compatible middleware function.
 *
 * Maps ctx.phase (or ctx.stage) to the corresponding HookEvent,
 * then executes matching handler-based hooks.
 *
 * before stages: blocking hook handler returning { skip: true } short-circuits (next() not called).
 * after stages: next() runs first, then handlers execute (errors logged, not blocking).
 *
 * Expected ctx fields:
 * - phase / stage: lifecycle stage (Stage value, e.g. 'beforeTool')
 * - toolName: tool name (for tool stages, supports wildcard matching)
 * - eventBus: EventBus instance (for emit diagnostics)
 *
 * @param {HookRegistry} hookRegistry
 * @returns {(ctx: object, next: () => Promise<unknown>) => Promise<unknown>}
 */
export function createHookMiddleware(hookRegistry) {
  if (!(hookRegistry instanceof HookRegistry)) {
    throw new TypeError("createHookMiddleware: argument must be a HookRegistry instance");
  }

  return async (ctx, next) => {
    const stage = toNonEmptyString(ctx?.phase) || toNonEmptyString(ctx?.stage) || "";
    const hookEvent = STAGE_TO_HOOK_EVENT[stage];

    // No matching hook event for this stage, pass through
    if (!hookEvent) return next();

    const toolName = toNonEmptyString(ctx?.toolName) || "";
    const isBefore = BEFORE_STAGES.has(stage);

    // Tool stages filter by tool name, others list all
    const hooks = (stage === "beforeTool" || stage === "afterTool")
      ? hookRegistry.match(hookEvent, toolName)
      : hookRegistry.list(hookEvent);

    if (!hooks.length) return next();

    if (isBefore) {
      for (const hook of hooks) {
        if (typeof hook.handler !== "function") continue;
        // --- Three-dimension evaluation ---
        // Dim 1b: State predicate
        if (!evaluateStatePredicate(hook.when, ctx)) continue;
        // Dim 1c: Lifecycle
        if (!checkLifecycle(hook)) continue;
        // Dim 2: Soft gate (How)
        if (!(await evaluateGate(hook.gate, ctx))) {
          ctx.eventBus?.emit?.("hook:gate_denied", { stage, hookEvent, toolName, gate: hook.gate?.type });
          continue;
        }

        const blocking = hook.blocking !== false;
        try {
          const result = await hook.handler(ctx);
          // Tick lifecycle after successful execution
          tickLifecycle(hook);
          if (result && result.skip && blocking) {
            const reason = toNonEmptyString(result.reason) || "Hook denied";
            ctx.eventBus?.emit?.("hook:denied", { stage, hookEvent, toolName, reason });
            return result.value ?? { ok: false, error: reason };
          }
        } catch (err) {
          ctx.eventBus?.emit?.("hook:error", {
            stage, hookEvent, toolName,
            error: err?.message || String(err),
          });
          if (blocking) throw err;
        }
      }
      return next();
    }

    // after stage: run next() first, then execute handlers
    const result = await next();
    for (const hook of hooks) {
      if (typeof hook.handler !== "function") continue;
      if (!evaluateStatePredicate(hook.when, ctx)) continue;
      if (!checkLifecycle(hook)) continue;
      if (!(await evaluateGate(hook.gate, ctx))) continue;
      try {
        await hook.handler({ ...ctx, result });
        tickLifecycle(hook);
      } catch (err) {
        ctx.eventBus?.emit?.("hook:error", {
          stage, hookEvent, toolName,
          error: err?.message || String(err),
        });
      }
    }
    return result;
  };
}

export default HookRegistry;

// ===== HookBuilder — fluent API =====

/**
 * Fluent builder for hook registration.
 * Usage: hook('PreToolUse').match('bash_*').times(3).do(ctx => { ... })
 */
export class HookBuilder {
  /**
   * @param {string} eventName
   * @param {HookRegistry} registry
   */
  constructor(eventName, registry) {
    this._event = eventName;
    this._registry = registry;
    this._def = { type: "command" };
  }

  /** @param {string|string[]} pattern */
  match(pattern) { this._def.tools = Array.isArray(pattern) ? pattern : [pattern]; return this; }

  /** @param {Record<string, any>} predicate */
  when(predicate) { this._def.when = predicate; return this; }

  /** @param {number} n */
  times(n) {
    this._def.lifecycle = { ...this._def.lifecycle, maxExecutions: n };
    return this;
  }

  /** @param {number} ms */
  cooldown(ms) {
    this._def.lifecycle = { ...this._def.lifecycle, cooldown: ms };
    return this;
  }

  /** @param {'run'|'session'|'permanent'} s */
  scope(s) {
    this._def.lifecycle = { ...this._def.lifecycle, scope: s };
    return this;
  }

  /** @param {'llm'|'user'|'agent'} type @param {string=} prompt */
  gate(type, prompt) {
    this._def.gate = { type };
    if (prompt) this._def.gate.prompt = prompt;
    return this;
  }

  protect() { this._def.protected = true; this._def.authority = "system"; return this; }

  /**
   * Terminal method — registers the hook.
   * @param {(ctx: object) => Promise<any>} handler
   * @returns {HookDefinition}
   */
  do(handler) {
    this._def.handler = handler;
    return this._registry.register(this._event, this._def);
  }
}

/**
 * Progressive hook registration API.
 *
 * Level 0: hook(registry, 'PreToolUse', handler)
 * Level 1: hook(registry, 'PreToolUse', { match: 'bash_*' }, handler)
 * Level 2: hook(registry, 'PreToolUse').match('bash_*').times(3).do(handler)
 *
 * @param {HookRegistry} registry
 * @param {string} eventName
 * @param {object|Function=} optsOrHandler
 * @param {Function=} handler
 * @returns {HookBuilder|HookDefinition}
 */
export function hook(registry, eventName, optsOrHandler, handler) {
  if (!(registry instanceof HookRegistry)) {
    throw new TypeError("hook(): first argument must be a HookRegistry instance");
  }
  // Level 0: hook(reg, event, fn)
  if (typeof optsOrHandler === "function") {
    return registry.register(eventName, /** @type {HookDefinition} */ ({ type: "command", handler: /** @type {HookDefinition["handler"]} */ (optsOrHandler) }));
  }
  // Level 1: hook(reg, event, { match, ... }, fn)
  if (isPlainObject(optsOrHandler) && typeof handler === "function") {
    /** @type {HookDefinition} */
    const def = { type: "command", handler: /** @type {HookDefinition["handler"]} */ (handler) };
    if (optsOrHandler.match) def.tools = Array.isArray(optsOrHandler.match) ? optsOrHandler.match : [optsOrHandler.match];
    if (optsOrHandler.when) def.when = optsOrHandler.when;
    if (optsOrHandler.times) def.lifecycle = { maxExecutions: optsOrHandler.times };
    if (optsOrHandler.protected) { def.protected = true; def.authority = "system"; }
    return registry.register(eventName, def);
  }
  // Level 2: hook(reg, event) → builder
  return new HookBuilder(eventName, registry);
}
