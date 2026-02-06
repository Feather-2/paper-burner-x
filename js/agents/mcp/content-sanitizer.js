import { toNonEmptyString } from "../shared/index.js";
import { filterUrlParams, auditUrl } from "./url-whitelist.js";

/**
 * @typedef {object} UrlProxyInspection
 * @property {string} safeUrl
 * @property {boolean} hadCredentials
 * @property {boolean} hadHash
 * @property {string[]} sensitiveQueryKeys
 * @property {string[]} strippedParams
 * @property {any=} audit
 */

/**
 * @param {any} key
 * @returns {boolean}
 */
export function isSensitiveQueryParamKey(key) {
  const k = String(key || "").toLowerCase().trim();
  if (!k) return false;

  if (k === "token" || k === "access_token" || k === "refresh_token" || k === "id_token") return true;
  if (k === "oauth_token" || k === "oauth_verifier") return true;
  if (k.includes("token")) return true;

  if (k === "api_key" || k === "apikey" || k === "key") return true;
  if (k.includes("api_key") || k.includes("apikey") || k.endsWith("_key") || k.endsWith("-key") || k.endsWith("apikey")) return true;

  if (k === "secret" || k === "client_secret" || k === "private_key") return true;
  if (k.includes("secret")) return true;

  if (k === "signature" || k === "sig" || k.endsWith("signature") || k.endsWith("sig")) return true;
  if (k === "password" || k === "passwd" || k === "pwd") return true;
  if (k === "authorization" || k === "auth" || k.startsWith("auth_") || k.includes("auth")) return true;
  if (k === "session" || k === "session_id" || k === "sessionid" || k === "sid" || k === "jsessionid" || k === "phpsessid") return true;
  if (k.includes("session") || k.endsWith("sid")) return true;
  if (k === "csrf" || k === "csrf_token" || k === "xsrf" || k === "xsrf_token" || k.includes("csrf") || k.includes("xsrf")) return true;
  if (k === "nonce" || k.includes("nonce")) return true;
  if (k === "code" || k === "auth_code" || k === "authorization_code" || k === "grant_code" || k === "verification_code" || k === "invite_code") return true;
  if (k === "state" || k === "oauth_state" || k === "auth_state" || k === "login_state" || k === "flow-state" || k === "flow_state") return true;
  if (k.startsWith("x-amz-") && (k.includes("credential") || k.includes("signature") || k.includes("security-token"))) return true;

  return false;
}

/**
 * Redact credentials/tokens in a URL for safe logging.
 * @param {any} rawUrl
 * @returns {string}
 */
export function redactUrlForLog(rawUrl) {
  const url = toNonEmptyString(rawUrl);
  if (!url) return "";

  try {
    const u = new URL(url);

    if (u.username) u.username = "REDACTED";
    if (u.password) u.password = "REDACTED";

    const keys = [...u.searchParams.keys()];
    for (const key of keys) {
      if (isSensitiveQueryParamKey(key)) u.searchParams.set(key, "REDACTED");
    }

    // Fragments are often used to carry tokens (OAuth implicit flows); redact unconditionally for logs.
    if (u.hash) u.hash = "#REDACTED";

    return u.toString();
  } catch {
    const [base] = url.split("#");
    const redacted = String(base || "").replace(
      /([?&](?:token|access_token|refresh_token|id_token|api_key|apikey|key|secret|client_secret|signature|sig|password|passwd|pwd)=)[^&]*/gi,
      "$1REDACTED"
    );
    return url.includes("#") ? `${redacted}#REDACTED` : redacted;
  }
}

/**
 * Inspect and sanitize a URL before proxying.
 * @param {any} rawUrl
 * @param {{ useWhitelist?: boolean }=} options
 * @returns {UrlProxyInspection}
 */
export function inspectUrlForProxy(rawUrl, { useWhitelist = false } = {}) {
  const url = toNonEmptyString(rawUrl);
  if (!url) return { safeUrl: "", hadCredentials: false, hadHash: false, sensitiveQueryKeys: [], strippedParams: [] };

  // P3.2: 白名单模式（更严格）
  if (useWhitelist) {
    const { url: filteredUrl, strippedParams } = filterUrlParams(url, { logStripped: false });
    const audit = auditUrl(url);
    const sensitiveQueryKeys = [];
    try {
      const u = new URL(url);
      for (const key of u.searchParams.keys()) {
        if (isSensitiveQueryParamKey(key)) sensitiveQueryKeys.push(String(key).toLowerCase());
      }
    } catch {
      // ignore
    }
    return {
      safeUrl: filteredUrl,
      hadCredentials: audit.issues.includes("URL contains credentials"),
      hadHash: audit.issues.includes("URL contains hash fragment"),
      sensitiveQueryKeys: Array.from(new Set(sensitiveQueryKeys)),
      strippedParams,
      audit,
    };
  }

  // 黑名单模式（原有逻辑，用于兼容）
  try {
    const u = new URL(url);

    const hadCredentials = Boolean(u.username || u.password);
    if (hadCredentials) {
      u.username = "";
      u.password = "";
    }

    const hadHash = Boolean(u.hash);
    if (u.hash) u.hash = "";

    const sensitiveQueryKeys = [];
    for (const key of u.searchParams.keys()) {
      if (isSensitiveQueryParamKey(key)) sensitiveQueryKeys.push(String(key).toLowerCase());
    }

    const unique = Array.from(new Set(sensitiveQueryKeys));
    return { safeUrl: u.toString(), hadCredentials, hadHash, sensitiveQueryKeys: unique, strippedParams: [] };
  } catch {
    return { safeUrl: url, hadCredentials: false, hadHash: false, sensitiveQueryKeys: [], strippedParams: [] };
  }
}

/**
 * @param {any} text
 * @returns {string}
 */
export function sanitizeExtractedText(text) {
  const s = typeof text === "string" ? text : String(text ?? "");
  if (!s) return "";
  return s.replace(/https?:\/\/[^\s<>"']+/gi, " ").replace(/\s+/g, " ").trim();
}

/**
 * @param {any} text
 * @returns {string}
 */
export function stripUrls(text) {
  const s = typeof text === "string" ? text : String(text ?? "");
  if (!s) return "";
  return s.replace(/https?:\/\/[^\s<>"']+/gi, "");
}
