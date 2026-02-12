/**
 * dns shim - DNS operations are not available in browser
 * Provides stubs that work for basic use cases
 */

/**
 * @typedef {(err: Error | null, address?: string, family?: number) => void} LookupCallback
 * @typedef {(err: Error | null, addresses?: Array<{address: string, family: number}>) => void} LookupAllCallback
 */

/**
 * Lookup a hostname - returns localhost in browser
 * @param {string} hostname
 * @param {object | LookupCallback} optionsOrCallback
 * @param {LookupCallback | LookupAllCallback} [callback]
 */
export function lookup(hostname, optionsOrCallback, callback) {
  const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
  const options = typeof optionsOrCallback === 'object' ? optionsOrCallback : {};

  // In browser, we can't do real DNS lookups
  setTimeout(() => {
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      if (options.all) {
        cb(null, [{ address: '127.0.0.1', family: 4 }]);
      } else {
        cb(null, '127.0.0.1', 4);
      }
    } else {
      if (options.all) {
        cb(null, [{ address: '0.0.0.0', family: 4 }]);
      } else {
        cb(null, '0.0.0.0', 4);
      }
    }
  }, 0);
}

/**
 * Resolve hostname - stub
 * @param {string} hostname
 * @param {Function} callback
 */
export function resolve(hostname, callback) {
  if (typeof callback === 'function') {
    setTimeout(() => callback(null, ['0.0.0.0']), 0);
  }
}

/**
 * @param {string} hostname
 * @param {Function} callback
 */
export function resolve4(hostname, callback) {
  resolve(hostname, callback);
}

/**
 * @param {string} hostname
 * @param {Function} callback
 */
export function resolve6(hostname, callback) {
  if (typeof callback === 'function') {
    setTimeout(() => callback(null, ['::1']), 0);
  }
}

/**
 * Reverse lookup - stub
 * @param {string} ip
 * @param {Function} callback
 */
export function reverse(ip, callback) {
  if (typeof callback === 'function') {
    setTimeout(() => callback(null, ['localhost']), 0);
  }
}

/**
 * Set servers - no-op in browser
 * @param {string[]} _servers
 */
export function setServers(_servers) {}

/**
 * Get servers - return empty in browser
 * @returns {string[]}
 */
export function getServers() {
  return [];
}

/**
 * Set default result order - no-op in browser
 * @param {string} _order
 */
export function setDefaultResultOrder(_order) {}

/**
 * Get default result order
 * @returns {string}
 */
export function getDefaultResultOrder() {
  return 'verbatim';
}

// Promises API
export const promises = {
  lookup: (hostname, options = {}) => {
    return new Promise((resolve, reject) => {
      if (options.all) {
        lookup(hostname, options, (err, addresses) => {
          if (err) reject(err);
          else resolve(addresses || []);
        });
        return;
      }

      lookup(hostname, options, (err, address, family) => {
        if (err) reject(err);
        else resolve({ address, family });
      });
    });
  },
  resolve: (hostname) => {
    return new Promise((promiseResolve, promiseReject) => {
      resolve(hostname, (err, addresses) => {
        if (err) promiseReject(err);
        else promiseResolve(addresses || []);
      });
    });
  },
  resolve4: (hostname) => promises.resolve(hostname),
  resolve6: () => Promise.resolve(['::1']),
  reverse: () => Promise.resolve(['localhost']),
  setServers: () => {},
  getServers: () => [],
};

// Constants
export const ADDRCONFIG = 0;
export const V4MAPPED = 0;
export const ALL = 0;

export default {
  lookup,
  resolve,
  resolve4,
  resolve6,
  reverse,
  setServers,
  getServers,
  setDefaultResultOrder,
  getDefaultResultOrder,
  promises,
  ADDRCONFIG,
  V4MAPPED,
  ALL,
};
