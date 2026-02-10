import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockedRefinerTools = vi.hoisted(() => ({
  parseSections: vi.fn(),
  joinSections: vi.fn(),
}));

const mockedDesignUtils = vi.hoisted(() => ({
  isPlainObject: vi.fn(),
}));

vi.mock('../../../../../../js/agents/stages/design/refiner/react-refiner-tools.js', () => ({
  parseSections: mockedRefinerTools.parseSections,
  joinSections: mockedRefinerTools.joinSections,
}));

vi.mock('../../../../../../js/agents/stages/design/shared/design-utils.js', () => ({
  isPlainObject: mockedDesignUtils.isPlainObject,
}));

const modulePath = '../../../../../../js/agents/stages/design/internal/deck-editor.js';

function parseSectionsImpl(deckHtmlDsl) {
  const html = typeof deckHtmlDsl === 'string' ? deckHtmlDsl : '';
  if (!html) return [];

  const lower = html.toLowerCase();
  const sections = [];
  let cursor = 0;
  while (cursor < html.length) {
    const start = lower.indexOf('<section', cursor);
    if (start < 0) break;
    const endTag = lower.indexOf('</section>', start);
    if (endTag < 0) break;
    const end = endTag + '</section>'.length;
    const sectionHtml = html.slice(start, end).trim();
    if (sectionHtml) sections.push(sectionHtml);
    cursor = end;
  }
  return sections;
}

function joinSectionsImpl(sections) {
  const parts = Array.isArray(sections) ? sections : [];
  return parts
    .map((section) => (typeof section === 'string' ? section.trim() : ''))
    .filter(Boolean)
    .join('\n\n');
}

function isPlainObjectImpl(value) {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}

async function loadModule() {
  return await import(modulePath);
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  mockedRefinerTools.parseSections.mockImplementation(parseSectionsImpl);
  mockedRefinerTools.joinSections.mockImplementation(joinSectionsImpl);
  mockedDesignUtils.isPlainObject.mockImplementation(isPlainObjectImpl);
});

describe("EDITOR_CONFIG", () => {
  it('exposes the default maxHistoryLength', async () => {
    const { EDITOR_CONFIG } = await loadModule();
    expect(EDITOR_CONFIG).toEqual({ maxHistoryLength: 50 });
    expect(EDITOR_CONFIG.maxHistoryLength).toBe(50);
  });
});

