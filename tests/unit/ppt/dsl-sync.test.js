import { describe, it, test, expect, beforeEach, afterEach, vi } from 'vitest';

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

beforeEach(() => {
  globalThis.window = globalThis;
});

afterEach(() => {
  delete globalThis.window;
  delete globalThis.PPTDSLSerialize;
  delete globalThis.PPTGenerator;
});

async function importFresh(specifier) {
  const url = new URL(specifier, import.meta.url);
  url.searchParams.set('t', `${Date.now()}_${Math.random().toString(16).slice(2)}`);
  return import(url.href);
}

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

  await importFresh('../../../js/ppt/generator/ppt_generator_editor.js');

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

  expect(calls.length).toBe(1);
  expect(calls[0].opts.onlySlideIndexes).toEqual([0]);
  expect(typeof gen.workflowData.deckHtmlDsl === 'string' && gen.workflowData.deckHtmlDsl.includes('<section')).toBeTruthy();
  expect(gen.sampleHTML).toBe(gen.workflowData.deckHtmlDsl);
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

  await importFresh('../../../js/ppt/generator/ppt_generator_editor.js');

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

  expect(calls.length).toBe(1);
  expect('onlySlideIndexes' in (calls[0].opts || {})).toBe(false);
});
