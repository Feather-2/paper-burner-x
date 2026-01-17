import { describe, it, test, expect, beforeEach, afterEach, vi } from 'vitest';
import test from 'node:test';
import assert from 'node:assert/strict';

import { SlideDocument } from '../../../js/ppt/editor/document.js';
import { HistoryManager } from '../../../js/ppt/editor/history-manager.js';

beforeEach(() => {
  globalThis.window = globalThis;
});

afterEach(() => {
  delete globalThis.window;
});

test('HistoryManager: push/undo/redo + canUndo/canRedo', () => {
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

  expect(history.canUndo()).toBe(false);
  expect(history.canRedo()).toBe(false);

  // simulate forward apply then push history entry
  doc.updateElement('t1', { content: 'B' });
  history.push({
    type: 'element.update',
    timestamp: Date.now(),
    elementId: 't1',
    changes: [{ path: 'content', oldValue: 'A', newValue: 'B' }],
  });

  expect(doc.getElementById('t1').content).toBe('B');
  expect(history.canUndo()).toBe(true);
  expect(history.canRedo()).toBe(false);

  expect(history.undo()).toBe(true);
  expect(doc.getElementById('t1').content).toBe('A');
  expect(history.canUndo()).toBe(false);
  expect(history.canRedo()).toBe(true);

  expect(history.redo()).toBe(true);
  expect(doc.getElementById('t1').content).toBe('B');
  expect(history.canUndo()).toBe(true);
  expect(history.canRedo()).toBe(false);
});

test('HistoryManager: startAutoSave()/stopAutoSave() manages timer lifecycle', () => {
  const doc = new SlideDocument();
  doc.load([{ id: 's1', type: 'freeform', background: '#fff', elements: [] }]);

  const editor = { document: doc, currentProject: null };
  const history = new HistoryManager(editor);

  history.startAutoSave();
  const t1 = history._autoSaveTimer;
  expect(t1).toBeTruthy();

  history.startAutoSave();
  const t2 = history._autoSaveTimer;
  expect(t2).toBeTruthy();
  expect(t2).not.toBe(t1);

  history.stopAutoSave();
  expect(history._autoSaveTimer).toBe(null);
});
