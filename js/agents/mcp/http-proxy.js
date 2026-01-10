import { toNonEmptyString, safeInt as _safeInt } from "../shared/utils/value-utils.js";
import { checkCancelled } from "../shared/utils/cancellation.js";
import { inspectUrlForProxy, redactUrlForLog } from "./content-sanitizer.js";

/**
 * @typedef {object} CorsProxyHttpClientOptions
 * @property {(input: RequestInfo, init?: RequestInit) => Promise<Response>} fetchImpl
 * @property {(string|null)=} proxyEndpoint
 * @property {(string[]|null)=} corsProxies
 * @property {number=} proxyCooldownMs
 * @property {number=} proxyMaxCooldownMs
 * @property {boolean=} allowSensitiveUrlProxying
 * @property {boolean=} useUrlWhitelist
 */

/**
 * @typedef {object} CorsFetchResult
 * @property {string} text
 * @property {string} url
 * @property {string} proxy
 */

// Wrapper to provide default fallback value (value-utils safeInt returns null for invalid)
function safeInt(n, fallback = 0) {
  const v = _safeInt(n);
  return v !== null ? v : fallback;
}

/**
 * @param {any} v
 * @returns {string[]|null}
 */
export function normalizeCorsProxies(v) {
  if (!Array.isArray(v)) return null;
  const out = [];
  const seen = new Set();
  for (const raw of v) {
    if (raw === "") {
      if (seen.has("")) continue;
      seen.add("");
      out.push("");
      continue;
    }
    const s = toNonEmptyString(raw);
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function requireFiniteNumber(v, name) {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`${name} must be a finite number`);
  return v;
}

/**
 * CORS 代理列表
 * 注意：公共 CORS 代理已移除（存在数据泄露风险）
 * 请使用 workerEndpoint 或 proxyEndpoint 配置私有代理
 */
export const DEFAULT_CORS_PROXIES = [
  // 仅保留直接请求选项
  "",
];

const DEFAULT_MAX_BODY_BYTES = 4 * 1024 * 1024; // 4 MiB

function looksLikeProxyErrorPage(html) {
  const s = typeof html === "string" ? html : String(html ?? "");
  if (!s) return false;
  const lower = s.toLowerCase();
  const len = s.length;

  // Only apply heuristics to relatively small responses to avoid false positives.
  if (len > 8000) return false;

  // Common CORS proxy / browser error signatures.
  if (lower.includes("access to fetch") && lower.includes("blocked")) return true;
  if (lower.includes("access to xmlhttprequest") && lower.includes("blocked")) return true;
  if (lower.includes("not allowed by access-control-allow-origin")) return true;
  if (lower.includes("cors-anywhere")) return true;
  if (lower.includes("allorigins") && lower.includes("error")) return true;
  if (lower.includes("cross origin") && lower.includes("denied")) return true;

  // Generic short error pages.
  if (len < 2500) {
    if (lower.includes("access denied")) return true;
    if (lower.includes("forbidden")) return true;
    if (lower.includes("request blocked")) return true;
    if (lower.includes("too many requests")) return true;
    if (lower.includes("rate limit")) return true;
    if (lower.includes("service unavailable")) return true;
    if (lower.includes("attention required") && lower.includes("cloudflare")) return true;
    if (lower.includes("checking your browser")) return true;
  }

  return false;
}

function normalizeMaxBodyBytes(v, fallback) {
  if (v === Infinity) return Infinity;
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  const n = Math.floor(v);
  return n > 0 ? n : fallback;
}

function createBodyTooLargeError(maxBytes, observedBytes) {
  const err = /** @type {Error & { code?: string, maxBytes?: number, observedBytes?: number }} */ (
    new Error(`Response body exceeds limit (${observedBytes} > ${maxBytes} bytes)`)
  );
  err.name = "BodyTooLargeError";
  err.code = "EHTTP_BODY_TOO_LARGE";
  err.maxBytes = maxBytes;
  err.observedBytes = observedBytes;
  return err;
}

function tryGetHeader(response, name) {
  try {
    const headers = response?.headers;
    if (headers && typeof headers.get === "function") return headers.get(name);
  } catch {
    // ignore
  }
  return null;
}

/**
 * Read a Response-like object's body as text, enforcing a best-effort max byte limit.
 * Falls back to response.text() when streams are unavailable (e.g., unit tests).
 * @param {any} response
 * @param {{ maxBytes?: number, signal?: AbortSignal }=} options
 * @returns {Promise<string>}
 */
async function readTextWithLimit(response, { maxBytes = Infinity, signal } = {}) {
  if (maxBytes === Infinity) return await response.text();

  checkCancelled(signal);

  const declared = (() => {
    const raw = tryGetHeader(response, "content-length");
    const n = raw ? Number.parseInt(String(raw), 10) : NaN;
    return Number.isFinite(n) ? n : null;
  })();
  if (declared !== null && declared > maxBytes) {
    throw createBodyTooLargeError(maxBytes, declared);
  }

  const body = response?.body;
  if (body && typeof body.getReader === "function" && typeof TextDecoder === "function") {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    const parts = [];

    try {
      while (true) {
        checkCancelled(signal);
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;

        bytes += value.byteLength || 0;
        if (bytes > maxBytes) {
          try {
            await reader.cancel();
          } catch {
            // ignore cancel errors
          }
          throw createBodyTooLargeError(maxBytes, bytes);
        }

        parts.push(decoder.decode(value, { stream: true }));
      }
    } finally {
      parts.push(decoder.decode());
    }

    return parts.join("");
  }

  const text = await response.text();
  if (text && text.length > maxBytes) {
    throw createBodyTooLargeError(maxBytes, text.length);
  }
  return text;
}

function isIpv4Host(hostname) {
  const h = String(hostname || "").trim();
  const parts = h.split(".");
  if (parts.length !== 4) return false;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return false;
    const n = Number(p);
    if (!Number.isFinite(n) || n < 0 || n > 255) return false;
  }
  return true;
}

