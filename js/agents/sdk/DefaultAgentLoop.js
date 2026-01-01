import { BaseAgentLoop } from "../runtime/core/agent-loop.js";
import { robustParseJson } from "../shared/utils/robust-json.js";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toNonEmptyString(value) {
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim();
  return s.length ? s : undefined;
}

function safeInt(value, fallback) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

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

function resolveModelCaller(stageApi, { usage = "worker" } = {}) {
  const api = stageApi && typeof stageApi === "object" ? stageApi : {};
  const defaultSignal = api.signal;

  if (typeof api.callModel === "function") {
    return (messages, opts = {}) => api.callModel(messages, { usage, signal: defaultSignal, ...(opts || {}) });
  }

  const modelRouter = api.modelRouter;
  if (modelRouter && typeof modelRouter.call === "function") {
    const legacySignature = modelRouter.call.length >= 2;
    return (messages, opts = {}) => {
      const forward = opts && typeof opts === "object" ? opts : {};
      const { signal: providedSignal, ...rest } = forward;
      const signal = providedSignal ?? defaultSignal;
      return legacySignature ? modelRouter.call(messages, { usage, signal, ...rest }) : modelRouter.call({ usage, messages, signal, ...rest });
    };
  }

  const aiApiService = api.aiApiService;
  if (aiApiService && typeof aiApiService.chat === "function") {
    return (messages, opts = {}) => {
      const forward = opts && typeof opts === "object" ? opts : {};
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

export class DefaultAgentLoop extends BaseAgentLoop {
  constructor(options = {}) {
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

    this.maxIterations = Math.max(1, safeInt(opts.maxIterations, 8));
    this.maxToolResultChars = Math.max(1000, safeInt(opts.maxToolResultChars, 8000));
    this.usage = toNonEmptyString(opts.usage) || "worker";
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

  async run(input, stageApi = {}) {
    const api = stageApi && typeof stageApi === "object" ? stageApi : {};
    const signal = api.signal;

    const toolExecutor = typeof api.toolExecutor === "function" ? api.toolExecutor : this.toolExecutor;
    const callModel = resolveModelCaller(api, { usage: this.usage });

    // Direct tool invocation mode (no LLM required).
    const requestedTool = toNonEmptyString(input?.tool || input?.capability || input?.action);
    if (requestedTool && toolExecutor) {
      const args = isPlainObject(input?.args) ? input.args : isPlainObject(input?.params) ? input.params : {};
      const ctx = { ...api, signal, state: api.state ?? {} };
      const result = await toolExecutor(requestedTool, args, ctx);
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
    this._messages = [];
    this.addMessage({ role: "system", content: this._buildSystemPrompt() });
    this.addMessage({ role: "user", content: query });

    const toolCalls = [];

    for (let i = 0; i < this.maxIterations; i++) {
      if (signal?.aborted) throw new Error("Run cancelled");
      await this.flushCompression?.();

      const resp = await callModel(this.messages, { signal });
      const content = extractContent(resp);
      this.addMessage({ role: "assistant", content });

      const decision = parseDecision(content);
      if (!decision) {
        return { success: true, mode: "llm", output: content, toolCalls, iterations: i + 1, parsed: false };
      }

      const actions = normalizeActionList(decision);
      let didTool = false;

      for (const step of actions) {
        const action = toNonEmptyString(step.action) || "complete";
        if (action === "complete") {
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
          return { success: false, mode: "llm", error: `No toolExecutor available for action: ${action}`, toolCalls, iterations: i + 1 };
        }

        const args = isPlainObject(step.args) ? step.args : {};
        const ctx = { ...api, signal, state: api.state ?? {} };
        const result = await toolExecutor(action, args, ctx);
        toolCalls.push({ action, args, result });
        didTool = true;

        this.addMessage({
          role: "user",
          content: `Result: ${safeStringify(result, { maxChars: this.maxToolResultChars })}\n\nContinue.`,
        });
      }

      if (!didTool) {
        return { success: true, mode: "llm", output: decision.final || "", toolCalls, iterations: i + 1, parsed: true };
      }
    }

    return { success: false, mode: "llm", error: `Max iterations reached (${this.maxIterations})`, toolCalls, iterations: this.maxIterations };
  }
}

export default DefaultAgentLoop;

