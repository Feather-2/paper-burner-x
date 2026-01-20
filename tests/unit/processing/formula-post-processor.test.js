// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function loadFormulaPostProcessor() {
  return await import('../../../js/processing/formula_post_processor.esm.js');
}

function stubKatex() {
  const render = vi.fn((formula, element, options) => {
    element.setAttribute('data-formula', formula);
    element.setAttribute('data-display', String(Boolean(options?.displayMode)));
  });

  globalThis.katex = { render };
  if (globalThis.window) {
    globalThis.window.katex = globalThis.katex;
  }

  return { render };
}

describe('js/processing/formula_post_processor.esm.js', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();

    document.body.innerHTML = '';

    delete globalThis.katex;
    delete globalThis.FormulaPostProcessor;
    if (globalThis.window) {
      delete globalThis.window.katex;
      delete globalThis.window.FormulaPostProcessor;
    }

    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();

    delete globalThis.katex;
    delete globalThis.FormulaPostProcessor;
    if (globalThis.window) {
      delete globalThis.window.katex;
      delete globalThis.window.FormulaPostProcessor;
    }
  });

  it('exports default API and mirrors to window', async () => {
    const api = await loadFormulaPostProcessor();

    expect(api.default).toEqual(
      expect.objectContaining({
        processFormulasInElement: expect.any(Function),
        version: '1.0.0',
      }),
    );
    expect(api.default).toBe(globalThis.FormulaPostProcessor);
    expect(window.FormulaPostProcessor).toBe(api.default);

    expect(typeof api.processFormulasInElement).toBe('function');
    expect(api.version).toBe('1.0.0');
  });

  it('renders inline and display formulas and returns counts', async () => {
    const api = await loadFormulaPostProcessor();
    const { render } = stubKatex();

    const root = document.createElement('div');
    root.textContent = 'a $x$ b $$y$$ c';
    document.body.appendChild(root);

    const result = api.processFormulasInElement(root);

    expect(result).toEqual({ processedCount: 2, removedCount: 0 });
    expect(render).toHaveBeenCalledTimes(2);

    expect(render).toHaveBeenNthCalledWith(
      1,
      'x',
      expect.any(HTMLElement),
      expect.objectContaining({ displayMode: false, throwOnError: false }),
    );
    expect(render).toHaveBeenNthCalledWith(
      2,
      'y',
      expect.any(HTMLElement),
      expect.objectContaining({ displayMode: true, throwOnError: false }),
    );

    expect(root.querySelectorAll('span.katex-inline')).toHaveLength(1);
    expect(root.querySelectorAll('span.katex-block')).toHaveLength(1);
  });

  it('removes \\tag from inline formulas and wraps multi-letter exponents', async () => {
    const api = await loadFormulaPostProcessor();
    const { render } = stubKatex();

    const root = document.createElement('div');
    root.textContent = 'Inline $\\tag{1}x^ab$';
    document.body.appendChild(root);

    const result = api.processFormulasInElement(root);

    expect(result).toEqual({ processedCount: 1, removedCount: 0 });
    expect(render).toHaveBeenCalledWith(
      'x^{ab}',
      expect.any(HTMLElement),
      expect.objectContaining({ displayMode: false }),
    );
  });

  it('keeps \\tag in display formulas', async () => {
    const api = await loadFormulaPostProcessor();
    const { render } = stubKatex();

    const root = document.createElement('div');
    root.textContent = 'Block $$\\tag{1}x$$';
    document.body.appendChild(root);

    const result = api.processFormulasInElement(root);

    expect(result).toEqual({ processedCount: 1, removedCount: 0 });
    expect(render).toHaveBeenCalledWith(
      '\\tag{1}x',
      expect.any(HTMLElement),
      expect.objectContaining({ displayMode: true }),
    );
  });

  it('fixes common LaTeX issues before rendering', async () => {
    const api = await loadFormulaPostProcessor();
    const { render } = stubKatex();

    const root = document.createElement('div');
    root.textContent = 'Temp $\\;^\\circ$ and braces ${{x}}$';
    document.body.appendChild(root);

    const result = api.processFormulasInElement(root);

    expect(result).toEqual({ processedCount: 2, removedCount: 0 });
    expect(render.mock.calls.map((call) => call[0])).toEqual(['\\,^{\\circ}', '{x}']);
  });

  it('removes incomplete katex-fallback environment markers', async () => {
    const api = await loadFormulaPostProcessor();
    stubKatex();

    const root = document.createElement('div');
    const fallback = document.createElement('span');
    fallback.className = 'katex-fallback';
    fallback.textContent = '\\begin{aligned}';
    root.appendChild(fallback);
    document.body.appendChild(root);

    const result = api.processFormulasInElement(root);

    expect(result).toEqual({ processedCount: 0, removedCount: 1 });
    expect(root.querySelector('.katex-fallback')).toBeNull();
  });

  it('repairs undefined control sequences in katex-fallback elements', async () => {
    const api = await loadFormulaPostProcessor();
    const { render } = stubKatex();

    const root = document.createElement('div');
    const fallback = document.createElement('span');
    fallback.className = 'katex-fallback';
    fallback.title = 'Undefined control sequence: \\Vec';
    fallback.textContent = '\\Vec{x}';
    root.appendChild(fallback);
    document.body.appendChild(root);

    const result = api.processFormulasInElement(root);

    expect(result).toEqual({ processedCount: 1, removedCount: 0 });
    expect(render).toHaveBeenCalledWith(
      '\\vec{x}',
      expect.any(HTMLElement),
      expect.objectContaining({ displayMode: false }),
    );

    expect(root.querySelector('.katex-fallback')).toBeNull();
    const rendered = root.querySelector('span.katex-inline');
    expect(rendered).toBeInstanceOf(HTMLSpanElement);
    expect(rendered.getAttribute('data-formula')).toBe('\\vec{x}');
  });

  it('skips formulas inside code blocks', async () => {
    const api = await loadFormulaPostProcessor();
    const { render } = stubKatex();

    const root = document.createElement('div');
    root.innerHTML = '<code>$x$</code> outside $y$';
    document.body.appendChild(root);

    const result = api.processFormulasInElement(root);

    expect(result).toEqual({ processedCount: 1, removedCount: 0 });
    expect(render).toHaveBeenCalledTimes(1);
    expect(render.mock.calls[0][0]).toBe('y');
    expect(root.querySelector('code')?.textContent).toBe('$x$');
  });
});
