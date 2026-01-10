// @vitest-environment jsdom
/**
 * @file tests/annotations/selection-resolver.dom.test.js
 * @description js/annotations/core/selection-resolver.js DOM logic tests (jsdom)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  calculateOffsetInSubBlock,
  collectTextNodes,
  detectFormulaType,
  extractTextIgnoringFormulas,
  findTextInDOMRange,
  isInsideFormula,
  mapLogicalToDOM,
  resolveSelection,
} from '../../js/annotations/core/selection-resolver.js';

function makeSelection(range, text = range.toString()) {
  return {
    isCollapsed: false,
    rangeCount: 1,
    getRangeAt: () => range,
    toString: () => text,
  };
}

describe('annotations/core/selection-resolver', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('isInsideFormula detects katex ancestors', () => {
    const host = document.createElement('div');
    host.append('A');

    const katex = document.createElement('span');
    katex.className = 'katex';
    katex.textContent = 'X';
    host.appendChild(katex);

    const inline = document.createElement('span');
    inline.className = 'katex-inline';
    inline.textContent = 'Y';
    host.appendChild(inline);

    document.body.appendChild(host);

    const hostText = host.firstChild;
    expect(hostText.nodeType).toBe(Node.TEXT_NODE);
    expect(isInsideFormula(hostText)).toBe(false);

    const katexText = katex.firstChild;
    expect(katexText.nodeType).toBe(Node.TEXT_NODE);
    expect(isInsideFormula(katexText)).toBe(true);

    const inlineText = inline.firstChild;
    expect(inlineText.nodeType).toBe(Node.TEXT_NODE);
    expect(isInsideFormula(inlineText)).toBe(true);
  });

  it('extractTextIgnoringFormulas concatenates non-formula text nodes', () => {
    const host = document.createElement('div');
    host.append('Start');

    const katex = document.createElement('span');
    katex.className = 'katex';
    katex.textContent = 'X';
    host.appendChild(katex);

    host.append('End');
    document.body.appendChild(host);

    expect(extractTextIgnoringFormulas(host)).toBe('StartEnd');
  });

  it('collectTextNodes returns offsets over non-formula text only', () => {
    const host = document.createElement('div');
    host.append('A');

    const katex = document.createElement('span');
    katex.className = 'katex';
    katex.textContent = 'X';
    host.appendChild(katex);

    host.append('BC');
    document.body.appendChild(host);

    const nodes = collectTextNodes(host);
    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toEqual(expect.objectContaining({ startOffset: 0, endOffset: 1 }));
    expect(nodes[0].node.textContent).toBe('A');
    expect(nodes[1]).toEqual(expect.objectContaining({ startOffset: 1, endOffset: 3 }));
    expect(nodes[1].node.textContent).toBe('BC');
  });

  it('mapLogicalToDOM maps logical offsets and clamps out-of-range to last node', () => {
    const host = document.createElement('div');
    host.append('Hello');

    const katex = document.createElement('span');
    katex.className = 'katex';
    katex.textContent = 'X';
    host.appendChild(katex);

    host.append('World');
    document.body.appendChild(host);

    const at0 = mapLogicalToDOM(host, 0);
    expect(at0.container.textContent).toBe('Hello');
    expect(at0.offset).toBe(0);

    const at3 = mapLogicalToDOM(host, 3);
    expect(at3.container.textContent).toBe('Hello');
    expect(at3.offset).toBe(3);

    const atHelloEnd = mapLogicalToDOM(host, 5);
    expect(atHelloEnd.container.textContent).toBe('Hello');
    expect(atHelloEnd.offset).toBe(5);

    const beyond = mapLogicalToDOM(host, 999);
    expect(beyond.container.textContent).toBe('World');
    expect(beyond.offset).toBe(5);
  });

  it('findTextInDOMRange finds text spanning multiple text nodes (ignoring formulas)', () => {
    const host = document.createElement('div');
    const a = document.createElement('span');
    a.textContent = 'Hello';
    const b = document.createElement('span');
    b.textContent = 'World';
    host.appendChild(a);
    host.appendChild(b);
    document.body.appendChild(host);

    const range = findTextInDOMRange(host, 'loWo');
    expect(range).toBeInstanceOf(Range);
    expect(range.toString()).toBe('loWo');
    expect(range.startContainer.textContent).toBe('Hello');
    expect(range.startOffset).toBe(3);
    expect(range.endContainer.textContent).toBe('World');
    expect(range.endOffset).toBe(2);

    const withFormula = document.createElement('div');
    withFormula.append('Start');
    const katex = document.createElement('span');
    katex.className = 'katex';
    katex.textContent = 'X';
    withFormula.appendChild(katex);
    withFormula.append('End');
    document.body.appendChild(withFormula);

    expect(findTextInDOMRange(withFormula, 'tXE')).toBeNull();
    expect(findTextInDOMRange(withFormula, 'tEn')).toBeInstanceOf(Range);
  });

  it('detectFormulaType reports block/inline/mixed formula presence', () => {
    const host = document.createElement('div');
    expect(detectFormulaType(host)).toEqual({ hasFormula: false, type: null, elements: [] });

    const block = document.createElement('div');
    const katexDisplay = document.createElement('div');
    katexDisplay.className = 'katex-display';
    katexDisplay.textContent = 'E=mc^2';
    block.appendChild(katexDisplay);
    expect(detectFormulaType(block)).toEqual(
      expect.objectContaining({ hasFormula: true, type: 'block', elements: [katexDisplay] }),
    );

    const inlineOnly = document.createElement('div');
    const katexInline = document.createElement('span');
    katexInline.className = 'katex-inline';
    katexInline.textContent = 'x+y';
    inlineOnly.appendChild(katexInline);
    expect(detectFormulaType(inlineOnly)).toEqual(
      expect.objectContaining({ hasFormula: true, type: 'inline', elements: [katexInline] }),
    );

    const mixed = document.createElement('div');
    const mixedDisplay = document.createElement('div');
    mixedDisplay.className = 'katex-display';
    const mixedInline = document.createElement('span');
    mixedInline.className = 'katex';
    mixedInline.textContent = 'z';
    mixed.appendChild(mixedDisplay);
    mixed.appendChild(mixedInline);
    expect(detectFormulaType(mixed)).toEqual(
      expect.objectContaining({ hasFormula: true, type: 'mixed', elements: [mixedDisplay, mixedInline] }),
    );
  });

  it('resolveSelection returns null for empty/collapsed selections', () => {
    const container = document.createElement('div');
    expect(resolveSelection(null, container)).toBeNull();

    const fakeCollapsed = { isCollapsed: true, rangeCount: 1, getRangeAt: () => document.createRange(), toString: () => 'x' };
    expect(resolveSelection(fakeCollapsed, container)).toBeNull();

    const fakeNoRanges = { isCollapsed: false, rangeCount: 0, getRangeAt: () => null, toString: () => 'x' };
    expect(resolveSelection(fakeNoRanges, container)).toBeNull();

    const range = document.createRange();
    const fakeBlank = makeSelection(range, '   ');
    expect(resolveSelection(fakeBlank, container)).toBeNull();
  });

  it('resolveSelection computes offsets and affected sub-blocks (single vs cross block)', () => {
    const container = document.createElement('div');

    const block = document.createElement('div');
    block.dataset.blockIndex = '7';
    container.appendChild(block);

    const sb1 = document.createElement('div');
    sb1.dataset.subBlockId = 'sb1';
    sb1.append('Hello');
    const sb2 = document.createElement('div');
    sb2.dataset.subBlockId = 'sb2';
    sb2.append('World');
    const sb3 = document.createElement('div');
    sb3.dataset.subBlockId = 'sb3';
    sb3.append('!!!');

    block.appendChild(sb1);
    block.appendChild(sb2);
    block.appendChild(sb3);
    document.body.appendChild(container);

    const startNode = sb1.firstChild;
    const endNode = sb1.firstChild;
    const range1 = document.createRange();
    range1.setStart(startNode, 1);
    range1.setEnd(endNode, 4);

    const selection1 = makeSelection(range1, 'ell');
    const info1 = resolveSelection(selection1, container);
    expect(info1).toEqual(
      expect.objectContaining({
        text: 'ell',
        isCrossBlock: false,
        affectedSubBlocks: ['sb1'],
        startSubBlockId: 'sb1',
        endSubBlockId: 'sb1',
        startOffset: 1,
        endOffset: 4,
        blockIndex: '7',
      }),
    );

    const range2 = document.createRange();
    range2.setStart(sb1.firstChild, 2);
    range2.setEnd(sb3.firstChild, 2);

    const selection2 = makeSelection(range2, 'lloWorld!!');
    const info2 = resolveSelection(selection2, container);
    expect(info2).toEqual(
      expect.objectContaining({
        isCrossBlock: true,
        affectedSubBlocks: ['sb1', 'sb2', 'sb3'],
        startSubBlockId: 'sb1',
        endSubBlockId: 'sb3',
        startOffset: 2,
        endOffset: 2,
        blockIndex: '7',
      }),
    );
  });

  it('calculateOffsetInSubBlock ignores formula text nodes for offset math', () => {
    const sb = document.createElement('div');
    sb.dataset.subBlockId = 'sb';
    sb.append('A');
    const katex = document.createElement('span');
    katex.className = 'katex';
    katex.textContent = 'X';
    sb.appendChild(katex);
    sb.append('BC');
    document.body.appendChild(sb);

    const nodeA = sb.firstChild;
    const nodeBC = sb.lastChild;

    expect(calculateOffsetInSubBlock(sb, nodeA, 1)).toBe(1);
    expect(calculateOffsetInSubBlock(sb, nodeBC, 2)).toBe(3);
  });
});