function isPrivateIpv4(hostname) {
  if (!isIpv4Host(hostname)) return false;
  const [a, b] = hostname.split(".").map((x) => Number(x));
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function isPrivateIpv6(hostname) {
  const h = String(hostname || "").trim().toLowerCase();
  if (!h || !h.includes(":")) return false;
  if (h === "::1") return true;
  if (h.startsWith("fe80:")) return true; // link-local
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // unique local
  // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1)
  const mapped = (() => {
    // dotted-decimal tail
    const tail = h.slice(h.lastIndexOf(":") + 1);
    if (tail && tail.includes(".") && isIpv4Host(tail)) return tail;
    // hex form tail: ...:ffff:7f00:0001
    const m = h.match(/(?:^|:)ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
    if (!m) return null;
    const hi = parseInt(m[1], 16);
    const lo = parseInt(m[2], 16);
    if (!Number.isFinite(hi) || !Number.isFinite(lo)) return null;
    const a = (hi >> 8) & 0xff;
    const b = hi & 0xff;
    const c = (lo >> 8) & 0xff;
    const d = lo & 0xff;
    const ipv4 = `${a}.${b}.${c}.${d}`;
    return isIpv4Host(ipv4) ? ipv4 : null;
  })();
  if (mapped && isPrivateIpv4(mapped)) return true;
  return false;
}

function isPrivateHostname(hostname) {
  let h = String(hostname || "").trim().toLowerCase();
  if (!h) return false;
  // URL.hostname may include brackets for IPv6 literals (e.g. "[::1]").
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h.endsWith(".local")) return true;
  if (isPrivateIpv4(h)) return true;
  if (isPrivateIpv6(h)) return true;
  return false;
}

/**
 * Validate a URL for fetching (blocks non-HTTP(S) and private-network by default).
 * @param {any} rawUrl
 * @param {{ allowPrivateNetwork?: boolean }=} options
 * @returns {string}
 */
export function validateFetchUrl(rawUrl, { allowPrivateNetwork = false } = {}) {
  const url = toNonEmptyString(rawUrl);
  if (!url) throw new Error("url is required");

  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error("Invalid URL");
  }

  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`Unsupported URL protocol: ${u.protocol || "(empty)"}`);
  }

  const hostname = toNonEmptyString(u.hostname);
  if (!hostname) throw new Error("Invalid URL hostname");
  if (!allowPrivateNetwork && isPrivateHostname(hostname)) {
    throw new Error("Blocked URL hostname (private network)");
  }

  return u.toString();
}

