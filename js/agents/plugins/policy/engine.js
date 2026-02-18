import { matchAnyWildcard, matchAnyGlob } from "./match.js";
import { makeSecureTimestampedId } from "../../shared/index.js";

import { isPlainObject, toNonEmptyString } from "../../shared/index.js";
import { createLogger } from "../../shared/index.js";

const logger = createLogger("runtime/policy/engine");

/**
 * @typedef {"allow" | "deny"} PolicyEffect
 * @typedef {"prompt" | PolicyEffect} PolicyDefaultEffect
 *
 * @typedef {object} PolicyRuleInput
 * @property {string} [ruleId]
 * @property {string} [id]
 * @property {string} [effect]
 * @property {string | string[]} [type]
 * @property {string | string[]} [types]
 * @property {string | string[]} [tool]
 * @property {string | string[]} [toolPattern]
 * @property {string | string[]} [resource]
 * @property {string | string[]} [resourcePattern]
 * @property {string | string[]} [path]
 * @property {string | string[]} [paths]
 * @property {string | string[]} [domainSuffixes]
 * @property {string | string[]} [domainSuffix]
 * @property {string | string[]} [hostSuffixes]
 * @property {string | string[]} [hostSuffix]
 * @property {object} [timeRange]
 * @property {object} [window]
 * @property {object} [timeWindow]
 * @property {object} [match]
 * @property {object} [when]
 * @property {boolean} [enabled]
 * @property {number} [priority]
 * @property {string} [createdAt]
 * @property {string} [updatedAt]
 *
 * @typedef {PolicyRuleInput & {
 *   ruleId: string,
 *   effect: PolicyEffect,
 *   enabled: boolean,
 *   priority: number,
 *   updatedAt: string,
 * }} NormalizedPolicyRule
 *
 * @typedef {object} PolicyRequest
 * @property {string} [type]
 * @property {string} [tool]
 * @property {string} [resource]
 * @property {string} [path]
 * @property {string} [ts]
 *
 * @typedef {object} PolicyDecision
 * @property {boolean} allowed
 * @property {boolean} requiresApproval
 * @property {PolicyEffect} [effect]
 * @property {string} [ruleId]
 * @property {string} reason
 */

function normalizeEffect(effect) {
  const raw = toNonEmptyString(effect);
  if (!raw) return null;
  const e = raw.toLowerCase();
  if (e === "allow" || e === "deny") return e;
  return null;
}

function normalizeDefaultEffect(effect) {
  const raw = toNonEmptyString(effect);
  if (!raw) return "prompt";
  const normalized = raw.toLowerCase();
  if (normalized === "allow" || normalized === "deny" || normalized === "prompt") return normalized;
  logger.warn("Invalid policy defaultEffect; falling back to prompt", {
    received: raw,
    expected: ["allow", "deny", "prompt"],
  });
  return "prompt";
}

function normalizeTypeList(type) {
  const list = Array.isArray(type) ? type : type ? [type] : [];
  return list.map((t) => toNonEmptyString(t)).filter(Boolean);
}

function normalizeDomainSuffixes(value) {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list
    .map((v) => toNonEmptyString(v).toLowerCase())
    .map((s) => (s.startsWith(".") ? s.slice(1) : s))
    .filter(Boolean);
}

function parseTimeToMinutes(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const n = Math.floor(value);
    if (n < 0 || n >= 24 * 60) return null;
    return n;
  }
  const s = toNonEmptyString(value);
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  if (h < 0 || h > 23) return null;
  if (min < 0 || min > 59) return null;
  return h * 60 + min;
}

function normalizeTimeRange(value) {
  if (!isPlainObject(value)) return null;

  const startMin =
    typeof value.startMin === "number"
      ? parseTimeToMinutes(value.startMin)
      : parseTimeToMinutes(value.start ?? value.from ?? value.begin);
  const endMin =
    typeof value.endMin === "number"
      ? parseTimeToMinutes(value.endMin)
      : parseTimeToMinutes(value.end ?? value.to ?? value.until);

  if (startMin === null || endMin === null) return null;

  const tzRaw = toNonEmptyString(value.timezone ?? value.tz).toLowerCase();
  const timezone = tzRaw === "utc" ? "utc" : "local";

  const days = Array.isArray(value.daysOfWeek)
    ? value.daysOfWeek.map((d) => Number(d)).filter((d) => Number.isFinite(d) && d >= 0 && d <= 6)
    : null;

  return {
    startMin,
    endMin,
    timezone,
    ...(days && days.length ? { daysOfWeek: days } : {}),
  };
}

