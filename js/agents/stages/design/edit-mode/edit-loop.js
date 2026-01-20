import { EditSessionStatus, editSessionMachine } from "../states.js";
import { EditOperationType } from "../constants.js";
import { EditModeTools, createEditToolExecutor } from "./tools.js";
import { EditHistoryManager } from "./history.js";

import { isPlainObject } from "../shared/design-utils.js";

function ensureState(initialState) {
  if (!isPlainObject(initialState)) throw new TypeError("Edit loop: initialState must be an object");
  if (!Array.isArray(initialState.slides)) initialState.slides = [];
  return initialState;
}

function ensureSession(state) {
  if (!isPlainObject(state.editSession)) state.editSession = { status: EditSessionStatus.IDLE };
  if (!state.editSession.status) state.editSession.status = EditSessionStatus.IDLE;
  state.editSessionStatus = state.editSession.status;
  return state.editSession;
}

function toActionType(action) {
  if (!action) return "";
  if (typeof action.type === "string") return action.type;
  if (typeof action.action === "string") return "quick_action";
  return "";
}

function normalizeMessage(action) {
  if (!action) return "";
  if (typeof action.message === "string") return action.message;
  if (typeof action.text === "string") return action.text;
  return "";
}

const MAX_INTENT_JSON_CHARS = 50_000;
const MAX_INTENT_DEPTH = 8;
const MAX_INTENT_OPERATIONS = 50;
const MODEL_TIMEOUT_MS = 120_000;
const TOOL_TIMEOUT_MS = 30_000;
const CANVAS_TIMEOUT_MS = 30_000;

function getJsonLength(value) {
  try {
    return JSON.stringify(value).length;
  } catch {
    return null;
  }
}

function buildTimeoutError(label, timeoutMs) {
  const ms = Number.isFinite(timeoutMs) ? Math.max(0, Math.floor(timeoutMs)) : 0;
  const err = new Error(`${label} timed out after ${ms}ms`);
  err.name = "TimeoutError";
  /** @type {any} */ (err).code = "ETIMEDOUT";
  /** @type {any} */ (err).timeoutMs = ms;
  return err;
}

function runWithTimeout(promiseFactory, timeoutMs, label) {
  const ms = Number.isFinite(timeoutMs) ? Math.max(0, Math.floor(timeoutMs)) : 0;
  if (!ms) {
    return typeof promiseFactory === "function" ? promiseFactory() : Promise.resolve(promiseFactory);
  }
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      if (controller) {
        try {
          controller.abort();
        } catch {
          controller.abort();
        }
      }
      reject(buildTimeoutError(label, ms));
    }, ms);
  });
  const taskPromise =
    typeof promiseFactory === "function"
      ? Promise.resolve().then(() => promiseFactory(controller ? controller.signal : undefined))
      : Promise.resolve(promiseFactory);
  return Promise.race([taskPromise, timeoutPromise]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

function isTimeoutError(error) {
  return error?.name === "TimeoutError" || error?.name === "AbortError" || error?.code === "ETIMEDOUT";
}

function exceedsDepth(value, depth = 0) {
  if (depth > MAX_INTENT_DEPTH) return true;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (exceedsDepth(item, depth + 1)) return true;
    }
    return false;
  }
  if (isPlainObject(value)) {
    for (const item of Object.values(value)) {
      if (exceedsDepth(item, depth + 1)) return true;
    }
  }
  return false;
}

function isValidOperation(op) {
  if (!isPlainObject(op)) return false;
  if (typeof op.tool !== "string") return false;
  if ("params" in op && op.params !== undefined && op.params !== null && !isPlainObject(op.params)) return false;
  return true;
}

function isValidIntentPayload(payload) {
  if (!isPlainObject(payload)) return false;
  if ("understanding" in payload && typeof payload.understanding !== "string") return false;
  if ("response" in payload && typeof payload.response !== "string") return false;
  if ("needsClarification" in payload && typeof payload.needsClarification !== "boolean") return false;
  if ("clarificationQuestion" in payload && typeof payload.clarificationQuestion !== "string") return false;
  if ("operations" in payload) {
    if (!Array.isArray(payload.operations)) return false;
    if (payload.operations.length > MAX_INTENT_OPERATIONS) return false;
    for (const op of payload.operations) {
      if (!isValidOperation(op)) return false;
    }
  }
  return true;
}

