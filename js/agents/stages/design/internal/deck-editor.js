/**
 * DeckEditor - 共享编辑层
 *
 * 为 Reviewer 和 Edit Agent 提供统一的编辑能力：
 * - 元素编辑
 * - 幻灯片编辑
 * - 批量编辑
 * - 风格修复
 */

import { parseSections, joinSections } from "../refiner/react-refiner-tools.js";

/**
 * @typedef {{ success: boolean, data?: any, error?: string }} ToolResult
 */

/**
 * @typedef {(toolName: string, params: any) => Promise<ToolResult>} ToolExecutor
 */

/**
 * @typedef {object} DeckPackage
 * @property {string} deckHtmlDsl
 * @property {any[]} [slidesMeta]
 */

/**
 * @typedef {object} DeckEditorOptions
 * @property {ToolExecutor} [toolExecutor]
 * @property {DeckPackage} [deckPackage]
 * @property {any} [config]
 */

/**
 * 编辑器配置
 */
export const EDITOR_CONFIG = {
  maxHistoryLength: 50,
};

import { isPlainObject } from "../shared/design-utils.js";

/**
 * HTML 转义，防止 XSS
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (typeof str !== "string") return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const MAX_STYLE_LENGTH = 4000;
const SAFE_STYLE_PROPERTIES = new Set([
  "color",
  "background",
  "background-color",
  "font-size",
  "font-weight",
  "font-style",
  "font-family",
  "text-align",
  "text-decoration",
  "text-transform",
  "letter-spacing",
  "line-height",
  "opacity",
  "border",
  "border-color",
  "border-width",
  "border-style",
  "border-radius",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "width",
  "height",
  "max-width",
  "max-height",
  "min-width",
  "min-height",
  "display",
  "flex",
  "flex-direction",
  "flex-wrap",
  "flex-grow",
  "flex-shrink",
  "flex-basis",
  "justify-content",
  "align-items",
  "align-self",
  "justify-self",
  "gap",
  "position",
  "top",
  "right",
  "bottom",
  "left",
  "overflow",
  "overflow-x",
  "overflow-y",
  "white-space",
  "text-overflow",
  "box-shadow",
  "text-shadow",
  "transform",
  "transform-origin",
  "z-index",
]);

function isDangerousStyleValue(value) {
  const s = String(value ?? "").replace(/\u0000/g, "").toLowerCase();
  if (!s) return false;
  if (s.includes("expression(")) return true;
  if (s.includes("javascript:")) return true;
  if (s.includes("vbscript:")) return true;
  if (s.includes("url(")) return true;
  if (s.includes("@import")) return true;
  return false;
}

function sanitizeInlineStyle(style) {
  const raw = typeof style === "string" ? style : String(style ?? "");
  if (!raw) return "";
  const declarations = raw.slice(0, MAX_STYLE_LENGTH).split(";");
  const safe = [];
  for (const decl of declarations) {
    const idx = decl.indexOf(":");
    if (idx <= 0) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    if (!SAFE_STYLE_PROPERTIES.has(prop)) continue;
    const value = decl.slice(idx + 1).trim();
    if (!value) continue;
    if (isDangerousStyleValue(value)) continue;
    safe.push(`${prop}: ${value}`);
  }
  return safe.join("; ");
}

function isDangerousUrl(value) {
  const raw = String(value ?? "").replace(/\u0000/g, "").trim();
  if (!raw) return false;
  const s = raw.toLowerCase();
  if (s.startsWith("javascript:") || s.startsWith("vbscript:")) return true;
  if (s.startsWith("data:") && !s.startsWith("data:image/")) return true;
  return false;
}

function hasDangerousUrlList(value) {
  const raw = String(value ?? "");
  if (!raw) return false;
  const parts = raw.split(",");
  for (const part of parts) {
    const candidate = part.trim().split(/\s+/)[0];
    if (isDangerousUrl(candidate)) return true;
  }
  return false;
}

const DANGEROUS_TAG_RE = /<\/?(script|iframe|object|embed|link|meta|base)[^>]*>/gi;
const EVENT_HANDLER_ATTR_RE = /\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const URL_ATTR_RE =
  /\s(?:href|src|xlink:href|formaction|action|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const STYLE_ATTR_RE = /\sstyle\s*=\s*("([^"]*)"|'([^']*)')/gi;

function sanitizeHtmlFragmentSync(html) {
  const input = typeof html === "string" ? html : String(html ?? "");
  if (!input.trim()) return "";
  let out = input;
  out = out.replace(DANGEROUS_TAG_RE, "");
  out = out.replace(EVENT_HANDLER_ATTR_RE, "");
  out = out.replace(URL_ATTR_RE, (match, d1, d2, d3) => {
    const value = d1 ?? d2 ?? d3 ?? "";
    if (hasDangerousUrlList(value)) return "";
    return match;
  });
  out = out.replace(STYLE_ATTR_RE, (_match, _quoted, d1, d2) => {
    const rawStyle = d1 ?? d2 ?? "";
    const sanitized = sanitizeInlineStyle(rawStyle);
    if (!sanitized && String(rawStyle).trim() !== "") return "";
    return sanitized ? ` style="${escapeHtml(sanitized)}"` : ` style=""`;
  });
  return out;
}

/**
 * DeckEditor 类
 */
