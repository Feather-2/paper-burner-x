import test from 'node:test';
import assert from 'node:assert/strict';

import { SlideDocument } from '../../../js/ppt/editor/document.js';

test.beforeEach(() => {
  globalThis.window = globalThis;
});

test.afterEach(() => {
  delete globalThis.window;
  delete globalThis.PPTGenerator;
});

test('SlideDocument.load(): deep copies input and ensures ids', () => {
  const doc = new SlideDocument();

  const input = [
    {
      type: 'freeform',
      background: '#fff',
      elements: [{ type: 'text', content: 'A' }],
    },
  ];

  doc.load(input);

  assert.equal(doc.getSlideCount(), 1);
  assert.ok(typeof doc.getSlide(0).id === 'string' && doc.getSlide(0).id);
  assert.ok(typeof doc.getSlide(0).elements[0].id === 'string' && doc.getSlide(0).elements[0].id);

  input[0].background = '#000';
  input[0].elements[0].content = 'HACK';
  assert.equal(doc.getSlide(0).background, '#fff');
  assert.equal(doc.getSlide(0).elements[0].content, 'A');
});

test('SlideDocument: addSlide/removeSlide/moveSlide', () => {
  const doc = new SlideDocument();

  doc.load([
    { id: 's1', type: 'freeform', background: '#fff', elements: [] },
    { id: 's2', type: 'freeform', background: '#fff', elements: [] },
    { id: 's3', type: 'freeform', background: '#fff', elements: [] },
  ]);

  doc.addSlide({ id: 'sX', type: 'freeform', background: '#000', elements: [] }, 1);
  assert.deepEqual(doc.getSlides().map((s) => s.id), ['s1', 'sX', 's2', 's3']);

  const removed = doc.removeSlide(1);
  assert.equal(removed.id, 'sX');
  assert.deepEqual(doc.getSlides().map((s) => s.id), ['s1', 's2', 's3']);

  doc.moveSlide(0, 2);
  assert.deepEqual(doc.getSlides().map((s) => s.id), ['s2', 's3', 's1']);
});

test('SlideDocument.getElementById(): supports group children via index', () => {
  const doc = new SlideDocument();

  doc.load([
    {
      id: 's1',
      type: 'freeform',
      background: '#fff',
      elements: [
        {
          id: 'g1',
          type: 'group',
          children: [{ id: 'c1', type: 'text', content: 'Child' }],
        },
      ],
    },
  ]);

  const child = doc.getElementById('c1');
  assert.ok(child);
  assert.equal(child.id, 'c1');
  assert.equal(child.content, 'Child');

  const loc = doc.getElementLocation('c1');
  assert.deepEqual(loc, { slideIndex: 0, elementIndex: 0, parentPath: [0] });
});

test('SlideDocument.applyOperations(): updates document + PPTGenerator.slides + history', () => {
  const doc = new SlideDocument();

  const initialSlides = [
    {
      id: 's1',
      type: 'freeform',
      background: '#fff',
      elements: [{ id: 't1', type: 'text', content: 'Old', x: 0, y: 0, w: 10, h: 10, z: 1 }],
    },
  ];
  doc.load(initialSlides);

  globalThis.PPTGenerator = { slides: JSON.parse(JSON.stringify(initialSlides)) };

  const history = {
    pushed: [],
    push(op) {
      this.pushed.push(op);
    },
  };

  const ops = [
    { type: 'slide.update', slideIndex: 0, changes: [{ path: 'background', newValue: '#000' }] },
    { type: 'element.update', slideIndex: 0, elementId: 't1', changes: [{ path: 'content', newValue: 'New' }] },
    { type: 'element.add', slideIndex: 0, element: { id: 't2', type: 'text', content: 'Added', x: 0, y: 0, w: 10, h: 10, z: 2 } },
    { type: 'element.delete', slideIndex: 0, elementId: 't2' },
    { type: 'slide.add', index: 1, slide: { id: 's2', type: 'freeform', background: '#fff', elements: [] } },
    { type: 'slide.delete', index: 1 },
  ];

  const applied = doc.applyOperations(ops, { history });

  assert.equal(applied.length, ops.length);
  assert.equal(history.pushed.length, ops.length);

  assert.equal(doc.getSlide(0).background, '#000');
  assert.equal(doc.getElementById('t1').content, 'New');
  assert.equal(doc.getElementById('t2'), null);
  assert.equal(doc.getSlideCount(), 1);

  assert.equal(globalThis.PPTGenerator.slides[0].background, '#000');
  assert.equal(globalThis.PPTGenerator.slides[0].elements[0].content, 'New');
  assert.equal(globalThis.PPTGenerator.slides[0].elements.some((el) => el.id === 't2'), false);
  assert.equal(globalThis.PPTGenerator.slides.length, 1);
});