/**
 * Browser-friendly HTTP client that can fall back to a chain of CORS proxies.
 * @param {CorsProxyHttpClientOptions} options
 * @returns {CorsProxyHttpClient}
 */
export class CorsProxyHttpClient {
  /**
   * @param {CorsProxyHttpClientOptions} options
   */
  constructor({
    fetchImpl,
    proxyEndpoint = null,
    corsProxies = DEFAULT_CORS_PROXIES,
    proxyCooldownMs = 60_000,
    proxyMaxCooldownMs = 15 * 60_000,
    allowSensitiveUrlProxying = false,
    useUrlWhitelist = true,
  } = {}) {
    if (typeof fetchImpl !== "function") throw new Error("fetchImpl must be a function");

    this._fetch = fetchImpl;
    this.proxyEndpoint = toNonEmptyString(proxyEndpoint);
    const normalizedCorsProxies = normalizeCorsProxies(corsProxies);
    this.corsProxies = normalizedCorsProxies && normalizedCorsProxies.length ? normalizedCorsProxies : DEFAULT_CORS_PROXIES.slice();

    this.allowSensitiveUrlProxying = allowSensitiveUrlProxying === true;
    this.useUrlWhitelist = useUrlWhitelist === true;

    this.proxyCooldownMs = Math.max(0, safeInt(requireFiniteNumber(proxyCooldownMs, "proxyCooldownMs"), 60_000));
    this.proxyMaxCooldownMs = Math.max(
      this.proxyCooldownMs,
      safeInt(requireFiniteNumber(proxyMaxCooldownMs, "proxyMaxCooldownMs"), 15 * 60_000)
    );

    this._corsProxyUnhealthyUntilMs = new Map(); // proxy -> ts (ms)
    this._corsProxyFailureCount = new Map(); // proxy -> consecutive failures
    this._lastGoodProxy = undefined; // proxy string, may be ""
  }

  _nowMs() {
    return Date.now();
  }

  _markCorsProxyFailure(proxy) {
    const now = this._nowMs();
    const prev = this._corsProxyFailureCount.get(proxy) || 0;
    const failures = Math.max(0, Math.floor(prev)) + 1;
    this._corsProxyFailureCount.set(proxy, failures);

    const base = this.proxyCooldownMs;
    const max = this.proxyMaxCooldownMs;
    const cooldown = base > 0 ? Math.min(max, base * Math.pow(2, failures - 1)) : 0;
    const until = now + cooldown;
    this._corsProxyUnhealthyUntilMs.set(proxy, until);
  }

  _markCorsProxySuccess(proxy) {
    this._lastGoodProxy = proxy;
    this._corsProxyUnhealthyUntilMs.delete(proxy);
    this._corsProxyFailureCount.delete(proxy);
  }

  _buildCorsProxyCandidates({ tryDirect }) {
    const base = (Array.isArray(this.corsProxies) ? this.corsProxies : DEFAULT_CORS_PROXIES).slice();

    // 如果有私有代理端点，将其放在最前面
    if (this.proxyEndpoint) {
      if (!base.includes(this.proxyEndpoint)) base.unshift(this.proxyEndpoint);
    }

    const candidates = tryDirect ? base : base.filter((p) => p);
    if (candidates.length === 0) return [];

    // last-good proxy priority (only if still in candidate set)
    if (this._lastGoodProxy !== undefined && candidates.includes(this._lastGoodProxy)) {
      const reordered = [this._lastGoodProxy, ...candidates.filter((p) => p !== this._lastGoodProxy)];
      return reordered;
    }

    return candidates;
  }

