export function toNonEmptyString(value) {
  const s = typeof value === "string" ? value.trim() : "";
  return s ? s : null;
}

export function normalizeKeywords(keywords) {
  const raw = Array.isArray(keywords) ? keywords : [];
  const out = [];
  const seen = new Set();
  for (const kw of raw) {
    const k = typeof kw === "string" ? kw.trim().toLowerCase() : "";
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

export function truncate(text, maxLen) {
  const s = typeof text === "string" ? text : String(text ?? "");
  const n = typeof maxLen === "number" && Number.isFinite(maxLen) ? Math.max(0, Math.floor(maxLen)) : 0;
  if (!n) return "";
  return s.length > n ? s.slice(0, n) : s;
}

export function getSummary(data) {
  const summary = data && typeof data === "object" ? toNonEmptyString(data.summary) : null;
  if (summary) return summary;
  try {
    return truncate(typeof data === "string" ? data : JSON.stringify(data), 200);
  } catch {
    return truncate(String(data ?? ""), 200);
  }
}

export function isMissingPathError(err) {
  const msg = String(err?.message || err || "");
  return msg.includes("ENOENT") || msg.includes("NotFoundError") || msg.includes("NOT_FOUND");
}

/**
 * Validate runId to prevent path traversal attacks.
 * @param {string} runId - Run ID to validate
 * @returns {string} Validated runId
 * @throws {Error} If runId contains path traversal characters
 */
export function validateRunId(runId) {
  const id = toNonEmptyString(runId);
  if (!id) throw new Error("L3Storage requires { runId }");
  // Reject path traversal attempts
  if (id.includes("..") || id.includes("/") || id.includes("\\")) {
    throw new Error("L3Storage runId contains invalid characters (path traversal attempt)");
  }
  return id;
}
