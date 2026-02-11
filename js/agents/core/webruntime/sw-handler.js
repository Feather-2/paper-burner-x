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

    const port = parseInt(match[1]);
    const path = match[2] || '/';

    event.respondWith(
      new Promise((resolve) => {
        const mc = new MessageChannel();
        mc.port1.onmessage = (e) => {
          const { status, headers, body } = e.data;
          resolve(new Response(body, { status, headers }));
        };

        sw.clients.matchAll().then(clients => {
          if (clients.length === 0) {
            resolve(new Response('No client', { status: 503 }));
            return;
          }
          clients[0].postMessage({
            type: 'virtual-request',
            port,
            method: event.request.method,
            url: path,
            headers: Object.fromEntries(event.request.headers.entries()),
            body: null,
            requestId: Date.now() + '-' + Math.random(),
          }, [mc.port2]);
        });

        setTimeout(() => resolve(new Response('Timeout', { status: 504 })), 60000);
      })
    );
  });

  sw.addEventListener('message', (event) => {
    if (event.data?.type === 'keepalive') { /* prevent idle */ }
  });
}