  _filterCorsProxyCooldown(candidates) {
    const now = this._nowMs();
    const available = candidates.filter((p) => {
      const until = this._corsProxyUnhealthyUntilMs.get(p);
      return until === undefined || until <= now;
    });
    // 如果全部都在冷却期，为避免完全不可用，则忽略冷却策略尝试所有候选
    return available.length ? available : candidates;
  }

  /**
   * 通过 CORS 代理链抓取 HTML（会抛出 AggregateError）
   * @param {string} url
   * @param {{ timeoutMs?: number, tryDirect?: boolean, signal?: AbortSignal, maxBodyBytes?: number }=} options
   * @returns {Promise<CorsFetchResult>}
   */
  async fetchWithCorsFallback(url, { timeoutMs = 10000, tryDirect = true, signal, maxBodyBytes } = {}) {
    checkCancelled(signal);
    const candidates = this._filterCorsProxyCooldown(this._buildCorsProxyCandidates({ tryDirect }));
    const errors = [];
    const redactedUrl = redactUrlForLog(url);
    // P3.2: 使用白名单模式或黑名单模式
    const proxyUrl = inspectUrlForProxy(url, { useWhitelist: this.useUrlWhitelist });
    const maxBytes = normalizeMaxBodyBytes(maxBodyBytes, DEFAULT_MAX_BODY_BYTES);

    // P3.2: If params were stripped, expose via result object only (no console logging).

    for (const proxy of candidates) {
      checkCancelled(signal);
      if (proxy && !this.allowSensitiveUrlProxying && proxyUrl.sensitiveQueryKeys.length) {
        errors.push(
          new Error(
            `Refusing to proxy sensitive URL (query params: ${proxyUrl.sensitiveQueryKeys.join(", ") || "unknown"})`
          )
        );
        continue;
      }

      const targetUrl = proxy ? `${proxy}${encodeURIComponent(proxyUrl.safeUrl || url)}` : url;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      const detachAbort = (() => {
        if (!signal || typeof signal !== "object" || typeof signal.aborted !== "boolean") return null;
        if (signal.aborted) {
          try {
            controller.abort(signal.reason);
          } catch {
            controller.abort();
          }
          return null;
        }
        if (typeof signal.addEventListener !== "function") return null;

        const onAbort = () => {
          try {
            controller.abort(signal.reason);
          } catch {
            controller.abort();
          }
        };
        signal.addEventListener("abort", onAbort, { once: true });

        if (typeof signal.removeEventListener !== "function") return null;
        return () => signal.removeEventListener("abort", onAbort);
      })();

      try {
        const response = await this._fetch(targetUrl, {
          method: "GET",
          headers: {
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
          },
          signal: controller.signal,
          mode: "cors",
        });

        if (response.ok || response.status === 0) {
          const text = await readTextWithLimit(response, { maxBytes, signal: controller.signal });
          if (text && text.length > 100 && !looksLikeProxyErrorPage(text)) {
            this._markCorsProxySuccess(proxy);
            return { text, url: targetUrl, proxy: proxy || "direct" };
          }
        }

        const err = new Error(`CORS proxy failed: ${proxy || "direct"} (HTTP ${response.status})`);
        errors.push(err);
        this._markCorsProxyFailure(proxy);
      } catch (e) {
        if (signal?.aborted) checkCancelled(signal);
        const err = new Error(`CORS proxy failed: ${proxy || "direct"} (${e?.message || String(e)})`);
        errors.push(err);
        this._markCorsProxyFailure(proxy);
      } finally {
        clearTimeout(timeoutId);
        detachAbort?.();
      }
    }

    throw new AggregateError(errors, `All CORS proxy attempts failed for ${redactedUrl || url}`);
  }
}
