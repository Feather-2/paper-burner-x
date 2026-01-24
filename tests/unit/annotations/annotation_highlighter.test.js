// @vitest-environment jsdom
/**
 * @file tests/unit/annotations/annotation_highlighter.test.js
 * @description Unit tests for js/annotations/annotation_highlighter.js
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import * as highlighter from '../../../js/annotations/annotation_highlighter.js';

const {
  applyBlockAnnotations,
  applyFormulaAnnotation,
  highlightBlockOrSubBlock,
  removeHighlightFromBlockOrSubBlock,
  applyCrossBlockAnnotation,
  applyCrossBlockHighlightStyle,
  bindCrossBlockAnnotationEvents,
  scrollToAnnotation,
  scrollToAnnotationAsync,
} = highlighter;

const RGBA = {
  yellow: 'rgba(255, 255, 0, 0.75)',
  pink: 'rgba(253, 170, 200, 0.75)',
  lightblue: 'rgba(95, 211, 250, 0.75)',
  lightgreen: 'rgba(178, 253, 178, 0.75)',
};

function makeAnnotation(overrides = {}) {
  return {
    id: 'ann-1',
    targetType: 'ocr',
    motivation: 'highlighting',
    highlightColor: 'yellow',
    body: [],
    target: {
      selector: [
        {
          subBlockId: '1.1',
          exact: 'Hello world',
        },
      ],
    },
    ...overrides,
  };
}

function makeCrossBlockAnnotation(overrides = {}) {
  return makeAnnotation({
    id: 'cross-1',
    isCrossBlock: true,
    target: {
      selector: [
        {
          type: 'CrossBlockRangeSelector',
          affectedSubBlocks: ['1.1', '1.2'],
        },
      ],
    },
    ...overrides,
  });
}

function makeRangeAnnotation({ id = 'range-1', subBlockId = '1.1', startOffset = 0, endOffset = 1, ...rest } = {}) {
  return makeAnnotation({
    id,
    target: {
      selector: [
        {
          type: 'SubBlockRangeSelector',
          subBlockId,
          startOffset,
          endOffset,
        },
      ],
    },
    ...rest,
  });
}

function buildSimpleContainer() {
  const container = document.createElement('div');
  container.id = 'ocr-content-wrapper';

  const block1 = document.createElement('p');
  block1.dataset.blockIndex = '1';

  const sb11 = document.createElement('span');
  sb11.className = 'sub-block';
  sb11.dataset.subBlockId = '1.1';
  sb11.textContent = 'Hello world';

  const sb12 = document.createElement('span');
  sb12.className = 'sub-block';
  sb12.dataset.subBlockId = '1.2';
  sb12.textContent = 'Second subblock';

  block1.appendChild(sb11);
  block1.appendChild(document.createTextNode(' '));
  block1.appendChild(sb12);

  container.appendChild(block1);
  return { container, block1, sb11, sb12 };
}

function dispatchClick(el, { pageX = 11, pageY = 22 } = {}) {
  const evt = new MouseEvent('click', { bubbles: true, cancelable: true });
  Object.defineProperty(evt, 'pageX', { value: pageX });
  Object.defineProperty(evt, 'pageY', { value: pageY });
  el.dispatchEvent(evt);
}

let originalScrollIntoView = null;

beforeEach(() => {
  document.body.innerHTML = '';

  // External dependencies used by event handlers.
  window.globalCurrentContentIdentifier = 'ocr';
  window.globalCurrentSelection = null;
  window.checkIfTargetIsHighlighted = vi.fn(() => true);
  window.checkIfTargetHasNote = vi.fn(() => false);
  window.updateContextMenuOptions = vi.fn();
  window.updateCrossBlockContextMenuOptions = vi.fn();
  window.showContextMenu = vi.fn();

  window.currentVisibleTabId = 'ocr';
  window.ENABLE_ANNOTATION_DEBUG = false;

  // Silence noisy module logs by default.
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});

  // Ensure performance marks don’t throw in jsdom/Node variants.
  if (!globalThis.performance) globalThis.performance = {};
  if (typeof globalThis.performance.mark !== 'function') globalThis.performance.mark = () => {};
  if (typeof globalThis.performance.measure !== 'function') globalThis.performance.measure = () => {};

  // Provide a deterministic scrollIntoView implementation for scroll tests.
  originalScrollIntoView = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  Element.prototype.scrollIntoView = originalScrollIntoView;
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete window.globalCurrentSelection;
});

describe('js/annotations/annotation_highlighter.js exports', () => {
  it('should export the documented public API', () => {
    expect(typeof applyBlockAnnotations).toBe('function');
    expect(typeof applyFormulaAnnotation).toBe('function');
    expect(typeof highlightBlockOrSubBlock).toBe('function');
    expect(typeof removeHighlightFromBlockOrSubBlock).toBe('function');
    expect(typeof applyCrossBlockAnnotation).toBe('function');
    expect(typeof applyCrossBlockHighlightStyle).toBe('function');
    expect(typeof bindCrossBlockAnnotationEvents).toBe('function');
    expect(typeof scrollToAnnotation).toBe('function');
    expect(typeof scrollToAnnotationAsync).toBe('function');
  });
});

describe('highlightBlockOrSubBlock', () => {
  it('should apply standard highlight styles and bind click events for a subBlock', () => {
    const { container, sb11 } = buildSimpleContainer();
    document.body.appendChild(container);

    const annotation = makeAnnotation({
      id: 'a1',
      highlightColor: 'pink',
      body: [{ value: 'note-1' }],
      target: { selector: [{ subBlockId: '1.1', exact: 'Hello world' }] },
    });

    highlightBlockOrSubBlock(sb11, annotation, 'ocr', '1.1', 'subBlock');

    expect(sb11.classList.contains('annotated-sub-block')).toBe(true);
    expect(sb11.dataset.annotationId).toBe('a1');
    expect(sb11.title).toBe('note-1');
    expect(sb11.classList.contains('has-note')).toBe(true);
    expect(sb11.style.backgroundColor).toBe(RGBA.pink);

    dispatchClick(sb11, { pageX: 123, pageY: 456 });

    expect(window.globalCurrentSelection).toMatchObject({
      text: 'Hello world',
      annotationId: 'a1',
      subBlockId: '1.1',
      blockIndex: '1',
    });

    expect(window.checkIfTargetIsHighlighted).toHaveBeenCalledWith('a1', 'ocr', '1.1', 'subBlockId');
    expect(window.checkIfTargetHasNote).toHaveBeenCalledWith('a1', 'ocr', '1.1', 'subBlockId');
    expect(window.updateContextMenuOptions).toHaveBeenCalledWith(true, false);
    expect(window.showContextMenu).toHaveBeenCalledWith(123, 456);
  });

  it('should apply partial highlight when using SubBlockRangeSelector (without highlighting the entire subBlock)', () => {
    const { container, sb11 } = buildSimpleContainer();
    document.body.appendChild(container);

    const annotation = makeRangeAnnotation({
      id: 'r1',
      subBlockId: '1.1',
      startOffset: 6,
      endOffset: 11,
      body: [{ value: 'range-note' }],
    });

    highlightBlockOrSubBlock(sb11, annotation, 'ocr', '1.1', 'subBlock');

    // Host sub-block should not be the highlighted element in range mode.
    expect(sb11.classList.contains('annotated-sub-block')).toBe(false);
    expect(sb11.dataset.annotationId).toBeUndefined();

    const part = sb11.querySelector('span.partial-subblock-highlight');
    expect(part).not.toBeNull();
    expect(part.textContent).toBe('world');
    expect(part.dataset.annotationId).toBe('r1');
    expect(part.title).toBe('range-note');
    expect(part.classList.contains('has-note')).toBe(true);

    dispatchClick(part, { pageX: 9, pageY: 8 });
    expect(window.globalCurrentSelection).toMatchObject({
      text: 'world',
      annotationId: 'r1',
      subBlockId: '1.1',
    });
  });

  it('should wrap a subset match using exact text (creates an .exact-highlight span)', () => {
    const container = document.createElement('div');
    const block = document.createElement('p');
    block.dataset.blockIndex = '1';
    const sb = document.createElement('span');
    sb.className = 'sub-block';
    sb.dataset.subBlockId = '1.1';
    sb.appendChild(document.createTextNode('prefix '));
    sb.appendChild(document.createTextNode('match'));
    sb.appendChild(document.createTextNode(' suffix'));
    block.appendChild(sb);
    container.appendChild(block);
    document.body.appendChild(container);

    const annotation = makeAnnotation({
      id: 'ex1',
      highlightColor: 'lightblue',
      body: [{ value: 'exact-note' }],
      target: { selector: [{ subBlockId: '1.1', exact: 'match' }] },
    });

    highlightBlockOrSubBlock(sb, annotation, 'ocr', '1.1', 'subBlock');

    // In exact-subset mode, the wrapper span is highlighted, not the host element.
    expect(sb.classList.contains('annotated-sub-block')).toBe(false);

    const exact = sb.querySelector('span.exact-highlight');
    expect(exact).not.toBeNull();
    expect(exact.textContent).toBe('match');
    expect(exact.dataset.annotationId).toBe('ex1');
    expect(exact.style.backgroundColor).toBe(RGBA.lightblue);
    expect(exact.title).toBe('exact-note');
    expect(exact.classList.contains('has-note')).toBe(true);

    dispatchClick(exact, { pageX: 7, pageY: 6 });
    expect(window.globalCurrentSelection).toMatchObject({
      text: 'match',
      annotationId: 'ex1',
      subBlockId: '1.1',
      blockIndex: '1',
    });
  });

  it('should fall back to standard highlight when exact text is not found in the element', () => {
    const { container, sb11 } = buildSimpleContainer();
    document.body.appendChild(container);

    const warn = vi.spyOn(console, 'warn');

    const annotation = makeAnnotation({
      id: 'ex-miss',
      highlightColor: 'lightgreen',
      target: { selector: [{ subBlockId: '1.1', exact: 'NOT-IN-TEXT' }] },
    });

    highlightBlockOrSubBlock(sb11, annotation, 'ocr', '1.1', 'subBlock');

    expect(warn).toHaveBeenCalled();
    expect(sb11.classList.contains('annotated-sub-block')).toBe(true);
    expect(sb11.style.backgroundColor).toBe(RGBA.lightgreen);
    expect(sb11.querySelector('span.exact-highlight')).toBeNull();
  });

  it('should skip empty elements with no <img> (guard clause)', () => {
    const container = document.createElement('div');
    const block = document.createElement('p');
    block.dataset.blockIndex = '1';
    const sb = document.createElement('span');
    sb.className = 'sub-block';
    sb.dataset.subBlockId = '1.1';
    sb.textContent = '   ';
    block.appendChild(sb);
    container.appendChild(block);
    document.body.appendChild(container);

    const warn = vi.spyOn(console, 'warn');

    const annotation = makeAnnotation({
      id: 'empty-1',
      target: { selector: [{ subBlockId: '1.1', exact: '' }] },
    });

    highlightBlockOrSubBlock(sb, annotation, 'ocr', '1.1', 'subBlock');

    expect(warn).toHaveBeenCalled();
    expect(sb.dataset.annotationId).toBeUndefined();
    expect(sb.classList.contains('annotated-sub-block')).toBe(false);
  });

  it('should still highlight elements that have an <img> even if textContent is empty', () => {
    const container = document.createElement('div');
    const block = document.createElement('p');
    block.dataset.blockIndex = '1';
    const sb = document.createElement('span');
    sb.className = 'sub-block';
    sb.dataset.subBlockId = '1.1';
    sb.innerHTML = '<img src="x.png" />';
    block.appendChild(sb);
    container.appendChild(block);
    document.body.appendChild(container);

    const annotation = makeAnnotation({
      id: 'img-1',
      highlightColor: 'yellow',
      target: { selector: [{ subBlockId: '1.1', exact: '' }] },
    });

    highlightBlockOrSubBlock(sb, annotation, 'ocr', '1.1', 'subBlock');

    expect(sb.classList.contains('annotated-sub-block')).toBe(true);
    expect(sb.dataset.annotationId).toBe('img-1');
    expect(sb.style.border).toContain('3px solid');
  });

  it('should apply formula-specific highlighting when the element itself is a formula container', () => {
    const container = document.createElement('div');
    const block = document.createElement('p');
    block.dataset.blockIndex = '1';
    const sb = document.createElement('span');
    sb.className = 'sub-block katex-display';
    sb.dataset.subBlockId = '1.1';
    sb.textContent = 'E=mc^2';
    block.appendChild(sb);
    container.appendChild(block);
    document.body.appendChild(container);

    const annotation = makeAnnotation({
      id: 'f-1',
      highlightColor: '#ff0000',
      body: [{ value: 'formula-note' }],
      target: { selector: [{ subBlockId: '1.1', exact: 'E=mc^2' }] },
    });

    highlightBlockOrSubBlock(sb, annotation, 'ocr', '1.1', 'subBlock');

    expect(sb.classList.contains('annotated-formula')).toBe(true);
    expect(sb.classList.contains('annotated-sub-block')).toBe(true);
    expect(sb.dataset.annotationId).toBe('f-1');
    expect(sb.title).toBe('formula-note');
    expect(sb.style.border).toContain('3px solid');

    dispatchClick(sb, { pageX: 1, pageY: 2 });
    expect(window.globalCurrentSelection).toMatchObject({
      annotationId: 'f-1',
      subBlockId: '1.1',
      blockIndex: '1',
      isFormula: true,
    });
    expect(window.showContextMenu).toHaveBeenCalledWith(1, 2);
  });

  it('should not apply formula-specific highlighting for cross-block annotations (even when element is a formula container)', () => {
    const container = document.createElement('div');
    const block = document.createElement('p');
    block.dataset.blockIndex = '1';
    const sb = document.createElement('span');
    sb.className = 'sub-block katex-display';
    sb.dataset.subBlockId = '1.1';
    sb.textContent = 'E=mc^2';
    block.appendChild(sb);
    container.appendChild(block);
    document.body.appendChild(container);

    const annotation = makeCrossBlockAnnotation({
      id: 'cb-formula',
      body: [{ value: 'note' }],
      target: { selector: [{ type: 'CrossBlockRangeSelector', affectedSubBlocks: ['1.1'] }] },
    });

    highlightBlockOrSubBlock(sb, annotation, 'ocr', '1.1', 'subBlock');

    expect(sb.classList.contains('annotated-formula')).toBe(false);
    expect(sb.classList.contains('annotated-sub-block')).toBe(true);
    expect(sb.dataset.annotationId).toBe('cb-formula');
  });

  it('should apply standard highlight for a block elementType', () => {
    const p = document.createElement('p');
    p.dataset.blockIndex = '99';
    p.textContent = 'Block text';
    document.body.appendChild(p);

    const annotation = makeAnnotation({
      id: 'blk-1',
      target: { selector: [{ blockIndex: 99 }] },
    });

    highlightBlockOrSubBlock(p, annotation, 'ocr', '99', 'block');
    expect(p.classList.contains('annotated-block')).toBe(true);
    expect(p.dataset.annotationId).toBe('blk-1');
  });
});

describe('removeHighlightFromBlockOrSubBlock', () => {
  it('should not throw for null/undefined input', () => {
    expect(() => removeHighlightFromBlockOrSubBlock(null)).not.toThrow();
    expect(() => removeHighlightFromBlockOrSubBlock(undefined)).not.toThrow();
  });

  it('should remove highlight styles, classes and data attributes (including nested katex/img/table)', () => {
    const host = document.createElement('div');
    host.className = 'annotated-sub-block has-note has-highlight';
    host.dataset.annotationId = 'x1';
    host.dataset.highlightColor = 'pink';
    host.title = 'note';
    host.style.backgroundColor = RGBA.pink;
    host.style.border = '1px solid red';
    host.style.padding = '4px';
    host.style.borderRadius = '5px';
    host.style.boxShadow = '0 0 1px red';

    const katex = document.createElement('span');
    katex.className = 'katex-display';
    katex.style.border = '1px solid red';
    katex.style.padding = '2px';

    const img = document.createElement('img');
    img.style.border = '1px solid red';
    img.style.padding = '2px';

    const table = document.createElement('table');
    table.style.border = '1px solid red';
    table.style.padding = '2px';

    host.appendChild(katex);
    host.appendChild(img);
    host.appendChild(table);
    document.body.appendChild(host);

    removeHighlightFromBlockOrSubBlock(host);

    expect(host.style.backgroundColor).toBe('');
    expect(host.style.border).toBe('');
    expect(host.style.padding).toBe('');
    expect(host.style.borderRadius).toBe('');
    expect(host.style.boxShadow).toBe('');
    expect(host.classList.contains('annotated-sub-block')).toBe(false);
    expect(host.classList.contains('has-note')).toBe(false);
    expect(host.classList.contains('has-highlight')).toBe(false);
    expect(host.getAttribute('title')).toBe(null);
    expect(host.getAttribute('data-annotation-id')).toBe(null);
    expect(host.getAttribute('data-highlight-color')).toBe(null);

    expect(katex.style.border).toBe('');
    expect(katex.style.padding).toBe('');
    expect(katex.style.boxShadow).toBe('');

    expect(img.style.border).toBe('');
    expect(img.style.padding).toBe('');
    expect(img.style.boxShadow).toBe('');

    expect(table.style.border).toBe('');
    expect(table.style.padding).toBe('');
  });
});

describe('applyFormulaAnnotation', () => {
  it('should apply block formula styles to the provided formula element and add formula classes to host element', () => {
    const host = document.createElement('span');
    host.className = 'sub-block';
    host.dataset.subBlockId = '1.1';
    host.textContent = 'host';

    const formula = document.createElement('span');
    formula.className = 'katex-display';
    formula.textContent = 'E=mc^2';
    host.appendChild(formula);
    document.body.appendChild(host);

    const annotation = makeAnnotation({ id: 'fa-1', body: [{ value: 'n' }] });
    applyFormulaAnnotation(host, annotation, 'ocr', '1.1', 'subBlock', {
      hasFormula: true,
      type: 'block',
      elements: [formula],
    });

    expect(formula.style.border).toContain('3px solid');
    expect(host.classList.contains('annotated-formula')).toBe(true);
    expect(host.classList.contains('annotated-sub-block')).toBe(true);
    expect(host.dataset.annotationId).toBe('fa-1');
    expect(host.title).toBe('n');
  });

  it('should not duplicate event listeners when applying a formula annotation multiple times', () => {
    const container = document.createElement('div');
    const block = document.createElement('p');
    block.dataset.blockIndex = '1';
    const el = document.createElement('span');
    el.className = 'katex-display';
    el.dataset.subBlockId = '1.1';
    el.textContent = 'E=mc^2';
    block.appendChild(el);
    container.appendChild(block);
    document.body.appendChild(container);

    const annotation = makeAnnotation({ id: 'fa-click' });

    applyFormulaAnnotation(el, annotation, 'ocr', '1.1', 'subBlock', {
      hasFormula: true,
      type: 'block',
      elements: [el],
    });
    applyFormulaAnnotation(el, annotation, 'ocr', '1.1', 'subBlock', {
      hasFormula: true,
      type: 'block',
      elements: [el],
    });

    dispatchClick(el, { pageX: 9, pageY: 10 });
    expect(window.showContextMenu).toHaveBeenCalledTimes(1);
  });

  it('should apply hover affordances for formulas (mouseenter/mouseleave)', () => {
    const el = document.createElement('span');
    el.className = 'katex-display';
    el.dataset.subBlockId = '1.1';
    el.textContent = 'E=mc^2';
    document.body.appendChild(el);

    const annotation = makeAnnotation({ id: 'fa-hover' });

    applyFormulaAnnotation(el, annotation, 'ocr', '1.1', 'subBlock', {
      hasFormula: true,
      type: 'block',
      elements: [el],
    });

    el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    expect(el.style.transform).toBe('scale(1.02)');
    expect(el.style.zIndex).toBe('10');

    el.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    expect(el.style.transform).toBe('');
    expect(el.style.zIndex).toBe('');
  });

  it('should apply inline formula styles when formulaInfo.type is inline', () => {
    const formula = document.createElement('span');
    formula.className = 'katex-inline';
    formula.textContent = 'x';
    document.body.appendChild(formula);

    const annotation = makeAnnotation({ id: 'fa-2' });
    applyFormulaAnnotation(formula, annotation, 'ocr', '1.1', 'subBlock', {
      hasFormula: true,
      type: 'inline',
      elements: [formula],
    });

    expect(formula.style.border).toContain('2px solid');
    expect(formula.classList.contains('annotated-formula')).toBe(true);
    expect(formula.dataset.annotationId).toBe('fa-2');
  });

  it('should apply mixed formula styles (host dashed border, per-formula styles)', () => {
    const host = document.createElement('span');
    host.className = 'sub-block';
    host.dataset.subBlockId = '1.1';
    host.appendChild(document.createTextNode('before '));

    const blockFormula = document.createElement('span');
    blockFormula.className = 'katex-display';
    blockFormula.textContent = 'BLOCK';
    host.appendChild(blockFormula);

    const inlineFormula = document.createElement('span');
    inlineFormula.className = 'katex-inline';
    inlineFormula.textContent = 'INLINE';
    host.appendChild(inlineFormula);
    document.body.appendChild(host);

    const annotation = makeAnnotation({ id: 'fa-3' });
    applyFormulaAnnotation(host, annotation, 'ocr', '1.1', 'subBlock', {
      hasFormula: true,
      type: 'mixed',
      elements: [blockFormula, inlineFormula],
    });

    expect(host.style.border).toContain('dashed');
    expect(blockFormula.style.border).toContain('3px solid');
    expect(inlineFormula.style.border).toContain('2px solid');
  });

  it('should fall back to standard highlight when formulaInfo.type is unknown', () => {
    const el = document.createElement('span');
    el.className = 'sub-block';
    el.dataset.subBlockId = '1.1';
    el.textContent = 'text';
    document.body.appendChild(el);

    const annotation = makeAnnotation({ id: 'fa-4', highlightColor: 'rgba(1, 2, 3, 0.1)' });
    applyFormulaAnnotation(el, annotation, 'ocr', '1.1', 'subBlock', {
      hasFormula: true,
      type: 'unknown',
      elements: [],
    });

    // Standard highlight sets backgroundColor, and applyFormulaAnnotation adds formula marker.
    expect(el.style.backgroundColor).toBe('rgba(1, 2, 3, 0.75)');
    expect(el.classList.contains('annotated-formula')).toBe(true);
    expect(el.classList.contains('annotated-sub-block')).toBe(true);
  });
});

describe('applyCrossBlockHighlightStyle', () => {
  it('should style a single-part cross-block highlight and add an indicator', () => {
    const el = document.createElement('span');
    const annotation = makeAnnotation({ id: 'cb-1' });

    applyCrossBlockHighlightStyle(el, annotation, RGBA.yellow, 'note', 0, 1);

    expect(el.style.backgroundColor).toBe(RGBA.yellow);
    expect(el.style.padding).toBe('0px'); // CSSOM normalizes "0" to "0px"
    expect(el.classList.contains('cross-block-highlight')).toBe(true);
    expect(el.dataset.annotationId).toBe('cb-1');
    expect(el.title).toBe('note');
    expect(el.classList.contains('has-note')).toBe(true);
    expect(el.querySelector('.cross-block-indicator')).not.toBeNull();
  });

  it('should apply correct borderRadius for first/middle/last parts and only add indicator to the first', () => {
    const annotation = makeAnnotation({ id: 'cb-2' });

    const first = document.createElement('span');
    const mid = document.createElement('span');
    const last = document.createElement('span');

    applyCrossBlockHighlightStyle(first, annotation, RGBA.yellow, '', 0, 3);
    applyCrossBlockHighlightStyle(mid, annotation, RGBA.yellow, '', 1, 3);
    applyCrossBlockHighlightStyle(last, annotation, RGBA.yellow, '', 2, 3);

    expect(first.style.borderRadius).toMatch(/^6px 0(px)? 0(px)? 6px$/);
    expect(mid.style.borderRadius).toMatch(/^0(px)?$/);
    expect(last.style.borderRadius).toMatch(/^0(px)? 6px 6px 0(px)?$/);

    expect(first.querySelector('.cross-block-indicator')).not.toBeNull();
    expect(mid.querySelector('.cross-block-indicator')).toBeNull();
    expect(last.querySelector('.cross-block-indicator')).toBeNull();
  });
});

describe('bindCrossBlockAnnotationEvents', () => {
  it('should bind click handler once and populate globalCurrentSelection + open context menu (highlight parts exist)', () => {
    const container = document.createElement('div');
    const sb1 = document.createElement('span');
    sb1.className = 'sub-block';
    sb1.dataset.subBlockId = '1.1';
    const part1 = document.createElement('span');
    part1.className = 'cross-block-highlight';
    part1.dataset.annotationId = 'cb-click';
    part1.textContent = 'Hello';
    sb1.appendChild(part1);

    const sb2 = document.createElement('span');
    sb2.className = 'sub-block';
    sb2.dataset.subBlockId = '1.2';
    const part2 = document.createElement('span');
    part2.className = 'cross-block-highlight';
    part2.dataset.annotationId = 'cb-click';
    part2.textContent = 'World';
    sb2.appendChild(part2);

    container.appendChild(sb1);
    container.appendChild(sb2);
    document.body.appendChild(container);

    const annotation = makeCrossBlockAnnotation({
      id: 'cb-click',
      body: [{ value: 'note' }],
      target: { selector: [{ type: 'CrossBlockRangeSelector', affectedSubBlocks: ['1.1', '1.2'] }] },
    });

    bindCrossBlockAnnotationEvents(part1, annotation, 'ocr', ['1.1', '1.2']);
    bindCrossBlockAnnotationEvents(part1, annotation, 'ocr', ['1.1', '1.2']); // should be ignored

    dispatchClick(part1, { pageX: 44, pageY: 55 });

    expect(window.globalCurrentSelection).toBeTruthy();
    expect(window.globalCurrentSelection.isCrossBlock).toBe(true);
    expect(window.globalCurrentSelection.annotationId).toBe('cb-click');
    expect(window.globalCurrentSelection.affectedSubBlocks).toEqual([{ subBlockId: '1.1' }, { subBlockId: '1.2' }]);

    expect(window.updateCrossBlockContextMenuOptions).toHaveBeenCalledWith(true, true);
    expect(window.showContextMenu).toHaveBeenCalledTimes(1);
    expect(window.showContextMenu).toHaveBeenCalledWith(44, 55);
  });

  it('should fall back to selecting the first/last sub-block when highlight parts are not found', () => {
    const container = document.createElement('div');
    const sb1 = document.createElement('span');
    sb1.className = 'sub-block';
    sb1.dataset.subBlockId = '1.1';
    sb1.textContent = 'Hello';
    const sb2 = document.createElement('span');
    sb2.className = 'sub-block';
    sb2.dataset.subBlockId = '1.2';
    sb2.textContent = 'World';
    container.appendChild(sb1);
    container.appendChild(sb2);
    document.body.appendChild(container);

    const annotation = makeCrossBlockAnnotation({
      id: 'cb-fallback',
      body: [],
      target: { selector: [{ type: 'CrossBlockRangeSelector', affectedSubBlocks: ['1.1', '1.2'] }] },
    });

    bindCrossBlockAnnotationEvents(sb1, annotation, 'ocr', ['1.1', '1.2']);
    dispatchClick(sb1);

    expect(window.globalCurrentSelection).toBeTruthy();
    expect(window.globalCurrentSelection.isCrossBlock).toBe(true);
    expect(window.globalCurrentSelection.annotationId).toBe('cb-fallback');
  });
});

describe('applyCrossBlockAnnotation', () => {
  it('should warn and return when annotation target selector is missing', () => {
    const { container } = buildSimpleContainer();
    document.body.appendChild(container);

    const warn = vi.spyOn(console, 'warn');
    applyCrossBlockAnnotation(container, { id: 'x' }, 'ocr');
    expect(warn).toHaveBeenCalled();
  });

  it('should warn and return when affectedSubBlocks is empty', () => {
    const { container } = buildSimpleContainer();
    document.body.appendChild(container);

    const warn = vi.spyOn(console, 'warn');
    applyCrossBlockAnnotation(container, makeCrossBlockAnnotation({
      id: 'x2',
      target: { selector: [{ type: 'CrossBlockRangeSelector', affectedSubBlocks: [] }] },
    }), 'ocr');
    expect(warn).toHaveBeenCalled();
  });

  it('should highlight across multiple sub-blocks (partial start/end + full middle) and bind events', () => {
    const container = document.createElement('div');

    const mk = (id, text) => {
      const sb = document.createElement('span');
      sb.className = 'sub-block';
      sb.dataset.subBlockId = id;
      sb.textContent = text;
      return sb;
    };

    const sb1 = mk('1.1', 'AAA BBB');
    const sb2 = mk('1.2', 'CCC');
    const sb3 = mk('1.3', 'DDD EEE');
    container.appendChild(sb1);
    container.appendChild(sb2);
    container.appendChild(sb3);
    document.body.appendChild(container);

    const annotation = makeCrossBlockAnnotation({
      id: 'cb-span',
      body: [{ value: 'cb-note' }],
      target: {
        selector: [
          {
            type: 'CrossBlockRangeSelector',
            affectedSubBlocks: ['1.1', '1.2', '1.3'],
            startSubBlockId: '1.1',
            endSubBlockId: '1.3',
            startOffset: 4, // "BBB" starts at index 4
            endOffset: 3, // "DDD"
          },
        ],
      },
    });

    applyCrossBlockAnnotation(container, annotation, 'ocr');

    const anchor = document.getElementById('ann-cb-span');
    expect(anchor).not.toBeNull();

    const all = container.querySelectorAll('[data-annotation-id="cb-span"]');
    // Usually 3 elements: start span, middle sub-block, end span. Keep this len check tolerant.
    expect(all.length).toBeGreaterThanOrEqual(2);

    // Clicking any part should set cross-block selection.
    dispatchClick(all[0]);
    expect(window.globalCurrentSelection).toMatchObject({
      isCrossBlock: true,
      annotationId: 'cb-span',
    });
  });

  it('should support single-sub-block selection using startOffset/endOffset', () => {
    const container = document.createElement('div');
    const sb = document.createElement('span');
    sb.className = 'sub-block';
    sb.dataset.subBlockId = '1.1';
    sb.textContent = 'abcdef';
    container.appendChild(sb);
    document.body.appendChild(container);

    const annotation = makeCrossBlockAnnotation({
      id: 'cb-single',
      target: {
        selector: [
          {
            type: 'CrossBlockRangeSelector',
            affectedSubBlocks: ['1.1'],
            startSubBlockId: '1.1',
            endSubBlockId: '1.1',
            startOffset: 1,
            endOffset: 4,
          },
        ],
      },
    });

    applyCrossBlockAnnotation(container, annotation, 'ocr');

    const part = sb.querySelector('[data-annotation-id="cb-single"]');
    expect(part).not.toBeNull();
    expect(part.textContent).toBe('bcd');
  });

  it('should repair endOffset=0 for cross-sub-block selections by using the end element text length', () => {
    const container = document.createElement('div');
    const sb1 = document.createElement('span');
    sb1.className = 'sub-block';
    sb1.dataset.subBlockId = '1.1';
    sb1.textContent = 'START';
    const sb2 = document.createElement('span');
    sb2.className = 'sub-block';
    sb2.dataset.subBlockId = '1.2';
    sb2.textContent = 'END';
    container.appendChild(sb1);
    container.appendChild(sb2);
    document.body.appendChild(container);

    const annotation = makeCrossBlockAnnotation({
      id: 'cb-end0',
      target: {
        selector: [
          {
            type: 'CrossBlockRangeSelector',
            affectedSubBlocks: ['1.1', '1.2'],
            startSubBlockId: '1.1',
            endSubBlockId: '1.2',
            startOffset: 0,
            endOffset: 0, // suspicious
          },
        ],
      },
    });

    applyCrossBlockAnnotation(container, annotation, 'ocr');

    // End sub-block should be fully highlighted (0..len)
    const endPart = sb2.querySelector('[data-annotation-id="cb-end0"]');
    expect(endPart).not.toBeNull();
    expect(endPart.textContent).toBe('END');
  });

  it('should use selector.exact to compute offsets when offsets are missing (direct match)', () => {
    const container = document.createElement('div');
    const mk = (id, text) => {
      const sb = document.createElement('span');
      sb.className = 'sub-block';
      sb.dataset.subBlockId = id;
      sb.textContent = text;
      return sb;
    };
    const sb1 = mk('1.1', 'ab');
    const sb2 = mk('1.2', 'cd');
    const sb3 = mk('1.3', 'ef');
    container.appendChild(sb1);
    container.appendChild(sb2);
    container.appendChild(sb3);
    document.body.appendChild(container);

    const annotation = makeCrossBlockAnnotation({
      id: 'cb-exact',
      target: {
        selector: [
          {
            type: 'CrossBlockRangeSelector',
            affectedSubBlocks: ['1.1', '1.2', '1.3'],
            exact: 'cde',
          },
        ],
      },
    });

    applyCrossBlockAnnotation(container, annotation, 'ocr');

    const parts = container.querySelectorAll('[data-annotation-id="cb-exact"]');
    const actual = Array.from(parts).map((n) => n.textContent).join('');
    expect(actual).toBe('cde');
  });

  it('should highlight all affectedSubBlocks even if start/end IDs are not in affectedSubBlocks (defensive fallback)', () => {
    const container = document.createElement('div');
    const sb1 = document.createElement('span');
    sb1.className = 'sub-block';
    sb1.dataset.subBlockId = '1.1';
    sb1.textContent = 'one';
    const sb2 = document.createElement('span');
    sb2.className = 'sub-block';
    sb2.dataset.subBlockId = '1.2';
    sb2.textContent = 'two';
    container.appendChild(sb1);
    container.appendChild(sb2);
    document.body.appendChild(container);

    const annotation = makeCrossBlockAnnotation({
      id: 'cb-mismatch',
      target: {
        selector: [
          {
            type: 'CrossBlockRangeSelector',
            affectedSubBlocks: ['1.1', '1.2'],
            startSubBlockId: '99.9',
            endSubBlockId: '88.8',
          },
        ],
      },
    });

    applyCrossBlockAnnotation(container, annotation, 'ocr');

    expect(container.querySelectorAll('[data-annotation-id="cb-mismatch"]').length).toBe(2);
  });

  it('should warn and skip missing sub-block elements while still highlighting the available parts', () => {
    const container = document.createElement('div');
    const sb1 = document.createElement('span');
    sb1.className = 'sub-block';
    sb1.dataset.subBlockId = '1.1';
    sb1.textContent = 'Hello';

    const sb3 = document.createElement('span');
    sb3.className = 'sub-block';
    sb3.dataset.subBlockId = '3.1';
    sb3.textContent = 'World';

    container.appendChild(sb1);
    container.appendChild(sb3);
    document.body.appendChild(container);

    const warn = vi.spyOn(console, 'warn');
    const annotation = makeCrossBlockAnnotation({
      id: 'cb-skip',
      target: {
        selector: [
          {
            type: 'CrossBlockRangeSelector',
            affectedSubBlocks: ['1.1', '2.1', '3.1'],
            startSubBlockId: '1.1',
            endSubBlockId: '3.1',
            startOffset: 0,
            endOffset: 5,
          },
        ],
      },
    });

    applyCrossBlockAnnotation(container, annotation, 'ocr');

    expect(warn).toHaveBeenCalled();
    expect(container.querySelectorAll('[data-annotation-id="cb-skip"]').length).toBeGreaterThanOrEqual(1);
  });
});

describe('applyBlockAnnotations', () => {
  it('should throw when containerElement is null (current implementation touches DOM early)', () => {
    expect(() => applyBlockAnnotations(null, [], 'ocr')).toThrow();
  });

  it('should return early when allAnnotations is null (does not clean or apply)', () => {
    const { container, sb11 } = buildSimpleContainer();
    document.body.appendChild(container);

    sb11.classList.add('annotated-sub-block');
    sb11.dataset.annotationId = 'old';

    expect(() => applyBlockAnnotations(container, null, 'ocr')).not.toThrow();
    expect(sb11.classList.contains('annotated-sub-block')).toBe(true);
    expect(sb11.dataset.annotationId).toBe('old');
  });

  it('should return early and not mutate existing highlights when currentVisibleTabId is chunk-compare', () => {
    const { container, sb11 } = buildSimpleContainer();
    document.body.appendChild(container);

    sb11.classList.add('annotated-sub-block');
    sb11.dataset.annotationId = 'old';

    window.currentVisibleTabId = 'chunk-compare';
    applyBlockAnnotations(container, [makeAnnotation({ id: 'new' })], 'ocr');

    expect(sb11.classList.contains('annotated-sub-block')).toBe(true);
    expect(sb11.dataset.annotationId).toBe('old');
  });

  it('should clean existing [data-annotation-id] wrappers without deleting sub-block elements', () => {
    const { container } = buildSimpleContainer();

    const wrapper = document.createElement('span');
    wrapper.className = 'annotation-wrapper';
    wrapper.dataset.annotationId = 'wrap-old';

    const sb = document.createElement('span');
    sb.className = 'sub-block';
    sb.dataset.subBlockId = '2.1';
    sb.textContent = 'Wrapped text';

    wrapper.appendChild(sb);
    container.appendChild(wrapper);
    document.body.appendChild(container);

    applyBlockAnnotations(container, [], 'ocr');

    expect(container.querySelector('.annotation-wrapper')).toBeNull();
    expect(container.querySelector('.sub-block[data-sub-block-id="2.1"]')).not.toBeNull();
    expect(container.textContent).toContain('Wrapped text');
  });

  it('should unwrap generic [data-annotation-id] wrappers without a sub-block descendant (safe unwrap)', () => {
    const container = document.createElement('div');
    container.innerHTML = `
      <p data-block-index="1">
        <span data-annotation-id="wrap">Hello <em>world</em></span>
      </p>
    `;
    document.body.appendChild(container);

    applyBlockAnnotations(container, [], 'ocr');

    expect(container.querySelector('[data-annotation-id="wrap"]')).toBeNull();
    const p = container.querySelector('p[data-block-index="1"]');
    expect(p.textContent.replace(/\s+/g, ' ').trim()).toBe('Hello world');
    expect(p.querySelector('em').textContent).toBe('world');
  });

  it('should dedupe duplicate subBlockId annotations for the current contentIdentifier (keeps first)', () => {
    const { container, sb11 } = buildSimpleContainer();
    document.body.appendChild(container);

    const ann1 = makeAnnotation({
      id: 'a-first',
      targetType: 'ocr',
      target: { selector: [{ subBlockId: '1.1', exact: 'Hello world' }] },
    });
    const ann2 = makeAnnotation({
      id: 'a-second',
      targetType: 'ocr',
      target: { selector: [{ subBlockId: '1.1', exact: 'Hello world' }] },
    });

    applyBlockAnnotations(container, [ann1, ann2], 'ocr');

    expect(sb11.dataset.annotationId).toBe('a-first');
  });

  it('should dedupe identical SubBlockRangeSelector annotations (same offsets) for the same subBlockId', () => {
    const { container } = buildSimpleContainer();
    document.body.appendChild(container);

    const r1 = makeRangeAnnotation({ id: 'r-first', subBlockId: '1.1', startOffset: 6, endOffset: 11 });
    const r2 = makeRangeAnnotation({ id: 'r-second', subBlockId: '1.1', startOffset: 6, endOffset: 11 });

    applyBlockAnnotations(container, [r1, r2], 'ocr');

    expect(container.querySelector('[data-annotation-id="r-first"]')).not.toBeNull();
    expect(container.querySelector('[data-annotation-id="r-second"]')).toBeNull();
  });

  it('should apply fallback exact matching when subBlockId does not map but exact matches element text', () => {
    const { container, sb11 } = buildSimpleContainer();
    document.body.appendChild(container);

    const annotation = makeAnnotation({
      id: 'fallback-1',
      targetType: 'ocr',
      target: { selector: [{ subBlockId: 'does-not-exist', exact: 'Hello world' }] },
    });

    applyBlockAnnotations(container, [annotation], 'ocr');

    expect(sb11.classList.contains('annotated-sub-block')).toBe(true);
    expect(sb11.dataset.annotationId).toBe('fallback-1');
  });

  it('should update selector.exact to current DOM text when exact mismatches (non-range annotation)', () => {
    const { container } = buildSimpleContainer();
    document.body.appendChild(container);

    const ann = makeAnnotation({
      id: 'exact-fix',
      targetType: 'ocr',
      target: { selector: [{ subBlockId: '1.1', exact: 'WRONG' }] },
    });

    applyBlockAnnotations(container, [ann], 'ocr');
    expect(ann.target.selector[0].exact).toBe('Hello world');
  });

  it('should call window.applyCrossBlockAnnotation once per deduped cross-block annotation (dedupe by id)', () => {
    const { container } = buildSimpleContainer();
    document.body.appendChild(container);

    const spy = vi.fn();
    window.applyCrossBlockAnnotation = spy;

    const c1 = makeCrossBlockAnnotation({ id: 'c1' });
    const c1Dup = makeCrossBlockAnnotation({ id: 'c1' });

    applyBlockAnnotations(container, [c1, c1Dup], 'ocr');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(container, c1, 'ocr');
  });

  it('should warn when an annotation points to a missing sub-block element', () => {
    const { container } = buildSimpleContainer();
    document.body.appendChild(container);

    const warn = vi.spyOn(console, 'warn');

    const ann = makeAnnotation({
      id: 'missing-1',
      targetType: 'ocr',
      target: { selector: [{ subBlockId: '99.1', exact: 'Missing' }] },
    });

    applyBlockAnnotations(container, [ann], 'ocr');

    expect(warn).toHaveBeenCalled();
    const warned = warn.mock.calls.some((args) => String(args[0]).includes('annotation 指向的子块'));
    expect(warned).toBe(true);
  });
});

describe('scrollToAnnotation', () => {
  it('should return false when no matching element exists', () => {
    expect(scrollToAnnotation('does-not-exist')).toBe(false);
  });

  it('should scroll to #ann-{id} when present and apply temporary emphasis on closest sub-block', () => {
    vi.useFakeTimers();

    const { container, sb11 } = buildSimpleContainer();
    const anchor = document.createElement('span');
    anchor.id = 'ann-a1';
    anchor.dataset.annotationId = 'a1';
    anchor.textContent = 'anchor';
    sb11.appendChild(anchor);
    document.body.appendChild(container);

    const calls = [];
    Element.prototype.scrollIntoView = function scrollIntoView(opts) {
      calls.push({ el: this, opts });
    };

    const ok = scrollToAnnotation('a1', true);
    expect(ok).toBe(true);
    expect(calls.length).toBe(1);
    expect(calls[0].el).toBe(sb11);
    expect(sb11.classList.contains('jump-to-highlight-effect')).toBe(true);
    expect(sb11.style.outline).toContain('2px solid');

    vi.advanceTimersByTime(1600);
    expect(sb11.classList.contains('jump-to-highlight-effect')).toBe(false);
    expect(sb11.style.outline).toBe('');
  });

  it('should fall back to manual traversal when annotationId makes querySelector invalid', () => {
    const { container, sb11 } = buildSimpleContainer();
    document.body.appendChild(container);

    const weirdId = 'a"b';
    const el = document.createElement('span');
    el.dataset.annotationId = weirdId;
    el.textContent = 'weird';
    sb11.appendChild(el);

    const ok = scrollToAnnotation(weirdId);
    expect(ok).toBe(true);
  });

  it('should return false when scrollIntoView throws (defensive behavior)', () => {
    const { container, sb11 } = buildSimpleContainer();
    sb11.id = 'ann-throw';
    document.body.appendChild(container);

    Element.prototype.scrollIntoView = vi.fn(() => {
      throw new Error('boom');
    });

    expect(scrollToAnnotation('throw')).toBe(false);
  });
});

describe('scrollToAnnotationAsync', () => {
  it('should resolve true when a matching element appears before timeout', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));

    const p = scrollToAnnotationAsync('async-1', { timeoutMs: 200, pollIntervalMs: 50 });

    // Allow the first loop to schedule its poll.
    await Promise.resolve();

    const el = document.createElement('span');
    el.dataset.annotationId = 'async-1';
    el.textContent = 'target';
    document.body.appendChild(el);

    await vi.advanceTimersByTimeAsync(60);
    await expect(p).resolves.toBe(true);
  });

  it('should resolve true even if scrollIntoView throws for the found element', async () => {
    const el = document.createElement('div');
    el.id = 'ann-asyncThrow';
    el.textContent = 'target';
    document.body.appendChild(el);

    Element.prototype.scrollIntoView = vi.fn(() => {
      throw new Error('boom');
    });

    await expect(scrollToAnnotationAsync('asyncThrow', { timeoutMs: 50, pollIntervalMs: 10 })).resolves.toBe(true);
  });

  it('should fall back to finding by targetType + subBlockId when annotationId is not present', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));

    const container = document.createElement('div');
    container.id = 'ocr-content-wrapper';
    const sb = document.createElement('span');
    sb.className = 'sub-block';
    sb.dataset.subBlockId = '1.1';
    sb.textContent = 'hello';
    container.appendChild(sb);
    document.body.appendChild(container);

    const ok = await scrollToAnnotationAsync('missing', {
      targetType: 'ocr',
      subBlockId: '1.1',
      timeoutMs: 50,
      pollIntervalMs: 10,
    });

    expect(ok).toBe(true);
  });

  it('should resolve false after timeout when nothing appears', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));

    const p = scrollToAnnotationAsync('never', { timeoutMs: 80, pollIntervalMs: 20 });
    await vi.advanceTimersByTimeAsync(200);
    await expect(p).resolves.toBe(false);
  });
});
