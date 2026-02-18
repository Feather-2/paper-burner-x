/**
 * @file Service Worker HTTP bridge — main-thread side.
 *
 * Creates virtual HTTP servers that route through a Service Worker,
 * enabling in-browser request interception without a real server.
 */

/**
 * @typedef {object} VirtualServer
 * @property {number} port
 * @property {(handler: (req: VirtualRequest) => Promise<VirtualResponse>) => void} onRequest
 * @property {() => void} close
 */

/**
 * @typedef {object} VirtualRequest
 * @property {string} method
 * @property {string} url
 * @property {Record<string, string>} headers
 * @property {string|ArrayBuffer|Uint8Array|null} body
 */

/**
 * @typedef {object} VirtualResponse
 * @property {number} status
 * @property {Record<string, string>} headers
 * @property {string|Uint8Array} body
 */

/**
 * @typedef {object} ServerBridgeConfig
 * @property {string} [swUrl='/sw.js'] - Service Worker script URL
 * @property {string} [scope='/__virtual__/']
 * @property {number} [keepaliveInterval=25000]
 * @property {number} [maxReconnects=5]
 */

class ServerBridge {
  /** @param {ServerBridgeConfig} config */
  constructor(config) {
    this._scope = config.scope || '/__virtual__/';
    this._swUrl = config.swUrl || '/sw.js';
    this._keepaliveInterval = config.keepaliveInterval || 25000;
    this._maxReconnects = config.maxReconnects || 5;
    /** @type {Map<number, (req: VirtualRequest) => Promise<VirtualResponse>>} */
    this._servers = new Map();
    this._swReady = false;
    this._messageHandler = null;
    this._keepaliveTimer = null;
    this._controllerChangeHandler = null;
    this._reconnectCount = 0;
  }

  /** Register Service Worker and begin listening. */
  async start() {
    if (typeof navigator === 'undefined' || !navigator.serviceWorker) {
      throw new Error('Service Worker not available');
    }
    await navigator.serviceWorker.register(this._swUrl, { scope: this._scope });
    await navigator.serviceWorker.ready;
    this._swReady = true;

    this._attachMessageHandler();
    this._startKeepalive();
    this._attachControllerChange();
  }

  /** @private */
  _attachMessageHandler() {
    if (this._messageHandler) {
      navigator.serviceWorker.removeEventListener('message', this._messageHandler);
    }
    this._messageHandler = (event) => {
      const { type, port, method, url, headers, body, requestId } = event.data || {};
      if (type !== 'virtual-request') return;
      const handler = this._servers.get(port);
      if (!handler) {
        event.ports?.[0]?.postMessage({
          type: 'virtual-response', requestId,
          status: 404, headers: {}, body: 'No server on port ' + port,
        });
        return;
      }
      handler({ method, url, headers, body })
        .then(resp => event.ports?.[0]?.postMessage({ type: 'virtual-response', requestId, ...resp }))
        .catch(err => event.ports?.[0]?.postMessage({
          type: 'virtual-response', requestId,
          status: 500, headers: {}, body: err.message,
        }));
    };
    navigator.serviceWorker.addEventListener('message', this._messageHandler);
  }

  /** @private */
  _startKeepalive() {
    if (this._keepaliveTimer) clearInterval(this._keepaliveTimer);
    this._keepaliveTimer = setInterval(() => {
      navigator.serviceWorker.controller?.postMessage({ type: 'keepalive' });
    }, this._keepaliveInterval);
  }

  /** @private - Reconnect when SW controller changes (e.g. update/termination). */
  _attachControllerChange() {
    if (this._controllerChangeHandler) {
      navigator.serviceWorker.removeEventListener('controllerchange', this._controllerChangeHandler);
    }
    this._controllerChangeHandler = () => {
      if (this._reconnectCount >= this._maxReconnects) return;
      this._reconnectCount++;
      this._attachMessageHandler();
      this._startKeepalive();
    };
    navigator.serviceWorker.addEventListener('controllerchange', this._controllerChangeHandler);
  }

  /**
   * Create a virtual server on the given port.
   * @param {number} port
   * @returns {VirtualServer}
   */
  listen(port) {
    let handler = null;
    this._servers.set(port, (req) => {
      if (handler) return handler(req);
      return Promise.resolve({ status: 503, headers: {}, body: 'No handler' });
    });
    return {
      port,
      onRequest: (fn) => { handler = fn; },
      close: () => { this._servers.delete(port); },
    };
  }

  /** Stop the bridge and clean up. */
  async stop() {
    if (this._keepaliveTimer) clearInterval(this._keepaliveTimer);
    if (this._messageHandler) navigator.serviceWorker.removeEventListener('message', this._messageHandler);
    if (this._controllerChangeHandler) navigator.serviceWorker.removeEventListener('controllerchange', this._controllerChangeHandler);
    this._servers.clear();
    this._swReady = false;
    this._reconnectCount = 0;
  }

  /** @returns {boolean} */
  get ready() { return this._swReady; }
}

/**
 * Create a Service Worker HTTP bridge.
 * @param {ServerBridgeConfig} [config]
 * @returns {ServerBridge}
 */
export function createServerBridge(config = {}) {
  return new ServerBridge(config);
}

/**
 * Create a fetch handler for testing without a real Service Worker.
 * @param {ServerBridge} bridge
 * @returns {(request: Request) => Promise<Response>}
 */
export function createFetchHandler(bridge) {
  return async (request) => {
    const url = new URL(request.url);
    const match = url.pathname.match(/\/__virtual__\/(\d+)(\/.*)?/);
    if (!match) return new Response('Not a virtual request', { status: 404 });
    const port = parseInt(match[1]);
    const path = match[2] || '/';
    const handler = bridge._servers.get(port);
    if (!handler) return new Response('No server', { status: 404 });
    const resp = await handler({
      method: request.method,
      url: path,
      headers: Object.fromEntries(request.headers.entries()),
      body: request.body ? await request.text() : null,
    });
    return new Response(resp.body, { status: resp.status, headers: resp.headers });
  };
}
