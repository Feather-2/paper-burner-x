import { describe, it, test, expect, beforeEach, afterEach, vi } from 'vitest';

import { SlideDocument } from '../../../js/ppt/editor/document.js';

beforeEach(() => {
  globalThis.window = globalThis;
});

afterEach(() => {
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

  expect(doc.getSlideCount()).toBe(1);
  expect(typeof doc.getSlide(0).toBeTruthy().id === 'string' && doc.getSlide(0).id);
  expect(typeof doc.getSlide(0).toBeTruthy().elements[0].id === 'string' && doc.getSlide(0).elements[0].id);

  input[0].background = '#000';
  input[0].elements[0].content = 'HACK';
  expect(doc.getSlide(0).background).toBe('#fff');
  expect(doc.getSlide(0).elements[0].content).toBe('A');
});

test('SlideDocument: addSlide/removeSlide/moveSlide', () => {
  const doc = new SlideDocument();

  doc.load([
    { id: 's1', type: 'freeform', background: '#fff', elements: [] },
    { id: 's2', type: 'freeform', background: '#fff', elements: [] },
    { id: 's3', type: 'freeform', background: '#fff', elements: [] },
  ]);

  doc.addSlide({ id: 'sX', type: 'freeform', background: '#000', elements: [] }, 1);
  expect(doc.getSlides().map((s) => s.id)).toEqual(['s1', 'sX', 's2', 's3']);

  const removed = doc.removeSlide(1);
  expect(removed.id).toBe('sX');
  expect(doc.getSlides().map((s) => s.id)).toEqual(['s1', 's2', 's3']);

  doc.moveSlide(0, 2);
  expect(doc.getSlides().map((s) => s.id)).toEqual(['s2', 's3', 's1']);
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
  expect(child).toBeTruthy();
  expect(child.id).toBe('c1');
  expect(child.content).toBe('Child');

  const loc = doc.getElementLocation('c1');
  expect(loc).toEqual({ slideIndex: 0, elementIndex: 0, parentPath: [0] });
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

  expect(applied.length).toBe(ops.length);
  expect(history.pushed.length).toBe(ops.length);

  expect(doc.getSlide(0).background).toBe('#000');
  expect(doc.getElementById('t1').content).toBe('New');
  expect(doc.getElementById('t2')).toBe(null);
  expect(doc.getSlideCount()).toBe(1);

  expect(globalThis.PPTGenerator.slides[0].background).toBe('#000');
  expect(globalThis.PPTGenerator.slides[0].elements[0].content).toBe('New');
  expect(globalThis.PPTGenerator.slides[0].elements.some((el) => el.id === 't2')).toBe(false);
  expect(globalThis.PPTGenerator.slides.length).toBe(1);
});