function extractHostname(resource) {
  const raw = toNonEmptyString(resource).toLowerCase();
  if (!raw) return "";

  const parse = (value) => {
    try {
      return new URL(value);
    } catch {
      return null;
    }
  };

  const direct = parse(raw);
  if (direct?.hostname) return direct.hostname.toLowerCase();

  // Heuristic: allow "example.com/path" and "example.com" without scheme.
  if (raw.includes(".") && !raw.includes(" ")) {
    const withHttps = parse(`https://${raw}`);
    if (withHttps?.hostname) return withHttps.hostname.toLowerCase();
  }

  return "";
}

function hostMatchesSuffix(host, suffix) {
  const h = toNonEmptyString(host).toLowerCase();
  const s = toNonEmptyString(suffix).toLowerCase().replace(/^\./, "");
  if (!h || !s) return false;
  if (h === s) return true;
  return h.endsWith(`.${s}`);
}

function matchTimeRange(timeRange, request) {
  if (timeRange === null || timeRange === undefined) return true;
  const tr = normalizeTimeRange(timeRange);
  // If a timeRange is explicitly specified but invalid, treat as non-match.
  if (!tr) return false;

  const tsRaw = toNonEmptyString(request?.ts);
  const parsed = tsRaw ? Date.parse(tsRaw) : NaN;
  const dt = new Date(Number.isFinite(parsed) ? parsed : Date.now());

  const minutes =
    tr.timezone === "utc" ? dt.getUTCHours() * 60 + dt.getUTCMinutes() : dt.getHours() * 60 + dt.getMinutes();
  const day = tr.timezone === "utc" ? dt.getUTCDay() : dt.getDay();

  if (Array.isArray(tr.daysOfWeek) && tr.daysOfWeek.length) {
    if (!tr.daysOfWeek.includes(day)) return false;
  }

  if (tr.startMin <= tr.endMin) {
    return minutes >= tr.startMin && minutes <= tr.endMin;
  }
  // Wrap-around window (e.g. 22:00-06:00).
  return minutes >= tr.startMin || minutes <= tr.endMin;
}

function normalizeRule(rule) {
  const r = rule && typeof rule === "object" ? rule : {};
  const ruleId = toNonEmptyString(r.ruleId || r.id) || makeSecureTimestampedId("rule");
  const effect = normalizeEffect(r.effect);
  const types = normalizeTypeList(r.type ?? r.types);
  const tool = r.tool ?? r.toolPattern ?? null;
  const resource = r.resource ?? r.resourcePattern ?? null;
  const path = r.path ?? r.paths ?? null;
  const domainSuffixes = normalizeDomainSuffixes(r.domainSuffixes ?? r.domainSuffix ?? r.hostSuffixes ?? r.hostSuffix);
  const timeRange = normalizeTimeRange(r.timeRange ?? r.window ?? r.timeWindow);
  const match = isPlainObject(r.match) ? r.match : isPlainObject(r.when) ? r.when : null;
  const enabled = r.enabled !== false;
  const priority = Number.isFinite(Number(r.priority)) ? Number(r.priority) : 0;
  const createdAt = toNonEmptyString(r.createdAt) || new Date().toISOString();
  const updatedAt = toNonEmptyString(r.updatedAt) || createdAt;
  return {
    ...r,
    ruleId,
    effect,
    types,
    tool,
    resource,
    path,
    ...(domainSuffixes.length ? { domainSuffixes } : {}),
    ...(timeRange ? { timeRange } : {}),
    ...(match ? { match } : {}),
    enabled,
    priority,
    createdAt,
    updatedAt,
  };
}

function normalizeRequest(request) {
  const req = request && typeof request === "object" ? request : {};
  const type = toNonEmptyString(req.type);
  const tool = toNonEmptyString(req.tool);
  const resource = toNonEmptyString(req.resource);
  const path = toNonEmptyString(req.path) || resource;
  const ts = toNonEmptyString(req.ts);
  return { ...req, type, tool, resource, path, ts };
}

function matchLeaf(condition, request) {
  const cond = isPlainObject(condition) ? condition : {};
  const req = request && typeof request === "object" ? request : {};

  const types = normalizeTypeList(cond.type ?? cond.types);
  if (types.length && !matchAnyWildcard(types, req.type || "")) return false;

  const tool = cond.tool ?? cond.toolPattern ?? null;
  if (!matchAnyWildcard(tool, req.tool || "")) return false;

  const resource = cond.resource ?? cond.resourcePattern ?? null;
  if (!matchAnyWildcard(resource, req.resource || "")) return false;

  const path = cond.path ?? cond.paths ?? null;
  if (!matchAnyGlob(path, req.path || req.resource || "")) return false;

  const domainSuffixes = normalizeDomainSuffixes(cond.domainSuffixes ?? cond.domainSuffix ?? cond.hostSuffixes ?? cond.hostSuffix);
  if (domainSuffixes.length) {
    const host = extractHostname(req.resource || "");
    if (!host) return false;
    let ok = false;
    for (const suffix of domainSuffixes) {
      if (hostMatchesSuffix(host, suffix)) {
        ok = true;
        break;
      }
    }
    if (!ok) return false;
  }

  const timeRange = cond.timeRange ?? cond.window ?? cond.timeWindow;
  if (!matchTimeRange(timeRange, req)) return false;

  return true;
}

