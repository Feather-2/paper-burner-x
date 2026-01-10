// @vitest-environment jsdom

/**
 * @file tests/processing/formula-post-processor-async.test.js
 * @description js/processing/formula_post_processor_async.js unit tests (global side-effect module)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_WORKER = globalThis.Worker;
const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_URL = globalThis.URL;
const ORIGINAL_URL_CREATE_OBJECT_URL = globalThis.URL?.createObjectURL;
const ORIGINAL_URL_REVOKE_OBJECT_URL = globalThis.URL?.revokeObjectURL;

async function loadFormulaPostProcessorAsync() {
  const mod = await import('../../js/processing/formula_post_processor_async.esm.js');
  return mod.default ?? globalThis.FormulaPostProcessorAsync;
}

function installWorkerStubs({ ready = true } = {}) {
  if (!globalThis.URL) {
    vi.stubGlobal('URL', ORIGINAL_URL);
  }

  globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock-worker');
  globalThis.URL.revokeObjectURL = vi.fn(() => {});

  class MockWorker {
    constructor(_url) {
      this._onmessage = null;
      this._onerror = null;
    }

    set onmessage(handler) {
      this._onmessage = handler;
      if (ready && typeof handler === 'function') {
        queueMicrotask(() => handler({ data: { type: 'ready' } }));
      }
    }
    get onmessage() {
      return this._onmessage;
    }

    set onerror(handler) {
      this._onerror = handler;
    }
    get onerror() {
      return this._onerror;
    }

    postMessage(message) {
      if (!this._onmessage) return;

      if (message?.type === 'batch') {
        const results = (message.formulas || []).map((item) => ({
          type: 'success',
          id: item.id,
          html: `<span class="katex-inline" data-formula="${String(item.formula)}"></span>`,
          originalFormula: item.formula,
        }));
        this._onmessage({ data: { type: 'batch_complete', batchId: message.batchId, results } });
        return;
      }

      if (message?.type === 'ping') {
        this._onmessage({ data: { type: 'pong' } });
        return;
      }
    }

    terminate() {}
  }

  vi.stubGlobal('Worker', MockWorker);
}

describe('processing/formula_post_processor_async (FormulaPostProcessorAsync)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();

    document.body.innerHTML = '';

    delete globalThis.FormulaPostProcessorAsync;
    if (globalThis.window) {
      delete globalThis.window.FormulaPostProcessorAsync;
    }

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();

    if (ORIGINAL_URL_CREATE_OBJECT_URL === undefined) {
      delete globalThis.URL.createObjectURL;
    } else {
      globalThis.URL.createObjectURL = ORIGINAL_URL_CREATE_OBJECT_URL;
    }
    if (ORIGINAL_URL_REVOKE_OBJECT_URL === undefined) {
      delete globalThis.URL.revokeObjectURL;
    } else {
      globalThis.URL.revokeObjectURL = ORIGINAL_URL_REVOKE_OBJECT_URL;
    }

    if (ORIGINAL_WORKER === undefined) {
      delete globalThis.Worker;
    } else {
      globalThis.Worker = ORIGINAL_WORKER;
    }

    if (ORIGINAL_FETCH === undefined) {
      delete globalThis.fetch;
    } else {
      globalThis.fetch = ORIGINAL_FETCH;
    }

    delete globalThis.FormulaPostProcessorAsync;
    if (globalThis.window) {
      delete globalThis.window.FormulaPostProcessorAsync;
    }
  });

  it('does not create a singleton when Worker is unavailable', async () => {
    if (ORIGINAL_WORKER === undefined) delete globalThis.Worker;
    else globalThis.Worker = ORIGINAL_WORKER;

    const api = await loadFormulaPostProcessorAsync();
    expect(api).toBeUndefined();
    expect(globalThis.FormulaPostProcessorAsync).toBeUndefined();
  });

  it('creates a global singleton when Worker/Blob exist', async () => {
    installWorkerStubs();

    const api = await loadFormulaPostProcessorAsync();
    expect(api).toBeTruthy();
    expect(api).toBe(globalThis.FormulaPostProcessorAsync);
  });

  it('collectFormulas collects fallback elements, delete-markers, and text-node formulas', async () => {
    installWorkerStubs();
    const api = await loadFormulaPostProcessorAsync();

    const root = document.createElement('div');
    root.innerHTML = `
      <span class="katex-fallback">\\begin{aligned}</span>
      <span class="katex-fallback katex-block">x^2</span>
      <span class="katex">ignored $z$</span>
      before $y$ after
    `.trim();

    const formulas = api.collectFormulas(root);

    expect(formulas).toHaveLength(3);

    const deleteMarker = formulas.find((f) => f.shouldDelete);
    expect(deleteMarker).toBeTruthy();
    expect(deleteMarker.fallbackElement).toBeTruthy();
    expect(deleteMarker.formula).toBeNull();

    const fallbackToRender = formulas.find((f) => f.fallbackElement && !f.shouldDelete);
    expect(fallbackToRender).toBeTruthy();
    expect(fallbackToRender.formula).toBe('x^2');
    expect(fallbackToRender.isDisplay).toBe(true);

    const textNodeFormula = formulas.find((f) => f.textNode);
    expect(textNodeFormula).toBeTruthy();
    expect(textNodeFormula.formula).toBe('y');
    expect(textNodeFormula.isDisplay).toBe(false);
  });

  it('processFormulasInElement falls back to sync when useWorker=false', async () => {
    installWorkerStubs();
    const api = await loadFormulaPostProcessorAsync();

    const root = document.createElement('div');
    root.textContent = 'before $x$ after';

    const sync = { processFormulasInElement: vi.fn() };
    globalThis.FormulaPostProcessor = sync;

    const onComplete = vi.fn();
    await api.processFormulasInElement(root, { useWorker: false, onComplete });

    expect(sync.processFormulasInElement).toHaveBeenCalledWith(root);
    expect(onComplete).toHaveBeenCalled();
  });

  it('processFormulasInElement deletes marker fallbacks and replaces renderable fallbacks via worker', async () => {
    installWorkerStubs();
    const api = await loadFormulaPostProcessorAsync();

    const root = document.createElement('div');
    root.innerHTML = `
      <span class="katex-fallback">\\begin{aligned}</span>
      <span class="katex-fallback">x</span>
    `.trim();

    const onProgress = vi.fn();
    const onComplete = vi.fn();
    await api.processFormulasInElement(root, { onProgress, onComplete });

    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenNthCalledWith(1, 1, 2);
    expect(onProgress).toHaveBeenNthCalledWith(2, 2, 2);
    expect(onComplete).toHaveBeenCalled();

    expect(root.querySelectorAll('.katex-fallback')).toHaveLength(0);
    const rendered = root.querySelector('span.katex-inline');
    expect(rendered).toBeTruthy();
    expect(rendered?.getAttribute('data-formula')).toBe('x');
  });

  it('processFormulasInElement replaces a single text-node $...$ formula via worker', async () => {
    installWorkerStubs();
    const api = await loadFormulaPostProcessorAsync();

    const root = document.createElement('div');
    root.textContent = 'before $x$ after';

    const onProgress = vi.fn();
    await api.processFormulasInElement(root, { onProgress });

    expect(onProgress).toHaveBeenCalledWith(1, 1);
    expect(root.textContent).toBe('before  after');
    expect(root.querySelector('span.katex-inline')?.getAttribute('data-formula')).toBe('x');
  });

  it('destroy terminates the worker and marks it not ready', async () => {
    installWorkerStubs();
    const api = await loadFormulaPostProcessorAsync();

    api.worker.terminate = vi.fn();
    api.workerReady = true;

    api.destroy();

    expect(api.worker).toBeNull();
    expect(api.workerReady).toBe(false);
  });
});
