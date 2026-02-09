/**
 * ToolExecutor helper utilities.
 */

export function normalizeIsolationMode(mode) {
  if (mode === true) return "worker";
  const m = typeof mode === "string" ? mode.trim().toLowerCase() : "";
  return m === "worker" ? "worker" : "none";
}

export function looksLikeWindowsAbsolutePath(spec) {
  return typeof spec === "string" && /^[a-zA-Z]:[\\/]/.test(spec);
}

export function looksLikeUrlScheme(spec) {
  return typeof spec === "string" && /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(spec);
}

export function isRelativePathSpecifier(spec) {
  return typeof spec === "string" && (spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("/"));
}

export function normalizeWorkerModuleUrlPolicy(policy, { isNode }) {
  const s = typeof policy === "string" ? policy.trim().toLowerCase() : "";
  if (s === "allow") return "allow";
  if (s === "sameorigin" || s === "same-origin" || s === "same_origin") return "sameOrigin";
  if (s === "local" || s === "localonly" || s === "local-only" || s === "local_only") return "local";
  return isNode ? "local" : "sameOrigin";
}

export function normalizeAllowedOrigins(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  const seen = new Set();
  for (const v of raw) {
    const s = typeof v === "string" ? v.trim() : "";
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out.length ? out : null;
}

export function createBlockedWorkerModuleUrlError(moduleUrl, reason) {
  const err = /** @type {Error & { code?: string, moduleUrl?: string }} */ (
    new Error(`Worker tool moduleUrl blocked: ${reason}`)
  );
  err.name = "WorkerModuleUrlBlockedError";
  err.code = "EWORKER_MODULE_URL_BLOCKED";
  err.moduleUrl = String(moduleUrl ?? "");
  return err;
}

export function resolveAndValidateWorkerModuleUrl(moduleUrl, { isNode, policy, allowedOrigins, baseUrl }) {
  const raw = typeof moduleUrl === "string" ? moduleUrl.trim() : "";
  if (!raw) throw createBlockedWorkerModuleUrlError(moduleUrl, "moduleUrl must be a non-empty string");
  if (raw.length > 4096) throw createBlockedWorkerModuleUrlError(moduleUrl, "moduleUrl too long");

  const effectivePolicy = normalizeWorkerModuleUrlPolicy(policy, { isNode });
  if (effectivePolicy === "allow") return raw;

  // Block bare specifiers by default (they can resolve via node_modules / import maps).
  const isBare = !looksLikeWindowsAbsolutePath(raw) && !looksLikeUrlScheme(raw) && !isRelativePathSpecifier(raw);
  if (isBare) {
    throw createBlockedWorkerModuleUrlError(moduleUrl, "bare specifiers require moduleUrlPolicy=allow");
  }

  // URL-like specifiers (http(s), file, data, blob, node, etc.)
  if (looksLikeUrlScheme(raw) && !looksLikeWindowsAbsolutePath(raw)) {
    let u;
    try {
      u = new URL(raw);
    } catch {
      throw createBlockedWorkerModuleUrlError(moduleUrl, "invalid URL");
    }

    const protocol = u.protocol;
    if (isNode) {
      if (protocol === "file:") return u.toString();
      throw createBlockedWorkerModuleUrlError(moduleUrl, `unsupported protocol in node: ${protocol || "(empty)"}`);
    }

    // Browser: only allow http(s) URLs from allowlisted origins.
    if (protocol !== "http:" && protocol !== "https:") {
      throw createBlockedWorkerModuleUrlError(moduleUrl, `unsupported protocol in browser: ${protocol || "(empty)"}`);
    }

    const baseOrigin = (() => {
      try {
        return new URL(baseUrl).origin;
      } catch {
        return null;
      }
    })();
    const allow = new Set();
    if (baseOrigin) allow.add(baseOrigin);
    for (const o of normalizeAllowedOrigins(allowedOrigins) || []) {
      try {
        allow.add(new URL(o).origin);
      } catch {
        // ignore invalid origin entries
      }
    }

    if (!allow.size) throw createBlockedWorkerModuleUrlError(moduleUrl, "no allowed origins configured");
    if (!allow.has(u.origin)) {
      throw createBlockedWorkerModuleUrlError(moduleUrl, `origin not allowed: ${u.origin || "(empty)"}`);
    }

    return u.toString();
  }

  // Path-like specifiers.
  if (isNode) {
    // Allow absolute/relative paths, including Windows absolute paths.
    return raw;
  }

  // Browser: resolve relative specifiers against the current module URL and apply same-origin/allowlist.
  if (!isRelativePathSpecifier(raw)) {
    throw createBlockedWorkerModuleUrlError(moduleUrl, "unsupported specifier in browser");
  }

  let resolved;
  try {
    resolved = new URL(raw, baseUrl);
  } catch {
    throw createBlockedWorkerModuleUrlError(moduleUrl, "failed to resolve relative URL");
  }

  if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
    throw createBlockedWorkerModuleUrlError(moduleUrl, `unsupported resolved protocol: ${resolved.protocol || "(empty)"}`);
  }

  const baseOrigin = (() => {
    try {
      return new URL(baseUrl).origin;
    } catch {
      return null;
    }
  })();
  const allow = new Set();
  if (baseOrigin) allow.add(baseOrigin);
  for (const o of normalizeAllowedOrigins(allowedOrigins) || []) {
    try {
      allow.add(new URL(o).origin);
    } catch {
      // ignore invalid origin entries
    }
  }

  if (!allow.has(resolved.origin)) {
    throw createBlockedWorkerModuleUrlError(moduleUrl, `origin not allowed: ${resolved.origin || "(empty)"}`);
  }

  return resolved.toString();
}
