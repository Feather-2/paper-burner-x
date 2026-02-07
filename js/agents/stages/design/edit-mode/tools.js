import { EditOperationType } from "../constants.js";

import { isPlainObject } from "../../../shared/index.js";
import { deepClone } from "../../../shared/utils/value-utils.js";
export const EditModeTools = Object.freeze({
  [EditOperationType.ADD_SLIDE]: {
    description: "在指定位置添加新页面",
    params: { afterIndex: "number", template: "string?" },
  },
  [EditOperationType.DELETE_SLIDE]: {
    description: "删除指定页面",
    params: { slideIndex: "number" },
  },
  [EditOperationType.REORDER_SLIDES]: {
    description: "调整页面顺序",
    params: { fromIndex: "number", toIndex: "number" },
  },
  [EditOperationType.DUPLICATE_SLIDE]: {
    description: "复制页面",
    params: { slideIndex: "number" },
  },
  [EditOperationType.CHANGE_COLOR_SCHEME]: {
    description: "修改整体配色方案",
    params: { primary: "string", accent: "string", background: "string" },
  },
  [EditOperationType.CHANGE_FONT]: {
    description: "修改字体",
    params: { headingFont: "string", bodyFont: "string" },
  },
  [EditOperationType.APPLY_THEME]: {
    description: "应用预设主题",
    params: { themeName: "string" },
  },
  [EditOperationType.EDIT_ELEMENT]: {
    description: "修改选中元素的内容/样式",
    params: { elementId: "string", changes: "object" },
  },
  [EditOperationType.DELETE_ELEMENT]: {
    description: "删除选中元素",
    params: { elementId: "string" },
  },
  [EditOperationType.ADD_ELEMENT]: {
    description: "添加新元素",
    params: { slideIndex: "number", elementType: "string", position: "object" },
  },
  [EditOperationType.MOVE_ELEMENT]: {
    description: "移动元素位置",
    params: { elementId: "string", x: "number", y: "number" },
  },
  [EditOperationType.RESIZE_ELEMENT]: {
    description: "调整元素大小",
    params: { elementId: "string", width: "number", height: "number" },
  },
  screenshot_current: {
    description: "截图当前页面",
    returns: "base64 image",
  },
  parse_canvas_state: {
    description: "从 Canvas 反解析当前状态到 HTML DSL",
    returns: "HTML DSL string",
  },
  [EditOperationType.UNDO]: { description: "撤销上一步操作" },
  [EditOperationType.REDO]: { description: "重做" },
});

let elementCounter = 0;
let slideCounter = 0;

function clone(value) {
  return deepClone(value);
}

function toInt(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.floor(parsed) : null;
  }
  return null;
}

function ensureState(context) {
  if (!isPlainObject(context)) throw new TypeError("Edit tools: context must be an object");
  const state = isPlainObject(context.state) ? context.state : context.currentState;
  if (!isPlainObject(state)) throw new TypeError("Edit tools: state must be provided");
  if (!Array.isArray(state.slides)) state.slides = [];
  return state;
}

function ensureDesignSystem(state) {
  if (!isPlainObject(state.designSystem)) state.designSystem = {};
  return state.designSystem;
}

function getTokenContainer(state) {
  const designSystem = ensureDesignSystem(state);
  if (isPlainObject(designSystem.designTokens)) return designSystem.designTokens;
  if (isPlainObject(designSystem.tokens)) return designSystem.tokens;
  return designSystem;
}

// === STYLE LOCK SYNC: Validate edits against locked design system ===

/**
 * Get the locked style from designSystem (established during generation).
 * @param {object} state
 * @returns {object|null}
 */
function getLockedStyle(state) {
  const ds = ensureDesignSystem(state);
  // Style lock is stored as a snapshot of the first batch's visual characteristics
  return ds.styleLock || null;
}

/**
 * Validate a color against the locked palette.
 * Returns { valid: boolean, warning?: string, suggestion?: string }
 */
