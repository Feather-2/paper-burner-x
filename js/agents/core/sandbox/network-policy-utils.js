/**
 * @fileoverview Domain pattern validation and matching utilities for network policy.
 * Shared between WasmSandbox and shims/http.js.
 */

/**
 * Validate a domain pattern. Rejects overly broad or malformed patterns.
 * @param {string} pattern
 * @throws {Error} if pattern is invalid
 */
export function validateDomainPattern(pattern) {
  if (!pattern || typeof pattern !== 'string') {
    throw new Error(`Invalid domain pattern: empty or non-string`);
  }
  if (pattern === '*') {
    throw new Error(`Domain pattern '*' is too broad; use specific domains`);
  }
  if (pattern.includes('://') || pattern.includes('/') || pattern.includes(':')) {
    throw new Error(`Domain pattern '${pattern}' must not contain protocol, port, or path`);
  }
  if (pattern.startsWith('*.')) {
    const rest = pattern.slice(2);
    if (!rest.includes('.')) {
      throw new Error(`Domain pattern '${pattern}' is too broad; wildcard must have at least two domain segments (e.g.*.example.com)`);
    }
  }
}

/**
 * Check if a hostname matches a domain pattern (supports *.example.com wildcards).
 * @param {string} hostname
 * @param {string} pattern
 * @returns {boolean}
 */
export function matchesDomainPattern(hostname, pattern) {
  if (pattern.startsWith('*.')) {
    return hostname.toLowerCase().endsWith('.' + pattern.slice(2).toLowerCase());
  }
  return hostname.toLowerCase() === pattern.toLowerCase();
}

/**
 * Check if a URL is allowed by a network policy.
 * @param {string} url
 * @param {{ allowedDomains?: string[], deniedDomains?: string[] } | null} policy
 * @returns {boolean}
 */
/**
 * Validate an entire network policy object.
 * @param {{ allowedDomains?: string[], deniedDomains?: string[] }} policy
 * @throws {Error} if any pattern is invalid or policy shape is wrong
 */
export function validateNetworkPolicy(policy) {
  if (!policy || typeof policy !== 'object') {
    throw new Error('Network policy must be a non-null object');
  }
  for (const list of [policy.allowedDomains, policy.deniedDomains]) {
    if (list) {
      if (!Array.isArray(list)) {
        throw new Error('allowedDomains and deniedDomains must be arrays');
      }
      list.forEach(validateDomainPattern);
    }
  }
}

export function isUrlAllowed(url, policy) {
  if (!policy) return true;
  let hostname;
  try { hostname = new URL(url).hostname; } catch { return false; }

  if (policy.deniedDomains) {
    for (const pattern of policy.deniedDomains) {
      if (matchesDomainPattern(hostname, pattern)) return false;
    }
  }

  if (policy.allowedDomains) {
    for (const pattern of policy.allowedDomains) {
      if (matchesDomainPattern(hostname, pattern)) return true;
    }
    return false;
  }

  return true;
}

/**
 * Async version of isUrlAllowed that supports interactive askCallback.
 * When a URL doesn't match any allow/deny rule, askCallback is invoked
 * to let the user decide whether to permit the request.
 * @param {string} url
 * @param {{ allowedDomains?: string[], deniedDomains?: string[] } | null} policy
 * @param {{ askCallback?: (info: { url: string, hostname: string, method?: string }) => Promise<boolean>, method?: string }} [options]
 * @returns {Promise<boolean>}
 */
export async function isUrlAllowedAsync(url, policy, options = {}) {
  if (!policy) return true;
  let hostname;
  try { hostname = new URL(url).hostname; } catch { return false; }

  if (policy.deniedDomains) {
    for (const pattern of policy.deniedDomains) {
      if (matchesDomainPattern(hostname, pattern)) return false;
    }
  }

  if (policy.allowedDomains) {
    for (const pattern of policy.allowedDomains) {
      if (matchesDomainPattern(hostname, pattern)) return true;
    }
    if (options.askCallback) {
      return options.askCallback({ url, hostname, method: options.method });
    }
    return false;
  }

  return true;
}
