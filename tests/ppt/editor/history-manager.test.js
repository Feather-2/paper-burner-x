const test = require('node:test');
const assert = require('node:assert/strict');

function setupBrowserGlobals() {
  globalThis.window = globalThis;
  require('../../../js/ppt/editor/event-emitter.js');
  require('../../../js/ppt/editor/document.js');
  require('../../../js/ppt/editor/history-manager.js');
  return {
    SlideDocument: globalThis.SlideDocument,
    HistoryManager: globalThis.HistoryManager,
  };
}

function teardownBrowserGlobals() {
  delete globalThis.window;
  delete globalThis.EventEmitter;
  delete globalThis.SlideDocument;
  delete globalThis.HistoryManager;
}

test.afterEach(() => {
  teardownBrowserGlobals();
  delete require.cache[require.resolve('../../../js/ppt/editor/event-emitter.js')];
  delete require.cache[require.resolve('../../../js/ppt/editor/document.js')];
  delete require.cache[require.resolve('../../../js/ppt/editor/history-manager.js')];
});

test('HistoryManager: push/undo/redo + canUndo/canRedo', () => {
  const { SlideDocument, HistoryManager } = setupBrowserGlobals();

  const doc = new SlideDocument();
  doc.load([
    {
      id: 's1',
      type: 'freeform',
      background: '#fff',
      elements: [{ id: 't1', type: 'text', content: 'A', x: 0, y: 0, w: 10, h: 10, z: 1 }],
    },
  ]);

  const editor = { document: doc, currentProject: null };
  const history = new HistoryManager(editor);

  assert.equal(history.canUndo(), false);
  assert.equal(history.canRedo(), false);

  // simulate forward apply then push history entry
  doc.updateElement('t1', { content: 'B' });
  history.push({
    type: 'element.update',
    timestamp: Date.now(),
    elementId: 't1',
    changes: [{ path: 'content', oldValue: 'A', newValue: 'B' }],
  });

  assert.equal(doc.getElementById('t1').content, 'B');
  assert.equal(history.canUndo(), true);
  assert.equal(history.canRedo(), false);

  assert.equal(history.undo(), true);
  assert.equal(doc.getElementById('t1').content, 'A');
  assert.equal(history.canUndo(), false);
  assert.equal(history.canRedo(), true);

  assert.equal(history.redo(), true);
  assert.equal(doc.getElementById('t1').content, 'B');
  assert.equal(history.canUndo(), true);
  assert.equal(history.canRedo(), false);
});

test('HistoryManager: startAutoSave()/stopAutoSave() manages timer lifecycle', () => {
  const { SlideDocument, HistoryManager } = setupBrowserGlobals();

  const doc = new SlideDocument();
  doc.load([{ id: 's1', type: 'freeform', background: '#fff', elements: [] }]);

  const editor = { document: doc, currentProject: null };
  const history = new HistoryManager(editor);

  history.startAutoSave();
  const t1 = history._autoSaveTimer;
  assert.ok(t1);

  history.startAutoSave();
  const t2 = history._autoSaveTimer;
  assert.ok(t2);
  assert.notEqual(t2, t1);

  history.stopAutoSave();
  assert.equal(history._autoSaveTimer, null);
});