function validateColorAgainstLock(colorKey, colorValue, lockedStyle) {
  if (!lockedStyle || !lockedStyle.colors) return { valid: true };

  const lockedColor = lockedStyle.colors[colorKey];
  if (!lockedColor) return { valid: true };

  // Simple hex comparison (case-insensitive)
  const normalize = (c) => String(c || '').toLowerCase().trim();
  if (normalize(colorValue) === normalize(lockedColor)) {
    return { valid: true };
  }

  return {
    valid: false,
    warning: `Color "${colorKey}" (${colorValue}) deviates from locked style (${lockedColor})`,
    suggestion: lockedColor,
    key: colorKey,
    requested: colorValue,
    locked: lockedColor,
  };
}

/**
 * Emit a style deviation warning.
 */
function emitStyleWarning(context, deviations) {
  if (!Array.isArray(deviations) || deviations.length === 0) return;
  const emit = context?.emit;
  if (typeof emit !== 'function') return;

  emit('edit:style.deviation', {
    actor: 'design',
    status: 'warning',
    payload: {
      deviations,
      message: `Style edit deviates from locked design system. Consider using: ${deviations.map(d => `${d.key}=${d.locked}`).join(', ')}`,
    },
  });
}

function replaceArrayContents(target, source) {
  target.splice(0, target.length, ...source);
}

function generateElementId(context) {
  if (typeof context?.idGenerator === "function") return context.idGenerator();
  elementCounter += 1;
  return `el_${Date.now()}_${elementCounter}`;
}

function generateSlideId(context) {
  if (typeof context?.slideIdGenerator === "function") return context.slideIdGenerator();
  slideCounter += 1;
  return `slide_${Date.now()}_${slideCounter}`;
}

function ensureElements(slide) {
  if (!Array.isArray(slide.elements)) slide.elements = [];
  return slide.elements;
}

function findElement(state, elementId) {
  for (let i = 0; i < state.slides.length; i += 1) {
    const slide = state.slides[i];
    const elements = Array.isArray(slide?.elements) ? slide.elements : [];
    for (let j = 0; j < elements.length; j += 1) {
      if (elements[j]?.id === elementId) {
        return { slide, slideIndex: i, elementIndex: j, element: elements[j] };
      }
    }
  }
  return null;
}

function getPositionValue(element, key) {
  if (Number.isFinite(element?.[key])) return element[key];
  if (Number.isFinite(element?.position?.[key])) return element.position[key];
  return undefined;
}

function setPositionValue(element, key, value) {
  element[key] = value;
  if (isPlainObject(element.position)) element.position[key] = value;
}

function buildToolError(message) {
  const err = new Error(message);
  /** @type {Error & { code?: string }} */ (err).code = "EDIT_TOOL_ERROR";
  return err;
}

function buildSlideTemplate(params, context) {
  const template = typeof params?.template === "string" ? params.template : "";
  return {
    id: params?.slideId || generateSlideId(context),
    template,
    title: params?.title || "",
    elements: [],
    htmlDsl: params?.htmlDsl || "",
  };
}

function applyAddSlide(params, context) {
  const state = ensureState(context);
  const slides = state.slides;
  const afterIndex = toInt(params?.afterIndex);
  const insertIndex = afterIndex === null ? slides.length : Math.min(Math.max(afterIndex + 1, 0), slides.length);
  const newSlide = buildSlideTemplate(params, context);
  const prevIndex = Number.isFinite(state.currentSlideIndex) ? state.currentSlideIndex : null;

  slides.splice(insertIndex, 0, newSlide);
  if (prevIndex !== null) {
    state.currentSlideIndex = prevIndex >= insertIndex ? prevIndex + 1 : prevIndex;
  }
  const nextIndex = Number.isFinite(state.currentSlideIndex) ? state.currentSlideIndex : prevIndex;

  return {
    data: { slide: newSlide, insertIndex },
    operation: {
      type: EditOperationType.ADD_SLIDE,
      undo: () => {
        const idx = slides.findIndex((s) => s.id === newSlide.id);
        if (idx >= 0) slides.splice(idx, 1);
        if (prevIndex !== null) state.currentSlideIndex = prevIndex;
      },
      redo: () => {
        const idx = slides.findIndex((s) => s.id === newSlide.id);
        if (idx === -1) slides.splice(insertIndex, 0, newSlide);
        if (nextIndex !== null) state.currentSlideIndex = nextIndex;
      },
    },
  };
}

