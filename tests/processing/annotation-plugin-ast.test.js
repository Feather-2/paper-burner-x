/**
 * @file tests/processing/annotation-plugin-ast.test.js
 * @description js/processing/annotation_plugin_ast.js unit tests (global side-effect module)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINALS = {
  window: globalThis.window,
  createAnnotationPluginAST: globalThis.createAnnotationPluginAST,
};

async function loadCreateAnnotationPluginAST() {
  const mod = await import('../../js/processing/annotation_plugin_ast.esm.js');
  return mod.default ?? globalThis.createAnnotationPluginAST;
}

function createMarkdownItStub() {
  const ruler = {
    after: vi.fn((_anchor, _name, fn) => {
      ruler._rule = fn;
    }),
    _rule: null,
  };

  return { core: { ruler } };
}

describe('processing/annotation_plugin_ast (createAnnotationPluginAST)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();

    globalThis.window = {};
    delete globalThis.createAnnotationPluginAST;
    delete globalThis.window.createAnnotationPluginAST;

    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();

    if (ORIGINALS.window === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = ORIGINALS.window;
    }

    if (ORIGINALS.createAnnotationPluginAST === undefined) {
      delete globalThis.createAnnotationPluginAST;
    } else {
      globalThis.createAnnotationPluginAST = ORIGINALS.createAnnotationPluginAST;
    }
  });

  it('exports API and installs it on globalThis/window', async () => {
    const createAnnotationPluginAST = await loadCreateAnnotationPluginAST();

    expect(createAnnotationPluginAST).toBeTypeOf('function');
    expect(globalThis.createAnnotationPluginAST).toBe(createAnnotationPluginAST);
    expect(globalThis.window.createAnnotationPluginAST).toBe(createAnnotationPluginAST);
  });

  it('registers a core rule and becomes a no-op when annotations are empty', async () => {
    const createAnnotationPluginAST = await loadCreateAnnotationPluginAST();
    const plugin = createAnnotationPluginAST([], { contentIdentifier: 'doc-1' });

    const md = createMarkdownItStub();
    plugin(md);

    expect(md.core.ruler.after).toHaveBeenCalledWith('inline', 'annotations', expect.any(Function));
    const rule = md.core.ruler._rule;

    const state = {
      tokens: [
        {
          type: 'inline',
          children: [{ type: 'text', content: 'Hello world', level: 0 }],
        },
      ],
    };

    rule(state);
    expect(state.tokens[0].children).toEqual([{ type: 'text', content: 'Hello world', level: 0 }]);
  });

  it('injects annotation spans and splits text tokens', async () => {
    const createAnnotationPluginAST = await loadCreateAnnotationPluginAST();
    const plugin = createAnnotationPluginAST([{ text: 'world', id: 'ann-1' }], {
      contentIdentifier: 'doc-1',
    });

    const md = createMarkdownItStub();
    plugin(md);

    const rule = md.core.ruler._rule;
    const state = {
      tokens: [
        {
          type: 'inline',
          children: [{ type: 'text', content: 'Hello world!', level: 0 }],
        },
      ],
    };

    rule(state);

    const children = state.tokens[0].children;
    expect(children.map((t) => t.type)).toEqual(['text', 'html_inline', 'text']);
    expect(children[0].content).toBe('Hello ');
    expect(children[2].content).toBe('!');

    expect(children[1].content).toContain('class="annotation-highlight"');
    expect(children[1].content).toContain('data-content-id="doc-1"');
    expect(children[1].content).toContain('data-annotation-id="ann-1"');
    expect(children[1].content).toContain('data-annotation-text="world"');
    expect(children[1].content).toContain('>world</span>');
  });

  it('escapes annotation text in attributes and inner HTML exactly once', async () => {
    const createAnnotationPluginAST = await loadCreateAnnotationPluginAST();
    const plugin = createAnnotationPluginAST([{ text: 'A&B', id: 'x' }], {
      contentIdentifier: 'doc-2',
    });

    const md = createMarkdownItStub();
    plugin(md);

    const state = {
      tokens: [
        {
          type: 'inline',
          children: [{ type: 'text', content: 'A&B', level: 0 }],
        },
      ],
    };

    md.core.ruler._rule(state);
    const html = state.tokens[0].children.find((t) => t.type === 'html_inline')?.content ?? '';

    expect(html).toContain('data-annotation-text="A&amp;B"');
    expect(html).toContain('>A&amp;B</span>');
    expect(html).not.toContain('&amp;amp;');
  });

  it('deduplicates overlapping matches (keeps earliest non-overlapping)', async () => {
    const createAnnotationPluginAST = await loadCreateAnnotationPluginAST();
    const plugin = createAnnotationPluginAST(
      [
        { text: 'ab', id: 'short' },
        { text: 'abc', id: 'long' },
      ],
      { contentIdentifier: 'doc-3' },
    );

    const md = createMarkdownItStub();
    plugin(md);

    const state = {
      tokens: [
        {
          type: 'inline',
          children: [{ type: 'text', content: 'abc', level: 0 }],
        },
      ],
    };

    md.core.ruler._rule(state);
    const htmlTokens = state.tokens[0].children.filter((t) => t.type === 'html_inline');

    expect(htmlTokens).toHaveLength(1);
    expect(htmlTokens[0].content).toContain('data-annotation-id="short"');
    expect(state.tokens[0].children.map((t) => t.content).join('')).toContain('c');
  });

  it('skips pure punctuation/number text tokens', async () => {
    const createAnnotationPluginAST = await loadCreateAnnotationPluginAST();
    const plugin = createAnnotationPluginAST([{ text: '123', id: 'n' }], { contentIdentifier: 'doc-4' });

    const md = createMarkdownItStub();
    plugin(md);

    const state = {
      tokens: [
        {
          type: 'inline',
          children: [{ type: 'text', content: '123,!', level: 0 }],
        },
      ],
    };

    md.core.ruler._rule(state);

    expect(state.tokens[0].children).toEqual([{ type: 'text', content: '123,!', level: 0 }]);
  });

  it('honors skipCodeBlocks and skipMathBlocks config via token context', async () => {
    const createAnnotationPluginAST = await loadCreateAnnotationPluginAST();

    const mdDefault = createMarkdownItStub();
    createAnnotationPluginAST([{ text: 'after', id: 'a' }], { contentIdentifier: 'doc-5' })(mdDefault);

    const stateDefault = {
      tokens: [
        {
          type: 'inline',
          children: [
            { type: 'code_inline', content: 'code', markup: '`' },
            { type: 'text', content: 'after', level: 0 },
            { type: 'math_inline', content: '$x$' },
            { type: 'text', content: 'after', level: 0 },
          ],
        },
      ],
    };

    mdDefault.core.ruler._rule(stateDefault);
    expect(stateDefault.tokens[0].children.filter((t) => t.type === 'html_inline')).toHaveLength(0);

    const mdNoSkip = createMarkdownItStub();
    createAnnotationPluginAST([{ text: 'after', id: 'a' }], {
      contentIdentifier: 'doc-6',
      skipCodeBlocks: false,
      skipMathBlocks: false,
    })(mdNoSkip);

    const stateNoSkip = JSON.parse(JSON.stringify(stateDefault));
    mdNoSkip.core.ruler._rule(stateNoSkip);
    expect(stateNoSkip.tokens[0].children.filter((t) => t.type === 'html_inline')).toHaveLength(2);
  });
});

