import { describe, it, expect, vi, beforeEach } from 'vitest';

const basenameOfPathMock = vi.hoisted(() => vi.fn());
const readTextFromPathMock = vi.hoisted(() => vi.fn());

vi.mock('../../../../../js/agents/ingest/adapters/node-io.js', () => ({
  basenameOfPath: basenameOfPathMock,
  readTextFromPath: readTextFromPathMock,
}));

vi.mock('../../../../../js/agents/ingest/constants.js', () => ({
  SourceKind: { CODE: 'code' },
}));

import { CodeAdapter } from '../../../../../js/agents/ingest/adapters/code.js';

const MAX_FILE_BYTES = 1024 * 1024;

beforeEach(() => {
  basenameOfPathMock.mockReset();
  readTextFromPathMock.mockReset();
  basenameOfPathMock.mockResolvedValue('file.js');
  readTextFromPathMock.mockResolvedValue({ size: 0, text: '' });
});

describe('CodeAdapter', () => {
  describe('isSupported', () => {
    it('returns true for supported extensions and false for blocked or sensitive names', () => {
      expect(CodeAdapter.isSupported('app.js')).toBe(true);
      expect(CodeAdapter.isSupported('Makefile')).toBe(true);
      expect(CodeAdapter.isSupported('Dockerfile')).toBe(true);
      expect(CodeAdapter.isSupported('script.PY')).toBe(true);
      expect(CodeAdapter.isSupported('.env')).toBe(false);
      expect(CodeAdapter.isSupported('secrets/passwords.txt')).toBe(false);
      expect(CodeAdapter.isSupported('archive.zip')).toBe(false);
    });

    it('returns false for empty or non-string inputs', () => {
      const inputs = [null, undefined, '', '   ', 0, -1, Number.MAX_SAFE_INTEGER, [], {}];
      for (const input of inputs) {
        expect(CodeAdapter.isSupported(input)).toBe(false);
      }
    });
  });

  describe('getSupportedExtensions', () => {
    it('returns known extensions and excludes blocked ones', () => {
      const extensions = CodeAdapter.getSupportedExtensions();
      expect(Array.isArray(extensions)).toBe(true);
      expect(extensions.length).toBeGreaterThan(0);
      expect(extensions).toContain('js');
      expect(extensions).toContain('py');
      expect(extensions).toContain('makefile');
      expect(extensions).toContain('dockerfile');
      expect(extensions).not.toContain('exe');
    });
  });

  describe('parse', () => {
    it('parses path strings via node-io and builds metadata', async () => {
      basenameOfPathMock.mockResolvedValue('app.js');
      readTextFromPathMock.mockResolvedValue({ size: 12, text: "console.log('ok')\n" });

      const adapter = new CodeAdapter();
      const result = await adapter.parse('/tmp/app.js');

      expect(basenameOfPathMock).toHaveBeenCalledWith('/tmp/app.js');
      expect(readTextFromPathMock).toHaveBeenCalledWith('/tmp/app.js', { maxBytes: MAX_FILE_BYTES });
      expect(result.sourceType).toBe('code');
      expect(result.origin).toMatchObject({
        filename: 'app.js',
        lang: 'javascript',
        size: 12,
      });
      expect(result.metadata).toMatchObject({
        title: 'app.js',
        language: 'javascript',
        extension: 'js',
        lineCount: 2,
      });
      expect(result.parseInfo.adapter).toBe('code');
      expect(result.markdown).toContain('# app.js');
      expect(result.markdown).toContain('```javascript');
      expect(result.markdown).toContain("console.log('ok')");
    });

    it('blocks sensitive filenames before reading file contents', async () => {
      basenameOfPathMock.mockResolvedValue('.env');

      const adapter = new CodeAdapter();
      await expect(adapter.parse('/tmp/.env')).rejects.toThrow(/blocked file type/i);
      expect(readTextFromPathMock).not.toHaveBeenCalled();
    });

    it('parses file-like text() inputs and preserves size boundaries', async () => {
      const adapter = new CodeAdapter();

      const zeroSize = await adapter.parse({
        name: 'zero.js',
        size: 0,
        text: () => 123,
      });

      const negativeSize = await adapter.parse({
        filename: 'neg.js',
        size: -1,
        text: () => 'const x = 1;',
      });

      expect(zeroSize.origin.size).toBe(0);
      expect(zeroSize.markdown).toContain('123');
      expect(negativeSize.origin.size).toBe(-1);
      expect(negativeSize.metadata.extension).toBe('js');
    });

    it('parses arrayBuffer input and infers size when size is non-numeric', async () => {
      const adapter = new CodeAdapter();
      const buffer = new Uint8Array([0x58, 0x41, 0x42, 0x43]).buffer;
      const view = new Uint8Array(buffer, 1, 3);

      const result = await adapter.parse({
        filename: 'bytes.txt',
        size: '123',
        arrayBuffer: () => view,
      });

      expect(result.origin.size).toBe(3);
      expect(result.origin.lang).toBe('text');
      expect(result.markdown).toContain('ABC');
    });

    it('parses content input with long text and deep nesting', async () => {
      const adapter = new CodeAdapter();
      const longText = 'line\n'.repeat(5000);

      const result = await adapter.parse({
        name: 'deep.md',
        content: longText,
        meta: { level1: { level2: { level3: { level4: { level5: true } } } } },
      });

      expect(result.metadata.language).toBe('markdown');
      expect(result.metadata.lineCount).toBe(5001);
    });

    it('throws when file size exceeds max limit', async () => {
      const adapter = new CodeAdapter();

      await expect(adapter.parse({
        name: 'huge.js',
        size: Number.MAX_SAFE_INTEGER,
        content: 'x',
      })).rejects.toThrow(/file too large/i);
    });

    it('throws on invalid or unsupported inputs', async () => {
      const adapter = new CodeAdapter();

      await expect(adapter.parse(null)).rejects.toThrow(TypeError);
      await expect(adapter.parse(undefined)).rejects.toThrow(TypeError);
      await expect(adapter.parse({})).rejects.toThrow(/unsupported file-like input/i);
      await expect(adapter.parse([])).rejects.toThrow(/unsupported file-like input/i);
    });

    it('handles concurrent and rapid successive calls independently', async () => {
      const adapter = new CodeAdapter();

      const makeText = (value) => async () => {
        await Promise.resolve();
        return value;
      };

      const [first, second] = await Promise.all([
        adapter.parse({ name: 'a.js', text: makeText('const a = 1;') }),
        adapter.parse({ name: 'b.js', text: makeText('const b = 2;') }),
      ]);

      expect(first.metadata.title).toBe('a.js');
      expect(second.metadata.title).toBe('b.js');

      const rapid = [];
      for (let i = 0; i < 3; i++) {
        rapid.push(await adapter.parse({ name: `c${i}.js`, content: `const c = ${i};` }));
      }
      expect(rapid.map((doc) => doc.metadata.title)).toEqual(['c0.js', 'c1.js', 'c2.js']);
    });
  });

  describe('buildMarkdown', () => {
    it('includes title, doc comment, language badge, and code block', () => {
      const adapter = new CodeAdapter();
      const code = [
        '/**',
        ' * This is a longer doc comment used for tests.',
        ' */',
        'const value = 42;',
      ].join('\n');

      const markdown = adapter.buildMarkdown('file.js', code, 'javascript');

      expect(markdown).toContain('# file.js');
      expect(markdown).toContain('This is a longer doc comment used for tests.');
      expect(markdown).toContain('**Language:** `javascript`');
      expect(markdown).toContain('```javascript');
      expect(markdown).toContain('const value = 42;');
    });
  });

  describe('extractDocComment', () => {
    it('extracts JSDoc block comments', () => {
      const adapter = new CodeAdapter();
      const code = [
        '/**',
        ' * This is a block comment for extraction.',
        ' */',
        'const x = 1;',
      ].join('\n');

      expect(adapter.extractDocComment(code, 'javascript')).toBe('This is a block comment for extraction.');
    });

    it('extracts python docstrings', () => {
      const adapter = new CodeAdapter();
      const code = [
        '\"\"\"This is a long docstring.',
        'Second line.\"\"\"',
        'print(\"hi\")',
      ].join('\n');

      expect(adapter.extractDocComment(code, 'python')).toBe('This is a long docstring.\nSecond line.');
    });

    it('extracts consecutive line comments and stops at code', () => {
      const adapter = new CodeAdapter();
      const code = [
        '// First line',
        '// Second line',
        'const y = 2;',
        '// Ignored',
      ].join('\n');

      expect(adapter.extractDocComment(code, 'javascript')).toBe('First line\nSecond line');
    });

    it('returns null for empty or short comments', () => {
      const adapter = new CodeAdapter();

      expect(adapter.extractDocComment('', 'javascript')).toBeNull();
      expect(adapter.extractDocComment('// short', 'javascript')).toBeNull();
    });
  });
});
