const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHTML } = require('linkedom');

function setupDom(html = '<!doctype html><html><head></head><body></body></html>') {
  const { window, document } = parseHTML(html);
  globalThis.window = window;
  globalThis.document = document;
  return { window, document };
}

function teardownDom() {
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.EventEmitter;
  delete globalThis.PPTGenerator;
  delete globalThis.PropertyPanel;
}

class Emitter {
  constructor() {
    this._events = new Map();
  }
  on(name, fn) {
    if (!this._events.has(name)) this._events.set(name, new Set());
    this._events.get(name).add(fn);
    return () => this._events.get(name)?.delete(fn);
  }
  emit(name, payload) {
    const set = this._events.get(name);
    if (!set) return;
    for (const fn of set) fn(payload);
  }
}

test.afterEach(() => {
  teardownDom();
  delete require.cache[require.resolve('../../js/ppt/editor/panels/property-panel.js')];
  delete require.cache[require.resolve('../../js/ppt/ppt_generator_editor.js')];
});

test('AI 微调: property-panel button triggers ImagePlanner → editor.updateElement → syncDSL', async () => {
  setupDom('<!doctype html><html><body><div id="editorPropertyPanel"></div></body></html>');

  // Minimal EventEmitter for PropertyPanel class definition.
  globalThis.EventEmitter = Emitter;
  require('../../js/ppt/editor/panels/property-panel.js');

  const calls = { update: [], sync: [] };

  const selection = new Emitter();
  selection.getSelectedIds = () => ['t1'];

  const editor = new Emitter();
  editor.selection = selection;
  editor.currentSlideIndex = 0;
  editor.findElementById = (id) => (id === 't1' ? { id: 't1', type: 'text', content: 'Hello', x: '10%', y: '10%', w: '80%', h: '10%' } : null);
  editor.updateElement = (id, patch) => calls.update.push({ id, patch });

  const gen = {
    // NOTE: ppt_generator_editor.js mixin will overwrite some fields (e.g. editor/syncDSL),
    // so we re-attach stubs after requiring it.
    slides: [{ id: 's1', type: 'freeform', elements: [{ id: 't1', type: 'text' }] }],
    currentSlideIndex: 0,
    workflowData: {},
    _updateThumbnails: () => {},
  };
  window.PPTGenerator = gen;

  require('../../js/ppt/ppt_generator_editor.js');
  gen.editor = editor;
  gen.syncDSL = (opts) => calls.sync.push(opts);

  // Force deterministic ImagePlanner output.
  const mod = await import('../../js/agents/stages/design/image-planner.js');
  const original = mod.ImagePlanner.suggestElementPatch;
  mod.ImagePlanner.suggestElementPatch = () => ({
    patch: { opacity: 0.5, blend: 'multiply' },
    meta: { reason: 'test' }
  });

  try {
    gen._initPanels();

    // Simulate selecting a single element so panel renders.
    selection.emit('change', { elements: [{ id: 't1', type: 'text', content: 'Hello' }] });

    const btn = document.querySelector('button[data-action="ai-style-element"]');
    assert.ok(btn, 'AI 微调 button exists');
    btn.click();

    // applyAIStyling is async; wait for microtasks.
    await new Promise((r) => setTimeout(r, 0));

    assert.equal(calls.update.length, 1);
    assert.equal(calls.update[0].id, 't1');
    assert.deepEqual(calls.update[0].patch, { opacity: 0.5, blend: 'multiply' });

    assert.equal(calls.sync.length, 1);
    assert.deepEqual(calls.sync[0], { onlySlideIndexes: [0], reason: 'ai_style_element' });
  } finally {
    mod.ImagePlanner.suggestElementPatch = original;
  }
});

test('AI 微调: blend/opacity/mask patches applied for image elements', async () => {
  setupDom('<!doctype html><html><body><div id="editorPropertyPanel"></div></body></html>');
  globalThis.EventEmitter = Emitter;
  require('../../js/ppt/editor/panels/property-panel.js');

  const calls = { update: [], sync: [] };
  const selection = new Emitter();
  selection.getSelectedIds = () => ['img1'];

  const editor = new Emitter();
  editor.selection = selection;
  editor.currentSlideIndex = 0;
  editor.findElementById = (id) => (id === 'img1' ? { id: 'img1', type: 'image', x: '10%', y: '10%', w: '30%', h: '30%' } : null);
  editor.updateElement = (id, patch) => calls.update.push({ id, patch });

  const gen = {
    slides: [{ id: 's1', type: 'freeform', elements: [{ id: 'img1', type: 'image' }] }],
    currentSlideIndex: 0,
    workflowData: {},
    _updateThumbnails: () => {},
  };
  window.PPTGenerator = gen;

  require('../../js/ppt/ppt_generator_editor.js');
  gen.editor = editor;
  gen.syncDSL = (opts) => calls.sync.push(opts);

  const mod = await import('../../js/agents/stages/design/image-planner.js');
  const original = mod.ImagePlanner.suggestElementPatch;
  mod.ImagePlanner.suggestElementPatch = () => ({
    patch: { opacity: 0.92, blend: 'multiply', mask: 'rounded:12' },
    meta: { reason: 'test' }
  });

  try {
    gen._initPanels();
    selection.emit('change', { elements: [{ id: 'img1', type: 'image' }] });

    document.querySelector('button[data-action="ai-style-element"]').click();
    await new Promise((r) => setTimeout(r, 0));

    assert.equal(calls.update.length, 1);
    assert.deepEqual(calls.update[0], { id: 'img1', patch: { opacity: 0.92, blend: 'multiply', mask: 'rounded:12' } });
    assert.equal(calls.sync.length, 1);
  } finally {
    mod.ImagePlanner.suggestElementPatch = original;
  }
});