export class DeckEditor {
  /**
   * @param {DeckEditorOptions} [options={}]
   */
  constructor(options = {}) {
    this._toolExecutor = options.toolExecutor;
    this._deckPackage = options.deckPackage || { deckHtmlDsl: "" };
    this._history = [];
    this._historyIndex = -1;
    this._config = { ...EDITOR_CONFIG, ...options.config };
  }

  /**
   * 设置 deck package
   *
   * @param {DeckPackage} deckPackage
   * @returns {void}
   */
  setDeckPackage(deckPackage) {
    this._deckPackage = deckPackage;
  }

  /**
   * 获取当前 deck HTML DSL
   *
   * @returns {string}
   */
  getDeckHtmlDsl() {
    return this._deckPackage?.deckHtmlDsl || "";
  }

  /**
   * 编辑元素
   *
   * @param {number} slideIndex
   * @param {string} elementId
   * @param {any} changes
   * @returns {Promise<ToolResult>}
   */
  async editElement(slideIndex, elementId, changes) {
    if (this._toolExecutor) {
      const result = await this._toolExecutor("editElement", { slideIndex, elementId, changes });
      if (result.success) {
        const prevDeckHtmlDsl = this._deckPackage.deckHtmlDsl;
        this._deckPackage.deckHtmlDsl = result.data?.deckPackage?.deckHtmlDsl || this._deckPackage.deckHtmlDsl;
        this._pushHistory("editElement", { slideIndex, elementId, changes }, {
          prevDeckHtmlDsl,
          nextDeckHtmlDsl: this._deckPackage.deckHtmlDsl,
        });
      }
      return result;
    }

    // 直接编辑模式
    return this._directEditElement(slideIndex, elementId, changes);
  }

  /**
   * 编辑幻灯片
   *
   * @param {number} slideIndex
   * @param {any} changes
   * @returns {Promise<ToolResult>}
   */
  async editSlide(slideIndex, changes) {
    if (this._toolExecutor) {
      const result = await this._toolExecutor("editSlide", { slideIndex, changes });
      if (result.success) {
        const prevDeckHtmlDsl = this._deckPackage.deckHtmlDsl;
        this._deckPackage.deckHtmlDsl = result.data?.deckPackage?.deckHtmlDsl || this._deckPackage.deckHtmlDsl;
        this._pushHistory("editSlide", { slideIndex, changes }, {
          prevDeckHtmlDsl,
          nextDeckHtmlDsl: this._deckPackage.deckHtmlDsl,
        });
      }
      return result;
    }

    // 直接编辑模式
    return this._directEditSlide(slideIndex, changes);
  }

  /**
   * 批量编辑
   *
   * @param {Array<{ type: "element"|"slide", slideIndex: number, elementId?: string, changes: any }>} edits
   * @returns {Promise<ToolResult>}
   */
  async batchEdit(edits) {
    if (!Array.isArray(edits) || edits.length === 0) {
      return { success: false, error: "edits must be a non-empty array" };
    }

    const results = [];
    let successCount = 0;

    for (const edit of edits) {
      let result;
      if (edit.type === "element") {
        result = await this.editElement(edit.slideIndex, edit.elementId, edit.changes);
      } else if (edit.type === "slide") {
        result = await this.editSlide(edit.slideIndex, edit.changes);
      } else {
        result = { success: false, error: `Unknown edit type: ${edit.type}` };
      }

      results.push({ ...edit, result });
      if (result.success) successCount++;
    }

    return {
      success: successCount > 0,
      data: {
        total: edits.length,
        success: successCount,
        failed: edits.length - successCount,
        results,
      },
    };
  }

