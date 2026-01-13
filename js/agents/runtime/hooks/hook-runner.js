import { isPlainObject, toNonEmptyString } from "../../shared/utils/value-utils.js";
import { robustParseJson } from "../../shared/utils/robust-json.js";
import { ServiceId } from "../di/defaults.js";

import { HookType } from "./hook-registry.js";
import { getHookRegistry } from "./event-bus-hooks.js";
import { classifyCommand } from "../safety/command-classifier.js";

function safeStringify(value, maxChars = 2000) {
  try {
    const s = typeof value === "string" ? value : JSON.stringify(value);
    if (typeof s !== "string") return "";
    return s.length > maxChars ? s.slice(0, Math.max(0, maxChars - 3)) + "..." : s;
  } catch {
    const s = String(value ?? "");
    return s.length > maxChars ? s.slice(0, Math.max(0, maxChars - 3)) + "..." : s;
  }
}

function renderTemplate(tpl, vars) {
  const template = String(tpl ?? "");
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_m, key) => {
    const k = String(key || "");
    if (!k) return "";
    return Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k] ?? "") : "";
  });
}

function resolveEventBus(context) {
  const ctx = context && typeof context === "object" ? context : null;
  return ctx?.eventBus || ctx?.stageApi?.eventBus || ctx?.services?.eventBus || null;
}

async function resolveFromContainer(context, serviceId) {
  const ctx = context && typeof context === "object" ? context : null;
  const container = ctx?.container || ctx?.stageApi?.container || ctx?.services?.container || null;
  if (container && typeof container.get === "function") {
    try {
      return await container.get(serviceId);
    } catch {
      return null;
    }
  }
  if (container && typeof container.tryGet === "function") {
    try {
      return await container.tryGet(serviceId);
    } catch {
      return null;
    }
  }
  return null;
}

async function resolveModelRouter(context) {
  const ctx = context && typeof context === "object" ? context : null;
  const direct = ctx?.modelRouter || ctx?.stageApi?.modelRouter;
  if (direct && typeof direct.call === "function") return direct;
  return await resolveFromContainer(context, ServiceId.MODEL_ROUTER);
}

async function resolveSubagentRegistry(context) {
  const ctx = context && typeof context === "object" ? context : null;
  const direct = ctx?.subagentRegistry || ctx?.stageApi?.subagentRegistry;
  if (direct && typeof direct.getFactory === "function") return direct;
  return await resolveFromContainer(context, ServiceId.SUBAGENT_REGISTRY);
}

function normalizeModelTier(input) {
  const s = toNonEmptyString(input)?.toLowerCase();
  if (s === "fast" || s === "normal" || s === "advanced") return s;
  return "fast";
}

function parseAllowDenyText(text) {
  const raw = toNonEmptyString(text);
  if (!raw) return null;

  const parsed = robustParseJson(raw, null);
  if (isPlainObject(parsed)) {
    if (typeof parsed.allow === "boolean") return { allow: parsed.allow, reason: toNonEmptyString(parsed.reason) || "" };
    if (typeof parsed.allowed === "boolean") return { allow: parsed.allowed, reason: toNonEmptyString(parsed.reason) || "" };
    const decision = toNonEmptyString(parsed.decision)?.toLowerCase();
    if (decision === "allow") return { allow: true, reason: toNonEmptyString(parsed.reason) || "" };
    if (decision === "deny") return { allow: false, reason: toNonEmptyString(parsed.reason) || "" };
  }

  const lowered = raw.toLowerCase();
  if (/\bdeny\b/.test(lowered) || /\bblock\b/.test(lowered) || /\bdisallow\b/.test(lowered)) {
    return { allow: false, reason: "" };
  }
  if (/\ballow\b/.test(lowered) || /\bok\b/.test(lowered) || /\bpermit\b/.test(lowered)) {
    return { allow: true, reason: "" };
  }
  return null;
}

function extractCommandFromToolArgs(args) {
  if (typeof args === "string") return args;
  if (Array.isArray(args)) return args;
  const a = args && typeof args === "object" ? args : null;
  if (!a) return null;
  if (typeof a.command === "string") return a.command;
  if (typeof a.cmd === "string") return a.cmd;
  if (Array.isArray(a.argv)) return a.argv;
  if (Array.isArray(a.args)) return a.args;
  return null;
}

/**
 * Convert EventBus hook definitions into a ToolRegistry/ToolExecutor before-hook.
 *
 * @param {{ eventName?: string } | undefined} [options]
 * @returns {(ctx: { tool: string, params: any, context: any }) => Promise<{ skip?: boolean, value?: any, params?: any } | null>}
 */
