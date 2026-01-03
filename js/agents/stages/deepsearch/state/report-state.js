import { isPlainObject, toNonEmptyString } from "../../../shared/utils/value-utils.js";

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

export class ReportState {
  constructor(root) {
    this._root = root;
  }

  get report() {
    return this._root?.L1?.report ?? null;
  }

  set report(value) {
    if (!this._root) return;
    if (!isPlainObject(this._root.L1)) this._root.L1 = {};
    this._root.L1.report = value;
  }

  get reportDraft() {
    const draft = this._root?.L1?.report?.draftMarkdown;
    return typeof draft === "string" ? draft : "";
  }

  set reportDraft(value) {
    const report = ensureReportContainer(this._root);
    if (!report) return;
    report.draftMarkdown = toNonEmptyString(value) || "";
  }

  get outline() {
    const sections = this._root?.L1?.report?.sections;
    return Array.isArray(sections) ? sections : [];
  }

  set outline(value) {
    const report = ensureReportContainer(this._root);
    if (!report) return;
    report.sections = Array.isArray(value) ? value : [];
  }
}
