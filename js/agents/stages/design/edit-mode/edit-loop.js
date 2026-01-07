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

function safeParseJson(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch (err) {
    return null;
  }
}

function buildToolList(tools) {
  const entries = Object.entries(tools || {});
  return entries.map(([key, info]) => `- ${key}: ${info?.description || ""}`.trim()).join("\n");
}

export class EditModeAgentLoop {
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
        if (typeof emit === "function") emit("edit.element.selected", { elementId: selectedElement });
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
        context.emit("edit.session.transition", { from, to });
      }
    }
    return ok;
  }

  async _captureCanvasContext({ state, canvasBridge, toolExecutor }) {
    let currentDsl = state.currentDsl || "";
    let screenshot = null;

    if (toolExecutor) {
      const dslResult = await toolExecutor("parse_canvas_state", {});
      if (dslResult?.success && dslResult?.data?.dsl) currentDsl = dslResult.data.dsl;
      const screenshotResult = await toolExecutor("screenshot_current", {});
      if (screenshotResult?.success && screenshotResult?.data?.image) screenshot = screenshotResult.data.image;
    } else if (canvasBridge) {
      if (typeof canvasBridge.canvasToDsl === "function") currentDsl = await canvasBridge.canvasToDsl(state);
      if (typeof canvasBridge.screenshot === "function") screenshot = await canvasBridge.screenshot(state);
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
    const aiResponse = await modelRouter.chat([{ role: "user", content }], { vision: Boolean(screenshot) });
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
    const { currentDsl, screenshot } = await this._captureCanvasContext({ state, canvasBridge, toolExecutor });
    const intent = await this._interpretIntent({
      userMessage,
      currentDsl,
      screenshot,
      state,
      selectedElement,
      modelRouter,
      intentParser,
    });

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
        const result = await toolExecutor(op.tool, op.params || {});
        if (!result?.success) {
          throw new Error(result?.error || `Tool failed: ${op.tool}`);
        }
      }
      historyManager.commit();

      const idx = Number.isFinite(state.currentSlideIndex) ? state.currentSlideIndex : 0;
      const dsl = state.slides[idx]?.htmlDsl || state.currentDsl || "";
      if (canvasBridge?.dslToCanvas) await canvasBridge.dslToCanvas(dsl, state);
      if (chat?.send) await chat.send({ message: intent?.response || "已完成修改。还有别的需要吗？" });
    } catch (error) {
      historyManager.rollback();
      if (chat?.send) await chat.send({ message: `操作失败: ${error.message}` });
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