export function createPreToolUseHook(options = {}) {
  const hookEventName = toNonEmptyString(options?.eventName) || "PreToolUse";

  return async ({ tool, params, context }) => {
    const eventBus = resolveEventBus(context);
    const registry = getHookRegistry(eventBus);
    if (!registry) return null;

    const toolName = toNonEmptyString(tool) || "";
    const hooks = registry.match(hookEventName, toolName);
    if (!hooks.length) return null;

    for (const hook of hooks) {
      const blocking = hook.blocking !== false;
      const hookType = toNonEmptyString(hook.type)?.toLowerCase();

      if (hookType === HookType.COMMAND) {
        const cmd = extractCommandFromToolArgs(params);
        const classification = classifyCommand(cmd);
        if (classification.requiresApproval && blocking) {
          const reason = `Command requires approval: ${classification.baseCommand || "unknown"}`;
          eventBus?.emit?.("tool.denied", { tool: toolName, args: params, reason, policy: { hookType: "command", level: classification.level } });
          return { skip: true, value: { ok: false, error: reason, policy: { hookType: "command", ...classification } } };
        }
        continue;
      }

      if (hookType === HookType.PROMPT) {
        const modelRouter = await resolveModelRouter(context);
        if (!modelRouter || typeof modelRouter.call !== "function") {
          if (blocking) {
            const reason = "Prompt hook blocked: ModelRouter unavailable";
            eventBus?.emit?.("tool.denied", { tool: toolName, args: params, reason, policy: { hookType: "prompt", error: "model_router_unavailable" } });
            return { skip: true, value: { ok: false, error: reason, policy: { hookType: "prompt", error: "model_router_unavailable" } } };
          }
          continue;
        }

        const promptText = renderTemplate(hook.prompt, { tool: toolName, args: safeStringify(params, 2000) });
        const system = [
          "You are a safety gate for tool execution.",
          'Return JSON only: {"allow": true|false, "reason": "short"}.',
        ].join("\n");

        try {
          const usage = toNonEmptyString(hook.usage) || "shadow";
          const resp = await modelRouter.call({ usage, messages: [{ role: "system", content: system }, { role: "user", content: promptText }] });
          const content = toNonEmptyString(resp?.content) || "";
          const decision = parseAllowDenyText(content);
          if (!decision) {
            if (blocking) {
              const reason = "Prompt hook blocked: unparseable decision";
              eventBus?.emit?.("tool.denied", { tool: toolName, args: params, reason, policy: { hookType: "prompt", error: "unparseable" } });
              return { skip: true, value: { ok: false, error: reason, policy: { hookType: "prompt", error: "unparseable" } } };
            }
            continue;
          }
          if (!decision.allow && blocking) {
            const reason = decision.reason || "Prompt hook denied";
            eventBus?.emit?.("tool.denied", { tool: toolName, args: params, reason, policy: { hookType: "prompt" } });
            return { skip: true, value: { ok: false, error: reason, policy: { hookType: "prompt" } } };
          }
        } catch (err) {
          if (blocking) {
            const reason = `Prompt hook blocked: ${err?.message || String(err)}`;
            eventBus?.emit?.("tool.denied", { tool: toolName, args: params, reason, policy: { hookType: "prompt", error: "model_call_failed" } });
            return { skip: true, value: { ok: false, error: reason, policy: { hookType: "prompt", error: "model_call_failed" } } };
          }
        }

        continue;
      }

      if (hookType === HookType.AGENT) {
        const registry = await resolveSubagentRegistry(context);
        if (!registry || typeof registry.getFactory !== "function") {
          if (blocking) {
            const reason = "Agent hook blocked: SubagentRegistry unavailable";
            eventBus?.emit?.("tool.denied", { tool: toolName, args: params, reason, policy: { hookType: "agent", error: "registry_unavailable" } });
            return { skip: true, value: { ok: false, error: reason, policy: { hookType: "agent", error: "registry_unavailable" } } };
          }
          continue;
        }

        const agentType = toNonEmptyString(hook.agentType);
        const factory = agentType ? registry.getFactory(agentType) : null;
        if (!factory) {
          if (blocking) {
            const reason = `Agent hook blocked: unknown agentType "${agentType || ""}"`;
            eventBus?.emit?.("tool.denied", { tool: toolName, args: params, reason, policy: { hookType: "agent", error: "unknown_agent" } });
            return { skip: true, value: { ok: false, error: reason, policy: { hookType: "agent", error: "unknown_agent" } } };
          }
          continue;
        }

        const promptText = renderTemplate(hook.prompt || "", { tool: toolName, args: safeStringify(params, 2000) });
        const signal = context?.signal || context?.stageApi?.signal || null;

        try {
          const instance = await factory({
            prompt: promptText,
            modelTier: normalizeModelTier(hook.modelTier),
            usage: `hook_${agentType}`,
            parent: context?.parentAgent || null,
            inheritedContext: { sharedContext: context?.state?.sharedContext || null },
          });
          const out = instance && typeof instance.run === "function" ? await instance.run({ task: promptText }, { signal }) : null;
          const allow = typeof out?.allow === "boolean" ? out.allow : toNonEmptyString(out?.decision)?.toLowerCase() === "allow";
          const denied = typeof out?.decision === "string" && String(out.decision).toLowerCase() === "deny";
          const finalAllow = allow && !denied;
          if (!finalAllow && blocking) {
            const reason = toNonEmptyString(out?.reason) || toNonEmptyString(out?.error) || "Agent hook denied";
            eventBus?.emit?.("tool.denied", { tool: toolName, args: params, reason, policy: { hookType: "agent", agentType } });
            return { skip: true, value: { ok: false, error: reason, policy: { hookType: "agent", agentType } } };
          }
        } catch (err) {
          if (blocking) {
            const reason = `Agent hook blocked: ${err?.message || String(err)}`;
            eventBus?.emit?.("tool.denied", { tool: toolName, args: params, reason, policy: { hookType: "agent", agentType } });
            return { skip: true, value: { ok: false, error: reason, policy: { hookType: "agent", agentType } } };
          }
        }

        continue;
      }
    }

    return null;
  };
}