function isValidParamValue(value, typeSpec) {
  if (typeof typeSpec !== "string" || !typeSpec) return true;
  const optional = typeSpec.endsWith("?");
  const baseType = optional ? typeSpec.slice(0, -1) : typeSpec;
  if (value === undefined || value === null) return optional;
  if (baseType === "number") return typeof value === "number" && Number.isFinite(value);
  if (baseType === "string") return typeof value === "string";
  if (baseType === "object") return isPlainObject(value);
  if (baseType === "array") return Array.isArray(value);
  if (baseType === "boolean") return typeof value === "boolean";
  return true;
}

function sanitizeParams(params, toolSchema) {
  const schema = isPlainObject(toolSchema?.params) ? toolSchema.params : null;
  if (!schema) return isPlainObject(params) ? {} : {};
  if (params === undefined || params === null) return {};
  if (!isPlainObject(params)) return null;
  const cleaned = {};
  for (const [key, typeSpec] of Object.entries(schema)) {
    if (!(key in params)) continue;
    if (!isValidParamValue(params[key], typeSpec)) return null;
    cleaned[key] = params[key];
  }
  return cleaned;
}

function sanitizeOperation(op, tools) {
  if (!isPlainObject(op)) return null;
  const tool = typeof op.tool === "string" ? op.tool : "";
  if (!tool || !tools || !tools[tool]) return null;
  const cleanedParams = sanitizeParams(op.params, tools[tool]);
  if (cleanedParams === null) return null;
  return { tool, params: cleanedParams };
}

function sanitizeIntent(intent, tools) {
  if (!isPlainObject(intent)) return null;
  if (exceedsDepth(intent)) return null;
  const cleaned = {};
  if ("understanding" in intent) {
    if (typeof intent.understanding !== "string") return null;
    cleaned.understanding = intent.understanding;
  }
  if ("response" in intent) {
    if (typeof intent.response !== "string") return null;
    cleaned.response = intent.response;
  }
  if ("needsClarification" in intent) {
    if (typeof intent.needsClarification !== "boolean") return null;
    cleaned.needsClarification = intent.needsClarification;
  }
  if ("clarificationQuestion" in intent) {
    if (typeof intent.clarificationQuestion !== "string") return null;
    cleaned.clarificationQuestion = intent.clarificationQuestion;
  }
  if ("operations" in intent) {
    if (!Array.isArray(intent.operations)) return null;
    if (intent.operations.length > MAX_INTENT_OPERATIONS) return null;
    const cleanedOps = [];
    for (const op of intent.operations) {
      const cleanedOp = sanitizeOperation(op, tools);
      if (!cleanedOp) return null;
      cleanedOps.push(cleanedOp);
    }
    cleaned.operations = cleanedOps;
  }
  return cleaned;
}

