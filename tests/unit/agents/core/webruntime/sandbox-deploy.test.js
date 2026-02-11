import { describe, expect, it } from 'vitest';
import {
  generateCspHeader,
  generateSandboxFiles,
  generateSwScript,
} from '../../../../../js/agents/core/webruntime/sandbox-deploy.js';

describe('sandbox-deploy', () => {
  describe('generateCspHeader', () => {
    it('returns a strict default policy', () => {
      const csp = generateCspHeader();
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("script-src 'self' 'unsafe-inline'");
      expect(csp).toContain("frame-ancestors 'self'");
    });

    it('includes normalized parent origin in frame-ancestors', () => {
      const csp = generateCspHeader('https://parent.example.com/path?q=1');
      expect(csp).toContain("frame-ancestors 'self' https://parent.example.com");
    });

    it('ignores invalid parent origin values', () => {
      const csp = generateCspHeader('not an origin');
      expect(csp).toContain("frame-ancestors 'self'");
      expect(csp).not.toContain('not an origin');
    });
  });

  describe('generateSwScript', () => {
    it('contains install/activate/fetch handlers', () => {
      const swScript = generateSwScript();
      expect(swScript).toContain("self.addEventListener('install'");
      expect(swScript).toContain("self.addEventListener('activate'");
      expect(swScript).toContain("self.addEventListener('fetch'");
    });

    it('contains skip-waiting message handler', () => {
      const swScript = generateSwScript();
      expect(swScript).toContain("self.addEventListener('message'");
      expect(swScript).toContain("sw:skip-waiting");
    });
  });

  describe('generateSandboxFiles', () => {
    it('returns indexHtml, vercelJson and swScript', () => {
      const files = generateSandboxFiles();
      expect(Object.keys(files)).toEqual(['indexHtml', 'vercelJson', 'swScript']);
    });

    it('uses default title when omitted', () => {
      const files = generateSandboxFiles();
      expect(files.indexHtml).toContain('<title>Sandbox</title>');
    });

    it('escapes unsafe title content', () => {
      const files = generateSandboxFiles({ title: '<img src=x onerror=alert(1)>' });
      expect(files.indexHtml).toContain('&lt;img src=x onerror=alert(1)&gt;');
      expect(files.indexHtml).not.toContain('<img src=x onerror=alert(1)>');
    });

    it('embeds CSP meta tag into html', () => {
      const files = generateSandboxFiles({ parentOrigin: 'https://lab.example.com' });
      const csp = generateCspHeader('https://lab.example.com');
      const escapedCsp = csp.replace(/'/g, '&#39;');

      expect(files.indexHtml).toContain('http-equiv="Content-Security-Policy"');
      expect(files.indexHtml).toContain(escapedCsp);
    });

    it('includes postMessage listener and ready event bridge', () => {
      const files = generateSandboxFiles();
      expect(files.indexHtml).toContain("window.addEventListener('message'");
      expect(files.indexHtml).toContain('sandbox:ready');
      expect(files.indexHtml).toContain('sandbox:ping');
      expect(files.indexHtml).toContain('sandbox:pong');
    });

    it('injects module script tags from scripts option', () => {
      const files = generateSandboxFiles({
        scripts: [
          'https://cdn.example.com/a.js',
          '/assets/main.js',
        ],
      });

      expect(files.indexHtml).toContain('<script type="module" src="https://cdn.example.com/a.js"></script>');
      expect(files.indexHtml).toContain('<script type="module" src="/assets/main.js"></script>');
    });

    it('ignores empty or non-string scripts', () => {
      const files = generateSandboxFiles({
        scripts: ['', '   ', '/ok.js', /** @type {unknown} */ (42)],
      });

      const scriptTagCount = (files.indexHtml.match(/<script type="module" src=/g) || []).length;
      expect(scriptTagCount).toBe(1);
      expect(files.indexHtml).toContain('/ok.js');
    });

    it('escapes script src attributes to avoid html injection', () => {
      const files = generateSandboxFiles({
        scripts: ['https://cdn.example.com/a.js" onerror="alert(1)'],
      });

      expect(files.indexHtml).toContain('https://cdn.example.com/a.js&quot; onerror=&quot;alert(1)');
      expect(files.indexHtml).not.toContain('src="https://cdn.example.com/a.js" onerror="alert(1)"');
    });

    it('serializes vercel headers with wildcard origin by default', () => {
      const files = generateSandboxFiles();
      const parsed = JSON.parse(files.vercelJson);

      const headers = parsed.headers[0].headers;
      const allowOrigin = headers.find((item) => item.key === 'Access-Control-Allow-Origin');
      const allowCredentials = headers.find((item) => item.key === 'Access-Control-Allow-Credentials');
      const csp = headers.find((item) => item.key === 'Content-Security-Policy');

      expect(allowOrigin.value).toBe('*');
      expect(allowCredentials.value).toBe('false');
      expect(csp.value).toContain("frame-ancestors 'self'");
    });

    it('serializes parentOrigin into vercel CORS headers when provided', () => {
      const files = generateSandboxFiles({ parentOrigin: 'https://embed.example.com:443/path' });
      const parsed = JSON.parse(files.vercelJson);

      const headers = parsed.headers[0].headers;
      const allowOrigin = headers.find((item) => item.key === 'Access-Control-Allow-Origin');
      const allowCredentials = headers.find((item) => item.key === 'Access-Control-Allow-Credentials');

      expect(allowOrigin.value).toBe('https://embed.example.com');
      expect(allowCredentials.value).toBe('true');
    });

    it('injects normalized parent origin guard into index html', () => {
      const files = generateSandboxFiles({ parentOrigin: 'https://host.example.com/embed/page' });
      expect(files.indexHtml).toContain('const ALLOWED_PARENT_ORIGIN = "https://host.example.com";');
      expect(files.indexHtml).toContain('event.origin !== ALLOWED_PARENT_ORIGIN');
    });

    it('uses generateSwScript output as swScript payload', () => {
      const files = generateSandboxFiles();
      expect(files.swScript).toBe(generateSwScript());
      expect(files.swScript).toContain('CACHE_NAME');
    });
  });
});
