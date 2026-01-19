/**
 * DesignContext - PPT 设计专用状态管理
 *
 * 继承 UnifiedAgentContext，扩展 PPT 相关状态：
 * - 幻灯片意图 (slideIntents)
 * - 设计系统 (designSystem)
 * - 图片槽位 (imageSlots)
 * - 生成结果 (deckHtmlDsl, slidesMeta)
 */

import { UnifiedAgentContext } from "../../../runtime/context/unified-agent-context.js";

/**
 * @typedef {object} DesignContextOptions
 * @property {string} [runId]
 * @property {any[]} [slideIntents]
 * @property {any} [designSystem]
 * @property {any[]} [imageSlots]
 * @property {string} [deckHtmlDsl]
 * @property {any[]} [slidesMeta]
 * @property {any} [constraints]
 * @property {any} [userConfig]
 */

/**
 * @typedef {object} DesignContextSnapshot
 * @property {string} runId
 * @property {any[]} slideIntents
 * @property {any} designSystem
 * @property {any[]} imageSlots
 * @property {string} deckHtmlDsl
 * @property {any[]} slidesMeta
 * @property {any} constraints
 * @property {any} userConfig
 */

export class DesignContext extends UnifiedAgentContext {
  /**
   * @param {DesignContextOptions} [options={}]
   */
  constructor(options = {}) {
    super(options);

    // PPT 专用状态
    this._slideIntents = options.slideIntents || [];
    this._designSystem = options.designSystem || null;
    this._imageSlots = options.imageSlots || [];
    this._deckHtmlDsl = options.deckHtmlDsl || "";
    this._slidesMeta = options.slidesMeta || [];
    this._constraints = options.constraints || {};
    this._userConfig = options.userConfig || {};
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Slide Intents
  // ─────────────────────────────────────────────────────────────────────────────

  get slideIntents() {
    return this._slideIntents;
  }

  setSlideIntents(intents) {
    this._slideIntents = Array.isArray(intents) ? intents : [];
  }

  get slideCount() {
    return this._slideIntents.length;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Design System
  // ─────────────────────────────────────────────────────────────────────────────

  get designSystem() {
    return this._designSystem;
  }

  setDesignSystem(system) {
    this._designSystem = system || null;
  }

  get designTokens() {
    return this._designSystem?.designTokens || null;
  }

  get theme() {
    return this._designSystem?.theme || null;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Image Slots
  // ─────────────────────────────────────────────────────────────────────────────

  get imageSlots() {
    return this._imageSlots;
  }

  setImageSlots(slots) {
    this._imageSlots = Array.isArray(slots) ? slots : [];
  }

  updateImageSlot(slotId, updates) {
    const idx = this._imageSlots.findIndex((s) => s.slotId === slotId);
    if (idx >= 0) {
      this._imageSlots[idx] = { ...this._imageSlots[idx], ...updates };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Generated Output
  // ─────────────────────────────────────────────────────────────────────────────

  get deckHtmlDsl() {
    return this._deckHtmlDsl;
  }

  setDeckHtmlDsl(html) {
    this._deckHtmlDsl = typeof html === "string" ? html : "";
  }

  get slidesMeta() {
    return this._slidesMeta;
  }

  setSlidesMeta(meta) {
    this._slidesMeta = Array.isArray(meta) ? meta : [];
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Constraints & Config
  // ─────────────────────────────────────────────────────────────────────────────

  get constraints() {
    return this._constraints;
  }

  setConstraints(constraints) {
    this._constraints = constraints || {};
  }

  get userConfig() {
    return this._userConfig;
  }

  setUserConfig(config) {
    this._userConfig = config || {};
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Snapshot / Checkpoint
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * @returns {DesignContextSnapshot}
   */
  toSnapshot() {
    return {
      runId: this.runId,
      slideIntents: this._slideIntents,
      designSystem: this._designSystem,
      imageSlots: this._imageSlots,
      deckHtmlDsl: this._deckHtmlDsl,
      slidesMeta: this._slidesMeta,
      constraints: this._constraints,
      userConfig: this._userConfig,
    };
  }

  /**
   * @param {DesignContextSnapshot} snapshot
   * @param {DesignContextOptions} [options={}]
   * @returns {DesignContext}
   */
  static fromSnapshot(snapshot, options = {}) {
    return new DesignContext({
      ...options,
      runId: snapshot.runId,
      slideIntents: snapshot.slideIntents,
      designSystem: snapshot.designSystem,
      imageSlots: snapshot.imageSlots,
      deckHtmlDsl: snapshot.deckHtmlDsl,
      slidesMeta: snapshot.slidesMeta,
      constraints: snapshot.constraints,
      userConfig: snapshot.userConfig,
    });
  }
}

/**
 * @param {DesignContextOptions} [options={}]
 * @returns {DesignContext}
 */
export function createDesignContext(options = {}) {
  return new DesignContext(options);
}