function safeParseJson(value) {
  if (value && typeof value === "object") {
    const length = getJsonLength(value);
    if (length === null || length > MAX_INTENT_JSON_CHARS) return null;
    if (exceedsDepth(value) || !isValidIntentPayload(value)) return null;
    return value;
  }
  if (typeof value !== "string") return null;
  if (value.length > MAX_INTENT_JSON_CHARS) return null;
  try {
    const parsed = JSON.parse(value);
    const length = getJsonLength(parsed);
    if (length === null || length > MAX_INTENT_JSON_CHARS) return null;
    if (exceedsDepth(parsed) || !isValidIntentPayload(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function buildToolList(tools) {
  const entries = Object.entries(tools || {});
  return entries.map(([key, info]) => `- ${key}: ${info?.description || ""}`.trim()).join("\n");
}

/**
 * Agent loop for interactive slide editing.
 */
export class EditModeAgentLoop {
  /**
   * @param {object} [options]
   * @param {object} [options.tools] - Tool definitions (defaults to EditModeTools)
   * @param {object} [options.sessionMachine] - State machine for edit session
   * @param {object} [options.historyManager] - Undo/redo history manager
   * @param {object} [options.modelRouter] - LLM model router for intent parsing
   * @param {object} [options.canvasBridge] - Bridge to canvas rendering layer
   * @param {object} [options.chat] - Chat interface for user communication
   * @param {Function} [options.emit] - Event emitter function
   * @param {Function} [options.intentParser] - Custom intent parser function
   * @param {Function} [options.waitForUserAction] - Async function to await user action
   * @param {Function} [options.toolExecutorFactory] - Factory for tool executor
   * @param {number} [options.maxTurns] - Maximum edit turns (null for unlimited)
   */
  constructor(options = {}) {
    this.tools = options.tools || EditModeTools;
    this.sessionMachine = options.sessionMachine || editSessionMachine;
    this.historyManager = options.historyManager || null;
    this.modelRouter = options.modelRouter || null;
    this.canvasBridge = options.canvasBridge || null;
    this.chat = options.chat || null;
    this.emit = options.emit || null;
    this.intentParser = options.intentParser || null;
    this.waitForUserAction = options.waitForUserAction || null;
    this.toolExecutorFactory = options.toolExecutorFactory || createEditToolExecutor;
    this.maxTurns = Number.isFinite(options.maxTurns) ? options.maxTurns : null;
  }

  /**
   * Run the edit loop until exit or maxTurns reached.
   * @param {object} initialState - Initial deck state with slides array
   * @param {object} [context] - Runtime context overrides
   * @param {object} [context.historyManager] - Override history manager
   * @param {object} [context.canvasBridge] - Override canvas bridge
   * @param {object} [context.modelRouter] - Override model router
   * @param {object} [context.chat] - Override chat interface
   * @param {Function} [context.emit] - Override event emitter
   * @param {Function} [context.intentParser] - Override intent parser
   * @param {number} [context.maxTurns] - Override max turns
   * @param {Array} [context.actions] - Pre-queued actions for testing
   * @param {Function} [context.waitForUserAction] - Override action awaiter
   * @param {object} [context.toolExecutor] - Override tool executor
   * @param {Function} [context.onSessionTransition] - Session transition callback
   * @returns {Promise<object>} Final deck state
   */
  async run(initialState, context = {}) {
    const state = ensureState(initialState);
    const session = ensureSession(state);
    const historyManager = context.historyManager || this.historyManager || new EditHistoryManager();
    const canvasBridge = context.canvasBridge || this.canvasBridge;
    const modelRouter = context.modelRouter || this.modelRouter;
    const chat = context.chat || this.chat;
    const emit = context.emit || this.emit;
    const intentParser = context.intentParser || this.intentParser;
    const maxTurns = Number.isFinite(context.maxTurns) ? context.maxTurns : this.maxTurns;
    const actionQueue = Array.isArray(context.actions) ? context.actions.slice() : null;

    const waitForUserAction =
      context.waitForUserAction ||
      this.waitForUserAction ||
      (actionQueue
        ? async () => {
          if (actionQueue.length === 0) return { type: "exit" };
          return actionQueue.shift();
        }
        : null);

    if (typeof waitForUserAction !== "function") {
      throw new Error("Edit loop requires waitForUserAction or actions queue");
    }

    const toolExecutor =
      context.toolExecutor ||
      this.toolExecutorFactory({
        state,
        historyManager,
        canvasBridge,
        emit,
        ...context,
      });

    let selectedElement = state.selectedElementId || null;

    if (session.status === EditSessionStatus.IDLE) {
      this._transitionSession(session, EditSessionStatus.AWAITING_INPUT, {
        state,
        emit,
        onSessionTransition: context.onSessionTransition,
      });
    }

    let turns = 0;
    while (maxTurns === null || turns < maxTurns) {
      turns += 1;
      const action = await waitForUserAction({ state, session });
      const type = toActionType(action);
      if (!type) continue;

      if (type === "exit") break;

      if (type === "element_selected") {
        selectedElement = action.elementId || action.id || null;
        state.selectedElementId = selectedElement;
        if (typeof emit === "function") emit("edit:element.selected", { elementId: selectedElement });
        if (chat?.send) {
          await chat.send({
            message:
              "已选中元素。你想要：\n- 修改内容\n- 调整样式\n- 删除\n或者直接告诉我你想怎么改~",
          });
        }
        continue;
      }

      if (type === "chat_message") {
        await this._handleChatMessage({
          action,
          state,
          session,
          selectedElement,
          historyManager,
          canvasBridge,
          modelRouter,
          chat,
          emit,
          intentParser,
          toolExecutor,
          onSessionTransition: context.onSessionTransition,
        });
        continue;
      }

      if (type === "quick_action") {
        await this._handleQuickAction({
          action,
          state,
          session,
          historyManager,
          canvasBridge,
          toolExecutor,
          onSessionTransition: context.onSessionTransition,
        });
      }
    }

    this._transitionSession(session, EditSessionStatus.IDLE, {
      state,
      emit,
      onSessionTransition: context.onSessionTransition,
    });
    return state;
  }

  _transitionSession(session, to, context = {}) {
    const from = session.status;
    const ok = this.sessionMachine.transition(session, to, { reason: "edit-loop" });
    if (ok) {
      if (context.state) context.state.editSessionStatus = session.status;
      if (typeof context.onSessionTransition === "function") context.onSessionTransition(from, to);
      if (typeof context.emit === "function") {
        context.emit("edit:session.transition", { from, to });
      }
    }
    return ok;
  }

  async _captureCanvasContext({ state, canvasBridge, toolExecutor }) {
    let currentDsl = state.currentDsl || "";
    let screenshot = null;

    if (toolExecutor) {
      const dslResult = await runWithTimeout(
        () => toolExecutor("parse_canvas_state", {}),
        TOOL_TIMEOUT_MS,
        "Tool \"parse_canvas_state\""
      );
      if (dslResult?.success && dslResult?.data?.dsl) currentDsl = dslResult.data.dsl;
      const screenshotResult = await runWithTimeout(
        () => toolExecutor("screenshot_current", {}),
        TOOL_TIMEOUT_MS,
        "Tool \"screenshot_current\""
      );
      if (screenshotResult?.success && screenshotResult?.data?.image) screenshot = screenshotResult.data.image;
    } else if (canvasBridge) {
      if (typeof canvasBridge.canvasToDsl === "function") {
        currentDsl = await runWithTimeout(() => canvasBridge.canvasToDsl(state), CANVAS_TIMEOUT_MS, "Canvas DSL");
      }
      if (typeof canvasBridge.screenshot === "function") {
        screenshot = await runWithTimeout(
          () => canvasBridge.screenshot(state),
          CANVAS_TIMEOUT_MS,
          "Canvas screenshot"
        );
      }
    }

    if (!currentDsl) {
      const idx = Number.isFinite(state.currentSlideIndex) ? state.currentSlideIndex : 0;
      currentDsl = state.slides[idx]?.htmlDsl || "";
    }

    return { currentDsl, screenshot };
  }

  buildIntentPrompt({ state, selectedElement, userMessage, currentDsl }) {
    const toolList = buildToolList(this.tools);
    const slideIndex = Number.isFinite(state.currentSlideIndex) ? state.currentSlideIndex + 1 : 1;
    return `
## 当前状态
- 当前页: ${slideIndex}
- 选中元素: ${selectedElement || "无"}
- 用户说: "${userMessage}"

## 当前画面截图
[图片]

## 当前 HTML DSL
${currentDsl}

## 可用操作
${toolList}

## 任务
1. 理解用户意图
2. 选择合适的操作
3. 返回操作序列

## 输出格式
{
  "understanding": "用户想要...",
  "operations": [
    { "tool": "edit_element", "params": { ... } }
  ],
  "response": "好的，我来..."
}
`.trim();
  }

  /**
   * @param {{
   *  userMessage: any,
   *  currentDsl: any,
   *  screenshot?: any,
   *  state: any,
   *  selectedElement?: any,
   *  modelRouter?: any,
   *  intentParser?: Function
   * }} params
   * @returns {Promise<any>}
   */
  async _interpretIntent({ userMessage, currentDsl, screenshot, state, selectedElement, modelRouter, intentParser }) {
    if (typeof intentParser === "function") {
      const parsed = await intentParser({
        userMessage,
        currentDsl,
        screenshot,
        state,
        selectedElement,
        tools: this.tools,
      });
      return parsed;
    }

    if (!modelRouter || typeof modelRouter.chat !== "function") {
      return {
        understanding: "未配置模型，无法解析意图。",
        operations: [],
        response: "我还没有接入模型，暂时无法执行编辑操作。",
      };
    }

    const prompt = this.buildIntentPrompt({ state, selectedElement, userMessage, currentDsl });
    /** @type {Array<{ type: string, text?: string, source?: any }>} */
    const content = [{ type: "text", text: prompt }];
    if (screenshot) content.push({ type: "image", source: screenshot });
    const aiResponse = await runWithTimeout(
      (signal) =>
        modelRouter.chat(
          [{ role: "user", content }],
          signal ? { vision: Boolean(screenshot), signal } : { vision: Boolean(screenshot) }
        ),
      MODEL_TIMEOUT_MS,
      "Model response"
    );
    const parsed = safeParseJson(aiResponse);
    if (!parsed) {
      throw new Error("Model response is not valid JSON");
    }
    return parsed;
  }

  async _handleChatMessage({
    action,
    state,
    session,
    selectedElement,
    historyManager,
    canvasBridge,
    modelRouter,
    chat,
    emit,
    intentParser,
    toolExecutor,
    onSessionTransition,
  }) {
    this._transitionSession(session, EditSessionStatus.PROCESSING, { state, emit, onSessionTransition });

    const userMessage = normalizeMessage(action);

    let currentDsl = "";
    let screenshot = null;
    let intent = null;

    try {
      const captured = await this._captureCanvasContext({ state, canvasBridge, toolExecutor });
      currentDsl = captured.currentDsl;
      screenshot = captured.screenshot;

      intent = await this._interpretIntent({
        userMessage,
        currentDsl,
        screenshot,
        state,
        selectedElement,
        modelRouter,
        intentParser,
      });
      const sanitizedIntent = sanitizeIntent(intent, this.tools);
      if (!sanitizedIntent) {
        throw new Error("Intent schema validation failed");
      }
      intent = sanitizedIntent;
    } catch (captureError) {
      if (chat?.send) {
        const message = isTimeoutError(captureError)
          ? "解析超时，请稍后重试。"
          : `解析失败: ${captureError.message || String(captureError)}`;
        await chat.send({ message });
      }
      this._transitionSession(session, EditSessionStatus.AWAITING_INPUT, { state, emit, onSessionTransition });
      return;
    }

    if (intent?.needsClarification && chat?.send) {
      await chat.send({ message: intent.clarificationQuestion || "你能具体说说要怎么改吗？" });
      this._transitionSession(session, EditSessionStatus.AWAITING_INPUT, { state, emit, onSessionTransition });
      return;
    }

    this._transitionSession(session, EditSessionStatus.EXECUTING, { state, emit, onSessionTransition });
    historyManager.beginTransaction();
    try {
      const operations = Array.isArray(intent?.operations) ? intent.operations : [];
      for (const op of operations) {
        const result = await runWithTimeout(
          () => toolExecutor(op.tool, op.params || {}),
          TOOL_TIMEOUT_MS,
          `Tool "${op.tool}"`
        );
        if (!result?.success) {
          throw new Error(result?.error || `Tool failed: ${op.tool}`);
        }
      }
      historyManager.commit();

      const idx = Number.isFinite(state.currentSlideIndex) ? state.currentSlideIndex : 0;
      const dsl = state.slides[idx]?.htmlDsl || state.currentDsl || "";
      if (canvasBridge?.dslToCanvas) {
        await runWithTimeout(() => canvasBridge.dslToCanvas(dsl, state), CANVAS_TIMEOUT_MS, "Canvas render");
      }
      if (chat?.send) await chat.send({ message: intent?.response || "已完成修改。还有别的需要吗？" });
    } catch (error) {
      historyManager.rollback();
      if (chat?.send) {
        const message = isTimeoutError(error) ? "操作超时，请稍后重试。" : `操作失败: ${error.message}`;
        await chat.send({ message });
      }
    }
    this._transitionSession(session, EditSessionStatus.AWAITING_INPUT, { state, emit, onSessionTransition });
  }

  async _handleQuickAction({ action, state, session, historyManager, canvasBridge, toolExecutor, onSessionTransition }) {
    this._transitionSession(session, EditSessionStatus.PROCESSING, { state, onSessionTransition });
    this._transitionSession(session, EditSessionStatus.EXECUTING, { state, onSessionTransition });

    const quickAction = action.action || action.name;
    if (quickAction === "undo") {
      await toolExecutor(EditOperationType.UNDO, {});
    } else if (quickAction === "redo") {
      await toolExecutor(EditOperationType.REDO, {});
    } else if (quickAction === "add_slide") {
      await toolExecutor(EditOperationType.ADD_SLIDE, {
        afterIndex: Number.isFinite(state.currentSlideIndex) ? state.currentSlideIndex : state.slides.length - 1,
      });
    } else if (quickAction === "delete_slide") {
      await toolExecutor(EditOperationType.DELETE_SLIDE, {
        slideIndex: Number.isFinite(state.currentSlideIndex) ? state.currentSlideIndex : 0,
      });
    }

    const idx = Number.isFinite(state.currentSlideIndex) ? state.currentSlideIndex : 0;
    const dsl = state.slides[idx]?.htmlDsl || state.currentDsl || "";
    if (canvasBridge?.dslToCanvas) await canvasBridge.dslToCanvas(dsl, state);
    this._transitionSession(session, EditSessionStatus.AWAITING_INPUT, { state, onSessionTransition });
  }
}
