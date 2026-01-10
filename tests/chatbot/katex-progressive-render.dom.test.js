// @vitest-environment jsdom
/**
 * @file tests/chatbot/katex-progressive-render.dom.test.js
 * @description js/chatbot/utils/katex-progressive-render.js unit tests (jsdom)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let KaTeXProgressiveRenderer;
let PROGRESSIVE_CONFIG;

async function loadModule() {
  const mod = await import('../../js/chatbot/utils/katex-progressive-render.js');
  KaTeXProgressiveRenderer = mod.KaTeXProgressiveRenderer;
  PROGRESSIVE_CONFIG = mod.PROGRESSIVE_CONFIG;
  return mod;
}

describe('chatbot/utils/katex-progressive-render (KaTeXProgressiveRenderer)', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.useFakeTimers();

    document.body.innerHTML = '';

    delete window.renderWithKatexStreaming;
    delete window.__pbKatexProgressivePatched;
    delete window.katexProgressiveRenderer;
    delete window.KaTeXProgressiveRenderer;
    delete window.renderKatexCached;

    globalThis.katex = {
      renderToString: vi.fn((tex) => `<span class="katex">${tex}</span>`),
    };

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await loadModule();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();

    delete globalThis.katex;
    delete window.renderWithKatexStreaming;
    delete window.__pbKatexProgressivePatched;
    delete window.katexProgressiveRenderer;
    delete window.KaTeXProgressiveRenderer;
    delete window.renderKatexCached;
  });

  it('renderMarkdownWithPlaceholders extracts multiple formula syntaxes', () => {
    const renderer = new KaTeXProgressiveRenderer();
    const input = 'Block $$ x^2 $$ and \\[ y \\] and inline $a+b$ and \\(c\\).';

    const { md, formulas } = renderer.renderMarkdownWithPlaceholders(input);

    expect(formulas).toHaveLength(4);
    expect(formulas.map((f) => [f.tex, f.displayMode])).toEqual([
      ['x^2', true],
      ['y', true],
      ['a+b', false],
      ['c', false],
    ]);

    expect(md).toContain(PROGRESSIVE_CONFIG.PLACEHOLDER_CLASS);
    expect(md).toContain('katex-formula-0');
    expect(md).toContain('katex-formula-3');
  });

  it('queueFormulas progressively replaces placeholders in the DOM', async () => {
    const renderer = new KaTeXProgressiveRenderer();
    const { md, formulas } = renderer.renderMarkdownWithPlaceholders('$$x$$ and $y$');

    const host = document.createElement('div');
    host.innerHTML = md;
    document.body.appendChild(host);

    expect(host.querySelectorAll(`.${PROGRESSIVE_CONFIG.PLACEHOLDER_CLASS}`)).toHaveLength(2);

    renderer.queueFormulas(formulas);
    await vi.runAllTimersAsync();

    expect(renderer.isRendering).toBe(false);
    expect(host.querySelectorAll(`.${PROGRESSIVE_CONFIG.PLACEHOLDER_CLASS}`)).toHaveLength(0);
    expect(host.querySelectorAll('.katex-block')).toHaveLength(1);
    expect(host.querySelectorAll('.katex-inline')).toHaveLength(1);

    expect(globalThis.katex.renderToString).toHaveBeenCalledWith(
      'x',
      expect.objectContaining({ displayMode: true, output: 'html' }),
    );
    expect(globalThis.katex.renderToString).toHaveBeenCalledWith(
      'y',
      expect.objectContaining({ displayMode: false, output: 'html' }),
    );
  });

  it('renderFormula prefers window.renderKatexCached when provided', () => {
    window.renderKatexCached = vi.fn(() => '<span class="katex">cached</span>');

    const renderer = new KaTeXProgressiveRenderer();
    const placeholder = document.createElement('span');
    placeholder.id = 'katex-formula-0';
    document.body.appendChild(placeholder);

    renderer.renderFormula({ id: 'katex-formula-0', tex: 'x', displayMode: false });

    expect(window.renderKatexCached).toHaveBeenCalledWith(
      'x',
      expect.objectContaining({ displayMode: false, output: 'html' }),
    );
    expect(document.querySelector('#katex-formula-0')).toBeNull();
    expect(document.querySelector('.katex-inline')).toBeTruthy();
  });

  it('renderFormula falls back when katex throws', () => {
    globalThis.katex.renderToString.mockImplementation(() => {
      throw new Error('boom');
    });

    const renderer = new KaTeXProgressiveRenderer();
    const placeholder = document.createElement('div');
    placeholder.id = 'katex-formula-1';
    document.body.appendChild(placeholder);

    renderer.renderFormula({ id: 'katex-formula-1', tex: '\\\\bad', displayMode: true });

    expect(console.error).toHaveBeenCalled();
    expect(document.querySelector('#katex-formula-1')).toBeNull();
    expect(document.querySelector('.katex-fallback.katex-block')).toBeTruthy();
    expect(document.body.textContent).toContain('\\\\bad');
  });

  it('renderFormula warns when placeholder is missing', () => {
    const renderer = new KaTeXProgressiveRenderer();
    renderer.renderFormula({ id: 'nope', tex: 'x', displayMode: false });
    expect(console.warn).toHaveBeenCalledWith('[KaTeX Progressive] 占位符未找到: nope');
  });
});