  /**
   * 应用风格修复
   *
   * @param {any} fix
   * @returns {Promise<ToolResult>}
   */
  async applyStyleFix(fix) {
    if (!isPlainObject(fix)) {
      return { success: false, error: "fix must be an object" };
    }

    /** @type {Array<{ type: "element"|"slide", slideIndex: number, elementId?: string, changes: any }>} */
    const edits = [];

    // 颜色修复
    if (fix.colorFixes && Array.isArray(fix.colorFixes)) {
      for (const colorFix of fix.colorFixes) {
        edits.push({
          type: "element",
          slideIndex: colorFix.slideIndex,
          elementId: colorFix.elementId,
          changes: { style: colorFix.newStyle },
        });
      }
    }

    // 字体修复
    if (fix.fontFixes && Array.isArray(fix.fontFixes)) {
      for (const fontFix of fix.fontFixes) {
        edits.push({
          type: "element",
          slideIndex: fontFix.slideIndex,
          elementId: fontFix.elementId,
          changes: { style: fontFix.newStyle },
        });
      }
    }

    // 布局修复
    if (fix.layoutFixes && Array.isArray(fix.layoutFixes)) {
      for (const layoutFix of fix.layoutFixes) {
        edits.push({
          type: "slide",
          slideIndex: layoutFix.slideIndex,
          changes: { layout: layoutFix.newLayout },
        });
      }
    }

    // 直接 HTML 替换
    if (fix.htmlReplacements && Array.isArray(fix.htmlReplacements)) {
      for (const replacement of fix.htmlReplacements) {
        edits.push({
          type: "slide",
          slideIndex: replacement.slideIndex,
          changes: { html: replacement.newHtml },
        });
      }
    }

    if (edits.length === 0) {
      return { success: true, data: { message: "No fixes to apply" } };
    }

    return this.batchEdit(edits);
  }

  /**
   * 替换整个幻灯片 HTML
   *
   * @param {number} slideIndex
   * @param {string} newHtml
   * @returns {ToolResult}
   */
  replaceSlideHtml(slideIndex, newHtml) {
    // 输入验证：类型和长度限制
    if (typeof newHtml !== "string") {
      return { success: false, error: "newHtml must be a string" };
    }
    if (newHtml.length > 500000) {
      return { success: false, error: "newHtml exceeds max length (500KB)" };
    }

    const sections = parseSections(this._deckPackage.deckHtmlDsl);
    if (slideIndex < 0 || slideIndex >= sections.length) {
      return { success: false, error: `Invalid slideIndex: ${slideIndex}` };
    }

    const prevDeckHtmlDsl = this._deckPackage.deckHtmlDsl;
    const prevHtml = sections[slideIndex];
    const sanitizedHtml = sanitizeHtmlFragmentSync(newHtml);
    sections[slideIndex] = sanitizedHtml;
    this._deckPackage.deckHtmlDsl = joinSections(sections);
    this._pushHistory("replaceSlideHtml", { slideIndex, prevHtml, newHtml: sanitizedHtml }, {
      prevDeckHtmlDsl,
      nextDeckHtmlDsl: this._deckPackage.deckHtmlDsl,
    });

    return { success: true, data: { slideIndex, newHtml: sanitizedHtml } };
  }

  /**
   * 撤销
   *
   * @returns {ToolResult}
   */
  undo() {
    if (this._historyIndex < 0) {
      return { success: false, error: "Nothing to undo" };
    }

    const entry = this._history[this._historyIndex];
    this._historyIndex--;

    // 恢复之前的状态
    if (entry.prevDeckHtmlDsl) {
      this._deckPackage.deckHtmlDsl = entry.prevDeckHtmlDsl;
    }

    return { success: true, data: { undone: entry } };
  }

  /**
   * 重做
   *
   * @returns {ToolResult}
   */
  redo() {
    if (this._historyIndex >= this._history.length - 1) {
      return { success: false, error: "Nothing to redo" };
    }

    this._historyIndex++;
    const entry = this._history[this._historyIndex];

    // 恢复之后的状态
    if (entry.nextDeckHtmlDsl) {
      this._deckPackage.deckHtmlDsl = entry.nextDeckHtmlDsl;
    }

    return { success: true, data: { redone: entry } };
  }

  /**
   * 获取历史记录
   *
   * @returns {{ entries: any[], currentIndex: number, canUndo: boolean, canRedo: boolean }}
   */
  getHistory() {
    return {
      entries: this._history.slice(),
      currentIndex: this._historyIndex,
      canUndo: this._historyIndex >= 0,
      canRedo: this._historyIndex < this._history.length - 1,
    };
  }

  // 私有方法

