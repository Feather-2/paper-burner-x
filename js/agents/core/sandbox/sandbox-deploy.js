/**
 * @typedef {object} DeployConfig
 * @property {string} [title='Sandbox App']
 * @property {string} [sandboxUrl] - 沙箱页面 URL（用于 iframe postMessage 目标）
 * @property {boolean} [enableSW=true] - 是否启用 Service Worker
 * @property {string} [swScope='/__virtual__/']
 */

/**
 * @typedef {object} DeployFiles
 * @property {string} 'index.html'
 * @property {string} 'vercel.json'
 * @property {string} '__sw__.js'
 */

/**
 * 生成部署文件。
 * @param {DeployConfig} [config]
 * @returns {DeployFiles}
 */
export function generateSandboxFiles(config = {}) {
  const { title = 'Sandbox App', sandboxUrl, enableSW = true, swScope = '/__virtual__/' } = config;

  const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <meta http-equiv="Cross-Origin-Opener-Policy" content="same-origin">
  <meta http-equiv="Cross-Origin-Embedder-Policy" content="credentialless">
</head>
<body>
  <div id="app"></div>
  <script type="module">
    ${enableSW ? `
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/__sw__.js', { scope: '${swScope}' })
        .then(reg => console.log('SW registered:', reg.scope))
        .catch(err => console.error('SW registration failed:', err));
    }` : '// Service Worker disabled'}

    // Communication with parent frame
    window.addEventListener('message', (event) => {
      ${sandboxUrl ? `if (event.origin !== new URL('${sandboxUrl}').origin) return;` : ''}
      const { type, payload } = event.data || {};
      if (type === 'execute') {
        try {
          const result = (0, eval)(payload.code);
          event.source.postMessage({ type: 'result', payload: { value: result } }, event.origin);
        } catch (err) {
          event.source.postMessage({ type: 'error', payload: { message: err.message } }, event.origin);
        }
      }
    });
  </script>
</body>
</html>`;

  const vercelJson = JSON.stringify({
    headers: [
      {
        source: '/(.*)',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
          { key: 'Cross-Origin-Resource-Policy', value: 'cross-origin' },
        ],
      },
    ],
  }, null, 2);

  const swJs = `// Service Worker for virtual HTTP bridge
const SCOPE = '${swScope}';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (!url.pathname.startsWith(SCOPE)) return;

  const match = url.pathname.match(/\\/__virtual__\\/(\\d+)(\\/.*)?\\//);
  if (!match) return;

  event.respondWith(
    new Promise((resolve) => {
      const mc = new MessageChannel();
      mc.port1.onmessage = (e) => {
        const { status, headers, body } = e.data;
        resolve(new Response(body, { status, headers }));
      };
      self.clients.matchAll().then(clients => {
        if (!clients.length) { resolve(new Response('No client', { status: 503 })); return; }
        clients[0].postMessage({
          type: 'virtual-request',
          port: parseInt(match[1]),
          method: event.request.method,
          url: match[2] || '/',
          headers: Object.fromEntries(event.request.headers.entries()),
        }, [mc.port2]);
      });
      setTimeout(() => resolve(new Response('Timeout', { status: 504 })), 60000);
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'keepalive') { /* prevent idle */ }
});
`;

  return {
    'index.html': indexHtml,
    'vercel.json': vercelJson,
    '__sw__.js': swJs,
  };
}

/**
 * 将部署文件写入 VFS。
 * @param {object} vfs
 * @param {DeployConfig} [config]
 * @param {string} [outputDir='deploy']
 */
export async function writeSandboxFiles(vfs, config, outputDir = 'deploy') {
  const files = generateSandboxFiles(config);
  await vfs.mkdir(outputDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await vfs.writeText(`${outputDir}/${name}`, content);
  }
  return files;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export default { generateSandboxFiles, writeSandboxFiles };