function applyDeleteSlide(params, context) {
  const state = ensureState(context);
  const slides = state.slides;
  const slideIndex = toInt(params?.slideIndex);
  if (slideIndex === null || slideIndex < 0 || slideIndex >= slides.length) {
    throw buildToolError(`Invalid slideIndex: ${String(params?.slideIndex)}`);
  }

  const prevIndex = Number.isFinite(state.currentSlideIndex) ? state.currentSlideIndex : null;
  const removed = slides.splice(slideIndex, 1)[0];
  if (prevIndex !== null) {
    if (prevIndex === slideIndex) state.currentSlideIndex = Math.max(0, slideIndex - 1);
    else if (prevIndex > slideIndex) state.currentSlideIndex = prevIndex - 1;
  }
  const nextIndex = Number.isFinite(state.currentSlideIndex) ? state.currentSlideIndex : prevIndex;

  return {
    data: { removed, slideIndex },
    operation: {
      type: EditOperationType.DELETE_SLIDE,
      undo: () => {
        slides.splice(slideIndex, 0, removed);
        if (prevIndex !== null) state.currentSlideIndex = prevIndex;
      },
      redo: () => {
        const idx = slides.findIndex((s) => s.id === removed.id);
        if (idx >= 0) slides.splice(idx, 1);
        if (nextIndex !== null) state.currentSlideIndex = nextIndex;
      },
    },
  };
}

function applyReorderSlides(params, context) {
  const state = ensureState(context);
  const slides = state.slides;
  const fromIndex = toInt(params?.fromIndex);
  const toIndex = toInt(params?.toIndex);

  if (
    fromIndex === null ||
    toIndex === null ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= slides.length ||
    toIndex >= slides.length
  ) {
    throw buildToolError(`Invalid reorder indices: ${String(params?.fromIndex)} -> ${String(params?.toIndex)}`);
  }

  const prevSlides = slides.slice();
  const prevIndex = Number.isFinite(state.currentSlideIndex) ? state.currentSlideIndex : null;
  const [moved] = slides.splice(fromIndex, 1);
  slides.splice(toIndex, 0, moved);

  if (prevIndex !== null) {
    if (prevIndex === fromIndex) state.currentSlideIndex = toIndex;
    else if (fromIndex < prevIndex && prevIndex <= toIndex) state.currentSlideIndex = prevIndex - 1;
    else if (toIndex <= prevIndex && prevIndex < fromIndex) state.currentSlideIndex = prevIndex + 1;
  }
  const nextSlides = slides.slice();
  const nextIndex = Number.isFinite(state.currentSlideIndex) ? state.currentSlideIndex : prevIndex;

  return {
    data: { fromIndex, toIndex },
    operation: {
      type: EditOperationType.REORDER_SLIDES,
      undo: () => {
        replaceArrayContents(slides, prevSlides);
        if (prevIndex !== null) state.currentSlideIndex = prevIndex;
      },
      redo: () => {
        replaceArrayContents(slides, nextSlides);
        if (nextIndex !== null) state.currentSlideIndex = nextIndex;
      },
    },
  };
}

function applyDuplicateSlide(params, context) {
  const state = ensureState(context);
  const slides = state.slides;
  const slideIndex = toInt(params?.slideIndex);
  if (slideIndex === null || slideIndex < 0 || slideIndex >= slides.length) {
    throw buildToolError(`Invalid slideIndex: ${String(params?.slideIndex)}`);
  }

  const prevIndex = Number.isFinite(state.currentSlideIndex) ? state.currentSlideIndex : null;
  const sourceSlide = slides[slideIndex];
  const cloned = clone(sourceSlide);
  cloned.id = params?.newSlideId || generateSlideId(context);
  const insertIndex = slideIndex + 1;
  slides.splice(insertIndex, 0, cloned);
  if (prevIndex !== null && prevIndex >= insertIndex) state.currentSlideIndex = prevIndex + 1;
  const nextIndex = Number.isFinite(state.currentSlideIndex) ? state.currentSlideIndex : prevIndex;

  return {
    data: { sourceSlideId: sourceSlide.id, duplicate: cloned },
    operation: {
      type: EditOperationType.DUPLICATE_SLIDE,
      undo: () => {
        const idx = slides.findIndex((s) => s.id === cloned.id);
        if (idx >= 0) slides.splice(idx, 1);
        if (prevIndex !== null) state.currentSlideIndex = prevIndex;
      },
      redo: () => {
        const idx = slides.findIndex((s) => s.id === cloned.id);
        if (idx === -1) slides.splice(insertIndex, 0, cloned);
        if (nextIndex !== null) state.currentSlideIndex = nextIndex;
      },
    },
  };
}

