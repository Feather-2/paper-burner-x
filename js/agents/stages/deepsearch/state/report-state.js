import { isPlainObject, toNonEmptyString } from "../../../shared/index.js";

/**
 * @typedef {object} ReportContainer
 * @property {string} markdown
 * @property {string} draftMarkdown
 * @property {any[]} sections
 * @property {any[]} citations
 * @property {any[]} history
 * @property {number} version
 */

/**
 * @typedef {object} ReportStateRoot
 * @property {{ report?: ReportContainer|null }=} L1
 */

/**
 * @param {ReportStateRoot|null|undefined} root
 * @returns {ReportContainer|null}
 */
function ensureReportContainer(root) {
  if (!root) return null;
  if (!isPlainObject(root.L1)) root.L1 = {};
  if (!isPlainObject(root.L1.report)) {
    root.L1.report = {
      markdown: "",
      draftMarkdown: "",
      sections: [],
      citations: [],
      history: [],
      version: 0,
    };
  }
  return root.L1.report;
}

/**
 * Report and outline accessors stored on the DeepSearch root state.
 *
 * @param {ReportStateRoot|null|undefined} root
 * @returns {ReportState}
 */
export class ReportState {
  /**
   * @param {ReportStateRoot|null|undefined} root
   */
  constructor(root) {
    /** @type {ReportStateRoot|null|undefined} */
    this._root = root;
  }

  /**
   * @returns {ReportContainer|null}
   */
  get report() {
    return this._root?.L1?.report ?? null;
  }

  /**
   * @param {ReportContainer|null} value
   * @returns {void}
   */
  set report(value) {
    if (!this._root) return;
    if (!isPlainObject(this._root.L1)) this._root.L1 = {};
    this._root.L1.report = value;
  }

  /**
   * @returns {string}
   */
  get reportDraft() {
    const draft = this._root?.L1?.report?.draftMarkdown;
    return typeof draft === "string" ? draft : "";
  }

  /**
   * @param {any} value
   * @returns {void}
   */
  set reportDraft(value) {
    const report = ensureReportContainer(this._root);
    if (!report) return;
    report.draftMarkdown = toNonEmptyString(value) || "";
  }

  /**
   * @returns {any[]}
   */
  get outline() {
    const sections = this._root?.L1?.report?.sections;
    return Array.isArray(sections) ? sections : [];
  }

  /**
   * @param {any[]} value
   * @returns {void}
   */
  set outline(value) {
    const report = ensureReportContainer(this._root);
    if (!report) return;
    report.sections = Array.isArray(value) ? value : [];
  }
}