describe("DeckEditor", () => {
  it('initializes with defaults and empty history snapshot', async () => {
    const { DeckEditor } = await loadModule();
    const editor = new DeckEditor();

    expect(editor.getDeckHtmlDsl()).toBe('');

    const history = editor.getHistory();
    expect(history.entries).toEqual([]);
    expect(history.currentIndex).toBe(-1);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty object', {}],
  ])('setDeckPackage accepts %s and getDeckHtmlDsl falls back to empty string', async (_label, deckPackage) => {
    const { DeckEditor } = await loadModule();
    const editor = new DeckEditor({ deckPackage: { deckHtmlDsl: '<section>one</section>' } });
    editor.setDeckPackage(deckPackage);
    expect(editor.getDeckHtmlDsl()).toBe('');
  });

  it('getDeckHtmlDsl preserves whitespace strings', async () => {
    const { DeckEditor } = await loadModule();
    const editor = new DeckEditor({ deckPackage: { deckHtmlDsl: '   ' } });
    expect(editor.getDeckHtmlDsl()).toBe('   ');
  });

  it('editElement delegates to toolExecutor and records history on success', async () => {
    const { DeckEditor } = await loadModule();
    const toolExecutor = vi.fn().mockResolvedValue({
      success: true,
      data: { deckPackage: { deckHtmlDsl: '<section>updated</section>' } },
    });
    const editor = new DeckEditor({
      deckPackage: { deckHtmlDsl: '<section>old</section>' },
      toolExecutor,
    });

    const result = await editor.editElement(0, 'el1', { text: 'ok' });

    expect(result.success).toBe(true);
    expect(toolExecutor).toHaveBeenCalledWith('editElement', {
      slideIndex: 0,
      elementId: 'el1',
      changes: { text: 'ok' },
    });
    expect(editor.getDeckHtmlDsl()).toBe('<section>updated</section>');
    expect(mockedRefinerTools.parseSections).not.toHaveBeenCalled();
    expect(mockedRefinerTools.joinSections).not.toHaveBeenCalled();

    const history = editor.getHistory();
    expect(history.entries).toHaveLength(1);
    expect(history.entries[0].action).toBe('editElement');
    expect(history.entries[0].params).toEqual({
      slideIndex: 0,
      elementId: 'el1',
      changes: { text: 'ok' },
    });
    expect(history.entries[0].prevDeckHtmlDsl).toBe('<section>old</section>');
    expect(history.entries[0].nextDeckHtmlDsl).toBe('<section>updated</section>');
    expect(typeof history.entries[0].timestamp).toBe('number');
  });

  it('editSlide delegates to toolExecutor and records history on success', async () => {
    const { DeckEditor } = await loadModule();
    const toolExecutor = vi.fn().mockResolvedValue({
      success: true,
      data: { deckPackage: { deckHtmlDsl: '<section>slide-updated</section>' } },
    });
    const editor = new DeckEditor({
      deckPackage: { deckHtmlDsl: '<section>slide-old</section>' },
      toolExecutor,
    });

    const result = await editor.editSlide(0, { html: '<section>ignored-in-executor</section>' });

    expect(result.success).toBe(true);
    expect(toolExecutor).toHaveBeenCalledWith('editSlide', {
      slideIndex: 0,
      changes: { html: '<section>ignored-in-executor</section>' },
    });
    expect(editor.getDeckHtmlDsl()).toBe('<section>slide-updated</section>');
    expect(editor.getHistory().entries).toHaveLength(1);
    expect(editor.getHistory().entries[0].action).toBe('editSlide');
  });

  it('does not mutate state or history when toolExecutor returns failure', async () => {
    const { DeckEditor } = await loadModule();
    const toolExecutor = vi.fn().mockResolvedValue({ success: false, error: 'nope' });
    const editor = new DeckEditor({
      deckPackage: { deckHtmlDsl: '<section>old</section>' },
      toolExecutor,
    });

    const elementResult = await editor.editElement(0, 'el1', { text: 'x' });
    const slideResult = await editor.editSlide(0, { html: '<section>x</section>' });

    expect(elementResult.success).toBe(false);
    expect(slideResult.success).toBe(false);
    expect(editor.getDeckHtmlDsl()).toBe('<section>old</section>');
    expect(editor.getHistory().entries).toHaveLength(0);
  });

  it('handles concurrent toolExecutor edits with out-of-order resolution', async () => {
    const { DeckEditor } = await loadModule();

    const deferred = [];
    const toolExecutor = vi.fn(() => {
      let resolve;
      const promise = new Promise((innerResolve) => {
        resolve = innerResolve;
      });
      deferred.push(resolve);
      return promise;
    });

    const editor = new DeckEditor({ deckPackage: { deckHtmlDsl: '<section>start</section>' }, toolExecutor });

    const first = editor.editElement(0, 'el1', { text: 'first' });
    const second = editor.editElement(0, 'el2', { text: 'second' });

    // Resolve second first to simulate race conditions.
    deferred[1]({ success: true, data: { deckPackage: { deckHtmlDsl: '<section>second</section>' } } });
    const secondResult = await second;
    expect(secondResult.success).toBe(true);
    expect(editor.getDeckHtmlDsl()).toBe('<section>second</section>');

    deferred[0]({ success: true, data: { deckPackage: { deckHtmlDsl: '<section>first</section>' } } });
    const firstResult = await first;
    expect(firstResult.success).toBe(true);

    // Last resolved wins (even if it was called first).
    expect(editor.getDeckHtmlDsl()).toBe('<section>first</section>');

    const history = editor.getHistory();
    expect(history.entries).toHaveLength(2);
    expect(history.entries[0].params.elementId).toBe('el2');
    expect(history.entries[1].params.elementId).toBe('el1');
  });

  it('direct editElement rejects invalid slideIndex boundaries', async () => {
    const { DeckEditor } = await loadModule();
    const deckHtmlDsl = '<section><div data-el="el1">Hello</div></section>';
    const editor = new DeckEditor({ deckPackage: { deckHtmlDsl } });

    const negative = await editor.editElement(-1, 'el1', { text: 'x' });
    expect(negative.success).toBe(false);
    expect(negative.error).toContain('Invalid slideIndex');

    const huge = await editor.editElement(Number.MAX_SAFE_INTEGER, 'el1', { text: 'x' });
    expect(huge.success).toBe(false);
    expect(huge.error).toContain('Invalid slideIndex');
  });

  it('direct editElement rejects missing element id', async () => {
    const { DeckEditor } = await loadModule();
    const deckHtmlDsl = '<section><div data-el="el1">Hello</div></section>';
    const editor = new DeckEditor({ deckPackage: { deckHtmlDsl } });

    const result = await editor.editElement(0, 'missing', { text: 'x' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Element not found');
  });

  it('direct editElement escapes text content', async () => {
    const { DeckEditor } = await loadModule();
    const deckHtmlDsl = '<section><div data-el="el1">Hello</div></section>';
    const editor = new DeckEditor({ deckPackage: { deckHtmlDsl } });

    const result = await editor.editElement(0, 'el1', { text: '<script>alert("x")</script>&' });

    expect(result.success).toBe(true);
    const updated = editor.getDeckHtmlDsl();
    expect(updated).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(updated).toContain('&amp;');
    expect(updated).not.toContain("<script>");

    const history = editor.getHistory();
    expect(history.entries[0].params.changes.text).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;',
    );
  });

  it('direct editElement truncates long text to 10000 chars', async () => {
    const { DeckEditor } = await loadModule();
    const deckHtmlDsl = '<section><div data-el="el1">Hello</div></section>';
    const editor = new DeckEditor({ deckPackage: { deckHtmlDsl } });

    const longText = 'a'.repeat(10005);
    const result = await editor.editElement(0, 'el1', { text: longText });

    expect(result.success).toBe(true);
    const updated = editor.getDeckHtmlDsl();
    const match = updated.match(/data-el="el1"[^>]*>([^<]*)</);
    expect(match).not.toBeNull();
    expect(match[1]).toBe('a'.repeat(10000));
  });

  it('direct editElement sanitizes inline styles and keeps safe properties', async () => {
    const { DeckEditor } = await loadModule();
    const deckHtmlDsl = '<section><div data-el="el1" style="color: blue">Hello</div></section>';
    const editor = new DeckEditor({ deckPackage: { deckHtmlDsl } });
    globalThis.safeId = 'el1';

    const rawStyle =
      "color: red; background: url(javascript:alert(1)); position: absolute; cursor: pointer;";
    const result = await editor.editElement(0, 'el1', { text: 'Hello', style: rawStyle });

    expect(result.success).toBe(true);
    const updated = editor.getDeckHtmlDsl();
    expect(updated).toContain('style="color: red; position: absolute"');
    expect(updated).not.toContain("cursor: pointer");
    expect(updated).not.toContain("url(");

    const history = editor.getHistory();
    expect(history.entries[0].params.changes.style).toBe("color: red; position: absolute");
  });

  it('direct editElement allows clearing style with whitespace input', async () => {
    const { DeckEditor } = await loadModule();
    const deckHtmlDsl = '<section><div data-el="el1" style="color: blue">Hello</div></section>';
    const editor = new DeckEditor({ deckPackage: { deckHtmlDsl } });
    globalThis.safeId = 'el1';

    const result = await editor.editElement(0, 'el1', { text: 'Hello', style: '   ' });

    expect(result.success).toBe(true);
    const updated = editor.getDeckHtmlDsl();
    expect(updated).toContain('style=""');

    const history = editor.getHistory();
    expect(history.entries[0].params.changes.style).toBe('');
  });

  it('direct editElement does not apply style updates when sanitization yields empty result', async () => {
    const { DeckEditor } = await loadModule();
    const deckHtmlDsl = '<section><div data-el="el1" style="color: blue">Hello</div></section>';
    const editor = new DeckEditor({ deckPackage: { deckHtmlDsl } });
    globalThis.safeId = 'el1';

    const result = await editor.editElement(0, 'el1', {
      text: 'Hello',
      style: 'background: url(javascript:alert(1))',
    });

    expect(result.success).toBe(true);
    expect(editor.getDeckHtmlDsl()).toContain('style="color: blue"');

    const history = editor.getHistory();
    expect(history.entries).toHaveLength(1);
    expect(history.entries[0].params.changes.style).toBe('background: url(javascript:alert(1))');
  });

  it('direct editElement ignores safe declarations beyond the max style length budget', async () => {
    const { DeckEditor } = await loadModule();
    const deckHtmlDsl = '<section><div data-el="el1" style="color: blue">Hello</div></section>';
    const editor = new DeckEditor({ deckPackage: { deckHtmlDsl } });
    globalThis.safeId = 'el1';

    const longStyle = 'color: red;'.repeat(500) + 'font-size: 12px;';
    const result = await editor.editElement(0, 'el1', { text: 'Hello', style: longStyle });

    expect(result.success).toBe(true);
    const updated = editor.getDeckHtmlDsl();
    expect(updated).toContain('style="');
    expect(updated).toContain('color: red');
    expect(updated).not.toContain('font-size: 12px');
  });

  it('direct editElement does not inject a style attribute when missing on the element', async () => {
    const { DeckEditor } = await loadModule();
    const deckHtmlDsl = '<section><div data-el="el1">Hello</div></section>';
    const editor = new DeckEditor({ deckPackage: { deckHtmlDsl } });
    globalThis.safeId = 'el1';

    const result = await editor.editElement(0, 'el1', { text: 'Hello', style: 'color: red' });

    expect(result.success).toBe(true);
    expect(editor.getDeckHtmlDsl()).toContain('<div data-el="el1">');
    expect(editor.getDeckHtmlDsl()).not.toContain('style="color: red"');
  });

  it('direct editSlide sanitizes html and layout while accepting string slideIndex', async () => {
    const { DeckEditor } = await loadModule();
    const deckHtmlDsl = '<section data-layout="old"><div>Old</div></section>';
    const editor = new DeckEditor({ deckPackage: { deckHtmlDsl } });

    const result = await editor.editSlide("0", {
      html: '<section data-layout="bad" onclick="alert(1)" style="color: red; background: url(javascript:alert(1))"><div>Hi</div></section>',
      layout: "grid@12 ",
    });

    expect(result.success).toBe(true);
    const updated = editor.getDeckHtmlDsl();
    expect(updated).toContain('data-layout="grid12"');
    expect(updated).toContain('style="color: red"');
    expect(updated).not.toContain("onclick=");
    expect(updated).not.toContain("javascript:");
  });

  it.each([
    ["number", 123],
    ["object", { foo: "bar" }],
  ])("direct editSlide rejects non-string html (%s)", async (_label, html) => {
    const { DeckEditor } = await loadModule();
    const deckHtmlDsl = '<section data-layout="old"><div>Old</div></section>';
    const editor = new DeckEditor({ deckPackage: { deckHtmlDsl } });

    const result = await editor.editSlide(0, { html });

    expect(result.success).toBe(false);
    expect(result.error).toBe("changes.html must be a string");
  });

  it('direct editSlide rejects oversized html payloads', async () => {
    const { DeckEditor } = await loadModule();
    const deckHtmlDsl = '<section data-layout="old"><div>Old</div></section>';
    const editor = new DeckEditor({ deckPackage: { deckHtmlDsl } });
    const bigHtml = "a".repeat(500001);

    const result = await editor.editSlide(0, { html: bigHtml });

    expect(result.success).toBe(false);
    expect(result.error).toBe("changes.html exceeds max length (500KB)");
  });

  it('direct editSlide accepts the max html size boundary (500KB) and ignores falsy non-string html', async () => {
    const { DeckEditor } = await loadModule();
    const deckHtmlDsl = '<section data-layout="old"><div>Keep</div></section>';
    const editor = new DeckEditor({ deckPackage: { deckHtmlDsl } });

    const maxHtml = `<section>${'a'.repeat(500000 - '<section></section>'.length)}</section>`;
    expect(maxHtml).toHaveLength(500000);

    const atLimit = await editor.editSlide(0, { html: maxHtml });
    expect(atLimit.success).toBe(true);
    expect(editor.getDeckHtmlDsl()).toBe(maxHtml);

    // Falsy non-string html values are ignored (because the implementation checks `if (changes.html)`).
    const ignored = await editor.editSlide(0, { html: 0 });
    expect(ignored.success).toBe(true);
    expect(editor.getDeckHtmlDsl()).toBe(maxHtml);
  });

  it('direct editSlide does not inject data-layout when missing on the section', async () => {
    const { DeckEditor } = await loadModule();
    const deckHtmlDsl = '<section><div>Old</div></section>';
    const editor = new DeckEditor({ deckPackage: { deckHtmlDsl } });

    const result = await editor.editSlide(0, { layout: 'grid' });

    expect(result.success).toBe(true);
    expect(editor.getDeckHtmlDsl()).toBe(deckHtmlDsl);
  });

  it('direct editSlide sanitizes and truncates layout to 50 safe characters', async () => {
    const { DeckEditor } = await loadModule();
    const deckHtmlDsl = '<section data-layout="old"><div>Old</div></section>';
    const editor = new DeckEditor({ deckPackage: { deckHtmlDsl } });

    const layout = `${'a'.repeat(100)}!!!`;
    const result = await editor.editSlide(0, { layout });

    expect(result.success).toBe(true);
    expect(editor.getDeckHtmlDsl()).toContain(`data-layout="${'a'.repeat(50)}"`);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
    ["zero", 0],
    ["object", {}],
    ["empty array", []],
  ])("batchEdit rejects invalid edits input (%s)", async (_label, value) => {
    const { DeckEditor } = await loadModule();
    const editor = new DeckEditor();

    const result = await editor.batchEdit(value);

    expect(result.success).toBe(false);
    expect(result.error).toBe("edits must be a non-empty array");
  });

  it('batchEdit aggregates mixed results and unknown edit types', async () => {
    const { DeckEditor } = await loadModule();
    const toolExecutor = vi
      .fn()
      .mockResolvedValueOnce({
        success: true,
        data: { deckPackage: { deckHtmlDsl: "one" } },
      })
      .mockResolvedValueOnce({
        success: true,
        data: { deckPackage: { deckHtmlDsl: "two" } },
      });
    const editor = new DeckEditor({ deckPackage: { deckHtmlDsl: "start" }, toolExecutor });

    const result = await editor.batchEdit([
      { type: "element", slideIndex: 0, elementId: "el1", changes: { text: "a" } },
      { type: "unknown", slideIndex: 0, changes: {} },
      { type: "slide", slideIndex: 1, changes: { html: "<section>two</section>" } },
    ]);

    expect(result.success).toBe(true);
    expect(result.data.total).toBe(3);
    expect(result.data.success).toBe(2);
    expect(result.data.failed).toBe(1);
    expect(result.data.results[1].result.success).toBe(false);
    expect(result.data.results[1].result.error).toContain("Unknown edit type");
    expect(toolExecutor).toHaveBeenCalledTimes(2);
  });

  it('batchEdit returns success=false when all edits fail', async () => {
    const { DeckEditor } = await loadModule();
    const editor = new DeckEditor({ deckPackage: { deckHtmlDsl: '<section>one</section>' } });

    const result = await editor.batchEdit([
      { type: 'unknown', slideIndex: 0, changes: {} },
      { type: 'unknown', slideIndex: 1, changes: {} },
    ]);

    expect(result.success).toBe(false);
    expect(result.data.success).toBe(0);
    expect(result.data.failed).toBe(2);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['whitespace', '   '],
    ['zero', 0],
    ['array', []],
  ])('applyStyleFix rejects non-object inputs (%s)', async (_label, value) => {
    const { DeckEditor } = await loadModule();
    const editor = new DeckEditor();
    const result = await editor.applyStyleFix(value);
    expect(mockedDesignUtils.isPlainObject).toHaveBeenCalledWith(value);
    expect(result.success).toBe(false);
    expect(result.error).toBe('fix must be an object');
  });

  it('applyStyleFix returns no-op result for empty or deep nested objects', async () => {
    const { DeckEditor } = await loadModule();
    const editor = new DeckEditor();

    const root = {};
    let node = root;
    for (let i = 0; i < 200; i += 1) {
      node.next = {};
      node = node.next;
    }

    const empty = await editor.applyStyleFix({});
    expect(empty.success).toBe(true);
    expect(empty.data).toEqual({ message: 'No fixes to apply' });

    const deep = await editor.applyStyleFix(root);
    expect(deep.success).toBe(true);
    expect(deep.data).toEqual({ message: 'No fixes to apply' });
  });

  it('applyStyleFix ignores non-array fix lists', async () => {
    const { DeckEditor } = await loadModule();
    const editor = new DeckEditor();

    const result = await editor.applyStyleFix({
      colorFixes: {},
      fontFixes: null,
      layoutFixes: 'nope',
      htmlReplacements: 123,
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ message: 'No fixes to apply' });
  });

  it('applyStyleFix builds edits from fix arrays and delegates to batchEdit', async () => {
    const { DeckEditor } = await loadModule();
    const editor = new DeckEditor();
    const batchEditSpy = vi
      .spyOn(editor, "batchEdit")
      .mockResolvedValue({ success: true, data: { total: 4 } });

    const fix = {
      colorFixes: [
        { slideIndex: 0, elementId: "el1", newStyle: "color: red" },
      ],
      fontFixes: [
        { slideIndex: 1, elementId: "el2", newStyle: "font-size: 12px" },
      ],
      layoutFixes: [{ slideIndex: 2, newLayout: "grid" }],
      htmlReplacements: [{ slideIndex: 3, newHtml: "<section>hi</section>" }],
    };

    const result = await editor.applyStyleFix(fix);

    expect(batchEditSpy).toHaveBeenCalledWith([
      {
        type: "element",
        slideIndex: 0,
        elementId: "el1",
        changes: { style: "color: red" },
      },
      {
        type: "element",
        slideIndex: 1,
        elementId: "el2",
        changes: { style: "font-size: 12px" },
      },
      {
        type: "slide",
        slideIndex: 2,
        changes: { layout: "grid" },
      },
      {
        type: "slide",
        slideIndex: 3,
        changes: { html: "<section>hi</section>" },
      },
    ]);
    expect(result).toEqual({ success: true, data: { total: 4 } });
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["zero", 0],
    ["empty object", {}],
    ["empty array", []],
  ])("replaceSlideHtml rejects non-string newHtml (%s)", async (_label, value) => {
    const { DeckEditor } = await loadModule();
    const editor = new DeckEditor({ deckPackage: { deckHtmlDsl: "<section>old</section>" } });

    const result = editor.replaceSlideHtml(0, value);

    expect(result.success).toBe(false);
    expect(result.error).toBe("newHtml must be a string");
  });

  it('replaceSlideHtml rejects oversized html payloads and accepts the max length boundary', async () => {
    const { DeckEditor } = await loadModule();
    const editor = new DeckEditor({ deckPackage: { deckHtmlDsl: "<section>old</section>" } });
    const bigHtml = "a".repeat(500001);

    const result = editor.replaceSlideHtml(0, bigHtml);

    expect(result.success).toBe(false);
    expect(result.error).toBe("newHtml exceeds max length (500KB)");

    const maxHtml = `<section>${'a'.repeat(500000 - '<section></section>'.length)}</section>`;
    expect(maxHtml).toHaveLength(500000);

    const atLimit = editor.replaceSlideHtml(0, maxHtml);
    expect(atLimit.success).toBe(true);
    expect(editor.getDeckHtmlDsl()).toBe(maxHtml);
  });

  it('replaceSlideHtml rejects invalid slideIndex boundaries', async () => {
    const { DeckEditor } = await loadModule();
    const deckHtmlDsl = joinSectionsImpl(['<section>one</section>', '<section>two</section>']);
    const editor = new DeckEditor({ deckPackage: { deckHtmlDsl } });

    const resultNegative = editor.replaceSlideHtml(-1, "<section>new</section>");
    expect(resultNegative.success).toBe(false);
    expect(resultNegative.error).toContain("Invalid slideIndex");

    const resultEqualLength = editor.replaceSlideHtml(2, "<section>new</section>");
    expect(resultEqualLength.success).toBe(false);
    expect(resultEqualLength.error).toContain("Invalid slideIndex");

    const resultHuge = editor.replaceSlideHtml(Number.MAX_SAFE_INTEGER, "<section>new</section>");
    expect(resultHuge.success).toBe(false);
    expect(resultHuge.error).toContain("Invalid slideIndex");
  });

  it('replaceSlideHtml sanitizes dangerous tags, urls, and styles', async () => {
    const { DeckEditor } = await loadModule();
    const editor = new DeckEditor({ deckPackage: { deckHtmlDsl: "<section>old</section>" } });
    const newHtml =
      '<section><img src="javascript:alert(1)" srcset="javascript:alert(1) 1x, safe.png 2x" onerror="alert(1)" style="color: red; background: url(javascript:alert(1));"></section><script>alert(1)</script>';

    const result = editor.replaceSlideHtml(0, newHtml);

    expect(result.success).toBe(true);
    const updated = editor.getDeckHtmlDsl();
    expect(updated).toContain('style="color: red"');
    expect(updated).not.toContain("<script");
    expect(updated).not.toContain("onerror=");
    expect(updated).not.toContain("javascript:");
    expect(updated).not.toContain("srcset=");
    expect(updated).not.toContain("src=");
  });

  it('replaceSlideHtml drops the style attribute when sanitization yields empty style', async () => {
    const { DeckEditor } = await loadModule();
    const editor = new DeckEditor({ deckPackage: { deckHtmlDsl: '<section>old</section>' } });

    const newHtml =
      '<section style="cursor: pointer; background: url(javascript:alert(1))" onclick="alert(1)">Hi</section>';
    const result = editor.replaceSlideHtml(0, newHtml);

    expect(result.success).toBe(true);
    const updated = editor.getDeckHtmlDsl();
    expect(updated).not.toContain('style=');
    expect(updated).not.toContain('onclick=');
  });

  it('replaceSlideHtml accepts empty and whitespace html strings', async () => {
    const { DeckEditor } = await loadModule();
    const editorEmpty = new DeckEditor({ deckPackage: { deckHtmlDsl: "<section>old</section>" } });
    const editorWhitespace = new DeckEditor({ deckPackage: { deckHtmlDsl: "<section>old</section>" } });

    const resultEmpty = editorEmpty.replaceSlideHtml(0, "");
    expect(resultEmpty.success).toBe(true);
    expect(editorEmpty.getDeckHtmlDsl()).toBe("");
    expect(editorEmpty.getHistory().entries).toHaveLength(1);

    const resultWhitespace = editorWhitespace.replaceSlideHtml(0, "   ");
    expect(resultWhitespace.success).toBe(true);
    expect(editorWhitespace.getDeckHtmlDsl()).toBe("");
  });

  it('replaceSlideHtml records timestamps via Date.now', async () => {
    const { DeckEditor } = await loadModule();
    const editor = new DeckEditor({ deckPackage: { deckHtmlDsl: '<section>one</section>' } });

    vi.useFakeTimers();
    try {
      const fixed = new Date('2026-01-01T00:00:00.000Z');
      vi.setSystemTime(fixed);

      const result = editor.replaceSlideHtml(0, '<section>two</section>');
      expect(result.success).toBe(true);

      const history = editor.getHistory();
      expect(history.entries).toHaveLength(1);
      expect(history.entries[0].timestamp).toBe(fixed.getTime());
    } finally {
      vi.useRealTimers();
    }
  });

  it('undo/redo restore history state and enforce bounds', async () => {
    const { DeckEditor } = await loadModule();
    const editor = new DeckEditor({ deckPackage: { deckHtmlDsl: "<section>one</section>" } });

    expect(editor.undo().success).toBe(false);
    expect(editor.redo().success).toBe(false);

    const result = editor.replaceSlideHtml(0, "<section>two</section>");
    expect(result.success).toBe(true);
    expect(editor.getDeckHtmlDsl()).toBe("<section>two</section>");

    const undo = editor.undo();
    expect(undo.success).toBe(true);
    expect(editor.getDeckHtmlDsl()).toBe("<section>one</section>");

    const redo = editor.redo();
    expect(redo.success).toBe(true);
    expect(editor.getDeckHtmlDsl()).toBe("<section>two</section>");
  });

  it('limits history length, including the boundary value maxHistoryLength=0', async () => {
    const { DeckEditor } = await loadModule();
    const editorZero = new DeckEditor({
      deckPackage: { deckHtmlDsl: '<section>start</section>' },
      config: { maxHistoryLength: 0 },
    });

    const changed = editorZero.replaceSlideHtml(0, '<section>one</section>');
    expect(changed.success).toBe(true);
    expect(editorZero.getDeckHtmlDsl()).toBe('<section>one</section>');
    expect(editorZero.getHistory().entries).toHaveLength(0);
    expect(editorZero.undo().success).toBe(false);

    const editor = new DeckEditor({
      deckPackage: { deckHtmlDsl: '<section>start</section>' },
      config: { maxHistoryLength: 2 },
    });

    editor.replaceSlideHtml(0, '<section>one</section>');
    editor.replaceSlideHtml(0, '<section>two</section>');
    editor.replaceSlideHtml(0, '<section>three</section>');

    const history = editor.getHistory();
    expect(history.entries).toHaveLength(2);
    expect(history.currentIndex).toBe(1);
    expect(history.entries[0].params.newHtml).toBe("<section>two</section>");
    expect(history.entries[1].params.newHtml).toBe("<section>three</section>");

    const undo = editor.undo();
    expect(undo.success).toBe(true);
    const afterUndo = editor.getHistory();
    expect(afterUndo.canRedo).toBe(true);

    editor.replaceSlideHtml(0, "<section>four</section>");
    const afterNewEdit = editor.getHistory();
    expect(afterNewEdit.canRedo).toBe(false);
    expect(afterNewEdit.entries).toHaveLength(2);
  });

  it('getHistory returns a copy of the entries array', async () => {
    const { DeckEditor } = await loadModule();
    const editor = new DeckEditor({ deckPackage: { deckHtmlDsl: "<section>one</section>" } });

    editor.replaceSlideHtml(0, "<section>two</section>");

    const history = editor.getHistory();
    history.entries.push({ action: "fake" });

    const nextHistory = editor.getHistory();
    expect(nextHistory.entries).toHaveLength(1);
  });

  it('handles rapid sequential edits', async () => {
    const { DeckEditor } = await loadModule();
    const toolExecutor = vi
      .fn()
      .mockResolvedValueOnce({
        success: true,
        data: { deckPackage: { deckHtmlDsl: "<section>one</section>" } },
      })
      .mockResolvedValueOnce({
        success: true,
        data: { deckPackage: { deckHtmlDsl: "<section>two</section>" } },
      });
    const editor = new DeckEditor({ deckPackage: { deckHtmlDsl: "<section>start</section>" }, toolExecutor });

    await editor.editSlide(0, { html: "<section>one</section>" });
    await editor.editSlide(0, { html: "<section>two</section>" });

    expect(toolExecutor).toHaveBeenCalledTimes(2);
    expect(editor.getHistory().entries).toHaveLength(2);
    expect(editor.getDeckHtmlDsl()).toBe("<section>two</section>");
  });
});

describe("createDeckEditor", () => {
  it('creates a DeckEditor instance with provided options', async () => {
    const { createDeckEditor, DeckEditor } = await loadModule();
    const editor = createDeckEditor({ deckPackage: { deckHtmlDsl: "<section>hi</section>" } });

    expect(editor).toBeInstanceOf(DeckEditor);
    expect(editor.getDeckHtmlDsl()).toBe("<section>hi</section>");
  });

  it('uses defaults when options are undefined', async () => {
    const { createDeckEditor } = await loadModule();
    const editor = createDeckEditor(undefined);

    expect(editor.getDeckHtmlDsl()).toBe("");
  });

  it('throws when options are null', async () => {
    const { createDeckEditor } = await loadModule();

    expect(() => createDeckEditor(null)).toThrow();
  });
});