/**
 * Agent 级别 Hook - 请求入口拦截
 *
 * 用途：鉴权、速率限制、审计初始化
 *
 * @param {{ eventName?: string }} [options]
 * @returns {(ctx: { sessionId?: string, runId?: string, input?: any, context: any }) => Promise<{ skip?: boolean, value?: any, reason?: string } | null>}
 */
export function createPreAgentHook(options = {}) {
  const hookEventName = toNonEmptyString(options?.eventName) || "PreAgent";

  return async ({ sessionId, runId, input, context }) => {
    const eventBus = resolveEventBus(context);
    const registry = getHookRegistry(eventBus);
    if (!registry) return null;

    const hooks = registry.list(hookEventName);
    if (!hooks.length) return null;

    for (const hook of hooks) {
      const blocking = hook.blocking !== false;

      // handler 模式：直接执行自定义函数
      if (typeof hook.handler === "function") {
        try {
          const result = await hook.handler({ sessionId, runId, input, context });
          if (result?.skip && blocking) {
            const reason = toNonEmptyString(result.reason) || "PreAgent hook denied";
            eventBus?.emit?.("agent.denied", { sessionId, runId, reason });
            return { skip: true, value: result.value, reason };
          }
        } catch (err) {
          if (blocking) {
            const reason = `PreAgent hook error: ${err?.message || String(err)}`;
            eventBus?.emit?.("agent.denied", { sessionId, runId, reason });
            return { skip: true, reason };
          }
        }
      }
    }

    return null;
  };
}

/**
 * Agent 级别 Hook - 请求结束处理
 *
 * 用途：用量上报、持久化、审计完成
 *
 * @param {{ eventName?: string }} [options]
 * @returns {(ctx: { sessionId?: string, runId?: string, input?: any, result?: any, error?: Error, duration?: number, context: any }) => Promise<void>}
 */
export function createPostAgentHook(options = {}) {
  const hookEventName = toNonEmptyString(options?.eventName) || "PostAgent";

  return async ({ sessionId, runId, input, result, error, duration, context }) => {
    const eventBus = resolveEventBus(context);
    const registry = getHookRegistry(eventBus);
    if (!registry) return;

    const hooks = registry.list(hookEventName);
    if (!hooks.length) return;

    for (const hook of hooks) {
      if (typeof hook.handler === "function") {
        try {
          await hook.handler({ sessionId, runId, input, result, error, duration, context });
        } catch (err) {
          // PostAgent 错误不阻塞，只记录
          eventBus?.emit?.("agent.hook.error", {
            sessionId,
            runId,
            hookEvent: hookEventName,
            error: err?.message || String(err),
          });
        }
      }
    }
  };
}

export default { createPreToolUseHook, createPreAgentHook, createPostAgentHook };

