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

export const TOOL_NAME_ALIASES = Object.freeze({
  Task: "task",
});

export function resolveToolName(name) {
  const raw = typeof name === "string" ? name : String(name ?? "");
  return TOOL_NAME_ALIASES[raw] || raw;
}

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

export * from "./tool-executor-ds.js";
export * from "./tool-catalog.js";

export default tools;
