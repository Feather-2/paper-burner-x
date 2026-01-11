import { marked as markedLib } from 'marked';
import katexLib from 'katex';
import MarkdownIt from 'markdown-it';

const DOMPurifyStub = {
  /**
   * Minimal sanitizer fallback for environments where DOMPurify cannot run (e.g. workers).
   * Removes <script> and event handler attributes, and blocks javascript:/data:text/html URLs.
   */
  sanitize(value) {
    const raw = typeof value === 'string' ? value : '';
    if (!raw) return '';
    return raw
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
      .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
      .replace(/<embed\b[^<]*>/gi, '')
      .replace(/<foreignObject\b[^<]*(?:(?!<\/foreignObject>)<[^<]*)*<\/foreignObject>/gi, '')
      .replace(/\bon\w+\s*=/gi, 'data-removed-handler=')
      .replace(/\b(href|src|xlink:href)\s*=\s*(['"])\s*(?:javascript:|data:text\/html)[^'"]*\2/gi, '$1=$2#$2')
      .replace(/\b(href|src|xlink:href)\s*=\s*(?:javascript:|data:text\/html)[^\s>]+/gi, '$1=\"#\"');
  }
};

export function ensureProcessingDeps(root = globalThis) {
  const win = root && root.window ? root.window : null;

  // marked
  if (win && win.marked && !root.marked) {
    root.marked = win.marked;
  }
  if (!root.marked) {
    root.marked = markedLib;
  }
  if (win && !win.marked) {
    win.marked = root.marked;
  }

  // katex
  if (win && win.katex && !root.katex) {
    root.katex = win.katex;
  }
  if (!root.katex) {
    root.katex = katexLib;
  }
  if (win && !win.katex) {
    win.katex = root.katex;
  }

  // markdown-it (legacy scripts reference `markdownit`)
  if (win && win.markdownit && !root.markdownit) {
    root.markdownit = win.markdownit;
  }
  if (!root.markdownit) {
    root.markdownit = MarkdownIt;
  }
  if (win && !win.markdownit) {
    win.markdownit = root.markdownit;
  }

  // DOMPurify (processing folder currently doesn't depend on it directly, but index facade expects it)
  if (win && win.DOMPurify && !root.DOMPurify) {
    root.DOMPurify = win.DOMPurify;
  }
  if (!root.DOMPurify) {
    root.DOMPurify = DOMPurifyStub;
  }
  if (win && !win.DOMPurify) {
    win.DOMPurify = root.DOMPurify;
  }

  return {
    marked: root.marked,
    katex: root.katex,
    markdownit: root.markdownit,
    DOMPurify: root.DOMPurify
  };
}

// Side-effect: ensure legacy globals exist (without overriding existing window.*)
ensureProcessingDeps();
