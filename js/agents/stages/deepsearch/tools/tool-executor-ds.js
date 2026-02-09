/**
 * DeepSearch Tool Executor
 */

import { tools } from "./index.js";

function resolveToolQuotaManager(context) {
  const ctx = context && typeof context === "object" ? context : null;
  const direct = ctx?.toolQuotaManager;
  if (direct && typeof direct.tryCall === "function") return direct;
  const stageDirect = ctx?.stageApi?.toolQuotaManager;
  if (stageDirect && typeof stageDirect.tryCall === "function") return stageDirect;

  const container = ctx?.container || ctx?.stageApi?.container;
  if (container && typeof container === "object") {
    const tryGet = typeof container.tryGet === "function" ? container.tryGet.bind(container) : null;
    if (tryGet) {
      const candidate = tryGet("toolQuotaManager");
      if (candidate && typeof candidate.tryCall === "function") return candidate;
    }
    const get = typeof container.get === "function" ? container.get.bind(container) : null;
    if (get) {
      try {
        const candidate = get("toolQuotaManager");
        if (candidate && typeof candidate.tryCall === "function") return candidate;
      } catch {
        // ignore
      }
    }
  }

  return null;
}

function resolveToolQuotaMode(context) {
  const ctx = context && typeof context === "object" ? context : null;
  const cfg = ctx?.toolQuotaConfig || ctx?.toolQuotas || ctx?.stageApi?.toolQuotas || ctx?.stageApi?.toolQuotaConfig || null;
  if (cfg === false || cfg?.enabled === false) return "off";
  const raw = typeof cfg?.mode === "string" ? cfg.mode.trim().toLowerCase() : "";
  if (raw === "off" || raw === "disabled") return "off";
  if (raw === "block" || raw === "enforce") return "block";
  if (raw === "warn" || raw === "warning") return "warn";
  if (cfg?.enforce === true || cfg?.block === true) return "block";
  if (cfg?.warnOnly === true) return "warn";
  return "warn";
}

/**
 * 执行 tool (简单版本，向后兼容)
 */
export async function executeTool(name, args, context) {
  const tool = tools[name];
  if (!tool) {
    return { success: false, error: `Unknown tool: ${name}` };
  }

  const quotaManager = resolveToolQuotaManager(context);
  const quotaMode = quotaManager ? resolveToolQuotaMode(context) : "off";
  const emit = typeof context?.emit === "function" ? context.emit : null;

  const run = async (span) => {
    if (quotaManager && quotaMode !== "off") {
      const q = quotaManager.tryCall(name);
      if (!q.allowed) {
        const stats = typeof quotaManager.getToolStats === "function" ? quotaManager.getToolStats(name) : null;
        emit?.("tool.quota.exceeded", { tool: name, reason: q.reason, stats, mode: quotaMode });
        if (span && typeof span.setStatus === "function") {
          span.setStatus("error", typeof q.reason === "string" ? q.reason : "tool quota exceeded");
        }
        if (quotaMode === "block") {
          return { success: false, error: q.reason || `Quota exceeded for ${name}`, ...(stats ? { quota: stats } : {}) };
        }
        if (typeof quotaManager.recordCall === "function") {
          try {
            quotaManager.recordCall(name);
          } catch {
            // ignore
          }
        }
      }
    }

    try {
      const result = await tool.handler(args, context);
      if (span && result && typeof result === "object" && result.success === false) {
        span.setStatus("error", typeof result.error === "string" ? result.error : "tool returned success:false");
      }
      return result;
    } catch (err) {
      if (span && typeof span.recordException === "function") span.recordException(err);
      const msg = err instanceof Error ? err.message : String(err || "Unknown error");
      const errorName = err instanceof Error ? err.name : "Error";
      const code =
        err && typeof err === "object" && "code" in err && (typeof err.code === "string" || typeof err.code === "number")
          ? err.code
          : null;
      // Note: stack is intentionally omitted from the return to prevent information leakage.
      // The span.recordException above captures the full error for internal debugging.
      return {
        success: false,
        error: msg,
        errorName,
        ...(code !== null ? { errorCode: code } : {}),
      };
    }
  };

  const traceContext = context?.traceContext || context?.stageApi?.traceContext;
  if (traceContext && typeof traceContext.withSpan === "function") {
    return await traceContext.withSpan(
      `deepsearch.tool.${name}`,
      async (span) => {
        const runId =
          (context?.stageApi?.runContext && context.stageApi.runContext.runId) ||
          context?.state?.runId ||
          context?.stageApi?.runId ||
          null;
        span.setAttributes({
          tool: name,
          ...(runId ? { runId } : {}),
          argKeys: args && typeof args === "object" ? Object.keys(args).length : 0,
        });

        return await run(span);
      },
      { attributes: { tool: name } }
    );
  }

  return await run(null);
}

// 复用 runtime 统一的 ToolExecutor
import { ToolExecutor as BaseToolExecutor, createToolExecutor } from "../../../runtime/index.js";
export { createToolExecutor };
export { BaseToolExecutor as ToolExecutor };

/**
 * 创建预配置的 DeepSearch ToolExecutor
 */
export function createDeepSearchToolExecutor(options = {}) {
  return new BaseToolExecutor({ tools, ...options });
}

