/**
 * @file Service Worker handler for virtual HTTP bridge.
 * Install in SW: importScripts('sw-handler.js') or import.
 */

/**
 * @typedef {object} SwFetchHandlerOptions
 * @property {string} [scope='/__virtual__/']
 * @property {number} [requestTimeoutMs=60000]
 * @property {boolean} [allowFirstClientFallback=false]
 */

/**
 * @param {string | undefined} scope
 * @returns {string}
 */
function normalizeScope(scope) {
  if (typeof scope !== 'string' || !scope.trim()) return '/__virtual__/';
  const trimmed = scope.trim();
  const withLeading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Install fetch interceptor in a Service Worker context.
 * @param {ServiceWorkerGlobalScope} sw
 * @param {SwFetchHandlerOptions} [options]
 */
export function installFetchHandler(sw, options = {}) {
  const scope = normalizeScope(options.scope);
  const requestTimeoutMs = typeof options.requestTimeoutMs === 'number' && Number.isFinite(options.requestTimeoutMs)
    ? Math.max(1000, Math.floor(options.requestTimeoutMs))
    : 60000;
  const allowFirstClientFallback = options.allowFirstClientFallback === true;
  const scopePattern = new RegExp(`^${escapeRegex(scope)}(\\d+)(\\/.*)?$`);

  sw.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    if (!url.pathname.startsWith(scope)) return;

    const match = url.pathname.match(scopePattern);
    if (!match) return;

    const port = parseInt(match[1], 10);
    const path = match[2] || '/';

    event.respondWith(
      new Promise((resolve) => {
        const mc = new MessageChannel();
        let settled = false;

        /**
         * Resolve response once and cleanup channel resources.
         * @param {Response} response
         * @returns {void}
         */
        const settle = (response) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          mc.port1.close();
          resolve(response);
        };

        const timeoutId = setTimeout(() => {
          settle(new Response('Timeout', { status: 504 }));
        }, requestTimeoutMs);

        mc.port1.onmessage = (e) => {
          if (settled) return;
          const { status, headers, body } = e.data;
          settle(new Response(body, { status, headers }));
        };

        const clientId = event.resultingClientId || event.clientId;
        const clientPromise = clientId
          ? sw.clients.get(clientId)
          : allowFirstClientFallback
            ? sw.clients.matchAll().then((clients) => clients[0] || null)
            : Promise.resolve(null);

        const bodyPromise = event.request.method !== 'GET' && event.request.method !== 'HEAD'
          ? event.request.arrayBuffer().then((buf) => buf.byteLength > 0 ? buf : null).catch(() => null)
          : Promise.resolve(null);

        Promise.all([clientPromise, bodyPromise]).then(([client, body]) => {
          if (!client) {
            settle(new Response('No client', { status: 503 }));
            return;
          }
          const transfer = [mc.port2];
          if (body instanceof ArrayBuffer) transfer.push(body);
          client.postMessage({
            type: 'virtual-request',
            port,
            method: event.request.method,
            url: path,
            headers: Object.fromEntries(event.request.headers.entries()),
            body,
            requestId: Date.now() + '-' + Math.random(),
          }, transfer);
        }).catch(() => {
          settle(new Response('Client error', { status: 503 }));
        });
      })
    );
  });

  sw.addEventListener('message', (event) => {
    if (event.data?.type === 'keepalive') { /* prevent idle */ }
  });
}
