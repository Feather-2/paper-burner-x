const test = require('node:test');
const assert = require('node:assert/strict');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

test.beforeEach(() => {
  globalThis.window = globalThis;
});

test.afterEach(() => {
  delete globalThis.window;
  delete globalThis.PPTDSLSerialize;
  delete globalThis.PPTGenerator;
  delete require.cache[require.resolve('../../js/ppt/generator/ppt_generator_editor.js')];
});

test('editor mutation triggers documentToHtml() and updates deckHtmlDsl + sampleHTML', async () => {
  const calls = [];
  window.PPTDSLSerialize = {
    documentToHtml: (doc, opts) => {
      calls.push({ doc, opts });
      return '<section id="s1" data-type="freeform"></section>';
    }
  };

  const gen = {
    workflowData: { deckHtmlDsl: '<section id="old" data-type="freeform"></section>' },
    sampleHTML: '<section id="old" data-type="freeform"></section>',
    currentSlideIndex: 0
  };
  window.PPTGenerator = gen;

  delete require.cache[require.resolve('../../js/ppt/generator/ppt_generator_editor.js')];
  require('../../js/ppt/generator/ppt_generator_editor.js');

  const doc = new Emitter();
  const history = new Emitter();
  const editor = new Emitter();
  editor.document = doc;
  editor.history = history;
  editor.currentSlideIndex = 0;
  gen.editor = editor;
  gen._updateThumbnails = () => {};

  gen._setupSync();
  doc.emit('element.update', { slideIndex: 0 });

  await sleep(80);

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].opts.onlySlideIndexes, [0]);
  assert.ok(typeof gen.workflowData.deckHtmlDsl === 'string' && gen.workflowData.deckHtmlDsl.includes('<section'));
  assert.equal(gen.sampleHTML, gen.workflowData.deckHtmlDsl);
});

test('structural editor mutation triggers full DSL sync (no onlySlideIndexes)', async () => {
  const calls = [];
  window.PPTDSLSerialize = {
    documentToHtml: (doc, opts) => {
      calls.push({ doc, opts });
      return '<section id="s1" data-type="freeform"></section>\n<section id="s2" data-type="freeform"></section>';
    }
  };

  const gen = {
    workflowData: { deckHtmlDsl: '<section id="old" data-type="freeform"></section>' },
    sampleHTML: '<section id="old" data-type="freeform"></section>',
    currentSlideIndex: 0
  };
  window.PPTGenerator = gen;

  delete require.cache[require.resolve('../../js/ppt/generator/ppt_generator_editor.js')];
  require('../../js/ppt/generator/ppt_generator_editor.js');

  const doc = new Emitter();
  const editor = new Emitter();
  editor.document = doc;
  editor.history = new Emitter();
  editor.currentSlideIndex = 0;
  gen.editor = editor;
  gen._updateThumbnails = () => {};

  gen._setupSync();
  doc.emit('slide.add', { index: 1 });
  await sleep(80);

  assert.equal(calls.length, 1);
  assert.equal('onlySlideIndexes' in (calls[0].opts || {}), false);
});
