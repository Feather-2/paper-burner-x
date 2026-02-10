import { describe, it, expect } from 'vitest';
import path, {
  join, resolve, normalize, dirname, basename, extname,
  isAbsolute, relative, parse, format, sep, delimiter,
} from '../../../../../../js/agents/core/sandbox/shims/path.js';

describe('path shim', () => {
  describe('join', () => {
    it('joins two segments', () => {
      expect(join('a', 'b')).toBe('a/b');
    });
    it('resolves parent reference', () => {
      expect(join('a', '../b')).toBe('b');
    });
    it('joins absolute with children', () => {
      expect(join('/a', 'b', 'c')).toBe('/a/b/c');
    });
  });

  describe('normalize', () => {
    it('normalizes double slashes and parent refs', () => {
      expect(normalize('a//b/../c')).toBe('a/c');
    });
    it('returns . for empty string', () => {
      expect(normalize('')).toBe('.');
    });
  });

  describe('dirname', () => {
    it('returns parent directory', () => {
      expect(dirname('/a/b/c')).toBe('/a/b');
    });
    it('returns / for root child', () => {
      expect(dirname('/a')).toBe('/');
    });
  });

  describe('basename', () => {
    it('returns last segment', () => {
      expect(basename('/a/b/c.js')).toBe('c.js');
    });
    it('strips extension when provided', () => {
      expect(basename('/a/b/c.js', '.js')).toBe('c');
    });
  });

  describe('extname', () => {
    it('returns extension with dot', () => {
      expect(extname('file.js')).toBe('.js');
    });
    it('returns empty string for no extension', () => {
      expect(extname('file')).toBe('');
    });
    it('returns last extension for multi-dot', () => {
      expect(extname('file.test.js')).toBe('.js');
    });
  });

  describe('isAbsolute', () => {
    it('returns true for absolute path', () => {
      expect(isAbsolute('/foo')).toBe(true);
    });
    it('returns false for relative path', () => {
      expect(isAbsolute('foo')).toBe(false);
    });
  });

  describe('resolve', () => {
    it('resolves with absolute base', () => {
      expect(resolve('/a', 'b')).toBe('/a/b');
    });
    it('makes relative path absolute', () => {
      const r = resolve('a', 'b');
      expect(r.startsWith('/')).toBe(true);
      expect(r.endsWith('a/b')).toBe(true);
    });
  });

  describe('parse', () => {
    it('parses absolute path', () => {
      expect(parse('/a/b/c.js')).toEqual({
        root: '/',
        dir: '/a/b',
        base: 'c.js',
        name: 'c',
        ext: '.js',
      });
    });
  });

  describe('format', () => {
    it('formats dir + base', () => {
      expect(format({ dir: '/a/b', base: 'c.js' })).toBe('/a/b/c.js');
    });
    it('formats name + ext when no base', () => {
      expect(format({ dir: '/a', name: 'f', ext: '.txt' })).toBe('/a/f.txt');
    });
  });

  describe('relative', () => {
    it('computes relative path between siblings', () => {
      expect(relative('/a/b', '/a/c')).toBe('../c');
    });
    it('returns . for same path', () => {
      expect(relative('/a/b', '/a/b')).toBe('');
    });
  });

  describe('constants', () => {
    it('sep is /', () => {
      expect(sep).toBe('/');
    });
    it('delimiter is :', () => {
      expect(delimiter).toBe(':');
    });
  });

  describe('default export', () => {
    it('has all methods', () => {
      expect(typeof path.join).toBe('function');
      expect(typeof path.resolve).toBe('function');
      expect(typeof path.normalize).toBe('function');
      expect(typeof path.dirname).toBe('function');
      expect(typeof path.basename).toBe('function');
      expect(typeof path.extname).toBe('function');
      expect(typeof path.isAbsolute).toBe('function');
      expect(typeof path.relative).toBe('function');
      expect(typeof path.parse).toBe('function');
      expect(typeof path.format).toBe('function');
    });
  });
});
