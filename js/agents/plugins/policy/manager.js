import { computeSha256 } from "../../storage/artifact-manager.js";
import { PolicyEngine } from "./engine.js";
import { PolicyRuleStore } from "./store.js";
import { makeSecureTimestampedId } from "../../shared/index.js";
import { createLogger } from "../../shared/index.js";

import { isNodeLike } from "../../shared/index.js";
import { toNonEmptyString } from "../../shared/index.js";

const logger = createLogger("runtime/policy/manager");

/**
 * @typedef {import("./engine.js").PolicyRuleInput} PolicyRule
 */

/**
 * @typedef {object} PolicyRequest
 * @property {string=} schemaVersion
 * @property {string=} requestId
 * @property {string=} ts
 * @property {string=} type
 * @property {string=} tool
 * @property {string=} resource
 * @property {unknown=} args
 * @property {string=} argsHash
 * @property {unknown=} argsSummary
 * @property {string=} runId
 */

/**
 * @typedef {object} ApprovalResponsePayload
 * @property {string} requestId
 * @property {"allow"|"deny"} decision
 * @property {"none"|"always"=} remember
 * @property {string=} reason
 */

/**
 * @typedef {object} EventBusLike
 * @property {(name: string, payload: unknown) => void=} emit
 * @property {(name: string, handler: (evt: any) => void) => (void | (() => void))=} subscribe
 */

/**
 * @typedef {object} WaitForApprovalOptions
 * @property {number=} timeoutMs
 * @property {AbortSignal=} signal
 */

/**
 * @typedef {(req: PolicyRequest, response?: ApprovalResponsePayload | null) => PolicyRule | null} DeriveRuleFn
 */

function summarizeArgs(args) {
  if (args === null || args === undefined) return { kind: "null" };
  if (typeof args !== "object") return { kind: typeof args, value: String(args) };
  const keys = Object.keys(args);
  return { kind: "object", keys: keys.slice(0, 20), ...(keys.length > 20 ? { moreKeys: keys.length - 20 } : {}) };
}

async function sha256OfJson(value) {
  try {
    return await computeSha256(JSON.stringify(value ?? null));
  } catch (err) {
    logger.warn("sha256OfJson failed", { error: err?.message ?? String(err) });
    return null;
  }
}

/**
 * @param {PolicyRequest} req
 * @returns {PolicyRule | null}
 */
function defaultDeriveRuleFromRequest(req) {
  const type = toNonEmptyString(req?.type);
  const tool = toNonEmptyString(req?.tool);
  const resource = toNonEmptyString(req?.resource);
  // Require at least type, or (tool/resource) to avoid overly broad rules
  if (!type && !tool && !resource) {
    logger.warn("defaultDeriveRuleFromRequest: missing type/tool/resource, refusing to generate rule");
    return null;
  }
  const rule = {
    ruleId: makeSecureTimestampedId("rule"),
    effect: "allow",
    type,
    ...(tool ? { tool: tool } : {}),
    ...(resource ? { resource: resource } : {}),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    enabled: true,
    priority: 0,
  };
  return rule;
}

/**
 * @param {EventBusLike | null} eventBus
 * @param {string} requestId
 * @param {WaitForApprovalOptions} [options]
 * @returns {Promise<ApprovalResponsePayload | null>}
 */
