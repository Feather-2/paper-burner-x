/**
 * DeepSearch Tools Index
 *
 * 导出所有可用的 tools，供 agent-loop 使用
 * Tools 是原子化的执行单元，由模型直接调用
 */

import listDocs from "./list-docs/handler.js";
import readDoc from "./read-doc/handler.js";
import manageTodos from "./manage-todos/handler.js";
import searchDocs from "./search-docs/handler.js";
import writeReport from "./write-report/handler.js";
import watchdog from "./watchdog/handler.js";
import evaluateGaps from "./evaluate-gaps/handler.js";
import crossVerify from "./cross-verify/handler.js";
import refinePlanning from "./refine-planning/handler.js";
import task from "./task/handler.js";
import askUser from "./ask-user/handler.js";
import getTaskResult from "./get-task-result/handler.js";
import adviseTask from "./advise-task/handler.js";
import skill from "./skill/handler.js";
import recordFinding from "./record-finding/handler.js";
import getArtifact from "./get-artifact/handler.js";

export const tools = {
  "list-docs": listDocs,
  "read-doc": readDoc,
  "manage-todos": manageTodos,
  "search-docs": searchDocs,
  "write-report": writeReport,
  "watchdog": watchdog,
  "evaluate-gaps": evaluateGaps,
  "cross-verify": crossVerify,
  "refine-planning": refinePlanning,
  "Task": task,
  "task": task,
  "ask-user": askUser,
  "get-task-result": getTaskResult,
  "advise-task": adviseTask,
  "skill": skill,
  "record-finding": recordFinding,
  "get-artifact": getArtifact,
};

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
 * 获取所有 tool 定义（给模型选择用）
 */
export function getToolDefinitions() {
  return Object.values(tools).map(t => t.definition);
}

/**
 * 三层优先级常量
 */
export const ToolPriority = {
  CRITICAL: "critical",   // 🔴 核心工具
  IMPORTANT: "important", // 🟡 重要工具 (默认)
  OPTIONAL: "optional",   // ⚪ 可选工具
};

/**
 * 获取 tool 的优先级
 */
function getToolPriority(tool) {
  const def = tool.definition || tool;
  const priority = def.priority;

  if (priority === "critical" || priority === 0) return "critical";
  if (priority === "optional" || priority === 2) return "optional";
  return "important";
}

/**
 * 获取 tool catalog prompt (按优先级排序)
 * 
 * 三层优先级机制:
 * - critical: 核心工具，始终在最前面 (🔴)
 * - important: 重要工具，紧随其后 (🟡) - 默认
 * - optional: 可选工具，放在最后 (⚪)
 * 
 * @param {Object} [options]
 * @param {boolean} [options.showPriority] - 是否显示优先级分组标题
 * @returns {string}
 */
export function getToolCatalogPrompt(options = {}) {
  const { showPriority = true } = options;

  // 按优先级分组
  const critical = [];
  const important = [];
  const optional = [];

  for (const [name, tool] of Object.entries(tools)) {
    const priority = getToolPriority(tool);
    const entry = { name, tool, priority };

    if (priority === "critical") {
      critical.push(entry);
    } else if (priority === "optional") {
      optional.push(entry);
    } else {
      important.push(entry);
    }
  }

  const lines = ["## 可用工具\\n"];

  const renderGroup = (group, title, icon) => {
    if (group.length === 0) return;
    if (showPriority) {
      lines.push(`### ${icon} ${title}\\n`);
    }
    for (const { name, tool } of group) {
      const def = tool.definition || {};
      const params = def.parameters
        ? Object.keys(def.parameters).join(", ")
        : "";
      lines.push(`**${name}**${params ? ` (参数: ${params})` : ""}`);
      lines.push(`  ${def.description || "无描述"}`);
      lines.push("");
    }
  };

  // 按优先级顺序渲染
  renderGroup(critical, "核心工具", "🔴");
  renderGroup(important, "标准工具", "🟡");
  renderGroup(optional, "辅助工具", "⚪");

  return lines.join("\\n");
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
import { ToolExecutor as BaseToolExecutor, createToolExecutor } from "../../../runtime/tools/tool-executor.js";
export { createToolExecutor };
export { BaseToolExecutor as ToolExecutor };

/**
 * 创建预配置的 DeepSearch ToolExecutor
 */
export function createDeepSearchToolExecutor(options = {}) {
  return new BaseToolExecutor({ tools, ...options });
}

export default tools;
