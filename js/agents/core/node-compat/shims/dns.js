/**
 * dns shim - conservative browser-safe DNS compatibility.
 * Only loopback names are resolved; all other names fail fast with ENOTFOUND.
 */

/**
 * @typedef {(err: Error | null, address?: string, family?: number) => void} LookupCallback
 * @typedef {(err: Error | null, addresses?: Array<{address: string, family: number}>) => void} LookupAllCallback
 * @typedef {Error & { code?: string, hostname?: string }} DnsShimError
 */

function asyncCall(fn) {
  setTimeout(fn, 0);
}

function createNotFoundError(hostname) {
  const err = /** @type {DnsShimError} */ (new Error(`getaddrinfo ENOTFOUND ${hostname}`));
  err.code = 'ENOTFOUND';
  err.hostname = hostname;
  return err;
}

function isLoopbackHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function loopbackForFamily(family) {
  return Number(family) === 6
    ? [{ address: '::1', family: 6 }]
    : [{ address: '127.0.0.1', family: 4 }];
}

/**
 * Lookup a hostname.
 * @param {string} hostname
 * @param {object | LookupCallback} optionsOrCallback
 * @param {LookupCallback | LookupAllCallback} [callback]
 */
export function lookup(hostname, optionsOrCallback, callback) {
  const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
  const options = typeof optionsOrCallback === 'object' && optionsOrCallback !== null ? optionsOrCallback : {};
  if (typeof cb !== 'function') throw new TypeError('dns.lookup callback must be a function');

  asyncCall(() => {
    if (!isLoopbackHost(hostname)) {
      cb(createNotFoundError(hostname));
      return;
    }

    const entries = loopbackForFamily(options.family);
    if (options.all) {
      cb(null, entries);
      return;
    }

    const first = entries[0];
    cb(null, first.address, first.family);
  });
}

/**
 * Resolve hostname.
 * @param {string} hostname
 * @param {string | Function} rrtypeOrCallback
 * @param {Function} [callback]
 */
export function resolve(hostname, rrtypeOrCallback, callback) {
  const rrtype = typeof rrtypeOrCallback === 'string' ? rrtypeOrCallback : 'A';
  const cb = typeof rrtypeOrCallback === 'function' ? rrtypeOrCallback : callback;
  if (typeof cb !== 'function') return;

  asyncCall(() => {
    if (!isLoopbackHost(hostname)) {
      cb(createNotFoundError(hostname));
      return;
    }
    if (rrtype === 'AAAA') {
      cb(null, ['::1']);
      return;
    }
    cb(null, ['127.0.0.1']);
  });
}

/**
 * @param {string} hostname
 * @param {Function} callback
 */
export function resolve4(hostname, callback) {
  resolve(hostname, 'A', callback);
}

/**
 * @param {string} hostname
 * @param {Function} callback
 */
export function resolve6(hostname, callback) {
  resolve(hostname, 'AAAA', callback);
}

/**
 * Reverse lookup.
 * @param {string} ip
 * @param {Function} callback
 */
export function reverse(ip, callback) {
  if (typeof callback !== 'function') return;
  asyncCall(() => {
    if (ip === '127.0.0.1' || ip === '::1') {
      callback(null, ['localhost']);
      return;
    }
    callback(createNotFoundError(ip));
  });
}

/**
 * Set servers - no-op in browser.
 * @param {string[]} _servers
 */
export function setServers(_servers) {}

/**
 * Get servers - return empty in browser.
 * @returns {string[]}
 */
export function getServers() {
  return [];
}

/**
 * Set default result order - no-op in browser.
 * @param {string} _order
 */
export function setDefaultResultOrder(_order) {}

/**
 * Get default result order.
 * @returns {string}
 */
export function getDefaultResultOrder() {
  return 'verbatim';
}

// Promises API
export const promises = {
  lookup: (hostname, options = {}) => {
    return new Promise((resolvePromise, reject) => {
      if (options.all) {
        lookup(hostname, options, (err, addresses) => {
          if (err) reject(err);
          else resolvePromise(addresses || []);
        });
        return;
      }

      lookup(hostname, options, (err, address, family) => {
        if (err) reject(err);
        else resolvePromise({ address, family });
      });
    });
  },
  resolve: (hostname) => {
    return new Promise((resolvePromise, reject) => {
      resolve(hostname, (err, addresses) => {
        if (err) reject(err);
        else resolvePromise(addresses || []);
      });
    });
  },
  resolve4: (hostname) => {
    return new Promise((resolvePromise, reject) => {
      resolve4(hostname, (err, addresses) => {
        if (err) reject(err);
        else resolvePromise(addresses || []);
      });
    });
  },
  resolve6: (hostname) => {
    return new Promise((resolvePromise, reject) => {
      resolve6(hostname, (err, addresses) => {
        if (err) reject(err);
        else resolvePromise(addresses || []);
      });
    });
  },
  reverse: (ip) => {
    return new Promise((resolvePromise, reject) => {
      reverse(ip, (err, hostnames) => {
        if (err) reject(err);
        else resolvePromise(hostnames || []);
      });
    });
  },
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
