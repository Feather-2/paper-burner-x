import { describe, it, expect } from 'vitest';
import { createBuiltinModules, BUILTIN_MODULE_NAMES } from '../../../../../../js/agents/core/sandbox/shims/index.js';
import { MemoryVfs } from '../../../../../../js/agents/vfs/vfs.memory.js';

describe('shims/index', () => {
  describe('createBuiltinModules', () => {
    it('returns an object', () => {
      const mods = createBuiltinModules();
      expect(mods).toBeDefined();
      expect(typeof mods).toBe('object');
    });

    it('includes path module with join method', () => {
      const mods = createBuiltinModules();
      expect(mods.path).toBeDefined();
      expect(typeof mods.path.join).toBe('function');
    });

    it('includes events module with EventEmitter', () => {
      const mods = createBuiltinModules();
      expect(mods.events).toBeDefined();
      expect(typeof mods.events.EventEmitter).toBe('function');
    });

    it('includes buffer module with Buffer', () => {
      const mods = createBuiltinModules();
      expect(mods.buffer).toBeDefined();
      expect(typeof mods.buffer.Buffer).toBe('function');
    });

    it('includes stream module', () => {
      const mods = createBuiltinModules();
      expect(mods.stream).toBeDefined();
      expect(typeof mods.stream.Readable).toBe('function');
    });

    it('includes url module', () => {
      const mods = createBuiltinModules();
      expect(mods.url).toBeDefined();
    });

    it('includes util module with format', () => {
      const mods = createBuiltinModules();
      expect(mods.util).toBeDefined();
      expect(typeof mods.util.format).toBe('function');
    });

    it('includes os module with platform', () => {
      const mods = createBuiltinModules();
      expect(mods.os).toBeDefined();
      expect(typeof mods.os.platform).toBe('function');
    });

    it('includes process module with env and cwd', () => {
      const mods = createBuiltinModules();
      expect(mods.process).toBeDefined();
      expect(mods.process.env).toBeDefined();
      expect(typeof mods.process.cwd).toBe('function');
    });

    it('includes crypto module with randomUUID', () => {
      const mods = createBuiltinModules();
      expect(mods.crypto).toBeDefined();
      expect(typeof mods.crypto.randomUUID).toBe('function');
    });

    it('includes fs module when vfs is provided', () => {
      const vfs = new MemoryVfs();
      const mods = createBuiltinModules({ vfs });
      expect(mods.fs).toBeDefined();
    });

    it('includes child_process module when vfs is provided', () => {
      const vfs = new MemoryVfs();
      const mods = createBuiltinModules({ vfs });
      expect(mods.child_process).toBeDefined();
    });

    it('does not include fs without vfs', () => {
      const mods = createBuiltinModules();
      expect(mods.fs).toBeUndefined();
    });

    it('uses provided env for process.env', () => {
      const env = { FOO: 'bar', NODE_ENV: 'test' };
      const mods = createBuiltinModules({ env });
      expect(mods.process.env).toBe(env);
      expect(mods.process.env.FOO).toBe('bar');
    });

    it('uses provided cwd for process.cwd()', () => {
      const mods = createBuiltinModules({ cwd: '/workspace' });
      expect(mods.process.cwd()).toBe('/workspace');
    });
  });

  describe('BUILTIN_MODULE_NAMES', () => {
    it('is an array containing path, fs, and events', () => {
      expect(Array.isArray(BUILTIN_MODULE_NAMES)).toBe(true);
      expect(BUILTIN_MODULE_NAMES).toContain('path');
      expect(BUILTIN_MODULE_NAMES).toContain('fs');
      expect(BUILTIN_MODULE_NAMES).toContain('events');
    });
  });

  describe('stub modules', () => {
    it('tty does not throw on access', () => {
      const mods = createBuiltinModules();
      expect(() => mods.tty.isatty()).not.toThrow();
      expect(mods.tty.isatty()).toBe(false);
    });

    it('dns does not throw on access', () => {
      const mods = createBuiltinModules();
      expect(() => mods.dns.resolve()).not.toThrow();
    });

    it('net does not throw on access', () => {
      const mods = createBuiltinModules();
      expect(() => mods.net.isIP()).not.toThrow();
      expect(mods.net.isIP()).toBe(0);
    });
  });
});
