import { BaseAgentLoop, checkCancelled } from "../runtime/core/agent-loop.js";
import { robustParseJson } from "../shared/utils/robust-json.js";
import { isPlainObject, safeInt, toNonEmptyString } from "../shared/utils/value-utils.js";
import { createDefaultMiddlewareChain } from "../runtime/middleware/middleware-chain.js";
import { AgentCheckpointStore } from "../runtime/checkpoints/agent-checkpoint-store.js";
import { ensureRuntimeState } from "../runtime/telemetry/loop-runtime-state.js";

function truncateText(text, maxChars) {
  const s = typeof text === "string" ? text : String(text ?? "");
  const limit = typeof maxChars === "number" && Number.isFinite(maxChars) ? Math.max(0, Math.floor(maxChars)) : 0;
  if (!limit || s.length <= limit) return s;
  const head = Math.max(0, Math.floor(limit * 0.7));
  const tail = Math.max(0, limit - head - 16);
  const a = s.slice(0, head);
  const b = tail ? s.slice(Math.max(0, s.length - tail)) : "";
  return `${a}\n...(truncated ${s.length - limit} chars)...\n${b}`;
}

function safeStringify(value, { maxChars = 8000 } = {}) {
  try {
    const raw = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    return truncateText(raw, maxChars);
  } catch {
    return truncateText(String(value ?? ""), maxChars);
  }
}

/**
 * @typedef {object} ResolveModelCallerOptions
 * @property {string} [usage]
 */

/**
 * @typedef {object} StageApiForModelCaller
 * @property {AbortSignal} [signal]
 * @property {Function} [callModel]
 * @property {any} [modelRouter]
 * @property {any} [aiApiService]
 */

/**
 * @param {StageApiForModelCaller} stageApi
 * @param {ResolveModelCallerOptions} [options]
 */
function resolveModelCaller(stageApi, { usage = "worker" } = {}) {
  /** @type {StageApiForModelCaller} */
  const api = stageApi && typeof stageApi === "object" ? stageApi : {};
  const defaultSignal = api.signal;

  if (typeof api.callModel === "function") {
    return (messages, opts = {}) => api.callModel(messages, { usage, signal: defaultSignal, ...(opts || {}) });
  }

  const modelRouter = api.modelRouter;
  if (modelRouter && typeof modelRouter.call === "function") {
    const legacySignature = modelRouter.call.length >= 2;
    return (messages, opts = {}) => {
      const forward = /** @type {any} */ (opts && typeof opts === "object" ? opts : {});
      const { signal: providedSignal, ...rest } = forward;
      const signal = providedSignal ?? defaultSignal;
      return legacySignature ? modelRouter.call(messages, { usage, signal, ...rest }) : modelRouter.call({ usage, messages, signal, ...rest });
    };
  }

  const aiApiService = api.aiApiService;
  if (aiApiService && typeof aiApiService.chat === "function") {
    return (messages, opts = {}) => {
      const forward = /** @type {any} */ (opts && typeof opts === "object" ? opts : {});
      const { signal: providedSignal, ...rest } = forward;
      const signal = providedSignal ?? defaultSignal;
      return aiApiService.chat({ messages, usage, signal, ...rest });
    };
  }

  return null;
}

function extractContent(modelResponse) {
  if (modelResponse === null || modelResponse === undefined) return "";
  if (typeof modelResponse === "string") return modelResponse;
  if (typeof modelResponse === "object") {
    if (typeof modelResponse.content === "string") return modelResponse.content;
    if (typeof modelResponse.text === "string") return modelResponse.text;
    if (typeof modelResponse.message?.content === "string") return modelResponse.message.content;
  }
  return String(modelResponse);
}

function parseDecision(content) {
  const parsed = robustParseJson(content);
  if (!parsed) return null;
  if (Array.isArray(parsed.actions) && parsed.actions.length > 0) {
    return {
      thought: toNonEmptyString(parsed.thought) || "",
      actions: parsed.actions,
    };
  }
  return {
    thought: toNonEmptyString(parsed.thought) || "",
    action: toNonEmptyString(parsed.action) || "complete",
    args: isPlainObject(parsed.args) ? parsed.args : {},
    final: toNonEmptyString(parsed.final) || toNonEmptyString(parsed.answer) || "",
  };
}

