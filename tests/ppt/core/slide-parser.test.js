import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { SlideParser } from '../../../js/ppt/core/slide-parser.js';

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

test.afterEach(() => {
  teardownDom();
});

test('SlideParser.parseStyleString(): basic parsing + kebab→camel + values with ":"', () => {
  setupDom();

  assert.deepEqual(
    SlideParser.parseStyleString('color: red; font-size: 16px;'),
    { color: 'red', fontSize: '16px' }
  );

  assert.deepEqual(
    SlideParser.parseStyleString('background-image: url(http://example.com/a:b.png);'),
    { backgroundImage: 'url(http://example.com/a:b.png)' }
  );

  assert.deepEqual(SlideParser.parseStyleString(''), {});
  assert.deepEqual(SlideParser.parseStyleString(null), {});
});

test('SlideParser.parseCSSNumber(): boundary cases', () => {
  setupDom();

  assert.equal(SlideParser.parseCSSNumber(undefined, 7), 7);
  assert.equal(SlideParser.parseCSSNumber(null, 7), 7);
  assert.equal(SlideParser.parseCSSNumber('', 7), 7);
  assert.equal(SlideParser.parseCSSNumber('abc', 7), 7);

  assert.equal(SlideParser.parseCSSNumber('12px'), 12);
  assert.equal(SlideParser.parseCSSNumber('12.5%'), 12.5);
  assert.equal(SlideParser.parseCSSNumber('-3.2em'), -3.2);
  assert.equal(SlideParser.parseCSSNumber(0), 0);
});

test('SlideParser.parseRotateFromTransform(): extracts rotate() degrees', () => {
  setupDom();

  assert.equal(SlideParser.parseRotateFromTransform(null), null);
  assert.equal(SlideParser.parseRotateFromTransform('scale(2)'), null);
  assert.equal(SlideParser.parseRotateFromTransform('rotate(45deg)'), 45);
  assert.equal(SlideParser.parseRotateFromTransform('translate(1px) rotate(-30deg)'), -30);
  assert.equal(SlideParser.parseRotateFromTransform('rotate(bad)'), 0);
});

test('SlideParser.parseBorderColor()/parseBorderWidth(): parses typical border strings', () => {
  setupDom();

  assert.equal(SlideParser.parseBorderColor('1px solid #333'), '#333');
  assert.equal(SlideParser.parseBorderWidth('1px solid #333'), 1);

  assert.equal(SlideParser.parseBorderColor('2px dashed rgba(0,0,0,0.5)'), 'rgba(0,0,0,0.5)');
  assert.equal(SlideParser.parseBorderWidth('0.5px solid red'), 0.5);

  assert.equal(SlideParser.parseBorderColor('1px solid red'), 'red');
  assert.equal(SlideParser.parseBorderWidth('thin solid #000'), 0);
});

test('SlideParser.parse(): parses sections + elements (linkedom DOM)', () => {
  setupDom();

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

    assert.equal(Array.isArray(slides), true);
    assert.equal(slides.length, 2);

    const s1 = slides[0];
    assert.equal(s1.id, 's1');
    assert.equal(s1.type, 'freeform');
    assert.equal(s1.background, '#111111');
    assert.equal(s1.elements.length, 3);

    const t1 = s1.elements.find((el) => el.id === 't1');
    assert.ok(t1);
    assert.equal(t1.type, 'text');
    assert.equal(t1.x, '10%');
    assert.equal(t1.y, '20%');
    assert.equal(t1.w, '30%');
    assert.equal(t1.h, '40%');
    assert.equal(t1.z, 5);
    assert.equal(t1.rotate, 45);
    assert.equal(t1.opacity, 0.5);
    assert.equal(t1.font, 24);
    assert.equal(t1.color, '#112233');
    assert.equal(t1.bold, true);
    assert.equal(t1.align, 'center');
    assert.ok(typeof t1.content === 'string' && t1.content.includes('Hello'));

    const sh1 = s1.elements.find((el) => el.id === 'sh1');
    assert.ok(sh1);
    assert.equal(sh1.type, 'shape');
    assert.equal(sh1.fill, '#ff0000');
    assert.equal(sh1.stroke, '#333');
    assert.equal(sh1.strokeWidth, 2);
    assert.equal(sh1.radius, 8);

    const g1 = s1.elements.find((el) => el.id === 'g1');
    assert.ok(g1);
    assert.equal(g1.type, 'group');
    assert.equal(Array.isArray(g1.children), true);
    assert.equal(g1.children.length, 1);
    assert.equal(g1.children[0].id, 't2');
    assert.equal(g1.children[0].type, 'text');
    assert.equal(g1.children[0].content, 'Child');

    // child should not also appear as a top-level element
    assert.equal(s1.elements.some((el) => el.id === 't2'), false);
  } finally {
    console.log = prevLog;
  }
});

test('SlideParser.parse(): XSS payloads are not executed and event handlers are not preserved', () => {
  setupDom();

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

    assert.equal(globalThis.__xss, undefined);

    const s1 = slides[0];
    assert.equal(s1.elements.length, 2);

    const img = s1.elements.find((el) => el.id === 'img1');
    assert.ok(img);
    assert.equal(img.type, 'image');
    assert.equal(img.src, 'x');
    assert.equal(Object.prototype.hasOwnProperty.call(img, 'onerror'), false);
  } finally {
    console.log = prevLog;
  }
});
