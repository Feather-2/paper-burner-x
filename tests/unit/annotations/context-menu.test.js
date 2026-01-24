// @vitest-environment jsdom
/**
 * @file tests/unit/annotations/context-menu.test.js
 * @description Unit tests for js/annotations/context-menu.js
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as contextMenu from '../../../js/annotations/context-menu.js';

const {
  setAnnotationContextMenuElement,
  getAnnotationContextMenuElement,
  updateContextMenuOptions,
  showContextMenu,
  hideContextMenu,
  updateCrossBlockContextMenuOptions,
} = contextMenu;

function buildMenuDOM({ highlightAction = 'highlight-block', includeAllIds = true } = {}) {
  const menu = document.createElement('div');
  menu.id = 'annotation-context-menu';
  menu.className = 'context-menu-hidden';

  const highlightOption = document.createElement('button');
  highlightOption.type = 'button';
  highlightOption.dataset.action = highlightAction;
  highlightOption.textContent = 'initial-highlight';
  menu.appendChild(highlightOption);

  const createdById = {};
  if (includeAllIds) {
    for (const id of [
      'remove-highlight-option',
      'add-note-option',
      'edit-note-option',
      'copy-content-option',
      'highlight-actions-divider',
      'note-actions-divider',
    ]) {
      const el = document.createElement('div');
      el.id = id;
      el.textContent = `initial-${id}`;
      menu.appendChild(el);
      createdById[id] = el;
    }
  }

  document.body.appendChild(menu);

  return {
    menu,
    highlightOption,
    ...createdById,
  };
}

function mockSelection({
  rangeCount = 1,
  collapsed = false,
  throwsOnGetSelection = false,
  throwsOnGetRangeAt = false,
} = {}) {
  return vi.spyOn(window, 'getSelection').mockImplementation(() => {
    if (throwsOnGetSelection) throw new Error('getSelection failed');
    return {
      rangeCount,
      getRangeAt() {
        if (throwsOnGetRangeAt) throw new Error('getRangeAt failed');
        return { collapsed };
      },
    };
  });
}

beforeEach(() => {
  document.body.innerHTML = '';

  // Ensure state from other tests doesn’t leak.
  setAnnotationContextMenuElement(null);
  delete window.globalCurrentSelection;
  delete window.globalCurrentHighlightStatus;
});

afterEach(() => {
  setAnnotationContextMenuElement(null);
  vi.restoreAllMocks();
});

describe('js/annotations/context-menu.js exports', () => {
  it('should export the documented public API', () => {
    expect(typeof setAnnotationContextMenuElement).toBe('function');
    expect(typeof getAnnotationContextMenuElement).toBe('function');
    expect(typeof updateContextMenuOptions).toBe('function');
    expect(typeof showContextMenu).toBe('function');
    expect(typeof hideContextMenu).toBe('function');
    expect(typeof updateCrossBlockContextMenuOptions).toBe('function');
  });
});

describe('setAnnotationContextMenuElement / getAnnotationContextMenuElement', () => {
  it('should store and return the configured context menu element', () => {
    const { menu } = buildMenuDOM({ includeAllIds: false });
    setAnnotationContextMenuElement(menu);
    expect(getAnnotationContextMenuElement()).toBe(menu);
  });

  it('should allow setting null (clearing the stored element)', () => {
    const { menu } = buildMenuDOM({ includeAllIds: false });
    setAnnotationContextMenuElement(menu);
    expect(getAnnotationContextMenuElement()).toBe(menu);
    setAnnotationContextMenuElement(null);
    expect(getAnnotationContextMenuElement()).toBe(null);
  });
});

describe('showContextMenu', () => {
  it('should be a no-op when the context menu element is not set', () => {
    setAnnotationContextMenuElement(null);
    expect(() => showContextMenu(10, 20)).not.toThrow();
  });

  it('should position the menu and toggle visibility classes', () => {
    const { menu } = buildMenuDOM({ includeAllIds: false });
    setAnnotationContextMenuElement(menu);

    showContextMenu(123, 456);

    expect(menu.style.left).toBe('123px');
    expect(menu.style.top).toBe('456px');
    expect(menu.classList.contains('context-menu-hidden')).toBe(false);
    expect(menu.classList.contains('context-menu-visible')).toBe(true);
  });
});

describe('hideContextMenu', () => {
  it('should be a no-op when the context menu element is not set', () => {
    setAnnotationContextMenuElement(null);
    expect(() => hideContextMenu()).not.toThrow();
  });

  it('should hide the menu and reset global selection/highlight status', () => {
    const { menu } = buildMenuDOM({ includeAllIds: false });
    menu.classList.add('context-menu-visible');
    setAnnotationContextMenuElement(menu);

    window.globalCurrentSelection = { text: 'abc' };
    window.globalCurrentHighlightStatus = true;

    hideContextMenu();

    expect(menu.classList.contains('context-menu-visible')).toBe(false);
    expect(menu.classList.contains('context-menu-hidden')).toBe(true);

    expect(window.globalCurrentSelection).toBe(null);
    expect(window.globalCurrentHighlightStatus).toBe(false);
  });
});

describe('updateContextMenuOptions', () => {
  it('should be a no-op when the context menu element is not set', () => {
    const selSpy = mockSelection({ rangeCount: 1, collapsed: false });
    setAnnotationContextMenuElement(null);
    expect(() => updateContextMenuOptions(false, false, false)).not.toThrow();
    expect(selSpy).not.toHaveBeenCalled();
  });

  it('should hide all options/dividers in read-only mode and avoid querying selection', () => {
    const {
      menu,
      highlightOption,
      ['remove-highlight-option']: removeHighlightOption,
      ['add-note-option']: addNoteOption,
      ['edit-note-option']: editNoteOption,
      ['copy-content-option']: copyContentOption,
      ['highlight-actions-divider']: highlightActionsDivider,
      ['note-actions-divider']: noteActionsDivider,
    } = buildMenuDOM();

    setAnnotationContextMenuElement(menu);

    const selSpy = mockSelection({ rangeCount: 1, collapsed: false });

    updateContextMenuOptions(true, true, true);

    expect(selSpy).not.toHaveBeenCalled();
    expect(highlightOption.style.display).toBe('none');
    expect(removeHighlightOption.style.display).toBe('none');
    expect(addNoteOption.style.display).toBe('none');
    expect(editNoteOption.style.display).toBe('none');
    expect(copyContentOption.style.display).toBe('none');
    expect(highlightActionsDivider.style.display).toBe('none');
    expect(noteActionsDivider.style.display).toBe('none');
  });

  it('should show highlight/copy options when there is a non-collapsed selection (not highlighted)', () => {
    const {
      menu,
      highlightOption,
      ['remove-highlight-option']: removeHighlightOption,
      ['add-note-option']: addNoteOption,
      ['edit-note-option']: editNoteOption,
      ['copy-content-option']: copyContentOption,
      ['highlight-actions-divider']: highlightActionsDivider,
      ['note-actions-divider']: noteActionsDivider,
    } = buildMenuDOM();

    setAnnotationContextMenuElement(menu);
    mockSelection({ rangeCount: 1, collapsed: false });

    updateContextMenuOptions(false, false, false);

    expect(highlightOption.style.display).toBe('block');
    expect(highlightOption.textContent).toBe('高亮选中内容');
    expect(copyContentOption.style.display).toBe('block');

    expect(removeHighlightOption.style.display).toBe('none');
    expect(addNoteOption.style.display).toBe('none');
    expect(editNoteOption.style.display).toBe('none');
    expect(highlightActionsDivider.style.display).toBe('none');
    expect(noteActionsDivider.style.display).toBe('none');
  });

  it('should hide highlight/copy options when the selection is collapsed (caret-only)', () => {
    const { menu, highlightOption, ['copy-content-option']: copyContentOption } = buildMenuDOM();
    setAnnotationContextMenuElement(menu);

    mockSelection({ rangeCount: 1, collapsed: true });
    updateContextMenuOptions(false, false, false);

    expect(highlightOption.style.display).toBe('none');
    expect(copyContentOption.style.display).toBe('none');
  });

  it('should show remove-highlight and add-note when highlighted and there is no note', () => {
    const {
      menu,
      ['remove-highlight-option']: removeHighlightOption,
      ['add-note-option']: addNoteOption,
      ['edit-note-option']: editNoteOption,
      ['highlight-actions-divider']: highlightActionsDivider,
      ['note-actions-divider']: noteActionsDivider,
    } = buildMenuDOM();

    setAnnotationContextMenuElement(menu);
    mockSelection({ rangeCount: 1, collapsed: false });

    updateContextMenuOptions(true, false, false);

    expect(removeHighlightOption.style.display).toBe('block');
    expect(addNoteOption.style.display).toBe('block');
    expect(editNoteOption.style.display).toBe('none');

    expect(highlightActionsDivider.style.display).toBe('block');
    expect(noteActionsDivider.style.display).toBe('block');
  });

  it('should show edit-note when highlighted and there is an existing note', () => {
    const {
      menu,
      ['add-note-option']: addNoteOption,
      ['edit-note-option']: editNoteOption,
      ['note-actions-divider']: noteActionsDivider,
    } = buildMenuDOM();

    setAnnotationContextMenuElement(menu);
    mockSelection({ rangeCount: 1, collapsed: false });

    updateContextMenuOptions(true, true, false);

    expect(addNoteOption.style.display).toBe('none');
    expect(editNoteOption.style.display).toBe('block');
    expect(noteActionsDivider.style.display).toBe('block');
  });

  it('should hide note divider when highlighted but note action elements are missing', () => {
    const { menu, ['note-actions-divider']: noteActionsDivider } = buildMenuDOM();
    // Remove note action elements from DOM; divider still exists.
    document.getElementById('add-note-option')?.remove();
    document.getElementById('edit-note-option')?.remove();

    setAnnotationContextMenuElement(menu);
    mockSelection({ rangeCount: 1, collapsed: false });

    updateContextMenuOptions(true, false, false);

    expect(noteActionsDivider.style.display).toBe('none');
  });

  it('should fall back to [data-action=\"highlight-paragraph\"] when [data-action=\"highlight-block\"] is missing', () => {
    const { menu, highlightOption } = buildMenuDOM({ highlightAction: 'highlight-paragraph' });
    setAnnotationContextMenuElement(menu);
    mockSelection({ rangeCount: 1, collapsed: false });

    updateContextMenuOptions(false, false, false);

    expect(highlightOption.dataset.action).toBe('highlight-paragraph');
    expect(highlightOption.style.display).toBe('block');
    expect(highlightOption.textContent).toBe('高亮选中内容');
  });

  it('should not throw when getSelection throws during canHighlight computation and copy option is absent', () => {
    const menu = {
      querySelector: vi.fn(() => ({
        style: {},
        set textContent(_) {
          // No-op
        },
      })),
    };
    setAnnotationContextMenuElement(menu);

    vi.spyOn(window, 'getSelection').mockImplementation(() => {
      throw new Error('getSelection failed');
    });

    expect(() => updateContextMenuOptions(false, false, false)).not.toThrow();
  });

  it('should throw when getSelection throws during copy-content visibility computation', () => {
    const { menu } = buildMenuDOM();
    setAnnotationContextMenuElement(menu);

    vi.spyOn(window, 'getSelection').mockImplementation(() => {
      throw new Error('getSelection failed');
    });

    expect(() => updateContextMenuOptions(false, false, false)).toThrow('getSelection failed');
  });

  it('should swallow errors when setting highlight option textContent fails', () => {
    const highlightOption = { style: {} };
    Object.defineProperty(highlightOption, 'textContent', {
      configurable: true,
      set() {
        throw new Error('textContent is read-only');
      },
    });

    const menu = {
      querySelector: vi.fn(() => highlightOption),
    };
    setAnnotationContextMenuElement(menu);

    mockSelection({ rangeCount: 1, collapsed: false });

    expect(() => updateContextMenuOptions(false, false, false)).not.toThrow();
    expect(highlightOption.style.display).toBe('block');
  });
});

describe('updateCrossBlockContextMenuOptions', () => {
  it('should be a no-op when the context menu element is not set', () => {
    setAnnotationContextMenuElement(null);
    expect(() => updateCrossBlockContextMenuOptions(false, false)).not.toThrow();
  });

  it('should show cross-block highlight option and inject color submenu when not highlighted', () => {
    const {
      menu,
      highlightOption,
      ['remove-highlight-option']: removeHighlightOption,
      ['add-note-option']: addNoteOption,
      ['edit-note-option']: editNoteOption,
      ['copy-content-option']: copyContentOption,
    } = buildMenuDOM({ highlightAction: 'highlight-block' });

    setAnnotationContextMenuElement(menu);

    updateCrossBlockContextMenuOptions(false, false);

    expect(highlightOption.textContent).toBe('高亮选中区域');
    expect(highlightOption.style.display).toBe('block');

    const submenu = highlightOption.querySelector('.color-submenu');
    expect(submenu).not.toBeNull();
    const colorOptions = highlightOption.querySelectorAll('.color-option');
    expect(colorOptions.length).toBe(5);

    const colors = Array.from(colorOptions).map((el) => el.dataset.color);
    expect(colors).toEqual(['yellow', 'green', 'pink', 'blue', 'orange']);

    // Hover behavior should apply expected style changes.
    const first = colorOptions[0];
    first.dispatchEvent(new Event('mouseenter'));
    expect(first.style.transform).toBe('scale(1.1)');
    expect(first.style.borderColor).toMatch(/(#333|rgb\\(51,\\s*51,\\s*51\\))/);
    first.dispatchEvent(new Event('mouseleave'));
    expect(first.style.transform).toBe('scale(1)');
    expect(first.style.borderColor).toMatch(/(#ccc|rgb\\(204,\\s*204,\\s*204\\))/);

    expect(removeHighlightOption.textContent).toBe('移除选中区域高亮');
    expect(removeHighlightOption.style.display).toBe('none');
    expect(copyContentOption.style.display).toBe('block');

    // Not highlighted => note options hidden.
    expect(addNoteOption.style.display).toBe('none');
    expect(editNoteOption.style.display).toBe('none');
  });

  it('should remove existing cross-block color options before adding new ones', () => {
    const { menu, highlightOption } = buildMenuDOM({ highlightAction: 'highlight-block' });
    setAnnotationContextMenuElement(menu);

    updateCrossBlockContextMenuOptions(false, false);
    expect(highlightOption.querySelectorAll('.color-option').length).toBe(5);

    // Call again; previous .color-option nodes should be removed before adding again.
    updateCrossBlockContextMenuOptions(false, false);
    expect(highlightOption.querySelectorAll('.color-option').length).toBe(5);
  });

  it('should hide highlight option and show remove-highlight + add-note when highlighted without a note', () => {
    const {
      menu,
      highlightOption,
      ['remove-highlight-option']: removeHighlightOption,
      ['add-note-option']: addNoteOption,
      ['edit-note-option']: editNoteOption,
      ['copy-content-option']: copyContentOption,
    } = buildMenuDOM({ highlightAction: 'highlight-block' });

    setAnnotationContextMenuElement(menu);
    updateCrossBlockContextMenuOptions(true, false);

    expect(highlightOption.style.display).toBe('none');
    expect(removeHighlightOption.style.display).toBe('block');
    expect(removeHighlightOption.textContent).toBe('移除选中区域高亮');

    expect(copyContentOption.style.display).toBe('block');

    expect(addNoteOption.textContent).toBe('为选中区域添加批注');
    expect(addNoteOption.style.display).toBe('block');
    expect(editNoteOption.style.display).toBe('none');
  });

  it('should show edit-note when highlighted with an existing note', () => {
    const {
      menu,
      ['add-note-option']: addNoteOption,
      ['edit-note-option']: editNoteOption,
    } = buildMenuDOM({ highlightAction: 'highlight-block' });

    setAnnotationContextMenuElement(menu);
    updateCrossBlockContextMenuOptions(true, true);

    expect(addNoteOption.style.display).toBe('none');
    expect(editNoteOption.textContent).toBe('编辑选中区域批注');
    expect(editNoteOption.style.display).toBe('block');
  });

  it('should not throw if some DOM options are missing', () => {
    const { menu } = buildMenuDOM({ highlightAction: 'highlight-block' });
    // Remove some ids from DOM to simulate partial menus.
    document.getElementById('remove-highlight-option')?.remove();
    document.getElementById('add-note-option')?.remove();
    document.getElementById('edit-note-option')?.remove();
    document.getElementById('copy-content-option')?.remove();

    setAnnotationContextMenuElement(menu);
    expect(() => updateCrossBlockContextMenuOptions(false, false)).not.toThrow();
    expect(() => updateCrossBlockContextMenuOptions(true, true)).not.toThrow();
  });
});

