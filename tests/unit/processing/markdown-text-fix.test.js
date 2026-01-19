import { beforeEach, describe, expect, it, vi } from 'vitest';

async function loadMarkdownTextFix() {
  await import('../../js/processing/markdown_text_fix.js');
  return globalThis.MarkdownTextFix;
}

describe('js/processing/markdown_text_fix.js', () => {
  beforeEach(async () => {
    vi.resetModules();

    delete globalThis.MarkdownTextFix;
    if (globalThis.window) {
      delete globalThis.window.MarkdownTextFix;
    }

    await loadMarkdownTextFix();
  });

  it('sets globalThis.MarkdownTextFix before tests', () => {
    expect(globalThis.MarkdownTextFix).toEqual(expect.objectContaining({
      fixMathTextDisplay: expect.any(Function),
      renderMathImproved: expect.any(Function),
      renderMathMarkdown: expect.any(Function),
      fixRenderedMath: expect.any(Function),
      enhancedKatexOptions: expect.any(Object),
      escapeHtml: expect.any(Function)
    }));
  });

  describe('fixMathTextDisplay', () => {
    it('handles empty/null inputs', () => {
      const { fixMathTextDisplay } = globalThis.MarkdownTextFix;

      expect(fixMathTextDisplay('')).toBe('');
      expect(fixMathTextDisplay(null)).toBe(null);
      expect(fixMathTextDisplay(undefined)).toBe(undefined);
    });

    it('fixes paragraph newlines by joining with spaces', () => {
      const { fixMathTextDisplay } = globalThis.MarkdownTextFix;

      expect(fixMathTextDisplay('line1\nline2')).toBe('line1 line2');
    });

    it('ensures spacing around formulas adjacent to text', () => {
      const { fixMathTextDisplay } = globalThis.MarkdownTextFix;

      expect(fixMathTextDisplay('a$x$b')).toBe('a $x$ b');
      expect(fixMathTextDisplay('a$$x$$b')).toBe('a $$x$$ b');
    });

    it('ensures spacing between Chinese characters and formulas', () => {
      const { fixMathTextDisplay } = globalThis.MarkdownTextFix;

      expect(fixMathTextDisplay('这是$x$测试')).toBe('这是 $x$ 测试');
      expect(fixMathTextDisplay('这是$$x$$测试')).toBe('这是 $$x$$ 测试');
    });
  });

  describe('escapeHtml', () => {
    it('escapes HTML special characters', () => {
      const { escapeHtml } = globalThis.MarkdownTextFix;

      expect(escapeHtml('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&#39;');
    });

    it('leaves regular text unchanged', () => {
      const { escapeHtml } = globalThis.MarkdownTextFix;

      expect(escapeHtml('Plain text 123')).toBe('Plain text 123');
    });
  });
});
