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
  "ask-user": askUser,
  "get-task-result": getTaskResult,
  "advise-task": adviseTask,
  "skill": skill,
  "record-finding": recordFinding,
};

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
 * @param {Object} options
 * @param {boolean} options.showPriority - 是否显示优先级分组标题
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
 * 执行 tool
 */
export async function executeTool(name, args, context) {
  const tool = tools[name];
  if (!tool) {
    return { success: false, error: `Unknown tool: ${name}` };
  }

  try {
    return await tool.handler(args, context);
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export default tools;
