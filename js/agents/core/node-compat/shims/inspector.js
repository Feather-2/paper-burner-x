/**
 * inspector shim - V8 inspector is not available in browser
 */

import { EventEmitter } from './events.js';

export class Session extends EventEmitter {
  connect() {}
  connectToMainThread() {}
  disconnect() {}
  post(_method, _params, _callback) {
    if (_callback) setTimeout(() => _callback(null, {}), 0);
  }
}

export function open(_port, _host, _wait) {}
export function close() {}
export function url() { return undefined; }
export function waitForDebugger() {}

export const console = globalThis.console;

export default {
  Session,
  open,
  close,
  url,
  waitForDebugger,
  console,
};
