import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';

function setupDom(html = '<!doctype html><html><head></head><body></body></html>') {
  const { window, document } = parseHTML(html);
  globalThis.window = window;
  globalThis.document = document;
  globalThis.DOMParser = window.DOMParser;
  return { window, document };
}

function teardownDom() {
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.DOMParser;
}

async function loadSerialize() {
  await import('../../../../js/ppt/dsl/serialize.js');
  return globalThis.PPTDSLSerialize;
}

async function loadSlideParser() {
  await import('../../../../js/ppt/core/slide-parser.js');
  return globalThis.SlideParser;
}

describe('PPT DSL serialize', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();

    setupDom();

    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await loadSerialize();
  });

  afterEach(() => {
    delete globalThis.PPTDSLSerialize;
    delete globalThis.SlideParser;
    delete globalThis.SlideDocument;
    teardownDom();
    vi.restoreAllMocks();
  });

  it('documentToHtml() serializes slides + escapes text HTML', async () => {
    await loadSlideParser();
    const { documentToHtml } = globalThis.PPTDSLSerialize;

    const doc = {
      slides: [
        {
          id: 's1',
          type: 'freeform',
          background: '#111111',
          elements: [
            {
              type: 'text',
              id: 't1',
              x: 10,
              y: '20%',
              w: 30,
              h: 40,
              z: 5,
              rotate: 45,
              opacity: 0.5,
              fontSize: 24,
              color: '#112233',
              bold: true,
              italic: false,
              align: 'center',
              valign: 'middle',
              lineHeight: 1.2,
              fontFamily: 'Arial',
              content: 'Hello <b>World</b> & "quotes"',
            },
          ],
        },
        {
          id: 's2',
          type: 'freeform',
          backgroundGradient: 'linear-gradient(red, blue)',
          elements: [],
        },
      ],
    };

    const html = documentToHtml(doc);
    const container = globalThis.document.createElement('div');
    container.innerHTML = html;

    const sections = Array.from(container.querySelectorAll('section[data-type]'));
    expect(sections.map((s) => s.id)).toEqual(['s1', 's2']);

    const s1 = container.querySelector('section#s1');
    expect(s1?.dataset.type).toBe('freeform');
    expect(s1?.dataset.bg).toBe('#111111');

    const t1 = s1?.querySelector('#t1');
    expect(t1?.dataset.el).toBe('text');
    expect(t1?.dataset.x).toBe('10%');
    expect(t1?.dataset.y).toBe('20%');
    expect(t1?.dataset.w).toBe('30%');
    expect(t1?.dataset.h).toBe('40%');
    expect(t1?.dataset.z).toBe('5');
    expect(t1?.dataset.rotate).toBe('45');
    expect(t1?.dataset.opacity).toBe('0.5');
    expect(t1?.dataset.bold).toBe('true');
    expect(t1?.dataset.italic).toBe('false');
    expect(t1?.dataset.align).toBe('center');
    expect(t1?.dataset.valign).toBe('middle');
    expect(t1?.dataset.font).toBe('24');
    expect(t1?.dataset.color).toBe('#112233');

    expect(t1?.innerHTML).toContain('&lt;b&gt;World&lt;/b&gt;');
    expect(t1?.querySelector('b')).toBeNull();

    const s2 = container.querySelector('section#s2');
    expect(s2?.dataset.gradient).toBe('linear-gradient(red, blue)');
    expect(s2?.dataset.bg).toBeUndefined();
  });

  it('documentToHtml() supports onlySlideIndexes / onlySlideIds filtering', async () => {
    const { documentToHtml } = globalThis.PPTDSLSerialize;

    const doc = {
      slides: [
        { id: 's1', background: '#111', elements: [] },
        { id: 's2', background: '#222', elements: [] },
        { id: 's3', background: '#333', elements: [] },
      ],
    };

    const htmlByIndex = documentToHtml(doc, { onlySlideIndexes: [2, 1, 1, -1, 'bad'] });
    const containerByIndex = globalThis.document.createElement('div');
    containerByIndex.innerHTML = htmlByIndex;
    expect(Array.from(containerByIndex.querySelectorAll('section[data-type]')).map((s) => s.id)).toEqual(['s2', 's3']);

    const htmlById = documentToHtml(doc, { onlySlideIds: ['s3', 's1'] });
    const containerById = globalThis.document.createElement('div');
    containerById.innerHTML = htmlById;

    expect(Array.from(containerById.querySelectorAll('section[data-type]')).map((s) => s.id)).toEqual(['s1', 's3']);
  });

  it('documentToHtml() can incrementally replace sections in baseHtml (CSS-escaped ids)', async () => {
    const { documentToHtml } = globalThis.PPTDSLSerialize;

    const baseHtml = [
      '<section data-type="freeform" id="s:1" data-bg="#000000"><div data-el="text" id="t1">Old</div></section>',
      '<section data-type="freeform" id="sOld" data-bg="#cccccc"></section>',
    ].join('\n');

    const doc = {
      slides: [
        {
          id: 's:1',
          background: '#111111',
          elements: [{ type: 'text', id: 't1', content: 'New <i>Content</i>' }],
        },
        { id: 's2', background: '#222222', elements: [] },
      ],
    };

    const html = documentToHtml(doc, { baseHtml });
    const container = globalThis.document.createElement('div');
    container.innerHTML = html;

    expect(container.querySelectorAll('section#sOld')).toHaveLength(1);
    expect(container.querySelectorAll('section#s\\:1')).toHaveLength(1);
    expect(container.querySelectorAll('section#s2')).toHaveLength(1);

    const updated = container.querySelector('section#s\\:1');
    expect(updated?.dataset.bg).toBe('#111111');

    const t1 = updated?.querySelector('#t1');
    expect(t1?.innerHTML).toContain('&lt;i&gt;Content&lt;/i&gt;');
  });

  it('htmlToDocument() throws when SlideParser is not available', async () => {
    const { htmlToDocument } = globalThis.PPTDSLSerialize;
    delete globalThis.SlideParser;
    expect(() => htmlToDocument('<section data-type="freeform"></section>')).toThrow('SlideParser 未加载');
  });

  it('htmlToDocument() parses HTML DSL and preserves ids / content', async () => {
    await loadSlideParser();
    const { documentToHtml, htmlToDocument } = globalThis.PPTDSLSerialize;

    const doc = {
      slides: [
        {
          id: 's1',
          background: '#ffffff',
          elements: [
            { type: 'text', id: 't1', x: 10, y: 20, w: 30, h: 40, content: 'Hello <b>World</b>' },
            { type: 'shape', id: 'sh1', x: 0, y: 0, w: 100, h: 100, fill: '#ff0000', stroke: '#333333', strokeWidth: 2, radius: 8 },
            { type: 'group', id: 'g1', x: 5, y: 5, w: 50, h: 50, children: [{ type: 'text', id: 't2', content: 'Child' }] },
          ],
        },
      ],
    };

    const html = documentToHtml(doc);
    const parsed = htmlToDocument(html);

    expect(parsed).toEqual(expect.objectContaining({ slides: expect.any(Array) }));
    expect(parsed.slides).toHaveLength(1);

    const slide = parsed.slides[0];
    expect(slide.id).toBe('s1');
    expect(slide.background).toBe('#ffffff');
    expect(slide.elements.map((el) => el.id)).toEqual(['t1', 'sh1', 'g1']);

    const t1 = slide.elements.find((el) => el.id === 't1');
    expect(t1).toEqual(expect.objectContaining({ type: 'text', x: '10%', y: '20%', w: '30%', h: '40%' }));
    expect(t1.content).toBe('Hello &lt;b&gt;World&lt;/b&gt;');

    const group = slide.elements.find((el) => el.id === 'g1');
    expect(group).toEqual(expect.objectContaining({ type: 'group', children: expect.any(Array) }));
    expect(group.children.map((el) => el.id)).toEqual(['t2']);
    expect(group.children[0].type).toBe('text');
    expect(group.children[0].content).toBe('Child');
  });

  it('htmlToDocument() returns SlideDocument instance when available', async () => {
    await loadSlideParser();
    const { documentToHtml, htmlToDocument } = globalThis.PPTDSLSerialize;

    class DummySlideDocument {
      load(slides) {
        this._slides = slides;
      }
      getSlides() {
        return this._slides;
      }
    }

    globalThis.SlideDocument = DummySlideDocument;

    const html = documentToHtml({ slides: [{ id: 's1', background: '#fff', elements: [] }] });
    const doc = htmlToDocument(html);

    expect(doc).toBeInstanceOf(DummySlideDocument);
    expect(doc.getSlides()).toHaveLength(1);
    expect(doc.getSlides()[0].id).toBe('s1');
  });
});