function applyChangeColorScheme(params, context) {
  const state = ensureState(context);
  const tokens = getTokenContainer(state);
  if (!isPlainObject(tokens.colors)) tokens.colors = {};
  const prevColors = clone(tokens.colors);
  const updates = {};
  if (params?.primary) updates.primary = params.primary;
  if (params?.accent) updates.accent = params.accent;
  if (params?.background) updates.background = params.background;

  // === STYLE LOCK SYNC: Validate against locked design system ===
  const lockedStyle = getLockedStyle(state);
  const deviations = [];

  for (const [key, value] of Object.entries(updates)) {
    const validation = validateColorAgainstLock(key, value, lockedStyle);
    if (!validation.valid) {
      deviations.push(validation);
    }
  }

  // Emit warning for deviations (but don't block the operation)
  if (deviations.length > 0) {
    emitStyleWarning(context, deviations);
  }

  tokens.colors = { ...tokens.colors, ...updates };
  const nextColors = clone(tokens.colors);

  return {
    data: { colors: tokens.colors, styleDeviations: deviations.length > 0 ? deviations : undefined },
    operation: {
      type: EditOperationType.CHANGE_COLOR_SCHEME,
      undo: () => {
        tokens.colors = clone(prevColors);
      },
      redo: () => {
        tokens.colors = clone(nextColors);
      },
    },
  };
}

function applyChangeFont(params, context) {
  const state = ensureState(context);
  const tokens = getTokenContainer(state);
  if (!isPlainObject(tokens.typography)) tokens.typography = {};
  const prevTypography = clone(tokens.typography);
  if (params?.headingFont) tokens.typography.headingFont = params.headingFont;
  if (params?.bodyFont) tokens.typography.bodyFont = params.bodyFont;
  const nextTypography = clone(tokens.typography);

  return {
    data: { typography: tokens.typography },
    operation: {
      type: EditOperationType.CHANGE_FONT,
      undo: () => {
        tokens.typography = clone(prevTypography);
      },
      redo: () => {
        tokens.typography = clone(nextTypography);
      },
    },
  };
}

function applyTheme(params, context) {
  const state = ensureState(context);
  const designSystem = ensureDesignSystem(state);
  const prevTheme = designSystem.theme;
  designSystem.theme = params?.themeName || params?.theme || designSystem.theme;
  const nextTheme = designSystem.theme;

  return {
    data: { theme: designSystem.theme },
    operation: {
      type: EditOperationType.APPLY_THEME,
      undo: () => {
        designSystem.theme = prevTheme;
      },
      redo: () => {
        designSystem.theme = nextTheme;
      },
    },
  };
}

function applyEditElement(params, context) {
  const state = ensureState(context);
  const target = findElement(state, params?.elementId);
  if (!target) throw buildToolError(`Element not found: ${String(params?.elementId)}`);
  if (!isPlainObject(params?.changes)) throw buildToolError("changes must be an object");

  const { slide, elementIndex, element } = target;
  const prevElement = clone(element);
  const updated = { ...element, ...params.changes };
  slide.elements[elementIndex] = updated;
  const nextElement = clone(updated);

  return {
    data: { element: updated },
    operation: {
      type: EditOperationType.EDIT_ELEMENT,
      undo: () => {
        slide.elements[elementIndex] = clone(prevElement);
      },
      redo: () => {
        slide.elements[elementIndex] = clone(nextElement);
      },
    },
  };
}

