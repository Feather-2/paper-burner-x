import { describe, it, expect } from 'vitest';
import { build, transform, initialize, version } from '../../../../../../js/agents/core/node-compat/shims/esbuild.js';

describe('esbuild shim', () => {
  describe('build()', () => {
    it('throws error in browser environment', async () => {
      await expect(build({ entryPoints: ['index.js'] })).rejects.toThrow(
        'esbuild.build() is not supported in browser environment'
      );
    });

    it('throws error with any options', async () => {
      await expect(build({ bundle: true, minify: true })).rejects.toThrow(
        'not supported in browser environment'
      );
    });
  });

  describe('transform()', () => {
    it('returns pass-through transformation', async () => {
      const code = 'const x = 1;';
      const result = await transform(code);
      expect(result.code).toBe(code);
      expect(result.warnings).toEqual([]);
    });

    it('returns code unchanged with options', async () => {
      const code = 'const x = 1;';
      const result = await transform(code, { minify: true, loader: 'js' });
      expect(result.code).toBe(code);
    });

    it('includes sourcemap when requested', async () => {
      const code = 'const x = 1;';
      const result = await transform(code, { sourcemap: true });
      expect(result.map).toBe('');
    });

    it('excludes sourcemap by default', async () => {
      const code = 'const x = 1;';
      const result = await transform(code);
      expect(result.map).toBeUndefined();
    });

    it('returns empty warnings array', async () => {
      const code = 'const x = 1;';
      const result = await transform(code);
      expect(result.warnings).toEqual([]);
    });

    it('handles empty code', async () => {
      const result = await transform('');
      expect(result.code).toBe('');
    });

    it('handles complex code', async () => {
      const code = `
        import { foo } from 'bar';
        export default function() {
          return foo();
        }
      `;
      const result = await transform(code);
      expect(result.code).toBe(code);
    });
  });

  describe('initialize()', () => {
    it('is a no-op function', async () => {
      await expect(initialize()).resolves.toBeUndefined();
    });

    it('does not throw', async () => {
      await expect(initialize()).resolves.not.toThrow();
    });
  });

  describe('version', () => {
    it('exports stub version string', () => {
      expect(version).toBe('0.0.0-stub');
    });

    it('version is a string', () => {
      expect(typeof version).toBe('string');
    });
  });

  describe('default export', () => {
    it('exports all functions', async () => {
      const esbuild = await import('../../../../../../js/agents/core/node-compat/shims/esbuild.js');
      expect(esbuild.default.build).toBe(build);
      expect(esbuild.default.transform).toBe(transform);
      expect(esbuild.default.initialize).toBe(initialize);
      expect(esbuild.default.version).toBe(version);
    });
  });
});