  _pushHistory(action, params, historyState = null) {
    const entry = {
      action,
      params,
      timestamp: Date.now(),
      prevDeckHtmlDsl: this._deckPackage.deckHtmlDsl,
    };

    if (historyState && Object.prototype.hasOwnProperty.call(historyState, "prevDeckHtmlDsl")) {
      entry.prevDeckHtmlDsl = historyState.prevDeckHtmlDsl;
    }
    if (historyState && Object.prototype.hasOwnProperty.call(historyState, "nextDeckHtmlDsl")) {
      entry.nextDeckHtmlDsl = historyState.nextDeckHtmlDsl;
    }

    // 截断 redo 历史
    this._history = this._history.slice(0, this._historyIndex + 1);
    this._history.push(entry);
    this._historyIndex = this._history.length - 1;

    // 限制历史长度
    if (this._history.length > this._config.maxHistoryLength) {
      this._history.shift();
      this._historyIndex--;
    }
  }

  async _directEditElement(slideIndex, elementId, changes) {
    const prevDeckHtmlDsl = this._deckPackage.deckHtmlDsl;
    const sections = parseSections(this._deckPackage.deckHtmlDsl);
    if (slideIndex < 0 || slideIndex >= sections.length) {
      return { success: false, error: `Invalid slideIndex: ${slideIndex}` };
    }

    let sectionHtml = sections[slideIndex];
    const selector = `data-el="${elementId}"`;

    if (!sectionHtml.includes(selector)) {
      return { success: false, error: `Element not found: ${elementId}` };
    }

    let appliedChanges = changes;

    // 简单的文本替换（转义防 XSS）
    if (changes.text !== undefined) {
      const safeText = escapeHtml(String(changes.text).slice(0, 10000));
      const regex = new RegExp(`(data-el="${elementId}"[^>]*>)[^<]*(<)`, "g");
      sectionHtml = sectionHtml.replace(regex, `$1${safeText}$2`);
      appliedChanges = { ...appliedChanges, text: safeText };
    }

    if (changes.style !== undefined) {
      const regex = new RegExp(`(data-el="${elementId}"[^>]*style=")[^"]*"`, "g");
      if (sectionHtml.match(regex)) {
        const rawStyle = String(changes.style ?? "");
        const sanitizedStyle = sanitizeInlineStyle(rawStyle);
        if (sanitizedStyle || rawStyle.trim() === "") {
          const safeStyle = escapeHtml(sanitizedStyle);
          sectionHtml = sectionHtml.replace(regex, `$1${safeStyle}"`);
          appliedChanges = { ...appliedChanges, style: sanitizedStyle };
        }
      }
    }

    sections[slideIndex] = sectionHtml;
    this._deckPackage.deckHtmlDsl = joinSections(sections);
    this._pushHistory("editElement", { slideIndex, elementId, changes: appliedChanges }, {
      prevDeckHtmlDsl,
      nextDeckHtmlDsl: this._deckPackage.deckHtmlDsl,
    });

    return { success: true, data: { slideIndex, elementId } };
  }

  async _directEditSlide(slideIndex, changes) {
    const prevDeckHtmlDsl = this._deckPackage.deckHtmlDsl;
    const sections = parseSections(this._deckPackage.deckHtmlDsl);
    if (slideIndex < 0 || slideIndex >= sections.length) {
      return { success: false, error: `Invalid slideIndex: ${slideIndex}` };
    }

    let appliedChanges = changes;

    // HTML 替换：限制长度，仅接受字符串
    if (changes.html) {
      if (typeof changes.html !== "string") {
        return { success: false, error: "changes.html must be a string" };
      }
      if (changes.html.length > 500000) {
        return { success: false, error: "changes.html exceeds max length (500KB)" };
      }
      const sanitizedHtml = sanitizeHtmlFragmentSync(changes.html);
      sections[slideIndex] = sanitizedHtml;
      appliedChanges = { ...appliedChanges, html: sanitizedHtml };
    }

    // 布局替换：白名单验证
    if (changes.layout) {
      const safeLayout = String(changes.layout).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 50);
      sections[slideIndex] = sections[slideIndex].replace(/data-layout="[^"]*"/, `data-layout="${safeLayout}"`);
    }

    this._deckPackage.deckHtmlDsl = joinSections(sections);
    this._pushHistory("editSlide", { slideIndex, changes: appliedChanges }, {
      prevDeckHtmlDsl,
      nextDeckHtmlDsl: this._deckPackage.deckHtmlDsl,
    });

    return { success: true, data: { slideIndex } };
  }
}

/**
 * @param {DeckEditorOptions} [options={}]
 * @returns {DeckEditor}
 */
export function createDeckEditor(options = {}) {
  return new DeckEditor(options);
}
