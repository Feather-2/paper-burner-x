import { parentPort } from "node:worker_threads";

function serializeError(err) {
  if (!err) return { name: "Error", message: "Unknown error" };
  return {
    name: typeof err.name === "string" ? err.name : "Error",
    message: typeof err.message === "string" ? err.message : String(err),
    stack: typeof err.stack === "string" ? err.stack : undefined,
  };
}

function resolveHandler(mod, exportName) {
  const named = typeof exportName === "string" && exportName.length ? exportName : null;
  if (named) {
    if (typeof mod?.[named] === "function") return mod[named];
    if (typeof mod?.default?.[named] === "function") return mod.default[named];
    return null;
  }

  if (typeof mod?.default?.handler === "function") return mod.default.handler;
  if (typeof mod?.handler === "function") return mod.handler;
  if (typeof mod?.default === "function") return mod.default;
  return null;
}

if (!parentPort) {
  throw new Error("tool-executor-worker: missing parentPort");
}

parentPort.on("message", async (msg) => {
  if (msg?.type !== "execute") return;

  const moduleUrl = typeof msg?.moduleUrl === "string" ? msg.moduleUrl : "";
  const exportName = typeof msg?.exportName === "string" ? msg.exportName : null;
  const args = msg?.args;
  const context = msg?.context;

  try {
    const mod = await import(moduleUrl);
    const handler = resolveHandler(mod, exportName);
    if (typeof handler !== "function") {
      throw new Error(`Worker tool handler not found (moduleUrl=${moduleUrl}, export=${exportName || "auto"})`);
    }
    const result = await handler(args, context);
    parentPort.postMessage({ type: "result", result });
  } catch (err) {
    parentPort.postMessage({ type: "error", error: serializeError(err) });
  }
});

