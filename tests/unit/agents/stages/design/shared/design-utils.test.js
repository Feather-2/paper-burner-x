import { describe, it, expect, vi, beforeEach } from 'vitest';

const sharedMocks = vi.hoisted(() => {
  const instances = [];
  const LRUCache = vi.fn(function LRUCache(options = {}) {
    this.maxSize = options.maxSize;
    this._map = new Map();
    this.get = vi.fn((key) => this._map.get(key));
    this.set = vi.fn((key, value) => {
      this._map.set(key, value);
    });
    this.clear = vi.fn(() => {
      this._map.clear();
    });
    instances.push(this);
  });
  const isPlainObject = vi.fn((value) => {
    return value !== null
      && typeof value === 'object'
      && Object.getPrototypeOf(value) === Object.prototype;
  });
  const toNonEmptyString = vi.fn((value) => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  });

  return {
    instances,
    LRUCache,
    isPlainObject,
    toNonEmptyString,
  };
});

vi.mock('../../../../../../js/agents/shared/index.js', () => ({
  LRUCache: sharedMocks.LRUCache,
  isPlainObject: sharedMocks.isPlainObject,
  toNonEmptyString: sharedMocks.toNonEmptyString,
}));

import {
  clamp,
  nowMs,
  safeNumber,
  safeInt,
  clearParseCache,
  parseSections,
  joinSections,
  extractElements,
  isPlainObject,
  toNonEmptyString,
} from '../../../../../../js/agents/stages/design/shared/design-utils.js';

const getCacheInstance = () => sharedMocks.instances[0];

beforeEach(() => {
  clearParseCache();
  vi.clearAllMocks();
});

