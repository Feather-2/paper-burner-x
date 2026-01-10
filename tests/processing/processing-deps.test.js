import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINALS = {
  window: globalThis.window,
  marked: globalThis.marked,
  katex: globalThis.katex,
  markdownit: globalThis.markdownit,
  DOMPurify: globalThis.DOMPurify,
};

async function loadDepsModule() {
  return await import('../../js/processing/processing_deps.esm.js');
}

describe('processing/processing_deps.esm (ensureProcessingDeps)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (ORIGINALS.window === undefined) delete globalThis.window;
    else globalThis.window = ORIGINALS.window;

    if (ORIGINALS.marked === undefined) delete globalThis.marked;
    else globalThis.marked = ORIGINALS.marked;

    if (ORIGINALS.katex === undefined) delete globalThis.katex;
    else globalThis.katex = ORIGINALS.katex;

    if (ORIGINALS.markdownit === undefined) delete globalThis.markdownit;
    else globalThis.markdownit = ORIGINALS.markdownit;

    if (ORIGINALS.DOMPurify === undefined) delete globalThis.DOMPurify;
    else globalThis.DOMPurify = ORIGINALS.DOMPurify;
  });

  it('uses window-provided deps when root deps are missing', async () => {
    const { ensureProcessingDeps } = await loadDepsModule();

    const winMarked = { parse: vi.fn() };
    const winKatex = { renderToString: vi.fn() };
    const winMarkdownIt = function MarkdownItStub() {};
    const winDOMPurify = { sanitize: (v) => `ok:${String(v)}` };

    const root = {
      window: {
        marked: winMarked,
        katex: winKatex,
        markdownit: winMarkdownIt,
        DOMPurify: winDOMPurify,
      },
    };

    const deps = ensureProcessingDeps(root);
    expect(deps).toEqual(
      expect.objectContaining({
        marked: winMarked,
        katex: winKatex,
        markdownit: winMarkdownIt,
        DOMPurify: winDOMPurify,
      }),
    );

    expect(root.marked).toBe(winMarked);
    expect(root.katex).toBe(winKatex);
    expect(root.markdownit).toBe(winMarkdownIt);
    expect(root.DOMPurify).toBe(winDOMPurify);

    // Does not override window-provided deps.
    expect(root.window.marked).toBe(winMarked);
    expect(root.window.katex).toBe(winKatex);
    expect(root.window.markdownit).toBe(winMarkdownIt);
    expect(root.window.DOMPurify).toBe(winDOMPurify);
  });

  it('fills missing window deps from root deps when present', async () => {
    const { ensureProcessingDeps } = await loadDepsModule();

    const root = {
      window: {},
      marked: { parse: vi.fn() },
      katex: { renderToString: vi.fn() },
      markdownit: function MarkdownItStub() {},
      DOMPurify: { sanitize: (v) => String(v) },
    };

    const deps = ensureProcessingDeps(root);
    expect(deps.marked).toBe(root.marked);
    expect(root.window.marked).toBe(root.marked);
    expect(root.window.katex).toBe(root.katex);
    expect(root.window.markdownit).toBe(root.markdownit);
    expect(root.window.DOMPurify).toBe(root.DOMPurify);
  });

  it('falls back to bundled deps and provides a DOMPurify stub', async () => {
    const { ensureProcessingDeps } = await loadDepsModule();

    const root = { window: {} };
    const deps = ensureProcessingDeps(root);

    expect(deps.marked).toBeTruthy();
    expect(deps.katex).toBeTruthy();
    expect(deps.markdownit).toBeTruthy();
    expect(deps.DOMPurify).toBeTruthy();

    expect(typeof deps.katex.renderToString).toBe('function');
    expect(typeof deps.markdownit).toBe('function');
    expect(deps.DOMPurify.sanitize('<b>x</b>')).toBe('<b>x</b>');
    expect(deps.DOMPurify.sanitize({ nope: true })).toBe('');
  });
});

