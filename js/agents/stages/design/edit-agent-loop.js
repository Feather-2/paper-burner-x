/**
 * Edit Agent Loop - 用户交互式编辑
 *
 * Phase 2 的编辑代理，支持多种输入类型：
 * - element: 点击元素编辑
 * - image: 点击图片编辑
 * - region: 框选区域编辑
 * - verbal: 口头描述编辑
 * - global: 全局指令
 */

import { BaseAgentLoop, checkCancelled, getEmitFn } from "../../runtime/core/agent-loop.js";
import { AgentStatus } from "../../runtime/core/agent-status.js";
import { createDeckAnalyzer } from "./runtime/deck-analyzer.js";
import { createDeckEditor } from "./runtime/deck-editor.js";
import { createScreenshotStitcher } from "./runtime/screenshot-stitcher.js";
import { DesignBlackboard } from "./runtime/design-blackboard.js";
import { parseSections } from "./refiner/react-refiner-tools.js";
import { EditModeAgentLoop } from "./edit-mode/edit-loop.js";

/**
 * 编辑请求类型
 */
export const EditRequestType = {
  ELEMENT: "element",
  IMAGE: "image",
  REGION: "region",
  VERBAL: "verbal",
  GLOBAL: "global",
};

/**
 * 编辑状态
 */
export const EditState = {
  IDLE: "idle",
  WAITING: "waiting",
  PROCESSING: "processing",
  COMPLETED: "completed",
};

function emitStage(emit, name, status, payload) {
  emit?.(name, { actor: "edit", status, payload });
}

/**
 * EditAgentLoop 类
 */
export class EditAgentLoop extends BaseAgentLoop {
  constructor(options = {}) {
    super({ actor: "edit", stageName: "edit", eventBus: options.eventBus });

    this._deckPackage = options.deckPackage || { deckHtmlDsl: "", slidesMeta: [] };
    this._designSystem = options.designSystem || {};
    this._contentPackage = options.contentPackage || {};

    // 工具实例
    this._analyzer = options.analyzer || createDeckAnalyzer(options);
    this._editor = options.editor || createDeckEditor({ deckPackage: this._deckPackage });
    this._stitcher = options.stitcher || createScreenshotStitcher();

    // 黑板
    this._blackboard = new DesignBlackboard({ runId: options.runId });

    // 状态
    this._state = EditState.IDLE;
    this._editHistory = [];
    this._maxHistory = 50;

    // 外部工具
    this._svgGenerator = options.svgGenerator;
    this._imageGenerator = options.imageGenerator;
    this._aiApiService = options.aiApiService;
    this._modelRouter = options.modelRouter;
    this._intentInterpreter = new EditModeAgentLoop({
      modelRouter: options.modelRouter,
      tools: options.editTools,
    });
  }

  /**
   * 设置 deck package
   */
  setDeckPackage(deckPackage) {
    this._deckPackage = deckPackage;
    this._editor.setDeckPackage(deckPackage);
  }

  /**
   * 获取当前 deck
   */
  getDeckPackage() {
    return {
      ...this._deckPackage,
      deckHtmlDsl: this._editor.getDeckHtmlDsl(),
    };
  }

  /**
   * 主运行循环
   */
  async run(context = {}) {
    const emit = getEmitFn(context) || this.emit;
    const signal = context.signal;
    const runId = context.runId || `edit_${Date.now()}`;

    this._state = EditState.WAITING;
    emitStage(emit, "edit.started", "started", { runId });

    try {
      while (!signal?.aborted) {
        checkCancelled(signal);

        // 等待用户编辑请求
        this._state = EditState.WAITING;
        emitStage(emit, "edit.waiting", "waiting", { runId });

        const request = await this.waitForUserAction("edit_command", {
          eventBus: context.eventBus,
          signal,
          timeout: context.timeout || 0, // 0 = 无超时
        });

        // 检查是否完成
        if (!request || request.action === "done" || request.action === "exit") {
          break;
        }

        // 处理编辑请求
        this._state = EditState.PROCESSING;
        emitStage(emit, "edit.processing", "processing", { runId, request });

        const result = await this._processEditRequest(request, { emit, signal, runId });

        // 保存版本
        this._blackboard.saveVersion(`edit_${Date.now()}`, {
          deckHtmlDsl: this._editor.getDeckHtmlDsl(),
          request,
          result,
        });

        // 发出编辑完成事件
        emitStage(emit, "edit.applied", "progress", {
          runId,
          request,
          result,
          success: result.success,
        });
      }

      this._state = EditState.COMPLETED;
      emitStage(emit, "edit.ended", "ended", {
        runId,
        editCount: this._editHistory.length,
      });

      return this.getDeckPackage();
    } catch (err) {
      this._state = EditState.IDLE;
      emitStage(emit, "edit.error", "error", {
        runId,
        error: err.message,
      });
      throw err;
    }
  }

