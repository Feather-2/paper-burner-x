/**
 * @file tests/processing/markdown-processor.test.js
 * @description js/processing/markdown_processor.js unit tests (global side-effect module)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINALS = {
  window: globalThis.window,
  MarkdownProcessor: globalThis.MarkdownProcessor,
  MarkdownProcessorAST: globalThis.MarkdownProcessorAST,
  MarkdownProcessorEnhanced: globalThis.MarkdownProcessorEnhanced,
};

async function loadMarkdownProcessor() {
  const mod = await import('../../js/processing/markdown_processor.esm.js');
  return mod.default ?? globalThis.MarkdownProcessor;
}

describe('processing/markdown_processor (MarkdownProcessor)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();

    globalThis.window = {};

    delete globalThis.MarkdownProcessor;
    delete globalThis.MarkdownProcessorAST;
    delete globalThis.MarkdownProcessorEnhanced;

    delete globalThis.window.MarkdownProcessor;

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();

    if (ORIGINALS.window === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = ORIGINALS.window;
    }

    if (ORIGINALS.MarkdownProcessor === undefined) {
      delete globalThis.MarkdownProcessor;
    } else {
      globalThis.MarkdownProcessor = ORIGINALS.MarkdownProcessor;
    }

    if (ORIGINALS.MarkdownProcessorAST === undefined) {
      delete globalThis.MarkdownProcessorAST;
    } else {
      globalThis.MarkdownProcessorAST = ORIGINALS.MarkdownProcessorAST;
    }

    if (ORIGINALS.MarkdownProcessorEnhanced === undefined) {
      delete globalThis.MarkdownProcessorEnhanced;
    } else {
      globalThis.MarkdownProcessorEnhanced = ORIGINALS.MarkdownProcessorEnhanced;
    }
  });

  it('exports default API and exposes legacy helpers', async () => {
    const api = await loadMarkdownProcessor();

    expect(api).toBeTruthy();
    expect(api).toBe(globalThis.MarkdownProcessor);
    expect(window.MarkdownProcessor).toBe(api);

    expect(typeof api.safeMarkdown).toBe('function');
    expect(typeof api.renderWithKatexFailback).toBe('function');

    expect(api.legacy).toMatchObject({
      safeMarkdown: expect.any(Function),
      renderWithKatexFailback: expect.any(Function),
      protectMarkdownCodeSegments: expect.any(Function),
      restoreMarkdownCodeSegments: expect.any(Function),
    });
    expect(api.legacy.renderCache).toBeInstanceOf(Map);
  });

  it('routes to AST > Enhanced > Legacy at call time', async () => {
    const api = await loadMarkdownProcessor();

    const ast = {
      render: vi.fn(() => '<ast/>'),
      safeMarkdown: vi.fn(() => 'AST_SAFE'),
      renderWithKatexFailback: vi.fn(() => 'AST_RENDER'),
    };
    const enhanced = {
      safeMarkdown: vi.fn(() => 'ENH_SAFE'),
      renderWithKatexFailback: vi.fn(() => 'ENH_RENDER'),
    };

    globalThis.MarkdownProcessorAST = ast;
    globalThis.MarkdownProcessorEnhanced = enhanced;

    expect(api.safeMarkdown('md', [])).toBe('AST_SAFE');
    expect(ast.safeMarkdown).toHaveBeenCalledWith('md', []);
    expect(enhanced.safeMarkdown).not.toHaveBeenCalled();

    expect(api.renderWithKatexFailback('md')).toBe('AST_RENDER');
    expect(ast.renderWithKatexFailback).toHaveBeenCalledWith('md', undefined);
    expect(enhanced.renderWithKatexFailback).not.toHaveBeenCalled();

    delete globalThis.MarkdownProcessorAST;
    expect(api.safeMarkdown('md', [])).toBe('ENH_SAFE');
    expect(enhanced.safeMarkdown).toHaveBeenCalledWith('md', []);

    delete globalThis.MarkdownProcessorEnhanced;
    expect(api.safeMarkdown('hello', [])).toBe('hello');
  });

  it('protectMarkdownCodeSegments and restoreMarkdownCodeSegments round-trip', async () => {
    const api = await loadMarkdownProcessor();

    vi.spyOn(Date, 'now').mockReturnValue(1);
    vi.spyOn(Math, 'random').mockReturnValue(0.1);

    const md = ['before `$x$` after', '', '```js', 'const y = `$z$`;', '```'].join('\n');

    const protectedSegments = api.legacy.protectMarkdownCodeSegments(md);
    expect(protectedSegments.placeholders).toHaveLength(2);
    expect(protectedSegments.text).not.toContain('`$x$`');
    expect(protectedSegments.text).not.toContain('```js');

    const restored = api.legacy.restoreMarkdownCodeSegments(
      protectedSegments.text,
      protectedSegments.placeholders,
    );
    expect(restored).toBe(md);
  });

  it('legacy renderWithKatexFailback does not render formulas inside backticks and caches results', async () => {
    const api = await loadMarkdownProcessor();

    delete globalThis.MarkdownProcessorAST;
    delete globalThis.MarkdownProcessorEnhanced;

    api.legacy.renderCache.clear();

    const katexSpy = vi
      .spyOn(globalThis.katex, 'renderToString')
      .mockImplementation((tex, options) => {
        const mode = options?.displayMode ? 'block' : 'inline';
        return `<span class="katex" data-mode="${mode}">R(${tex})</span>`;
      });

    const md = '`$x$` and $y$';

    const first = api.renderWithKatexFailback(md);
    expect(first).toContain('<code>$x$</code>');
    expect(first).toContain('R(y)');
    expect(first).not.toContain('R(x)');
    expect(katexSpy).toHaveBeenCalledTimes(1);

    const second = api.renderWithKatexFailback(md);
    expect(second).toBe(first);
    expect(katexSpy).toHaveBeenCalledTimes(1);
  });
});

