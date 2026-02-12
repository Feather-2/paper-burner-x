/**
 * @file Service Worker handler for virtual HTTP bridge.
 * Install in SW: importScripts('sw-handler.js') or import.
 */

const SCOPE = '/__virtual__/';

/**
 * Install fetch interceptor in a Service Worker context.
 * @param {ServiceWorkerGlobalScope} sw
 */
export function installFetchHandler(sw) {
  sw.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    if (!url.pathname.startsWith(SCOPE)) return;

    const match = url.pathname.match(/\/__virtual__\/(\d+)(\/.*)?/);
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
        }, 60000);

        mc.port1.onmessage = (e) => {
          if (settled) return;
          const { status, headers, body } = e.data;
          settle(new Response(body, { status, headers }));
        };

        const clientId = event.resultingClientId || event.clientId;
        const clientPromise = clientId
          ? sw.clients.get(clientId)
          : sw.clients.matchAll().then((clients) => clients[0]);

        clientPromise.then((client) => {
          if (!client) {
            settle(new Response('No client', { status: 503 }));
            return;
          }
          client.postMessage({
            type: 'virtual-request',
            port,
            method: event.request.method,
            url: path,
            headers: Object.fromEntries(event.request.headers.entries()),
            body: null,
            requestId: Date.now() + '-' + Math.random(),
          }, [mc.port2]);
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