  /**
   * 处理单个编辑请求
   */
  async _processEditRequest(request, { emit, signal, runId }) {
    const { type, selection, command } = request;

    // 记录到历史
    this._editHistory.push({
      timestamp: Date.now(),
      request,
    });

    // 限制历史长度
    if (this._editHistory.length > this._maxHistory) {
      this._editHistory.shift();
    }

    // 根据类型路由
    switch (type) {
      case EditRequestType.ELEMENT:
        return this._handleElementEdit(request, { emit, signal });

      case EditRequestType.IMAGE:
        return this._handleImageEdit(request, { emit, signal });

      case EditRequestType.REGION:
        return this._handleRegionEdit(request, { emit, signal });

      case EditRequestType.VERBAL:
        return this._handleVerbalEdit(request, { emit, signal });

      case EditRequestType.GLOBAL:
        return this._handleGlobalEdit(request, { emit, signal });

      default:
        return { success: false, error: `Unknown edit type: ${type}` };
    }
  }

  /**
   * 处理元素编辑
   */
  async _handleElementEdit(request, { emit, signal }) {
    const { selection, command, changes } = request;
    const { slideIndex, elementId, selector } = selection || {};

    if (elementId == null && selector == null) {
      return { success: false, error: "elementId or selector required" };
    }

    const resolvedElementId = elementId || this._resolveSelector(slideIndex, selector);
    if (!resolvedElementId) {
      return { success: false, error: "Could not resolve element" };
    }

    // 检查元素类型
    const elementInfo = this._getElementInfo(slideIndex, resolvedElementId);

    // SVG/图表元素 → SVG Generator
    if (elementInfo?.tag === "svg" || elementInfo?.class?.includes("chart")) {
      if (this._svgGenerator && command) {
        return this._regenerateSvg(slideIndex, resolvedElementId, command, { emit, signal });
      }
    }

    // 图片元素 → Image Generator
    if (elementInfo?.tag === "img") {
      if (this._imageGenerator && command) {
        return this._regenerateImage(slideIndex, resolvedElementId, command, { emit, signal });
      }
    }

    // 普通元素 → 直接编辑
    if (changes) {
      return this._editor.editElement(slideIndex, resolvedElementId, changes);
    }

    // 如果只有 command，需要 AI 解析意图
    if (command) {
      return this._aiEditElement(slideIndex, resolvedElementId, command, { emit, signal });
    }

    return { success: false, error: "No changes or command provided" };
  }

  /**
   * 处理图片编辑
   */
  async _handleImageEdit(request, { emit, signal }) {
    const { selection, command } = request;
    const { slideIndex, slotId, elementId } = selection || {};

    if (!this._imageGenerator) {
      return { success: false, error: "Image generator not available" };
    }

    // 获取原始图片信息
    const imageSlot = this._deckPackage.imageSlots?.find(
      (s) => s.slotId === slotId || s.elementId === elementId
    );

    // 重新生成图片
    const newImage = await this._imageGenerator.generate({
      prompt: command,
      originalPrompt: imageSlot?.prompt,
      style: imageSlot?.style,
    });

    if (!newImage?.url && !newImage?.base64) {
      return { success: false, error: "Image generation failed" };
    }

    // 更新元素
    const imgSrc = newImage.url || newImage.base64;
    return this._editor.editElement(slideIndex, elementId || slotId, {
      attrs: { src: imgSrc },
    });
  }

  /**
   * 处理区域编辑
   */
  async _handleRegionEdit(request, { emit, signal }) {
    const { selection, command, screenshot } = request;
    const { slideIndex, bbox } = selection || {};

    // 获取页面 DSL
    const sections = parseSections(this._editor.getDeckHtmlDsl());
    const slideHtml = sections[slideIndex] || "";

    // 构建上下文
    const context = {
      slideHtml,
      bbox,
      screenshot,
      command,
    };

    // AI 分析并生成编辑
    return this._aiAnalyzeAndEdit(slideIndex, context, { emit, signal });
  }

  /**
   * 处理口头描述编辑
   */
  async _handleVerbalEdit(request, { emit, signal }) {
    const { selection, command } = request;
    const { slideIndex } = selection || {};

    // 获取页面 DSL
    const sections = parseSections(this._editor.getDeckHtmlDsl());

    // 如果指定了页面，只看该页
    if (slideIndex != null && slideIndex >= 0 && slideIndex < sections.length) {
      const slideHtml = sections[slideIndex];
      return this._aiAnalyzeAndEdit(slideIndex, { slideHtml, command }, { emit, signal });
    }

    // 否则需要分析整个 deck
    return this._handleGlobalEdit(request, { emit, signal });
  }

