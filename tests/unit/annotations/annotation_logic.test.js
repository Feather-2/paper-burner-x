// @vitest-environment jsdom
/**
 * @file tests/unit/annotations/annotation_logic.test.js
 * @description Unit tests for js/annotations/annotation_logic.js
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as logic from '../../../js/annotations/annotation_logic.js';

function ensureRangePolyfills() {
  if (typeof Range === 'undefined' || !Range.prototype) return;

  if (!Range.prototype.intersectsNode) {
    Object.defineProperty(Range.prototype, 'intersectsNode', {
      configurable: true,
      value(node) {
        const nodeRange = document.createRange();
        try {
          nodeRange.selectNode(node);
        } catch {
          nodeRange.selectNodeContents(node);
        }

        // `compareBoundaryPoints` returns -1/0/1; treat 0 as intersecting at boundary.
        const endsBeforeNode =
          this.compareBoundaryPoints(Range.END_TO_START, nodeRange) < 0;
        const startsAfterNode =
          this.compareBoundaryPoints(Range.START_TO_END, nodeRange) > 0;
        return !(endsBeforeNode || startsAfterNode);
      }
    });
  }

  if (!Range.prototype.containsNode) {
    Object.defineProperty(Range.prototype, 'containsNode', {
      configurable: true,
      value(node) {
        const nodeRange = document.createRange();
        nodeRange.selectNodeContents(node);
        const startsBeforeOrAt = this.compareBoundaryPoints(Range.START_TO_START, nodeRange) <= 0;
        const endsAfterOrAt = this.compareBoundaryPoints(Range.END_TO_END, nodeRange) >= 0;
        return startsBeforeOrAt && endsAfterOrAt;
      }
    });
  }
}

function makeAnnotation({
  id = 'ann-1',
  targetType = 'ocr',
  motivation = 'highlighting',
  selector = {},
  body = []
} = {}) {
  return {
    id,
    targetType,
    motivation,
    target: {
      selector: [selector]
    },
    body
  };
}

function mountContextMenu() {
  const menu = document.createElement('div');
  menu.id = 'custom-context-menu';
  menu.className = 'context-menu-hidden';
  menu.innerHTML = `
    <ul>
      <li data-action="highlight-block" id="highlight-option">Highlight</li>
      <li id="highlight-actions-divider"></li>
      <li id="remove-highlight-option" data-action="remove-highlight">Remove</li>
      <li id="note-actions-divider"></li>
      <li id="add-note-option" data-action="add-note">Add note</li>
      <li id="edit-note-option" data-action="edit-note">Edit note</li>
      <li id="copy-content-option" data-action="copy-content">Copy</li>
    </ul>
  `;
  document.body.appendChild(menu);
  return menu;
}

function mountContainerWithSubBlocks({
  withDuplicateSubBlockId = false,
  withAnnotationId = false
} = {}) {
  const container = document.createElement('div');
  container.className = 'container';

  const ocrWrapper = document.createElement('div');
  ocrWrapper.id = 'ocr-content-wrapper';

  ocrWrapper.innerHTML = `
    <p data-block-index="1">
      <span class="sub-block" data-sub-block-id="1.0">Hello world</span>
    </p>
    <p data-block-index="2">
      <span class="sub-block" data-sub-block-id="2.0">Second block text</span>
    </p>
    ${withDuplicateSubBlockId ? `
    <p data-block-index="3">
      <span class="sub-block" data-sub-block-id="1.0">Duplicate id block</span>
    </p>
    ` : ''}
  `;

  container.appendChild(ocrWrapper);
  document.body.appendChild(container);

  const firstSubBlock = container.querySelector('.sub-block[data-sub-block-id="1.0"]');
  if (withAnnotationId && firstSubBlock) {
    firstSubBlock.dataset.annotationId = 'ann-1';
  }

  return { container, ocrWrapper };
}

function stubSelection({ rangeCount = 0, range = null, collapsed = false, text = '' } = {}) {
  const selection = {
    rangeCount,
    getRangeAt: vi.fn(() => range || { collapsed }),
    toString: vi.fn(() => text || (range ? range.toString() : ''))
  };
  vi.spyOn(window, 'getSelection').mockImplementation(() => selection);
  return selection;
}

describe('js/annotations/annotation_logic.js', () => {
  /** @type {ReturnType<typeof vi.spyOn>} */
  let consoleLogSpy;
  /** @type {ReturnType<typeof vi.spyOn>} */
  let consoleWarnSpy;
  /** @type {ReturnType<typeof vi.spyOn>} */
  let consoleErrorSpy;
  /** @type {ReturnType<typeof vi.spyOn>} */
  let consoleTimeSpy;
  /** @type {ReturnType<typeof vi.spyOn>} */
  let consoleTimeEndSpy;

  beforeEach(() => {
    ensureRangePolyfills();

    vi.useFakeTimers();
    vi.unstubAllGlobals();

    document.body.innerHTML = '';

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleTimeSpy = vi.spyOn(console, 'time').mockImplementation(() => {});
    consoleTimeEndSpy = vi.spyOn(console, 'timeEnd').mockImplementation(() => {});

    // Browser globals assumed by annotation_logic.js
    window.data = { annotations: [] };
    window.globalCurrentContentIdentifier = 'ocr';
    window.globalCurrentSelection = null;
    window.globalCurrentHighlightStatus = false;
    window.contentReady = true;
    window.currentVisibleTabId = '';

    // External hooks referenced by event handlers (global functions, not imports)
    vi.stubGlobal('getQueryParam', vi.fn(() => 'doc-1'));
    vi.stubGlobal('saveAnnotationToDB', vi.fn(async () => {}));
    vi.stubGlobal('deleteAnnotationFromDB', vi.fn(async () => {}));
    vi.stubGlobal('updateAnnotationInDB', vi.fn(async () => {}));
    vi.stubGlobal('getAnnotationsForDocFromDB', vi.fn(async () => []));
    vi.stubGlobal('alert', vi.fn());
    vi.stubGlobal('prompt', vi.fn(() => 'note text'));

    window.SubBlockSegmenter = { segment: vi.fn() };
    window.applyBlockAnnotations = vi.fn();
    window.addAnnotationListenersToContainer = vi.fn();
    window.highlightBlockOrSubBlock = vi.fn();
    window.DockLogic = { updateStats: vi.fn() };
    window.refreshTocList = vi.fn();
    window.updateReadingProgress = vi.fn();

    // Default selection: none
    stubSelection({ rangeCount: 0 });

    // Keep singleton cache deterministic across tests.
    logic.AnnotationDOMCache.clear();
  });

  afterEach(() => {
    try {
      vi.runOnlyPendingTimers();
    } finally {
      vi.useRealTimers();
    }
    logic.AnnotationDOMCache.clear();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  describe('exports + window compatibility layer', () => {
    it('exposes core functions on window for legacy callers', () => {
      expect(window.AnnotationDOMCache).toBe(logic.AnnotationDOMCache);
      expect(window._page_generateUUID).toBe(logic._page_generateUUID);
      expect(window.initAnnotationSystem).toBe(logic.initAnnotationSystem);
      expect(window.detectCrossBlockSelection).toBe(logic.detectCrossBlockSelection);
      expect(window.handleCrossBlockAnnotation).toBe(logic.handleCrossBlockAnnotation);
      expect(window.checkIfTargetIsHighlighted).toBe(logic.checkIfTargetIsHighlighted);
      expect(window.checkIfTargetHasNote).toBe(logic.checkIfTargetHasNote);
      expect(window.updateContextMenuOptions).toBe(logic.updateContextMenuOptions);
      expect(window.showContextMenu).toBe(logic.showContextMenu);
      expect(window.initializeGlobalAnnotationVariables).toBe(logic.initializeGlobalAnnotationVariables);
    });
  });

  describe('AnnotationDOMCache', () => {
    it('init caches all .sub-block nodes and builds an id->element map', () => {
      mountContainerWithSubBlocks();
      logic.AnnotationDOMCache.init();

      expect(logic.AnnotationDOMCache.initialized).toBe(true);
      expect(Array.isArray(logic.AnnotationDOMCache.subBlocks)).toBe(true);
      expect(logic.AnnotationDOMCache.subBlocks.length).toBe(2);

      const sub1 = logic.AnnotationDOMCache.getSubBlockById('1.0');
      const sub2 = logic.AnnotationDOMCache.getSubBlockById('2.0');
      expect(sub1).toBeInstanceOf(Element);
      expect(sub2).toBeInstanceOf(Element);
      expect(sub1?.textContent).toContain('Hello');
      expect(sub2?.textContent).toContain('Second');
    });

    it('getAllSubBlocks falls back to querying when not initialized', () => {
      mountContainerWithSubBlocks();
      logic.AnnotationDOMCache.clear();

      const result = logic.AnnotationDOMCache.getAllSubBlocks();
      expect(result).toBeTruthy();
      expect(Array.from(result).length).toBe(2);
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it('getSubBlockById falls back to querying when not initialized', () => {
      mountContainerWithSubBlocks();
      logic.AnnotationDOMCache.clear();

      const element = logic.AnnotationDOMCache.getSubBlockById('1.0');
      expect(element).toBeInstanceOf(Element);
      expect(element?.dataset?.subBlockId).toBe('1.0');
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it('clear resets internal cache state', () => {
      mountContainerWithSubBlocks();
      logic.AnnotationDOMCache.init();
      logic.AnnotationDOMCache.clear();

      expect(logic.AnnotationDOMCache.subBlocks).toBeNull();
      expect(logic.AnnotationDOMCache.subBlockMap).toBeNull();
      expect(logic.AnnotationDOMCache.initialized).toBe(false);
    });

    it('refresh re-initializes cache after DOM changes', () => {
      const { container } = mountContainerWithSubBlocks();
      logic.AnnotationDOMCache.init();
      expect(logic.AnnotationDOMCache.subBlocks.length).toBe(2);

      const p = document.createElement('p');
      p.dataset.blockIndex = '3';
      p.innerHTML = `<span class="sub-block" data-sub-block-id="3.0">Third</span>`;
      container.querySelector('#ocr-content-wrapper')?.appendChild(p);

      logic.AnnotationDOMCache.refresh();
      expect(logic.AnnotationDOMCache.initialized).toBe(true);
      expect(logic.AnnotationDOMCache.subBlocks.length).toBe(3);
      expect(logic.AnnotationDOMCache.getSubBlockById('3.0')?.textContent).toContain('Third');
    });
  });

  describe('_page_generateUUID', () => {
    it('generates a UUID v4-like string', () => {
      const uuid = logic._page_generateUUID();
      expect(uuid).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    it('produces different values across calls (deterministic Math.random stub)', () => {
      let i = 0;
      vi.spyOn(Math, 'random').mockImplementation(() => {
        i += 1;
        // Use a coarse stepping so the UUID digit generation does not stay at `0`
        // for the first ~60 calls (UUID template uses 31 Math.random() calls).
        return (i % 16) / 16;
      });

      const a = logic._page_generateUUID();
      const b = logic._page_generateUUID();
      expect(a).not.toBe(b);
    });
  });

  describe('checkIfTargetIsHighlighted', () => {
    it('returns false when window.data.annotations is missing', () => {
      window.data = null;
      expect(logic.checkIfTargetIsHighlighted('ann-1', 'ocr')).toBe(false);
    });

    it('finds by annotationId when provided (targetType must match)', () => {
      window.data.annotations = [makeAnnotation({ id: 'ann-1', targetType: 'ocr' })];

      expect(logic.checkIfTargetIsHighlighted('ann-1', 'ocr')).toBe(true);
      expect(logic.checkIfTargetIsHighlighted('ann-1', 'translation')).toBe(false);
      expect(logic.checkIfTargetIsHighlighted('missing', 'ocr')).toBe(false);
    });

    it('finds by targetIdentifier + identifierType with trim + numeric epsilon matching', () => {
      window.data.annotations = [
        makeAnnotation({ id: 'a', selector: { subBlockId: ' 1.0 ' } }),
        makeAnnotation({ id: 'b', selector: { blockIndex: '1.0004' } }),
        makeAnnotation({ id: 'c', selector: { blockIndex: '2.002' } })
      ];

      expect(logic.checkIfTargetIsHighlighted(null, 'ocr', '1.0', 'subBlockId')).toBe(true);
      expect(logic.checkIfTargetIsHighlighted(null, 'ocr', '1', 'blockIndex')).toBe(true); // epsilon match
      expect(logic.checkIfTargetIsHighlighted(null, 'ocr', '2', 'blockIndex')).toBe(false);
    });

    it('ignores malformed annotations without throwing', () => {
      window.data.annotations = [
        { id: 'bad-1', targetType: 'ocr' },
        { id: 'bad-2', targetType: 'ocr', target: { selector: [] } },
        makeAnnotation({ id: 'ok', selector: { subBlockId: '9.9' } })
      ];

      expect(() =>
        logic.checkIfTargetIsHighlighted(null, 'ocr', '9.9', 'subBlockId')
      ).not.toThrow();
      expect(logic.checkIfTargetIsHighlighted(null, 'ocr', '9.9', 'subBlockId')).toBe(true);
      expect(logic.checkIfTargetIsHighlighted(null, 'ocr', 'missing', 'subBlockId')).toBe(false);
    });
  });

  describe('checkIfTargetHasNote', () => {
    it('returns false when window.data.annotations is missing', () => {
      window.data = undefined;
      expect(logic.checkIfTargetHasNote('ann-1', 'ocr')).toBe(false);
    });

    it('finds non-empty note by annotationId when provided', () => {
      window.data.annotations = [
        makeAnnotation({
          id: 'ann-note',
          targetType: 'ocr',
          body: [{ value: 'Hello note' }]
        }),
        makeAnnotation({
          id: 'ann-empty',
          targetType: 'ocr',
          body: [{ value: '   ' }]
        })
      ];

      expect(logic.checkIfTargetHasNote('ann-note', 'ocr')).toBe(true);
      expect(logic.checkIfTargetHasNote('ann-empty', 'ocr')).toBe(false);
      expect(logic.checkIfTargetHasNote('ann-note', 'translation')).toBe(false);
    });

    it('finds non-empty note by targetIdentifier + identifierType (with epsilon match)', () => {
      window.data.annotations = [
        makeAnnotation({
          id: 'a',
          selector: { blockIndex: '1.0004' },
          body: [{ value: 'note' }]
        }),
        makeAnnotation({
          id: 'b',
          selector: { subBlockId: '2.0' },
          body: []
        })
      ];

      expect(logic.checkIfTargetHasNote(null, 'ocr', '1', 'blockIndex')).toBe(true);
      expect(logic.checkIfTargetHasNote(null, 'ocr', '2.0', 'subBlockId')).toBe(false);
    });

    it('ignores malformed annotations without throwing', () => {
      window.data.annotations = [
        { id: 'bad-1', targetType: 'ocr', body: [{ value: 'x' }] },
        makeAnnotation({
          id: 'ok',
          selector: { subBlockId: '1.0' },
          body: [{ value: 'ok' }]
        })
      ];

      expect(() =>
        logic.checkIfTargetHasNote(null, 'ocr', '1.0', 'subBlockId')
      ).not.toThrow();
      expect(logic.checkIfTargetHasNote(null, 'ocr', '1.0', 'subBlockId')).toBe(true);
    });
  });

  describe('updateContextMenuOptions', () => {
    it('does not throw when context menu element is missing', () => {
      mountContainerWithSubBlocks();
      // No menu mounted -> initAnnotationSystem logs error and returns; updateContextMenuOptions should no-op.
      logic.initAnnotationSystem();
      expect(() => logic.updateContextMenuOptions(false, false)).not.toThrow();
    });

    it('hides all options in read-only mode', () => {
      mountContainerWithSubBlocks();
      const menu = mountContextMenu();
      logic.initAnnotationSystem();

      stubSelection({ rangeCount: 1, collapsed: false, text: 'selected' });
      logic.updateContextMenuOptions(true, true, true);

      const highlightOption = menu.querySelector('[data-action="highlight-block"]');
      expect(highlightOption?.style.display).toBe('none');
      expect(document.getElementById('remove-highlight-option')?.style.display).toBe('none');
      expect(document.getElementById('add-note-option')?.style.display).toBe('none');
      expect(document.getElementById('edit-note-option')?.style.display).toBe('none');
      expect(document.getElementById('copy-content-option')?.style.display).toBe('none');
      expect(document.getElementById('highlight-actions-divider')?.style.display).toBe('none');
      expect(document.getElementById('note-actions-divider')?.style.display).toBe('none');
    });

    it('shows highlight + copy options only when a non-collapsed selection exists', () => {
      mountContainerWithSubBlocks();
      const menu = mountContextMenu();
      logic.initAnnotationSystem();

      // No selection -> cannot highlight/copy
      stubSelection({ rangeCount: 0 });
      logic.updateContextMenuOptions(false, false, false);
      expect(menu.querySelector('[data-action="highlight-block"]')?.style.display).toBe('none');
      expect(document.getElementById('copy-content-option')?.style.display).toBe('none');

      // Non-collapsed selection -> can highlight/copy
      stubSelection({ rangeCount: 1, collapsed: false, text: 'Hi' });
      logic.updateContextMenuOptions(false, false, false);
      expect(menu.querySelector('[data-action="highlight-block"]')?.style.display).toBe('block');
      expect(menu.querySelector('[data-action="highlight-block"]')?.textContent).toBe('高亮选中内容');
      expect(document.getElementById('copy-content-option')?.style.display).toBe('block');
    });

    it('toggles remove-highlight and note options based on highlight/note state', () => {
      mountContainerWithSubBlocks();
      const menu = mountContextMenu();
      logic.initAnnotationSystem();
      stubSelection({ rangeCount: 1, collapsed: false, text: 'Hi' });

      // Not highlighted -> hide remove + note actions
      logic.updateContextMenuOptions(false, false, false);
      expect(document.getElementById('remove-highlight-option')?.style.display).toBe('none');
      expect(document.getElementById('add-note-option')?.style.display).toBe('none');
      expect(document.getElementById('edit-note-option')?.style.display).toBe('none');
      expect(document.getElementById('highlight-actions-divider')?.style.display).toBe('none');
      expect(document.getElementById('note-actions-divider')?.style.display).toBe('none');

      // Highlighted, no note -> show remove + add-note
      logic.updateContextMenuOptions(true, false, false);
      expect(document.getElementById('remove-highlight-option')?.style.display).toBe('block');
      expect(document.getElementById('add-note-option')?.style.display).toBe('block');
      expect(document.getElementById('edit-note-option')?.style.display).toBe('none');
      expect(document.getElementById('highlight-actions-divider')?.style.display).toBe('block');
      expect(document.getElementById('note-actions-divider')?.style.display).toBe('block');

      // Highlighted, has note -> show remove + edit-note
      logic.updateContextMenuOptions(true, true, false);
      expect(document.getElementById('add-note-option')?.style.display).toBe('none');
      expect(document.getElementById('edit-note-option')?.style.display).toBe('block');
      expect(document.getElementById('note-actions-divider')?.style.display).toBe('block');
    });
  });

  describe('showContextMenu', () => {
    it('does not throw when context menu element is missing', () => {
      expect(() => logic.showContextMenu(10, 20)).not.toThrow();
    });

    it('positions and shows the menu (toggles visibility classes)', () => {
      mountContainerWithSubBlocks();
      const menu = mountContextMenu();
      logic.initAnnotationSystem();

      logic.showContextMenu(123, 456);
      expect(menu.style.left).toBe('123px');
      expect(menu.style.top).toBe('456px');
      expect(menu.classList.contains('context-menu-visible')).toBe(true);
      expect(menu.classList.contains('context-menu-hidden')).toBe(false);
    });
  });

  describe('initAnnotationSystem', () => {
    it('logs an error and returns when the menu element is missing', () => {
      mountContainerWithSubBlocks();
      logic.initAnnotationSystem();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('does not double-bind the contextmenu handler', () => {
      mountContainerWithSubBlocks();
      mountContextMenu();

      window.contentReady = false;
      logic.initAnnotationSystem();
      logic.initAnnotationSystem(); // should short-circuit on _annotationContextMenuBound

      const target = document.querySelector('.sub-block[data-sub-block-id="1.0"]');
      const evt = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      target?.dispatchEvent(evt);

      // If bound twice, alert would be triggered twice.
      expect(globalThis.alert).toHaveBeenCalledTimes(1);
    });

    it('alerts and does not show menu when content is not ready', () => {
      mountContainerWithSubBlocks();
      const menu = mountContextMenu();
      window.contentReady = false;
      logic.initAnnotationSystem();

      const target = document.querySelector('.sub-block[data-sub-block-id="1.0"]');
      const evt = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 20 });
      target?.dispatchEvent(evt);

      expect(globalThis.alert).toHaveBeenCalledWith('请等待内容加载完成后再右键区块。');
      expect(menu.classList.contains('context-menu-visible')).toBe(false);
      expect(evt.defaultPrevented).toBe(false);
    });

    it('does not show the custom menu when there is no selection and the target is not already highlighted', () => {
      mountContainerWithSubBlocks({ withAnnotationId: false });
      const menu = mountContextMenu();
      logic.initAnnotationSystem();

      // No selection, no annotationId -> canHighlight=false, clickedHighlighted=false -> hide and allow default menu.
      stubSelection({ rangeCount: 0 });
      const target = document.querySelector('.sub-block[data-sub-block-id="1.0"]');
      const evt = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 20 });
      target?.dispatchEvent(evt);

      // Advance timer that clears _contextMenuProcessing (avoids leaking state to other tests).
      vi.advanceTimersByTime(150);

      expect(menu.classList.contains('context-menu-visible')).toBe(false);
      expect(menu.classList.contains('context-menu-hidden')).toBe(true);
      expect(evt.defaultPrevented).toBe(false);
    });

    it('shows the menu and stores dataset context when right-clicking an already-highlighted sub-block', () => {
      mountContainerWithSubBlocks({ withAnnotationId: true });
      const menu = mountContextMenu();

      window.data.annotations = [
        makeAnnotation({
          id: 'ann-1',
          targetType: 'ocr',
          selector: { subBlockId: '1.0' }
        })
      ];

      // Pre-set cross-block state to ensure it gets cleared on single-block contextmenu.
      menu.dataset.contextIsCrossBlock = 'true';
      menu.dataset.contextCrossBlockAnnotationId = 'cross-should-clear';
      menu.dataset.contextAffectedSubBlocks = JSON.stringify(['x']);

      logic.initAnnotationSystem();

      stubSelection({ rangeCount: 0 });
      const target = document.querySelector('.sub-block[data-sub-block-id="1.0"]');
      const evt = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 12, clientY: 34 });
      target?.dispatchEvent(evt);

      vi.advanceTimersByTime(150);

      expect(evt.defaultPrevented).toBe(true);
      expect(menu.classList.contains('context-menu-visible')).toBe(true);
      expect(menu.style.left).toBe('12px');
      expect(menu.style.top).toBe('34px');

      // Context stored on menu element
      expect(menu.dataset.contextContentIdentifier).toBe('ocr');
      expect(menu.dataset.contextIdentifierType).toBe('subBlockId');
      expect(menu.dataset.contextTargetIdentifier).toBe('1.0');
      expect(menu.dataset.contextAnnotationId).toBe('ann-1');
      expect(menu.dataset.contextBlockIndex).toBe('1');

      // Single-block context should clear cross-block attributes
      expect(menu.dataset.contextIsCrossBlock).toBeUndefined();
      expect(menu.dataset.contextCrossBlockAnnotationId).toBeUndefined();
      expect(menu.dataset.contextAffectedSubBlocks).toBeUndefined();

      // Global selection + highlight status updated
      expect(window.globalCurrentSelection).toBeTruthy();
      expect(window.globalCurrentSelection.targetElement).toBe(target);
      expect(window.globalCurrentHighlightStatus).toBe(true);
    });
  });

  describe('detectCrossBlockSelection', () => {
    it('returns {isCrossBlock:false} when there is no selection range', () => {
      stubSelection({ rangeCount: 0 });
      const result = logic.detectCrossBlockSelection();
      expect(result).toEqual({ isCrossBlock: false });
    });

    it('returns {isCrossBlock:false} when the range is collapsed', () => {
      stubSelection({ rangeCount: 1, collapsed: true, text: '' });
      const result = logic.detectCrossBlockSelection();
      expect(result).toEqual({ isCrossBlock: false });
    });

    it('detects a cross-block selection spanning multiple sub-block ids', () => {
      mountContainerWithSubBlocks();

      const start = document.querySelector('.sub-block[data-sub-block-id="1.0"]')?.firstChild;
      const end = document.querySelector('.sub-block[data-sub-block-id="2.0"]')?.firstChild;
      expect(start?.nodeType).toBe(Node.TEXT_NODE);
      expect(end?.nodeType).toBe(Node.TEXT_NODE);

      const range = document.createRange();
      range.setStart(start, 0);
      range.setEnd(end, (end.nodeValue || '').length);

      stubSelection({ rangeCount: 1, range, text: 'Hello worldSecond block text' });
      const result = logic.detectCrossBlockSelection();

      expect(result.isCrossBlock).toBe(true);
      expect(result.startSubBlock?.dataset?.subBlockId).toBe('1.0');
      expect(result.endSubBlock?.dataset?.subBlockId).toBe('2.0');
      expect(Array.isArray(result.affectedSubBlocks)).toBe(true);
      const ids = result.affectedSubBlocks.map(sb => sb.subBlockId).sort();
      expect(ids).toEqual(['1.0', '2.0'].sort());
      expect(result.selectedText).toBe('Hello worldSecond block text');
      expect(result.range).toBe(range);
    });

    it('treats selection across different DOM nodes as cross-block even if sub-block ids are identical', () => {
      mountContainerWithSubBlocks({ withDuplicateSubBlockId: true });

      const blocks = Array.from(document.querySelectorAll('.sub-block[data-sub-block-id="1.0"]'));
      expect(blocks.length).toBeGreaterThanOrEqual(2);
      const [a, b] = blocks;

      const range = document.createRange();
      range.setStart(a.firstChild, 0);
      range.setEnd(b.firstChild, (b.firstChild?.nodeValue || '').length);

      stubSelection({ rangeCount: 1, range, text: 'Hello worldDuplicate id block' });
      const result = logic.detectCrossBlockSelection();

      expect(result.isCrossBlock).toBe(true);
      expect(result.startSubBlock).not.toBe(result.endSubBlock);
    });
  });

  describe('handleCrossBlockAnnotation', () => {
    it('hides the context menu and exits early in read-only (chunk-compare) mode', async () => {
      mountContainerWithSubBlocks();
      const menu = mountContextMenu();
      logic.initAnnotationSystem();

      // Pre-set visible menu + selection to verify hide/reset.
      menu.classList.remove('context-menu-hidden');
      menu.classList.add('context-menu-visible');
      window.globalCurrentSelection = { text: 'old' };
      window.globalCurrentHighlightStatus = true;

      window.currentVisibleTabId = 'chunk-compare';

      const startSubBlock = document.querySelector('.sub-block[data-sub-block-id="1.0"]');
      const endSubBlock = document.querySelector('.sub-block[data-sub-block-id="2.0"]');
      const range = document.createRange();
      range.setStart(startSubBlock.firstChild, 0);
      range.setEnd(endSubBlock.firstChild, 1);

      const crossBlockInfo = {
        isCrossBlock: true,
        startSubBlock,
        endSubBlock,
        affectedSubBlocks: [
          { element: startSubBlock, subBlockId: '1.0', text: startSubBlock.textContent },
          { element: endSubBlock, subBlockId: '2.0', text: endSubBlock.textContent }
        ],
        selectedText: 'Hello',
        range
      };

      const evt = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 20 });
      await logic.handleCrossBlockAnnotation(evt, crossBlockInfo);

      expect(evt.defaultPrevented).toBe(true);
      expect(menu.classList.contains('context-menu-hidden')).toBe(true);
      expect(window.globalCurrentSelection).toBeNull();
      expect(window.globalCurrentHighlightStatus).toBe(false);
    });

    it('stores cross-block context on the menu and shows cross-block highlight UI (no existing highlight)', async () => {
      mountContainerWithSubBlocks();
      const menu = mountContextMenu();
      logic.initAnnotationSystem();

      window.currentVisibleTabId = '';
      window.globalCurrentContentIdentifier = 'ocr';
      window.data.annotations = [];

      const startSubBlock = document.querySelector('.sub-block[data-sub-block-id="1.0"]');
      const endSubBlock = document.querySelector('.sub-block[data-sub-block-id="2.0"]');
      const range = document.createRange();
      range.setStart(startSubBlock.firstChild, 0);
      range.setEnd(endSubBlock.firstChild, (endSubBlock.firstChild?.nodeValue || '').length);

      const crossBlockInfo = {
        isCrossBlock: true,
        startSubBlock,
        endSubBlock,
        affectedSubBlocks: [
          { element: startSubBlock, subBlockId: '1.0', text: startSubBlock.textContent },
          { element: endSubBlock, subBlockId: '2.0', text: endSubBlock.textContent }
        ],
        selectedText: 'Hello worldSecond block text',
        range
      };

      const evt = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 33, clientY: 44 });
      await logic.handleCrossBlockAnnotation(evt, crossBlockInfo);

      expect(evt.defaultPrevented).toBe(true);
      expect(menu.classList.contains('context-menu-visible')).toBe(true);
      expect(menu.style.left).toBe('33px');
      expect(menu.style.top).toBe('44px');

      expect(menu.dataset.contextIsCrossBlock).toBe('true');
      expect(menu.dataset.contextContentIdentifier).toBe('ocr');
      expect(menu.dataset.contextSelectedText).toBe('Hello worldSecond block text');
      expect(JSON.parse(menu.dataset.contextAffectedSubBlocks)).toEqual(['1.0', '2.0']);

      expect(window.globalCurrentSelection?.isCrossBlock).toBe(true);
      expect(window.globalCurrentSelection?.affectedSubBlocks?.length).toBe(2);
      expect(window.globalCurrentSelection?.crossBlockAnnotationId).toMatch(/^cross-[0-9a-f-]{36}$/i);

      // No existing annotation -> should offer highlight action with a color submenu.
      const highlightOption = menu.querySelector('[data-action="highlight-block"]');
      expect(highlightOption?.textContent).toBe('高亮选中区域');
      expect(highlightOption?.style.display).toBe('block');
      expect(highlightOption?.querySelectorAll('.color-option').length).toBe(5);

      expect(document.getElementById('remove-highlight-option')?.style.display).toBe('none');
      expect(document.getElementById('copy-content-option')?.style.display).toBe('block');
      expect(document.getElementById('add-note-option')?.style.display).toBe('none');
      expect(document.getElementById('edit-note-option')?.style.display).toBe('none');
      expect(window.globalCurrentHighlightStatus).toBe(false);
    });
  });

  describe('initializeGlobalAnnotationVariables', () => {
    it('initializes global annotation state on window', () => {
      window.globalCurrentSelection = { text: 'x' };
      window.globalCurrentHighlightStatus = true;
      window.globalCurrentContentIdentifier = 'ocr';

      logic.initializeGlobalAnnotationVariables();

      expect(window.globalCurrentSelection).toBeNull();
      expect(window.globalCurrentHighlightStatus).toBe(false);
      expect(window.globalCurrentContentIdentifier).toBe('');
    });

    it('is a no-op when window is undefined', () => {
      vi.stubGlobal('window', undefined);
      expect(() => logic.initializeGlobalAnnotationVariables()).not.toThrow();
    });
  });
});