function normalizeActionList(decision) {
  const d = decision && typeof decision === "object" ? decision : null;
  if (!d) return [];
  if (Array.isArray(d.actions)) {
    return d.actions
      .map((a) => (a && typeof a === "object" ? a : null))
      .filter(Boolean)
      .map((a) => ({
        action: toNonEmptyString(a.action) || "complete",
        args: isPlainObject(a.args) ? a.args : {},
        final: toNonEmptyString(a.final) || toNonEmptyString(a.answer) || "",
      }));
  }
  return [
    {
      action: toNonEmptyString(d.action) || "complete",
      args: isPlainObject(d.args) ? d.args : {},
      final: toNonEmptyString(d.final) || "",
    },
  ];
}

function normalizeCheckpointOptions(input) {
  if (input === true) return { enabled: true };
  if (input === false || input === null || input === undefined) return {};
  if (typeof input === "string" || typeof input === "number") {
    return { enabled: true, restore: input };
  }
  if (isPlainObject(input)) return { ...input };
  return {};
}

function normalizeRestoreRequest(input) {
  if (input === null || input === undefined || input === false) return null;
  if (input === true || input === "last" || input === "latest") return { mode: "last" };

  if (typeof input === "number") {
    const step = safeInt(input);
    return step === null ? null : { mode: "step", step };
  }

  if (typeof input === "string") {
    return { mode: "checkpoint", checkpointId: input };
  }

  if (isPlainObject(input)) {
    const checkpointId = toNonEmptyString(input.checkpointId || input.id);
    const step = safeInt(input.step);
    const modeRaw = toNonEmptyString(input.mode)?.toLowerCase();
    const mode = modeRaw || (checkpointId ? "checkpoint" : step !== null ? "step" : "last");
    return {
      mode,
      ...(checkpointId ? { checkpointId } : {}),
      ...(step !== null ? { step } : {}),
    };
  }

  return null;
}

function resolveCheckpointStore(api, { runId, logger, fallbackStore } = {}) {
  const direct = api?.checkpointStore || api?.checkpoints || null;
  if (direct && typeof direct.saveCheckpoint === "function" && typeof direct.loadCheckpoint === "function") {
    return direct;
  }
  if (fallbackStore && typeof fallbackStore.saveCheckpoint === "function" && typeof fallbackStore.loadCheckpoint === "function") {
    return fallbackStore;
  }

  const vfs = api?.vfs || null;
  const storageAdapter = api?.storageAdapter || api?.vfs?.storageAdapter || null;
  if (!vfs && !storageAdapter) return null;
  return new AgentCheckpointStore({ vfs, storageAdapter, runId, logger });
}

/**
 * @typedef {object} DefaultAgentLoopOptions
 * @property {string} [actor]
 * @property {string} [stageName]
 * @property {any} [eventBus]
 * @property {any} [logger]
 * @property {Function} [toolExecutor]
 * @property {Map<string, any>} [capabilities]
 * @property {Function} [getCatalogPrompt]
 * @property {number} [maxIterations]
 * @property {number} [maxToolResultChars]
 * @property {string} [usage]
 * @property {{ execute: Function }} [middlewareChain]
 * @property {string} [permissionLevel]
 * @property {any} [toolRestrictions]
 * @property {any} [checkpointStore]
 * @property {any} [checkpoint]
 *
 * @typedef {object} StageApiLike
 * @property {AbortSignal} [signal]
 * @property {Function} [toolExecutor]
 * @property {any} [modelRouter]
 * @property {any} [aiApiService]
 * @property {{ execute: Function }} [middlewareChain]
 * @property {Function} [emit]
 * @property {any} [logger]
 * @property {any} [callModel]
 * @property {any} [state]
 * @property {string} [permissionLevel]
 * @property {any} [toolRestrictions]
 * @property {string} [runId]
 * @property {any} [vfs]
 * @property {any} [storageAdapter]
 * @property {any} [checkpointStore]
 * @property {any} [checkpoint]
 */

