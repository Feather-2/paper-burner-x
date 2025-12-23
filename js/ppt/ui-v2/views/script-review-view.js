/**
 * Script review view (report editor)
 */

import BaseView from './base-view.js';
import { getPptGeneratorAdapter } from '../adapters/agent-adapter.js';

export class ScriptReviewView extends BaseView {
  constructor(options = {}) {
    super(options);
    this._adapter = options.adapter || getPptGeneratorAdapter();
    this._tocTimer = null;
  }

  onMount() {
    this._adapter?.syncFromGenerator?.();
    this._mountScriptEditor();
  }

  onUnmount() {
    if (this._tocTimer) {
      clearTimeout(this._tocTimer);
      this._tocTimer = null;
    }
    if (typeof VditorAdapter !== 'undefined') {
      VditorAdapter.destroy?.();
    }
  }

  render() {
    return `
      <div class="ppt-question-form script-review">
        <div class="form-header">
          <div class="form-header-left">
            <h3><iconify-icon icon="carbon:document"></iconify-icon> 研究报告（可编辑）</h3>
          </div>
          <div class="form-header-right">
            <button class="ppt-btn-primary ppt-btn-sm" data-action="confirmScript">
              打开审阅并确认 <iconify-icon icon="carbon:arrow-right"></iconify-icon>
            </button>
          </div>
        </div>
        <div class="form-header-hint script-review-hint">
          <iconify-icon icon="carbon:information"></iconify-icon>
          <span>请先在「报告审阅」面板中确认后进入页面规划</span>
        </div>
        <div class="form-body custom-scrollbar">
          <div class="script-editor-toc custom-scrollbar">
            <div class="toc-header">目录</div>
            <div id="scriptTocContent"></div>
          </div>
          <div class="script-editor-main">
            <div id="vditorScriptEditor"></div>
          </div>
        </div>
      </div>
    `;
  }

  _getReportMarkdown() {
    const stored = this.getState('data.reportMarkdown');
    if (typeof stored === 'string') return stored;
    return this._adapter?.getReportMarkdown?.() || '';
  }

  _mountScriptEditor() {
    if (typeof document === 'undefined') return;
    const container = this.$('#vditorScriptEditor');
    if (!container) return;

    const md = this._getReportMarkdown();
    const tocContainer = this.$('#scriptTocContent');
    const escapeHtml = (value) => String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');

    const parseHeadings = (markdown) => {
      const lines = String(markdown ?? '').split(/\r?\n/);
      const headings = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = /^(#{1,3})\s+(.+?)\s*$/.exec(line);
        if (!match) continue;
        const level = match[1].length;
        const text = String(match[2] || '').replace(/\s+#+\s*$/, '').trim();
        if (!text) continue;
        headings.push({ level, text, line: i });
      }
      return headings;
    };

    const renderToc = (markdown) => {
      if (!tocContainer) return [];
      const headings = parseHeadings(markdown);
      tocContainer.innerHTML = headings.map((h, index) => (
        `<div class="toc-item toc-h${h.level}" data-line="${h.line}" data-index="${index}">${escapeHtml(h.text)}</div>`
      )).join('');
      return headings;
    };

    const scrollToTocTarget = ({ index, line }) => {
      const editorRoot = this.$('#vditorScriptEditor');
      const vditorInstance = (typeof VditorAdapter !== 'undefined' && VditorAdapter)
        ? VditorAdapter._instance
        : null;

      const headingEls = editorRoot?.querySelectorAll?.([
        '.vditor-ir h1', '.vditor-ir h2', '.vditor-ir h3',
        '.vditor-wysiwyg h1', '.vditor-wysiwyg h2', '.vditor-wysiwyg h3',
        '.vditor-preview h1', '.vditor-preview h2', '.vditor-preview h3',
      ].join(','));
      const target = headingEls?.[index];
      if (target?.scrollIntoView) {
        try { target.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch { target.scrollIntoView(); }
        vditorInstance?.focus?.();
        return true;
      }

      const textarea = editorRoot?.querySelector?.('textarea');
      if (textarea && typeof textarea.value === 'string') {
        const text = textarea.value;
        let pos = 0;
        let currentLine = 0;
        while (currentLine < line && pos < text.length) {
          const nextBreak = text.indexOf('\n', pos);
          if (nextBreak === -1) break;
          pos = nextBreak + 1;
          currentLine++;
        }
        try {
          textarea.focus?.();
          textarea.setSelectionRange?.(pos, pos);
        } catch {
          // ignore
        }
        const lineHeight = Number.parseFloat(getComputedStyle(textarea).lineHeight) || 20;
        textarea.scrollTop = Math.max(0, (line - 2)) * lineHeight;
        return true;
      }

      return false;
    };

    const scheduleTocRender = (markdown) => {
      if (!tocContainer) return;
      if (this._tocTimer) clearTimeout(this._tocTimer);
      this._tocTimer = setTimeout(() => renderToc(markdown), 120);
    };

    if (tocContainer) {
      tocContainer.onclick = (e) => {
        const item = e.target?.closest?.('.toc-item');
        if (!item) return;
        const index = Number.parseInt(item.getAttribute('data-index') || '0', 10);
        const line = Number.parseInt(item.getAttribute('data-line') || '0', 10);
        scrollToTocTarget({ index, line });
      };
    }

    renderToc(md);

    if (typeof VditorAdapter !== 'undefined' && VditorAdapter.isAvailable()) {
      VditorAdapter.mount({
        container: 'vditorScriptEditor',
        value: md,
        onInput: (value) => {
          this._adapter?.updateReportMarkdown?.(value);
          scheduleTocRender(value);
        },
        mode: 'ir'
      });
      scheduleTocRender(VditorAdapter.getValue?.() ?? md);
    } else if (typeof VditorAdapter !== 'undefined') {
      container.innerHTML = `
        <textarea class="ppt-input-field" style="width: 100%; min-height: 360px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; line-height: 1.5;">${escapeHtml(md)}</textarea>
      `;
      const textarea = container.querySelector?.('textarea');
      if (textarea) {
        textarea.addEventListener('input', () => {
          this._adapter?.updateReportMarkdown?.(textarea.value);
          scheduleTocRender(textarea.value);
        });
      }
      scheduleTocRender(md);
    }
  }

  _onConfirmScript() {
    this._adapter?.confirmScript?.();
  }
}

export default ScriptReviewView;
