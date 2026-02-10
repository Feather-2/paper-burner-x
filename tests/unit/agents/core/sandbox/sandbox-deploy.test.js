import { describe, it, expect, beforeEach } from 'vitest';
import { generateSandboxFiles, writeSandboxFiles } from '../../../../../js/agents/core/sandbox/sandbox-deploy.js';
import { MemoryVfs } from '../../../../../js/agents/vfs/vfs.memory.js';

describe('sandbox-deploy', () => {
  describe('generateSandboxFiles', () => {
    it('returns object with 3 files', () => {
      const files = generateSandboxFiles();
      expect(Object.keys(files)).toHaveLength(3);
      expect(files).toHaveProperty('index.html');
      expect(files).toHaveProperty('vercel.json');
      expect(files).toHaveProperty('__sw__.js');
    });

    it('index.html contains DOCTYPE', () => {
      const files = generateSandboxFiles();
      expect(files['index.html']).toMatch(/^<!DOCTYPE html>/);
    });

    it('index.html contains title', () => {
      const files = generateSandboxFiles();
      expect(files['index.html']).toContain('<title>Sandbox App</title>');
    });

    it('index.html contains COOP/COEP headers', () => {
      const html = generateSandboxFiles()['index.html'];
      expect(html).toContain('Cross-Origin-Opener-Policy');
      expect(html).toContain('Cross-Origin-Embedder-Policy');
    });

    it('vercel.json is valid JSON', () => {
      const files = generateSandboxFiles();
      expect(() => JSON.parse(files['vercel.json'])).not.toThrow();
    });

    it('vercel.json contains CORS headers', () => {
      const parsed = JSON.parse(generateSandboxFiles()['vercel.json']);
      const headerKeys = parsed.headers[0].headers.map(h => h.key);
      expect(headerKeys).toContain('Cross-Origin-Opener-Policy');
      expect(headerKeys).toContain('Cross-Origin-Embedder-Policy');
      expect(headerKeys).toContain('Cross-Origin-Resource-Policy');
    });

    it('__sw__.js contains fetch event handler', () => {
      const sw = generateSandboxFiles()['__sw__.js'];
      expect(sw).toContain("self.addEventListener('fetch'");
    });

    it('custom title is applied', () => {
      const files = generateSandboxFiles({ title: 'My Custom App' });
      expect(files['index.html']).toContain('<title>My Custom App</title>');
    });

    it('enableSW=false disables service worker code', () => {
      const files = generateSandboxFiles({ enableSW: false });
      expect(files['index.html']).toContain('// Service Worker disabled');
      expect(files['index.html']).not.toContain('serviceWorker.register');
    });

    it('escapeHtml prevents XSS in title', () => {
      const files = generateSandboxFiles({ title: '<script>alert(1)</script>' });
      expect(files['index.html']).not.toContain('<script>alert(1)</script>');
      expect(files['index.html']).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    });
  });

  describe('writeSandboxFiles', () => {
    /** @type {MemoryVfs} */
    let vfs;

    beforeEach(() => {
      vfs = new MemoryVfs();
    });

    it('writes files to VFS', async () => {
      await writeSandboxFiles(vfs);
      expect(await vfs.exists('deploy/index.html')).toBe(true);
      expect(await vfs.exists('deploy/vercel.json')).toBe(true);
      expect(await vfs.exists('deploy/__sw__.js')).toBe(true);
    });

    it('uses custom outputDir', async () => {
      await writeSandboxFiles(vfs, {}, 'out');
      expect(await vfs.exists('out/index.html')).toBe(true);
      expect(await vfs.exists('out/vercel.json')).toBe(true);
      expect(await vfs.exists('out/__sw__.js')).toBe(true);
    });
  });
});
