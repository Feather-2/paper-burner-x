import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINALS = {
  katex: globalThis.katex,
  marked: globalThis.marked,
};

async function loadMarkdownTextFix() {
  await import('../../js/processing/markdown_text_fix.js');
  return globalThis.MarkdownTextFix;
}

describe('js/processing/markdown_text_fix.js', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();

    delete globalThis.MarkdownTextFix;
    if (globalThis.window) {
      delete globalThis.window.MarkdownTextFix;
    }

    await loadMarkdownTextFix();

    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();

    if (ORIGINALS.katex === undefined) {
      delete globalThis.katex;
    } else {
      globalThis.katex = ORIGINALS.katex;
    }

    if (ORIGINALS.marked === undefined) {
      delete globalThis.marked;
    } else {
      globalThis.marked = ORIGINALS.marked;
    }
  });

  it('sets globalThis.MarkdownTextFix before tests', () => {
    expect(globalThis.MarkdownTextFix).toBeTruthy();
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

    it('does not modify newlines inside protected $$...$$ blocks', () => {
      const { fixMathTextDisplay } = globalThis.MarkdownTextFix;

      const input = ['Para line1', '$$a', 'b$$', 'line2'].join('\n');
      const out = fixMathTextDisplay(input);

      expect(out).toContain('$$a\nb$$');
      expect(out).toContain('Para line1');
      expect(out).toContain('line2');
    });
  });

  describe('renderMathImproved', () => {
    it('preprocesses content and uses KaTeX with displayMode', () => {
      globalThis.katex = {
        renderToString: vi.fn((tex, _options) => `<katex>${tex}</katex>`),
      };

      const { renderMathImproved } = globalThis.MarkdownTextFix;
      const html = renderMathImproved('\\left( x1 \\times y2 \\right', true);

      expect(globalThis.katex.renderToString).toHaveBeenCalledWith(
        expect.stringContaining('\\right)'),
        expect.objectContaining({ displayMode: true }),
      );

      const [processed] = globalThis.katex.renderToString.mock.calls[0];
      expect(processed).toContain('x_{1}');
      expect(processed).toContain('y_{2}');
      expect(processed).toContain('\\times');

      expect(html).toContain('class="katex-display-fixed"');
      expect(html).toContain('data-original-text="');
      expect(html).toContain('<katex>');
    });

    it('returns a fallback block when KaTeX throws', () => {
      globalThis.katex = {
        renderToString: vi.fn(() => {
          throw new Error('boom');
        }),
      };

      const { renderMathImproved } = globalThis.MarkdownTextFix;
      const html = renderMathImproved('x', false);

      expect(html).toContain('katex-fallback');
      expect(html).toContain('data-katex-error="boom"');
      expect(html).toContain('math-error-inline');
    });
  });

  describe('renderMathMarkdown', () => {
    it('replaces known images, renders formulas, and forwards to marked.parse', () => {
      globalThis.katex = {
        renderToString: vi.fn((tex) => `<katex>${tex}</katex>`),
      };
      globalThis.marked = {
        parse: vi.fn((input) => `HTML:${input}`),
      };

      const { renderMathMarkdown } = globalThis.MarkdownTextFix;

      const md = '![A](images/img-0.jpeg.png) $x$ $$y$$';
      const html = renderMathMarkdown(md, [{ name: 'img-0.jpeg.png', data: 'AAAA' }]);

      expect(globalThis.marked.parse).toHaveBeenCalledWith(
        expect.stringContaining('data:image/png;base64,AAAA'),
        expect.any(Object),
      );

      const [passed] = globalThis.marked.parse.mock.calls[0];
      expect(passed).toContain('katex-inline-fixed');
      expect(passed).toContain('katex-display-fixed');
      expect(passed).toContain('<katex>x</katex>');
      expect(passed).toContain('<katex>y</katex>');

      expect(html).toContain('HTML:');
    });

    it('renders missing images as placeholders when an image list is provided', () => {
      globalThis.katex = {
        renderToString: vi.fn((tex) => `<katex>${tex}</katex>`),
      };
      globalThis.marked = {
        parse: vi.fn((input) => input),
      };

      const { renderMathMarkdown } = globalThis.MarkdownTextFix;

      const md = '![Missing](images/img-2.jpeg.png)';
      const html = renderMathMarkdown(md, [{ name: 'img-0.jpeg.png', data: 'AAAA' }]);

      expect(html).toContain('<span class="missing-image">[图片: Missing]</span>');
    });

    it('returns a markdown-error when marked.parse fails', () => {
      globalThis.katex = {
        renderToString: vi.fn((tex) => `<katex>${tex}</katex>`),
      };
      globalThis.marked = {
        parse: vi.fn(() => {
          throw new Error('parse failed');
        }),
      };

      const { renderMathMarkdown } = globalThis.MarkdownTextFix;

      const html = renderMathMarkdown('Hello $x$', []);
      expect(html).toContain('class="markdown-error"');
      expect(html).toContain('Markdown 解析失败: parse failed');
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
