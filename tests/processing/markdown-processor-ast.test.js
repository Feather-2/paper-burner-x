/**
 * @file tests/processing/markdown-processor-ast.test.js
 * @description js/processing/markdown_processor_ast.js unit tests (global side-effect module)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINALS = {
  window: globalThis.window,
  MarkdownProcessor: globalThis.MarkdownProcessor,
  MarkdownProcessorEnhanced: globalThis.MarkdownProcessorEnhanced,
  MarkdownProcessorAST: globalThis.MarkdownProcessorAST,
};

async function loadMarkdownProcessorAST() {
  const mod = await import('../../js/processing/markdown_processor_ast.esm.js');
  return mod.default ?? globalThis.MarkdownProcessorAST;
}

describe('processing/markdown_processor_ast (MarkdownProcessorAST)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();

    globalThis.window = {};

    delete globalThis.MarkdownProcessor;
    delete globalThis.MarkdownProcessorEnhanced;
    delete globalThis.MarkdownProcessorAST;

    delete globalThis.window.MarkdownProcessor;
    delete globalThis.window.MarkdownProcessorEnhanced;
    delete globalThis.window.MarkdownProcessorAST;

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

    if (ORIGINALS.MarkdownProcessorEnhanced === undefined) {
      delete globalThis.MarkdownProcessorEnhanced;
    } else {
      globalThis.MarkdownProcessorEnhanced = ORIGINALS.MarkdownProcessorEnhanced;
    }

    if (ORIGINALS.MarkdownProcessorAST === undefined) {
      delete globalThis.MarkdownProcessorAST;
    } else {
      globalThis.MarkdownProcessorAST = ORIGINALS.MarkdownProcessorAST;
    }
  });

  it('exports API and enables AST architecture globally', async () => {
    const api = await loadMarkdownProcessorAST();

    expect(api).toBeTruthy();
    expect(api).toBe(globalThis.MarkdownProcessorAST);
    expect(api.version).toBe('3.0.0-ast');
    expect(api.config).toMatchObject({ version: '3.0.0-ast' });

    expect(globalThis.MarkdownProcessor).toBe(api);
    expect(globalThis.MarkdownProcessorEnhanced).toBe(api);
    expect(window.MarkdownProcessorAST).toBe(api);
  });

  it('safeMarkdown replaces images and warns once per missing path', async () => {
    const api = await loadMarkdownProcessorAST();

    const md = ['![A](images/a.png)', '![B](missing.png)'].join('\n');

    const first = api.safeMarkdown(md, [{ name: 'a.png', data: 'AAAA' }]);
    const second = api.safeMarkdown(md, [{ name: 'a.png', data: 'AAAA' }]);

    expect(first).toContain('![A](data:image/png;base64,AAAA)');
    expect(second).toContain('![A](data:image/png;base64,AAAA)');

    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith('[MarkdownProcessorAST] Image not found:', 'missing.png');
  });

  it('safeMarkdown splits compressed single-line tables and tracks tableFixCount', async () => {
    const api = await loadMarkdownProcessorAST();
    api.clearCache();

    // The compressed-table splitter expects `| |` between rows, so include at least 2 rows.
    const compressed = '| a | b | c | |---|---|---| | 1 | 2 | 3 | | 4 | 5 | 6 |';
    const out = api.safeMarkdown(compressed);

    expect(out).not.toBe(compressed);
    expect(out).toMatch(/\|---\|---\|---\|/);
    expect(out).toContain('\n');

    expect(api.getMetrics().tableFixCount).toBe(1);
  });

  it('render produces katex blocks/inline and updates formula metrics', async () => {
    const api = await loadMarkdownProcessorAST();
    api.clearCache();

    const katexSpy = vi
      .spyOn(globalThis.katex, 'renderToString')
      .mockImplementation((tex, options) => {
        if (String(tex).includes('\\frac')) {
          throw new Error('katex error');
        }
        return `<span data-dm="${String(Boolean(options?.displayMode))}">${tex}</span>`;
      });

    const md = ['Good $x$', '', 'Bad $\\frac{1}{ $', '', '$$y$$', '', '$$\\frac{1}{ $$'].join('\n');
    const html = api.render(md);

    expect(html).toContain('class="katex-inline"');
    expect(html).toContain('class="katex-block"');
    expect(html).toContain('katex-fallback');

    expect(katexSpy).toHaveBeenCalledWith(
      'x',
      expect.objectContaining({ displayMode: false, throwOnError: true }),
    );
    expect(katexSpy).toHaveBeenCalledWith(
      'y',
      expect.objectContaining({ displayMode: true, throwOnError: true }),
    );

    expect(api.getMetrics()).toMatchObject({
      formulaSuccesses: 2,
      formulaErrors: 2,
    });
  });

  it('render caches unannotated renders and reports cache hit rate', async () => {
    const api = await loadMarkdownProcessorAST();
    api.clearCache();

    const md = 'Hello **world**';
    const a = api.render(md);
    const b = api.render(md);

    expect(b).toBe(a);

    const metrics = api.getMetrics();
    expect(metrics.totalRenders).toBe(2);
    expect(metrics.cacheHits).toBe(1);
    expect(metrics.cacheMisses).toBe(1);
    expect(metrics.cacheSize).toBe(1);
    expect(metrics.cacheHitRate).toBe('50.00%');
  });

  it('renderWithAnnotations injects highlights and does not cache annotated renders', async () => {
    const api = await loadMarkdownProcessorAST();
    api.clearCache();

    const md = 'Hello world';
    const annotations = [{ text: 'world', id: 'ann-1' }];

    const first = api.renderWithAnnotations(md, null, annotations, 'content-123');
    const second = api.renderWithAnnotations(md, null, annotations, 'content-123');

    expect(first).toContain('class="annotation-highlight"');
    expect(first).toContain('data-annotation-id="ann-1"');
    expect(first).toContain('data-content-id="content-123"');

    expect(second).toContain('class="annotation-highlight"');

    const metrics = api.getMetrics();
    expect(metrics.totalRenders).toBe(2);
    expect(metrics.cacheHits).toBe(0);
    expect(metrics.cacheMisses).toBe(2);
    expect(metrics.cacheSize).toBe(0);
  });

  it('renderWithKatexFailback warns about customRenderer only when debug enabled', async () => {
    const api = await loadMarkdownProcessorAST();
    api.clearCache();

    const renderer = { heading: () => {} };

    api.setDebug(false);
    api.renderWithKatexFailback('hello', renderer);
    expect(console.warn).not.toHaveBeenCalled();

    api.setDebug(true);
    api.renderWithKatexFailback('hello', renderer);
    expect(console.warn).toHaveBeenCalledWith(
      '[MarkdownProcessorAST] Custom renderer not supported in AST mode',
    );
  });
});
