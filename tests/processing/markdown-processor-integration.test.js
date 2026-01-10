/**
 * @file tests/processing/markdown-processor-integration.test.js
 * @description js/processing/markdown_processor_integration.js unit tests (global side-effect module)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINALS = {
  window: globalThis.window,
  MarkdownIntegration: globalThis.MarkdownIntegration,
  MarkdownProcessor: globalThis.MarkdownProcessor,
  MarkdownProcessorAST: globalThis.MarkdownProcessorAST,
  MarkdownProcessorEnhanced: globalThis.MarkdownProcessorEnhanced,
};

async function loadMarkdownIntegration() {
  const mod = await import('../../js/processing/markdown_processor_integration.esm.js');
  return mod.default ?? globalThis.MarkdownIntegration;
}

describe('processing/markdown_processor_integration (MarkdownIntegration)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();

    if (ORIGINALS.window === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = ORIGINALS.window;
    }
    globalThis.window ??= {};

    delete globalThis.MarkdownIntegration;
    delete globalThis.MarkdownProcessor;
    delete globalThis.MarkdownProcessorAST;
    delete globalThis.MarkdownProcessorEnhanced;

    delete globalThis.window.MarkdownIntegration;

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();

    if (ORIGINALS.window === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = ORIGINALS.window;
    }

    globalThis.MarkdownIntegration = ORIGINALS.MarkdownIntegration;
    globalThis.MarkdownProcessor = ORIGINALS.MarkdownProcessor;
    globalThis.MarkdownProcessorAST = ORIGINALS.MarkdownProcessorAST;
    globalThis.MarkdownProcessorEnhanced = ORIGINALS.MarkdownProcessorEnhanced;
  });

  it('exports default API and mirrors to window', async () => {
    const api = await loadMarkdownIntegration();
    expect(api).toBeTruthy();
    expect(api).toBe(globalThis.MarkdownIntegration);
    expect(window.MarkdownIntegration).toBe(api);
    expect(api.version).toBe('1.0.0');
  });

  it('smartRender falls back to legacy renderer when AST is unavailable', async () => {
    const api = await loadMarkdownIntegration();

    const safeMarkdown = vi.fn((md) => `SAFE(${md})`);
    const renderWithKatexFailback = vi.fn((html, customRenderer) => `LEGACY(${html})/${!!customRenderer}`);

    globalThis.MarkdownProcessor = {
      safeMarkdown,
      renderWithKatexFailback,
    };

    const renderer = { heading: () => 'h' };
    const out = api.smartRender('md', ['img'], renderer, 'doc1');

    expect(safeMarkdown).toHaveBeenCalledWith('md', ['img']);
    expect(renderWithKatexFailback).toHaveBeenCalledWith('SAFE(md)', renderer);
    expect(out).toBe('LEGACY(SAFE(md))/true');
  });

  it('smartRender uses AST annotations when given a non-empty array', async () => {
    const api = await loadMarkdownIntegration();

    const renderWithAnnotations = vi.fn(() => '<ann/>');
    const render = vi.fn(() => '<ast/>');
    globalThis.MarkdownProcessorAST = { renderWithAnnotations, render };

    const annotations = [{ id: 1 }];
    const out = api.smartRender('md', [], annotations, 'doc2');

    expect(renderWithAnnotations).toHaveBeenCalledWith('md', [], annotations, 'doc2');
    expect(render).not.toHaveBeenCalled();
    expect(out).toBe('<ann/>');
  });

  it('smartRender warns once when passed a marked.Renderer in AST mode', async () => {
    const api = await loadMarkdownIntegration();

    const render = vi.fn(() => '<ast/>');
    globalThis.MarkdownProcessorAST = { render };

    const renderer = { heading: () => 'h' };
    expect(api.smartRender('a', [], renderer, 'id')).toBe('<ast/>');
    expect(api.smartRender('b', [], renderer, 'id')).toBe('<ast/>');

    expect(render).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('createAnnotationConfig provides a render() facade that delegates to smartRender', async () => {
    const api = await loadMarkdownIntegration();

    const render = vi.fn(() => '<ast/>');
    globalThis.MarkdownProcessorAST = { render };

    const config = api.createAnnotationConfig(null, null);
    expect(config).toMatchObject({ annotations: [], identifier: 'default' });
    expect(config.render('md', [])).toBe('<ast/>');

    const config2 = api.createAnnotationConfig([{ id: 1 }], 'doc3');
    expect(config2).toMatchObject({ annotations: [{ id: 1 }], identifier: 'doc3' });
  });

  it('renderTokens maps token.raw and delegates to smartRender', async () => {
    const api = await loadMarkdownIntegration();

    const render = vi.fn((md) => `<p>${md}</p>`);
    globalThis.MarkdownProcessorAST = { render };

    const tokens = [{ raw: 'a' }, { raw: 'b' }];
    const out = api.renderTokens(tokens, [], [], 'doc');

    expect(out).toEqual(['<p>a</p>', '<p>b</p>']);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('getActiveArchitecture reports AST/Enhanced/Legacy correctly', async () => {
    const api = await loadMarkdownIntegration();

    const ast = { render: vi.fn() };
    globalThis.MarkdownProcessorAST = ast;
    globalThis.MarkdownProcessor = ast;
    expect(api.getActiveArchitecture()).toBe('AST');

    globalThis.MarkdownProcessor = {};
    globalThis.MarkdownProcessorEnhanced = {};
    expect(api.getActiveArchitecture()).toBe('Enhanced');

    delete globalThis.MarkdownProcessorAST;
    delete globalThis.MarkdownProcessorEnhanced;
    expect(api.getActiveArchitecture()).toBe('Legacy');
  });

  it('getMetrics merges AST metrics when available', async () => {
    const api = await loadMarkdownIntegration();

    vi.spyOn(Date, 'now').mockReturnValue(123);

    const ast = { getMetrics: () => ({ rendered: 2 }) };
    globalThis.MarkdownProcessorAST = ast;
    globalThis.MarkdownProcessor = ast;

    expect(api.getMetrics()).toEqual(
      expect.objectContaining({
        architecture: 'AST',
        timestamp: 123,
        rendered: 2,
      }),
    );
  });
});