async function waitForApprovalResponse(eventBus, requestId, { timeoutMs = 300000, signal } = {}) {
  if (!eventBus || typeof eventBus.subscribe !== "function") return null;
  const id = toNonEmptyString(requestId);
  if (!id) return null;

  return new Promise((resolve) => {
    let done = false;
    let off = null;
    let timeoutId = null;

    const finish = (value) => {
      if (done) return;
      done = true;
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = null;
      try {
        off?.();
      } catch {
        // ignore
      }
      if (signal && typeof signal.removeEventListener === "function") {
        signal.removeEventListener("abort", onAbort);
      }
      resolve(value);
    };

    const onAbort = () => finish({ decision: "deny", remember: "none", reason: "aborted" });

    if (signal && typeof signal.addEventListener === "function") {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    timeoutId = setTimeout(() => finish({ decision: "deny", remember: "none", reason: "timeout" }), timeoutMs);

    off = eventBus.subscribe("policy.approval.response", (evt) => {
      const payload = evt && typeof evt === "object" && "payload" in evt ? evt.payload : evt;
      if (toNonEmptyString(payload?.requestId) !== id) return;
      finish(payload);
    });
  });
}

/**
 * @typedef {object} PolicyRuleStoreLike
 * @property {() => PolicyRule[]} load
 * @property {(rules: PolicyRule[]) => boolean} save
 * @property {() => boolean} [clear]
 */

/**
 * @typedef {object} PolicyEngineLike
 * @property {(rules: PolicyRule[] | null | undefined) => void} setRules
 * @property {() => PolicyRule[]} getRules
 * @property {(request: PolicyRequest | null | undefined) => { allowed: boolean, requiresApproval: boolean, reason: string }} evaluate
 */

/**
 * @typedef {object} RunStoreLike
 * @property {(id: string, data: unknown) => void} [set]
 * @property {(id: string) => unknown} [get]
 */

export class PolicyManager {
  /**
   * @param {object} [options]
   * @param {PolicyRuleStoreLike} [options.ruleStore]
   * @param {PolicyEngineLike} [options.engine]
   * @param {EventBusLike | null} [options.eventBus]
   * @param {RunStoreLike | null} [options.runStore]
   * @param {string | null} [options.runId]
   * @param {boolean} [options.interactive]
   * @param {number} [options.approvalTimeoutMs]
   * @param {string} [options.onMissingApprovalProvider]
   * @param {string} [options.defaultEffect]
   */
  constructor(options = {}) {
    this.ruleStore = options.ruleStore || new PolicyRuleStore();
    this.engine = options.engine || new PolicyEngine({ defaultEffect: options.defaultEffect || "prompt" });
    this.eventBus = options.eventBus || null;
    this.runStore = options.runStore || null;
    this.runId = options.runId || null;

    this.interactive = typeof options.interactive === "boolean" ? options.interactive : !isNodeLike();
    this.approvalTimeoutMs = Number.isFinite(options.approvalTimeoutMs) ? Math.max(1000, Math.floor(options.approvalTimeoutMs)) : 300000;
    this.onMissingApprovalProvider = toNonEmptyString(options.onMissingApprovalProvider) || "deny";

    this._loaded = false;
  }

  /**
   * @param {{ eventBus?: EventBusLike | null, runStore?: RunStoreLike | null, runId?: string | null }} [context]
   */
  setRunContext({ eventBus, runStore, runId } = {}) {
    if (eventBus) this.eventBus = eventBus;
    if (runStore) this.runStore = runStore;
    if (runId) this.runId = runId;
  }

  load() {
    if (this._loaded) return;
    const rules = /** @type {PolicyRuleStoreLike} */ (this.ruleStore).load();
    /** @type {PolicyEngineLike} */ (this.engine).setRules(rules);
    this._loaded = true;
  }

  getRules() {
    this.load();
    return this.engine.getRules();
  }

  saveRules(rules) {
    const list = Array.isArray(rules) ? rules : [];
    this.ruleStore.save(list);
    this.engine.setRules(list);
    this._loaded = true;
  }

  addRule(rule) {
    const existing = this.getRules();
    const next = [...existing, rule];
    this.saveRules(next);
    return rule;
  }

  _emit(name, payload) {
    if (this.eventBus && typeof this.eventBus.emit === "function") {
      this.eventBus.emit(name, payload);
    }
  }

  /**
   * @param {PolicyRequest} request
   * @param {{ signal?: AbortSignal, deriveRule?: DeriveRuleFn }} [options]
   */
  async authorize(request, { signal, deriveRule = defaultDeriveRuleFromRequest } = {}) {
    this.load();

    const req = request && typeof request === "object" ? { ...request } : {};
    req.schemaVersion = "0.1";
    req.requestId = toNonEmptyString(req.requestId) || makeSecureTimestampedId("polreq");
    req.ts = toNonEmptyString(req.ts) || new Date().toISOString();

    const type = toNonEmptyString(req.type);
    const tool = toNonEmptyString(req.tool);
    const resource = toNonEmptyString(req.resource);

    const argsHash = req.argsHash || (req.args ? await sha256OfJson(req.args) : undefined);
    const argsSummary = req.argsSummary || (req.args ? summarizeArgs(req.args) : undefined);

    const enriched = {
      ...req,
      type,
      tool,
      resource,
      ...(argsHash ? { argsHash } : {}),
      ...(argsSummary ? { argsSummary } : {}),
      ...(toNonEmptyString(this.runId) ? { runId: this.runId } : {}),
    };

    this._emit("policy.requested", {
      requestId: enriched.requestId,
      type: enriched.type,
      tool: enriched.tool,
      resource: enriched.resource,
      ...(enriched.argsHash ? { argsHash: enriched.argsHash } : {}),
    });

    const decision = this.engine.evaluate(enriched);

    if (!decision.requiresApproval) {
      this._emit("policy.decided", { requestId: enriched.requestId, ...decision });
      return { request: enriched, ...decision };
    }

    if (!this.interactive) {
      const fallbackAllowed = this.onMissingApprovalProvider === "allow";
      const fallback = { allowed: fallbackAllowed, requiresApproval: false, reason: `non_interactive_${fallbackAllowed ? "allow" : "deny"}` };
      this._emit("policy.decided", { requestId: enriched.requestId, ...fallback });
      return { request: enriched, ...fallback };
    }

    // Ask UI
    this._emit("policy.approval.requested", {
      requestId: enriched.requestId,
      type: enriched.type,
      tool: enriched.tool,
      resource: enriched.resource,
      ...(enriched.argsSummary ? { argsSummary: enriched.argsSummary } : {}),
    });

    const response = await waitForApprovalResponse(this.eventBus, enriched.requestId, { timeoutMs: this.approvalTimeoutMs, signal });

    const decisionText = toNonEmptyString(response?.decision).toLowerCase();
    const remember = toNonEmptyString(response?.remember).toLowerCase(); // "none" | "always"
    const allowed = decisionText === "allow";

    this._emit("policy.approval.responded", {
      requestId: enriched.requestId,
      decision: allowed ? "allow" : "deny",
      remember: remember || "none",
      ...(toNonEmptyString(response?.reason) ? { reason: toNonEmptyString(response.reason) } : {}),
    });

    if (allowed && remember === "always") {
      const rule = typeof deriveRule === "function" ? deriveRule(enriched, response) : null;
      if (rule) {
        this.addRule(rule);
        this._emit("policy.rule.added", { requestId: enriched.requestId, ruleId: rule.ruleId || rule.id });
      }
    }

    const final = { allowed, requiresApproval: false, reason: allowed ? "approved" : "rejected" };
    this._emit("policy.decided", { requestId: enriched.requestId, ...final });
    return { request: enriched, ...final };
  }
}

export default PolicyManager;