describe('clamp', () => {
  it('clamps numeric inputs within bounds including boundary values', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(0, 1, 3)).toBe(1);
    expect(clamp(10, 0, 9)).toBe(9);
    expect(clamp(-1, -1, 1)).toBe(-1);
    expect(clamp(Number.MAX_SAFE_INTEGER, 0, Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('coerces numeric-like, empty, and whitespace strings', () => {
    expect(clamp('5', 0, 10)).toBe(5);
    expect(clamp('', -1, 1)).toBe(0);
    expect(clamp('   ', -1, 1)).toBe(0);
  });

  it('returns fallback for non-finite or non-numeric values', () => {
    expect(clamp(NaN, 0, 10, 7)).toBe(7);
    expect(clamp(Infinity, 0, 10, 7)).toBe(7);
    expect(clamp('nope', 0, 10, 7)).toBe(7);
    expect(clamp(undefined, 0, 10, 7)).toBe(7);
    expect(clamp({}, 0, 10, 7)).toBe(7);
  });

  it('defaults fallback to min when omitted', () => {
    expect(clamp(NaN, 2, 4)).toBe(2);
  });
});

describe('nowMs', () => {
  it('returns current timestamp from Date.now', () => {
    vi.useFakeTimers();
    try {
      const fixed = new Date('2024-01-01T00:00:00.000Z');
      vi.setSystemTime(fixed);
      expect(nowMs()).toBe(fixed.getTime());
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('safeNumber', () => {
  it('returns finite numbers including boundary values', () => {
    expect(safeNumber(0)).toBe(0);
    expect(safeNumber(-1)).toBe(-1);
    expect(safeNumber(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    expect(safeNumber(3.5)).toBe(3.5);
  });

  it('returns fallback for invalid, empty, or non-number values', () => {
    expect(safeNumber(NaN)).toBeNull();
    expect(safeNumber(Infinity, 0)).toBe(0);
    expect(safeNumber('3', 1)).toBe(1);
    expect(safeNumber('', 2)).toBe(2);
    expect(safeNumber(null, -1)).toBe(-1);
    expect(safeNumber(undefined, 5)).toBe(5);
    expect(safeNumber({}, 9)).toBe(9);
  });
});

describe('safeInt', () => {
  it('floors finite numbers including negatives and boundary values', () => {
    expect(safeInt(3.9)).toBe(3);
    expect(safeInt(-1.1)).toBe(-2);
    expect(safeInt(0)).toBe(0);
    expect(safeInt(-1)).toBe(-1);
    expect(safeInt(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('returns null for invalid, empty, or non-number values', () => {
    expect(safeInt(NaN)).toBeNull();
    expect(safeInt(Infinity)).toBeNull();
    expect(safeInt('4')).toBeNull();
    expect(safeInt('')).toBeNull();
    expect(safeInt(null)).toBeNull();
    expect(safeInt(undefined)).toBeNull();
    expect(safeInt({})).toBeNull();
  });
});

describe('clearParseCache', () => {
  it('clears cached entries and is safe to call repeatedly', () => {
    const html = '<section>One</section>';
    const cache = getCacheInstance();

    parseSections(html);
    expect(cache._map.size).toBe(1);

    clearParseCache();
    expect(cache._map.size).toBe(0);

    clearParseCache();
    clearParseCache();
    expect(cache._map.size).toBe(0);
    expect(cache.clear).toHaveBeenCalledTimes(3);
  });

  it('clears only the specified cache scope when provided', () => {
    const cache = getCacheInstance();
    parseSections('<section>A</section>', { cacheScope: 'run-a' });
    parseSections('<section>B</section>', { cacheScope: 'run-b' });

    expect(cache._map.size).toBe(2);
    clearParseCache('run-a');
    expect(cache._map.size).toBe(1);
    expect(Array.from(cache._map.keys())).toEqual(['run-b::<section>B</section>']);
  });
});

describe('parseSections', () => {
  it('returns empty array for non-string or empty inputs', () => {
    expect(parseSections(null)).toEqual([]);
    expect(parseSections(undefined)).toEqual([]);
    expect(parseSections('')).toEqual([]);
    expect(parseSections('   ')).toEqual([]);
    expect(parseSections({})).toEqual([]);
    expect(parseSections([])).toEqual([]);
  });

  it('parses section tags case-insensitively and trims results', () => {
    const html = 'Intro <SECTION id="a">One</SECTION>  <section> Two </section> tail';
    expect(parseSections(html)).toEqual([
      '<SECTION id="a">One</SECTION>',
      '<section> Two </section>',
    ]);
  });

  it('returns shallow copies without polluting cached arrays', () => {
    const html = '<section>One</section><section>Two</section>';
    const cache = getCacheInstance();

    const first = parseSections(html);
    first.push('<section>Extra</section>');
    const second = parseSections(html);

    expect(first).not.toBe(second);
    expect(second).toEqual(['<section>One</section>', '<section>Two</section>']);
    expect(cache.set).toHaveBeenCalledTimes(1);
    expect(cache.get).toHaveBeenCalledTimes(2);
  });

  it('supports cache scopes and custom cache keys', () => {
    const html = '<section>One</section>';
    const cache = getCacheInstance();

    const scopedA = parseSections(html, { cacheScope: 'run-a' });
    const scopedB = parseSections(html, { cacheScope: 'run-b' });
    const custom = parseSections(html, { cacheScope: 'run-a', cacheKey: 'custom-1' });

    expect(scopedA).toEqual(['<section>One</section>']);
    expect(scopedB).toEqual(['<section>One</section>']);
    expect(custom).toEqual(['<section>One</section>']);
    expect(cache._map.size).toBe(3);
    expect(Array.from(cache._map.keys()).sort()).toEqual([
      'run-a::<section>One</section>',
      'run-a::custom-1',
      'run-b::<section>One</section>',
    ]);
  });

  it('stops parsing when a section is incomplete', () => {
    const html = '<section>One</section><section>Two';
    expect(parseSections(html)).toEqual(['<section>One</section>']);
  });

  it('handles large input with rapid and concurrent calls', async () => {
    const bigText = 'x'.repeat(5000);
    const html = Array.from({ length: 120 }, (_, i) => `<section>${bigText}${i}</section>`).join('');

    const rapid = Array.from({ length: 3 }, () => parseSections(html));
    const concurrent = await Promise.all(
      Array.from({ length: 4 }, () => Promise.resolve().then(() => parseSections(html))),
    );

    const results = rapid.concat(concurrent);
    results.forEach((result) => {
      expect(result.length).toBe(120);
    });
    expect(new Set(results.map((result) => result)).size).toBe(results.length);

    results[0].push('<section>Extra</section>');
    expect(results[1].length).toBe(120);
  });
});

describe('joinSections', () => {
  it('joins trimmed section strings with blank lines', () => {
    const result = joinSections([' <section>a</section> ', '\n<section>b</section>\n']);
    expect(result).toBe('<section>a</section>\n\n<section>b</section>');
  });

  it('filters empty/non-string entries and handles non-array input', () => {
    expect(joinSections(['', '  ', null, 123, '<section>x</section>'])).toBe('<section>x</section>');
    expect(joinSections([])).toBe('');
    expect(joinSections({})).toBe('');
    expect(joinSections(undefined)).toBe('');
    expect(joinSections(null)).toBe('');
  });

  it('handles long strings and remains stable across rapid and concurrent calls', async () => {
    const longText = 'a'.repeat(10000);
    const sections = Array.from(
      { length: 25 },
      (_, i) => ` <section>${longText}-${i}</section> `,
    );
    const expected = sections.map((section) => section.trim()).join('\n\n');

    const rapid = Array.from({ length: 3 }, () => joinSections(sections));
    rapid.forEach((value) => {
      expect(value).toBe(expected);
    });

    const concurrent = await Promise.all(
      Array.from({ length: 3 }, () => Promise.resolve().then(() => joinSections(sections))),
    );
    concurrent.forEach((value) => {
      expect(value).toBe(expected);
    });
    expect(expected.split('\n\n')).toHaveLength(25);
  });
});

describe('extractElements', () => {
  it('extracts element metadata, attributes, and text previews', () => {
    const html = [
      '<div id="hero" class="big" data-el="hero" data-role="lead">Hello</div>',
      '<span data-el="chip" data-value="1"></span>',
    ].join('');

    const elements = extractElements(html);
    expect(elements).toHaveLength(2);

    const first = elements[0];
    expect(first.elementId).toBe('hero');
    expect(first.tag).toBe('div');
    expect(first.id).toBe('hero');
    expect(first.class).toBe('big');
    expect(first.attrs.id).toBe('hero');
    expect(first.attrs.class).toBe('big');
    expect(first.attrs['data-el']).toBe('hero');
    expect(first.attrs['data-role']).toBe('lead');
    expect(first.textPreview).toBe('Hello');
    expect(Object.getPrototypeOf(first.attrs)).toBeNull();

    const second = elements[1];
    expect(second.elementId).toBe('chip');
    expect(second.tag).toBe('span');
    expect(second.attrs['data-value']).toBe('1');
    expect(second.textPreview).toBeUndefined();
  });

  it('returns empty for non-string input or elements without data-el', () => {
    expect(extractElements('<div id="x"></div>')).toEqual([]);
    expect(extractElements('')).toEqual([]);
    expect(extractElements(null)).toEqual([]);
    expect(extractElements(undefined)).toEqual([]);
  });

  it('prevents prototype pollution in parsed attributes', () => {
    const html = '<div data-el="safe" __proto__="polluted" constructor="bad" prototype="bad"></div>';
    const [element] = extractElements(html);

    expect(Object.prototype.hasOwnProperty.call(element.attrs, '__proto__')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(element.attrs, 'constructor')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(element.attrs, 'prototype')).toBe(false);
    expect(Object.keys(element.attrs)).toContain('data-el');
  });

  it('limits textPreview length and skips deeply nested HTML', () => {
    const longText = 'x'.repeat(200);
    const html = [
      `<p data-el="p1">${longText}</p>`,
      '<div data-el="nested"><span><em><strong>Inner</strong></em></span></div>',
    ].join('');

    const elements = extractElements(html);
    expect(elements).toHaveLength(2);
    expect(elements[0].textPreview).toBe(longText.slice(0, 160));
    expect(elements[0].textPreview.length).toBe(160);
    expect(elements[1].textPreview).toBeUndefined();
  });

  it('handles missing closing tags and self-closing elements gracefully', () => {
    const html = [
      '<img data-el="icon" src="x">',
      '<div data-el="open">no close',
    ].join('');

    const elements = extractElements(html);
    expect(elements).toHaveLength(2);
    expect(elements[0].tag).toBe('img');
    expect(elements[0].attrs.src).toBe('x');
    expect(elements[0].textPreview).toBeUndefined();
    expect(elements[1].tag).toBe('div');
    expect(elements[1].textPreview).toBeUndefined();
  });
});

describe('isPlainObject', () => {
  it('forwards to shared implementation and handles boundary values', () => {
    const values = [{}, Object.create(null), [], null, undefined];
    const results = values.map((value) => isPlainObject(value));

    expect(results).toEqual([true, false, false, false, false]);
    expect(sharedMocks.isPlainObject).toHaveBeenCalledTimes(values.length);
    values.forEach((value, index) => {
      expect(sharedMocks.isPlainObject).toHaveBeenNthCalledWith(index + 1, value);
    });
  });
});

describe('toNonEmptyString', () => {
  it('returns trimmed string or null for empty/invalid inputs', () => {
    const inputs = ['  hello  ', '   ', '', null, undefined, 0];
    const results = inputs.map((value) => toNonEmptyString(value));

    expect(results).toEqual(['hello', null, null, null, null, null]);
    expect(sharedMocks.toNonEmptyString).toHaveBeenCalledTimes(inputs.length);
    inputs.forEach((value, index) => {
      expect(sharedMocks.toNonEmptyString).toHaveBeenNthCalledWith(index + 1, value);
    });
  });
});