function applyDeleteElement(params, context) {
  const state = ensureState(context);
  const target = findElement(state, params?.elementId);
  if (!target) throw buildToolError(`Element not found: ${String(params?.elementId)}`);
  const { slide, elementIndex, element } = target;
  slide.elements.splice(elementIndex, 1);

  return {
    data: { deleted: element },
    operation: {
      type: EditOperationType.DELETE_ELEMENT,
      undo: () => {
        slide.elements.splice(elementIndex, 0, element);
      },
      redo: () => {
        const idx = slide.elements.findIndex((el) => el.id === element.id);
        if (idx >= 0) slide.elements.splice(idx, 1);
      },
    },
  };
}

function applyAddElement(params, context) {
  const state = ensureState(context);
  const slideIndex = toInt(params?.slideIndex);
  if (slideIndex === null || slideIndex < 0 || slideIndex >= state.slides.length) {
    throw buildToolError(`Invalid slideIndex: ${String(params?.slideIndex)}`);
  }
  const slide = state.slides[slideIndex];
  const elements = ensureElements(slide);
  const element = {
    id: params?.elementId || generateElementId(context),
    type: params?.elementType || "Element",
    position: isPlainObject(params?.position) ? { ...params.position } : {},
  };
  elements.push(element);
  const insertIndex = elements.length - 1;

  return {
    data: { element },
    operation: {
      type: EditOperationType.ADD_ELEMENT,
      undo: () => {
        const idx = elements.findIndex((el) => el.id === element.id);
        if (idx >= 0) elements.splice(idx, 1);
      },
      redo: () => {
        const idx = elements.findIndex((el) => el.id === element.id);
        if (idx === -1) elements.splice(insertIndex, 0, element);
      },
    },
  };
}

function applyMoveElement(params, context) {
  const state = ensureState(context);
  const target = findElement(state, params?.elementId);
  if (!target) throw buildToolError(`Element not found: ${String(params?.elementId)}`);
  const { slide, elementIndex, element } = target;
  const prev = {
    x: getPositionValue(element, "x"),
    y: getPositionValue(element, "y"),
  };

  if (params?.x !== undefined) setPositionValue(element, "x", params.x);
  if (params?.y !== undefined) setPositionValue(element, "y", params.y);
  const next = {
    x: getPositionValue(element, "x"),
    y: getPositionValue(element, "y"),
  };

  return {
    data: { element },
    operation: {
      type: EditOperationType.MOVE_ELEMENT,
      undo: () => {
        const targetEl = slide.elements[elementIndex];
        if (!targetEl) return;
        if (prev.x !== undefined) setPositionValue(targetEl, "x", prev.x);
        if (prev.y !== undefined) setPositionValue(targetEl, "y", prev.y);
      },
      redo: () => {
        const targetEl = slide.elements[elementIndex];
        if (!targetEl) return;
        if (next.x !== undefined) setPositionValue(targetEl, "x", next.x);
        if (next.y !== undefined) setPositionValue(targetEl, "y", next.y);
      },
    },
  };
}

function applyResizeElement(params, context) {
  const state = ensureState(context);
  const target = findElement(state, params?.elementId);
  if (!target) throw buildToolError(`Element not found: ${String(params?.elementId)}`);
  const { slide, elementIndex, element } = target;
  const prev = {
    width: getPositionValue(element, "width"),
    height: getPositionValue(element, "height"),
  };

  if (params?.width !== undefined) setPositionValue(element, "width", params.width);
  if (params?.height !== undefined) setPositionValue(element, "height", params.height);
  const next = {
    width: getPositionValue(element, "width"),
    height: getPositionValue(element, "height"),
  };

  return {
    data: { element },
    operation: {
      type: EditOperationType.RESIZE_ELEMENT,
      undo: () => {
        const targetEl = slide.elements[elementIndex];
        if (!targetEl) return;
        if (prev.width !== undefined) setPositionValue(targetEl, "width", prev.width);
        if (prev.height !== undefined) setPositionValue(targetEl, "height", prev.height);
      },
      redo: () => {
        const targetEl = slide.elements[elementIndex];
        if (!targetEl) return;
        if (next.width !== undefined) setPositionValue(targetEl, "width", next.width);
        if (next.height !== undefined) setPositionValue(targetEl, "height", next.height);
      },
    },
  };
}

