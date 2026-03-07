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
 * @param {Parameters<typeof _createClientRequest>[0]} urlOrOptions
 * @param {Parameters<typeof _createClientRequest>[1]} [optionsOrCallback]
 * @param {Parameters<typeof _createClientRequest>[2]} [callback]
 * @returns {ReturnType<typeof _createClientRequest>}
 */
export function request(urlOrOptions, optionsOrCallback, callback) {
  return _createClientRequest(urlOrOptions, optionsOrCallback, callback, 'https');
}

/**
 * Make an HTTPS GET request
 * @param {Parameters<typeof _createClientRequest>[0]} urlOrOptions
 * @param {Parameters<typeof _createClientRequest>[1]} [optionsOrCallback]
 * @param {Parameters<typeof _createClientRequest>[2]} [callback]
 * @returns {ReturnType<typeof _createClientRequest>}
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
