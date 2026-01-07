/**
 * @typedef {object} SerializedError
 * @property {string} name
 * @property {string} message
 * @property {string} [stack]
 *
 * @typedef {object} ToolWorkerExecuteMessage
 * @property {"execute"} type
 * @property {string} moduleUrl
 * @property {string|null} [exportName]
 * @property {any} [args]
 * @property {any} [context]
 *
 * @typedef {object} ToolWorkerResultMessage
 * @property {"result"} type
 * @property {any} result
 *
 * @typedef {object} ToolWorkerErrorMessage
 * @property {"error"} type
 * @property {SerializedError} error
 *
 * @typedef {(args: any, context: any) => (any | Promise<any>)} ToolHandler
 */

/**
 * @param {unknown} err
 * @returns {SerializedError}
 */
function serializeError(err) {
  if (!err) return { name: "Error", message: "Unknown error" };
  /** @type {any} */
  const e = err;
  return {
    name: typeof e.name === "string" ? e.name : "Error",
    message: typeof e.message === "string" ? e.message : String(e),
    stack: typeof e.stack === "string" ? e.stack : undefined,
  };
}

/**
 * @param {any} mod
 * @param {string|null|undefined} exportName
 * @returns {ToolHandler|null}
 */
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

/**
 * @param {ToolWorkerExecuteMessage} msg
 * @returns {Promise<any>}
 */
async function handleExecute(msg) {
  const moduleUrl = typeof msg?.moduleUrl === "string" ? msg.moduleUrl : "";
  const exportName = typeof msg?.exportName === "string" ? msg.exportName : null;
  const args = msg?.args;
  const context = msg?.context;

  const mod = await import(moduleUrl);
  const handler = resolveHandler(mod, exportName);
  if (typeof handler !== "function") {
    throw new Error(`Worker tool handler not found (moduleUrl=${moduleUrl}, export=${exportName || "auto"})`);
  }
  return await handler(args, context);
}

/**
 * @param {MessageEvent} event
 * @returns {Promise<void>}
 */
self.onmessage = async (event) => {
  /** @type {ToolWorkerExecuteMessage} */
  const msg = event?.data;
  if (msg?.type !== "execute") return;

  try {
    const result = await handleExecute(msg);
    self.postMessage({ type: "result", result });
  } catch (err) {
    self.postMessage({ type: "error", error: serializeError(err) });
  }
};
