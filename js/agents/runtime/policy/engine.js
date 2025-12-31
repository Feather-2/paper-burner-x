import { matchAnyWildcard, matchAnyGlob } from "./match.js";

function toNonEmptyString(v) {
  if (v === null || v === undefined) return "";
  const s = String(v).trim();
  return s.length ? s : "";
}

function normalizeEffect(effect) {
  const e = toNonEmptyString(effect).toLowerCase();
  if (e === "deny") return "deny";
  return "allow";
}

function normalizeTypeList(type) {
  const list = Array.isArray(type) ? type : type ? [type] : [];
  return list.map((t) => toNonEmptyString(t)).filter(Boolean);
}

function normalizeRule(rule) {
  const r = rule && typeof rule === "object" ? rule : {};
  const ruleId = toNonEmptyString(r.ruleId || r.id) || `rule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const effect = normalizeEffect(r.effect);
  const types = normalizeTypeList(r.type ?? r.types);
  const tool = r.tool ?? r.toolPattern ?? null;
  const resource = r.resource ?? r.resourcePattern ?? null;
  const path = r.path ?? r.paths ?? null;
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
    enabled,
    priority,
    createdAt,
    updatedAt,
  };
}

function ruleMatches(rule, request) {
  if (!rule?.enabled) return false;

  if (Array.isArray(rule.types) && rule.types.length) {
    if (!rule.types.includes(request.type)) return false;
  }

  if (!matchAnyWildcard(rule.tool, request.tool || "")) return false;
  if (!matchAnyWildcard(rule.resource, request.resource || "")) return false;
  if (!matchAnyGlob(rule.path, request.resource || "")) return false;

  return true;
}

function compareRulePriority(a, b) {
  const pa = Number.isFinite(a?.priority) ? a.priority : 0;
  const pb = Number.isFinite(b?.priority) ? b.priority : 0;
  if (pa !== pb) return pb - pa;
  return String(b?.updatedAt || "").localeCompare(String(a?.updatedAt || ""));
}

export class PolicyEngine {
  constructor({ rules = [], defaultEffect = "prompt" } = {}) {
    this.defaultEffect = defaultEffect; // "prompt" | "allow" | "deny"
    this.rules = [];
    this.setRules(rules);
  }

  setRules(rules) {
    const list = Array.isArray(rules) ? rules : [];
    this.rules = list.map(normalizeRule).sort(compareRulePriority);
  }

  getRules() {
    return [...this.rules];
  }

  evaluate(request) {
    const req = request && typeof request === "object" ? request : {};
    const type = toNonEmptyString(req.type);
    if (!type) {
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

    return { allowed: false, requiresApproval: true, reason: "no_matching_rule" };
  }
}

export default PolicyEngine;

