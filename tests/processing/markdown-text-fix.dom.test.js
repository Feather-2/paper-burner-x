// @vitest-environment jsdom
/**
 * @file tests/processing/markdown-text-fix.dom.test.js
 * @description js/processing/markdown_text_fix.js DOM-oriented tests (jsdom)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

async function loadMarkdownTextFix() {
  await import('../../js/processing/markdown_text_fix.js');
  return globalThis.MarkdownTextFix;
}

describe('processing/markdown_text_fix (MarkdownTextFix DOM helpers)', () => {
  beforeEach(async () => {
    vi.resetModules();

    delete globalThis.MarkdownTextFix;
    delete window.MarkdownTextFix;

    document.body.innerHTML = '';
    await loadMarkdownTextFix();
  });

  it('fixRenderedMath is a no-op for empty containers', () => {
    const { fixRenderedMath } = globalThis.MarkdownTextFix;
    expect(() => fixRenderedMath(null)).not.toThrow();
  });

  it('fixRenderedMath normalizes katex element spacing and paragraph whitespace', () => {
    const { fixRenderedMath } = globalThis.MarkdownTextFix;

    const container = document.createElement('div');
    container.innerHTML =
      '<p>foo<span class="katex-inline">X</span>bar</p>' +
      '<div class="katex-display">Y</div>';
    document.body.appendChild(container);

    fixRenderedMath(container);

    const inline = container.querySelector('.katex-inline');
    const display = container.querySelector('.katex-display');
    const paragraph = container.querySelector('p');

    expect(inline.style.margin).toBe('0px 2px');
    expect(inline.style.display).toBe('inline');

    expect(display.style.margin).toBe('16px 0px');
    expect(display.style.textAlign).toBe('center');
    expect(display.style.display).toBe('block');

    expect(paragraph.textContent).toBe('foo X bar');
  });
});
