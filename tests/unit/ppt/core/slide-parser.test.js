// TODO: Manual fix needed for dynamic require() calls
import { describe, it, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { parseHTML } from 'linkedom';

function setupDom(html = '<!doctype html><html><head></head><body></body></html>') {
  const { window, document } = parseHTML(html);
  globalThis.window = window;
  globalThis.document = document;
  return { window, document };
}

function teardownDom() {
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.SlideParser;
}

afterEach(() => {
  teardownDom();
  vi.resetModules();
});

test('SlideParser.parseStyleString(): basic parsing + kebab→camel + values with ":"', async () => {
  setupDom();
  const { SlideParser } = await import('../../../../js/ppt/core/slide-parser.js');

  expect(
    SlideParser.parseStyleString('color: red; font-size: 16px;')).toEqual({ color: 'red', fontSize: '16px' }
  );

  expect(
    SlideParser.parseStyleString('background-image: url(http://example.com/a:b.png);')).toEqual({ backgroundImage: 'url(http://example.com/a:b.png)' }
  );

  expect(SlideParser.parseStyleString('')).toEqual({});
  expect(SlideParser.parseStyleString(null)).toEqual({});
});

test('SlideParser.parseCSSNumber(): boundary cases', async () => {
  setupDom();
  const { SlideParser } = await import('../../../../js/ppt/core/slide-parser.js');

  expect(SlideParser.parseCSSNumber(undefined, 7)).toBe(7);
  expect(SlideParser.parseCSSNumber(null, 7)).toBe(7);
  expect(SlideParser.parseCSSNumber('', 7)).toBe(7);
  expect(SlideParser.parseCSSNumber('abc', 7)).toBe(7);

  expect(SlideParser.parseCSSNumber('12px')).toBe(12);
  expect(SlideParser.parseCSSNumber('12.5%')).toBe(12.5);
  expect(SlideParser.parseCSSNumber('-3.2em')).toBe(-3.2);
  expect(SlideParser.parseCSSNumber(0)).toBe(0);
});

test('SlideParser.parseRotateFromTransform(): extracts rotate() degrees', async () => {
  setupDom();
  const { SlideParser } = await import('../../../../js/ppt/core/slide-parser.js');

  expect(SlideParser.parseRotateFromTransform(null)).toBe(null);
  expect(SlideParser.parseRotateFromTransform('scale(2)')).toBe(null);
  expect(SlideParser.parseRotateFromTransform('rotate(45deg)')).toBe(45);
  expect(SlideParser.parseRotateFromTransform('translate(1px) rotate(-30deg)')).toBe(-30);
  expect(SlideParser.parseRotateFromTransform('rotate(bad)')).toBe(0);
});

test('SlideParser.parseBorderColor()/parseBorderWidth(): parses typical border strings', async () => {
  setupDom();
  const { SlideParser } = await import('../../../../js/ppt/core/slide-parser.js');

  expect(SlideParser.parseBorderColor('1px solid #333')).toBe('#333');
  expect(SlideParser.parseBorderWidth('1px solid #333')).toBe(1);

  expect(SlideParser.parseBorderColor('2px dashed rgba(0,0,0,0.5)')).toBe('rgba(0,0,0,0.5)');
  expect(SlideParser.parseBorderWidth('0.5px solid red')).toBe(0.5);

  expect(SlideParser.parseBorderColor('1px solid red')).toBe('red');
  expect(SlideParser.parseBorderWidth('thin solid #000')).toBe(0);
});

test('SlideParser.parse(): parses sections + elements (linkedom DOM)', async () => {
  setupDom();
  const { SlideParser } = await import('../../../../js/ppt/core/slide-parser.js');

  const prevLog = console.log;
  console.log = () => {};
  try {
    const slides = SlideParser.parse(`
      <section data-type="slide" id="s1" data-bg="#111111">
        <div data-el="text" id="t1"
          style="left:10%; top:20%; width:30%; height:40%; font-size:24px; color:#112233; font-weight:bold; text-align:center; z-index:5; transform:rotate(45deg); opacity:0.5;">
          Hello <b>World</b>
        </div>
        <div data-el="shape" id="sh1"
          style="left:0%; top:0%; width:100%; height:100%; background:#ff0000; border:2px solid #333; border-radius:8px;"></div>
        <div data-el="group" id="g1" style="left:5%; top:5%; width:50%; height:50%;">
          <div data-el="text" id="t2">Child</div>
        </div>
      </section>
      <section data-type="slide" id="s2" data-bg="#ffffff"></section>
    `);

    expect(Array.isArray(slides)).toBe(true);
    expect(slides.length).toBe(2);

    const s1 = slides[0];
    expect(s1.id).toBe('s1');
    expect(s1.type).toBe('freeform');
    expect(s1.background).toBe('#111111');
    expect(s1.elements.length).toBe(3);

    const t1 = s1.elements.find((el) => el.id === 't1');
    expect(t1).toBeTruthy();
    expect(t1.type).toBe('text');
    expect(t1.x).toBe('10%');
    expect(t1.y).toBe('20%');
    expect(t1.w).toBe('30%');
    expect(t1.h).toBe('40%');
    expect(t1.z).toBe(5);
    expect(t1.rotate).toBe(45);
    expect(t1.opacity).toBe(0.5);
    expect(t1.font).toBe(24);
    expect(t1.color).toBe('#112233');
    expect(t1.bold).toBe(true);
    expect(t1.align).toBe('center');
    expect(typeof t1.content === 'string' && t1.content.includes('Hello')).toBeTruthy();

    const sh1 = s1.elements.find((el) => el.id === 'sh1');
    expect(sh1).toBeTruthy();
    expect(sh1.type).toBe('shape');
    expect(sh1.fill).toBe('#ff0000');
    expect(sh1.stroke).toBe('#333');
    expect(sh1.strokeWidth).toBe(2);
    expect(sh1.radius).toBe(8);

    const g1 = s1.elements.find((el) => el.id === 'g1');
    expect(g1).toBeTruthy();
    expect(g1.type).toBe('group');
    expect(Array.isArray(g1.children)).toBe(true);
    expect(g1.children.length).toBe(1);
    expect(g1.children[0].id).toBe('t2');
    expect(g1.children[0].type).toBe('text');
    expect(g1.children[0].content).toBe('Child');

    // child should not also appear as a top-level element
    expect(s1.elements.some((el) => el.id === 't2')).toBe(false);
  } finally {
    console.log = prevLog;
  }
});

test('SlideParser.parse(): XSS payloads are not executed and event handlers are not preserved', async () => {
  setupDom();
  const { SlideParser } = await import('../../../../js/ppt/core/slide-parser.js');

  delete globalThis.__xss;

  const prevLog = console.log;
  console.log = () => {};
  try {
    const slides = SlideParser.parse(`
      <section data-type="slide" id="s1">
        <div data-el="text" id="t1"><script>globalThis.__xss = 1</script>SAFE</div>
        <img data-el="image" id="img1" src="x" onerror="globalThis.__xss = 2"
          data-x="0%" data-y="0%" data-w="10%" data-h="10%" />
        <script>globalThis.__xss = 3</script>
      </section>
    `);

    expect(globalThis.__xss).toBe(undefined);

    const s1 = slides[0];
    expect(s1.elements.length).toBe(2);

    const img = s1.elements.find((el) => el.id === 'img1');
    expect(img).toBeTruthy();
    expect(img.type).toBe('image');
    expect(img.src).toBe('x');
    expect(Object.prototype.hasOwnProperty.call(img, 'onerror')).toBe(false);
  } finally {
    console.log = prevLog;
  }
});
