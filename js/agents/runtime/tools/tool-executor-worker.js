/**
 * @ts-ignore - 浏览器构建不包含 @types/node，此导入在浏览器环境会被打包工具替换
 * @module
 * @platform node - This module uses node:worker_threads; browser builds should
 * exclude or stub this file via bundler configuration.
 */
// @ts-ignore
import { parentPort } from "node:worker_threads";
import { createToolExecutorHandler } from "./tool-executor-worker-shared.js";

if (!parentPort) {
  throw new Error("tool-executor-worker: missing parentPort");
}

/**
 * @param {any} data
 */
function normalizeMessage(data) {
  if (!data || typeof data !== "object") return data;
  if (data.type !== "execute") return data;

  const hasLegacyShape = "exportName" in data || "context" in data;
  if (hasLegacyShape) {
    const handlerName = typeof data.exportName === "string" && data.exportName.length ? data.exportName : "handler";
    return {
      type: "execute",
      id: data.id,
      moduleUrl: data.moduleUrl,
      handlerName,
      args: [data.args, data.context],
    };
  }

  return {
    type: "execute",
    id: data.id,
    moduleUrl: data.moduleUrl,
    handlerName: data.handlerName,
    args: Array.isArray(data.args) ? data.args : [],
  };
}

createToolExecutorHandler({
  postMessage: (msg) => parentPort.postMessage(msg),
  onMessage: (cb) => parentPort.on("message", (data) => cb(normalizeMessage(data))),
  close: () => parentPort.close?.(),
});
