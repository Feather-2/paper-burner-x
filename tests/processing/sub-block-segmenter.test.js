// @vitest-environment jsdom

/**
 * @file tests/processing/sub-block-segmenter.test.js
 * @description js/processing/sub_block_segmenter.js unit tests (global side-effect module)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function loadSubBlockSegmenter() {
  const mod = await import('../../js/processing/sub_block_segmenter.esm.js');
  return mod.default ?? globalThis.SubBlockSegmenter;
}

describe('processing/sub_block_segmenter (SubBlockSegmenter)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();

    document.body.innerHTML = '';

    delete globalThis.SubBlockSegmenter;
    if (globalThis.window) {
      delete globalThis.window.SubBlockSegmenter;
    }

    if (!globalThis.performance?.mark) {
      globalThis.performance ??= {};
      globalThis.performance.mark = () => {};
    }
    if (!globalThis.performance?.measure) {
      globalThis.performance ??= {};
      globalThis.performance.measure = () => {};
    }

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete globalThis.SubBlockSegmenter;
    if (globalThis.window) {
      delete globalThis.window.SubBlockSegmenter;
    }
  });

  it('checkForFormulas detects LaTeX patterns and rendered KaTeX elements', async () => {
    const api = await loadSubBlockSegmenter();
    const el = document.createElement('p');

    el.textContent = 'No formula here';
    expect(api.checkForFormulas(el, el.textContent)).toBe(false);

    el.textContent = 'Block $$x^2$$ end';
    expect(api.checkForFormulas(el, el.textContent)).toBe(true);

    el.textContent = 'Block \\\\[x\\\\] end';
    expect(api.checkForFormulas(el, el.textContent)).toBe(true);

    el.textContent = 'Inline $x$ end';
    expect(api.checkForFormulas(el, el.textContent)).toBe(true);

    el.textContent = 'Inline \\\\(x\\\\) end';
    expect(api.checkForFormulas(el, el.textContent)).toBe(true);

    el.innerHTML = 'Rendered <span class="katex-display"></span>';
    expect(api.checkForFormulas(el, el.textContent)).toBe(true);
  });

  it('analyzeFormulas reports block/inline formulas and rendered elements', async () => {
    const api = await loadSubBlockSegmenter();
    const el = document.createElement('p');
    el.innerHTML = 'Inline $x$ and block $$y$$ <span class="katex-display"></span>';

    const info = api.analyzeFormulas(el, el.textContent);
    expect(info.hasInlineFormula).toBe(true);
    expect(info.hasBlockFormula).toBe(true);
    expect(info.inlineFormulas.map((f) => f.content)).toContain('$x$');
    expect(info.blockFormulas.map((f) => f.content)).toContain('$$y$$');
    expect(info.renderedFormulas).toHaveLength(1);
    expect(info.renderedFormulas[0].type).toBe('block');
  });

  it('segment skips short text without punctuation by default', async () => {
    const api = await loadSubBlockSegmenter();
    const p = document.createElement('p');
    p.textContent = 'short text without punctuation';

    api.segment(p, 0, false);

    expect(p.querySelectorAll('.sub-block')).toHaveLength(0);
    expect(p.textContent).toBe('short text without punctuation');
  });

  it('segment(force=true) wraps a single sub-block and marks isOnlySubBlock', async () => {
    const api = await loadSubBlockSegmenter();
    const p = document.createElement('p');
    p.textContent = 'short text without punctuation';

    api.segment(p, 0, true);

    const spans = p.querySelectorAll('.sub-block');
    expect(spans).toHaveLength(1);
    expect(spans[0].dataset.subBlockId).toBe('0.0');
    expect(spans[0].dataset.isOnlySubBlock).toBe('true');
    expect(spans[0].textContent).toBe('short text without punctuation');
  });

  it('segment splits on English punctuation and preserves concatenated text', async () => {
    const api = await loadSubBlockSegmenter();
    const p = document.createElement('p');
    p.textContent = 'Hello world. Bye.';

    const original = p.textContent;
    api.segment(p, 'p1', false);

    const spans = p.querySelectorAll('.sub-block');
    expect(spans).toHaveLength(2);
    expect(spans[0].dataset.subBlockId).toBe('p1.0');
    expect(spans[1].dataset.subBlockId).toBe('p1.1');
    expect(p.textContent).toBe(original);

    expect(spans[0].textContent).toBe('Hello world. ');
    expect(spans[1].textContent).toBe('Bye.');
  });

  it('segment skips HTML tables and markdown table separators', async () => {
    const api = await loadSubBlockSegmenter();

    const table = document.createElement('table');
    table.innerHTML = '<tr><td>Hello.</td></tr>';
    api.segment(table, 1, true);
    expect(table.querySelectorAll('.sub-block')).toHaveLength(0);

    const p = document.createElement('p');
    p.textContent = ['|a|b|', '|---|---|'].join('\n');
    api.segment(p, 2, true);
    expect(p.querySelectorAll('.sub-block')).toHaveLength(0);
    expect(p.textContent).toContain('|---|---|');
  });

  it('segment wraps blocks containing block formulas as a single atomic sub-block', async () => {
    const api = await loadSubBlockSegmenter();
    const p = document.createElement('p');
    p.textContent = 'Equation $$x$$ end.';

    api.segment(p, 3, false);

    const spans = p.querySelectorAll('.sub-block');
    expect(spans).toHaveLength(1);
    expect(spans[0].dataset.isOnlySubBlock).toBe('true');
    expect(spans[0].textContent).toContain('$$x$$');
  });

  it('segment wraps blocks containing rendered KaTeX as a single atomic sub-block', async () => {
    const api = await loadSubBlockSegmenter();
    const p = document.createElement('p');
    p.innerHTML = 'Text <span class="katex-display">k</span> more.';

    api.segment(p, 4, false);

    const spans = p.querySelectorAll('.sub-block');
    expect(spans).toHaveLength(1);
    expect(spans[0].dataset.isOnlySubBlock).toBe('true');
    expect(spans[0].querySelector('.katex-display')).toBeTruthy();
  });

  it('segment performs conservative splitting for inline formulas (Chinese periods only)', async () => {
    const api = await loadSubBlockSegmenter();
    const p = document.createElement('p');
    p.textContent = 'A $x$。B $y$。';

    api.segment(p, 5, false);

    const spans = p.querySelectorAll('.sub-block');
    expect(spans).toHaveLength(2);
    expect(spans[0].dataset.subBlockId).toBe('5.0');
    expect(spans[1].dataset.subBlockId).toBe('5.1');
    expect(spans[0].textContent).toBe('A $x$。');
    expect(spans[1].textContent).toBe('B $y$。');
  });
});

