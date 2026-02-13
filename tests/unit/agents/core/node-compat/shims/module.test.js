import { describe, it, expect } from 'vitest';
import {
  createRequire,
  builtinModules,
  isBuiltin,
  _cache,
  _extensions,
  _pathCache,
  syncBuiltinESMExports,
  Module,
} from '../../../../../../js/agents/core/node-compat/shims/module.js';

describe('module shim', () => {
  describe('createRequire()', () => {
    it('creates a require function', () => {
      const require = createRequire('/path/to/file.js');
      expect(typeof require).toBe('function');
    });

    it('require function throws for unknown modules', () => {
      const require = createRequire('/path/to/file.js');
      expect(() => require('unknown-module')).toThrow("Cannot find module 'unknown-module'");
    });

    it('error message includes the filename', () => {
      const require = createRequire('/path/to/file.js');
      expect(() => require('test')).toThrow("from '/path/to/file.js'");
    });
  });

  describe('builtinModules', () => {
    it('is an array of builtin module names', () => {
      expect(Array.isArray(builtinModules)).toBe(true);
      expect(builtinModules.length).toBeGreaterThan(0);
    });

    it('includes common Node.js modules', () => {
      expect(builtinModules).toContain('fs');
      expect(builtinModules).toContain('path');
      expect(builtinModules).toContain('http');
      expect(builtinModules).toContain('crypto');
      expect(builtinModules).toContain('buffer');
    });

    it('includes all expected core modules', () => {
      const expectedModules = [
        'assert', 'buffer', 'child_process', 'cluster', 'crypto',
        'dgram', 'dns', 'events', 'fs', 'http', 'https',
        'net', 'os', 'path', 'process', 'stream', 'timers',
        'url', 'util', 'zlib',
      ];
      expectedModules.forEach(mod => {
        expect(builtinModules).toContain(mod);
      });
    });
  });

  describe('isBuiltin()', () => {
    it('returns true for builtin modules', () => {
      expect(isBuiltin('fs')).toBe(true);
      expect(isBuiltin('path')).toBe(true);
      expect(isBuiltin('http')).toBe(true);
    });

    it('returns false for non-builtin modules', () => {
      expect(isBuiltin('express')).toBe(false);
      expect(isBuiltin('lodash')).toBe(false);
      expect(isBuiltin('unknown')).toBe(false);
    });

    it('handles node: prefix', () => {
      expect(isBuiltin('node:fs')).toBe(true);
      expect(isBuiltin('node:path')).toBe(true);
      expect(isBuiltin('node:unknown')).toBe(false);
    });

    it('strips node: prefix before checking', () => {
      expect(isBuiltin('node:fs')).toBe(isBuiltin('fs'));
      expect(isBuiltin('node:http')).toBe(isBuiltin('http'));
    });
  });

  describe('_cache', () => {
    it('is an object', () => {
      expect(typeof _cache).toBe('object');
      expect(_cache).not.toBeNull();
    });
  });

  describe('_extensions', () => {
    it('is an object with extension handlers', () => {
      expect(typeof _extensions).toBe('object');
      expect(_extensions).not.toBeNull();
    });

    it('has handlers for common extensions', () => {
      expect('.js' in _extensions).toBe(true);
      expect('.json' in _extensions).toBe(true);
      expect('.node' in _extensions).toBe(true);
    });
  });

  describe('_pathCache', () => {
    it('is an object', () => {
      expect(typeof _pathCache).toBe('object');
      expect(_pathCache).not.toBeNull();
    });
  });

  describe('syncBuiltinESMExports()', () => {
    it('is a function', () => {
      expect(typeof syncBuiltinESMExports).toBe('function');
    });

    it('does not throw when called', () => {
      expect(() => syncBuiltinESMExports()).not.toThrow();
    });
  });

  describe('Module object', () => {
    it('exports all module functions and properties', () => {
      expect(Module.createRequire).toBe(createRequire);
      expect(Module.builtinModules).toBe(builtinModules);
      expect(Module.isBuiltin).toBe(isBuiltin);
      expect(Module._cache).toBe(_cache);
      expect(Module._extensions).toBe(_extensions);
      expect(Module._pathCache).toBe(_pathCache);
      expect(Module.syncBuiltinESMExports).toBe(syncBuiltinESMExports);
    });
  });
});
