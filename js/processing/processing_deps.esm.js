import { marked as markedLib } from 'marked';
import katexLib from 'katex';
import MarkdownIt from 'markdown-it';

const DOMPurifyStub = {
  sanitize(value) {
    return typeof value === 'string' ? value : '';
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

