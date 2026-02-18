/**
 * @typedef {object} SandboxDeployOptions
 * @property {string} [parentOrigin]
 * @property {string} [title='Sandbox']
 * @property {string[]} [scripts]
 * @property {string[]} [connectSrc]
 */

/**
 * @typedef {object} SandboxDeployFiles
 * @property {string} indexHtml
 * @property {string} vercelJson
 * @property {string} swScript
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * @param {string} [origin]
 * @returns {string}
 */
function normalizeOrigin(origin) {
  if (typeof origin !== 'string') return '';
  const trimmed = origin.trim();
  if (!trimmed) return '';

  try {
    return new URL(trimmed).origin;
  } catch {
    return '';
  }
}

/**
 * Build CSP header for sandbox iframe page.
 *
 * @param {string} [parentOrigin]
 * @param {{ connectSrc?: string[] }} [options]
 * @returns {string}
 */
export function generateCspHeader(parentOrigin, options = {}) {
  const normalizedOrigin = normalizeOrigin(parentOrigin);
  const frameAncestors = normalizedOrigin
    ? `'self' ${normalizedOrigin}`
    : `'self'`;
  const extraConnectSrc = Array.isArray(options.connectSrc)
    ? options.connectSrc
      .map((entry) => normalizeOrigin(entry))
      .filter(Boolean)
    : [];
  const connectSrcList = [`'self'`, ...new Set(extraConnectSrc)].join(' ');

  return [
    `default-src 'none'`,
    `script-src 'self' 'unsafe-inline'`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self' data:`,
    `connect-src ${connectSrcList}`,
    `worker-src 'self' blob:`,
    `frame-ancestors ${frameAncestors}`,
    `base-uri 'none'`,
    `form-action 'none'`,
    `object-src 'none'`,
  ].join('; ');
}

/**
 * Generate service worker source code.
 *
 * @returns {string}
 */
export function generateSwScript() {
  return `const CACHE_PREFIX = 'paper-burner-sandbox';
const CACHE_NAME = \`\${CACHE_PREFIX}-v2\`;

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
        .map((key) => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);
    if (cached) {
      return cached;
    }

    const response = await fetch(event.request);
    if (response && response.ok && response.type !== 'opaque') {
      void cache.put(event.request, response.clone());
    }

    return response;
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'sw:skip-waiting') {
    self.skipWaiting();
  }
});
`;
}

/**
 * Generate static files used by the browser sandbox deployment.
 *
 * @param {SandboxDeployOptions} [options]
 * @returns {SandboxDeployFiles}
 */
export function generateSandboxFiles(options = {}) {
  const {
    parentOrigin,
    title = 'Sandbox',
    scripts = [],
    connectSrc = [],
  } = options;

  const normalizedOrigin = normalizeOrigin(parentOrigin);
  const cspHeader = generateCspHeader(normalizedOrigin, { connectSrc });
  const safeTitle = escapeHtml(title);
  const safeScripts = Array.isArray(scripts)
    ? scripts.filter((item) => typeof item === 'string' && item.trim())
    : [];

  const scriptTags = safeScripts
    .map((src) => `  <script type="module" src="${escapeHtml(src.trim())}"></script>`)
    .join('\n');

  const indexHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${escapeHtml(cspHeader)}">
  <title>${safeTitle}</title>
</head>
<body>
  <div id="app"></div>
${scriptTags}
  <script type="module">
    const ALLOWED_PARENT_ORIGIN = ${JSON.stringify(normalizedOrigin)};
    const SAME_ORIGIN = window.location.origin;
    const SAFE_TARGET_ORIGIN = ALLOWED_PARENT_ORIGIN || SAME_ORIGIN;

    window.addEventListener('message', (event) => {
      if (ALLOWED_PARENT_ORIGIN && event.origin !== ALLOWED_PARENT_ORIGIN) {
        return;
      }
      if (!ALLOWED_PARENT_ORIGIN && event.origin && event.origin !== SAME_ORIGIN) {
        return;
      }

      const payload = event.data || {};

      if (payload.type === 'sandbox:ping') {
        const replyTarget = ALLOWED_PARENT_ORIGIN || (event.origin || SAME_ORIGIN);
        if (!replyTarget || replyTarget === '*' || replyTarget === 'null') {
          return;
        }
        event.source?.postMessage(
          {
            type: 'sandbox:pong',
            payload: { timestamp: Date.now() },
          },
          replyTarget
        );
      }

      if (payload.type === 'sandbox:reload') {
        window.location.reload();
      }
    });

    window.parent?.postMessage(
      {
        type: 'sandbox:ready',
        payload: { href: window.location.href },
      },
      SAFE_TARGET_ORIGIN
    );
  </script>
</body>
</html>
`;

  const allowCredentials = normalizedOrigin ? 'true' : 'false';
  const vercelJson = JSON.stringify({
    headers: [
      {
        source: '/(.*)',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: normalizedOrigin || '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type,Authorization' },
          { key: 'Access-Control-Allow-Credentials', value: allowCredentials },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
          { key: 'Cross-Origin-Resource-Policy', value: 'cross-origin' },
          { key: 'Content-Security-Policy', value: cspHeader },
        ],
      },
    ],
  }, null, 2);

  return {
    indexHtml,
    vercelJson,
    swScript: generateSwScript(),
  };
}