  /**
   * 处理全局编辑
   */
  async _handleGlobalEdit(request, { emit, signal }) {
    const { command } = request;

    // 收集所有 DSL
    const allDsl = this._analyzer.collectAllDsl(this._deckPackage);

    // 分析风格一致性
    const styleAnalysis = this._analyzer.analyzeStyleConsistency(this._deckPackage, this._designSystem);

    // 构建上下文
    const context = {
      allDsl,
      styleAnalysis,
      command,
      slideCount: allDsl.length,
    };

    // AI 分析并生成批量编辑
    return this._aiGlobalEdit(context, { emit, signal });
  }

  // === 辅助方法 ===

  _resolveSelector(slideIndex, selector) {
    if (!selector) return null;

    const sections = parseSections(this._editor.getDeckHtmlDsl());
    const slideHtml = sections[slideIndex] || "";

    // 尝试从 selector 提取 data-el
    const match = selector.match(/data-el="([^"]+)"/);
    if (match) return match[1];

    // 尝试自然语言定位
    const located = this._analyzer.locateElement(slideHtml, selector);
    return located?.element?.elementId || null;
  }

  _getElementInfo(slideIndex, elementId) {
    const sections = parseSections(this._editor.getDeckHtmlDsl());
    const slideHtml = sections[slideIndex] || "";
    const allDsl = this._analyzer.collectAllDsl({ deckHtmlDsl: slideHtml });

    for (const slide of allDsl) {
      const el = slide.elements?.find((e) => e.elementId === elementId);
      if (el) return el;
    }
    return null;
  }

  async _regenerateSvg(slideIndex, elementId, command, { emit, signal }) {
    if (!this._svgGenerator) {
      return { success: false, error: "SVG generator not available" };
    }

    const newSvg = await this._svgGenerator.generate({ prompt: command });
    if (!newSvg?.svg) {
      return { success: false, error: "SVG generation failed" };
    }

    return this._editor.editElement(slideIndex, elementId, { html: newSvg.svg });
  }

  async _regenerateImage(slideIndex, elementId, command, { emit, signal }) {
    if (!this._imageGenerator) {
      return { success: false, error: "Image generator not available" };
    }

    const newImage = await this._imageGenerator.generate({ prompt: command });
    if (!newImage?.url && !newImage?.base64) {
      return { success: false, error: "Image generation failed" };
    }

    const imgSrc = newImage.url || newImage.base64;
    return this._editor.editElement(slideIndex, elementId, { attrs: { src: imgSrc } });
  }

  async _aiEditElement(slideIndex, elementId, command, { emit, signal }) {
    const sections = parseSections(this._editor.getDeckHtmlDsl());
    const currentDsl = sections[slideIndex] || "";

    const intent = await this._intentInterpreter._interpretIntent({
      userMessage: command,
      currentDsl,
      state: { currentSlideIndex: slideIndex },
      selectedElement: elementId,
      modelRouter: this._modelRouter,
    });

    if (!intent?.operations?.length) {
      return { success: false, error: intent?.response || "无法解析编辑意图" };
    }

    // 执行第一个操作
    const op = intent.operations[0];
    if (op.tool === "edit_element" && op.params) {
      return this._editor.editElement(slideIndex, elementId, op.params.changes || op.params);
    }

    return { success: false, error: `不支持的操作: ${op.tool}` };
  }

  async _aiAnalyzeAndEdit(slideIndex, context, { emit, signal }) {
    const intent = await this._intentInterpreter._interpretIntent({
      userMessage: context.command,
      currentDsl: context.slideHtml,
      screenshot: context.screenshot,
      state: { currentSlideIndex: slideIndex },
      modelRouter: this._modelRouter,
    });

    if (!intent?.operations?.length) {
      return { success: false, error: intent?.response || "无法解析编辑意图" };
    }

    const results = [];
    for (const op of intent.operations) {
      if (op.tool === "edit_element" && op.params?.elementId) {
        const r = await this._editor.editElement(slideIndex, op.params.elementId, op.params.changes || op.params);
        results.push(r);
      }
    }

    return { success: results.every((r) => r.success), operations: results };
  }

  async _aiGlobalEdit(context, { emit, signal }) {
    const results = [];

    for (let i = 0; i < context.allDsl.length; i++) {
      const slideContext = {
        command: context.command,
        slideHtml: context.allDsl[i]?.html || "",
      };
      const r = await this._aiAnalyzeAndEdit(i, slideContext, { emit, signal });
      if (r.success) results.push(r);
    }

    return { success: results.length > 0, slidesModified: results.length };
  }

  /**
   * 撤销
   */
  undo() {
    return this._editor.undo();
  }

  /**
   * 重做
   */
  redo() {
    return this._editor.redo();
  }

  /**
   * 获取编辑历史
   */
  getEditHistory() {
    return this._editHistory.slice();
  }

  /**
   * 获取状态
   */
  getState() {
    return this._state;
  }
}

export function createEditAgentLoop(options = {}) {
  return new EditAgentLoop(options);
}
