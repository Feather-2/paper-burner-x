/**
 * Node.js https module shim
 * Re-exports http module functionality with https protocol default
 */

import {
  Server,
  IncomingMessage,
  ServerResponse,
  ClientRequest,
  createServer,
  STATUS_CODES,
  METHODS,
  getServer,
  getAllServers,
  setServerListenCallback,
  setServerCloseCallback,
  _createClientRequest,
  Agent,
  globalAgent,
} from './http.js';

// Re-export all http types and classes
export {
  Server,
  IncomingMessage,
  ServerResponse,
  ClientRequest,
  createServer,
  STATUS_CODES,
  METHODS,
  getServer,
  getAllServers,
  setServerListenCallback,
  setServerCloseCallback,
  Agent,
  globalAgent,
};

/**
 * Create an HTTPS client request
 * @param {string | URL | import('./http.js').RequestOptions} urlOrOptions
 * @param {import('./http.js').RequestOptions | ((res: IncomingMessage) => void)} [optionsOrCallback]
 * @param {(res: IncomingMessage) => void} [callback]
 * @returns {ClientRequest}
 */
export function request(urlOrOptions, optionsOrCallback, callback) {
  return _createClientRequest(urlOrOptions, optionsOrCallback, callback, 'https');
}

/**
 * Make an HTTPS GET request
 * @param {string | URL | import('./http.js').RequestOptions} urlOrOptions
 * @param {import('./http.js').RequestOptions | ((res: IncomingMessage) => void)} [optionsOrCallback]
 * @param {(res: IncomingMessage) => void} [callback]
 * @returns {ClientRequest}
 */
export function get(urlOrOptions, optionsOrCallback, callback) {
  const req = _createClientRequest(urlOrOptions, optionsOrCallback, callback, 'https');
  req.end();
  return req;
}

export default {
  Server,
  IncomingMessage,
  ServerResponse,
  ClientRequest,
  createServer,
  request,
  get,
  STATUS_CODES,
  METHODS,
  getServer,
  getAllServers,
  setServerListenCallback,
  setServerCloseCallback,
  Agent,
  globalAgent,
};