export class DefaultAgentLoop extends BaseAgentLoop {
  /**
   * @param {DefaultAgentLoopOptions} [options]
   */
  constructor(options = {}) {
    /** @type {DefaultAgentLoopOptions} */
    const opts = options && typeof options === "object" ? options : {};
    super({
      actor: opts.actor || "agent",
      stageName: opts.stageName || opts.actor || "agent",
      eventBus: opts.eventBus || null,
      logger: opts.logger || null,
    });

    this.toolExecutor = typeof opts.toolExecutor === "function" ? opts.toolExecutor : null;
    this.capabilities = opts.capabilities instanceof Map ? opts.capabilities : null;
    this.getCatalogPrompt = typeof opts.getCatalogPrompt === "function" ? opts.getCatalogPrompt : null;

    this.maxIterations = Math.max(1, safeInt(opts.maxIterations) ?? 8);
    this.maxToolResultChars = Math.max(1000, safeInt(opts.maxToolResultChars) ?? 8000);
    this.usage = toNonEmptyString(opts.usage) || "worker";
    this.permissionLevel = toNonEmptyString(opts.permissionLevel) || null;
    this.toolRestrictions = opts.toolRestrictions ?? null;
    this.checkpointStore = opts.checkpointStore || null;
    this.checkpointOptions = opts.checkpoint || null;

    // Default (no-op) middleware chain to avoid dead-code and keep integration points available.
    // Callers can inject their own chain via opts.middlewareChain or stageApi.middlewareChain.
    this._middlewareChain =
      opts.middlewareChain && typeof opts.middlewareChain.execute === "function" ? opts.middlewareChain : createDefaultMiddlewareChain({});
  }