async function applyScreenshotCurrent(_params, context) {
  const state = ensureState(context);
  const bridge = context.canvasBridge;
  if (!bridge || typeof bridge.screenshot !== "function") {
    throw buildToolError("Canvas bridge screenshot() not available");
  }
  const image = await bridge.screenshot(state);
  return { data: { image }, skipHistory: true };
}

async function applyParseCanvasState(_params, context) {
  const state = ensureState(context);
  const bridge = context.canvasBridge;
  if (!bridge || typeof bridge.canvasToDsl !== "function") {
    throw buildToolError("Canvas bridge canvasToDsl() not available");
  }
  const dsl = await bridge.canvasToDsl(state);
  state.currentDsl = dsl;
  const currentIndex = Number.isFinite(state.currentSlideIndex) ? state.currentSlideIndex : 0;
  if (state.slides[currentIndex]) state.slides[currentIndex].htmlDsl = dsl;
  return { data: { dsl }, skipHistory: true };
}

function applyUndo(_params, context) {
  const historyManager = context.historyManager;
  if (!historyManager) throw buildToolError("History manager not available");
  const entry = historyManager.undo();
  return { data: { entry }, skipHistory: true };
}

function applyRedo(_params, context) {
  const historyManager = context.historyManager;
  if (!historyManager) throw buildToolError("History manager not available");
  const entry = historyManager.redo();
  return { data: { entry }, skipHistory: true };
}

const TOOL_HANDLERS = {
  [EditOperationType.ADD_SLIDE]: applyAddSlide,
  [EditOperationType.DELETE_SLIDE]: applyDeleteSlide,
  [EditOperationType.REORDER_SLIDES]: applyReorderSlides,
  [EditOperationType.DUPLICATE_SLIDE]: applyDuplicateSlide,
  [EditOperationType.CHANGE_COLOR_SCHEME]: applyChangeColorScheme,
  [EditOperationType.CHANGE_FONT]: applyChangeFont,
  [EditOperationType.APPLY_THEME]: applyTheme,
  [EditOperationType.EDIT_ELEMENT]: applyEditElement,
  [EditOperationType.DELETE_ELEMENT]: applyDeleteElement,
  [EditOperationType.ADD_ELEMENT]: applyAddElement,
  [EditOperationType.MOVE_ELEMENT]: applyMoveElement,
  [EditOperationType.RESIZE_ELEMENT]: applyResizeElement,
  screenshot_current: applyScreenshotCurrent,
  parse_canvas_state: applyParseCanvasState,
  [EditOperationType.UNDO]: applyUndo,
  [EditOperationType.REDO]: applyRedo,
};

/**
 * Create a tool executor bound to the given context.
 * @param {object} [context] - Execution context
 * @param {object} [context.state] - Current deck state
 * @param {object} [context.historyManager] - History manager for undo/redo
 * @param {object} [context.canvasBridge] - Canvas bridge for screenshot/DSL
 * @param {Function} [context.emit] - Event emitter function
 * @param {Function} [context.idGenerator] - Custom element ID generator
 * @param {Function} [context.slideIdGenerator] - Custom slide ID generator
 * @returns {Function} Async function (toolName, params) => { success, data?, error? }
 */
export function createEditToolExecutor(context = {}) {
  const ctx = isPlainObject(context) ? context : {};
  return async function executeEditTool(toolName, params = {}) {
    const name = typeof toolName === "string" ? toolName : "";
    const handler = TOOL_HANDLERS[name];
    if (!handler) return { success: false, error: `Unknown edit tool: ${String(toolName)}` };
    try {
      const result = await handler(params, ctx);
      if (!result?.skipHistory && result?.operation && ctx.historyManager) {
        ctx.historyManager.push(result.operation);
      }
      return { success: true, data: result?.data };
    } catch (error) {
      return { success: false, error: error?.message || String(error) };
    }
  };
}
