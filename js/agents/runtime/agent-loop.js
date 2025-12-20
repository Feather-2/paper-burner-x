const USER_ACTION_PREFIX = "user.action";

export function getEmitFn(ctx) {
  const emit = ctx?.emit || ctx?.eventBus?.emit;
  return typeof emit === "function" ? emit : null;
}

export function checkCancelled(signal) {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  throw new Error(typeof reason === "string" ? reason : "Run cancelled");
}

export function normalizeToolResult(result) {
  if (result && typeof result === "object" && Object.prototype.hasOwnProperty.call(result, "ok")) {
    return result;
  }
  if (result && typeof result === "object" && ("error" in result || "data" in result)) {
    return { ok: !result.error, data: result.data, error: result.error };
  }
  return { ok: true, data: result };
}

export function resolveToolExecutor(context) {
  const executor = context?.toolExecutor || context?.tools;
  if (typeof executor === "function") return executor;
  if (executor && typeof executor.execute === "function") return (name, params) => executor.execute(name, params);
  return null;
}

export class BaseAgentLoop {
  constructor({ eventBus, stateMachine, tools, actor, stageName, emit } = {}) {
    this.eventBus = eventBus || null;
    this.stateMachine = stateMachine || null;
    this.actor = actor || stageName || "agent";
    this.stageName = stageName || actor || "agent";
    this.emit = typeof emit === "function" ? emit : null;
    this._tools = {};
    this.registerTools(tools);
  }

  registerTools(tools) {
    if (!tools) return;
    if (tools instanceof Map) {
      for (const [name, fn] of tools.entries()) {
        this.registerTool(name, fn);
      }
      return;
    }
    if (Array.isArray(tools)) {
      for (const [name, fn] of tools) {
        this.registerTool(name, fn);
      }
      return;
    }
    if (typeof tools === "object") {
      for (const [name, fn] of Object.entries(tools)) {
        this.registerTool(name, fn);
      }
      return;
    }
    throw new TypeError("BaseAgentLoop.registerTools: tools must be an object, array, or map");
  }

  registerTool(name, fn) {
    if (!name || typeof name !== "string") {
      throw new TypeError("BaseAgentLoop.registerTool: name must be a non-empty string");
    }
    if (typeof fn !== "function") {
      throw new TypeError("BaseAgentLoop.registerTool: fn must be a function");
    }
    this._tools[name] = fn;
  }

  _emitStage(name, status, payload) {
    const emit = this.emit || this.eventBus?.emit;
    if (typeof emit !== "function") return;
    emit(name, { actor: this.actor, status, payload });
  }

  async _callTool(name, params, context) {
    const executor = resolveToolExecutor(context);
    if (executor) {
      return normalizeToolResult(await executor(name, params, context));
    }
    const tool = this._tools[name];
    if (!tool) {
      return { ok: false, error: `Unknown tool: ${name}` };
    }
    try {
      const data = await tool(params, context);
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  _transitionPhase(state, next, { emit, runId, payload, eventName } = {}) {
    const from = state?.status ?? state?.state;
    let ok = true;
    if (this.stateMachine && typeof this.stateMachine.transition === "function") {
      ok = this.stateMachine.transition(state, next, { runId, from, to: next, ...payload });
    } else if (state && typeof state === "object") {
      if ("status" in state) state.status = next;
      else if ("state" in state) state.state = next;
      else state.status = next;
    }

    if (!ok) {
      throw new Error(`${this.stageName} phase transition rejected: ${from} -> ${next}`);
    }

    const emitFn = emit || this.emit || this.eventBus?.emit;
    if (typeof emitFn === "function") {
      emitFn(eventName || `${this.stageName}.phase.transition`, {
        actor: this.actor,
        status: "progress",
        payload: { runId, from, to: next, ...payload },
      });
    }

    return next;
  }

  async waitForUserAction(actionName, { timeout = 300000, eventBus, signal } = {}) {
    const bus = eventBus || this.eventBus;
    if (!bus || typeof bus.subscribe !== "function") {
      throw new Error("waitForUserAction: eventBus with subscribe() is required");
    }

    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (err, payload) => {
        if (done) return;
        done = true;
        clearTimeout(timeoutId);
        off?.();
        if (signal && typeof signal.removeEventListener === "function") {
          signal.removeEventListener("abort", onAbort);
        }
        if (err) reject(err);
        else resolve(payload);
      };

      const onAbort = () => {
        finish(new Error("Run cancelled"));
      };

      if (signal && typeof signal.addEventListener === "function") {
        signal.addEventListener("abort", onAbort, { once: true });
      }

      const timeoutId = setTimeout(() => {
        finish(new Error(`Timeout waiting for user action: ${actionName}`));
      }, timeout);

      const off = bus.subscribe(`${USER_ACTION_PREFIX}.${actionName}`, (evt) => {
        const payload = evt && typeof evt === "object" && "payload" in evt ? evt.payload : evt;
        finish(null, payload);
      });
    });
  }

  async run() {
    throw new Error("BaseAgentLoop.run() is not implemented");
  }

  async execute(runContext, input, stageApi = {}) {
    const context = { ...stageApi, runContext };
    this.eventBus = stageApi.eventBus || this.eventBus || null;
    this.emit = getEmitFn(stageApi) || this.emit || this.eventBus?.emit || null;
    return this.run(input, context);
  }
}
