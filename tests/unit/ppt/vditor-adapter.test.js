import { describe, it, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { parseHTML } from 'linkedom';

import '../../../js/ppt/dashboard/vditor_adapter.js';

const VditorAdapter = globalThis.VditorAdapter;

function setupDom(html = '<!doctype html><html><head></head><body></body></html>') {
  const { window, document } = parseHTML(html);
  globalThis.window = window;
  globalThis.document = document;
  return { window, document };
}

function teardownDom() {
  delete globalThis.window;
  delete globalThis.document;
}

function resetAdapter() {
  VditorAdapter.destroy();
  VditorAdapter._loaded = false;
  VditorAdapter._loading = null;
  VditorAdapter._onInput = null;
  VditorAdapter._containerId = null;
}

function mockVditor() {
  const ctorCalls = [];
  function Vditor(id, options) {
    this._id = id;
    this._options = options;
    this._value = options.value || '';
    this._destroyed = false;
    this.getValue = () => this._value;
    this.setValue = (value) => {
      this._value = value;
    };
    this.destroy = () => {
      this._destroyed = true;
    };
    ctorCalls.push({ id, options, instance: this });
  }
  globalThis.Vditor = Vditor;
  return { ctorCalls };
}

beforeEach(() => {
  resetAdapter();
  delete globalThis.Vditor;
});

afterEach(() => {
  resetAdapter();
  delete globalThis.Vditor;
  teardownDom();
});

test('isAvailable(): reflects globalThis.Vditor presence', () => {
  expect(VditorAdapter.isAvailable()).toBe(false);
  globalThis.Vditor = function () {};
  expect(VditorAdapter.isAvailable()).toBe(true);
});

test('load(): returns false when no document', async () => {
  delete globalThis.document;
  delete globalThis.window;
  expect(await VditorAdapter.load()).toBe(false);
});

test('load(): injects CSS+JS and resolves when Vditor becomes available', async () => {
  const { document } = setupDom();

  const promise1 = VditorAdapter.load();
  const promise2 = VditorAdapter.load();

  const cssHref = 'https://gcore.jsdelivr.net/npm/vditor@3.10.7/dist/index.css';
  const jsSrc = 'https://gcore.jsdelivr.net/npm/vditor@3.10.7/dist/index.min.js';

  const link = document.querySelector(`head link[rel="stylesheet"][href="${cssHref}"]`);
  expect(link).toBeTruthy();
  expect(document.querySelectorAll(`head link[rel="stylesheet"][href="${cssHref}"]`).length).toBe(1);

  const script = document.querySelector(`head script[src="${jsSrc}"]`);
  expect(script).toBeTruthy();
  expect(document.querySelectorAll(`head script[src="${jsSrc}"]`).length).toBe(1);

  globalThis.Vditor = function () {};
  script.onload?.();
  const [r1, r2] = await Promise.all([promise1, promise2]);
  expect(r1).toBe(true);
  expect(r2).toBe(true);
  expect(VditorAdapter._loaded).toBe(true);
});

test('mount()/getValue()/setValue()/destroy(): basic lifecycle with onInput', () => {
  setupDom('<!doctype html><html><head></head><body><div id="vditorScriptEditor"></div></body></html>');
  const { ctorCalls } = mockVditor();

  const seenInputs = [];
  const instance = VditorAdapter.mount({
    container: 'vditorScriptEditor',
    value: 'hello',
    onInput: (value) => seenInputs.push(value),
    mode: 'ir'
  });

  expect(instance).toBeTruthy();
  expect(ctorCalls.length).toBe(1);
  expect(ctorCalls[0].id).toBe('vditorScriptEditor');
  expect(ctorCalls[0].options.mode).toBe('ir');
  expect(ctorCalls[0].options.toolbar).toEqual([
    'headings',
    'bold',
    'italic',
    'strike',
    'list',
    'ordered-list',
    'check',
    'quote',
    'code',
    'inline-code',
    'link',
    'table',
    'undo',
    'redo'
  ]);

  expect(VditorAdapter.getValue()).toBe('hello');
  VditorAdapter.setValue('world');
  expect(VditorAdapter.getValue()).toBe('world');

  ctorCalls[0].options.input('typed');
  expect(seenInputs).toEqual(['typed']);

  VditorAdapter.destroy();
  expect(VditorAdapter._instance).toBe(null);
  expect(ctorCalls[0].instance._destroyed).toBe(true);
});

test('mount(): reuses instance for same container and updates value', () => {
  setupDom('<!doctype html><html><head></head><body><div id="vditorScriptEditor"></div></body></html>');
  const { ctorCalls } = mockVditor();

  const a = VditorAdapter.mount({ container: 'vditorScriptEditor', value: 'a', mode: 'ir' });
  const b = VditorAdapter.mount({ container: 'vditorScriptEditor', value: 'b', mode: 'ir' });

  expect(a).toBe(b);
  expect(ctorCalls.length).toBe(1);
  expect(VditorAdapter.getValue()).toBe('b');
});

test('mount(): destroys and remounts when container changes', () => {
  setupDom('<!doctype html><html><head></head><body><div id="a"></div><div id="b"></div></body></html>');
  const { ctorCalls } = mockVditor();

  const first = VditorAdapter.mount({ container: 'a', value: 'x', mode: 'ir' });
  const second = VditorAdapter.mount({ container: 'b', value: 'y', mode: 'ir' });

  expect(first).toBeTruthy();
  expect(second).toBeTruthy();
  expect(first).not.toBe(second);
  expect(ctorCalls.length).toBe(2);
  expect(ctorCalls[0].instance._destroyed).toBe(true);
  expect(VditorAdapter.getValue()).toBe('y');
});

test('renderFallbackTextarea(): matches existing textarea style and escapes value', () => {
  const html = VditorAdapter.renderFallbackTextarea({
    value: '<b>hi</b>',
    onInput: 'window.PPTGenerator.updateReportMarkdown(this.value)'
  });

  expect(html.includes('class="ppt-input-field"')).toBeTruthy();
  expect(html.includes('min-height: 360px')).toBeTruthy();
  expect(html.includes('font-family: ui-monospace')).toBeTruthy();
  expect(html.includes('line-height: 1.5')).toBeTruthy();
  expect(html.includes('oninput="window.PPTGenerator.updateReportMarkdown(this.value).toBeTruthy()"'));
  expect(html.includes('&lt;b&gt;hi&lt;/b&gt;')).toBeTruthy();

  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  const textarea = document.querySelector('textarea');
  expect(textarea).toBeTruthy();
});

test('mount(): returns null when Vditor missing or container missing', () => {
  setupDom('<!doctype html><html><head></head><body><div id="exists"></div></body></html>');
  delete globalThis.Vditor;
  expect(VditorAdapter.mount({ container: 'exists', value: 'x', mode: 'ir' })).toBe(null);

  mockVditor();
  expect(VditorAdapter.mount({ container: 'missing', value: 'x', mode: 'ir' })).toBe(null);
});

test('multiple mount/destroy cycles: stable', () => {
  setupDom('<!doctype html><html><head></head><body><div id="vditorScriptEditor"></div></body></html>');
  const { ctorCalls } = mockVditor();

  for (let i = 0; i < 5; i++) {
    const instance = VditorAdapter.mount({ container: 'vditorScriptEditor', value: String(i), mode: 'ir' });
    expect(instance).toBeTruthy();
    expect(VditorAdapter.getValue()).toBe(String(i));
    VditorAdapter.destroy();
    expect(VditorAdapter._instance).toBe(null);
  }

  expect(ctorCalls.length).toBe(5);
  expect(ctorCalls.every((c) => c.instance._destroyed === true)).toBeTruthy();
});
