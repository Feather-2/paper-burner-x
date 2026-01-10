/**
 * @file tests/chatbot/safe-markdown-render.test.js
 * @description js/chatbot/utils/safe-markdown-render.js unit tests (dependency fallbacks)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getSecurityInfo, isDOMPurifyAvailable, safeRenderMarkdown } from '../../js/chatbot/utils/safe-markdown-render.js';

const ORIGINALS = {
  marked: globalThis.marked,
  DOMPurify: globalThis.DOMPurify,
};

describe('chatbot/utils/safe-markdown-render', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();

    if (ORIGINALS.marked === undefined) delete globalThis.marked;
    else globalThis.marked = ORIGINALS.marked;

    if (ORIGINALS.DOMPurify === undefined) delete globalThis.DOMPurify;
    else globalThis.DOMPurify = ORIGINALS.DOMPurify;
  });

  it('falls back to escaping when marked is missing', () => {
    delete globalThis.marked;
    globalThis.DOMPurify = { sanitize: vi.fn(() => 'unused') };

    const out = safeRenderMarkdown('<b>&</b>\n"x"');
    expect(out).toBe('&lt;b&gt;&amp;&lt;/b&gt;<br>&quot;x&quot;');
    expect(console.error).toHaveBeenCalledWith('safeRenderMarkdown: marked is not loaded');
  });

  it('falls back to marked.parse when DOMPurify is missing', () => {
    globalThis.marked = { parse: vi.fn(() => '<p>ok</p>') };
    delete globalThis.DOMPurify;

    expect(safeRenderMarkdown('**x**')).toBe('<p>ok</p>');
    expect(globalThis.marked.parse).toHaveBeenCalledWith('**x**');
    expect(console.warn).toHaveBeenCalledWith(
      'safeRenderMarkdown: DOMPurify is not loaded, falling back to unsafe rendering',
    );
  });

  it('uses DOMPurify.sanitize when available', () => {
    globalThis.marked = { parse: vi.fn(() => '<img src="x" onerror="alert(1)"><p>ok</p>') };
    globalThis.DOMPurify = { sanitize: vi.fn(() => '<img src="x"><p>ok</p>') };

    const out = safeRenderMarkdown('![x](x)');
    expect(out).toBe('<img src="x"><p>ok</p>');

    expect(globalThis.marked.parse).toHaveBeenCalledTimes(1);
    expect(globalThis.DOMPurify.sanitize).toHaveBeenCalledTimes(1);
    expect(globalThis.DOMPurify.sanitize).toHaveBeenCalledWith(
      '<img src="x" onerror="alert(1)"><p>ok</p>',
      expect.objectContaining({
        ALLOWED_TAGS: expect.any(Array),
        ALLOWED_ATTR: expect.any(Array),
        ALLOWED_URI_REGEXP: expect.any(RegExp),
        ALLOW_DATA_ATTR: false,
        SAFE_FOR_TEMPLATES: true,
        KEEP_CONTENT: true,
      }),
    );
  });

  it('exposes security info helpers', () => {
    delete globalThis.DOMPurify;
    delete globalThis.marked;
    expect(isDOMPurifyAvailable()).toBe(false);
    expect(getSecurityInfo()).toEqual(
      expect.objectContaining({
        hasDOMPurify: false,
        hasMarked: false,
        config: expect.objectContaining({
          blocksScriptTag: true,
          blocksEventAttributes: true,
          blocksJavascriptUrls: true,
        }),
      }),
    );
  });
});

