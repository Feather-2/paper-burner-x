// @vitest-environment jsdom
/**
 * @file tests/processing/reference-indexer.dom.test.js
 * @description js/processing/reference-indexer.js DOM-oriented tests (jsdom)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function loadReferenceIndexer() {
  if (!globalThis.ReferenceIndexer) {
    await import('../../js/processing/reference-indexer.js');
  }
  return globalThis.ReferenceIndexer;
}

describe('processing/reference-indexer (ReferenceIndexer DOM helpers)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.useFakeTimers();

    delete globalThis.ReferenceIndexer;

    document.body.innerHTML = '';
    window.currentVisibleTabId = undefined;

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();

    const ReferenceIndexer = await loadReferenceIndexer();
    ReferenceIndexer.clearIndex();
  });

  it('parseReferenceNumbers supports lists and ranges (dash and en-dash)', async () => {
    const ReferenceIndexer = await loadReferenceIndexer();

    expect(ReferenceIndexer.parseReferenceNumbers('1')).toEqual([1]);
    expect(ReferenceIndexer.parseReferenceNumbers('2-4')).toEqual([2, 3, 4]);
    expect(ReferenceIndexer.parseReferenceNumbers('2–4')).toEqual([2, 3, 4]);
    expect(ReferenceIndexer.parseReferenceNumbers('1, 3,5')).toEqual([1, 3, 5]);
    expect(ReferenceIndexer.parseReferenceNumbers('x, 2')).toEqual([2]);
  });

  it('markReferenceCitations replaces valid citations and preserves invalid ones', async () => {
    const ReferenceIndexer = await loadReferenceIndexer();

    const markdown = 'See [1] and [2-3] and [99].';
    const refs = [{}, {}, {}];
    const out = ReferenceIndexer.markReferenceCitations(markdown, refs);

    expect(out).toContain('class="reference-citation"');
    expect(out).toContain('href="#ref-1"');
    expect(out).toContain('data-ref-index="0"');
    expect(out).toContain('href="#ref-2"');
    expect(out).toContain('href="#ref-3"');
    expect(out).toContain('[99]');
  });

  it('bindCitationLinks attaches click handlers that call list/manager helpers', async () => {
    const ReferenceIndexer = await loadReferenceIndexer();

    const container = document.createElement('div');
    container.innerHTML =
      '<a href="#ref-1" class="reference-citation" data-ref-index="0">[1]</a>' +
      '<a href="#ref-2" class="reference-citation" data-ref-index="1">[2]</a>';

    const scrollSpy = vi.spyOn(ReferenceIndexer, 'scrollToReferenceInList').mockImplementation(() => {});
    const managerSpy = vi.spyOn(ReferenceIndexer, 'highlightReferenceInManager').mockImplementation(() => {});

    ReferenceIndexer.bindCitationLinks('doc-1', container);

    const link = container.querySelector('[data-ref-index="1"]');
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    const dispatched = link.dispatchEvent(event);

    expect(dispatched).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(scrollSpy).toHaveBeenCalledWith(1);
    expect(managerSpy).toHaveBeenCalledWith(1);
  });

  it('findMarkdownContainer respects currentVisibleTabId and falls back to known IDs/classes', async () => {
    const ReferenceIndexer = await loadReferenceIndexer();

    const ocr = document.createElement('div');
    ocr.id = 'ocr-content-wrapper';
    document.body.appendChild(ocr);

    window.currentVisibleTabId = 'ocr';
    expect(ReferenceIndexer.findMarkdownContainer()).toBe(ocr);

    ocr.remove();
    window.currentVisibleTabId = undefined;

    const byId = document.createElement('div');
    byId.id = 'document-viewer';
    document.body.appendChild(byId);
    expect(ReferenceIndexer.findMarkdownContainer()).toBe(byId);

    byId.remove();

    const byClass = document.createElement('div');
    byClass.className = 'markdown-body';
    document.body.appendChild(byClass);
    expect(ReferenceIndexer.findMarkdownContainer()).toBe(byClass);
  });

  it('scrollToReference highlights and scrolls to the matched element when possible', async () => {
    const ReferenceIndexer = await loadReferenceIndexer();

    const markdown = 'See doi 10.1234/abcd here.';
    ReferenceIndexer.buildIndex('doc-2', markdown, [{ doi: '10.1234/abcd' }]);

    window.currentVisibleTabId = 'ocr';
    document.body.innerHTML = `<div id="ocr-content-wrapper"><p>${markdown}</p></div>`;

    const p = document.querySelector('p');
    p.scrollIntoView = vi.fn();

    const flashSpy = vi.spyOn(ReferenceIndexer, 'addFlashAnimation').mockImplementation(() => {});

    expect(ReferenceIndexer.scrollToReference('doc-2', 0)).toBe(true);
    expect(p.classList.contains('reference-highlight')).toBe(true);
    expect(p.scrollIntoView).toHaveBeenCalled();
    expect(flashSpy).toHaveBeenCalledWith(p);

    vi.advanceTimersByTime(3000);
    expect(p.classList.contains('reference-highlight')).toBe(false);
  });

  it('scrollToReference returns false and warns when position/container are missing', async () => {
    const ReferenceIndexer = await loadReferenceIndexer();

    expect(ReferenceIndexer.scrollToReference('missing-doc', 0)).toBe(false);
    expect(console.warn).toHaveBeenCalledWith('[ReferenceIndexer] Position not found for reference', 0);

    ReferenceIndexer.buildIndex('doc-3', 'doi 10.1/x', [{ doi: '10.1/x' }]);

    document.body.innerHTML = '';
    expect(ReferenceIndexer.scrollToReference('doc-3', 0)).toBe(false);
    expect(console.warn).toHaveBeenCalledWith('[ReferenceIndexer] Markdown container not found');
  });

  it('addFlashAnimation toggles background color and stops after 3 flashes', async () => {
    const ReferenceIndexer = await loadReferenceIndexer();

    const el = document.createElement('div');
    el.style.backgroundColor = 'pink';

    ReferenceIndexer.addFlashAnimation(el);

    const original = el.style.backgroundColor;

    vi.advanceTimersByTime(300);
    expect(el.style.backgroundColor).not.toBe(original);

    vi.advanceTimersByTime(300);
    expect(el.style.backgroundColor).toBe(original);

    vi.advanceTimersByTime(300 * 10);
    expect(el.style.backgroundColor).toBe(original);
  });

  it('scrollToReferenceInList and highlightReferenceInManager interact with DOM elements', async () => {
    const ReferenceIndexer = await loadReferenceIndexer();

    const item = document.createElement('div');
    item.dataset.refId = 'ref-1';
    item.scrollIntoView = vi.fn();
    document.body.appendChild(item);

    const flashSpy = vi.spyOn(ReferenceIndexer, 'addFlashAnimation').mockImplementation(() => {});
    ReferenceIndexer.scrollToReferenceInList(0);
    expect(item.scrollIntoView).toHaveBeenCalled();
    expect(flashSpy).toHaveBeenCalledWith(item);

    const row1 = document.createElement('tr');
    row1.dataset.index = '0';
    const row2 = document.createElement('tr');
    row2.dataset.index = '1';
    row2.classList.add('ref-row-highlight');

    document.body.appendChild(row1);
    document.body.appendChild(row2);

    ReferenceIndexer.highlightReferenceInManager(0);
    expect(row1.classList.contains('ref-row-highlight')).toBe(true);
    expect(row2.classList.contains('ref-row-highlight')).toBe(false);

    vi.advanceTimersByTime(3000);
    expect(row1.classList.contains('ref-row-highlight')).toBe(false);
  });
});