function matchCondition(condition, request, depth = 0) {
  if (depth > 12) return false;

  if (typeof condition === "string") {
    // Convenience: treat a raw string as resource wildcard.
    return matchLeaf({ resource: condition }, request);
  }

  if (!isPlainObject(condition)) return false;

  // Leaf semantics (AND across leaf keys) first.
  if (!matchLeaf(condition, request)) return false;

  const all = Array.isArray(condition.all) ? condition.all : Array.isArray(condition.allOf) ? condition.allOf : null;
  if (all) {
    for (const child of all) {
      if (!matchCondition(child, request, depth + 1)) return false;
    }
  }

  const any = Array.isArray(condition.any) ? condition.any : Array.isArray(condition.anyOf) ? condition.anyOf : null;
  if (any) {
    if (any.length === 0) return false;
    let ok = false;
    for (const child of any) {
      if (matchCondition(child, request, depth + 1)) {
        ok = true;
        break;
      }
    }
    if (!ok) return false;
  }

  const not = Array.isArray(condition.not) ? condition.not : Array.isArray(condition.none) ? condition.none : null;
  if (not) {
    for (const child of not) {
      if (matchCondition(child, request, depth + 1)) return false;
    }
  }

  return true;
}

function ruleMatches(rule, request) {
  if (!rule?.enabled) return false;
  if (!matchLeaf(rule, request)) return false;
  if (rule.match !== undefined && rule.match !== null) {
    return matchCondition(rule.match, request);
  }
  return true;
}

function compareRulePriority(a, b) {
  const pa = Number.isFinite(a?.priority) ? a.priority : 0;
  const pb = Number.isFinite(b?.priority) ? b.priority : 0;
  if (pa !== pb) return pb - pa;
  return String(b?.updatedAt || "").localeCompare(String(a?.updatedAt || ""));
}

export class PolicyEngine {
  /**
   * @param {{ rules?: PolicyRuleInput[] | null, defaultEffect?: PolicyDefaultEffect | string }} [options]
   */
  constructor({ rules = [], defaultEffect = "prompt" } = {}) {
    /** @type {PolicyDefaultEffect | string} */
    this.defaultEffect = normalizeDefaultEffect(defaultEffect);
    /** @type {NormalizedPolicyRule[]} */
    this.rules = [];
    this.setRules(rules);
  }

  /**
   * @param {PolicyRuleInput[] | null | undefined} rules
   * @returns {void}
   */
  setRules(rules) {
    const list = Array.isArray(rules) ? rules : [];
    this.rules = list.map(normalizeRule).sort(compareRulePriority);
  }

  /**
   * @returns {NormalizedPolicyRule[]}
   */
  getRules() {
    return [...this.rules];
  }

  /**
   * Evaluate an access request against allow/deny rules.
   * @param {PolicyRequest | null | undefined} request
   * @returns {PolicyDecision}
   */
  evaluate(request) {
    const req = normalizeRequest(request);
    const hasRoutingInput = Boolean(req.type || req.tool || req.resource || req.path);
    if (!hasRoutingInput) {
      return { allowed: false, requiresApproval: true, reason: "missing_type" };
    }

    const rules = this.rules || [];
    for (const r of rules) {
      if (!r || r.effect !== "deny") continue;
      if (ruleMatches(r, req)) {
        return { allowed: false, requiresApproval: false, effect: "deny", ruleId: r.ruleId, reason: "matched_deny_rule" };
      }
    }

    for (const r of rules) {
      if (!r || r.effect !== "allow") continue;
      if (ruleMatches(r, req)) {
        return { allowed: true, requiresApproval: false, effect: "allow", ruleId: r.ruleId, reason: "matched_allow_rule" };
      }
    }

    if (this.defaultEffect === "allow") {
      return { allowed: true, requiresApproval: false, effect: "allow", reason: "default_allow" };
    }
    if (this.defaultEffect === "deny") {
      return { allowed: false, requiresApproval: false, effect: "deny", reason: "default_deny" };
    }

    return {
      allowed: false,
      requiresApproval: true,
      reason: req.type ? "no_matching_rule" : "missing_type_no_matching_rule",
    };
  }
}

export default PolicyEngine;
