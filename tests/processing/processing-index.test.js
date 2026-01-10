import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINALS = {
  window: globalThis.window,
  Processing: globalThis.Processing,
};

async function loadProcessingIndex() {
  return await import('../../js/processing/index.js');
}

describe('processing/index (initializeProcessingGlobals)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();

    globalThis.window = {};
    delete globalThis.Processing;

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();

    if (ORIGINALS.window === undefined) delete globalThis.window;
    else globalThis.window = ORIGINALS.window;

    if (ORIGINALS.Processing === undefined) delete globalThis.Processing;
    else globalThis.Processing = ORIGINALS.Processing;
  });

  it('initializes a Processing facade and wires key globals into the target window', async () => {
    const { initializeProcessingGlobals } = await loadProcessingIndex();

    const target = {};
    const facade = initializeProcessingGlobals(target);

    expect(facade).toBe(target.Processing);
    expect(facade).toMatchObject({
      version: '1.0.0',
      markdown: expect.any(Object),
      reference: expect.any(Object),
      chunks: expect.any(Object),
      deps: expect.any(Object),
    });

    expect(target.marked).toBeTruthy();
    expect(target.katex).toBeTruthy();
    expect(target.markdownit).toBeTruthy();
    expect(target.DOMPurify).toBeTruthy();

    expect(target.MarkdownProcessor).toBeTruthy();
    expect(target.MarkdownProcessorAST).toBeTruthy();
    expect(target.MarkdownProcessorEnhanced).toBeTruthy();
    expect(target.MarkdownIntegration).toBeTruthy();
    expect(target.MarkdownTextFix).toBeTruthy();

    expect(target.ReferenceDetector).toBeTruthy();
    expect(target.ReferenceExtractor).toBeTruthy();
    expect(target.ReferenceIndexer).toBeTruthy();
    expect(target.DOIResolver).toBeTruthy();
    expect(target.ReferenceAIProcessor).toBeTruthy();

    expect(target.FormulaPostProcessor).toBeTruthy();
    expect(facade.formula.postProcessor).toBe(target.FormulaPostProcessor);
    expect(facade.formula.async).toBe(target.FormulaPostProcessorAsync);
    expect(target.SubBlockSegmenter).toBeTruthy();
    expect(target.ContentListToChunks).toBeTruthy();
    expect(target.createAnnotationPluginAST).toBeTypeOf('function');
    expect(target.ReActEngine).toBeTruthy();

    expect(facade.reference.indexerClass).toBe(target.ReferenceIndexer.constructor);
    expect(facade.deps).toEqual(
      expect.objectContaining({
        marked: target.marked,
        katex: target.katex,
        markdownit: target.markdownit,
        DOMPurify: target.DOMPurify,
      }),
    );
  });

  it('does not override pre-existing symbols on the target window and preserves custom Processing fields', async () => {
    const { initializeProcessingGlobals } = await loadProcessingIndex();

    const existing = {
      Marked: true,
    };

    const target = {
      marked: existing,
      MarkdownProcessor: { sentinel: true },
      Processing: { custom: 123 },
    };

    const facade = initializeProcessingGlobals(target);

    expect(target.marked).toBe(existing);
    expect(target.MarkdownProcessor).toEqual({ sentinel: true });

    expect(facade.custom).toBe(123);
    expect(target.Processing.custom).toBe(123);
    expect(target.Processing.markdown).toBeTruthy();
  });
});
