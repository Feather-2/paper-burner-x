import { createToolExecutorHandler } from "./tool-executor-worker-shared.js";

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
  postMessage: (msg) => self.postMessage(msg),
  onMessage: (cb) => self.addEventListener("message", (event) => cb(normalizeMessage(event?.data))),
  close: () => self.close?.(),
});
