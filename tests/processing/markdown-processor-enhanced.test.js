/**
 * @file tests/processing/markdown-processor-enhanced.test.js
 * @description js/processing/markdown_processor_enhanced.js unit tests (global side-effect module)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINALS = {
  window: globalThis.window,
  MarkdownProcessor: globalThis.MarkdownProcessor,
  MarkdownProcessorEnhanced: globalThis.MarkdownProcessorEnhanced,
};

async function loadMarkdownProcessorEnhanced() {
  const mod = await import('../../js/processing/markdown_processor_enhanced.esm.js');
  return mod.default ?? globalThis.MarkdownProcessorEnhanced;
}

describe('processing/markdown_processor_enhanced (MarkdownProcessorEnhanced)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();

    globalThis.window = {};

    delete globalThis.MarkdownProcessor;
    delete globalThis.MarkdownProcessorEnhanced;

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
  });

  it('exports default API and does not override existing MarkdownProcessor', async () => {
    const existing = { sentinel: true };
    globalThis.MarkdownProcessor = existing;

    const api = await loadMarkdownProcessorEnhanced();
    expect(api).toBeTruthy();
    expect(api).toBe(globalThis.MarkdownProcessorEnhanced);
    expect(api.version).toBe('2.0.0');

    expect(globalThis.MarkdownProcessor).toBe(existing);
  });

  it('backfills MarkdownProcessor when missing', async () => {
    delete globalThis.MarkdownProcessor;

    const api = await loadMarkdownProcessorEnhanced();
    expect(globalThis.MarkdownProcessor).toMatchObject({
      safeMarkdown: api.safeMarkdown,
      renderWithKatexFailback: api.renderWithKatexFailback,
    });
  });

  it('safeMarkdown replaces local images using multiple keys and trims query/hash', async () => {
    const api = await loadMarkdownProcessorEnhanced();

    const md = [
      '![A](images/page3_img1.png)',
      '![B](images/page3_img2.png?x=1#y)',
      '![C](https://example.com/x.png)',
    ].join('\n');

    const out = api.safeMarkdown(md, [
      { name: 'page3_img1.png', data: 'Zm9v' },
      { id: 'page3_img2', data: 'data:image/png;base64,QUFBQQ==' },
    ]);

    expect(out).toContain('![A](data:image/png;base64,Zm9v)');
    expect(out).toContain('![B](data:image/png;base64,QUFBQQ==)');
    expect(out).toContain('![C](https://example.com/x.png)');
  });

  it('safeMarkdown warns and leaves markdown unchanged when an image is missing', async () => {
    const api = await loadMarkdownProcessorEnhanced();

    const md = '![X](missing.png)';
    const out = api.safeMarkdown(md, []);

    expect(out).toBe(md);
    expect(console.warn).toHaveBeenCalled();
  });

  it('processCustomSyntax converts scripts and escapes HTML', async () => {
    const api = await loadMarkdownProcessorEnhanced();

    const md = [
      '${a&b}^{c<d}$',
      '${x}_{i}$',
      '${}^{2}$',
      '${n}$',
    ].join(' ');

    const out = api.processCustomSyntax(md);

    expect(out).toContain('<span>a&amp;b<sup>c&lt;d</sup></span>');
    expect(out).toContain('<span>x<sub>i</sub></span>');
    expect(out).toContain('<sup>2</sup>');
    expect(out).toContain('<sup>n</sup>');
  });

  it('renderWithKatexFailback skips pure Chinese inline formulas', async () => {
    const api = await loadMarkdownProcessorEnhanced();
    api.clearCache();

    const renderSpy = vi
      .spyOn(globalThis.katex, 'renderToString')
      .mockImplementation(() => '<span>K</span>');

    const html = api.renderWithKatexFailback('Hello $中文$!');
    expect(html).toContain('$中文$');
    expect(renderSpy).not.toHaveBeenCalled();
  });

  it('renderWithKatexFailback treats inline formulas with block hints as displayMode=true', async () => {
    const api = await loadMarkdownProcessorEnhanced();
    api.clearCache();

    const renderSpy = vi
      .spyOn(globalThis.katex, 'renderToString')
      .mockImplementation(() => '<span>K</span>');

    const html = api.renderWithKatexFailback('$\\begin{aligned}x\\end{aligned}$');

    expect(renderSpy).toHaveBeenCalledWith(
      '\\begin{aligned}x\\end{aligned}',
      expect.objectContaining({ displayMode: true, throwOnError: true }),
    );
    expect(html).toContain('class="katex-block"');
  });

  it('renderWithKatexFailback returns a fallback block for incomplete environments', async () => {
    const api = await loadMarkdownProcessorEnhanced();
    api.clearCache();

    const renderSpy = vi
      .spyOn(globalThis.katex, 'renderToString')
      .mockImplementation(() => '<span>K</span>');

    const html = api.renderWithKatexFailback('$$\\begin{aligned}x$$');

    expect(renderSpy).not.toHaveBeenCalled();
    expect(html).toContain('katex-fallback');
    expect(html).toContain('Incomplete environment');
    expect(html).toContain('begin{aligned}');
  });

  it('getMetrics tracks cache hits and clearCache resets counters', async () => {
    const api = await loadMarkdownProcessorEnhanced();

    api.clearCache();
    vi.spyOn(globalThis.katex, 'renderToString').mockImplementation(() => '<span>K</span>');

    api.renderWithKatexFailback('Inline $x$');
    api.renderWithKatexFailback('Inline $x$');

    const metrics = api.getMetrics();
    expect(metrics.totalRenders).toBe(2);
    expect(metrics.cacheHits).toBe(1);
    expect(metrics.cacheMisses).toBe(1);
    expect(metrics.cacheSize).toBe(1);

    api.clearCache();
    const reset = api.getMetrics();
    expect(reset.totalRenders).toBe(0);
    expect(reset.cacheSize).toBe(0);
    expect(reset.cacheHits).toBe(0);
  });

  it('testFormula returns success=false when katex throws', async () => {
    const api = await loadMarkdownProcessorEnhanced();
    vi.spyOn(globalThis.katex, 'renderToString').mockImplementation(() => {
      throw new Error('boom');
    });

    const out = api.testFormula('x', false);
    expect(out).toMatchObject({ success: false, result: null, error: 'boom' });
    expect(typeof out.renderTime).toBe('number');
  });
});