  _buildSystemPrompt() {
    const catalog = this.getCatalogPrompt ? this.getCatalogPrompt() : "";
    const toolList = this.capabilities instanceof Map ? Array.from(this.capabilities.keys()) : [];
    const toolNames = toolList.length ? toolList.join(", ") : "(none)";

    return [
      "You are a tool-using agent.",
      "",
      "Return ONLY valid JSON (no markdown, no extra text).",
      "",
      "Decision schema:",
      "{",
      '  "thought": "short internal note",',
      '  "action": "one of: <capability name> | complete",',
      '  "args": { "tool": "args" },',
      '  "final": "when action=complete, put the final user-facing answer here"',
      "}",
      "",
      "You may also batch with:",
      '{ "actions": [ { "action": "...", "args": {...} }, ... ] }',
      "",
      `Available capability names: ${toolNames}`,
      catalog ? `\n${catalog}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  /**
   * @param {any} input
   * @param {StageApiLike} [stageApi]
   */
  async run(input, stageApi = {}) {
    /** @type {StageApiLike} */
    const api = stageApi && typeof stageApi === "object" ? stageApi : {};
    const signal = api.signal;

    const toolExecutor = typeof api.toolExecutor === "function" ? api.toolExecutor : this.toolExecutor;
    const callModel = resolveModelCaller(api, { usage: this.usage });
    const middlewareChain =
      api.middlewareChain && typeof api.middlewareChain.execute === "function" ? api.middlewareChain : this._middlewareChain;

    const emit =
      typeof api.emit === "function"
        ? api.emit
        : this.eventBus && typeof this.eventBus.emit === "function"
          ? (event, payload) => this.eventBus.emit(event, payload)
          : null;

    const permissionLevel = toNonEmptyString(api.permissionLevel) || this.permissionLevel || null;
    const toolRestrictions = api.toolRestrictions ?? this.toolRestrictions ?? null;

    const baseCtx = {
      ...api,
      signal,
      emit,
      logger: api.logger ?? this.logger,
      actor: this.actor,
      stageName: this.stageName,
      ...(permissionLevel ? { permissionLevel } : {}),
      ...(toolRestrictions ? { toolRestrictions } : {}),
    };

    const inputObj = isPlainObject(input) ? input : null;
    const mergedCheckpointOptions = {
      ...normalizeCheckpointOptions(this.checkpointOptions),
      ...normalizeCheckpointOptions(api.checkpoint),
      ...normalizeCheckpointOptions(inputObj?.checkpoint),
    };
    const restoreRequest = normalizeRestoreRequest(
      mergedCheckpointOptions.restore ?? api.restoreCheckpoint ?? inputObj?.restoreCheckpoint ?? null
    );
    let runId =
      toNonEmptyString(api.runId) ||
      toNonEmptyString(mergedCheckpointOptions.runId) ||
      toNonEmptyString(inputObj?.runId) ||
      toNonEmptyString(api?.state?.runId) ||
      null;

    const checkpointStore = resolveCheckpointStore(api, {
      runId,
      logger: api.logger ?? this.logger,
      fallbackStore: this.checkpointStore,
    });
    const persistSetting = mergedCheckpointOptions.persist ?? mergedCheckpointOptions.enabled ?? null;
    const shouldPersist =
      !!checkpointStore && (persistSetting === true || (persistSetting !== false && restoreRequest));
    const checkpointInterval = Math.max(1, safeInt(mergedCheckpointOptions.interval ?? mergedCheckpointOptions.every) ?? 1);

    if (!runId && checkpointStore?.runId) {
      runId = checkpointStore.runId;
    }
    if (!runId && shouldPersist) {
      runId = Date.now().toString();
      if (checkpointStore && "runId" in checkpointStore) {
        checkpointStore.runId = runId;
      }
    }

    const runWithMiddleware = async (stepName, handler, extra = {}) => {
      const ctx = { ...baseCtx, ...extra, stepName, phase: stepName, state: api.state ?? {}, messages: this.messages };
      if (middlewareChain && typeof middlewareChain.execute === "function") {
        return middlewareChain.execute(ctx, () => handler(ctx));
      }
      return handler(ctx);
    };

    // Direct tool invocation mode (no LLM required).
    const requestedTool = toNonEmptyString(input?.tool || input?.capability || input?.action);
    if (requestedTool && toolExecutor) {
      const args = isPlainObject(input?.args) ? input.args : isPlainObject(input?.params) ? input.params : {};
      const result = await runWithMiddleware(`tool:${requestedTool}`, (ctx) => toolExecutor(requestedTool, args, ctx), {
        tool: requestedTool,
        args,
      });
      return { success: true, mode: "tool", tool: requestedTool, result };
    }

    const query = typeof input === "string" ? input : toNonEmptyString(input?.query || input?.prompt || input?.message || input?.text) || "";
    if (!query) {
      return {
        success: true,
        mode: "idle",
        capabilities: this.capabilities instanceof Map ? Array.from(this.capabilities.keys()) : [],
        message: "No query provided. Pass {query} or a tool request {tool,args}.",
      };
    }

    if (!callModel) {
      return {
        success: false,
        mode: "no_model",
        error: "No model caller configured. Provide { modelRouter } or { aiApiService } in run context, or call a tool directly via {tool,args}.",
      };
    }

    // LLM-driven loop.
    let toolCalls = [];
    let results = [];
    let startIteration = 0;

    let restored = null;
    if (checkpointStore && restoreRequest && runId) {
      try {
        restored = await checkpointStore.loadCheckpoint({ runId, ...restoreRequest });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err ?? "");
        (api.logger ?? this.logger)?.warn?.(`[DefaultAgentLoop] Restore checkpoint failed: ${msg}`);
      }
    }

    let seededMessages = null;
    if (restored && typeof restored === "object") {
      seededMessages = Array.isArray(restored.messages) ? restored.messages : null;
      toolCalls = Array.isArray(restored.toolCalls) ? restored.toolCalls.slice() : [];
      results = Array.isArray(restored.results) ? restored.results.slice() : [];

      const restoredIteration = safeInt(restored.iteration) ?? safeInt(restored.metadata?.iteration) ?? 0;
      startIteration = Math.max(0, restoredIteration);

      if (!runId) {
        runId = toNonEmptyString(restored.runId) || runId;
      }
      if (runId && checkpointStore && "runId" in checkpointStore) {
        checkpointStore.runId = runId;
      }
    }

    if (seededMessages) {
      await this.resetMessages();
      this.addMessages(seededMessages);
    } else {
      await this.resetMessages();
      this.addMessage({ role: "system", content: this._buildSystemPrompt() });
      this.addMessage({ role: "user", content: query });
    }

    const saveCheckpoint = async ({ iteration, status, output, force = false } = {}) => {
      if (!shouldPersist || !checkpointStore || !runId) return null;
      if (!force && iteration && iteration % checkpointInterval !== 0) return null;

      const metadata = {
        actor: this.actor,
        stageName: this.stageName,
        usage: this.usage,
        ...(isPlainObject(mergedCheckpointOptions.metadata) ? mergedCheckpointOptions.metadata : {}),
        ...(status ? { status } : {}),
        ...(output ? { outputPreview: output } : {}),
      };

      const saved = await checkpointStore.saveCheckpoint({
        runId,
        messages: this.messages,
        toolCalls,
        results,
        metadata,
        step: iteration ?? null,
        iteration: iteration ?? null,
      });

      if (saved?.checkpointId && signal) {
        const runtimeState = ensureRuntimeState(signal);
        runtimeState.lastCheckpointId = saved.checkpointId;
      }

      emit?.("archive.checkpoint.saved", {
        runId,
        checkpointId: saved?.checkpointId,
        iteration: iteration ?? undefined,
      });

      return saved?.checkpointId || null;
    };

    for (let i = startIteration; i < this.maxIterations; i++) {
      checkCancelled(signal);
      await this.flushCompression?.();

      const resp = await runWithMiddleware(
        "callModel",
        (ctx) => callModel(Array.isArray(ctx.messages) ? ctx.messages : this.messages, { signal: ctx.signal }),
        { messages: this.messages }
      );
      const content = extractContent(resp);
      this.addMessage({ role: "assistant", content });
      results.push({ kind: "model", iteration: i + 1, content });

      const decision = parseDecision(content);
      if (!decision) {
        await saveCheckpoint({ iteration: i + 1, status: "unparsed", output: content, force: true });
        return { success: true, mode: "llm", output: content, toolCalls, iterations: i + 1, parsed: false };
      }

      const actions = normalizeActionList(decision);
      let didTool = false;

      for (const step of actions) {
        const action = toNonEmptyString(step.action) || "complete";
        if (action === "complete") {
          results.push({ kind: "final", iteration: i + 1, output: step.final || "" });
          await saveCheckpoint({ iteration: i + 1, status: "completed", output: step.final || "", force: true });
          return {
            success: true,
            mode: "llm",
            output: step.final || "",
            toolCalls,
            iterations: i + 1,
            parsed: true,
          };
        }

        if (!toolExecutor) {
          results.push({ kind: "error", iteration: i + 1, error: `No toolExecutor available for action: ${action}` });
          await saveCheckpoint({
            iteration: i + 1,
            status: "error",
            output: `No toolExecutor available for action: ${action}`,
            force: true,
          });
          return { success: false, mode: "llm", error: `No toolExecutor available for action: ${action}`, toolCalls, iterations: i + 1 };
        }

        const args = isPlainObject(step.args) ? step.args : {};
        const result = await runWithMiddleware(`tool:${action}`, (ctx) => toolExecutor(action, args, ctx), { tool: action, args });
        toolCalls.push({ action, args, result });
        results.push({ kind: "tool", iteration: i + 1, tool: action, result });
        didTool = true;

        this.addMessage({
          role: "user",
          content: `Result: ${safeStringify(result, { maxChars: this.maxToolResultChars })}\n\nContinue.`,
        });
      }

      if (!didTool) {
        results.push({ kind: "final", iteration: i + 1, output: decision.final || "" });
        await saveCheckpoint({ iteration: i + 1, status: "completed", output: decision.final || "", force: true });
        return { success: true, mode: "llm", output: decision.final || "", toolCalls, iterations: i + 1, parsed: true };
      }

      await saveCheckpoint({ iteration: i + 1, status: "iteration" });
    }

    await saveCheckpoint({ iteration: this.maxIterations, status: "max_iterations", force: true });
    return { success: false, mode: "llm", error: `Max iterations reached (${this.maxIterations})`, toolCalls, iterations: this.maxIterations };
  }
}

export default DefaultAgentLoop;
