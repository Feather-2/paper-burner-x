// @vitest-environment jsdom
/**
 * @file tests/unit/annotations/annotations_summary_modal.test.js
 * @description Unit tests for js/annotations/annotations_summary_modal.js
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const RGBA = {
  yellow: 'rgba(255, 255, 0, 0.75)',
  pink: 'rgba(253, 170, 200, 0.75)',
  lightblue: 'rgba(95, 211, 250, 0.75)',
  lightgreen: 'rgba(178, 253, 178, 0.75)',
  purple: 'rgba(128, 0, 128, 0.75)',
  orange: 'rgba(255, 165, 0, 0.75)',
  red: 'rgba(255, 0, 0, 0.75)',
  cyan: 'rgba(0, 255, 255, 0.75)',
  blue: 'rgba(0, 0, 255, 0.75)',
  green: 'rgba(0, 128, 0, 0.75)',
};

const mockedGetHighlightColor = vi.hoisted(() =>
  vi.fn((color) => (RGBA[color] ? RGBA[color] : color)),
);

vi.mock('../../../js/annotations/renderers/index.js', () => ({
  getHighlightColor: mockedGetHighlightColor,
}));

async function loadModule() {
  return await import('../../../js/annotations/annotations_summary_modal.js');
}

async function flushPromises(ticks = 3) {
  for (let i = 0; i < ticks; i++) await Promise.resolve();
}

function setupDom({
  includeModal = true,
  includeCloseButton = true,
  includeFilters = true,
  includeTableBody = true,
  includeContentWrappers = false,
} = {}) {
  document.body.innerHTML = '';

  let modal = null;
  let modalInner = null;
  if (includeModal) {
    modal = document.createElement('div');
    modal.id = 'annotations-summary-modal';

    modalInner = document.createElement('div');
    modalInner.id = 'annotations-summary-modal-inner';
    modal.appendChild(modalInner);

    document.body.appendChild(modal);
  }

  let closeBtn = null;
  if (includeCloseButton) {
    closeBtn = document.createElement('button');
    closeBtn.id = 'annotations-summary-close-btn';
    closeBtn.textContent = 'close';
    document.body.appendChild(closeBtn);
  }

  let typeSelect = null;
  let contentSelect = null;
  let colorFilter = null;
  if (includeFilters) {
    typeSelect = document.createElement('select');
    typeSelect.id = 'annotations-filter-type';
    ['all', 'commenting', 'highlighting'].forEach((v) => {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      typeSelect.appendChild(opt);
    });
    typeSelect.value = 'all';

    contentSelect = document.createElement('select');
    contentSelect.id = 'annotations-filter-content';
    ['all', 'ocr', 'translation'].forEach((v) => {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      contentSelect.appendChild(opt);
    });
    contentSelect.value = 'all';

    colorFilter = document.createElement('div');
    colorFilter.id = 'annotations-summary-color-filter';

    document.body.appendChild(typeSelect);
    document.body.appendChild(contentSelect);
    document.body.appendChild(colorFilter);
  }

  let tableBody = null;
  if (includeTableBody) {
    const table = document.createElement('table');
    tableBody = document.createElement('tbody');
    tableBody.id = 'annotations-summary-table-body';
    table.appendChild(tableBody);
    document.body.appendChild(table);
  }

  let ocrWrapper = null;
  let translationWrapper = null;
  if (includeContentWrappers) {
    ocrWrapper = document.createElement('div');
    ocrWrapper.id = 'ocr-content-wrapper';

    translationWrapper = document.createElement('div');
    translationWrapper.id = 'translation-content-wrapper';

    document.body.appendChild(ocrWrapper);
    document.body.appendChild(translationWrapper);
  }

  return {
    modal,
    modalInner,
    closeBtn,
    typeSelect,
    contentSelect,
    colorFilter,
    tableBody,
    ocrWrapper,
    translationWrapper,
  };
}

function makeAnnotation(overrides = {}) {
  return {
    id: 1,
    targetType: 'ocr',
    motivation: 'highlighting',
    highlightColor: 'yellow',
    body: [],
    target: {
      selector: [
        {
          blockIndex: 1,
          exact: 'Hello world',
        },
      ],
    },
    ...overrides,
  };
}

function makeCrossBlockAnnotation(overrides = {}) {
  return makeAnnotation({
    id: 99,
    target: {
      selector: [
        {
          type: 'CrossBlockRangeSelector',
          affectedSubBlocks: ['2.1', '2.2'],
        },
      ],
    },
    ...overrides,
  });
}

let originalScrollIntoView = null;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();

  document.body.innerHTML = '';

  // Silence noisy logs by default.
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});

  // Provide deterministic globals used by the module.
  globalThis._page_generateUUID = vi.fn(() => 'uuid-1');
  globalThis.alert = vi.fn();

  window.currentVisibleTabId = 'ocr';

  // Make document.hidden writable (jsdom varies).
  try {
    Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
  } catch {
    // Best-effort; tests that rely on polling set it explicitly.
  }

  // Deterministic scrollIntoView for jump tests.
  originalScrollIntoView = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  // Stop the module's polling loop if it was started.
  try {
    window.dispatchEvent(new Event('beforeunload'));
  } catch {
    // ignore
  }

  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();

  Element.prototype.scrollIntoView = originalScrollIntoView;

  delete window.data;
  delete window.getCurrentTocStructure;
  delete window.currentBlockTokensForCopy;
  delete window.openAnnotationsSummaryModal;
  delete window.scrollToAnnotation;
  delete window.scrollToAnnotationAsync;

  delete globalThis._page_generateUUID;
  delete globalThis.updateAnnotationInDB;
  delete globalThis.showTab;
  delete globalThis.alert;
});

describe('js/annotations/annotations_summary_modal.js exports', () => {
  it('exports the documented public API and registers window.openAnnotationsSummaryModal', async () => {
    const mod = await loadModule();

    expect(typeof mod.initAnnotationsSummaryModal).toBe('function');
    expect(typeof mod.populateAnnotationsSummaryTable).toBe('function');
    expect(typeof mod.openAnnotationsSummaryModal).toBe('function');
    expect(typeof mod.closeAnnotationsSummaryModal).toBe('function');

    expect(typeof window.openAnnotationsSummaryModal).toBe('function');
    expect(window.openAnnotationsSummaryModal).toBe(mod.openAnnotationsSummaryModal);
  });
});

describe('initAnnotationsSummaryModal', () => {
  it('does nothing before DOM exists and later initializes once elements appear', async () => {
    const mod = await loadModule();

    // No DOM: init should be a no-op and not throw.
    expect(() => mod.initAnnotationsSummaryModal()).not.toThrow();

    // DOM appears later: init should wire behavior.
    const { modal, closeBtn } = setupDom();
    expect(modal.classList.contains('visible')).toBe(false);

    mod.initAnnotationsSummaryModal();

    modal.classList.add('visible');
    closeBtn.click();
    expect(modal.classList.contains('visible')).toBe(false);
  });

  it('is idempotent (event listeners are wired only once)', async () => {
    const mod = await loadModule();
    const { modal, typeSelect, contentSelect } = setupDom();

    const modalAddSpy = vi.spyOn(modal, 'addEventListener');
    const typeAddSpy = vi.spyOn(typeSelect, 'addEventListener');
    const contentAddSpy = vi.spyOn(contentSelect, 'addEventListener');
    const windowAddSpy = vi.spyOn(window, 'addEventListener');

    mod.initAnnotationsSummaryModal();
    mod.initAnnotationsSummaryModal();

    expect(modalAddSpy).toHaveBeenCalledWith('click', expect.any(Function));
    expect(typeAddSpy).toHaveBeenCalledWith('change', expect.any(Function));
    expect(contentAddSpy).toHaveBeenCalledWith('change', expect.any(Function));

    expect(modalAddSpy.mock.calls.length).toBe(1);
    expect(typeAddSpy.mock.calls.length).toBe(1);
    expect(contentAddSpy.mock.calls.length).toBe(1);

    // beforeunload listener should be bound once.
    expect(windowAddSpy.mock.calls.filter((c) => c[0] === 'beforeunload').length).toBe(1);
  });

  it('closes the modal on backdrop clicks but not on inner content clicks', async () => {
    const mod = await loadModule();
    const { modal, modalInner } = setupDom();

    mod.initAnnotationsSummaryModal();

    modal.classList.add('visible');
    modalInner.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(modal.classList.contains('visible')).toBe(true);

    modal.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(modal.classList.contains('visible')).toBe(false);
  });

  it('re-renders on filter select changes using the currently checked colors', async () => {
    const mod = await loadModule();
    const { modal, typeSelect, contentSelect, colorFilter, tableBody } = setupDom();

    window.data = {
      annotations: [
        makeAnnotation({ id: 1, motivation: 'highlighting', highlightColor: 'yellow', target: { selector: [{ blockIndex: 1, exact: 'A' }] } }),
        makeAnnotation({ id: 2, motivation: 'commenting', highlightColor: 'pink', body: [{ value: 'note' }], target: { selector: [{ blockIndex: 2, exact: 'B' }] } }),
      ],
    };

    // Render with all colors selected.
    mod.openAnnotationsSummaryModal('all', 'all');
    expect(modal.classList.contains('visible')).toBe(true);

    const pinkCheckbox = colorFilter.querySelector('input[type="checkbox"][value="pink"]');
    expect(pinkCheckbox).not.toBeNull();
    pinkCheckbox.checked = false;
    pinkCheckbox.dispatchEvent(new Event('change', { bubbles: true }));

    // Now changing type filter should use the current (yellow-only) checked colors,
    // which filters out the pink commenting annotation.
    typeSelect.value = 'commenting';
    typeSelect.dispatchEvent(new Event('change', { bubbles: true }));

    expect(contentSelect.value).toBe('all');
    expect(tableBody.textContent).toContain('没有符合筛选条件的批注或高亮');
  });
});

describe('openAnnotationsSummaryModal / closeAnnotationsSummaryModal', () => {
  it('open sets initial filters, populates, and shows the modal; close hides it', async () => {
    const mod = await loadModule();
    const { modal, typeSelect, contentSelect, tableBody } = setupDom();

    window.data = {
      annotations: [
        makeAnnotation({ id: 1, motivation: 'highlighting', highlightColor: 'yellow', target: { selector: [{ blockIndex: 1, exact: 'X' }] } }),
      ],
    };

    mod.openAnnotationsSummaryModal('highlighting', 'ocr');

    expect(typeSelect.value).toBe('highlighting');
    expect(contentSelect.value).toBe('ocr');
    expect(modal.classList.contains('visible')).toBe(true);
    expect(tableBody.querySelectorAll('tr').length).toBeGreaterThan(0);

    mod.closeAnnotationsSummaryModal();
    expect(modal.classList.contains('visible')).toBe(false);
  });

  it('open is a no-op if required DOM elements are missing', async () => {
    const mod = await loadModule();
    setupDom({ includeFilters: false });
    window.data = { annotations: [makeAnnotation()] };

    expect(() => mod.openAnnotationsSummaryModal()).not.toThrow();
  });
});

describe('populateAnnotationsSummaryTable', () => {
  it('renders a "no data" row when annotations are missing', async () => {
    const mod = await loadModule();
    const { tableBody } = setupDom();

    delete window.data;
    mod.populateAnnotationsSummaryTable();

    expect(tableBody.textContent).toContain('暂无数据或批注未加载');
  });

  it('renders a "no matches" row when annotations exist but no rows pass filters', async () => {
    const mod = await loadModule();
    const { tableBody } = setupDom();

    window.data = { annotations: [] };
    mod.populateAnnotationsSummaryTable('commenting', 'ocr', ['yellow']);

    expect(tableBody.textContent).toContain('没有符合筛选条件的批注或高亮');
  });

  it('deduplicates annotations by location and prefers the highest id', async () => {
    const mod = await loadModule();
    const { tableBody } = setupDom();

    window.data = {
      annotations: [
        makeAnnotation({
          id: 1,
          motivation: 'highlighting',
          highlightColor: 'yellow',
          target: { selector: [{ subBlockId: '1.1', exact: 'older' }] },
        }),
        makeAnnotation({
          id: 2,
          motivation: 'commenting',
          highlightColor: 'pink',
          body: [{ value: 'newer note' }],
          target: { selector: [{ subBlockId: '1.1', exact: 'newer' }] },
        }),
      ],
    };

    mod.populateAnnotationsSummaryTable();

    const rows = Array.from(tableBody.querySelectorAll('tr'));
    expect(rows.length).toBe(2); // header + one deduped annotation

    const itemRow = rows[1];
    expect(itemRow.cells[0].textContent).toBe('批注');
    expect(itemRow.cells[4].textContent).toBe('newer note');
  });

  it('filters by motivation, targetType, and color (while allowing items without highlightColor)', async () => {
    const mod = await loadModule();
    const { tableBody } = setupDom();

    window.data = {
      annotations: [
        makeAnnotation({ id: 1, motivation: 'highlighting', targetType: 'ocr', highlightColor: 'yellow', target: { selector: [{ blockIndex: 1, exact: 'H-ocr-yellow' }] } }),
        makeAnnotation({ id: 2, motivation: 'commenting', targetType: 'ocr', highlightColor: 'pink', body: [{ value: 'note-ocr-pink' }], target: { selector: [{ blockIndex: 2, exact: 'C-ocr-pink' }] } }),
        makeAnnotation({ id: 3, motivation: 'commenting', targetType: 'translation', highlightColor: 'yellow', body: [{ value: 'note-tr-yellow' }], target: { selector: [{ blockIndex: 3, exact: 'C-tr-yellow' }] } }),
        makeAnnotation({ id: 4, motivation: 'commenting', targetType: 'ocr', highlightColor: null, body: [{ value: 'note-ocr-no-color' }], target: { selector: [{ blockIndex: 4, exact: 'C-ocr-no-color' }] } }),
      ],
    };

    mod.populateAnnotationsSummaryTable('commenting', 'ocr', ['yellow']);

    const itemRows = Array.from(tableBody.querySelectorAll('tr')).slice(1);
    expect(itemRows.length).toBe(1);
    expect(itemRows[0].cells[4].textContent).toBe('note-ocr-no-color');
  });

  it('sorts OCR items before non-OCR and orders by blockIndex within a targetType', async () => {
    const mod = await loadModule();
    const { tableBody } = setupDom();

    window.data = {
      annotations: [
        makeAnnotation({ id: 1, targetType: 'translation', highlightColor: 'yellow', target: { selector: [{ blockIndex: 1, exact: 'T1' }] } }),
        makeAnnotation({ id: 2, targetType: 'ocr', highlightColor: 'yellow', target: { selector: [{ blockIndex: 2, exact: 'O2' }] } }),
        makeAnnotation({ id: 3, targetType: 'ocr', highlightColor: 'yellow', target: { selector: [{ blockIndex: 1, exact: 'O1' }] } }),
      ],
    };

    mod.populateAnnotationsSummaryTable();

    const rows = Array.from(tableBody.querySelectorAll('tr')).slice(1); // skip "未分组" header
    expect(rows[0].cells[1].textContent).toBe('OCR');
    expect(rows[0].cells[2].textContent).toContain('块: 1');
    expect(rows[1].cells[2].textContent).toContain('块: 2');
    expect(rows[2].cells[1].textContent).toBe('TRANSLATION');
  });

  it('groups annotations by TOC and avoids XSS by using textContent for group headers', async () => {
    const mod = await loadModule();
    const { tableBody } = setupDom();

    window.getCurrentTocStructure = () => ({
      children: [
        {
          text: 'Chapter <img src=x onerror="alert(1)">',
          startBlockIndex: 0,
          endBlockIndex: 5,
          children: [
            {
              text: 'Section B',
              startBlockIndex: 2,
              endBlockIndex: 2,
              children: [],
            },
          ],
        },
      ],
    });

    window.data = {
      annotations: [
        makeAnnotation({ id: 1, targetType: 'ocr', highlightColor: 'yellow', target: { selector: [{ blockIndex: 2, exact: 'In TOC' }] } }),
        makeAnnotation({ id: 2, targetType: 'ocr', highlightColor: 'yellow', target: { selector: [{ blockIndex: 99, exact: 'Out of TOC' }] } }),
      ],
    };

    mod.populateAnnotationsSummaryTable();

    const groupHeader = Array.from(tableBody.querySelectorAll('tr.toc-group td'))
      .map((td) => td.textContent)
      .find((t) => t.includes('Chapter <img src=x'));
    expect(groupHeader).toContain('Chapter <img src=x');
    expect(tableBody.querySelector('img')).toBeNull();

    const ungroupedHeader = Array.from(tableBody.querySelectorAll('tr.toc-group td'))
      .map((td) => td.textContent)
      .find((t) => t.includes('未分组'));
    expect(ungroupedHeader).toContain('未分组');
  });

  it('uses raw markdown for snippet when available and truncates long previews with a title', async () => {
    const mod = await loadModule();
    const { tableBody } = setupDom();

    const longRaw = 'x'.repeat(200);
    window.currentBlockTokensForCopy = {
      ocr: {
        1: { raw: longRaw },
      },
    };

    window.data = {
      annotations: [
        makeAnnotation({ id: 1, targetType: 'ocr', highlightColor: 'yellow', target: { selector: [{ blockIndex: 1, exact: 'exact-fallback' }] } }),
      ],
    };

    mod.populateAnnotationsSummaryTable();

    const itemRow = tableBody.querySelectorAll('tr')[1];
    const snippetCell = itemRow.cells[3];
    expect(snippetCell.textContent).toBe(`${longRaw.slice(0, 150)}...`);
    expect(snippetCell.title).toBe(longRaw);
  });

  it('opens and closes the full-text dialog from the snippet cell (button and outside click)', async () => {
    const mod = await loadModule();
    const { tableBody } = setupDom();

    const snippet = 'This is a long-ish snippet that should open a dialog when clicked.';
    window.data = {
      annotations: [
        makeAnnotation({ id: 1, targetType: 'ocr', highlightColor: 'yellow', target: { selector: [{ blockIndex: 1, exact: snippet }] } }),
      ],
    };

    mod.populateAnnotationsSummaryTable();

    const itemRow = tableBody.querySelectorAll('tr')[1];
    const snippetCell = itemRow.cells[3];
    snippetCell.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    let dialog = document.querySelector('.full-text-dialog');
    expect(dialog).not.toBeNull();
    expect(dialog.querySelector('pre')?.textContent).toBe(snippet);

    const closeBtn = dialog.querySelector('button');
    closeBtn.click();
    dialog = document.querySelector('.full-text-dialog');
    expect(dialog).toBeNull();

    // Re-open and close via outside click.
    snippetCell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    dialog = document.querySelector('.full-text-dialog');
    expect(dialog).not.toBeNull();

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('.full-text-dialog')).toBeNull();
  });

  it('supports editing notes and handles validation + persistence errors', async () => {
    const mod = await loadModule();
    const { tableBody } = setupDom();

    const annotation = makeAnnotation({
      id: 1,
      motivation: 'commenting',
      highlightColor: 'yellow',
      body: [{ value: 'existing note' }],
      target: { selector: [{ blockIndex: 1, exact: 'A' }] },
    });
    window.data = { annotations: [annotation] };

    mod.populateAnnotationsSummaryTable();

    const itemRow = tableBody.querySelectorAll('tr')[1];
    const noteCell = itemRow.cells[4];
    expect(noteCell.textContent).toBe('existing note');

    // Clearing an existing note should show validation error.
    noteCell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const textarea = noteCell.querySelector('textarea');
    textarea.value = '   ';
    textarea.dispatchEvent(new Event('blur'));

    expect(noteCell.textContent).toContain('内容不能为空');
    vi.advanceTimersByTime(1200);
    expect(noteCell.textContent).toBe('existing note');

    // Now try saving with missing updateAnnotationInDB -> should fail and revert.
    noteCell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const textarea2 = noteCell.querySelector('textarea');
    textarea2.value = 'updated note';
    textarea2.dispatchEvent(new Event('blur'));

    await flushPromises();
    expect(noteCell.textContent).toContain('[保存失败]');
    vi.advanceTimersByTime(1500);
    expect(noteCell.textContent).toBe('existing note');
  });

  it('persists note edits via updateAnnotationInDB and refreshes the table', async () => {
    const mod = await loadModule();
    const { tableBody } = setupDom();

    const annotation = makeAnnotation({
      id: 1,
      motivation: 'highlighting',
      highlightColor: 'yellow',
      body: [],
      target: { selector: [{ blockIndex: 1, exact: 'A' }] },
    });
    window.data = { annotations: [annotation] };

    globalThis.updateAnnotationInDB = vi.fn(async () => {});

    mod.populateAnnotationsSummaryTable();
    let itemRow = tableBody.querySelectorAll('tr')[1];
    let noteCell = itemRow.cells[4];

    expect(noteCell.textContent).toContain('点击添加批注');

    noteCell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const textarea = noteCell.querySelector('textarea');
    textarea.value = 'new note';
    textarea.dispatchEvent(new Event('blur'));

    await flushPromises();

    expect(globalThis.updateAnnotationInDB).toHaveBeenCalledTimes(1);
    expect(window.data.annotations[0].motivation).toBe('commenting');
    expect(window.data.annotations[0].body?.[0]?.value).toBe('new note');

    itemRow = tableBody.querySelectorAll('tr')[1];
    noteCell = itemRow.cells[4];
    expect(itemRow.cells[0].textContent).toBe('批注');
    expect(noteCell.textContent).toBe('new note');
  });

  it('supports editing highlight colors and handles persistence errors', async () => {
    const mod = await loadModule();
    const { tableBody } = setupDom();

    const annotation = makeAnnotation({
      id: 1,
      motivation: 'highlighting',
      highlightColor: 'yellow',
      target: { selector: [{ blockIndex: 1, exact: 'A' }] },
    });
    window.data = { annotations: [annotation] };

    mod.populateAnnotationsSummaryTable();

    const itemRow = tableBody.querySelectorAll('tr')[1];
    const colorCell = itemRow.cells[5];
    const swatch = colorCell.querySelector('span.color-swatch');
    expect(swatch).not.toBeNull();

    swatch.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const select = colorCell.querySelector('select');
    expect(select).not.toBeNull();

    select.value = 'pink';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    await flushPromises();
    expect(colorCell.textContent).toContain('[保存失败]');

    vi.advanceTimersByTime(1500);
    expect(colorCell.querySelector('span.color-swatch')).not.toBeNull();
  });

  it('persists highlight color edits via updateAnnotationInDB and refreshes the table', async () => {
    const mod = await loadModule();
    const { modal, tableBody } = setupDom();

    const annotation = makeAnnotation({
      id: 1,
      motivation: 'commenting',
      highlightColor: 'yellow',
      body: [{ value: 'note' }],
      target: { selector: [{ blockIndex: 1, exact: 'A' }] },
    });
    window.data = { annotations: [annotation] };

    globalThis.updateAnnotationInDB = vi.fn(async () => {});

    // In real usage, the table lives inside a visible modal; polling runs only when visible.
    modal.classList.add('visible');
    mod.populateAnnotationsSummaryTable();

    const itemRow = tableBody.querySelectorAll('tr')[1];
    const colorCell = itemRow.cells[5];
    const swatch = colorCell.querySelector('span.color-swatch');

    swatch.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const select = colorCell.querySelector('select');
    select.value = 'pink';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    await flushPromises();

    expect(globalThis.updateAnnotationInDB).toHaveBeenCalledTimes(1);
    expect(window.data.annotations[0].highlightColor).toBe('pink');

    // Changing to a previously unseen color can temporarily filter the row out; polling
    // detects the new color and auto-selects it when the modal is visible.
    vi.advanceTimersByTime(1000);
    await flushPromises();

    const refreshedRow = tableBody.querySelectorAll('tr')[1];
    const refreshedSwatch = refreshedRow.cells[5].querySelector('span.color-swatch');
    expect(refreshedSwatch).not.toBeNull();
    expect(mockedGetHighlightColor).toHaveBeenCalledWith('pink');
  });

  it('jump action switches tabs and prefers scrollToAnnotationAsync when available', async () => {
    const mod = await loadModule();
    const { modal, tableBody } = setupDom({ includeContentWrappers: true });

    window.data = {
      annotations: [
        makeAnnotation({
          id: 'ann-1',
          targetType: 'ocr',
          motivation: 'highlighting',
          highlightColor: 'yellow',
          target: { selector: [{ subBlockId: '1.1', exact: 'A' }] },
        }),
      ],
    };

    window.currentVisibleTabId = 'translation';
    globalThis.showTab = vi.fn(async () => {});
    window.scrollToAnnotationAsync = vi.fn(async () => true);

    modal.classList.add('visible');
    mod.populateAnnotationsSummaryTable();

    const jumpButton = tableBody.querySelector('button.action-btn');
    expect(jumpButton).not.toBeNull();

    const clickPromise = jumpButton.onclick();
    await flushPromises(); // allow showTab() await to schedule the post-switch timeout
    vi.advanceTimersByTime(250);
    await clickPromise;

    expect(modal.classList.contains('visible')).toBe(false);
    expect(globalThis.showTab).toHaveBeenCalledWith('ocr');
    expect(window.scrollToAnnotationAsync).toHaveBeenCalledWith(
      'ann-1',
      expect.objectContaining({ targetType: 'ocr', subBlockId: '1.1' }),
    );
  });

  it('jump action falls back to DOM lookup and toggles the jump effect class', async () => {
    const mod = await loadModule();
    const { modal, tableBody, ocrWrapper } = setupDom({ includeContentWrappers: true });

    const sb = document.createElement('span');
    sb.className = 'sub-block';
    sb.dataset.subBlockId = '1.1';
    sb.textContent = 'Target';
    ocrWrapper.appendChild(sb);

    window.data = {
      annotations: [
        makeAnnotation({
          id: 'ann-1',
          targetType: 'ocr',
          motivation: 'highlighting',
          highlightColor: 'yellow',
          target: { selector: [{ subBlockId: '1.1', exact: 'A' }] },
        }),
      ],
    };

    window.currentVisibleTabId = 'ocr';

    modal.classList.add('visible');
    mod.populateAnnotationsSummaryTable();

    const jumpButton = tableBody.querySelector('button.action-btn');
    await jumpButton.onclick();

    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(sb.classList.contains('jump-to-highlight-effect')).toBe(true);

    vi.advanceTimersByTime(2500);
    expect(sb.classList.contains('jump-to-highlight-effect')).toBe(false);
  });

  it('disables jump buttons in chunk-compare mode', async () => {
    const mod = await loadModule();
    const { tableBody } = setupDom();

    window.currentVisibleTabId = 'chunk-compare';
    window.data = { annotations: [makeAnnotation({ id: 'ann-1', targetType: 'ocr', target: { selector: [{ blockIndex: 1, exact: 'A' }] } })] };

    mod.populateAnnotationsSummaryTable();
    const jumpButton = tableBody.querySelector('button.action-btn');
    expect(jumpButton.disabled).toBe(true);
    expect(jumpButton.title).toContain('分块对比模式下禁用跳转');
  });

  it('polling detects new colors when modal is visible and document is not hidden', async () => {
    const mod = await loadModule();
    const { modal, colorFilter } = setupDom();

    window.data = {
      annotations: [
        makeAnnotation({ id: 1, highlightColor: 'yellow', target: { selector: [{ blockIndex: 1, exact: 'A' }] } }),
      ],
    };

    modal.classList.add('visible');
    mod.populateAnnotationsSummaryTable();

    expect(colorFilter.querySelector('input[type="checkbox"][value="yellow"]')?.checked).toBe(true);
    expect(colorFilter.querySelector('input[type="checkbox"][value="pink"]')).toBeNull();

    // A new highlight color appears in the underlying data.
    window.data.annotations.push(
      makeAnnotation({ id: 2, highlightColor: 'pink', target: { selector: [{ blockIndex: 2, exact: 'B' }] } }),
    );

    vi.advanceTimersByTime(1000);
    await flushPromises();

    const pinkCheckbox = colorFilter.querySelector('input[type="checkbox"][value="pink"]');
    expect(pinkCheckbox).not.toBeNull();
    expect(pinkCheckbox.checked).toBe(true);
  });
});
